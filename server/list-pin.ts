"use server";

import { and, count, eq, max } from "drizzle-orm";
import { task } from "@/db/schema";
import { db } from "@/lib/db";
import { notDeleted } from "@/lib/task-visibility";

export async function pinTaskToList(
  taskId: string,
  actorId: string
): Promise<{ ok: true } | { error: string; code?: string }> {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({ listId: task.listId })
      .from(task)
      .where(and(eq(task.id, taskId), notDeleted()))
      .limit(1);

    if (!t?.listId) {
      return { error: "Task not found or has no list" };
    }

    const [{ pinCount }] = await tx
      .select({ pinCount: count() })
      .from(task)
      .where(
        and(
          eq(task.listId, t.listId),
          eq(task.isPinnedToList, true),
          notDeleted()
        )
      );

    if (pinCount >= 5) {
      return {
        error: "List pin limit reached (5). Unpin a task to add another.",
        code: "LIST_PIN_LIMIT_REACHED",
      };
    }

    const [{ maxOrder }] = await tx
      .select({ maxOrder: max(task.pinnedToListOrder) })
      .from(task)
      .where(
        and(
          eq(task.listId, t.listId),
          eq(task.isPinnedToList, true),
          notDeleted()
        )
      );

    await tx
      .update(task)
      .set({
        isPinnedToList: true,
        pinnedToListBy: actorId,
        pinnedToListAt: new Date(),
        pinnedToListOrder: (maxOrder ?? 0) + 1000,
        updatedAt: new Date(),
      })
      .where(eq(task.id, taskId));

    return { ok: true };
  });
}

export async function unpinTaskFromList(
  taskId: string
): Promise<{ ok: true } | { error: string }> {
  await db
    .update(task)
    .set({
      isPinnedToList: false,
      pinnedToListBy: null,
      pinnedToListAt: null,
      pinnedToListOrder: null,
      updatedAt: new Date(),
    })
    .where(eq(task.id, taskId));

  return { ok: true };
}

export async function reorderListPins(
  listId: string,
  orderedTaskIds: string[]
): Promise<{ ok: true } | { error: string }> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedTaskIds.length; i++) {
      await tx
        .update(task)
        .set({ pinnedToListOrder: (i + 1) * 1000 })
        .where(and(eq(task.id, orderedTaskIds[i]), eq(task.listId, listId)));
    }
  });
  return { ok: true };
}
