"use server";

import { createId } from "@paralleldrive/cuid2";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
} from "drizzle-orm";
import { headers } from "next/headers";
import {
  activityLog,
  checklist,
  checklistItem,
  list,
  listStatus,
  space,
  sprint,
  task,
  taskAssignee,
  taskDependency,
  taskSprint,
  taskTag,
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
  getSpacePermission,
  hasPermissionLevel,
  requireEditAccess,
  requireViewAccess,
} from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { webActor } from "@/lib/services/actor";
import {
  effectiveTaskSpaceId,
  resolveTaskContext,
} from "@/lib/services/task-context";
import {
  assigneeAndWatcherIds,
  createSubtask as createSubtaskCore,
  createTask as createTaskCore,
  loadTaskDetail,
  setTaskStatus,
  updateTask as updateTaskCore,
} from "@/lib/services/task-service";
import { notDeleted } from "@/lib/task-visibility";
import { softDeleteTasks } from "@/lib/trash";
import { requireTaskCapacity } from "@/lib/workspace-limits";

// ─── Permission helpers ──────────────────────────────────────────────────────
// `requireEditAccess` / `requireViewAccess` now live in `lib/permissions.ts`
// (shared with the time-tracking actions).

// Requires "full_access" permission — delete task, etc.
async function requireFullAccess(
  userId: string,
  workspaceId: string,
  spaceId: string
): Promise<{ error: string } | null> {
  const permission = await getSpacePermission(userId, workspaceId, spaceId);
  if (permission === null) {
    return { error: "Forbidden" };
  }
  if (!hasPermissionLevel(permission, "full_access")) {
    return { error: "Forbidden" };
  }
  return null;
}

// ─── Revalidation helper ─────────────────────────────────────────────────────

// `taskId` (optional) lets an open task detail view skip refetching when the
// change belongs to a different task. Omit it for changes that could affect any
// view — subscribers then refetch (the safe default).
function revalidateList(
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

function revalidateSpace(
  workspaceId: string,
  spaceId: string,
  taskId?: string
) {
  void refreshWorkspace(
    workspaceId,
    [`/${workspaceId}/${spaceId}`, `/${workspaceId}`],
    { taskId }
  );
}

// ─── Create Task ─────────────────────────────────────────────────────────────

export async function createTask(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  data: {
    title: string;
    statusId?: string;
    priority?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    description?: unknown;
    dueDateStart?: string | null;
    dueDateEnd?: string | null;
    assigneeIds?: string[];
    tagIds?: string[];
  }
): Promise<{ taskId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The rules (access, title, dates, task limit, notifications) live in the
  // shared service, which the MCP endpoint uses too.
  return createTaskCore(webActor(session), {
    ...data,
    workspaceId,
    spaceId,
    listId,
  });
}

// ─── Get task detail ─────────────────────────────────────────────────────────

export async function getTaskDetail(
  _workspaceId: string,
  _spaceId: string,
  taskId: string
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space are ignored: the real location comes from
  // the task row, so access to one project never opens a task in another.
  const detail = await loadTaskDetail(webActor(session), taskId);
  if ("error" in detail) {
    return { error: detail.error };
  }
  const { ok: _ok, ...rest } = detail;
  return { ...rest, currentUserId: session.user.id };
}

// ─── Get workspace members (for assignee picker) ──────────────────────────────

export async function getWorkspaceMembers(workspaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const members = await db
    .select({
      userId: workspaceMember.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.status, "ACTIVE")
      )
    )
    .orderBy(asc(user.name));

  return { members };
}

// ─── Update task (title, priority, description, due dates) ───────────────────

export async function updateTask(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string,
  data: {
    title?: string;
    priority?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    description?: unknown;
    dueDateStart?: string | null;
    dueDateEnd?: string | null;
    timeEstimate?: number | null;
  }
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the task row (open panels can hold stale ids after a move).
  return updateTaskCore(webActor(session), taskId, data);
}

// ─── Update task status ───────────────────────────────────────────────────────

export async function updateTaskStatus(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string,
  statusId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the task row (open panels can hold stale ids after a move). Any status
  // of a list in the task's own space is accepted (Sprint board).
  const res = await setTaskStatus(webActor(session), taskId, statusId, {
    sameListOnly: false,
  });
  if ("error" in res) {
    return { error: res.error };
  }
  return { ok: true };
}

// ─── Delete task ──────────────────────────────────────────────────────────────

export async function deleteTask(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the task row (open panels can hold stale ids after a move).
  const ctx = await resolveTaskContext(taskId);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId, listId } = ctx;

  const permErr = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return { error: "You don't have permission to delete tasks" };
  }

  // Soft delete: the task moves to Trash (Trash) and can be
  // restored. Notify assignees + watchers that the task was deleted.
  const [delAssignees, delWatchers] = await Promise.all([
    db
      .select({ userId: taskAssignee.userId })
      .from(taskAssignee)
      .where(eq(taskAssignee.taskId, taskId)),
    db
      .select({ userId: taskWatcher.userId })
      .from(taskWatcher)
      .where(eq(taskWatcher.taskId, taskId)),
  ]);
  const deleteRecipientIds = [
    ...new Set([...delAssignees, ...delWatchers].map((r) => r.userId)),
  ];

  // Attachment files stay in storage while the task is in the Trash; they are
  // removed only on permanent delete (lib/trash.ts → purgeTasks).
  const { parentIds, subtaskIds } = await softDeleteTasks(
    [taskId],
    session.user.id
  );
  if (parentIds.length === 0) {
    return { error: "Task not found" };
  }
  await writeActivityLog(taskId, session.user.id, "task_deleted", {
    subtasks: subtaskIds.length,
  });

  // Notify assignees + watchers (actor auto-excluded). The task is in the Trash,
  // so the inbox shows an info toast on click (see getNotificationTarget) and the
  // push click points at the list/workspace instead of a task page.
  if (deleteRecipientIds.length > 0) {
    const actorName = session.user.name ?? session.user.email ?? "Someone";
    const taskTitle = ctx.title;
    createNotifications({
      workspaceId,
      actorId: session.user.id,
      recipientIds: deleteRecipientIds,
      triggerType: "task_deleted",
      entityType: "TASK",
      entityId: taskId,
      title: `${actorName} deleted task "${taskTitle}"`,
      muteCheckEntityIds: [taskId],
      pushTitle: taskTitle,
      pushBody: `${actorName} deleted this task`,
      pushUrl: listId
        ? `/${workspaceId}/${spaceId}/list/${listId}`
        : `/${workspaceId}`,
    });
  }

  if (listId) {
    revalidateList(workspaceId, spaceId, listId, taskId);
  } else {
    revalidateSpace(workspaceId, spaceId, taskId);
  }
  return { ok: true };
}

// ─── Archive / Unarchive task ─────────────────────────────────────────────────

export async function archiveTask(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the task row (open panels can hold stale ids after a move).
  const ctx = await resolveTaskContext(taskId);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId, listId } = ctx;

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  await db
    .update(task)
    .set({
      isArchived: true,
      archivedAt: new Date(),
      isPinnedToList: false,
      pinnedToListBy: null,
      pinnedToListAt: null,
      pinnedToListOrder: null,
      updatedAt: new Date(),
    })
    .where(and(eq(task.id, taskId), notDeleted()));

  await writeActivityLog(taskId, session.user.id, "task_archived");
  if (listId) {
    revalidateList(workspaceId, spaceId, listId, taskId);
  } else {
    revalidateSpace(workspaceId, spaceId, taskId);
  }
  return { ok: true };
}

export async function unarchiveTask(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the task row (open panels can hold stale ids after a move).
  const ctx = await resolveTaskContext(taskId);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId, listId } = ctx;

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  await db
    .update(task)
    .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
    .where(and(eq(task.id, taskId), notDeleted()));

  await writeActivityLog(taskId, session.user.id, "task_unarchived");
  if (listId) {
    revalidateList(workspaceId, spaceId, listId, taskId);
  } else {
    revalidateSpace(workspaceId, spaceId, taskId);
  }
  return { ok: true };
}

// ─── Duplicate task ───────────────────────────────────────────────────────────

export async function duplicateTask(
  workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string
): Promise<{ taskId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // Load the source first: its own list decides which space the permission
  // check runs against, not the space the caller sent. The list is LEFT joined
  // because Sprint tasks have none.
  const [sourceRow] = await db
    .select({ ...getTableColumns(task), listSpaceId: list.spaceId })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .where(and(eq(task.id, taskId), notDeleted()))
    .limit(1);
  // Tasks never change workspace, so a different workspace id from the caller
  // means a foreign task (its task limit is checked below).
  if (!sourceRow || sourceRow.workspaceId !== workspaceId) {
    return { error: "Task not found" };
  }
  const { listSpaceId, ...original } = sourceRow;
  const spaceId =
    listSpaceId ??
    original.spaceId ??
    (await resolveTaskContext(taskId))?.spaceId;
  if (!spaceId) {
    return { error: "Task not found" };
  }

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  // The copy lives in the same list as the original.
  const targetListId = original.listId;

  // Subtasks (one level deep — nesting beyond that is disallowed) come along as
  // fresh tasks. Archived subtasks are left behind (the copy starts clean).
  const subtasks = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.parentTaskId, taskId),
        eq(task.isArchived, false),
        notDeleted()
      )
    )
    .orderBy(asc(task.orderIndex));

  const sources = [original, ...subtasks];
  const oldIds = sources.map((t) => t.id);

  // Place the copy immediately below the original within its status group: the
  // midpoint between the original and the next top-level sibling (or a full step
  // past the original when it's last).
  const [nextSibling] = await db
    .select({ orderIndex: task.orderIndex })
    .from(task)
    .where(
      and(
        targetListId ? eq(task.listId, targetListId) : isNull(task.listId),
        isNull(task.parentTaskId),
        eq(task.isArchived, false),
        notDeleted(),
        original.statusId
          ? eq(task.statusId, original.statusId)
          : isNull(task.statusId),
        gt(task.orderIndex, original.orderIndex)
      )
    )
    .orderBy(asc(task.orderIndex))
    .limit(1);
  const parentOrderIndex = nextSibling
    ? Math.floor((original.orderIndex + nextSibling.orderIndex) / 2)
    : original.orderIndex + 1000;

  const newTaskId = createId();

  const duplicated = await db.transaction(async (tx) => {
    // Task-limit gate for the whole copy (parent + subtasks, all-or-nothing),
    // then a contiguous block of seq numbers in one atomic bump.
    const capacity = await requireTaskCapacity(tx, workspaceId, sources.length);
    if ("error" in capacity) {
      return capacity;
    }
    const seqBase = capacity.seqBase;

    const taskMap = new Map<string, string>();
    taskMap.set(original.id, newTaskId);
    for (const st of subtasks) {
      taskMap.set(st.id, createId());
    }

    await tx.insert(task).values(
      sources.map((t, i) => {
        const isParent = t.id === original.id;
        return {
          id: taskMap.get(t.id)!,
          seqNumber: seqBase + i + 1,
          workspaceId,
          spaceId: t.spaceId,
          listId: targetListId,
          parentTaskId: isParent ? null : newTaskId,
          statusId: t.statusId,
          title: isParent ? `${t.title} (Copy)` : t.title,
          description: t.description,
          priority: t.priority,
          reporterId: isParent ? session.user.id : t.reporterId,
          dueDateStart: t.dueDateStart,
          dueDateEnd: t.dueDateEnd,
          orderIndex: isParent ? parentOrderIndex : t.orderIndex,
        };
      })
    );

    // Assignees
    const assignees = await tx
      .select()
      .from(taskAssignee)
      .where(inArray(taskAssignee.taskId, oldIds));
    if (assignees.length > 0) {
      await tx.insert(taskAssignee).values(
        assignees.map((a) => ({
          taskId: taskMap.get(a.taskId)!,
          userId: a.userId,
        }))
      );
    }

    // Watchers (preserve watch state)
    const watchers = await tx
      .select()
      .from(taskWatcher)
      .where(inArray(taskWatcher.taskId, oldIds));
    if (watchers.length > 0) {
      await tx.insert(taskWatcher).values(
        watchers.map((w) => ({
          taskId: taskMap.get(w.taskId)!,
          userId: w.userId,
        }))
      );
    }

    // Tags (workspace-scoped — reuse the same tagId)
    const tags = await tx
      .select()
      .from(taskTag)
      .where(inArray(taskTag.taskId, oldIds));
    if (tags.length > 0) {
      await tx.insert(taskTag).values(
        tags.map((tg) => ({
          taskId: taskMap.get(tg.taskId)!,
          tagId: tg.tagId,
        }))
      );
    }

    // Checklists + items (preserve checked state)
    const checklists = await tx
      .select()
      .from(checklist)
      .where(inArray(checklist.taskId, oldIds))
      .orderBy(asc(checklist.orderIndex));
    if (checklists.length > 0) {
      const checklistMap = new Map<string, string>();
      await tx.insert(checklist).values(
        checklists.map((cl) => {
          const id = createId();
          checklistMap.set(cl.id, id);
          return {
            id,
            taskId: taskMap.get(cl.taskId)!,
            name: cl.name,
            orderIndex: cl.orderIndex,
          };
        })
      );

      const items = await tx
        .select()
        .from(checklistItem)
        .where(
          inArray(
            checklistItem.checklistId,
            checklists.map((cl) => cl.id)
          )
        )
        .orderBy(asc(checklistItem.orderIndex));
      if (items.length > 0) {
        await tx.insert(checklistItem).values(
          items.map((item) => ({
            id: createId(),
            checklistId: checklistMap.get(item.checklistId)!,
            title: item.title,
            isChecked: item.isChecked,
            checkedBy: item.checkedBy,
            checkedAt: item.checkedAt,
            orderIndex: item.orderIndex,
          }))
        );
      }
    }

    // Dependencies — outgoing edges of the duplicated tasks. Internal edges (both
    // endpoints duplicated) are remapped to the new tasks; edges to outside tasks
    // are kept only when that task still exists.
    const deps = await tx
      .select()
      .from(taskDependency)
      .where(inArray(taskDependency.taskId, oldIds));
    if (deps.length > 0) {
      const externalTargets = [
        ...new Set(
          deps.map((d) => d.dependsOnTaskId).filter((id) => !taskMap.has(id))
        ),
      ];
      const existing =
        externalTargets.length > 0
          ? new Set(
              (
                await tx
                  .select({ id: task.id })
                  .from(task)
                  .where(
                    and(
                      inArray(task.id, externalTargets),
                      eq(task.workspaceId, workspaceId),
                      notDeleted()
                    )
                  )
              ).map((r) => r.id)
            )
          : new Set<string>();

      const depRows = deps
        .map((d) => {
          const dependsOnTaskId = taskMap.has(d.dependsOnTaskId)
            ? taskMap.get(d.dependsOnTaskId)!
            : existing.has(d.dependsOnTaskId)
              ? d.dependsOnTaskId
              : null;
          if (!dependsOnTaskId) {
            return null;
          }
          return {
            id: createId(),
            taskId: taskMap.get(d.taskId)!,
            dependsOnTaskId,
            type: d.type,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (depRows.length > 0) {
        await tx.insert(taskDependency).values(depRows);
      }
    }
    return null;
  });
  if (duplicated) {
    return duplicated;
  }

  // Fresh, clean history — a single "duplicated from #<seq>" entry, no replay.
  await writeActivityLog(newTaskId, session.user.id, "task_duplicated", {
    from_task_id: original.id,
    from_seq: original.seqNumber,
  });

  if (targetListId) {
    revalidateList(workspaceId, spaceId, targetListId, taskId);
  } else {
    revalidateSpace(workspaceId, spaceId, taskId);
  }
  return { taskId: newTaskId };
}

// ─── Move task ────────────────────────────────────────────────────────────────

// Validates the list a task is being moved INTO. It must exist, be active, sit
// in an active project of the same workspace as the task, and the user needs
// Edit on that target project too (not just on the source).
async function resolveMoveTarget(
  userId: string,
  workspaceId: string,
  targetListId: string
): Promise<{ spaceId: string } | { error: string }> {
  const [target] = await db
    .select({
      spaceId: list.spaceId,
      listArchived: list.isArchived,
      spaceArchived: space.isArchived,
      spaceWorkspaceId: space.workspaceId,
    })
    .from(list)
    .innerJoin(space, eq(list.spaceId, space.id))
    .where(eq(list.id, targetListId))
    .limit(1);
  if (
    !target ||
    target.listArchived ||
    target.spaceArchived ||
    target.spaceWorkspaceId !== workspaceId
  ) {
    return { error: "List not found" };
  }
  const err = await requireEditAccess(userId, workspaceId, target.spaceId);
  if (err) {
    return err;
  }
  return { spaceId: target.spaceId };
}

export async function moveTask(
  _workspaceId: string,
  _spaceId: string,
  taskId: string,
  targetListId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The source side comes from the task row, not from the caller's ids. Edit
  // permission is checked on the space the task is really in.
  const ctx = await resolveTaskContext(taskId);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId } = ctx;
  const t = { listId: ctx.listId, statusId: ctx.statusId };

  const permErr = await requireEditAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return permErr;
  }

  const target = await resolveMoveTarget(
    session.user.id,
    workspaceId,
    targetListId
  );
  if ("error" in target) {
    return target;
  }

  // Find matching status in target list by name
  const [currentStatus] = t.statusId
    ? await db
        .select({ name: listStatus.name })
        .from(listStatus)
        .where(eq(listStatus.id, t.statusId))
        .limit(1)
    : [];

  let newStatusId: string;
  if (currentStatus) {
    const [match] = await db
      .select({ id: listStatus.id })
      .from(listStatus)
      .where(
        and(
          eq(listStatus.listId, targetListId),
          eq(listStatus.name, currentStatus.name)
        )
      )
      .limit(1);

    if (match) {
      newStatusId = match.id;
    } else {
      const [firstOpen] = await db
        .select({ id: listStatus.id })
        .from(listStatus)
        .where(
          and(eq(listStatus.listId, targetListId), eq(listStatus.type, "OPEN"))
        )
        .orderBy(asc(listStatus.orderIndex))
        .limit(1);
      if (!firstOpen) {
        return { error: "Target list has no statuses" };
      }
      newStatusId = firstOpen.id;
    }
  } else {
    // Task has no current status — use the first OPEN status in the target list
    const [firstOpen] = await db
      .select({ id: listStatus.id })
      .from(listStatus)
      .where(
        and(eq(listStatus.listId, targetListId), eq(listStatus.type, "OPEN"))
      )
      .orderBy(asc(listStatus.orderIndex))
      .limit(1);
    if (!firstOpen) {
      return { error: "Target list has no statuses" };
    }
    newStatusId = firstOpen.id;
  }

  await db
    .update(task)
    .set({
      listId: targetListId,
      // Keep the task's own space column in step with the list it now lives in.
      spaceId: target.spaceId,
      statusId: newStatusId,
      isPinnedToList: false,
      pinnedToListBy: null,
      pinnedToListAt: null,
      pinnedToListOrder: null,
      updatedAt: new Date(),
    })
    .where(eq(task.id, taskId));

  await writeActivityLog(taskId, session.user.id, "task_moved", {
    fromListId: t.listId,
    toListId: targetListId,
  });

  // Notify assignees + watchers of the move, with old → new list names.
  const moveRecipientIds = await assigneeAndWatcherIds(taskId);
  if (moveRecipientIds.length > 0) {
    const [[taskRow], fromList, [toList]] = await Promise.all([
      db
        .select({ title: task.title })
        .from(task)
        .where(eq(task.id, taskId))
        .limit(1),
      t.listId
        ? db
            .select({ name: list.name })
            .from(list)
            .where(eq(list.id, t.listId))
            .limit(1)
        : Promise.resolve([] as { name: string }[]),
      db
        .select({ name: list.name })
        .from(list)
        .where(eq(list.id, targetListId))
        .limit(1),
    ]);
    const actorName = session.user.name ?? session.user.email ?? "Someone";
    const taskTitle = taskRow?.title ?? "a task";
    const toName = toList?.name ?? "another list";
    const fromName = fromList[0]?.name;
    createNotifications({
      workspaceId,
      actorId: session.user.id,
      recipientIds: moveRecipientIds,
      triggerType: "task_moved",
      entityType: "TASK",
      entityId: taskId,
      title: fromName
        ? `${actorName} moved "${taskTitle}" from ${fromName} to ${toName}`
        : `${actorName} moved "${taskTitle}" to ${toName}`,
      muteCheckEntityIds: [taskId],
    });
  }

  void refreshWorkspace(workspaceId, undefined, { taskId });
  return { ok: true };
}

// ─── Get task activity ────────────────────────────────────────────────────────

export async function getTaskActivity(
  _workspaceId: string,
  _spaceId: string,
  taskId: string
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // Access is checked against the space the task is really in.
  const ctx = await resolveTaskContext(taskId);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId } = ctx;

  const permErr = await requireViewAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return permErr;
  }

  const logs = await db
    .select({
      id: activityLog.id,
      eventType: activityLog.eventType,
      meta: activityLog.meta,
      createdAt: activityLog.createdAt,
      userId: activityLog.userId,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(activityLog)
    .leftJoin(user, eq(user.id, activityLog.userId))
    .where(eq(activityLog.taskId, taskId))
    .orderBy(desc(activityLog.createdAt))
    .limit(50);

  return {
    logs: logs.map((l) => ({
      ...l,
      name: l.name ?? "Deleted User",
      email: l.email ?? null,
      image: l.image ?? null,
    })),
  };
}

// ─── Create subtask ──────────────────────────────────────────────────────────

export async function createSubtask(
  workspaceId: string,
  _spaceId: string,
  parentTaskId: string,
  title: string
): Promise<{ taskId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The parent's own list decides the project; the caller's space is ignored.
  return createSubtaskCore(webActor(session), {
    parentTaskId,
    workspaceId,
    title,
  });
}

// ─── Get subtasks ─────────────────────────────────────────────────────────────

export async function getSubtasks(
  _workspaceId: string,
  _spaceId: string,
  parentTaskId: string
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // Access is checked against the space the parent task is really in.
  const ctx = await resolveTaskContext(parentTaskId);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId } = ctx;

  const permErr = await requireViewAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return permErr;
  }

  const subtasks = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      priority: task.priority,
      statusId: task.statusId,
      orderIndex: task.orderIndex,
      statusName: listStatus.name,
      statusColor: listStatus.color,
      statusType: listStatus.type,
    })
    .from(task)
    .leftJoin(listStatus, eq(listStatus.id, task.statusId))
    .where(
      and(
        eq(task.parentTaskId, parentTaskId),
        eq(task.isArchived, false),
        notDeleted()
      )
    )
    .orderBy(asc(task.orderIndex));

  return { subtasks };
}

// ─── Time tracking ────────────────────────────────────────────────────────────
// Time tracking lives in `app/actions/time-tracking.ts` (seconds-based
// `time_entry`, live timer + manual logging). The old minutes-based
// `logTime` / `deleteTimeLog` were removed with the `time_log` table.

// ─── Bulk actions ─────────────────────────────────────────────────────────────

export async function bulkUpdateStatus(
  workspaceId: string,
  spaceId: string,
  _listId: string,
  taskIds: string[],
  statusId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }
  const permErr = await requireEditAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return permErr;
  }

  if (taskIds.length === 0) {
    return { ok: true };
  }

  // A status always belongs to exactly one list. Derive the target list from the
  // status itself rather than trusting the caller's listId — the sprint view (and
  // any cross-list view) doesn't have a single list to pass, so only the status's
  // own list is authoritative. This keeps the update scoped to tasks that can
  // legitimately receive this status.
  const [statusRow] = await db
    .select({
      id: listStatus.id,
      name: listStatus.name,
      type: listStatus.type,
      listId: listStatus.listId,
    })
    .from(listStatus)
    .innerJoin(list, eq(listStatus.listId, list.id))
    .where(and(eq(listStatus.id, statusId), eq(list.spaceId, spaceId)))
    .limit(1);

  if (!statusRow) {
    return { error: "Status not found" };
  }

  // Snapshot titles + previous status (with name) before the update, scoped to
  // this space — also doubles as scoping against stale/foreign ids. Used below
  // to log/notify only the tasks whose status actually changes, matching
  // updateTaskStatus's single-task behavior.
  const affected = await db
    .select({
      id: task.id,
      title: task.title,
      oldStatusId: task.statusId,
      oldStatusName: listStatus.name,
    })
    .from(task)
    .leftJoin(listStatus, eq(task.statusId, listStatus.id))
    .leftJoin(list, eq(task.listId, list.id))
    .where(
      and(
        inArray(task.id, taskIds),
        eq(effectiveTaskSpaceId, spaceId),
        notDeleted()
      )
    );

  if (affected.length === 0) {
    return { ok: true };
  }
  const validTaskIds = affected.map((t) => t.id);

  // Set the status and align the task's list with the status's own list. This
  // covers sprint tasks that have no list yet (their listId is null, so a
  // list-scoped filter would never match them) and keeps status/list consistent.
  await db
    .update(task)
    .set({ statusId, listId: statusRow.listId, updatedAt: new Date() })
    .where(inArray(task.id, validTaskIds));

  // Activity log + notifications — best-effort. Activity log stays one entry
  // per task; notifications are grouped per recipient (createBulkNotifications)
  // so a watcher of several changed tasks gets one notification, not one per
  // task — matching updateTaskStatus's single-task copy in the N=1 case.
  const changed = affected.filter((t) => t.oldStatusId !== statusId);
  if (changed.length > 0) {
    const actorName = session.user.name ?? session.user.email ?? "Someone";
    const watcherRows = await db
      .select({ taskId: taskWatcher.taskId, userId: taskWatcher.userId })
      .from(taskWatcher)
      .where(
        inArray(
          taskWatcher.taskId,
          changed.map((t) => t.id)
        )
      );
    const watchersByTask = new Map<string, string[]>();
    for (const row of watcherRows) {
      const ids = watchersByTask.get(row.taskId) ?? [];
      ids.push(row.userId);
      watchersByTask.set(row.taskId, ids);
    }

    const bulkTasks: BulkNotifyTaskInfo<{ title: string }>[] = [];
    for (const t of changed) {
      await writeActivityLog(t.id, session.user.id, "status_changed", {
        from: t.oldStatusId,
        to: statusId,
        from_status_name: t.oldStatusName ?? null,
        to_status_name: statusRow.name,
      });

      const watcherIds = watchersByTask.get(t.id) ?? [];
      if (watcherIds.length > 0) {
        bulkTasks.push({
          taskId: t.id,
          recipientIds: watcherIds,
          data: { title: t.title },
        });
      }
    }

    createBulkNotifications({
      workspaceId,
      actorId: session.user.id,
      triggerType:
        statusRow.type === "CLOSED" ? "task_completed" : "task_status_changed",
      entityType: "TASK",
      tasks: bulkTasks,
      buildMessage: ({ tasks: group }) => {
        if (group.length === 1) {
          return {
            title:
              statusRow.type === "CLOSED"
                ? `${actorName} completed "${group[0].data.title}"`
                : `${actorName} changed status of "${group[0].data.title}" to "${statusRow.name}"`,
          };
        }
        const titles = group.map((g) => g.data.title);
        return {
          title:
            statusRow.type === "CLOSED"
              ? `${actorName} completed ${group.length} tasks`
              : `${actorName} changed status of ${group.length} tasks to "${statusRow.name}"`,
          body: titles.slice(0, 5).join(", ") + (titles.length > 5 ? "…" : ""),
        };
      },
    });
  }

  revalidateList(workspaceId, spaceId, statusRow.listId);
  return { ok: true };
}

export async function bulkDeleteTasks(
  workspaceId: string,
  spaceId: string,
  _listId: string,
  taskIds: string[]
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }
  const permErr = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return { error: "You don't have permission to delete tasks" };
  }

  if (taskIds.length === 0) {
    return { ok: true };
  }

  // Snapshot titles + notification recipients BEFORE the delete (rows are gone
  // afterwards) — also scopes to this space, guarding against stale/foreign ids.
  const affected = await db
    .select({ id: task.id, title: task.title, listId: task.listId })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .where(
      and(
        inArray(task.id, taskIds),
        eq(task.workspaceId, workspaceId),
        eq(effectiveTaskSpaceId, spaceId),
        notDeleted()
      )
    );
  if (affected.length === 0) {
    return { ok: true };
  }
  const validTaskIds = affected.map((t) => t.id);

  const [assigneeRows, watcherRows] = await Promise.all([
    db
      .select({ taskId: taskAssignee.taskId, userId: taskAssignee.userId })
      .from(taskAssignee)
      .where(inArray(taskAssignee.taskId, validTaskIds)),
    db
      .select({ taskId: taskWatcher.taskId, userId: taskWatcher.userId })
      .from(taskWatcher)
      .where(inArray(taskWatcher.taskId, validTaskIds)),
  ]);
  const recipientsByTask = new Map<string, Set<string>>();
  for (const row of [...assigneeRows, ...watcherRows]) {
    const set = recipientsByTask.get(row.taskId) ?? new Set<string>();
    set.add(row.userId);
    recipientsByTask.set(row.taskId, set);
  }

  // Scope by space, not a single list — the sprint view (and other cross-list
  // views) selects tasks that may span lists and has no single listId to pass.
  // Soft delete → Trash. Files stay in storage until a permanent delete.
  const { parentIds } = await softDeleteTasks(validTaskIds, session.user.id);
  await Promise.all(
    parentIds.map((id) => writeActivityLog(id, session.user.id, "task_deleted"))
  );

  // Notify assignees + watchers per task, grouped per recipient — matches
  // deleteTask's single-task recipient set/copy in the N=1 case, one
  // notification per recipient (not per task) for N>1.
  const actorName = session.user.name ?? session.user.email ?? "Someone";
  const bulkTasks: BulkNotifyTaskInfo<{
    title: string;
    listId: string | null;
  }>[] = [];
  for (const t of affected) {
    const recipientIds = [...(recipientsByTask.get(t.id) ?? [])];
    if (recipientIds.length > 0) {
      bulkTasks.push({
        taskId: t.id,
        recipientIds,
        data: { title: t.title, listId: t.listId },
      });
    }
  }
  createBulkNotifications({
    workspaceId,
    actorId: session.user.id,
    triggerType: "task_deleted",
    entityType: "TASK",
    tasks: bulkTasks,
    buildMessage: ({ tasks: group, representativeTaskId }) => {
      const rep =
        group.find((g) => g.taskId === representativeTaskId) ?? group[0];
      const pushUrl = rep.data.listId
        ? `/${workspaceId}/${spaceId}/list/${rep.data.listId}`
        : `/${workspaceId}`;
      if (group.length === 1) {
        return {
          title: `${actorName} deleted task "${group[0].data.title}"`,
          pushTitle: group[0].data.title,
          pushBody: `${actorName} deleted this task`,
          pushUrl,
        };
      }
      const titles = group.map((g) => g.data.title);
      return {
        title: `${actorName} deleted ${group.length} tasks`,
        body: titles.slice(0, 5).join(", ") + (titles.length > 5 ? "…" : ""),
        pushBody: `${actorName} deleted ${group.length} tasks`,
        pushUrl,
      };
    },
  });

  revalidateSpace(workspaceId, spaceId);
  return { ok: true };
}

export async function bulkArchiveTasks(
  workspaceId: string,
  spaceId: string,
  _listId: string,
  taskIds: string[]
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }
  const permErr = await requireEditAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return permErr;
  }

  if (taskIds.length === 0) {
    return { ok: true };
  }

  // Scope by space, not a single list — see bulkDeleteTasks. Also doubles as
  // the set of ids to write activity log entries for below.
  const affected = await db
    .select({ id: task.id })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .where(
      and(
        inArray(task.id, taskIds),
        eq(effectiveTaskSpaceId, spaceId),
        notDeleted()
      )
    );
  if (affected.length === 0) {
    return { ok: true };
  }
  const validTaskIds = affected.map((t) => t.id);

  await db
    .update(task)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(inArray(task.id, validTaskIds));

  // Matches archiveTask's single-task activity log — no notification, since
  // the single-task action doesn't send one either.
  for (const taskId of validTaskIds) {
    await writeActivityLog(taskId, session.user.id, "task_archived");
  }

  revalidateSpace(workspaceId, spaceId);
  return { ok: true };
}

// ─── bulkMoveTasks ────────────────────────────────────────────────────────────
// Moves tasks to a different list. For each task:
//   1. Status is remapped by name — falls back to first OPEN status.
//   2. Any PLANNED/ACTIVE sprint assignment is cleared (sprint scoping is per-list).
//   3. Activity log entry is written.

export async function bulkMoveTasks(
  workspaceId: string,
  spaceId: string,
  taskIds: string[],
  targetListId: string
): Promise<{ ok: true; moved: number } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const permErr = await requireEditAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return permErr;
  }

  if (taskIds.length === 0) {
    return { ok: true, moved: 0 };
  }

  const target = await resolveMoveTarget(
    session.user.id,
    workspaceId,
    targetListId
  );
  if ("error" in target) {
    return target;
  }

  // Pre-fetch all statuses for the target list once
  const targetStatuses = await db
    .select({
      id: listStatus.id,
      name: listStatus.name,
      type: listStatus.type,
      orderIndex: listStatus.orderIndex,
    })
    .from(listStatus)
    .where(eq(listStatus.listId, targetListId))
    .orderBy(asc(listStatus.orderIndex));

  if (targetStatuses.length === 0) {
    return { error: "Target list has no statuses" };
  }

  const firstOpen =
    targetStatuses.find((s) => s.type === "OPEN") ?? targetStatuses[0];
  const [toListRow] = await db
    .select({ name: list.name })
    .from(list)
    .where(eq(list.id, targetListId))
    .limit(1);
  const toListName = toListRow?.name ?? "another list";
  const actorName = session.user.name ?? session.user.email ?? "Someone";
  const bulkTasks: BulkNotifyTaskInfo<{ title: string; fromName?: string }>[] =
    [];

  let moved = 0;
  for (const taskId of taskIds) {
    // Only tasks that really live in the space the caller was authorised
    // against; foreign ids are skipped.
    const [t] = await db
      .select({ listId: task.listId, statusId: task.statusId })
      .from(task)
      .leftJoin(list, eq(task.listId, list.id))
      .where(
        and(
          eq(task.id, taskId),
          eq(effectiveTaskSpaceId, spaceId),
          notDeleted()
        )
      )
      .limit(1);
    if (!t) {
      continue;
    }
    if (t.listId === targetListId) {
      continue; // already there
    }

    // Map status by name
    const [currentStatus] = t.statusId
      ? await db
          .select({ name: listStatus.name })
          .from(listStatus)
          .where(eq(listStatus.id, t.statusId))
          .limit(1)
      : [];

    const newStatusId =
      (currentStatus &&
        targetStatuses.find((s) => s.name === currentStatus.name)?.id) ??
      firstOpen.id;

    // Update task
    await db
      .update(task)
      .set({
        listId: targetListId,
        // Keep the task's own space column in step with the list it now lives in.
        spaceId: target.spaceId,
        statusId: newStatusId,
        updatedAt: new Date(),
      })
      .where(eq(task.id, taskId));

    // Clear any PLANNED/ACTIVE sprint assignment
    const activeSprints = await db
      .select({ sprintId: taskSprint.sprintId })
      .from(taskSprint)
      .innerJoin(sprint, eq(taskSprint.sprintId, sprint.id))
      .where(
        and(
          eq(taskSprint.taskId, taskId),
          inArray(sprint.status, ["PLANNED", "ACTIVE"])
        )
      );

    if (activeSprints.length > 0) {
      await db.delete(taskSprint).where(
        and(
          eq(taskSprint.taskId, taskId),
          inArray(
            taskSprint.sprintId,
            activeSprints.map((r) => r.sprintId)
          )
        )
      );
    }

    await writeActivityLog(taskId, session.user.id, "task_moved", {
      fromListId: t.listId,
      toListId: targetListId,
    });

    // Collect this task's recipients — notifications are sent once per
    // recipient after the loop (createBulkNotifications), not per task here.
    const moveRecipientIds = await assigneeAndWatcherIds(taskId);
    if (moveRecipientIds.length > 0) {
      const [[taskRow], fromListRow] = await Promise.all([
        db
          .select({ title: task.title })
          .from(task)
          .where(eq(task.id, taskId))
          .limit(1),
        t.listId
          ? db
              .select({ name: list.name })
              .from(list)
              .where(eq(list.id, t.listId))
              .limit(1)
          : Promise.resolve([] as { name: string }[]),
      ]);
      bulkTasks.push({
        taskId,
        recipientIds: moveRecipientIds,
        data: {
          title: taskRow?.title ?? "a task",
          fromName: fromListRow[0]?.name,
        },
      });
    }

    moved++;
  }

  // Notify assignees + watchers, grouped per recipient — matches moveTask's
  // single-task copy for a recipient touched by only one moved task; for a
  // recipient touched by several, one notification names the count instead of
  // firing once per task.
  createBulkNotifications({
    workspaceId,
    actorId: session.user.id,
    triggerType: "task_moved",
    entityType: "TASK",
    tasks: bulkTasks,
    buildMessage: ({ tasks: group }) => {
      if (group.length === 1) {
        const t = group[0].data;
        return {
          title: t.fromName
            ? `${actorName} moved "${t.title}" from ${t.fromName} to ${toListName}`
            : `${actorName} moved "${t.title}" to ${toListName}`,
        };
      }
      const distinctFrom = new Set(
        group.map((g) => g.data.fromName).filter(Boolean)
      );
      const titles = group.map((g) => g.data.title);
      return {
        title:
          distinctFrom.size === 1
            ? `${actorName} moved ${group.length} tasks from ${[...distinctFrom][0]} to ${toListName}`
            : `${actorName} moved ${group.length} tasks to ${toListName}`,
        body: titles.slice(0, 5).join(", ") + (titles.length > 5 ? "…" : ""),
      };
    },
  });

  void refreshWorkspace(workspaceId);
  return { ok: true, moved };
}

// ─── Get task location (spaceId + listId) for inbox navigation ───────────────

export async function getTaskLocation(
  workspaceId: string,
  taskId: string
): Promise<{ spaceId: string; listId: string | null } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const [row] = await db
    .select({
      listId: task.listId,
      taskSpaceId: task.spaceId,
      listSpaceId: list.spaceId,
    })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .where(
      and(eq(task.id, taskId), eq(task.workspaceId, workspaceId), notDeleted())
    )
    .limit(1);

  if (!row) {
    return { error: "Task not found" };
  }
  const spaceId = row.listSpaceId ?? row.taskSpaceId;
  if (!spaceId) {
    return { error: "Task has no space association" };
  }
  return { spaceId, listId: row.listId };
}

// ─── Get archived tasks for list ──────────────────────────────────────────────

export async function reorderTasksById(
  workspaceId: string,
  spaceId: string,
  taskIds: string[]
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const permErr = await requireEditAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return permErr;
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < taskIds.length; i++) {
      await tx
        .update(task)
        .set({ orderIndex: (i + 1) * 1000, updatedAt: new Date() })
        .where(eq(task.id, taskIds[i]));
    }
  });

  return { ok: true };
}

export async function reorderTasksInStatus(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskIds: string[] // full ordered list of task IDs in the group
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const permErr = await requireEditAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return permErr;
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < taskIds.length; i++) {
      await tx
        .update(task)
        .set({ orderIndex: (i + 1) * 1000, updatedAt: new Date() })
        .where(and(eq(task.id, taskIds[i]), eq(task.listId, listId)));
    }
  });

  return { ok: true };
}

export async function getArchivedTasksForList(
  workspaceId: string,
  spaceId: string,
  listId: string
): Promise<
  | { tasks: { id: string; title: string; seqNumber: number }[] }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const permErr = await requireViewAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permErr) {
    return permErr;
  }

  const tasks = await db
    .select({ id: task.id, title: task.title, seqNumber: task.seqNumber })
    .from(task)
    .where(
      and(
        eq(task.listId, listId),
        eq(task.isArchived, true),
        isNull(task.parentTaskId),
        notDeleted()
      )
    )
    .orderBy(asc(task.orderIndex));

  return { tasks };
}
