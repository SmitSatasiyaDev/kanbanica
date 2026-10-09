"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { task, taskDependency } from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  canAccessSpace,
  getSpacePermission,
  hasPermissionLevel,
} from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { notDeleted } from "@/lib/task-visibility";

// `taskId` lets an open task detail view skip refetching for other tasks.
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

// DFS cycle detection: returns true if adding taskId -> dependsOnTaskId would create a cycle
async function wouldCreateCycle(
  taskId: string,
  dependsOnTaskId: string
): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [dependsOnTaskId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const deps = await db
      .select({ dependsOnTaskId: taskDependency.dependsOnTaskId })
      .from(taskDependency)
      .where(eq(taskDependency.taskId, current));

    queue.push(...deps.map((d) => d.dependsOnTaskId));
  }
  return false;
}

export async function addDependency(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  dependsOnTaskId: string
): Promise<{ dependencyId: string } | { error: string }> {
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

  if (taskId === dependsOnTaskId) {
    return { error: "A task cannot depend on itself" };
  }

  // Verify the dependency target exists and is in the same workspace
  const [target] = await db
    .select({ id: task.id, workspaceId: task.workspaceId, title: task.title })
    .from(task)
    .where(and(eq(task.id, dependsOnTaskId), notDeleted()))
    .limit(1);
  if (!target) {
    return { error: "Target task not found" };
  }
  if (target.workspaceId !== workspaceId) {
    return { error: "Cross-workspace dependencies are not allowed" };
  }

  // Check for existing dependency
  const [existing] = await db
    .select({ id: taskDependency.id })
    .from(taskDependency)
    .where(
      and(
        eq(taskDependency.taskId, taskId),
        eq(taskDependency.dependsOnTaskId, dependsOnTaskId)
      )
    )
    .limit(1);
  if (existing) {
    return { error: "This dependency already exists" };
  }

  // DFS cycle check
  if (await wouldCreateCycle(taskId, dependsOnTaskId)) {
    return {
      error: "Adding this dependency would create a circular reference",
    };
  }

  const depId = createId();
  await db.insert(taskDependency).values({
    id: depId,
    taskId,
    dependsOnTaskId,
    type: "BLOCKED_BY",
  });

  // `depends_on_task_title` is what describeEvent() renders; keep the id too.
  await writeActivityLog(taskId, session.user.id, "dependency_added", {
    dependsOnTaskId,
    depends_on_task_title: target.title,
  });
  revalidateList(workspaceId, spaceId, listId, taskId);
  return { dependencyId: depId };
}

export async function removeDependency(
  workspaceId: string,
  spaceId: string,
  listId: string,
  dependencyId: string,
  taskId: string
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

  const [dep] = await db
    .select({
      dependsOnTaskId: taskDependency.dependsOnTaskId,
      title: task.title,
    })
    .from(taskDependency)
    .leftJoin(task, eq(task.id, taskDependency.dependsOnTaskId))
    .where(eq(taskDependency.id, dependencyId))
    .limit(1);

  await db.delete(taskDependency).where(eq(taskDependency.id, dependencyId));

  await writeActivityLog(taskId, session.user.id, "dependency_removed", {
    dependsOnTaskId: dep?.dependsOnTaskId,
    depends_on_task_title: dep?.title ?? undefined,
  });
  revalidateList(workspaceId, spaceId, listId, taskId);
  return { ok: true };
}

// Search tasks for dependency picker
export async function searchTasksForDependency(
  workspaceId: string,
  spaceId: string,
  query: string,
  excludeTaskId: string
) {
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

  const select = {
    id: task.id,
    title: task.title,
    seqNumber: task.seqNumber,
    statusId: task.statusId,
    spaceId: task.spaceId,
    listId: task.listId,
  };

  // Empty query → offer the most recently updated tasks as a quick-pick list,
  // so a dependency can be added without typing.
  if (query.trim().length < 2) {
    const recent = await db
      .select(select)
      .from(task)
      .where(
        and(
          eq(task.workspaceId, workspaceId),
          eq(task.isArchived, false),
          notDeleted()
        )
      )
      .orderBy(desc(task.updatedAt))
      .limit(25);
    return { tasks: recent.filter((t) => t.id !== excludeTaskId).slice(0, 8) };
  }

  const results = await db
    .select(select)
    .from(task)
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        eq(task.isArchived, false),
        notDeleted()
      )
    )
    .orderBy(desc(task.updatedAt))
    .limit(50);

  const filtered = results.filter(
    (t) =>
      t.id !== excludeTaskId &&
      (t.title.toLowerCase().includes(query.toLowerCase()) ||
        String(t.seqNumber).includes(query.replace("#", "")))
  );

  return { tasks: filtered.slice(0, 10) };
}
