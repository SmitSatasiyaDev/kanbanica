import { and, count, eq, gt, isNull, or, sql } from "drizzle-orm";
import { task, workspace, workspaceMember } from "@/db/schema";
import { db } from "@/lib/db";
import {
  GUEST_LIMIT_CODE,
  MEMBER_LIMIT_CODE,
  type MemberBucket,
  type MemberLimitError,
  memberLimitReachedMessage,
} from "@/lib/member-limit";
import {
  TASK_LIMIT_CODE,
  type TaskLimitError,
  taskLimitReachedMessage,
} from "@/lib/task-limit";

export * from "@/lib/member-limit";
export * from "@/lib/task-limit";

/** A Drizzle transaction handle, as passed to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Current usage = every task row in the workspace (active, completed, archived,
 * subtasks, orphans, and tasks in the Trash). Trashed tasks keep counting until
 * they are permanently deleted from the Trash; archiving
 * does not free capacity either.
 */
export async function getWorkspaceTaskUsage(
  workspaceId: string,
  tx?: DbTransaction
): Promise<number> {
  const client = tx ?? db;
  const [row] = await client
    .select({ value: count() })
    .from(task)
    .where(eq(task.workspaceId, workspaceId));
  return Number(row?.value ?? 0);
}

export interface WorkspaceCapacity {
  limit: number | null;
  /** null when unlimited. Never negative. */
  remaining: number | null;
  used: number;
}

/** Non-locking read of limit/usage, for settings, banner and import preview. */
export async function getWorkspaceCapacity(
  workspaceId: string
): Promise<WorkspaceCapacity> {
  const [ws] = await db
    .select({ maxTasks: workspace.maxTasks })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const limit = ws?.maxTasks ?? null;
  if (limit === null) {
    return { limit: null, used: 0, remaining: null };
  }
  const used = await getWorkspaceTaskUsage(workspaceId);
  return { limit, used, remaining: Math.max(0, limit - used) };
}

/**
 * The single gate every task-creating path must call, as the FIRST statement of
 * the transaction that inserts the task rows.
 *
 *  1. Locks the workspace row (`FOR UPDATE`) — every creator goes through this
 *     row, so the lock serializes check + seq reservation + insert.
 *  2. If a limit is set, counts task rows and rejects when `used + n > limit`
 *     (all-or-nothing for batches). No limit → the count query is skipped.
 *  3. Only after the check passes, reserves `n` sequence numbers.
 *
 * On rejection nothing is written, so no sequence numbers are burned.
 * On success returns `seqBase`: the new tasks get `seqBase + 1 … seqBase + n`.
 */
export async function requireTaskCapacity(
  tx: DbTransaction,
  workspaceId: string,
  n = 1
): Promise<
  TaskLimitError | { error: string; code?: undefined } | { seqBase: number }
> {
  const [ws] = await tx
    .select({ maxTasks: workspace.maxTasks, taskSeq: workspace.taskSeq })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .for("update");
  if (!ws) {
    return { error: "Workspace not found" };
  }

  if (ws.maxTasks !== null) {
    const used = await getWorkspaceTaskUsage(workspaceId, tx);
    if (used + n > ws.maxTasks) {
      return {
        error: taskLimitReachedMessage(ws.maxTasks),
        code: TASK_LIMIT_CODE,
      };
    }
  }

  await tx
    .update(workspace)
    .set({ taskSeq: sql`${workspace.taskSeq} + ${n}` })
    .where(eq(workspace.id, workspaceId));

  return { seqBase: ws.taskSeq };
}

// ── Member / guest limits ─────────────────────────────────────────────────

/**
 * Seats in use: ACTIVE rows plus *unexpired* pending invites (an invite reserves
 * a seat, so accepting it never needs a capacity check). Members = every role
 * except GUEST (OWNER/ADMIN/MEMBER); guests = GUEST.
 */
export async function getWorkspaceMemberUsage(
  workspaceId: string,
  tx?: DbTransaction
): Promise<{ members: number; guests: number }> {
  const client = tx ?? db;
  const [row] = await client
    .select({
      members: sql<number>`count(*) filter (where ${workspaceMember.role} <> 'GUEST')`,
      guests: sql<number>`count(*) filter (where ${workspaceMember.role} = 'GUEST')`,
    })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        or(
          eq(workspaceMember.status, "ACTIVE"),
          and(
            eq(workspaceMember.status, "INVITED"),
            or(
              isNull(workspaceMember.inviteExpiresAt),
              gt(workspaceMember.inviteExpiresAt, new Date())
            )
          )
        )
      )
    );
  return {
    members: Number(row?.members ?? 0),
    guests: Number(row?.guests ?? 0),
  };
}

export interface WorkspaceMemberCapacity {
  guests: WorkspaceCapacity;
  members: WorkspaceCapacity;
}

/** Non-locking read of both buckets, for the settings page and Members page. */
export async function getWorkspaceMemberCapacity(
  workspaceId: string
): Promise<WorkspaceMemberCapacity> {
  const [ws] = await db
    .select({
      maxMembers: workspace.maxMembers,
      maxGuests: workspace.maxGuests,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const usage = await getWorkspaceMemberUsage(workspaceId);
  const build = (limit: number | null, used: number): WorkspaceCapacity => ({
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
  });
  return {
    members: build(ws?.maxMembers ?? null, usage.members),
    guests: build(ws?.maxGuests ?? null, usage.guests),
  };
}

/**
 * Gate for every path that adds a seat: invite, join via link, reviving an
 * expired invite, and role changes into a different bucket. Call it as the
 * FIRST statement of the transaction that writes the member row — it locks the
 * workspace row (`FOR UPDATE`, the same row the task gate locks), counts only
 * if that bucket has a limit, and rejects when `used + n > limit`. Writes
 * nothing. Returns null when there is room.
 */
export async function requireMemberCapacity(
  tx: DbTransaction,
  workspaceId: string,
  bucket: MemberBucket,
  n = 1
): Promise<MemberLimitError | { error: string; code?: undefined } | null> {
  const [ws] = await tx
    .select({
      maxMembers: workspace.maxMembers,
      maxGuests: workspace.maxGuests,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .for("update");
  if (!ws) {
    return { error: "Workspace not found" };
  }

  const limit = bucket === "guests" ? ws.maxGuests : ws.maxMembers;
  if (limit === null) {
    return null;
  }

  const usage = await getWorkspaceMemberUsage(workspaceId, tx);
  const used = bucket === "guests" ? usage.guests : usage.members;
  if (used + n > limit) {
    return {
      error: memberLimitReachedMessage(bucket, limit),
      code: bucket === "guests" ? GUEST_LIMIT_CODE : MEMBER_LIMIT_CODE,
    };
  }
  return null;
}
