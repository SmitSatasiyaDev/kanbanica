import { createId } from "@paralleldrive/cuid2";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  checklist,
  checklistItem,
  customFieldDefinition,
  customFieldValue,
  list,
  listStatus,
  space,
  tag,
  task,
  taskAssignee,
  taskAttachment,
  taskDependency,
  taskDescriptionSnapshot,
  taskTag,
  taskWatcher,
  timeEntry,
  user,
  workspace,
  workspaceMember,
} from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { db } from "@/lib/db";
import { isOptionalDay } from "@/lib/due-date";
import {
  extractInlineAttachmentIds,
  extractMentionIds,
  toTiptapDoc,
} from "@/lib/notes";
import { createNotifications } from "@/lib/notifications/create-notification";
import {
  canAccessSpace,
  getAccessibleSpaceIds,
  getSpacePermission,
  getWorkspaceMembership,
  hasPermissionLevel,
  requireEditAccess,
  requireViewAccess,
} from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import {
  type Actor,
  actorDisplayName,
  READ_ONLY_ERROR,
  withActorSource,
} from "@/lib/services/actor";
import {
  type CommentPageKey,
  type CommentWithReplies,
  loadCommentsPage,
} from "@/lib/services/comment-service";
import {
  encodeCursor,
  INVALID_CURSOR_ERROR,
  pageOf,
  readCursor,
} from "@/lib/services/cursor";
import {
  effectiveTaskSpaceId,
  resolveTaskContext,
  type TaskContext,
  taskRevalidatePaths,
} from "@/lib/services/task-context";
import { storage } from "@/lib/storage";
import { notDeleted } from "@/lib/task-visibility";
import { requireTaskCapacity } from "@/lib/workspace-limits";

export type TaskServiceError = { error: string };

const NO_LIST_ERROR = "This task is not in a list, so it has no statuses.";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MyTask {
  dueDateEnd: string | null;
  dueDateStart: string | null;
  id: string;
  list: { id: string; name: string };
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  seqNumber: number;
  space: {
    id: string;
    name: string;
    color: string | null;
    logoEmoji: string | null;
  };
  status: {
    id: string;
    name: string;
    color: string;
    type: "OPEN" | "ACTIVE" | "CLOSED";
  };
  tags: { id: string; name: string; color: string }[];
  title: string;
  workspace: { id: string; name: string };
}

export type SearchTaskResult = {
  id: string;
  title: string;
  seqNumber: number;
  priority: string;
  statusId: string | null;
  statusName: string | null;
  statusColor: string | null;
  statusType: string | null;
  listId: string | null;
  listName: string | null;
  spaceId: string;
  spaceName: string;
  dueDateEnd: string | null;
  isArchived: boolean;
  // Last-update time as the database prints it, for paging.
  sortKey: string;
  assignees: { userId: string; name: string | null; email: string | null }[];
};

export const DEFAULT_MY_TASKS_LIMIT = 50;
export const MAX_MY_TASKS_LIMIT = 200;
export const DEFAULT_SEARCH_LIMIT = 25;
export const MAX_SEARCH_LIMIT = 100;
export const MIN_SEARCH_QUERY_LENGTH = 2;

function clampLimit(
  value: number | undefined,
  fallback: number,
  max: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), 1), max);
}

// Whether the actor may use this workspace at all. Web actors fall back to the
// existing space-based checks; MCP actors need an ACTIVE non-guest membership
// and must be inside their token's workspace restriction.
async function actorCanUseWorkspace(
  actor: Actor,
  workspaceId: string
): Promise<boolean> {
  if (actor.workspaceId && actor.workspaceId !== workspaceId) {
    return false;
  }
  if (actor.source === "mcp") {
    const membership = await getWorkspaceMembership(actor.userId, workspaceId);
    return !!membership && membership.role !== "GUEST";
  }
  return true;
}

// ─── listWorkspaces ───────────────────────────────────────────────────────────

// The ACTIVE workspaces the actor belongs to, after the token's workspace
// restriction. Over MCP, workspaces where the user is a guest are left out.
export async function listWorkspaces(
  actor: Actor
): Promise<{ ok: true; workspaces: { id: string; name: string }[] }> {
  const rows = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
    .where(
      and(
        eq(workspaceMember.userId, actor.userId),
        eq(workspaceMember.status, "ACTIVE"),
        eq(workspace.status, "ACTIVE")
      )
    );
  const workspaces = rows
    .filter(
      (w) =>
        (!actor.workspaceId || w.id === actor.workspaceId) &&
        !(actor.source === "mcp" && w.role === "GUEST")
    )
    .map((w) => ({ id: w.id, name: w.name }));
  return { ok: true, workspaces };
}

// ─── listMyTasks ──────────────────────────────────────────────────────────────

// Tasks assigned to the actor across ALL their workspaces (or one, when
// `workspaceId` or the token restriction is set), respecting the space access
// model. Completed tasks are left out unless `includeCompleted`.
//
// `limit` defaults to 50 and is capped at 200. `null` means "no limit" and is
// only meant for the web My Tasks page, which has always loaded everything.
export async function listMyTasks(
  actor: Actor,
  opts: {
    workspaceId?: string;
    includeCompleted?: boolean;
    limit?: number | null;
    // Continue after the last task of a previous page.
    cursor?: string;
  } = {}
): Promise<
  { ok: true; tasks: MyTask[]; nextCursor?: string | null } | TaskServiceError
> {
  const after = opts.cursor ? readCursor("my_tasks", opts.cursor) : null;
  if (opts.cursor && !after) {
    return { error: INVALID_CURSOR_ERROR };
  }
  if (
    actor.workspaceId &&
    opts.workspaceId &&
    actor.workspaceId !== opts.workspaceId
  ) {
    return { ok: true, tasks: [] };
  }
  const onlyWorkspaceId = opts.workspaceId ?? actor.workspaceId ?? null;

  // Every ACTIVE workspace the user belongs to.
  const memberships = await db
    .select({
      workspaceId: workspaceMember.workspaceId,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
    .where(
      and(
        eq(workspaceMember.userId, actor.userId),
        eq(workspaceMember.status, "ACTIVE"),
        eq(workspace.status, "ACTIVE")
      )
    );
  // Guests get no token access, so MCP actors skip workspaces where they are one.
  const workspaces = memberships.filter(
    (w) =>
      (!onlyWorkspaceId || w.workspaceId === onlyWorkspaceId) &&
      !(actor.source === "mcp" && w.role === "GUEST")
  );
  if (workspaces.length === 0) {
    return { ok: true, tasks: [] };
  }

  // Union of accessible space ids across those workspaces.
  const spaceIdLists = await Promise.all(
    workspaces.map((w) => getAccessibleSpaceIds(actor.userId, w.workspaceId))
  );
  const accessibleSpaceIds = [...new Set(spaceIdLists.flat())];
  if (accessibleSpaceIds.length === 0) {
    return { ok: true, tasks: [] };
  }

  // Tasks assigned to me in accessible spaces, not archived
  const assignedTaskIds = await db
    .select({ taskId: taskAssignee.taskId })
    .from(taskAssignee)
    .where(eq(taskAssignee.userId, actor.userId));

  if (assignedTaskIds.length === 0) {
    return { ok: true, tasks: [] };
  }

  const taskIds = assignedTaskIds.map((r) => r.taskId);

  const conditions: SQL[] = [
    inArray(task.id, taskIds),
    inArray(space.id, accessibleSpaceIds),
    notDeleted(),
    eq(task.isArchived, false),
    eq(list.isArchived, false),
  ];
  if (!opts.includeCompleted) {
    conditions.push(ne(listStatus.type, "CLOSED"));
  }

  // Soonest due first; tasks without a date last. The sort keys use a far
  // future day for "no date", so a plain row comparison pages correctly.
  const sortEnd = sql`coalesce(${task.dueDateEnd}, date '9999-12-31')`;
  const sortStart = sql`coalesce(${task.dueDateStart}, date '9999-12-31')`;
  if (after) {
    conditions.push(
      sql`(${sortEnd}, ${sortStart}, ${task.id}) > (${after.e ?? "9999-12-31"}::date, ${after.s ?? "9999-12-31"}::date, ${after.id})`
    );
  }

  const baseQuery = db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      priority: task.priority,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      statusId: listStatus.id,
      statusName: listStatus.name,
      statusColor: listStatus.color,
      statusType: listStatus.type,
      listId: list.id,
      listName: list.name,
      spaceId: space.id,
      spaceName: space.name,
      spaceColor: space.color,
      spaceLogoEmoji: space.logoEmoji,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    })
    .from(task)
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .innerJoin(list, eq(task.listId, list.id))
    .innerJoin(space, eq(list.spaceId, space.id))
    .innerJoin(workspace, eq(space.workspaceId, workspace.id))
    .where(and(...conditions))
    .orderBy(sortEnd, sortStart, asc(task.id));
  // One row more than the page, to know whether another page exists.
  const pageSize =
    opts.limit === null
      ? null
      : clampLimit(opts.limit, DEFAULT_MY_TASKS_LIMIT, MAX_MY_TASKS_LIMIT);
  const fetched =
    pageSize === null ? await baseQuery : await baseQuery.limit(pageSize + 1);
  const { items: rows, hasMore } =
    pageSize === null
      ? { items: fetched, hasMore: false }
      : pageOf(fetched, pageSize);

  // Fetch tags for these tasks
  const allTaskIds = rows.map((r) => r.id);
  const tagRows =
    allTaskIds.length > 0
      ? await db
          .select({
            taskId: taskTag.taskId,
            tagId: tag.id,
            tagName: tag.name,
            tagColor: tag.color,
          })
          .from(taskTag)
          .innerJoin(tag, eq(taskTag.tagId, tag.id))
          .where(inArray(taskTag.taskId, allTaskIds))
      : [];

  const tagsByTask = new Map<
    string,
    { id: string; name: string; color: string }[]
  >();
  for (const t of tagRows) {
    const existing = tagsByTask.get(t.taskId) ?? [];
    existing.push({ id: t.tagId, name: t.tagName, color: t.tagColor });
    tagsByTask.set(t.taskId, existing);
  }

  const tasks: MyTask[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    seqNumber: r.seqNumber,
    priority: r.priority as MyTask["priority"],
    dueDateStart: r.dueDateStart,
    dueDateEnd: r.dueDateEnd,
    status: {
      id: r.statusId,
      name: r.statusName,
      color: r.statusColor,
      type: r.statusType as MyTask["status"]["type"],
    },
    list: { id: r.listId, name: r.listName },
    space: {
      id: r.spaceId,
      name: r.spaceName,
      color: r.spaceColor,
      logoEmoji: r.spaceLogoEmoji,
    },
    workspace: { id: r.workspaceId, name: r.workspaceName },
    tags: tagsByTask.get(r.id) ?? [],
  }));

  const lastTask = tasks[tasks.length - 1];
  return {
    ok: true,
    tasks,
    nextCursor:
      hasMore && lastTask
        ? encodeCursor("my_tasks", {
            e: lastTask.dueDateEnd,
            s: lastTask.dueDateStart,
            id: lastTask.id,
          })
        : null,
  };
}

// ─── Task search ──────────────────────────────────────────────────────────────

// Title OR description OR any custom field value matches `q` (already
// `%...%`-wrapped), via a correlated EXISTS so this stays N+1-free.
// SINGLE_SELECT/MULTI_SELECT values are stored as opaque option ids, not
// labels, so the nested EXISTS resolves customFieldDefinition.config's
// option list and matches the query against option labels instead.
function matchesTaskTextSearch(q: string): SQL {
  return sql`(
    ${task.title} ILIKE ${q}
    OR ${task.description}::text ILIKE ${q}
    OR EXISTS (
      SELECT 1 FROM ${customFieldValue}
      INNER JOIN ${customFieldDefinition} ON ${customFieldDefinition.id} = ${customFieldValue.fieldId}
      WHERE ${customFieldValue.taskId} = ${task.id}
        AND (
          ${customFieldValue.value}::text ILIKE ${q}
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(${customFieldDefinition.config}->'options', '[]'::jsonb)) AS opt
            WHERE (opt->>'label') ILIKE ${q}
              AND (
                ${customFieldValue.value} = to_jsonb(opt->>'id')
                OR ${customFieldValue.value} @> jsonb_build_array(opt->>'id')
              )
          )
        )
    )
  )`;
}

// The task query shared by the web omnibox (`globalSearch`) and the MCP
// `searchTasks`. Top-level, non-deleted tasks in lists that are not archived,
// inside `accessibleSpaceIds`, newest update first, with their assignees.
// Callers resolve access and build any filter conditions; this only runs SQL.
export async function queryTaskSearch(args: {
  workspaceId: string;
  accessibleSpaceIds: string[];
  // Raw text to match (not wrapped in %); omit for a filter-only search.
  text?: string;
  // Narrow to these spaces (the omnibox space filter, the MCP project id).
  spaceIds?: string[];
  // Extra conditions, e.g. from buildTaskFilterConditions.
  extraConditions?: SQL[];
  includeArchived: boolean;
  limit: number;
  // Continue after this position of a previous page (newest update first).
  after?: { updatedAt: string; id: string };
}): Promise<SearchTaskResult[]> {
  const conditions: SQL[] = [
    eq(task.workspaceId, args.workspaceId),
    notDeleted(),
    isNull(task.parentTaskId),
    eq(list.isArchived, false),
    inArray(space.id, args.accessibleSpaceIds),
  ];
  if (!args.includeArchived) {
    conditions.push(eq(task.isArchived, false));
  }
  if (args.text) {
    conditions.push(matchesTaskTextSearch(`%${args.text}%`));
  }
  if (args.spaceIds?.length) {
    conditions.push(inArray(space.id, args.spaceIds));
  }
  conditions.push(...(args.extraConditions ?? []));
  if (args.after) {
    conditions.push(
      sql`(${task.updatedAt}, ${task.id}) < (${args.after.updatedAt}::timestamptz, ${args.after.id})`
    );
  }

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
      listId: list.id,
      listName: list.name,
      spaceId: space.id,
      spaceName: space.name,
      dueDateEnd: task.dueDateEnd,
      isArchived: task.isArchived,
      sortKey: sql<string>`${task.updatedAt}::text`,
    })
    .from(task)
    .innerJoin(list, eq(task.listId, list.id))
    .innerJoin(space, eq(list.spaceId, space.id))
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(and(...conditions))
    .orderBy(desc(task.updatedAt), desc(task.id))
    .limit(args.limit);

  // Fetch assignees for found tasks (batched — no N+1).
  const taskIds = taskRows.map((t) => t.id);
  const assigneeMap: Record<
    string,
    { userId: string; name: string | null; email: string | null }[]
  > = {};
  if (taskIds.length > 0) {
    const assigneeRows = await db
      .select({
        taskId: taskAssignee.taskId,
        userId: taskAssignee.userId,
        name: user.name,
        email: user.email,
      })
      .from(taskAssignee)
      .innerJoin(user, eq(taskAssignee.userId, user.id))
      .where(inArray(taskAssignee.taskId, taskIds));

    for (const row of assigneeRows) {
      if (!assigneeMap[row.taskId]) {
        assigneeMap[row.taskId] = [];
      }
      assigneeMap[row.taskId].push({
        userId: row.userId,
        name: row.name,
        email: row.email,
      });
    }
  }

  return taskRows.map((t) => ({
    ...t,
    assignees: assigneeMap[t.id] ?? [],
  }));
}

// Text search over the tasks of one workspace the actor can see.
export async function searchTasks(
  actor: Actor,
  opts: {
    workspaceId: string;
    query: string;
    projectId?: string;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
  }
): Promise<
  | { ok: true; tasks: SearchTaskResult[]; nextCursor?: string | null }
  | TaskServiceError
> {
  const text = opts.query.trim();
  if (text.length < MIN_SEARCH_QUERY_LENGTH) {
    return { error: "Search text must be at least 2 characters." };
  }
  const after = opts.cursor ? readCursor("search", opts.cursor) : null;
  if (opts.cursor && !after) {
    return { error: INVALID_CURSOR_ERROR };
  }
  if (!(await actorCanUseWorkspace(actor, opts.workspaceId))) {
    return { error: "Workspace not found" };
  }

  const accessibleSpaceIds = await getAccessibleSpaceIds(
    actor.userId,
    opts.workspaceId
  );
  if (accessibleSpaceIds.length === 0) {
    return { ok: true, tasks: [] };
  }

  const pageSize = clampLimit(
    opts.limit,
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_LIMIT
  );
  const found = await queryTaskSearch({
    workspaceId: opts.workspaceId,
    accessibleSpaceIds,
    text,
    spaceIds: opts.projectId ? [opts.projectId] : undefined,
    includeArchived: opts.includeArchived ?? false,
    // One row more than the page, to know whether another page exists.
    limit: pageSize + 1,
    after: after ? { updatedAt: after.u, id: after.id } : undefined,
  });
  const { items: tasks, hasMore } = pageOf(found, pageSize);
  const last = tasks[tasks.length - 1];
  return {
    ok: true,
    tasks,
    nextCursor:
      hasMore && last
        ? encodeCursor("search", { u: last.sortKey, id: last.id })
        : null,
  };
}

// ─── Task detail ──────────────────────────────────────────────────────────────

// Everything the task page needs, for one task the actor can view. Used by
// `getTaskDetail` (web) and, with comments and attachments added, by `getTask`.
export async function loadTaskDetail(actor: Actor, taskId: string) {
  // The real location comes from the task row, so access to one project never
  // opens a task in another.
  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId } = ctx;

  // No access looks the same as a missing task, so ids can't be probed.
  const permErr = await requireViewAccess(actor.userId, workspaceId, spaceId);
  if (permErr) {
    return { error: "Task not found" };
  }

  // Whether the viewer can edit (add/remove dependencies). View-only users see
  // dependencies but no add/remove controls; the server still enforces this.
  const permission = await getSpacePermission(
    actor.userId,
    workspaceId,
    spaceId
  );
  const canEdit = permission !== null && hasPermissionLevel(permission, "edit");

  const [t] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), notDeleted()))
    .limit(1);
  if (!t) {
    return { error: "Task not found" };
  }

  const [
    assignees,
    watchers,
    tags,
    checklists,
    blockedBy,
    blocks,
    timeEntries,
    statuses,
    snapshot,
    subtasks,
    parentTaskInfo,
  ] = await Promise.all([
    db
      .select({
        userId: taskAssignee.userId,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(taskAssignee)
      .leftJoin(user, eq(user.id, taskAssignee.userId))
      .where(eq(taskAssignee.taskId, taskId)),

    db
      .select({
        userId: taskWatcher.userId,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(taskWatcher)
      .leftJoin(user, eq(user.id, taskWatcher.userId))
      .where(eq(taskWatcher.taskId, taskId)),

    db
      .select({ id: tag.id, name: tag.name, color: tag.color })
      .from(taskTag)
      .innerJoin(tag, eq(taskTag.tagId, tag.id))
      .where(eq(taskTag.taskId, taskId)),

    db
      .select()
      .from(checklist)
      .where(eq(checklist.taskId, taskId))
      .orderBy(asc(checklist.orderIndex))
      .then(async (cls) => {
        if (cls.length === 0) {
          return [];
        }
        const items = await db
          .select()
          .from(checklistItem)
          .where(
            inArray(
              checklistItem.checklistId,
              cls.map((c) => c.id)
            )
          )
          .orderBy(asc(checklistItem.orderIndex));
        return cls.map((c) => ({
          ...c,
          items: items.filter((i) => i.checklistId === c.id),
        }));
      }),

    // "Blocked by" — tasks this task depends on (stored: this → dependsOn)
    db
      .select({
        id: taskDependency.id,
        taskId: task.id,
        seqNumber: task.seqNumber,
        title: task.title,
        statusName: listStatus.name,
        statusColor: listStatus.color,
        statusType: listStatus.type,
        spaceId: task.spaceId,
        spaceName: space.name,
        listId: task.listId,
        listName: list.name,
      })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.dependsOnTaskId, task.id))
      .leftJoin(listStatus, eq(listStatus.id, task.statusId))
      .leftJoin(space, eq(space.id, task.spaceId))
      .leftJoin(list, eq(list.id, task.listId))
      .where(and(eq(taskDependency.taskId, taskId), notDeleted())),

    // "Blocks" — tasks that depend on this task (reverse edge, generated in UI)
    db
      .select({
        id: taskDependency.id,
        taskId: task.id,
        seqNumber: task.seqNumber,
        title: task.title,
        statusName: listStatus.name,
        statusColor: listStatus.color,
        statusType: listStatus.type,
        spaceId: task.spaceId,
        spaceName: space.name,
        listId: task.listId,
        listName: list.name,
      })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.taskId, task.id))
      .leftJoin(listStatus, eq(listStatus.id, task.statusId))
      .leftJoin(space, eq(space.id, task.spaceId))
      .leftJoin(list, eq(list.id, task.listId))
      .where(and(eq(taskDependency.dependsOnTaskId, taskId), notDeleted())),

    // Time entries (seconds-based). Running rows have `endTime`/`durationSeconds`
    // NULL. Newest-first; joined to the user for the history list.
    db
      .select({
        id: timeEntry.id,
        userId: timeEntry.userId,
        startTime: timeEntry.startTime,
        endTime: timeEntry.endTime,
        durationSeconds: timeEntry.durationSeconds,
        description: timeEntry.description,
        userName: user.name,
        userImage: user.image,
      })
      .from(timeEntry)
      .leftJoin(user, eq(user.id, timeEntry.userId))
      .where(eq(timeEntry.taskId, taskId))
      .orderBy(desc(timeEntry.startTime)),

    t.listId
      ? db
          .select()
          .from(listStatus)
          .where(eq(listStatus.listId, t.listId))
          .orderBy(asc(listStatus.orderIndex))
      : Promise.resolve([]),

    db
      .select()
      .from(taskDescriptionSnapshot)
      .where(eq(taskDescriptionSnapshot.taskId, taskId))
      .limit(1)
      .then((r) => r[0] ?? null),

    db
      .select({
        id: task.id,
        seqNumber: task.seqNumber,
        title: task.title,
        priority: task.priority,
        statusId: task.statusId,
        listId: task.listId,
        dueDateStart: task.dueDateStart,
        dueDateEnd: task.dueDateEnd,
        orderIndex: task.orderIndex,
        statusName: listStatus.name,
        statusColor: listStatus.color,
        statusType: listStatus.type,
      })
      .from(task)
      .leftJoin(listStatus, eq(listStatus.id, task.statusId))
      .where(
        and(
          eq(task.parentTaskId, taskId),
          eq(task.isArchived, false),
          notDeleted()
        )
      )
      .orderBy(asc(task.orderIndex)),

    t.parentTaskId
      ? db
          .select({ id: task.id, title: task.title, seqNumber: task.seqNumber })
          .from(task)
          .where(eq(task.id, t.parentTaskId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  // Attach each subtask's assignees (one grouped query for all subtask ids) so
  // the subtask rows can show + edit assignees inline.
  const subtaskIds = subtasks.map((s) => s.id);
  const subtaskAssigneeRows =
    subtaskIds.length > 0
      ? await db
          .select({
            taskId: taskAssignee.taskId,
            userId: taskAssignee.userId,
            name: user.name,
            email: user.email,
            image: user.image,
          })
          .from(taskAssignee)
          .leftJoin(user, eq(user.id, taskAssignee.userId))
          .where(inArray(taskAssignee.taskId, subtaskIds))
      : [];
  const subtasksWithAssignees = subtasks.map((s) => ({
    ...s,
    assignees: subtaskAssigneeRows
      .filter((a) => a.taskId === s.id)
      .map((a) => ({
        userId: a.userId,
        name: a.name,
        email: a.email,
        image: a.image,
      })),
  }));

  return {
    ok: true as const,
    task: t,
    assignees,
    watchers,
    tags,
    checklists,
    blockedBy,
    blocks,
    timeEntries,
    statuses,
    snapshot,
    subtasks: subtasksWithAssignees,
    parentTask: parentTaskInfo,
    canEdit,
  };
}

export type TaskAttachmentSummary = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  isImage: boolean;
};

type TaskDetail = Extract<
  Awaited<ReturnType<typeof loadTaskDetail>>,
  { ok: true }
>;

export type FullTask = TaskDetail & {
  comments: CommentWithReplies[];
  // Cursor for the next page of older comments, null when there are none.
  commentsNextCursor: string | null;
  attachments: TaskAttachmentSummary[];
};

const TASK_COMMENT_LIMIT = 20;

// One task with its detail, the last 20 comments and its attachment list.
// Found by id, or by the per-workspace task number shown in the UI (`#123`).
//
// `commentsCursor` (from a previous result's `commentsNextCursor`) loads the 20
// comments before that point instead of the newest 20.
export async function getTask(
  actor: Actor,
  ref: { taskId: string } | { workspaceId: string; number: number },
  opts: { commentsCursor?: string } = {}
): Promise<TaskServiceError | FullTask> {
  const before = opts.commentsCursor
    ? readCursor("comments", opts.commentsCursor)
    : null;
  if (opts.commentsCursor && !before) {
    return { error: INVALID_CURSOR_ERROR };
  }
  let taskId: string;
  if ("taskId" in ref) {
    taskId = ref.taskId;
  } else {
    if (actor.workspaceId && actor.workspaceId !== ref.workspaceId) {
      return { error: "Task not found" };
    }
    // Numbers are unique per workspace in practice but have no unique index, so
    // take the oldest match.
    const [found] = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.workspaceId, ref.workspaceId),
          eq(task.seqNumber, ref.number),
          notDeleted()
        )
      )
      .orderBy(asc(task.createdAt))
      .limit(1);
    if (!found) {
      return { error: "Task not found" };
    }
    taskId = found.id;
  }

  const detail = await loadTaskDetail(actor, taskId);
  if (!("task" in detail)) {
    return { error: "Task not found" };
  }

  const [commentPage, attachmentRows] = await Promise.all([
    loadCommentsPage(taskId, {
      limit: TASK_COMMENT_LIMIT,
      before: before
        ? ({ createdAt: before.c, id: before.i } as CommentPageKey)
        : undefined,
    }),
    db
      .select({
        id: taskAttachment.id,
        fileName: taskAttachment.fileName,
        mimeType: taskAttachment.mimeType,
        size: taskAttachment.fileSize,
      })
      .from(taskAttachment)
      .where(eq(taskAttachment.taskId, taskId))
      .orderBy(asc(taskAttachment.createdAt)),
  ]);
  const attachments: TaskAttachmentSummary[] = attachmentRows.map((a) => ({
    ...a,
    isImage: a.mimeType.startsWith("image/"),
  }));

  return {
    ...(detail as TaskDetail),
    comments: commentPage.comments,
    commentsNextCursor: commentPage.nextKey
      ? encodeCursor("comments", {
          c: commentPage.nextKey.createdAt,
          i: commentPage.nextKey.id,
        })
      : null,
    attachments,
  };
}

// ─── Statuses ─────────────────────────────────────────────────────────────────

// The statuses of the task's own list, in board order.
export async function listTaskStatuses(
  actor: Actor,
  taskId: string
): Promise<
  | {
      ok: true;
      statuses: { id: string; name: string; type: string; color: string }[];
    }
  | TaskServiceError
> {
  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const permErr = await requireViewAccess(
    actor.userId,
    ctx.workspaceId,
    ctx.spaceId
  );
  if (permErr) {
    return { error: "Task not found" };
  }
  if (!ctx.listId) {
    return { error: NO_LIST_ERROR };
  }

  const statuses = await db
    .select({
      id: listStatus.id,
      name: listStatus.name,
      type: listStatus.type,
      color: listStatus.color,
    })
    .from(listStatus)
    .where(eq(listStatus.listId, ctx.listId))
    .orderBy(asc(listStatus.orderIndex));
  return { ok: true, statuses };
}

function revalidateTask(ctx: TaskContext) {
  void refreshWorkspace(ctx.workspaceId, taskRevalidatePaths(ctx), {
    taskId: ctx.taskId,
  });
}

// Moves a task to another status. Needs Edit on the task's project.
//
// `sameListOnly: true` (MCP) only accepts a status of the task's own list.
// `false` (web) accepts any status of a list in the same project, because the
// Sprint board assigns statuses across the lists of a project.
export async function setTaskStatus(
  actor: Actor,
  taskId: string,
  statusId: string,
  opts: { sameListOnly: boolean }
): Promise<
  | {
      ok: true;
      status: { id: string; name: string; type: string };
      changed: boolean;
    }
  | TaskServiceError
> {
  if (actor.scope === "read") {
    return { error: READ_ONLY_ERROR };
  }

  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId } = ctx;

  // Changing a status is an edit: view-only members cannot do it.
  const permErr = await requireEditAccess(actor.userId, workspaceId, spaceId);
  if (permErr) {
    return permErr;
  }

  if (opts.sameListOnly && !ctx.listId) {
    return { error: NO_LIST_ERROR };
  }

  // The target status must exist and belong to the task's own list
  // (`sameListOnly`) or to a list in the task's own space.
  const [newStatus] = await db
    .select({
      id: listStatus.id,
      name: listStatus.name,
      type: listStatus.type,
    })
    .from(listStatus)
    .innerJoin(list, eq(listStatus.listId, list.id))
    .where(
      and(
        eq(listStatus.id, statusId),
        opts.sameListOnly && ctx.listId
          ? eq(listStatus.listId, ctx.listId)
          : eq(list.spaceId, spaceId)
      )
    )
    .limit(1);
  if (!newStatus) {
    return { error: "Status not found" };
  }

  const updated = await db
    .update(task)
    .set({ statusId, updatedAt: new Date() })
    .where(and(eq(task.id, taskId), notDeleted()))
    .returning({ id: task.id });
  if (updated.length === 0) {
    return { error: "Task not found" };
  }

  // Only log + notify when the status actually changed — matches the priority
  // guard, so re-saving the same status (e.g. dropping on the same column)
  // doesn't spam the activity feed or watchers.
  const statusChanged = statusId !== ctx.statusId;
  if (statusChanged) {
    // The old status name is stored as a snapshot in the activity log (a status
    // can later be renamed or deleted); the new one was loaded above. The
    // activity feed reads `from_status_name` / `to_status_name` — without them
    // it renders "—".
    const [fromStatus] = ctx.statusId
      ? await db
          .select({ name: listStatus.name })
          .from(listStatus)
          .where(eq(listStatus.id, ctx.statusId))
          .limit(1)
      : [];

    await writeActivityLog(
      taskId,
      actor.userId,
      "status_changed",
      withActorSource(actor, {
        from: ctx.statusId,
        to: statusId,
        from_status_name: fromStatus?.name ?? null,
        to_status_name: newStatus.name,
      })
    );

    // Notify watchers of status change
    const taskWatchers = await db
      .select({ userId: taskWatcher.userId })
      .from(taskWatcher)
      .where(eq(taskWatcher.taskId, taskId));

    const watcherIds = taskWatchers.map((w) => w.userId);
    if (watcherIds.length > 0) {
      const actorName = actorDisplayName(actor);
      createNotifications({
        workspaceId,
        actorId: actor.userId,
        recipientIds: watcherIds,
        triggerType:
          newStatus.type === "CLOSED"
            ? "task_completed"
            : "task_status_changed",
        entityType: "TASK",
        entityId: taskId,
        title:
          newStatus.type === "CLOSED"
            ? `${actorName} completed "${ctx.title}"`
            : `${actorName} changed status of "${ctx.title}" to "${newStatus.name}"`,
        muteCheckEntityIds: [taskId],
      });
    }
  }

  revalidateTask(ctx);
  return { ok: true, status: newStatus, changed: statusChanged };
}

// Marks a task done: moves it to the first CLOSED status (by board order) of
// its own list.
export async function completeTask(actor: Actor, taskId: string) {
  if (actor.scope === "read") {
    return { error: READ_ONLY_ERROR };
  }
  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return { error: "Task not found" };
  }
  if (!ctx.listId) {
    return { error: NO_LIST_ERROR };
  }

  const [closed] = await db
    .select({ id: listStatus.id })
    .from(listStatus)
    .where(
      and(eq(listStatus.listId, ctx.listId), eq(listStatus.type, "CLOSED"))
    )
    .orderBy(asc(listStatus.orderIndex))
    .limit(1);
  if (!closed) {
    return { error: "This list has no completed status." };
  }

  return setTaskStatus(actor, taskId, closed.id, { sameListOnly: true });
}

// ─── Assignees ────────────────────────────────────────────────────────────────

// Adds or removes one assignee. `userId` defaults to the actor. Needs Edit on
// the task's project. Adding needs the user to be an ACTIVE workspace member and
// also makes them a watcher. `returnAssignees: false` skips the final list
// query (the web actions only need `{ ok: true }`).
export async function assignTask(
  actor: Actor,
  taskId: string,
  opts: { userId?: string; unassign?: boolean; returnAssignees?: boolean } = {}
): Promise<
  | {
      ok: true;
      assignees: {
        userId: string;
        name: string | null;
        email: string | null;
      }[];
    }
  | TaskServiceError
> {
  if (actor.scope === "read") {
    return { error: READ_ONLY_ERROR };
  }

  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId } = ctx;
  const targetUserId = opts.userId ?? actor.userId;

  const permission = await getSpacePermission(
    actor.userId,
    workspaceId,
    spaceId
  );
  if (permission === null || !hasPermissionLevel(permission, "edit")) {
    return { error: "Forbidden" };
  }

  if (opts.unassign) {
    await db
      .delete(taskAssignee)
      .where(
        and(
          eq(taskAssignee.taskId, taskId),
          eq(taskAssignee.userId, targetUserId)
        )
      );

    const [removedUser] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, targetUserId))
      .limit(1);
    await writeActivityLog(
      taskId,
      actor.userId,
      "assignee_removed",
      withActorSource(actor, {
        userId: targetUserId,
        user_name: removedUser?.name ?? removedUser?.email ?? "someone",
      })
    );

    if (targetUserId !== actor.userId) {
      createNotifications({
        workspaceId,
        actorId: actor.userId,
        recipientIds: [targetUserId],
        triggerType: "task_unassigned",
        entityType: "TASK",
        entityId: taskId,
        title: `You were unassigned from "${ctx.title}"`,
        muteCheckEntityIds: [taskId],
      });
    }
  } else {
    // Verify assignee is active in workspace
    const assigneeMembership = await getWorkspaceMembership(
      targetUserId,
      workspaceId
    );
    if (assigneeMembership?.status !== "ACTIVE") {
      return { error: "User is not an active workspace member" };
    }

    await db
      .insert(taskAssignee)
      .values({ taskId, userId: targetUserId })
      .onConflictDoNothing();

    // Auto-watch assignee
    await db
      .insert(taskWatcher)
      .values({ taskId, userId: targetUserId })
      .onConflictDoNothing();

    // Notify the assignee (skip if assigning to yourself)
    if (targetUserId !== actor.userId) {
      createNotifications({
        workspaceId,
        actorId: actor.userId,
        recipientIds: [targetUserId],
        triggerType: "task_assigned",
        entityType: "TASK",
        entityId: taskId,
        title: `${actorDisplayName(actor)} assigned you to "${ctx.title}"`,
        muteCheckEntityIds: [taskId],
      });
    }

    const [assigneeUser] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, targetUserId))
      .limit(1);
    await writeActivityLog(
      taskId,
      actor.userId,
      "assignee_added",
      withActorSource(actor, {
        userId: targetUserId,
        user_name: assigneeUser?.name ?? assigneeUser?.email ?? "someone",
      })
    );
  }

  revalidateTask(ctx);

  if (opts.returnAssignees === false) {
    return { ok: true, assignees: [] };
  }
  const assignees = await db
    .select({
      userId: taskAssignee.userId,
      name: user.name,
      email: user.email,
    })
    .from(taskAssignee)
    .leftJoin(user, eq(user.id, taskAssignee.userId))
    .where(eq(taskAssignee.taskId, taskId));
  return { ok: true, assignees };
}

// ─── Shared helpers for task writes ───────────────────────────────────────────

export type TaskPriority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

// User-facing priority labels for notification messages.
export const PRIORITY_LABELS: Record<string, string> = {
  NONE: "No Priority",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

// Deduped set of a task's assignees + watchers: the standard recipient set for
// task-level change notifications (priority, moved, etc.).
export async function assigneeAndWatcherIds(taskId: string): Promise<string[]> {
  const [a, w] = await Promise.all([
    db
      .select({ userId: taskAssignee.userId })
      .from(taskAssignee)
      .where(eq(taskAssignee.taskId, taskId)),
    db
      .select({ userId: taskWatcher.userId })
      .from(taskWatcher)
      .where(eq(taskWatcher.taskId, taskId)),
  ]);
  return [...new Set([...a, ...w].map((r) => r.userId))];
}

// The first OPEN status of a list by board order, else its first status.
async function defaultStatusId(
  listId: string
): Promise<{ id: string } | { error: string }> {
  const [firstOpen] = await db
    .select({ id: listStatus.id })
    .from(listStatus)
    .where(and(eq(listStatus.listId, listId), eq(listStatus.type, "OPEN")))
    .orderBy(asc(listStatus.orderIndex))
    .limit(1);
  if (firstOpen) {
    return { id: firstOpen.id };
  }
  const [anyStatus] = await db
    .select({ id: listStatus.id })
    .from(listStatus)
    .where(eq(listStatus.listId, listId))
    .orderBy(asc(listStatus.orderIndex))
    .limit(1);
  return anyStatus ? { id: anyStatus.id } : { error: "List has no statuses" };
}

export type MentionableUser = { id: string; name: string };

// The users among `userIds` who are ACTIVE members of the workspace AND can see
// the given project. Only these may be mentioned or assigned from outside the
// web app, so nobody who cannot open the task is ever notified about it.
export async function resolveProjectUsers(
  workspaceId: string,
  spaceId: string,
  userIds: string[]
): Promise<Map<string, MentionableUser>> {
  const wanted = [...new Set(userIds)];
  const result = new Map<string, MentionableUser>();
  if (wanted.length === 0) {
    return result;
  }
  const found = await db
    .select({
      userId: workspaceMember.userId,
      name: user.name,
      email: user.email,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.status, "ACTIVE"),
        inArray(workspaceMember.userId, wanted)
      )
    );
  const rows = found.flatMap((r) =>
    r.userId ? [{ userId: r.userId, name: r.name, email: r.email }] : []
  );
  const visible = await Promise.all(
    rows.map((r) => canAccessSpace(r.userId, workspaceId, spaceId))
  );
  rows.forEach((r, i) => {
    if (visible[i]) {
      result.set(r.userId, {
        id: r.userId,
        name: r.name || r.email || "member",
      });
    }
  });
  return result;
}

// Mention targets for text written on an existing task. Empty when the task
// cannot be used by this actor.
export async function resolveTaskMentionTargets(
  actor: Actor,
  taskId: string,
  userIds: string[]
): Promise<Map<string, MentionableUser>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return new Map();
  }
  return resolveProjectUsers(ctx.workspaceId, ctx.spaceId, userIds);
}

export type DescriptionAttachment = {
  id: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
};

// The inline attachments of ONE task that its description may reference: rows
// with `isInline` and no comment. Ids from other tasks, comment images and plain
// attachments are not returned, so they can never be linked from a description.
export async function listDescriptionAttachments(
  actor: Actor,
  taskId: string,
  attachmentIds: string[]
): Promise<Map<string, DescriptionAttachment>> {
  const result = new Map<string, DescriptionAttachment>();
  if (attachmentIds.length === 0) {
    return result;
  }
  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return result;
  }
  const rows = await db
    .select({
      id: taskAttachment.id,
      fileKey: taskAttachment.fileUrl,
      fileName: taskAttachment.fileName,
      mimeType: taskAttachment.mimeType,
      size: taskAttachment.fileSize,
    })
    .from(taskAttachment)
    .where(
      and(
        eq(taskAttachment.taskId, ctx.taskId),
        eq(taskAttachment.isInline, true),
        isNull(taskAttachment.commentId),
        inArray(taskAttachment.id, [...new Set(attachmentIds)])
      )
    );
  for (const row of rows) {
    result.set(row.id, row);
  }
  return result;
}

// ─── createTask ───────────────────────────────────────────────────────────────

export type CreateTaskInput = {
  workspaceId: string;
  spaceId: string;
  listId: string | null;
  title: string;
  statusId?: string;
  priority?: TaskPriority;
  // A Tiptap document (object). Stored as given.
  description?: unknown;
  dueDateStart?: string | null;
  dueDateEnd?: string | null;
  assigneeIds?: string[];
  tagIds?: string[];
};

export type CreateResult =
  | { taskId: string }
  | { error: string; code?: string };

export const ASSIGNEE_ACCESS_ERROR = "User cannot access this task";

// Checks that every id is an ACTIVE workspace member who can see the project,
// for every actor. Otherwise a crafted call could assign someone who is not in
// the workspace (or cannot open the project) and notify them about the task.
async function checkAssignees(
  workspaceId: string,
  spaceId: string,
  ids: string[]
): Promise<{ error: string } | null> {
  if (ids.length === 0) {
    return null;
  }
  const found = await resolveProjectUsers(workspaceId, spaceId, ids);
  return found.size === ids.length ? null : { error: ASSIGNEE_ACCESS_ERROR };
}

// Creates a task. Needs Edit on the project. The workspace task limit is
// checked first inside the inserting transaction (`requireTaskCapacity`), which
// also reserves the task number.
export async function createTask(
  actor: Actor,
  data: CreateTaskInput
): Promise<CreateResult> {
  if (actor.scope === "read") {
    return { error: READ_ONLY_ERROR };
  }
  const { workspaceId, spaceId } = data;
  if (!(await actorCanUseWorkspace(actor, workspaceId))) {
    return { error: "Workspace not found" };
  }

  const err = await requireEditAccess(actor.userId, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const title = data.title.trim();
  if (!title) {
    return { error: "Task title is required" };
  }
  if (!(isOptionalDay(data.dueDateStart) && isOptionalDay(data.dueDateEnd))) {
    return { error: "Invalid due date" };
  }

  // A given status must exist. Outside the web app it must belong to the target
  // list. The web also accepts any list of the same project, because the Sprint
  // view creates tasks in one column from statuses of several lists (the same
  // rule `setTaskStatus` applies on the web).
  const strictStatus = actor.source !== "web";
  let statusId: string | undefined = data.statusId || undefined;
  const effectiveListId = data.listId || null;

  if (statusId) {
    const [known] = await db
      .select({ id: listStatus.id })
      .from(listStatus)
      .innerJoin(list, eq(listStatus.listId, list.id))
      .where(
        and(
          eq(listStatus.id, statusId),
          strictStatus && effectiveListId
            ? eq(listStatus.listId, effectiveListId)
            : eq(list.spaceId, spaceId)
        )
      )
      .limit(1);
    if (!known) {
      return { error: "Status not found" };
    }
  }

  if (effectiveListId) {
    const [currentList] = await db
      .select({ id: list.id })
      .from(list)
      .where(
        and(
          eq(list.id, effectiveListId),
          eq(list.spaceId, spaceId),
          eq(list.isArchived, false)
        )
      )
      .limit(1);
    if (!currentList) {
      return { error: "List not found or archived" };
    }

    if (!statusId) {
      const fallback = await defaultStatusId(effectiveListId);
      if ("error" in fallback) {
        return fallback;
      }
      statusId = fallback.id;
    }
  }

  const assigneeIds = [...new Set(data.assigneeIds ?? [])];
  const tagIds = [...new Set(data.tagIds ?? [])];
  const bad = await checkAssignees(workspaceId, spaceId, assigneeIds);
  if (bad) {
    return bad;
  }

  const taskId = createId();

  const created = await db.transaction(async (tx) => {
    // Workspace task-limit gate + seq reservation (locks the workspace row).
    const capacity = await requireTaskCapacity(tx, workspaceId, 1);
    if ("error" in capacity) {
      return capacity;
    }
    const taskSeq = capacity.seqBase + 1;

    await tx.insert(task).values({
      id: taskId,
      seqNumber: taskSeq,
      workspaceId,
      spaceId,
      listId: effectiveListId,
      statusId: statusId ?? null,
      title,
      description: (data.description as Record<string, unknown>) ?? null,
      priority: data.priority ?? "NONE",
      dueDateStart: data.dueDateStart ?? null,
      dueDateEnd: data.dueDateEnd ?? null,
      reporterId: actor.userId,
      orderIndex: taskSeq * 1000,
    });
    // Auto-watch: creator + assignees
    const watcherIds = [...new Set([actor.userId, ...assigneeIds])];
    await tx
      .insert(taskWatcher)
      .values(watcherIds.map((userId) => ({ taskId, userId })))
      .onConflictDoNothing();

    if (assigneeIds.length > 0) {
      await tx
        .insert(taskAssignee)
        .values(assigneeIds.map((userId) => ({ taskId, userId })))
        .onConflictDoNothing();
    }

    if (tagIds.length > 0) {
      await tx
        .insert(taskTag)
        .values(tagIds.map((tagId) => ({ taskId, tagId })))
        .onConflictDoNothing();
    }
    return null;
  });
  if (created) {
    return created;
  }

  await writeActivityLog(
    taskId,
    actor.userId,
    "task_created",
    withActorSource(actor, { title })
  );

  const actorName = actorDisplayName(actor);

  // Notify assignees (skip the creator assigning themselves).
  const notifyIds = assigneeIds.filter((id) => id !== actor.userId);
  if (notifyIds.length > 0) {
    createNotifications({
      workspaceId,
      actorId: actor.userId,
      recipientIds: notifyIds,
      triggerType: "task_assigned",
      entityType: "TASK",
      entityId: taskId,
      title: `${actorName} assigned you to "${title}"`,
      muteCheckEntityIds: [taskId],
    });
  }

  // Task created: notify the project members so the team sees new work.
  // Assignees already got task_assigned and the actor is excluded by
  // createNotifications. The shared helper respects public/private/guest
  // visibility. Loaded on demand: the action module pulls in the auth stack.
  const { spaceRecipientUserIds } = await import("@/app/actions/space");
  const projectMemberIds = await spaceRecipientUserIds(workspaceId, spaceId);
  const createdRecipients = projectMemberIds.filter(
    (id) => !assigneeIds.includes(id)
  );
  if (createdRecipients.length > 0) {
    createNotifications({
      workspaceId,
      actorId: actor.userId,
      recipientIds: createdRecipients,
      triggerType: "task_created",
      entityType: "TASK",
      entityId: taskId,
      title: `${actorName} created "${title}"`,
      muteCheckEntityIds: [taskId],
    });
  }

  // @mentions in the initial description.
  const descMentions = extractMentionIds(data.description);
  if (descMentions.length > 0) {
    createNotifications({
      workspaceId,
      actorId: actor.userId,
      recipientIds: descMentions,
      triggerType: "mention_description",
      entityType: "TASK",
      entityId: taskId,
      title: `${actorName} mentioned you in the description of "${title}"`,
      muteCheckEntityIds: [taskId],
    });
  }

  if (data.listId) {
    void refreshWorkspace(
      workspaceId,
      [`/${workspaceId}/${spaceId}/list/${data.listId}`],
      { taskId }
    );
  }
  return { taskId };
}

// ─── createSubtask ────────────────────────────────────────────────────────────

export type CreateSubtaskInput = {
  parentTaskId: string;
  // The workspace the caller believes the parent is in. A different one means
  // a foreign task. Omit it when there is no claim to check.
  workspaceId?: string;
  title: string;
  description?: unknown;
  priority?: TaskPriority;
  dueDateStart?: string | null;
  dueDateEnd?: string | null;
  assigneeIds?: string[];
};

// Creates a subtask one level under a task. Needs Edit on the parent's project.
// The list and status come from the parent. The task limit is checked first in
// the inserting transaction.
export async function createSubtask(
  actor: Actor,
  data: CreateSubtaskInput
): Promise<CreateResult> {
  if (actor.scope === "read") {
    return { error: READ_ONLY_ERROR };
  }
  const trimmedTitle = data.title.trim();
  if (!trimmedTitle) {
    return { error: "Subtask title is required" };
  }
  const { parentTaskId } = data;

  // Load the parent first: its own list decides which space the permission
  // check runs against. The list is LEFT joined because Sprint tasks have none.
  const [parentRow] = await db
    .select({
      id: task.id,
      listId: task.listId,
      workspaceId: task.workspaceId,
      parentTaskId: task.parentTaskId,
      spaceId: effectiveTaskSpaceId,
    })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .where(and(eq(task.id, parentTaskId), notDeleted()))
    .limit(1);
  // Tasks never change workspace, so a different workspace id from the caller
  // means a foreign task.
  if (
    !parentRow ||
    (data.workspaceId !== undefined &&
      parentRow.workspaceId !== data.workspaceId)
  ) {
    return { error: "Parent task not found" };
  }
  const workspaceId = parentRow.workspaceId;
  // Token restriction, guest rule and workspace state for non-web actors.
  if (
    actor.source !== "web" &&
    !(await resolveTaskContext(parentTaskId, actor))
  ) {
    return { error: "Parent task not found" };
  }
  const { spaceId: parentSpaceId, ...parentTask } = parentRow;
  const spaceId =
    parentSpaceId ?? (await resolveTaskContext(parentTaskId))?.spaceId;
  if (!spaceId) {
    return { error: "Parent task not found" };
  }

  const err = await requireEditAccess(actor.userId, workspaceId, spaceId);
  if (err) {
    return err;
  }
  if (parentTask.parentTaskId) {
    return { error: "Cannot nest subtasks more than one level" };
  }
  if (!(isOptionalDay(data.dueDateStart) && isOptionalDay(data.dueDateEnd))) {
    return { error: "Invalid due date" };
  }

  const assigneeIds = [...new Set(data.assigneeIds ?? [])];
  if (assigneeIds.length > 0) {
    const bad = await checkAssignees(workspaceId, spaceId, assigneeIds);
    if (bad) {
      return bad;
    }
  }

  const listId = parentTask.listId;

  let statusId: string | null = null;
  if (listId) {
    const fallback = await defaultStatusId(listId);
    if ("error" in fallback) {
      return fallback;
    }
    statusId = fallback.id;
  }

  const taskId = createId();

  const created = await db.transaction(async (tx) => {
    // Workspace task-limit gate + seq reservation (locks the workspace row).
    const capacity = await requireTaskCapacity(tx, workspaceId, 1);
    if ("error" in capacity) {
      return capacity;
    }
    const taskSeq = capacity.seqBase + 1;

    await tx.insert(task).values({
      id: taskId,
      seqNumber: taskSeq,
      workspaceId,
      listId: listId ?? null,
      statusId,
      title: trimmedTitle,
      ...(data.description === undefined
        ? {}
        : { description: data.description as Record<string, unknown> }),
      priority: data.priority ?? "NONE",
      ...(data.dueDateStart === undefined
        ? {}
        : { dueDateStart: data.dueDateStart }),
      ...(data.dueDateEnd === undefined ? {} : { dueDateEnd: data.dueDateEnd }),
      reporterId: actor.userId,
      parentTaskId,
      orderIndex: taskSeq * 1000,
    });

    if (assigneeIds.length > 0) {
      await tx
        .insert(taskWatcher)
        .values(assigneeIds.map((userId) => ({ taskId, userId })))
        .onConflictDoNothing();
      await tx
        .insert(taskAssignee)
        .values(assigneeIds.map((userId) => ({ taskId, userId })))
        .onConflictDoNothing();
    }
    return null;
  });
  if (created) {
    return created;
  }

  await writeActivityLog(
    taskId,
    actor.userId,
    "subtask_created",
    withActorSource(actor, { title: trimmedTitle, parentTaskId })
  );

  const actorName = actorDisplayName(actor);
  const notifyIds = assigneeIds.filter((id) => id !== actor.userId);
  if (notifyIds.length > 0) {
    createNotifications({
      workspaceId,
      actorId: actor.userId,
      recipientIds: notifyIds,
      triggerType: "task_assigned",
      entityType: "TASK",
      entityId: taskId,
      title: `${actorName} assigned you to "${trimmedTitle}"`,
      muteCheckEntityIds: [taskId],
    });
  }
  const descMentions = extractMentionIds(data.description);
  if (descMentions.length > 0) {
    createNotifications({
      workspaceId,
      actorId: actor.userId,
      recipientIds: descMentions,
      triggerType: "mention_description",
      entityType: "TASK",
      entityId: taskId,
      title: `${actorName} mentioned you in the description of "${trimmedTitle}"`,
      muteCheckEntityIds: [taskId],
    });
  }

  void refreshWorkspace(
    workspaceId,
    listId ? [`/${workspaceId}/${spaceId}/list/${listId}`] : undefined
  );
  return { taskId };
}

// ─── updateTask ───────────────────────────────────────────────────────────────

export type UpdateTaskPatch = {
  title?: string;
  priority?: TaskPriority;
  // A new description replaces the old one. Inline images and files the new
  // description no longer references are deleted.
  description?: unknown;
  dueDateStart?: string | null;
  dueDateEnd?: string | null;
  timeEstimate?: number | null;
};

// Changes the title, priority, description or dates of a task. Needs Edit.
// Notifies watchers of a changed due date, assignees and watchers of a changed
// priority, and only the NEWLY mentioned users of a description.
export async function updateTask(
  actor: Actor,
  taskId: string,
  data: UpdateTaskPatch
): Promise<{ ok: true } | { error: string }> {
  if (actor.scope === "read") {
    return { error: READ_ONLY_ERROR };
  }

  // The real location comes from the task row (open panels can hold stale ids
  // after a move).
  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId, listId } = ctx;

  const err = await requireEditAccess(actor.userId, workspaceId, spaceId);
  if (err) {
    return err;
  }

  if (!(isOptionalDay(data.dueDateStart) && isOptionalDay(data.dueDateEnd))) {
    return { error: "Invalid due date" };
  }

  const [existing] = await db
    .select({
      title: task.title,
      priority: task.priority,
      description: task.description,
      dueDateEnd: task.dueDateEnd,
    })
    .from(task)
    .where(and(eq(task.id, taskId), notDeleted()))
    .limit(1);
  if (!existing) {
    return { error: "Task not found" };
  }

  const updates: Partial<typeof task.$inferInsert> = { updatedAt: new Date() };
  const logs: Array<() => Promise<void>> = [];

  if (data.title !== undefined && data.title.trim() !== existing.title) {
    updates.title = data.title.trim();
    logs.push(() =>
      writeActivityLog(
        taskId,
        actor.userId,
        "title_changed",
        withActorSource(actor, { from: existing.title, to: updates.title })
      )
    );
  }

  if (data.priority !== undefined && data.priority !== existing.priority) {
    updates.priority = data.priority;
    logs.push(() =>
      writeActivityLog(
        taskId,
        actor.userId,
        "priority_changed",
        withActorSource(actor, { from: existing.priority, to: data.priority })
      )
    );
  }

  if (data.description !== undefined) {
    // Snapshot the previous description before overwriting
    if (existing.description) {
      await db
        .insert(taskDescriptionSnapshot)
        .values({
          id: createId(),
          taskId,
          content: existing.description as Record<string, unknown>,
          savedBy: actor.userId,
          savedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: taskDescriptionSnapshot.taskId,
          set: {
            content: existing.description as Record<string, unknown>,
            savedBy: actor.userId,
            savedAt: new Date(),
          },
        });
    }
    updates.description = data.description as Record<string, unknown>;
    logs.push(() =>
      actor.source === "web"
        ? writeActivityLog(taskId, actor.userId, "description_updated")
        : writeActivityLog(
            taskId,
            actor.userId,
            "description_updated",
            withActorSource(actor, {})
          )
    );

    // Delete the storage object + row for any inline image removed from the
    // description (isInline + no commentId; mirrors editComment). Only runs
    // once the new description actually parses: treating an unparseable JSON
    // string as "no images kept" previously wiped every image on save.
    const newDescDoc = toTiptapDoc(data.description);
    if (newDescDoc !== null && newDescDoc !== undefined) {
      const keptIds = extractInlineAttachmentIds(newDescDoc);
      const removed = await db
        .select({ id: taskAttachment.id, fileUrl: taskAttachment.fileUrl })
        .from(taskAttachment)
        .where(
          and(
            eq(taskAttachment.taskId, taskId),
            eq(taskAttachment.isInline, true),
            isNull(taskAttachment.commentId),
            ...(keptIds.length > 0
              ? [notInArray(taskAttachment.id, keptIds)]
              : [])
          )
        );
      if (removed.length > 0) {
        await Promise.all(
          removed.map(async (a) => {
            try {
              await storage.delete(a.fileUrl);
            } catch {
              // Best-effort: a missing storage file must not block the update.
            }
          })
        );
        await db.delete(taskAttachment).where(
          inArray(
            taskAttachment.id,
            removed.map((a) => a.id)
          )
        );
      }
    }
  }

  if (data.dueDateStart !== undefined) {
    updates.dueDateStart = data.dueDateStart;
  }
  if (data.dueDateEnd !== undefined) {
    updates.dueDateEnd = data.dueDateEnd;
  }
  if (data.timeEstimate !== undefined) {
    updates.timeEstimate = data.timeEstimate;
  }

  if (Object.keys(updates).length > 1) {
    await db.update(task).set(updates).where(eq(task.id, taskId));
  }

  await Promise.all(logs.map((fn) => fn()));

  const actorName = actorDisplayName(actor);

  // Only when the due day actually changed (null-safe), so re-saving the same
  // date sends nothing.
  const dueDateEndChanged =
    data.dueDateEnd !== undefined &&
    (data.dueDateEnd ?? null) !== (existing.dueDateEnd ?? null);
  if (dueDateEndChanged) {
    const dueDateWatchers = await db
      .select({ userId: taskWatcher.userId })
      .from(taskWatcher)
      .where(eq(taskWatcher.taskId, taskId));
    const dueDateWatcherIds = dueDateWatchers.map((w) => w.userId);
    if (dueDateWatcherIds.length > 0) {
      createNotifications({
        workspaceId,
        actorId: actor.userId,
        recipientIds: dueDateWatcherIds,
        triggerType: "task_due_date_changed",
        entityType: "TASK",
        entityId: taskId,
        title: `${actorName} changed due date of "${existing.title}"`,
        muteCheckEntityIds: [taskId],
      });
    }
  }

  // Notify assignees + watchers when the priority actually changed.
  if (data.priority !== undefined && data.priority !== existing.priority) {
    const recipientIds = await assigneeAndWatcherIds(taskId);
    if (recipientIds.length > 0) {
      createNotifications({
        workspaceId,
        actorId: actor.userId,
        recipientIds,
        triggerType: "task_priority_changed",
        entityType: "TASK",
        entityId: taskId,
        title: `${actorName} changed priority of "${existing.title}" to ${PRIORITY_LABELS[data.priority]}`,
        muteCheckEntityIds: [taskId],
      });
    }
  }

  // Mention in description: notify only NEWLY added mentions (old vs new).
  if (data.description !== undefined) {
    const oldMentions = extractMentionIds(existing.description);
    const addedMentions = extractMentionIds(data.description).filter(
      (id) => !oldMentions.includes(id)
    );
    if (addedMentions.length > 0) {
      createNotifications({
        workspaceId,
        actorId: actor.userId,
        recipientIds: addedMentions,
        triggerType: "mention_description",
        entityType: "TASK",
        entityId: taskId,
        title: `${actorName} mentioned you in the description of "${existing.title}"`,
        muteCheckEntityIds: [taskId],
      });
    }
  }

  void refreshWorkspace(
    workspaceId,
    taskRevalidatePaths({ workspaceId, spaceId, listId }),
    {
      taskId,
    }
  );
  return { ok: true };
}

// ─── getTaskCard ──────────────────────────────────────────────────────────────

export type TaskCard = {
  id: string;
  seqNumber: number;
  title: string;
  priority: string;
  dueDateStart: string | null;
  dueDateEnd: string | null;
  status: { id: string; name: string; type: string } | null;
  list: { id: string; name: string } | null;
  project: { id: string; name: string };
  workspace: { id: string; name: string };
};

// A short summary of one task the actor can view (what a tool returns after it
// creates or changes a task). Listless tasks have no status or list.
export async function getTaskCard(
  actor: Actor,
  taskId: string
): Promise<TaskServiceError | { ok: true; card: TaskCard }> {
  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const permErr = await requireViewAccess(
    actor.userId,
    ctx.workspaceId,
    ctx.spaceId
  );
  if (permErr) {
    return { error: "Task not found" };
  }
  const [row] = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      priority: task.priority,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      statusId: listStatus.id,
      statusName: listStatus.name,
      statusType: listStatus.type,
      listId: list.id,
      listName: list.name,
      spaceName: space.name,
      workspaceName: workspace.name,
    })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .leftJoin(listStatus, eq(task.statusId, listStatus.id))
    .innerJoin(space, eq(space.id, ctx.spaceId))
    .innerJoin(workspace, eq(workspace.id, task.workspaceId))
    .where(and(eq(task.id, taskId), notDeleted()))
    .limit(1);
  if (!row) {
    return { error: "Task not found" };
  }
  return {
    ok: true,
    card: {
      id: row.id,
      seqNumber: row.seqNumber,
      title: row.title,
      priority: row.priority,
      dueDateStart: row.dueDateStart,
      dueDateEnd: row.dueDateEnd,
      status:
        row.statusId && row.statusName && row.statusType
          ? { id: row.statusId, name: row.statusName, type: row.statusType }
          : null,
      list:
        row.listId && row.listName
          ? { id: row.listId, name: row.listName }
          : null,
      project: { id: ctx.spaceId, name: row.spaceName },
      workspace: { id: ctx.workspaceId, name: row.workspaceName },
    },
  };
}
