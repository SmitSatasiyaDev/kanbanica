import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  sum,
} from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCustomFieldsForTasks } from "@/app/actions/custom-field";
import {
  list,
  listStatus,
  pinnedTask,
  space,
  tag,
  task,
  taskAssignee,
  taskDependency,
  taskTag,
  timeEntry,
  user,
  workspaceMember,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  canAccessSpace,
  getSpacePermission,
  getWorkspaceMembership,
  hasPermissionLevel,
} from "@/lib/permissions";
import { notDeleted } from "@/lib/task-visibility";
import { ListContainer } from "./_components/list-container";

interface ListPageProps {
  params: Promise<{ workspaceId: string; spaceId: string; listId: string }>;
}

export async function generateMetadata({
  params,
}: ListPageProps): Promise<Metadata> {
  const { spaceId, listId } = await params;
  const [listRow, spaceRow] = await Promise.all([
    db
      .select({ name: list.name })
      .from(list)
      .where(eq(list.id, listId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({ name: space.name })
      .from(space)
      .where(eq(space.id, spaceId))
      .limit(1)
      .then((r) => r[0]),
  ]);
  if (!listRow || !spaceRow) {
    return { title: "List" };
  }
  return { title: `${listRow.name} · ${spaceRow.name}` };
}

export default async function ListPage({ params }: ListPageProps) {
  const { workspaceId, spaceId, listId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(session.user.id, workspaceId),
    canAccessSpace(session.user.id, workspaceId, spaceId),
  ]);
  if (!membership || !accessible) {
    notFound();
  }

  const isAdminOrOwner =
    membership.role === "OWNER" || membership.role === "ADMIN";

  // Determine canManage (FULL_ACCESS) and canEdit (EDIT or above)
  const spacePermission = isAdminOrOwner
    ? ("full_access" as const)
    : await getSpacePermission(session.user.id, workspaceId, spaceId);

  const canManage = spacePermission === "full_access";
  const canEdit =
    spacePermission !== null && hasPermissionLevel(spacePermission, "edit");

  const [currentSpace, currentList] = await Promise.all([
    db
      .select({
        id: space.id,
        name: space.name,
        color: space.color,
        logoEmoji: space.logoEmoji,
      })
      .from(space)
      .where(eq(space.id, spaceId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        id: list.id,
        name: list.name,
        color: list.color,
        description: list.description,
      })
      .from(list)
      .where(
        and(
          eq(list.id, listId),
          eq(list.spaceId, spaceId),
          eq(list.isArchived, false)
        )
      )
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  if (!currentList || !currentSpace) {
    notFound();
  }

  const [statuses, tasks, memberRows, allTags] = await Promise.all([
    db
      .select()
      .from(listStatus)
      .where(eq(listStatus.listId, listId))
      .orderBy(asc(listStatus.orderIndex)),
    db
      .select({
        id: task.id,
        title: task.title,
        priority: task.priority,
        statusId: task.statusId,
        seqNumber: task.seqNumber,
        orderIndex: task.orderIndex,
        dueDateStart: task.dueDateStart,
        dueDateEnd: task.dueDateEnd,
        isPinnedToList: task.isPinnedToList,
        pinnedToListOrder: task.pinnedToListOrder,
      })
      .from(task)
      .where(
        and(
          eq(task.listId, listId),
          notDeleted(),
          eq(task.isArchived, false),
          isNull(task.parentTaskId)
        )
      )
      .orderBy(asc(task.orderIndex)),
    db
      .select({
        userId: workspaceMember.userId,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(workspaceMember)
      .leftJoin(user, eq(workspaceMember.userId, user.id))
      .where(eq(workspaceMember.workspaceId, workspaceId)),
    db
      .select({ id: tag.id, name: tag.name, color: tag.color })
      .from(tag)
      .where(eq(tag.workspaceId, workspaceId)),
  ]);

  // Fetch tags, assignees, and personal pins in parallel
  const taskIds = tasks.map((t) => t.id);

  const [
    tagRows,
    assigneeRows,
    personalPinRows,
    depRows,
    trackedRows,
    subtaskCountRows,
    customFieldsRes,
  ] = await Promise.all([
    taskIds.length > 0
      ? db
          .select({
            taskId: taskTag.taskId,
            id: tag.id,
            name: tag.name,
            color: tag.color,
          })
          .from(taskTag)
          .innerJoin(tag, eq(taskTag.tagId, tag.id))
          .where(inArray(taskTag.taskId, taskIds))
      : Promise.resolve([]),

    taskIds.length > 0
      ? db
          .select({
            taskId: taskAssignee.taskId,
            userId: taskAssignee.userId,
            name: user.name,
            email: user.email,
            image: user.image,
          })
          .from(taskAssignee)
          .innerJoin(user, eq(user.id, taskAssignee.userId))
          .where(inArray(taskAssignee.taskId, taskIds))
      : Promise.resolve([]),

    taskIds.length > 0
      ? db
          .select({ taskId: pinnedTask.taskId })
          .from(pinnedTask)
          .where(
            and(
              eq(pinnedTask.userId, session.user.id),
              inArray(pinnedTask.taskId, taskIds)
            )
          )
      : Promise.resolve([]),

    // "Blocked by" edges for the visible tasks — one row per blocker, carrying
    // its status so the list/board indicator can show dependency state (all
    // completed vs still blocked) without an N+1 query.
    taskIds.length > 0
      ? db
          .select({
            taskId: taskDependency.taskId,
            blockerStatusType: listStatus.type,
          })
          .from(taskDependency)
          .innerJoin(task, eq(taskDependency.dependsOnTaskId, task.id))
          .leftJoin(listStatus, eq(listStatus.id, task.statusId))
          .where(and(inArray(taskDependency.taskId, taskIds), notDeleted()))
      : Promise.resolve([]),

    // Total completed tracked seconds per task (running timers excluded — the
    // card badge shows settled time only).
    taskIds.length > 0
      ? db
          .select({
            taskId: timeEntry.taskId,
            total: sum(timeEntry.durationSeconds),
          })
          .from(timeEntry)
          .where(
            and(
              inArray(timeEntry.taskId, taskIds),
              isNotNull(timeEntry.endTime)
            )
          )
          .groupBy(timeEntry.taskId)
      : Promise.resolve([]),

    // Subtask counts for the collapsible subtask row on Board cards — just
    // the count, so cards that never get expanded never pay for the full
    // subtask list (that's fetched lazily via getSubtasks on expand).
    taskIds.length > 0
      ? db
          .select({
            parentTaskId: task.parentTaskId,
            count: count(),
          })
          .from(task)
          .where(
            and(
              inArray(task.parentTaskId, taskIds),
              notDeleted(),
              eq(task.isArchived, false)
            )
          )
          .groupBy(task.parentTaskId)
      : Promise.resolve([]),

    getCustomFieldsForTasks(workspaceId, spaceId, listId, taskIds),
  ]);

  const customFields =
    customFieldsRes && !("error" in customFieldsRes)
      ? customFieldsRes.fields
      : [];
  const customFieldValuesByTask =
    customFieldsRes && !("error" in customFieldsRes)
      ? customFieldsRes.valuesByTask
      : {};

  const tagsByTaskId = new Map<
    string,
    { id: string; name: string; color: string }[]
  >();
  for (const row of tagRows) {
    const existing = tagsByTaskId.get(row.taskId) ?? [];
    existing.push({
      id: row.id,
      name: row.name,
      color: row.color ?? "#9CA3AF",
    });
    tagsByTaskId.set(row.taskId, existing);
  }

  const assigneesByTaskId = new Map<
    string,
    { userId: string; name: string; image: string | null }[]
  >();
  for (const row of assigneeRows) {
    const existing = assigneesByTaskId.get(row.taskId) ?? [];
    existing.push({
      userId: row.userId,
      name: row.name || row.email,
      image: row.image,
    });
    assigneesByTaskId.set(row.taskId, existing);
  }

  const personallyPinnedIds = new Set(personalPinRows.map((r) => r.taskId));

  const depInfoByTaskId = new Map<
    string,
    { total: number; incomplete: number }
  >();
  for (const row of depRows) {
    const existing = depInfoByTaskId.get(row.taskId) ?? {
      total: 0,
      incomplete: 0,
    };
    existing.total += 1;
    // Any blocker that isn't CLOSED means this task is still waiting on it.
    if (row.blockerStatusType !== "CLOSED") {
      existing.incomplete += 1;
    }
    depInfoByTaskId.set(row.taskId, existing);
  }

  const trackedByTaskId = new Map<string, number>();
  for (const row of trackedRows) {
    trackedByTaskId.set(row.taskId, Number(row.total ?? 0));
  }

  const subtaskCountByTaskId = new Map<string, number>();
  for (const row of subtaskCountRows) {
    if (row.parentTaskId) {
      subtaskCountByTaskId.set(row.parentTaskId, row.count);
    }
  }

  const tasksWithTags = tasks.map((t) => ({
    ...t,
    tags: tagsByTaskId.get(t.id) ?? [],
    assignees: assigneesByTaskId.get(t.id) ?? [],
    dependencyInfo: depInfoByTaskId.get(t.id),
    trackedSeconds: trackedByTaskId.get(t.id),
    customFieldValues: customFieldValuesByTask[t.id] ?? {},
    subtaskCount: subtaskCountByTaskId.get(t.id) ?? 0,
  }));

  const pinnedListTasks = tasksWithTags
    .filter((t) => t.isPinnedToList)
    .sort((a, b) => (a.pinnedToListOrder ?? 0) - (b.pinnedToListOrder ?? 0));

  const normalTasks = tasksWithTags.filter((t) => !t.isPinnedToList);

  const members = memberRows
    .filter((m) => m.userId)
    .map((m) => ({
      userId: m.userId!,
      name: m.name,
      email: m.email,
      image: m.image,
    }));

  return (
    <ListContainer
      canEdit={canEdit}
      canManage={canManage}
      canPinToList={canManage}
      currentUserId={session.user.id}
      customFields={customFields}
      isAdmin={isAdminOrOwner}
      list={currentList}
      members={members}
      personallyPinnedIds={personallyPinnedIds}
      pinnedTasks={pinnedListTasks}
      space={currentSpace}
      statuses={statuses}
      tags={allTags}
      tasks={normalTasks}
      workspaceId={workspaceId}
    />
  );
}
