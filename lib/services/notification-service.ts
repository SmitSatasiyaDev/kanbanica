import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { list, notification, sprint, task } from "@/db/schema";
import { db } from "@/lib/db";
import { getAccessibleSpaceIds } from "@/lib/permissions";
import { type Actor, READ_ONLY_ERROR } from "@/lib/services/actor";
import {
  encodeCursor,
  INVALID_CURSOR_ERROR,
  pageOf,
  readCursor,
} from "@/lib/services/cursor";
import {
  allowedWorkspaces,
  effectiveTaskSpaceId,
} from "@/lib/services/task-context";
import { notDeleted } from "@/lib/task-visibility";

export type NotificationServiceError = { error: string };

export const DEFAULT_NOTIFICATION_LIMIT = 50;
export const MAX_NOTIFICATION_LIMIT = 200;
export const MAX_MARK_IDS = 200;

export type NotificationItem = {
  id: string;
  triggerType: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: Date;
  workspaceId: string;
  // Set for notifications about a task the actor can still open.
  task: { id: string; seqNumber: number } | null;
};

// The actor's own notifications, newest first. Only the actor's: the recipient
// is always the actor. Besides that:
//   * the token's workspace restriction applies, and so does the guest rule;
//   * a notification about a task is hidden once the task is trashed or the
//     actor can no longer see its project, so titles do not outlive access;
//   * channel messages are not exposed over MCP.
export async function listNotifications(
  actor: Actor,
  opts: {
    unreadOnly?: boolean;
    workspaceId?: string;
    cursor?: string;
    limit?: number;
  } = {}
): Promise<
  | { ok: true; items: NotificationItem[]; nextCursor: string | null }
  | NotificationServiceError
> {
  const after = opts.cursor ? readCursor("notifications", opts.cursor) : null;
  if (opts.cursor && !after) {
    return { error: INVALID_CURSOR_ERROR };
  }
  const workspaces = await allowedWorkspaces(actor, opts.workspaceId);
  if (workspaces.length === 0) {
    return { ok: true, items: [], nextCursor: null };
  }
  const workspaceIds = workspaces.map((w) => w.workspaceId);

  const spaceLists = await Promise.all(
    workspaceIds.map((id) => getAccessibleSpaceIds(actor.userId, id))
  );
  const spaceIds = [...new Set(spaceLists.flat())];

  const visible: SQL[] = [eq(notification.entityType, "WORKSPACE")];
  if (spaceIds.length > 0) {
    const taskVisible = and(
      eq(notification.entityType, "TASK"),
      isNotNull(task.id),
      notDeleted(),
      inArray(effectiveTaskSpaceId, spaceIds)
    );
    const spaceVisible = and(
      eq(notification.entityType, "SPACE"),
      inArray(notification.entityId, spaceIds)
    );
    const sprintVisible = and(
      eq(notification.entityType, "SPRINT"),
      inArray(sprint.spaceId, spaceIds)
    );
    for (const part of [taskVisible, spaceVisible, sprintVisible]) {
      if (part) {
        visible.push(part);
      }
    }
  }

  const conditions: SQL[] = [
    eq(notification.recipientId, actor.userId),
    inArray(notification.workspaceId, workspaceIds),
  ];
  const anyVisible = or(...visible);
  if (anyVisible) {
    conditions.push(anyVisible);
  }
  if (opts.unreadOnly ?? true) {
    conditions.push(eq(notification.isRead, false));
  }
  if (after) {
    conditions.push(
      sql`(${notification.createdAt}, ${notification.id}) < (${after.c}::timestamptz, ${after.i})`
    );
  }

  const limit = Math.min(
    Math.max(Math.floor(opts.limit ?? DEFAULT_NOTIFICATION_LIMIT), 1),
    MAX_NOTIFICATION_LIMIT
  );
  const rows = await db
    .select({
      id: notification.id,
      triggerType: notification.triggerType,
      title: notification.title,
      body: notification.body,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
      createdKey: sql<string>`${notification.createdAt}::text`,
      workspaceId: notification.workspaceId,
      entityType: notification.entityType,
      taskId: task.id,
      taskSeq: task.seqNumber,
    })
    .from(notification)
    .leftJoin(
      task,
      and(
        eq(notification.entityType, "TASK"),
        eq(task.id, notification.entityId)
      )
    )
    .leftJoin(list, eq(task.listId, list.id))
    .leftJoin(
      sprint,
      and(
        eq(notification.entityType, "SPRINT"),
        eq(sprint.id, notification.entityId)
      )
    )
    .where(and(...conditions))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(limit + 1);

  const { items, hasMore } = pageOf(rows, limit);
  const last = items[items.length - 1];
  return {
    ok: true,
    items: items.map((r) => ({
      id: r.id,
      triggerType: r.triggerType,
      title: r.title,
      body: r.body,
      isRead: r.isRead,
      createdAt: r.createdAt,
      workspaceId: r.workspaceId,
      task:
        r.entityType === "TASK" && r.taskId && r.taskSeq !== null
          ? { id: r.taskId, seqNumber: r.taskSeq }
          : null,
    })),
    nextCursor:
      hasMore && last
        ? encodeCursor("notifications", { c: last.createdKey, i: last.id })
        : null,
  };
}

// Marks some or all of the actor's own unread notifications as read. Never
// touches anyone else's. Not a task change, so (like the web endpoints) it
// does not broadcast a workspace refresh.
export async function markNotificationsRead(
  actor: Actor,
  opts: { ids?: string[]; all?: boolean; workspaceId?: string }
): Promise<{ ok: true; marked: number } | NotificationServiceError> {
  if (actor.scope === "read") {
    return { error: READ_ONLY_ERROR };
  }
  const ids = [...new Set(opts.ids ?? [])];
  if (ids.length > MAX_MARK_IDS) {
    return { error: `Pass at most ${MAX_MARK_IDS} ids at a time.` };
  }
  if (ids.length === 0 && !opts.all) {
    return { error: "Provide ids, or all: true." };
  }

  const workspaces = await allowedWorkspaces(actor, opts.workspaceId);
  if (workspaces.length === 0) {
    return { ok: true, marked: 0 };
  }

  const conditions: SQL[] = [
    eq(notification.recipientId, actor.userId),
    eq(notification.isRead, false),
    inArray(
      notification.workspaceId,
      workspaces.map((w) => w.workspaceId)
    ),
  ];
  if (ids.length > 0) {
    conditions.push(inArray(notification.id, ids));
  }
  const updated = await db
    .update(notification)
    .set({ isRead: true, readAt: new Date() })
    .where(and(...conditions))
    .returning({ id: notification.id });
  return { ok: true, marked: updated.length };
}
