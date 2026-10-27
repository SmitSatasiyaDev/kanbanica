import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  list,
  listStatus,
  space,
  sprint,
  task,
  taskAssignee,
  taskSprint,
  user,
  workspaceMember,
} from "@/db/schema";
import { db } from "@/lib/db";
import { getAccessibleSpaceIds } from "@/lib/permissions";
import type { Actor } from "@/lib/services/actor";
import {
  encodeCursor,
  INVALID_CURSOR_ERROR,
  pageOf,
  readCursor,
} from "@/lib/services/cursor";
import { allowedWorkspaces } from "@/lib/services/task-context";
import { notDeleted } from "@/lib/task-visibility";

export type ProjectServiceError = { error: string };

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

function clamp(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(Math.max(Math.floor(value), 1), MAX_LIST_LIMIT);
}

// The project and its workspace, when this actor may see it. Archived projects
// can be read too (their lists, their sprints); everything else is hidden.
async function viewableProject(
  actor: Actor,
  projectId: string
): Promise<{ id: string; workspaceId: string; isArchived: boolean } | null> {
  const [found] = await db
    .select({
      id: space.id,
      workspaceId: space.workspaceId,
      isArchived: space.isArchived,
    })
    .from(space)
    .where(eq(space.id, projectId))
    .limit(1);
  if (!found) {
    return null;
  }
  if ((await allowedWorkspaces(actor, found.workspaceId)).length === 0) {
    return null;
  }
  const [open, archived] = await Promise.all([
    getAccessibleSpaceIds(actor.userId, found.workspaceId),
    getAccessibleSpaceIds(actor.userId, found.workspaceId, true),
  ]);
  return open.includes(found.id) || archived.includes(found.id) ? found : null;
}

// Where a list lives, for creating a task in it. Null when the list is missing
// or its project is outside what this actor may use. Whether the list is
// archived is checked by `createTask`.
export async function getListLocation(
  actor: Actor,
  listId: string
): Promise<{ listId: string; workspaceId: string; spaceId: string } | null> {
  const [found] = await db
    .select({
      listId: list.id,
      spaceId: list.spaceId,
      workspaceId: space.workspaceId,
    })
    .from(list)
    .innerJoin(space, eq(list.spaceId, space.id))
    .where(eq(list.id, listId))
    .limit(1);
  if (!found) {
    return null;
  }
  if ((await allowedWorkspaces(actor, found.workspaceId)).length === 0) {
    return null;
  }
  return found;
}

// ─── listProjects ─────────────────────────────────────────────────────────────

export type ProjectItem = {
  id: string;
  name: string;
  workspaceId: string;
  isPrivate: boolean;
  isArchived: boolean;
};

// The projects the actor can see, across their workspaces (or one). Ordered by
// workspace, then the order shown in the app.
export async function listProjects(
  actor: Actor,
  opts: {
    workspaceId?: string;
    includeArchived?: boolean;
    cursor?: string;
    limit?: number;
  } = {}
): Promise<
  | { ok: true; items: ProjectItem[]; nextCursor: string | null }
  | ProjectServiceError
> {
  const after = opts.cursor ? readCursor("projects", opts.cursor) : null;
  if (opts.cursor && !after) {
    return { error: INVALID_CURSOR_ERROR };
  }
  const workspaces = await allowedWorkspaces(actor, opts.workspaceId);
  const idLists = await Promise.all(
    workspaces.flatMap((w) => [
      getAccessibleSpaceIds(actor.userId, w.workspaceId),
      ...(opts.includeArchived
        ? [getAccessibleSpaceIds(actor.userId, w.workspaceId, true)]
        : []),
    ])
  );
  const ids = [...new Set(idLists.flat())];
  if (ids.length === 0) {
    return { ok: true, items: [], nextCursor: null };
  }

  const conditions: SQL[] = [inArray(space.id, ids)];
  if (after) {
    conditions.push(
      sql`(${space.workspaceId}, ${space.orderIndex}, ${space.id}) > (${after.w}, ${after.o}, ${after.i})`
    );
  }
  const limit = clamp(opts.limit);
  const rows = await db
    .select({
      id: space.id,
      name: space.name,
      workspaceId: space.workspaceId,
      orderIndex: space.orderIndex,
      isPrivate: space.isPrivate,
      isArchived: space.isArchived,
    })
    .from(space)
    .where(and(...conditions))
    .orderBy(asc(space.workspaceId), asc(space.orderIndex), asc(space.id))
    .limit(limit + 1);

  const { items, hasMore } = pageOf(rows, limit);
  const last = items[items.length - 1];
  return {
    ok: true,
    items: items.map(({ orderIndex: _order, ...rest }) => rest),
    nextCursor:
      hasMore && last
        ? encodeCursor("projects", {
            w: last.workspaceId,
            o: last.orderIndex,
            i: last.id,
          })
        : null,
  };
}

// ─── listLists ────────────────────────────────────────────────────────────────

export type ListItem = {
  id: string;
  name: string;
  projectId: string;
  isArchived: boolean;
};

export async function listLists(
  actor: Actor,
  opts: {
    projectId: string;
    includeArchived?: boolean;
    cursor?: string;
    limit?: number;
  }
): Promise<
  | { ok: true; items: ListItem[]; nextCursor: string | null }
  | ProjectServiceError
> {
  const after = opts.cursor ? readCursor("lists", opts.cursor) : null;
  if (opts.cursor && !after) {
    return { error: INVALID_CURSOR_ERROR };
  }
  const project = await viewableProject(actor, opts.projectId);
  if (!project) {
    return { error: "Project not found" };
  }

  const conditions: SQL[] = [eq(list.spaceId, project.id)];
  if (!opts.includeArchived) {
    conditions.push(eq(list.isArchived, false));
  }
  if (after) {
    conditions.push(
      sql`(${list.orderIndex}, ${list.id}) > (${after.o}, ${after.i})`
    );
  }
  const limit = clamp(opts.limit);
  const rows = await db
    .select({
      id: list.id,
      name: list.name,
      projectId: list.spaceId,
      orderIndex: list.orderIndex,
      isArchived: list.isArchived,
    })
    .from(list)
    .where(and(...conditions))
    .orderBy(asc(list.orderIndex), asc(list.id))
    .limit(limit + 1);

  const { items, hasMore } = pageOf(rows, limit);
  const last = items[items.length - 1];
  return {
    ok: true,
    items: items.map(({ orderIndex: _order, ...rest }) => rest),
    nextCursor:
      hasMore && last
        ? encodeCursor("lists", { o: last.orderIndex, i: last.id })
        : null,
  };
}

// ─── listMembers ──────────────────────────────────────────────────────────────

export type MemberItem = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

// Escapes the characters LIKE treats as wildcards.
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}

// The ACTIVE members of a workspace, ordered by name: the same people the web
// members list shows. Over MCP the caller must be a non-guest member.
export async function listMembers(
  actor: Actor,
  opts: {
    workspaceId: string;
    query?: string;
    cursor?: string;
    limit?: number;
  }
): Promise<
  | { ok: true; items: MemberItem[]; nextCursor: string | null }
  | ProjectServiceError
> {
  const after = opts.cursor ? readCursor("members", opts.cursor) : null;
  if (opts.cursor && !after) {
    return { error: INVALID_CURSOR_ERROR };
  }
  if ((await allowedWorkspaces(actor, opts.workspaceId)).length === 0) {
    return { error: "Workspace not found" };
  }

  const conditions: SQL[] = [
    eq(workspaceMember.workspaceId, opts.workspaceId),
    eq(workspaceMember.status, "ACTIVE"),
    isNotNull(workspaceMember.userId),
  ];
  const text = opts.query?.trim();
  if (text) {
    const like = likePattern(text);
    const match = or(ilike(user.name, like), ilike(user.email, like));
    if (match) {
      conditions.push(match);
    }
  }
  if (after) {
    conditions.push(sql`(${user.name}, ${user.id}) > (${after.n}, ${after.i})`);
  }
  const limit = clamp(opts.limit);
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(...conditions))
    .orderBy(asc(user.name), asc(user.id))
    .limit(limit + 1);

  const { items, hasMore } = pageOf(rows, limit);
  const last = items[items.length - 1];
  return {
    ok: true,
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor("members", { n: last.name, i: last.userId })
        : null,
  };
}

// ─── getCurrentSprint ─────────────────────────────────────────────────────────

export type SprintSummary = {
  id: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
};

export type SprintTaskItem = {
  id: string;
  seqNumber: number;
  title: string;
  priority: string;
  statusId: string | null;
  statusName: string | null;
  statusType: string | null;
  listId: string | null;
  dueDateStart: string | null;
  dueDateEnd: string | null;
  storyPoints: number | null;
  assignees: { userId: string; name: string | null }[];
};

const sprintColumns = {
  id: sprint.id,
  name: sprint.name,
  goal: sprint.goal,
  startDate: sprint.startDate,
  endDate: sprint.endDate,
  status: sprint.status,
};

// The project's ACTIVE sprint with its tasks (paged). Without one, `sprint` is
// null and `upcoming` is the next PLANNED sprint by start date, if any.
export async function getCurrentSprint(
  actor: Actor,
  opts: { projectId: string; cursor?: string; limit?: number }
): Promise<
  | {
      ok: true;
      workspaceId: string;
      sprint: SprintSummary | null;
      upcoming: SprintSummary | null;
      tasks: { items: SprintTaskItem[]; nextCursor: string | null };
    }
  | ProjectServiceError
> {
  const after = opts.cursor ? readCursor("sprint_tasks", opts.cursor) : null;
  if (opts.cursor && !after) {
    return { error: INVALID_CURSOR_ERROR };
  }
  const project = await viewableProject(actor, opts.projectId);
  if (!project) {
    return { error: "Project not found" };
  }

  const [active] = await db
    .select(sprintColumns)
    .from(sprint)
    .where(and(eq(sprint.spaceId, project.id), eq(sprint.status, "ACTIVE")))
    .orderBy(asc(sprint.startDate), asc(sprint.id))
    .limit(1);

  if (!active) {
    const [upcoming] = await db
      .select(sprintColumns)
      .from(sprint)
      .where(and(eq(sprint.spaceId, project.id), eq(sprint.status, "PLANNED")))
      .orderBy(sql`${sprint.startDate} asc nulls last`, asc(sprint.createdAt))
      .limit(1);
    return {
      ok: true,
      workspaceId: project.workspaceId,
      sprint: null,
      upcoming: upcoming ?? null,
      tasks: { items: [], nextCursor: null },
    };
  }

  const conditions: SQL[] = [
    eq(taskSprint.sprintId, active.id),
    notDeleted(),
    eq(task.isArchived, false),
  ];
  if (after) {
    conditions.push(
      sql`(${task.orderIndex}, ${task.id}) > (${after.o}, ${after.i})`
    );
  }
  const limit = clamp(opts.limit);
  const rows = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      priority: task.priority,
      statusId: task.statusId,
      statusName: listStatus.name,
      statusType: listStatus.type,
      listId: task.listId,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      orderIndex: task.orderIndex,
      storyPoints: taskSprint.points,
    })
    .from(taskSprint)
    .innerJoin(task, eq(task.id, taskSprint.taskId))
    .leftJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(and(...conditions))
    .orderBy(asc(task.orderIndex), asc(task.id))
    .limit(limit + 1);

  const { items: page, hasMore } = pageOf(rows, limit);
  const assigneeRows =
    page.length > 0
      ? await db
          .select({
            taskId: taskAssignee.taskId,
            userId: taskAssignee.userId,
            name: user.name,
          })
          .from(taskAssignee)
          .leftJoin(user, eq(user.id, taskAssignee.userId))
          .where(
            inArray(
              taskAssignee.taskId,
              page.map((t) => t.id)
            )
          )
      : [];
  const last = page[page.length - 1];
  return {
    ok: true,
    workspaceId: project.workspaceId,
    sprint: active,
    upcoming: null,
    tasks: {
      items: page.map(({ orderIndex: _order, ...t }) => ({
        ...t,
        assignees: assigneeRows
          .filter((a) => a.taskId === t.id)
          .map((a) => ({ userId: a.userId, name: a.name })),
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor("sprint_tasks", { o: last.orderIndex, i: last.id })
          : null,
    },
  };
}
