import { and, asc, eq, gt, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { task, taskAttachment } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Moves tasks (and their live subtasks) to the Trash. Rows, comments, history,
// time entries and attachment files all stay intact so a restore is lossless.
// `taskIds` must already be permission-checked/scoped by the caller. Returns the
// ids that were actually trashed (parents + cascaded subtasks).
export async function softDeleteTasks(
  taskIds: string[],
  deletedBy: string
): Promise<{ parentIds: string[]; subtaskIds: string[] }> {
  if (taskIds.length === 0) {
    return { parentIds: [], subtaskIds: [] };
  }
  const now = new Date();
  return await db.transaction(async (tx) => {
    const parents = await tx
      .update(task)
      .set({
        deletedAt: now,
        deletedBy,
        isPinnedToList: false,
        pinnedToListBy: null,
        pinnedToListAt: null,
        pinnedToListOrder: null,
        updatedAt: now,
      })
      .where(and(inArray(task.id, taskIds), isNull(task.deletedAt)))
      .returning({ id: task.id });
    const parentIds = parents.map((p) => p.id);
    if (parentIds.length === 0) {
      return { parentIds: [], subtaskIds: [] };
    }

    // Subtasks have no FK to their parent — trash them with it, tagged so a
    // restore only brings back the ones that went in with this parent.
    const children = await tx
      .select({ id: task.id, parentTaskId: task.parentTaskId })
      .from(task)
      .where(
        and(inArray(task.parentTaskId, parentIds), isNull(task.deletedAt))
      );
    for (const c of children) {
      await tx
        .update(task)
        .set({
          deletedAt: now,
          deletedBy,
          deletedWithParentId: c.parentTaskId,
          updatedAt: now,
        })
        .where(eq(task.id, c.id));
    }
    return { parentIds, subtaskIds: children.map((c) => c.id) };
  });
}

// Restores trashed tasks plus the subtasks that were trashed with them.
export async function restoreTasks(
  tx: Tx,
  taskIds: string[]
): Promise<string[]> {
  if (taskIds.length === 0) {
    return [];
  }
  const now = new Date();
  const restored = await tx
    .update(task)
    .set({ deletedAt: null, deletedBy: null, updatedAt: now })
    .where(and(inArray(task.id, taskIds), isNotNull(task.deletedAt)))
    .returning({ id: task.id });
  const ids = restored.map((r) => r.id);
  if (ids.length > 0) {
    await tx
      .update(task)
      .set({
        deletedAt: null,
        deletedBy: null,
        deletedWithParentId: null,
        updatedAt: now,
      })
      .where(
        and(inArray(task.deletedWithParentId, ids), isNotNull(task.deletedAt))
      );
  }
  return ids;
}

// Deletes every stored attachment object (file attachments + inline images) for
// the given tasks. Call BEFORE the rows are removed — the keys live in the rows
// and DB cascades never touch storage. Best-effort: a missing file never blocks.
export async function deleteStorageForTasks(taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) {
    return;
  }
  const files = await db
    .select({ fileUrl: taskAttachment.fileUrl })
    .from(taskAttachment)
    .where(inArray(taskAttachment.taskId, taskIds));
  await Promise.all(
    files.map(async (f) => {
      try {
        await storage.delete(f.fileUrl);
      } catch {
        // A file that is already missing must not block the delete.
      }
    })
  );
}

// ─── Permanent delete (manual "Delete forever" AND the automatic 30-day purge) ──
//
// One shared, safe implementation. Per top-level trashed task, in ONE transaction:
//   1. lock the row (+ its trashed subtasks) `FOR UPDATE SKIP LOCKED` and re-check
//      that it is still trashed (and, for retention, still past the cutoff) — a
//      task restored / purged by someone else in the meantime is simply skipped;
//   2. delete every attachment object from storage (rows + keys are still there);
//   3. delete the task rows — FK cascades remove all dependent data.
// If storage fails for any file (other than "already missing") the transaction
// rolls back: the task stays in the Trash with its attachment metadata intact and
// is retried on a later run. Audit is written after commit (task activity rows
// cascade away with the task, so audit_logs is the only durable record).

export type PurgeReason = "manual" | "retention";

export interface PurgeOptions {
  actor?: { email?: string | null; id: string };
  /** Retention only: rows must also satisfy `deletedAt <= cutoff`. */
  cutoff?: Date;
  reason: PurgeReason;
}

export type PurgeOutcome =
  | { ids: string[]; rootId: string; status: "purged" }
  | { rootId: string; status: "skipped" }
  | { error: string; rootId: string; status: "failed" };

class StoragePurgeError extends Error {}

// A file that is already gone counts as cleaned up; any other error is real.
// (files-sdk's fs driver and S3 deletes don't throw for missing keys, but a
// provider may surface FilesError code "NotFound".)
function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "NotFound"
  );
}

export async function purgeTrashedTask(
  rootId: string,
  opts: PurgeOptions
): Promise<PurgeOutcome> {
  try {
    const result = await db.transaction(async (tx) => {
      const [root] = await tx
        .select({
          id: task.id,
          title: task.title,
          workspaceId: task.workspaceId,
          deletedAt: task.deletedAt,
          deletedBy: task.deletedBy,
        })
        .from(task)
        .where(
          and(
            eq(task.id, rootId),
            isNotNull(task.deletedAt),
            opts.cutoff ? lte(task.deletedAt, opts.cutoff) : undefined
          )
        )
        .for("update", { skipLocked: true });
      if (!root) {
        return null;
      }

      const children = await tx
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.parentTaskId, rootId), isNotNull(task.deletedAt)))
        .for("update", { skipLocked: true });
      const ids = [root.id, ...children.map((c) => c.id)];

      const files = await tx
        .select({ fileUrl: taskAttachment.fileUrl })
        .from(taskAttachment)
        .where(inArray(taskAttachment.taskId, ids));
      let failedFiles = 0;
      for (const f of files) {
        try {
          await storage.delete(f.fileUrl);
        } catch (err) {
          if (!isMissingFileError(err)) {
            failedFiles += 1;
          }
        }
      }
      if (failedFiles > 0) {
        throw new StoragePurgeError(
          `${failedFiles} attachment file(s) could not be deleted from storage`
        );
      }

      await tx.delete(task).where(inArray(task.id, ids));
      return { root, ids, attachments: files.length };
    });

    if (!result) {
      return { rootId, status: "skipped" };
    }

    const { root, ids, attachments } = result;
    const auto = opts.reason === "retention";
    await audit({
      action: auto ? "trash.auto_purged" : "trash.purged",
      actorId: opts.actor?.id ?? null,
      actorEmail: opts.actor?.email ?? null,
      description: auto
        ? `Automatically purged "${root.title}" from the Trash (30-day retention)`
        : `Permanently deleted "${root.title}" from the Trash`,
      entityType: "TASK",
      entityId: root.id,
      metadata: {
        workspaceId: root.workspaceId,
        taskId: root.id,
        title: root.title,
        deletedAt: root.deletedAt?.toISOString() ?? null,
        deletedBy: root.deletedBy,
        purgedAt: new Date().toISOString(),
        reason: auto ? "retention_30_days" : "manual",
        subtaskIds: ids.filter((id) => id !== root.id),
        attachmentsDeleted: attachments,
      },
    });
    return { rootId, status: "purged", ids };
  } catch (err) {
    console.error(`[trash] failed to purge task ${rootId}`, err);
    return {
      rootId,
      status: "failed",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export interface PurgeSummary {
  /** Top-level tasks whose purge failed (they stay in the Trash). */
  failed: string[];
  /** Every purged task id, including subtasks purged with their parent. */
  purged: string[];
  skipped: number;
}

// Sequential on purpose: one transaction per task isolates failures and keeps
// locks short. One bad task never stops the rest.
export async function purgeTasks(
  taskIds: string[],
  opts: PurgeOptions
): Promise<PurgeSummary> {
  const summary: PurgeSummary = { purged: [], failed: [], skipped: 0 };
  for (const id of taskIds) {
    const outcome = await purgeTrashedTask(id, opts);
    if (outcome.status === "purged") {
      summary.purged.push(...outcome.ids);
    } else if (outcome.status === "failed") {
      summary.failed.push(outcome.rootId);
    } else {
      summary.skipped += 1;
    }
  }
  return summary;
}

// Retention selection: trashed tasks whose deletedAt is at/over the cutoff.
// Keyset-paginated by id so a batch of permanently-failing tasks can't starve the
// rest, and nothing is ever held in memory beyond one batch.
export async function findExpiredTrashedTaskIds(opts: {
  afterId?: string;
  cutoff: Date;
  limit: number;
}): Promise<string[]> {
  const rows = await db
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        isNotNull(task.deletedAt),
        lte(task.deletedAt, opts.cutoff),
        opts.afterId ? gt(task.id, opts.afterId) : undefined
      )
    )
    .orderBy(asc(task.id))
    .limit(opts.limit);
  return rows.map((r) => r.id);
}
