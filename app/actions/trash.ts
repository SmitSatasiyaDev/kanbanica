"use server";

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { list, space, task, user } from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { purgeTasks, restoreTasks } from "@/lib/trash";
import { trashDaysRemaining } from "@/lib/trash-retention";

// Trash is an Owner/Admin-only surface (sidebar menu → Trash).
type TrashAuth =
  | { error: string }
  | { session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>> };

async function requireTrashAdmin(workspaceId: string): Promise<TrashAuth> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }
  const m = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!m || (m.role !== "OWNER" && m.role !== "ADMIN")) {
    return { error: "Forbidden" };
  }
  return { session };
}

export interface DeletedTaskRow {
  /** Whole days left before the automatic purge. 0 = eligible, purge pending. */
  daysRemaining: number;
  deletedAt: string;
  deletedByName: string | null;
  id: string;
  listName: string | null;
  seqNumber: number;
  spaceName: string | null;
  subtaskCount: number;
  title: string;
}

export async function getDeletedTasks(
  workspaceId: string
): Promise<{ tasks: DeletedTaskRow[] } | { error: string }> {
  const auth_ = await requireTrashAdmin(workspaceId);
  if ("error" in auth_) {
    return { error: auth_.error };
  }

  // Top-level entries only: subtasks trashed with their parent are shown as a
  // count on the parent and restored/purged with it.
  const rows = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      deletedAt: task.deletedAt,
      deletedByName: user.name,
      spaceName: space.name,
      listName: list.name,
    })
    .from(task)
    .leftJoin(user, eq(user.id, task.deletedBy))
    .leftJoin(space, eq(space.id, task.spaceId))
    .leftJoin(list, eq(list.id, task.listId))
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        isNotNull(task.deletedAt),
        isNull(task.deletedWithParentId)
      )
    )
    .orderBy(desc(task.deletedAt));

  const ids = rows.map((r) => r.id);
  const children = ids.length
    ? await db
        .select({ parentTaskId: task.parentTaskId })
        .from(task)
        .where(
          and(inArray(task.deletedWithParentId, ids), isNotNull(task.deletedAt))
        )
    : [];
  const childCount = new Map<string, number>();
  for (const c of children) {
    if (c.parentTaskId) {
      childCount.set(c.parentTaskId, (childCount.get(c.parentTaskId) ?? 0) + 1);
    }
  }

  return {
    tasks: rows.map((r) => {
      const deletedAt = r.deletedAt as Date;
      return {
        id: r.id,
        seqNumber: r.seqNumber,
        title: r.title,
        deletedAt: deletedAt.toISOString(),
        daysRemaining: trashDaysRemaining(deletedAt),
        deletedByName: r.deletedByName,
        spaceName: r.spaceName,
        listName: r.listName,
        subtaskCount: childCount.get(r.id) ?? 0,
      };
    }),
  };
}

// Scopes caller-supplied ids to this workspace's trashed rows.
async function trashedIdsInWorkspace(workspaceId: string, taskIds: string[]) {
  if (taskIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: task.id, parentTaskId: task.parentTaskId })
    .from(task)
    .where(
      and(
        inArray(task.id, taskIds),
        eq(task.workspaceId, workspaceId),
        isNotNull(task.deletedAt)
      )
    );
  return rows;
}

export async function restoreDeletedTasks(
  workspaceId: string,
  taskIds: string[]
): Promise<{ ok: true; restored: number } | { error: string }> {
  const auth_ = await requireTrashAdmin(workspaceId);
  if ("error" in auth_) {
    return { error: auth_.error };
  }
  const rows = await trashedIdsInWorkspace(workspaceId, taskIds);
  if (rows.length === 0) {
    return { error: "Nothing to restore" };
  }

  // A subtask trashed on its own can't come back while its parent is still in
  // the Trash (it would be invisible) — restore the parent first.
  const parentIds = [
    ...new Set(rows.map((r) => r.parentTaskId).filter((p): p is string => !!p)),
  ];
  const trashedParents = parentIds.length
    ? new Set(
        (await trashedIdsInWorkspace(workspaceId, parentIds)).map((p) => p.id)
      )
    : new Set<string>();
  const selected = new Set(rows.map((r) => r.id));
  const restorable = rows.filter(
    (r) =>
      !r.parentTaskId ||
      !trashedParents.has(r.parentTaskId) ||
      selected.has(r.parentTaskId)
  );
  if (restorable.length === 0) {
    return { error: "Restore the parent task first" };
  }

  const restoredIds = await db.transaction((tx) =>
    restoreTasks(
      tx,
      restorable.map((r) => r.id)
    )
  );
  await Promise.all(
    restoredIds.map((id) =>
      writeActivityLog(id, auth_.session.user.id, "task_restored")
    )
  );
  await refreshWorkspace(workspaceId);
  return { ok: true, restored: restoredIds.length };
}

export type PurgeResult =
  | { deleted: number; failed: number; ok: true }
  | { error: string };

// Shared by Delete forever / Empty trash. A task whose attachment files can't be
// removed stays in the Trash (nothing half-deleted) and is reported as `failed`.
async function purgeResult(
  summary: Awaited<ReturnType<typeof purgeTasks>>
): Promise<PurgeResult> {
  if (summary.purged.length === 0 && summary.failed.length > 0) {
    return {
      error:
        "Couldn't delete the attached files, so the task was kept in Trash. Please try again.",
    };
  }
  return {
    ok: true,
    deleted: summary.purged.length,
    failed: summary.failed.length,
  };
}

export async function permanentlyDeleteTasks(
  workspaceId: string,
  taskIds: string[]
): Promise<PurgeResult> {
  const auth_ = await requireTrashAdmin(workspaceId);
  if ("error" in auth_) {
    return { error: auth_.error };
  }
  const rows = await trashedIdsInWorkspace(workspaceId, taskIds);
  if (rows.length === 0) {
    return { error: "Nothing to delete" };
  }
  // Same locked, storage-first purge as the automatic 30-day job; it writes the
  // per-task audit entry itself.
  const summary = await purgeTasks(
    rows.map((r) => r.id),
    {
      reason: "manual",
      actor: { id: auth_.session.user.id, email: auth_.session.user.email },
    }
  );
  await refreshWorkspace(workspaceId);
  return purgeResult(summary);
}

export async function emptyTrash(workspaceId: string): Promise<PurgeResult> {
  const auth_ = await requireTrashAdmin(workspaceId);
  if ("error" in auth_) {
    return { error: auth_.error };
  }
  const rows = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.workspaceId, workspaceId), isNotNull(task.deletedAt)));
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) {
    return { ok: true, deleted: 0, failed: 0 };
  }
  const summary = await purgeTasks(ids, {
    reason: "manual",
    actor: { id: auth_.session.user.id, email: auth_.session.user.email },
  });
  await audit({
    action: "trash.emptied",
    actorId: auth_.session.user.id,
    actorEmail: auth_.session.user.email,
    description: `Emptied the Trash (${summary.purged.length} task(s))`,
    entityType: "WORKSPACE",
    entityId: workspaceId,
    metadata: { count: summary.purged.length, failed: summary.failed.length },
  });
  await refreshWorkspace(workspaceId);
  return purgeResult(summary);
}
