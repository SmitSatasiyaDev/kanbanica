"use server";

import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import {
  list,
  task,
  taskAssignee,
  taskWatcher,
  workspaceMember,
} from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  type BulkNotifyTaskInfo,
  createBulkNotifications,
} from "@/lib/notifications/create-bulk-notifications";
import {
  canAccessSpace,
  getSpacePermission,
  hasPermissionLevel,
  requireEditAccess,
} from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { webActor } from "@/lib/services/actor";
import {
  effectiveTaskSpaceId,
  resolveTaskContext,
  type TaskContext,
  taskRevalidatePaths,
} from "@/lib/services/task-context";
import { assignTask } from "@/lib/services/task-service";
import { notDeleted } from "@/lib/task-visibility";

// `taskId` lets an open task detail view skip refetching for other tasks. The
// location comes from the task's own context, and the refresh also runs for
// tasks that have no list.
function revalidateTask(ctx: TaskContext) {
  void refreshWorkspace(ctx.workspaceId, taskRevalidatePaths(ctx), {
    taskId: ctx.taskId,
  });
}

export async function addAssignee(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string,
  assigneeUserId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the task row.
  const res = await assignTask(webActor(session), taskId, {
    userId: assigneeUserId,
    returnAssignees: false,
  });
  if ("error" in res) {
    return { error: res.error };
  }
  return { ok: true };
}

export async function removeAssignee(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string,
  assigneeUserId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const res = await assignTask(webActor(session), taskId, {
    userId: assigneeUserId,
    unassign: true,
    returnAssignees: false,
  });
  if ("error" in res) {
    return { error: res.error };
  }
  return { ok: true };
}

export type BulkAssignMode = "replace" | "add";

// Bulk-assigns a set of workspace members to many tasks in one call. `replace`
// clears each task's existing assignees first; `add` keeps them and adds the
// new ones. Mirrors addAssignee/removeAssignee's notification + activity-log
// granularity (per task/user) but batches every DB write instead of looping
// per task, and wraps the assignee/watcher writes in one transaction.
export async function bulkAssignTasks(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  taskIds: string[],
  assigneeUserIds: string[],
  mode: BulkAssignMode
): Promise<{ ok: true; updated: number } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const permission = await getSpacePermission(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permission === null || !hasPermissionLevel(permission, "edit")) {
    return { error: "Forbidden" };
  }

  if (taskIds.length === 0) {
    return { ok: true, updated: 0 };
  }
  if (assigneeUserIds.length === 0) {
    return { error: "Select at least one member to assign" };
  }

  const uniqueAssigneeIds = [...new Set(assigneeUserIds)];

  // Verify every selected assignee is an active workspace member — one batch
  // query instead of one per user.
  const activeMembers = await db
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.status, "ACTIVE"),
        inArray(workspaceMember.userId, uniqueAssigneeIds)
      )
    );
  if (activeMembers.length !== uniqueAssigneeIds.length) {
    return {
      error: "One or more selected users are not active workspace members",
    };
  }

  // Scope to tasks that actually belong to this space — guards against
  // stale/foreign ids reaching this action.
  // The space is the list's space, falling back to the task's own column, so
  // tasks whose `space_id` is null (e.g. subtasks) are not missed.
  const validTasks = await db
    .select({ id: task.id, title: task.title })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .where(
      and(
        inArray(task.id, taskIds),
        eq(effectiveTaskSpaceId, spaceId),
        notDeleted()
      )
    );
  if (validTasks.length === 0) {
    return { ok: true, updated: 0 };
  }
  const validTaskIds = validTasks.map((t) => t.id);

  const existingAssignments = await db
    .select({ taskId: taskAssignee.taskId, userId: taskAssignee.userId })
    .from(taskAssignee)
    .where(inArray(taskAssignee.taskId, validTaskIds));
  const existingByTask = new Map<string, Set<string>>();
  for (const row of existingAssignments) {
    const set = existingByTask.get(row.taskId) ?? new Set<string>();
    set.add(row.userId);
    existingByTask.set(row.taskId, set);
  }

  const assigneeRows = validTaskIds.flatMap((taskId) =>
    uniqueAssigneeIds.map((userId) => ({ taskId, userId }))
  );

  await db.transaction(async (tx) => {
    if (mode === "replace") {
      await tx
        .delete(taskAssignee)
        .where(inArray(taskAssignee.taskId, validTaskIds));
    }
    await tx.insert(taskAssignee).values(assigneeRows).onConflictDoNothing();
    // Auto-watch newly assigned members — matches single-task addAssignee.
    await tx.insert(taskWatcher).values(assigneeRows).onConflictDoNothing();
    await tx
      .update(task)
      .set({ updatedAt: new Date() })
      .where(inArray(task.id, validTaskIds));
  });

  // Activity log stays best-effort and per task/user (same granularity as the
  // single-task actions above) — not part of the write transaction, which
  // only covers the core assignee/watcher mutation. Notifications are
  // collected here and sent grouped-per-recipient after the loop, so a
  // recipient added to/removed from several tasks gets one notification per
  // trigger type, not one per task.
  const actorName = session.user.name ?? session.user.email ?? "Someone";
  const assignedTasks: BulkNotifyTaskInfo<{ title: string }>[] = [];
  const unassignedTasks: BulkNotifyTaskInfo<{ title: string }>[] = [];
  for (const t of validTasks) {
    const previouslyAssigned = existingByTask.get(t.id) ?? new Set<string>();
    const added = uniqueAssigneeIds.filter((id) => !previouslyAssigned.has(id));
    const removed =
      mode === "replace"
        ? [...previouslyAssigned].filter(
            (id) => !uniqueAssigneeIds.includes(id)
          )
        : [];

    for (const userId of added) {
      await writeActivityLog(t.id, session.user.id, "assignee_added", {
        userId,
      });
    }
    for (const userId of removed) {
      await writeActivityLog(t.id, session.user.id, "assignee_removed", {
        userId,
      });
    }

    const notifyAdded = added.filter((id) => id !== session.user.id);
    if (notifyAdded.length > 0) {
      assignedTasks.push({
        taskId: t.id,
        recipientIds: notifyAdded,
        data: { title: t.title },
      });
    }
    const notifyRemoved = removed.filter((id) => id !== session.user.id);
    if (notifyRemoved.length > 0) {
      unassignedTasks.push({
        taskId: t.id,
        recipientIds: notifyRemoved,
        data: { title: t.title },
      });
    }
  }

  createBulkNotifications({
    workspaceId,
    actorId: session.user.id,
    triggerType: "task_assigned",
    entityType: "TASK",
    tasks: assignedTasks,
    buildMessage: ({ tasks: group }) =>
      group.length === 1
        ? { title: `${actorName} assigned you to "${group[0].data.title}"` }
        : {
            title: `${actorName} assigned you to ${group.length} tasks`,
            body:
              group
                .map((g) => g.data.title)
                .slice(0, 5)
                .join(", ") + (group.length > 5 ? "…" : ""),
          },
  });
  createBulkNotifications({
    workspaceId,
    actorId: session.user.id,
    triggerType: "task_unassigned",
    entityType: "TASK",
    tasks: unassignedTasks,
    buildMessage: ({ tasks: group }) =>
      group.length === 1
        ? { title: `You were unassigned from "${group[0].data.title}"` }
        : {
            title: `You were unassigned from ${group.length} tasks`,
            body:
              group
                .map((g) => g.data.title)
                .slice(0, 5)
                .join(", ") + (group.length > 5 ? "…" : ""),
          },
  });

  void refreshWorkspace(
    workspaceId,
    listId
      ? [`/${workspaceId}/${spaceId}/list/${listId}`]
      : [`/${workspaceId}/${spaceId}`, `/${workspaceId}`]
  );
  return { ok: true, updated: validTaskIds.length };
}

export async function addWatcher(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string,
  watcherUserId?: string // defaults to self
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the task row.
  const ctx = await resolveTaskContext(taskId);
  if (!ctx) {
    return { error: "Task not found" };
  }

  const accessible = await canAccessSpace(
    session.user.id,
    ctx.workspaceId,
    ctx.spaceId
  );
  if (!accessible) {
    return { error: "Unauthorized" };
  }

  const userId = watcherUserId ?? session.user.id;

  // Watching yourself needs View. Adding someone else needs Edit, and that
  // person must be able to see the task (watchers receive its notifications).
  if (userId !== session.user.id) {
    const editErr = await requireEditAccess(
      session.user.id,
      ctx.workspaceId,
      ctx.spaceId
    );
    if (editErr) {
      return editErr;
    }
    const targetCanAccess = await canAccessSpace(
      userId,
      ctx.workspaceId,
      ctx.spaceId
    );
    if (!targetCanAccess) {
      return { error: "User cannot access this task" };
    }
  }

  await db.insert(taskWatcher).values({ taskId, userId }).onConflictDoNothing();

  await writeActivityLog(taskId, session.user.id, "watcher_added", { userId });
  revalidateTask(ctx);
  return { ok: true };
}

export async function removeWatcher(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string,
  watcherUserId?: string // defaults to self
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the task row.
  const ctx = await resolveTaskContext(taskId);
  if (!ctx) {
    return { error: "Task not found" };
  }

  const accessible = await canAccessSpace(
    session.user.id,
    ctx.workspaceId,
    ctx.spaceId
  );
  if (!accessible) {
    return { error: "Unauthorized" };
  }

  const userId = watcherUserId ?? session.user.id;

  // Removing someone else needs Edit. The target is not required to still have
  // access, so a watcher who lost access can be cleaned up.
  if (userId !== session.user.id) {
    const editErr = await requireEditAccess(
      session.user.id,
      ctx.workspaceId,
      ctx.spaceId
    );
    if (editErr) {
      return editErr;
    }
  }

  await db
    .delete(taskWatcher)
    .where(and(eq(taskWatcher.taskId, taskId), eq(taskWatcher.userId, userId)));

  await writeActivityLog(taskId, session.user.id, "watcher_removed", {
    userId,
  });
  revalidateTask(ctx);
  return { ok: true };
}

export async function toggleWatcher(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string
): Promise<{ watching: boolean } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the task row.
  const ctx = await resolveTaskContext(taskId);
  if (!ctx) {
    return { error: "Task not found" };
  }

  const accessible = await canAccessSpace(
    session.user.id,
    ctx.workspaceId,
    ctx.spaceId
  );
  if (!accessible) {
    return { error: "Unauthorized" };
  }

  const [existing] = await db
    .select({ taskId: taskWatcher.taskId })
    .from(taskWatcher)
    .where(
      and(
        eq(taskWatcher.taskId, taskId),
        eq(taskWatcher.userId, session.user.id)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .delete(taskWatcher)
      .where(
        and(
          eq(taskWatcher.taskId, taskId),
          eq(taskWatcher.userId, session.user.id)
        )
      );
    revalidateTask(ctx);
    return { watching: false };
  }
  await db
    .insert(taskWatcher)
    .values({ taskId, userId: session.user.id })
    .onConflictDoNothing();
  revalidateTask(ctx);
  return { watching: true };
}
