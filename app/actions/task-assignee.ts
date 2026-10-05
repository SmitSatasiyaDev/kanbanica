"use server";

import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import {
  task,
  taskAssignee,
  taskWatcher,
  user,
  workspaceMember,
} from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  type BulkNotifyTaskInfo,
  createBulkNotifications,
} from "@/lib/notifications/create-bulk-notifications";
import { createNotifications } from "@/lib/notifications/create-notification";
import {
  canAccessSpace,
  getSpacePermission,
  getWorkspaceMembership,
  hasPermissionLevel,
} from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { notDeleted } from "@/lib/task-visibility";

// `taskId` lets an open task detail view skip refetching for other tasks.
function revalidateTask(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId?: string
) {
  void refreshWorkspace(
    workspaceId,
    [`/${workspaceId}/${spaceId}/list/${listId}`],
    { taskId }
  );
}

export async function addAssignee(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  taskId: string,
  assigneeUserId: string
): Promise<{ ok: true } | { error: string }> {
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

  // Verify assignee is active in workspace
  const assigneeMembership = await getWorkspaceMembership(
    assigneeUserId,
    workspaceId
  );
  if (assigneeMembership?.status !== "ACTIVE") {
    return { error: "User is not an active workspace member" };
  }

  await db
    .insert(taskAssignee)
    .values({ taskId, userId: assigneeUserId })
    .onConflictDoNothing();

  // Auto-watch assignee
  await db
    .insert(taskWatcher)
    .values({ taskId, userId: assigneeUserId })
    .onConflictDoNothing();

  // Notify the assignee (skip if assigning to yourself)
  if (assigneeUserId !== session.user.id) {
    const [taskRow] = await db
      .select({ title: task.title })
      .from(task)
      .where(and(eq(task.id, taskId), notDeleted()))
      .limit(1);

    if (taskRow) {
      const actorName = session.user.name ?? session.user.email ?? "Someone";
      createNotifications({
        workspaceId,
        actorId: session.user.id,
        recipientIds: [assigneeUserId],
        triggerType: "task_assigned",
        entityType: "TASK",
        entityId: taskId,
        title: `${actorName} assigned you to "${taskRow.title}"`,
        muteCheckEntityIds: [taskId],
      });
    }
  }

  const [assigneeUser] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, assigneeUserId))
    .limit(1);
  await writeActivityLog(taskId, session.user.id, "assignee_added", {
    userId: assigneeUserId,
    user_name: assigneeUser?.name ?? assigneeUser?.email ?? "someone",
  });
  if (listId) {
    revalidateTask(workspaceId, spaceId, listId, taskId);
  }
  return { ok: true };
}

export async function removeAssignee(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  taskId: string,
  assigneeUserId: string
): Promise<{ ok: true } | { error: string }> {
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

  await db
    .delete(taskAssignee)
    .where(
      and(
        eq(taskAssignee.taskId, taskId),
        eq(taskAssignee.userId, assigneeUserId)
      )
    );

  const [removedUser] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, assigneeUserId))
    .limit(1);
  await writeActivityLog(taskId, session.user.id, "assignee_removed", {
    userId: assigneeUserId,
    user_name: removedUser?.name ?? removedUser?.email ?? "someone",
  });

  if (assigneeUserId !== session.user.id) {
    const [taskRow] = await db
      .select({ title: task.title })
      .from(task)
      .where(and(eq(task.id, taskId), notDeleted()))
      .limit(1);
    if (taskRow) {
      createNotifications({
        workspaceId,
        actorId: session.user.id,
        recipientIds: [assigneeUserId],
        triggerType: "task_unassigned",
        entityType: "TASK",
        entityId: taskId,
        title: `You were unassigned from "${taskRow.title}"`,
        muteCheckEntityIds: [taskId],
      });
    }
  }

  if (listId) {
    revalidateTask(workspaceId, spaceId, listId, taskId);
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
  const validTasks = await db
    .select({ id: task.id, title: task.title })
    .from(task)
    .where(
      and(inArray(task.id, taskIds), eq(task.spaceId, spaceId), notDeleted())
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

  if (listId) {
    revalidateTask(workspaceId, spaceId, listId);
  } else {
    void refreshWorkspace(workspaceId, [
      `/${workspaceId}/${spaceId}`,
      `/${workspaceId}`,
    ]);
  }
  return { ok: true, updated: validTaskIds.length };
}

export async function addWatcher(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  watcherUserId?: string // defaults to self
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessible = await canAccessSpace(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!accessible) {
    return { error: "Unauthorized" };
  }

  const userId = watcherUserId ?? session.user.id;

  await db.insert(taskWatcher).values({ taskId, userId }).onConflictDoNothing();

  await writeActivityLog(taskId, session.user.id, "watcher_added", { userId });
  revalidateTask(workspaceId, spaceId, listId, taskId);
  return { ok: true };
}

export async function removeWatcher(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  watcherUserId?: string // defaults to self
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessible = await canAccessSpace(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!accessible) {
    return { error: "Unauthorized" };
  }

  const userId = watcherUserId ?? session.user.id;

  await db
    .delete(taskWatcher)
    .where(and(eq(taskWatcher.taskId, taskId), eq(taskWatcher.userId, userId)));

  await writeActivityLog(taskId, session.user.id, "watcher_removed", {
    userId,
  });
  revalidateTask(workspaceId, spaceId, listId, taskId);
  return { ok: true };
}

export async function toggleWatcher(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string
): Promise<{ watching: boolean } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessible = await canAccessSpace(
    session.user.id,
    workspaceId,
    spaceId
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
    revalidateTask(workspaceId, spaceId, listId, taskId);
    return { watching: false };
  }
  await db
    .insert(taskWatcher)
    .values({ taskId, userId: session.user.id })
    .onConflictDoNothing();
  revalidateTask(workspaceId, spaceId, listId, taskId);
  return { watching: true };
}
