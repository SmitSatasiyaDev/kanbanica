import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  dailyChecklistDay,
  dailyChecklistItem,
  dailyChecklistItemFieldValue,
  workspaceMember,
} from "@/db/schema";
import { todayInTz } from "@/lib/local-date";
import type { ChecklistPriority, ChecklistStatus } from "./constants";
import { type DbLike, getUserTimezone } from "./ensure";
import type { FieldType } from "./fields";
import { computeProgress } from "./progress";
import type { ChecklistItemDTO, FieldValueDTO } from "./types";

type ItemRow = typeof dailyChecklistItem.$inferSelect;

export function mapItem(r: ItemRow): ChecklistItemDTO {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    notes: r.notes,
    priority: r.priority as ChecklistPriority,
    dueTime: r.dueTime,
    status: r.status as ChecklistStatus,
    sortOrder: r.sortOrder,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    completedBy: r.completedBy,
  };
}

export async function getDayItems(
  executor: DbLike,
  dayId: string
): Promise<ChecklistItemDTO[]> {
  const rows = await executor
    .select()
    .from(dailyChecklistItem)
    .where(eq(dailyChecklistItem.dayId, dayId))
    .orderBy(
      asc(dailyChecklistItem.sortOrder),
      asc(dailyChecklistItem.createdAt)
    );
  return rows.map(mapItem);
}

export function progressOf(items: ChecklistItemDTO[]) {
  return computeProgress(items.map((i) => i.status));
}

/** "Today" for a user in this workspace, in their effective timezone (user → workspace → UTC). */
export async function userToday(
  executor: DbLike,
  userId: string,
  workspaceId: string,
  now = new Date()
) {
  const timezone = await getUserTimezone(executor, userId, workspaceId);
  return { timezone, today: todayInTz(now, timezone) };
}

/**
 * Resolves an item the caller *owns*: the item's day must belong to `userId` in
 * `workspaceId`. Never trust ids from the client — ownership comes from this join.
 */
export async function resolveOwnedItem(
  executor: DbLike,
  itemId: string,
  userId: string,
  workspaceId: string
) {
  const [row] = await executor
    .select({ item: dailyChecklistItem, day: dailyChecklistDay })
    .from(dailyChecklistItem)
    .innerJoin(
      dailyChecklistDay,
      eq(dailyChecklistDay.id, dailyChecklistItem.dayId)
    )
    .where(
      and(
        eq(dailyChecklistItem.id, itemId),
        eq(dailyChecklistDay.userId, userId),
        eq(dailyChecklistDay.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return row ?? null;
}

/** Status transition → completion bookkeeping (completedAt/By set on DONE, cleared otherwise). */
export function completionFields(
  status: ChecklistStatus,
  userId: string,
  now = new Date()
) {
  return status === "DONE"
    ? { status, completedAt: now, completedBy: userId }
    : { status, completedAt: null, completedBy: null };
}

/** Active, non-guest members among `userIds` (assignment validation). */
export async function filterAssignableUserIds(
  executor: DbLike,
  workspaceId: string,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) {
    return [];
  }
  const rows = await executor
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.status, "ACTIVE"),
        inArray(workspaceMember.userId, userIds),
        inArray(workspaceMember.role, ["OWNER", "ADMIN", "MEMBER"])
      )
    );
  return rows.map((r) => r.userId).filter((u): u is string => u !== null);
}

/** Aggregate columns for per-day progress without loading items (no N+1). */
export const dayCountCols = {
  total: sql<number>`count(${dailyChecklistItem.id})::int`,
  completed: sql<number>`count(*) filter (where ${dailyChecklistItem.status} = 'DONE')::int`,
  started: sql<number>`count(*) filter (where ${dailyChecklistItem.status} = 'IN_PROGRESS')::int`,
};

/** Loads custom-field snapshots + values for many items in one query (no N+1). */
export async function loadItemFields(
  executor: DbLike,
  itemIds: string[]
): Promise<Map<string, FieldValueDTO[]>> {
  const out = new Map<string, FieldValueDTO[]>();
  if (itemIds.length === 0) {
    return out;
  }
  const rows = await executor
    .select()
    .from(dailyChecklistItemFieldValue)
    .where(inArray(dailyChecklistItemFieldValue.itemId, itemIds))
    .orderBy(asc(dailyChecklistItemFieldValue.sortOrder));
  for (const r of rows) {
    const list = out.get(r.itemId) ?? [];
    list.push({
      id: r.id,
      name: r.fieldName,
      type: r.fieldType as FieldType,
      required: r.fieldRequired,
      options: r.fieldOptions,
      sortOrder: r.sortOrder,
      value: r.value,
    });
    out.set(r.itemId, list);
  }
  return out;
}
