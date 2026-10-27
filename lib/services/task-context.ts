import { and, eq, sql } from "drizzle-orm";
import { comment, list, task, workspace, workspaceMember } from "@/db/schema";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";
import type { Actor } from "@/lib/services/actor";
import { notDeleted } from "@/lib/task-visibility";

// Where a task really lives. Actions derive this from the task row and use it
// for permission checks, notifications, activity logs and cache refreshes,
// instead of trusting the workspace / space / list ids a client sends along.
export type TaskContext = {
  taskId: string;
  workspaceId: string;
  spaceId: string;
  listId: string | null;
  statusId: string | null;
  title: string;
};

export type CommentContext = TaskContext & {
  commentId: string;
  authorId: string;
  parentCommentId: string | null;
  isDeleted: boolean;
};

// SQL for "the space this task lives in": the list's space when it has a list,
// otherwise `task.spaceId`. Use it in queries that LEFT JOIN `list` on
// `task.listId` and need to scope tasks to a space. Comparing `task.spaceId`
// alone misses tasks whose own space column is null (subtasks) and trusts a
// stale value on tasks moved to a list in another project.
export const effectiveTaskSpaceId = sql<
  string | null
>`coalesce(${list.spaceId}, ${task.spaceId})`;

// Resolves a task to its real location, or null when the task cannot be used:
// missing, in the Trash, has no space, or its workspace is being deleted.
//
// When an `actor` is given, the task is also hidden (null) when the actor's
// token is restricted to another workspace, or when an MCP actor is not an
// ACTIVE member of the task's workspace or is only a GUEST there (guests get no
// token access). Web callers may omit the actor; project-level permission is
// still checked by the caller.
//
// A task's space comes from its list when it has one, otherwise from
// `task.spaceId` (same rule as `getTaskLocation`). The list is LEFT joined on
// purpose: tasks created in the Sprint view have no list, and `listId`,
// `spaceId` and `statusId` are all nullable.
export async function resolveTaskContext(
  taskId: string,
  actor?: Actor
): Promise<TaskContext | null> {
  const [row] = await db
    .select({
      taskId: task.id,
      workspaceId: task.workspaceId,
      taskSpaceId: task.spaceId,
      listSpaceId: list.spaceId,
      listId: task.listId,
      statusId: task.statusId,
      title: task.title,
      parentTaskId: task.parentTaskId,
      workspaceStatus: workspace.status,
    })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .innerJoin(workspace, eq(task.workspaceId, workspace.id))
    .where(and(eq(task.id, taskId), notDeleted()))
    .limit(1);

  if (row?.workspaceStatus !== "ACTIVE") {
    return null;
  }

  let spaceId = row.listSpaceId ?? row.taskSpaceId;

  // Older subtasks of a listless task were stored with neither a list nor a
  // space. They live where their parent lives (subtasks are one level deep).
  if (!spaceId && row.parentTaskId) {
    const [parent] = await db
      .select({ taskSpaceId: task.spaceId, listSpaceId: list.spaceId })
      .from(task)
      .leftJoin(list, eq(task.listId, list.id))
      .where(and(eq(task.id, row.parentTaskId), notDeleted()))
      .limit(1);
    spaceId = parent?.listSpaceId ?? parent?.taskSpaceId ?? null;
  }

  if (!spaceId) {
    return null;
  }

  if (actor) {
    if (actor.workspaceId && actor.workspaceId !== row.workspaceId) {
      return null;
    }
    if (actor.source === "mcp") {
      const membership = await getWorkspaceMembership(
        actor.userId,
        row.workspaceId
      );
      if (!membership || membership.role === "GUEST") {
        return null;
      }
    }
  }

  return {
    taskId: row.taskId,
    workspaceId: row.workspaceId,
    spaceId,
    listId: row.listId,
    statusId: row.statusId,
    title: row.title,
  };
}

// Resolves a comment through the task it belongs to. Null when the comment is
// missing or its task cannot be resolved.
export async function resolveCommentContext(
  commentId: string,
  actor?: Actor
): Promise<CommentContext | null> {
  const [row] = await db
    .select({
      commentId: comment.id,
      taskId: comment.taskId,
      authorId: comment.authorId,
      parentCommentId: comment.parentCommentId,
      isDeleted: comment.isDeleted,
    })
    .from(comment)
    .where(eq(comment.id, commentId))
    .limit(1);
  if (!row) {
    return null;
  }

  const ctx = await resolveTaskContext(row.taskId, actor);
  if (!ctx) {
    return null;
  }
  return {
    ...ctx,
    commentId: row.commentId,
    authorId: row.authorId,
    parentCommentId: row.parentCommentId,
    isDeleted: row.isDeleted,
  };
}

// Pages to revalidate after a change to this task: its list page, or the
// project and workspace home for a task that has no list.
export function taskRevalidatePaths(
  ctx: Pick<TaskContext, "workspaceId" | "spaceId" | "listId">
): string[] {
  return ctx.listId
    ? [`/${ctx.workspaceId}/${ctx.spaceId}/list/${ctx.listId}`]
    : [`/${ctx.workspaceId}/${ctx.spaceId}`, `/${ctx.workspaceId}`];
}

// The ACTIVE workspaces this actor may use, with their role in each. The
// token's workspace restriction applies, and over MCP so does the guest rule
// (guests get no token access). `only` narrows to one workspace; a workspace
// outside the restriction gives an empty list.
export async function allowedWorkspaces(
  actor: Actor,
  only?: string | null
): Promise<{ workspaceId: string; role: string }[]> {
  const wanted = only ?? actor.workspaceId ?? null;
  if (actor.workspaceId && only && actor.workspaceId !== only) {
    return [];
  }
  const rows = await db
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
  return rows.filter(
    (w) =>
      (!wanted || w.workspaceId === wanted) &&
      !(actor.source === "mcp" && w.role === "GUEST")
  );
}
