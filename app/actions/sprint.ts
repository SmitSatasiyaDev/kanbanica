"use server";

import { createId } from "@paralleldrive/cuid2";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
} from "drizzle-orm";
import { headers } from "next/headers";
import {
  list,
  listStatus,
  space,
  sprint,
  tag,
  task,
  taskAssignee,
  taskSprint,
  taskTag,
  user,
} from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  canAccessSpace,
  getSpacePermission,
  hasPermissionLevel,
} from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { closeSprintAndRollover } from "@/lib/sprint/rollover";
import { notDeleted } from "@/lib/task-visibility";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireAccess(
  userId: string,
  workspaceId: string,
  spaceId: string
) {
  const accessible = await canAccessSpace(userId, workspaceId, spaceId);
  if (!accessible) {
    return { error: "Unauthorized" } as const;
  }
  return null;
}

async function requireEditAccess(
  userId: string,
  workspaceId: string,
  spaceId: string
) {
  const permission = await getSpacePermission(userId, workspaceId, spaceId);
  if (permission === null) {
    return { error: "Forbidden" } as const;
  }
  if (!hasPermissionLevel(permission, "edit")) {
    return { error: "Forbidden" } as const;
  }
  return null;
}

async function requireFullAccess(
  userId: string,
  workspaceId: string,
  spaceId: string
) {
  const permission = await getSpacePermission(userId, workspaceId, spaceId);
  if (permission === null) {
    return { error: "Forbidden" } as const;
  }
  if (!hasPermissionLevel(permission, "full_access")) {
    return { error: "You need Full Access to manage sprints" } as const;
  }
  return null;
}

function revalidateSpace(workspaceId: string, spaceId: string) {
  void refreshWorkspace(workspaceId, [
    `/${workspaceId}/${spaceId}`,
    `/${workspaceId}`,
  ]);
}

function revalidateList(workspaceId: string, spaceId: string, listId: string) {
  void refreshWorkspace(workspaceId, [
    `/${workspaceId}/${spaceId}/list/${listId}`,
    `/${workspaceId}/${spaceId}`,
    `/${workspaceId}`,
  ]);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ─── getSprints ───────────────────────────────────────────────────────────────

export async function getSprints(
  workspaceId: string,
  spaceId: string
): Promise<
  | {
      sprints: {
        id: string;
        name: string;
        goal: string | null;
        status: "PLANNED" | "ACTIVE" | "CLOSED";
        startDate: Date | null;
        endDate: Date | null;
        createdAt: Date;
      }[];
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const rows = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      createdAt: sprint.createdAt,
    })
    .from(sprint)
    .where(eq(sprint.spaceId, spaceId))
    .orderBy(desc(sprint.createdAt));

  return { sprints: rows };
}

// ─── createSprint ─────────────────────────────────────────────────────────────

export async function createSprint(
  workspaceId: string,
  spaceId: string,
  data: {
    name: string;
    goal?: string;
    startDate: Date;
    durationWeeks: number;
    autoCreateNext?: boolean;
    autoCloseOnNext?: boolean;
    autoIncompleteStrategy?:
      | "move_to_backlog"
      | "move_to_next_sprint"
      | "leave_as_is";
  }
): Promise<{ sprintId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const name = data.name.trim();
  if (!name) {
    return { error: "Sprint name is required" };
  }
  if (data.durationWeeks < 1) {
    return { error: "Duration must be at least 1 week" };
  }

  const startDate = new Date(data.startDate);
  const endDate = addDays(startDate, data.durationWeeks * 7);
  const sprintId = createId();
  const now = new Date();

  await db.insert(sprint).values({
    id: sprintId,
    spaceId,
    name,
    goal: data.goal ?? null,
    status: "PLANNED",
    startDate,
    endDate,
    durationWeeks: data.durationWeeks,
    autoCreateNext: data.autoCreateNext ?? false,
    autoCloseOnNext: data.autoCloseOnNext ?? false,
    autoIncompleteStrategy: data.autoIncompleteStrategy ?? "move_to_backlog",
    createdBy: session.user.id,
    createdAt: now,
    updatedAt: now,
  });

  revalidateSpace(workspaceId, spaceId);

  return { sprintId };
}

// ─── startSprint ──────────────────────────────────────────────────────────────

export async function startSprint(
  workspaceId: string,
  spaceId: string,
  sprintId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [activeSprint] = await db
    .select({ id: sprint.id })
    .from(sprint)
    .where(and(eq(sprint.spaceId, spaceId), eq(sprint.status, "ACTIVE")))
    .limit(1);

  if (activeSprint) {
    return { error: "Another sprint is already active in this project" };
  }

  const [targetSprint] = await db
    .select({ id: sprint.id, status: sprint.status })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.spaceId, spaceId)))
    .limit(1);

  if (!targetSprint) {
    return { error: "Sprint not found" };
  }
  if (targetSprint.status !== "PLANNED") {
    return { error: "Only PLANNED sprints can be started" };
  }

  const now = new Date();
  await db
    .update(sprint)
    .set({ status: "ACTIVE", startDate: now, updatedAt: now })
    .where(eq(sprint.id, sprintId));

  revalidateSpace(workspaceId, spaceId);

  return { ok: true };
}

// ─── deleteSprint ─────────────────────────────────────────────────────────────

export async function deleteSprint(
  workspaceId: string,
  spaceId: string,
  sprintId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [targetSprint] = await db
    .select({ id: sprint.id, status: sprint.status })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.spaceId, spaceId)))
    .limit(1);

  if (!targetSprint) {
    return { error: "Sprint not found" };
  }
  if (targetSprint.status !== "PLANNED") {
    return { error: "Only PLANNED sprints can be deleted" };
  }

  await db.delete(taskSprint).where(eq(taskSprint.sprintId, sprintId));
  await db.delete(sprint).where(eq(sprint.id, sprintId));

  revalidateSpace(workspaceId, spaceId);

  return { ok: true };
}

// ─── getSprintWithTasks ───────────────────────────────────────────────────────

export async function getSprintWithTasks(
  workspaceId: string,
  spaceId: string,
  sprintId: string
): Promise<
  | {
      sprint: {
        id: string;
        name: string;
        goal: string | null;
        status: "PLANNED" | "ACTIVE" | "CLOSED";
        startDate: Date | null;
        endDate: Date | null;
      };
      tasks: {
        id: string;
        title: string;
        seqNumber: number;
        priority: string | null;
        statusId: string | null;
        statusName: string | null;
        statusColor: string | null;
        statusType: "OPEN" | "ACTIVE" | "CLOSED" | null;
        storyPoints: number | null;
      }[];
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [targetSprint] = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.spaceId, spaceId)))
    .limit(1);

  if (!targetSprint) {
    return { error: "Sprint not found" };
  }

  const tasks = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      priority: task.priority,
      statusId: task.statusId,
      statusName: listStatus.name,
      statusColor: listStatus.color,
      statusType: listStatus.type,
      storyPoints: taskSprint.points,
    })
    .from(taskSprint)
    .innerJoin(task, eq(taskSprint.taskId, task.id))
    .leftJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(and(eq(taskSprint.sprintId, sprintId), notDeleted()));

  return { sprint: targetSprint, tasks };
}

// ─── getDefaultListForSprint ──────────────────────────────────────────────────

// The list a new task created from a sprint (which itself spans multiple
// lists) should belong to, so it gets a real status instead of landing
// list-less/status-less as "No Status". Mirrors the defaultListId logic in
// getActiveSprintView: prefer a list already used by this sprint's tasks,
// else fall back to the space's first non-archived list.
async function resolveDefaultListForSprint(
  spaceId: string,
  sprintId: string
): Promise<string | null> {
  const [existing] = await db
    .select({ listId: task.listId })
    .from(taskSprint)
    .innerJoin(task, eq(task.id, taskSprint.taskId))
    .where(
      and(
        eq(taskSprint.sprintId, sprintId),
        notDeleted(),
        eq(task.isArchived, false),
        isNotNull(task.listId)
      )
    )
    .orderBy(asc(task.orderIndex))
    .limit(1);

  if (existing?.listId) {
    return existing.listId;
  }

  const [firstList] = await db
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.spaceId, spaceId), eq(list.isArchived, false)))
    .orderBy(asc(list.createdAt))
    .limit(1);

  return firstList?.id ?? null;
}

export async function getDefaultListForSprint(
  workspaceId: string,
  spaceId: string,
  sprintId: string
): Promise<{ listId: string | null } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const listId = await resolveDefaultListForSprint(spaceId, sprintId);
  return { listId };
}

// ─── addTaskToSprint ──────────────────────────────────────────────────────────

export async function addTaskToSprint(
  workspaceId: string,
  spaceId: string,
  sprintId: string,
  taskId: string,
  storyPoints?: number
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [targetTask] = await db
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        eq(task.id, taskId),
        eq(task.workspaceId, workspaceId),
        notDeleted(),
        eq(task.isArchived, false)
      )
    )
    .limit(1);
  if (!targetTask) {
    return { error: "Task not found" };
  }

  const existingRows = await db
    .select({ sprintId: taskSprint.sprintId })
    .from(taskSprint)
    .innerJoin(sprint, eq(taskSprint.sprintId, sprint.id))
    .where(
      and(
        eq(taskSprint.taskId, taskId),
        inArray(sprint.status, ["PLANNED", "ACTIVE"])
      )
    );

  if (existingRows.length > 0) {
    return { error: "Task is already in an active or planned sprint" };
  }

  await db.insert(taskSprint).values({
    taskId,
    sprintId,
    points: storyPoints ?? null,
    addedAt: new Date(),
  });

  revalidateSpace(workspaceId, spaceId);

  return { ok: true };
}

// ─── removeTaskFromSprint ─────────────────────────────────────────────────────

export async function removeTaskFromSprint(
  workspaceId: string,
  spaceId: string,
  sprintId: string,
  taskId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  await db
    .delete(taskSprint)
    .where(
      and(eq(taskSprint.taskId, taskId), eq(taskSprint.sprintId, sprintId))
    );

  revalidateSpace(workspaceId, spaceId);

  return { ok: true };
}

// ─── updateStoryPoints ────────────────────────────────────────────────────────

export async function updateStoryPoints(
  workspaceId: string,
  spaceId: string,
  sprintId: string,
  taskId: string,
  storyPoints: number | null
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [row] = await db
    .select({ taskId: taskSprint.taskId })
    .from(taskSprint)
    .where(
      and(eq(taskSprint.taskId, taskId), eq(taskSprint.sprintId, sprintId))
    )
    .limit(1);

  if (!row) {
    return { error: "Task not found in sprint" };
  }

  await db
    .update(taskSprint)
    .set({ points: storyPoints })
    .where(
      and(eq(taskSprint.taskId, taskId), eq(taskSprint.sprintId, sprintId))
    );

  return { ok: true };
}

// ─── markAllSprintTasksDone ───────────────────────────────────────────────────

export async function markAllSprintTasksDone(
  workspaceId: string,
  spaceId: string,
  listId: string,
  sprintId: string
): Promise<{ affected: number } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [closedStatus] = await db
    .select({ id: listStatus.id, name: listStatus.name })
    .from(listStatus)
    .where(and(eq(listStatus.listId, listId), eq(listStatus.type, "CLOSED")))
    .orderBy(asc(listStatus.orderIndex))
    .limit(1);

  if (!closedStatus) {
    return { error: "No closed status found in this list" };
  }

  const sprintTasks = await db
    .select({ taskId: taskSprint.taskId, statusType: listStatus.type })
    .from(taskSprint)
    .innerJoin(task, eq(taskSprint.taskId, task.id))
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(
      and(
        eq(taskSprint.sprintId, sprintId),
        notDeleted(),
        eq(task.isArchived, false)
      )
    );

  const incompleteTasks = sprintTasks.filter((t) => t.statusType !== "CLOSED");

  if (incompleteTasks.length === 0) {
    return { affected: 0 };
  }

  const incompleteTaskIds = incompleteTasks.map((t) => t.taskId);
  const now = new Date();

  await db
    .update(task)
    .set({ statusId: closedStatus.id, updatedAt: now })
    .where(inArray(task.id, incompleteTaskIds));

  await Promise.allSettled(
    incompleteTaskIds.map((taskId) =>
      writeActivityLog(taskId, session.user.id, "status_changed", {
        to: closedStatus.id,
        to_status_name: closedStatus.name,
        reason: "mark_all_done_sprint",
      })
    )
  );

  revalidateList(workspaceId, spaceId, listId);

  return { affected: incompleteTasks.length };
}

// ─── closeSprint ──────────────────────────────────────────────────────────────

export async function closeSprint(
  workspaceId: string,
  spaceId: string,
  sprintId: string,
  strategy: "move_to_backlog" | "move_to_next_sprint" | "leave_as_is",
  targetSprintId?: string
): Promise<{ ok: true; nextSprintId?: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [targetSprint] = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.spaceId, spaceId)))
    .limit(1);

  if (!targetSprint) {
    return { error: "Sprint not found" };
  }
  if (targetSprint.status !== "ACTIVE") {
    return { error: "Only ACTIVE sprints can be closed" };
  }

  // Read the space-level "auto-create next sprint" setting so a manual close
  // also rolls into the next sprint when the workspace has it enabled.
  const [spaceRow] = await db
    .select({ autoCreateNext: space.sprintAutoCreateNext })
    .from(space)
    .where(eq(space.id, spaceId))
    .limit(1);

  const { nextSprintId } = await closeSprintAndRollover({
    spaceId,
    sprintId,
    actorId: session.user.id,
    incompleteStrategy: strategy,
    targetSprintId,
    autoCreateNext: spaceRow?.autoCreateNext ?? false,
  });

  revalidateSpace(workspaceId, spaceId);

  return { ok: true, nextSprintId: nextSprintId ?? undefined };
}

// ─── getBacklogTasks ──────────────────────────────────────────────────────────

export type BacklogTask = {
  id: string;
  title: string;
  seqNumber: number;
  priority: string | null;
  statusId: string | null;
  statusName: string | null;
  statusColor: string | null;
  statusType: string | null;
  listId: string;
  orderIndex: number;
  assignees: {
    userId: string;
    name: string | null;
    email: string | null;
    image: string | null;
  }[];
};

export type BacklogList = {
  listId: string;
  listName: string;
  tasks: BacklogTask[];
};

export async function getBacklogTasks(
  workspaceId: string,
  spaceId: string
): Promise<{ lists: BacklogList[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  // 1. All non-archived lists in this space
  const spaceLists = await db
    .select({ id: list.id, name: list.name })
    .from(list)
    .where(and(eq(list.spaceId, spaceId), eq(list.isArchived, false)))
    .orderBy(asc(list.orderIndex));

  if (spaceLists.length === 0) {
    return { lists: [] };
  }

  const listIds = spaceLists.map((l) => l.id);

  // 2. Sprint IDs that are PLANNED or ACTIVE for this space
  const activeSprintRows = await db
    .select({ id: sprint.id })
    .from(sprint)
    .where(
      and(
        eq(sprint.spaceId, spaceId),
        inArray(sprint.status, ["PLANNED", "ACTIVE"])
      )
    );

  const activeSprintIds = activeSprintRows.map((s) => s.id);

  // 3. Task IDs already in an active/planned sprint
  let taskIdsInSprints: string[] = [];
  if (activeSprintIds.length > 0) {
    const rows = await db
      .select({ taskId: taskSprint.taskId })
      .from(taskSprint)
      .where(inArray(taskSprint.sprintId, activeSprintIds));
    taskIdsInSprints = rows.map((r) => r.taskId);
  }

  // 4. Fetch backlog tasks with status info
  const baseConditions = [
    inArray(task.listId, listIds),
    notDeleted(),
    eq(task.isArchived, false),
    isNull(task.parentTaskId),
  ];

  const taskRows = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      priority: task.priority,
      statusId: task.statusId,
      statusName: listStatus.name,
      statusColor: listStatus.color,
      statusType: listStatus.type,
      listId: task.listId,
      orderIndex: task.orderIndex,
    })
    .from(task)
    .leftJoin(listStatus, eq(listStatus.id, task.statusId))
    .where(
      taskIdsInSprints.length > 0
        ? and(...baseConditions, notInArray(task.id, taskIdsInSprints))
        : and(...baseConditions)
    )
    .orderBy(asc(task.orderIndex));

  if (taskRows.length === 0) {
    return { lists: [] };
  }

  // 5. Fetch assignees for those tasks
  const taskIds = taskRows.map((t) => t.id);
  const assigneeRows = await db
    .select({
      taskId: taskAssignee.taskId,
      userId: taskAssignee.userId,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(taskAssignee)
    .leftJoin(user, eq(user.id, taskAssignee.userId))
    .where(inArray(taskAssignee.taskId, taskIds));

  // 6. Group assignees by taskId
  const assigneesByTask = new Map<
    string,
    {
      userId: string;
      name: string | null;
      email: string | null;
      image: string | null;
    }[]
  >();
  for (const a of assigneeRows) {
    const arr = assigneesByTask.get(a.taskId) ?? [];
    arr.push({
      userId: a.userId,
      name: a.name,
      email: a.email,
      image: a.image,
    });
    assigneesByTask.set(a.taskId, arr);
  }

  // 7. Build a lookup of listId → list name
  const listNameById = new Map(spaceLists.map((l) => [l.id, l.name]));

  // 8. Group tasks by list, preserving list order
  const tasksByList = new Map<string, BacklogTask[]>();
  for (const t of taskRows) {
    if (!t.listId) {
      continue;
    }
    const arr = tasksByList.get(t.listId) ?? [];
    arr.push({
      id: t.id,
      title: t.title,
      seqNumber: t.seqNumber,
      priority: t.priority,
      statusId: t.statusId,
      statusName: t.statusName ?? null,
      statusColor: t.statusColor ?? null,
      statusType: t.statusType ?? null,
      listId: t.listId,
      orderIndex: t.orderIndex,
      assignees: assigneesByTask.get(t.id) ?? [],
    });
    tasksByList.set(t.listId, arr);
  }

  // 9. Build output in list order, skip lists with no backlog tasks
  const lists: BacklogList[] = [];
  for (const l of spaceLists) {
    const tasks = tasksByList.get(l.id);
    if (tasks && tasks.length > 0) {
      lists.push({
        listId: l.id,
        listName: listNameById.get(l.id) ?? l.id,
        tasks,
      });
    }
  }

  return { lists };
}

// ─── getActiveSprintView ──────────────────────────────────────────────────────
// Full data for rendering sprint tasks for a specific sprint.

export async function getActiveSprintView(
  workspaceId: string,
  spaceId: string
): Promise<
  | {
      sprint: {
        id: string;
        name: string;
        goal: string | null;
        startDate: Date | null;
        endDate: Date | null;
        status: "PLANNED" | "ACTIVE" | "CLOSED";
      } | null;
      tasks: {
        id: string;
        title: string;
        seqNumber: number;
        priority: string | null;
        statusId: string | null;
        listId: string | null;
        orderIndex: number;
        dueDateStart: Date | null;
        dueDateEnd: Date | null;
        statusName: string | null;
        statusColor: string | null;
        statusType: string | null;
        tags: { id: string; name: string; color: string }[];
        assignees: { userId: string; name: string; image: string | null }[];
      }[];
      statuses: {
        id: string;
        name: string;
        color: string;
        type: "OPEN" | "ACTIVE" | "CLOSED";
        orderIndex: number;
      }[];
      // The list new tasks created from the sprint view should belong to, so
      // they get a real list + default status instead of landing status-less.
      defaultListId: string | null;
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  // Find active sprint for this space
  const [activeSprint] = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      status: sprint.status,
    })
    .from(sprint)
    .where(and(eq(sprint.spaceId, spaceId), eq(sprint.status, "ACTIVE")))
    .limit(1);

  if (!activeSprint) {
    return { sprint: null, tasks: [], statuses: [], defaultListId: null };
  }

  const sprintTasks = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      priority: task.priority,
      statusId: task.statusId,
      listId: task.listId,
      orderIndex: task.orderIndex,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      statusName: listStatus.name,
      statusColor: listStatus.color,
      statusType: listStatus.type,
    })
    .from(taskSprint)
    .innerJoin(task, eq(task.id, taskSprint.taskId))
    .leftJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(
      and(
        eq(taskSprint.sprintId, activeSprint.id),
        notDeleted(),
        eq(task.isArchived, false)
      )
    )
    .orderBy(asc(task.orderIndex));

  if (sprintTasks.length === 0) {
    // Empty sprint: still expose the space's default list and its statuses so the
    // Create Task modal can default a status and create the task in a real list
    // (otherwise the task is created with no list/status and lands in "No Status").
    const [firstList] = await db
      .select({ id: list.id })
      .from(list)
      .where(and(eq(list.spaceId, spaceId), eq(list.isArchived, false)))
      .orderBy(asc(list.createdAt))
      .limit(1);

    const statuses = firstList
      ? await db
          .select({
            id: listStatus.id,
            name: listStatus.name,
            color: listStatus.color,
            type: listStatus.type,
            orderIndex: listStatus.orderIndex,
          })
          .from(listStatus)
          .where(eq(listStatus.listId, firstList.id))
          .orderBy(asc(listStatus.orderIndex))
      : [];

    return {
      sprint: activeSprint,
      tasks: [],
      statuses,
      defaultListId: firstList?.id ?? null,
    };
  }

  const taskIds = sprintTasks.map((t) => t.id);

  const [tagRows, assigneeRows] = await Promise.all([
    db
      .select({
        taskId: taskTag.taskId,
        id: tag.id,
        name: tag.name,
        color: tag.color,
      })
      .from(taskTag)
      .innerJoin(tag, eq(taskTag.tagId, tag.id))
      .where(inArray(taskTag.taskId, taskIds)),
    db
      .select({
        taskId: taskAssignee.taskId,
        userId: taskAssignee.userId,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(taskAssignee)
      .innerJoin(user, eq(user.id, taskAssignee.userId))
      .where(inArray(taskAssignee.taskId, taskIds)),
  ]);

  const tagsByTask = new Map<
    string,
    { id: string; name: string; color: string }[]
  >();
  for (const r of tagRows) {
    const arr = tagsByTask.get(r.taskId) ?? [];
    arr.push({ id: r.id, name: r.name, color: r.color ?? "#9CA3AF" });
    tagsByTask.set(r.taskId, arr);
  }

  const assigneesByTask = new Map<
    string,
    { userId: string; name: string; image: string | null }[]
  >();
  for (const r of assigneeRows) {
    const arr = assigneesByTask.get(r.taskId) ?? [];
    arr.push({ userId: r.userId, name: r.name || r.email, image: r.image });
    assigneesByTask.set(r.taskId, arr);
  }

  const tasks = sprintTasks.map((t) => ({
    ...t,
    tags: tagsByTask.get(t.id) ?? [],
    assignees: assigneesByTask.get(t.id) ?? [],
  }));

  // Fetch statuses from every list that has tasks in this sprint.
  // Fall back to the first non-archived list in the space so the Create Task
  // modal always has a status set even when the sprint has no list-backed tasks.
  const listIds = [
    ...new Set(sprintTasks.filter((t) => t.listId).map((t) => t.listId!)),
  ];

  let allStatuses: {
    id: string;
    name: string;
    color: string;
    type: "OPEN" | "ACTIVE" | "CLOSED";
    orderIndex: number;
  }[] = [];
  // List new tasks should be created in (first list among the sprint's tasks,
  // else the space's first non-archived list).
  let defaultListId: string | null = listIds[0] ?? null;

  if (listIds.length > 0) {
    allStatuses = await db
      .select({
        id: listStatus.id,
        name: listStatus.name,
        color: listStatus.color,
        type: listStatus.type,
        orderIndex: listStatus.orderIndex,
      })
      .from(listStatus)
      .where(inArray(listStatus.listId, listIds))
      .orderBy(asc(listStatus.orderIndex));
  } else {
    // No list-backed tasks — use the first list in this space as a fallback
    const [firstList] = await db
      .select({ id: list.id })
      .from(list)
      .where(and(eq(list.spaceId, spaceId), eq(list.isArchived, false)))
      .orderBy(asc(list.createdAt))
      .limit(1);

    if (firstList) {
      defaultListId = firstList.id;
      allStatuses = await db
        .select({
          id: listStatus.id,
          name: listStatus.name,
          color: listStatus.color,
          type: listStatus.type,
          orderIndex: listStatus.orderIndex,
        })
        .from(listStatus)
        .where(eq(listStatus.listId, firstList.id))
        .orderBy(asc(listStatus.orderIndex));
    }
  }

  return { sprint: activeSprint, tasks, statuses: allStatuses, defaultListId };
}

// ─── getArchivedTasksForSprint ────────────────────────────────────────────────

export async function getArchivedTasksForSprint(
  workspaceId: string,
  spaceId: string
): Promise<
  | {
      tasks: {
        id: string;
        title: string;
        seqNumber: number;
        listId: string | null;
      }[];
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [activeSprint] = await db
    .select({ id: sprint.id })
    .from(sprint)
    .where(and(eq(sprint.spaceId, spaceId), eq(sprint.status, "ACTIVE")))
    .limit(1);

  if (!activeSprint) {
    return { tasks: [] };
  }

  const tasks = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      listId: task.listId,
    })
    .from(taskSprint)
    .innerJoin(task, eq(task.id, taskSprint.taskId))
    .where(
      and(
        eq(taskSprint.sprintId, activeSprint.id),
        notDeleted(),
        eq(task.isArchived, true),
        isNull(task.parentTaskId)
      )
    )
    .orderBy(asc(task.orderIndex));

  return { tasks };
}

// ─── bulkMoveTasksToSprint ────────────────────────────────────────────────────

export async function bulkMoveTasksToSprint(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  taskIds: string[],
  targetSprintId: string
): Promise<{ ok: true; moved: number } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  if (taskIds.length === 0) {
    return { ok: true, moved: 0 };
  }

  const [target] = await db
    .select({ id: sprint.id, status: sprint.status })
    .from(sprint)
    .where(and(eq(sprint.id, targetSprintId), eq(sprint.spaceId, spaceId)))
    .limit(1);

  if (!target) {
    return { error: "Sprint not found" };
  }
  if (target.status === "CLOSED") {
    return { error: "Cannot move tasks into a closed sprint" };
  }

  let moved = 0;
  for (const taskId of taskIds) {
    const existing = await db
      .select({ taskId: taskSprint.taskId, sprintId: taskSprint.sprintId })
      .from(taskSprint)
      .innerJoin(sprint, eq(taskSprint.sprintId, sprint.id))
      .where(
        and(
          eq(taskSprint.taskId, taskId),
          inArray(sprint.status, ["PLANNED", "ACTIVE"])
        )
      )
      .limit(1);

    if (existing.length > 0) {
      if (existing[0].sprintId === targetSprintId) {
        continue;
      }
      await db
        .delete(taskSprint)
        .where(
          and(
            eq(taskSprint.taskId, taskId),
            eq(taskSprint.sprintId, existing[0].sprintId)
          )
        );
    }

    await db.insert(taskSprint).values({
      taskId,
      sprintId: targetSprintId,
      points: null,
      addedAt: new Date(),
    });
    moved++;
  }

  if (listId) {
    revalidateList(workspaceId, spaceId, listId);
  } else {
    revalidateSpace(workspaceId, spaceId);
  }
  return { ok: true, moved };
}

// ─── bulkRemoveTasksFromSprint ────────────────────────────────────────────────

export async function bulkRemoveTasksFromSprint(
  workspaceId: string,
  spaceId: string,
  sprintId: string,
  taskIds: string[]
): Promise<{ ok: true; removed: number } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  if (taskIds.length === 0) {
    return { ok: true, removed: 0 };
  }

  await db
    .delete(taskSprint)
    .where(
      and(
        eq(taskSprint.sprintId, sprintId),
        inArray(taskSprint.taskId, taskIds)
      )
    );

  revalidateSpace(workspaceId, spaceId);
  return { ok: true, removed: taskIds.length };
}

// ─── getClosedSprintView ──────────────────────────────────────────────────────
// Full data for rendering a closed (or any) sprint — assignees, tags, points.

export type ClosedSprintTask = {
  id: string;
  title: string;
  seqNumber: number;
  priority: string | null;
  statusId: string | null;
  listId: string | null;
  orderIndex: number;
  dueDateStart: Date | null;
  dueDateEnd: Date | null;
  statusName: string | null;
  statusColor: string | null;
  statusType: string | null;
  storyPoints: number | null;
  tags: { id: string; name: string; color: string }[];
  assignees: { userId: string; name: string; image: string | null }[];
};

export async function getClosedSprintView(
  workspaceId: string,
  spaceId: string,
  sprintId: string
): Promise<
  | {
      sprint: {
        id: string;
        name: string;
        goal: string | null;
        status: "PLANNED" | "ACTIVE" | "CLOSED";
        startDate: Date | null;
        endDate: Date | null;
      };
      tasks: ClosedSprintTask[];
      stats: {
        totalTasks: number;
        closedTasks: number;
        totalPoints: number;
        closedPoints: number;
      };
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [targetSprint] = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.spaceId, spaceId)))
    .limit(1);

  if (!targetSprint) {
    return { error: "Sprint not found" };
  }

  const sprintTasks = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      priority: task.priority,
      statusId: task.statusId,
      listId: task.listId,
      orderIndex: task.orderIndex,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      statusName: listStatus.name,
      statusColor: listStatus.color,
      statusType: listStatus.type,
      storyPoints: taskSprint.points,
    })
    .from(taskSprint)
    .innerJoin(task, eq(task.id, taskSprint.taskId))
    .leftJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(
      and(
        eq(taskSprint.sprintId, sprintId),
        notDeleted(),
        eq(task.isArchived, false)
      )
    )
    .orderBy(asc(task.orderIndex));

  if (sprintTasks.length === 0) {
    return {
      sprint: targetSprint,
      tasks: [],
      stats: { totalTasks: 0, closedTasks: 0, totalPoints: 0, closedPoints: 0 },
    };
  }

  const taskIds = sprintTasks.map((t) => t.id);

  const [tagRows, assigneeRows] = await Promise.all([
    db
      .select({
        taskId: taskTag.taskId,
        id: tag.id,
        name: tag.name,
        color: tag.color,
      })
      .from(taskTag)
      .innerJoin(tag, eq(taskTag.tagId, tag.id))
      .where(inArray(taskTag.taskId, taskIds)),
    db
      .select({
        taskId: taskAssignee.taskId,
        userId: taskAssignee.userId,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(taskAssignee)
      .innerJoin(user, eq(user.id, taskAssignee.userId))
      .where(inArray(taskAssignee.taskId, taskIds)),
  ]);

  const tagsByTask = new Map<
    string,
    { id: string; name: string; color: string }[]
  >();
  for (const r of tagRows) {
    const arr = tagsByTask.get(r.taskId) ?? [];
    arr.push({ id: r.id, name: r.name, color: r.color ?? "#9CA3AF" });
    tagsByTask.set(r.taskId, arr);
  }

  const assigneesByTask = new Map<
    string,
    { userId: string; name: string; image: string | null }[]
  >();
  for (const r of assigneeRows) {
    const arr = assigneesByTask.get(r.taskId) ?? [];
    arr.push({ userId: r.userId, name: r.name || r.email, image: r.image });
    assigneesByTask.set(r.taskId, arr);
  }

  const tasks: ClosedSprintTask[] = sprintTasks.map((t) => ({
    ...t,
    tags: tagsByTask.get(t.id) ?? [],
    assignees: assigneesByTask.get(t.id) ?? [],
  }));

  const totalTasks = tasks.length;
  const closedTasks = tasks.filter((t) => t.statusType === "CLOSED").length;
  const totalPoints = tasks.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
  const closedPoints = tasks
    .filter((t) => t.statusType === "CLOSED")
    .reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);

  return {
    sprint: targetSprint,
    tasks,
    stats: { totalTasks, closedTasks, totalPoints, closedPoints },
  };
}

// ─── getCreateSprintDefaults ──────────────────────────────────────────────────

export interface CreateSprintDefaults {
  durationWeeks: number;
  nameFormat: string;
  sprintNumber: number;
  sprintStartDay: number | null;
  suggestedName: string;
  suggestedStartDate: Date | null;
}

export async function getCreateSprintDefaults(
  workspaceId: string,
  spaceId: string
): Promise<CreateSprintDefaults | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [settings, lastSprintRow] = await Promise.all([
    db
      .select({
        sprintStartDay: space.sprintStartDay,
        sprintDefaultDurationWeeks: space.sprintDefaultDurationWeeks,
        sprintNameFormat: space.sprintNameFormat,
      })
      .from(space)
      .where(eq(space.id, spaceId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        id: sprint.id,
        name: sprint.name,
        endDate: sprint.endDate,
        createdAt: sprint.createdAt,
      })
      .from(sprint)
      .where(eq(sprint.spaceId, spaceId))
      .orderBy(desc(sprint.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  if (!settings) {
    return { error: "Space not found" };
  }

  const durationWeeks = settings.sprintDefaultDurationWeeks;
  const nameFormat = settings.sprintNameFormat;
  const startDay = settings.sprintStartDay ?? 1; // default Monday

  // Infer sprint number from name of last sprint
  let sprintNumber = 1;
  if (lastSprintRow) {
    const match = lastSprintRow.name.match(/(\d+)\s*$/);
    if (match) {
      sprintNumber = Number.parseInt(match[1], 10) + 1;
    } else {
      sprintNumber = 2;
    }
  }

  // Compute suggested start date: lastSprint.endDate + 1 day, snapped to startDay
  let suggestedStartDate: Date | null = null;
  if (lastSprintRow?.endDate) {
    const afterLast = addDays(new Date(lastSprintRow.endDate), 1);
    // Snap forward to next occurrence of startDay
    const dayOfWeek = afterLast.getDay();
    const daysUntilStart = (startDay - dayOfWeek + 7) % 7;
    suggestedStartDate = addDays(afterLast, daysUntilStart);
  } else {
    // No prior sprint: next occurrence of startDay from today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay();
    const daysUntilStart = (startDay - dayOfWeek + 7) % 7;
    suggestedStartDate =
      daysUntilStart === 0 ? today : addDays(today, daysUntilStart);
  }

  const suggestedName = nameFormat
    .replace("{n}", String(sprintNumber))
    .replace("{project}", "");

  return {
    sprintNumber,
    suggestedName: suggestedName.trim(),
    suggestedStartDate,
    durationWeeks,
    nameFormat,
    sprintStartDay: settings.sprintStartDay,
  };
}

// ─── getSprintSettings ────────────────────────────────────────────────────────

export interface SprintSettings {
  sprintAutoArchiveAfterN: number | null;
  sprintAutoCreateNext: boolean;
  sprintAutoMarkDone: boolean;
  sprintAutoMoveIncomplete: boolean;
  sprintDateFormat: string;
  sprintDefaultDurationWeeks: number;
  sprintNameFormat: string;
  sprintStartDay: number | null;
}

export async function getSprintSettings(
  workspaceId: string,
  spaceId: string
): Promise<SprintSettings | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [row] = await db
    .select({
      sprintStartDay: space.sprintStartDay,
      sprintDefaultDurationWeeks: space.sprintDefaultDurationWeeks,
      sprintNameFormat: space.sprintNameFormat,
      sprintDateFormat: space.sprintDateFormat,
      sprintAutoMarkDone: space.sprintAutoMarkDone,
      sprintAutoCreateNext: space.sprintAutoCreateNext,
      sprintAutoMoveIncomplete: space.sprintAutoMoveIncomplete,
      sprintAutoArchiveAfterN: space.sprintAutoArchiveAfterN,
    })
    .from(space)
    .where(eq(space.id, spaceId))
    .limit(1);

  if (!row) {
    return { error: "Space not found" };
  }
  return row;
}

// ─── saveSprintSettings ───────────────────────────────────────────────────────

export async function saveSprintSettings(
  workspaceId: string,
  spaceId: string,
  settings: SprintSettings
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  await db
    .update(space)
    .set({
      sprintStartDay: settings.sprintStartDay,
      sprintDefaultDurationWeeks: settings.sprintDefaultDurationWeeks,
      sprintNameFormat: settings.sprintNameFormat,
      sprintDateFormat: settings.sprintDateFormat,
      sprintAutoMarkDone: settings.sprintAutoMarkDone,
      sprintAutoCreateNext: settings.sprintAutoCreateNext,
      sprintAutoMoveIncomplete: settings.sprintAutoMoveIncomplete,
      sprintAutoArchiveAfterN: settings.sprintAutoArchiveAfterN,
      updatedAt: new Date(),
    })
    .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)));

  revalidateSpace(workspaceId, spaceId);
  return { ok: true };
}
