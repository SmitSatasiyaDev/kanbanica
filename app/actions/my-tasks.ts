"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import {
  list,
  listStatus,
  space,
  tag,
  task,
  taskAssignee,
  taskTag,
  workspace,
  workspaceMember,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleSpaceIds } from "@/lib/permissions";
import { notDeleted } from "@/lib/task-visibility";

export interface MyTask {
  dueDateEnd: Date | null;
  dueDateStart: Date | null;
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

export type MyTasksGroupBy =
  | "due_date"
  | "workspace"
  | "space"
  | "list"
  | "priority"
  | "status";

/**
 * Personal task list — every task assigned to the current user across ALL their
 * workspaces (not just the one being viewed), respecting the space access model.
 */
export async function getMyTasks(options?: {
  showCompleted?: boolean;
}): Promise<{ tasks: MyTask[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // Union of accessible space ids across every ACTIVE workspace the user belongs to.
  const workspaces = await db
    .select({ workspaceId: workspaceMember.workspaceId })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
    .where(
      and(
        eq(workspaceMember.userId, session.user.id),
        eq(workspaceMember.status, "ACTIVE"),
        eq(workspace.status, "ACTIVE")
      )
    );
  if (workspaces.length === 0) {
    return { tasks: [] };
  }

  const spaceIdLists = await Promise.all(
    workspaces.map((w) => getAccessibleSpaceIds(session.user.id, w.workspaceId))
  );
  const accessibleSpaceIds = [...new Set(spaceIdLists.flat())];
  if (accessibleSpaceIds.length === 0) {
    return { tasks: [] };
  }

  // Tasks assigned to me in accessible spaces, not archived
  const assignedTaskIds = await db
    .select({ taskId: taskAssignee.taskId })
    .from(taskAssignee)
    .where(eq(taskAssignee.userId, session.user.id));

  if (assignedTaskIds.length === 0) {
    return { tasks: [] };
  }

  const taskIds = assignedTaskIds.map((r) => r.taskId);

  const rows = await db
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
    .where(
      and(
        inArray(task.id, taskIds),
        inArray(space.id, accessibleSpaceIds),
        notDeleted(),
        eq(task.isArchived, false),
        eq(list.isArchived, false)
      )
    )
    .orderBy(asc(task.dueDateEnd), asc(task.dueDateStart));

  // Filter out completed unless showCompleted
  const filtered = options?.showCompleted
    ? rows
    : rows.filter((r) => r.statusType !== "CLOSED");

  // Fetch tags for these tasks
  const allTaskIds = filtered.map((r) => r.id);
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

  const tasks: MyTask[] = filtered.map((r) => ({
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

  return { tasks };
}
