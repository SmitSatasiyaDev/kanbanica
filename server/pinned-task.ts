"use server";

import { and, count, eq, max } from "drizzle-orm";
import { list, pinnedTask, space, task } from "@/db/schema";
import { db } from "@/lib/db";
import { notDeleted } from "@/lib/task-visibility";

export async function pinTask(
  taskId: string,
  userId: string,
  workspaceId: string
): Promise<{ ok: true } | { error: string; code?: string }> {
  return db.transaction(async (tx) => {
    const [{ total }] = await tx
      .select({ total: count() })
      .from(pinnedTask)
      .where(
        and(
          eq(pinnedTask.userId, userId),
          eq(pinnedTask.workspaceId, workspaceId)
        )
      );

    if (total >= 50) {
      return {
        error: "Pin limit reached (50). Unpin a task first.",
        code: "PIN_LIMIT_REACHED",
      };
    }

    const [{ maxOrder }] = await tx
      .select({ maxOrder: max(pinnedTask.orderIndex) })
      .from(pinnedTask)
      .where(
        and(
          eq(pinnedTask.userId, userId),
          eq(pinnedTask.workspaceId, workspaceId)
        )
      );

    await tx.insert(pinnedTask).values({
      id: crypto.randomUUID(),
      userId,
      taskId,
      workspaceId,
      orderIndex: (maxOrder ?? 0) + 1000,
      pinnedAt: new Date(),
    });

    return { ok: true };
  });
}

export async function unpinTask(
  taskId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  await db
    .delete(pinnedTask)
    .where(and(eq(pinnedTask.taskId, taskId), eq(pinnedTask.userId, userId)));
  return { ok: true };
}

export interface PinnedTaskItem {
  id: string;
  listId: string | null;
  listName: string | null;
  orderIndex: number;
  pinnedAt: Date;
  spaceId: string | null;
  spaceName: string | null;
  taskId: string;
  taskStatus: { name: string; color: string; type: string } | null;
  taskTitle: string;
}

export async function getPinnedTasks(
  userId: string,
  workspaceId: string
): Promise<{ pinnedTasks: PinnedTaskItem[] }> {
  const rows = await db
    .select({
      id: pinnedTask.id,
      taskId: pinnedTask.taskId,
      taskTitle: task.title,
      listId: task.listId,
      listName: list.name,
      spaceId: list.spaceId,
      spaceName: space.name,
      orderIndex: pinnedTask.orderIndex,
      pinnedAt: pinnedTask.pinnedAt,
    })
    .from(pinnedTask)
    .innerJoin(task, eq(pinnedTask.taskId, task.id))
    .leftJoin(list, eq(task.listId, list.id))
    .leftJoin(space, eq(list.spaceId, space.id))
    .where(
      and(
        eq(pinnedTask.userId, userId),
        eq(pinnedTask.workspaceId, workspaceId),
        notDeleted()
      )
    )
    .orderBy(pinnedTask.orderIndex);

  return {
    pinnedTasks: rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      taskTitle: r.taskTitle,
      taskStatus: null,
      listId: r.listId,
      listName: r.listName,
      spaceId: r.spaceId,
      spaceName: r.spaceName,
      orderIndex: r.orderIndex,
      pinnedAt: r.pinnedAt,
    })),
  };
}

export async function reorderPinnedTasks(
  userId: string,
  workspaceId: string,
  orderedIds: string[]
): Promise<{ ok: true } | { error: string }> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(pinnedTask)
        .set({ orderIndex: (i + 1) * 1000 })
        .where(
          and(
            eq(pinnedTask.id, orderedIds[i]),
            eq(pinnedTask.userId, userId),
            eq(pinnedTask.workspaceId, workspaceId)
          )
        );
    }
  });
  return { ok: true };
}

export async function isTaskPinned(
  taskId: string,
  userId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: pinnedTask.id })
    .from(pinnedTask)
    .where(and(eq(pinnedTask.taskId, taskId), eq(pinnedTask.userId, userId)))
    .limit(1);
  return !!row;
}
