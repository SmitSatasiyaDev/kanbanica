"use server";

import { createId } from "@paralleldrive/cuid2";
import {
  and,
  asc,
  between,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
} from "drizzle-orm";
import { headers } from "next/headers";
import { checklistTask, checklistTaskOccurrence } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  addDays,
  CHECKLIST_REPEAT_UNITS,
  CHECKLIST_REPEATS,
  CHECKLIST_STATUSES,
  type ChecklistRepeat,
  type ChecklistRepeatUnit,
  type ChecklistStatus,
  FUTURE_COMPLETION_ERROR,
  isOccurrenceVisible,
  isValidDateStr,
  isValidMonthStr,
  isValidTimeStr,
  MAX_REPEAT_INTERVAL,
  monthRange,
  pickPreviewTasks,
  type RecurrenceRule,
  resolveSeriesEnd,
  stopEndDate,
  summarizeStatuses,
} from "@/lib/daily-checklist";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";

// NOTE: unlike most mutations, these deliberately do NOT call
// `refreshWorkspace()`. The checklist is strictly personal (scoped to the
// signed-in user), so broadcasting `data_changed` would make every other
// workspace member's page refetch on each checkbox tick for nothing. The page
// is client-driven (SWR) and updates itself after each action.

export type ChecklistScope = "DAY" | "FUTURE" | "ALL";

export interface ChecklistEntry {
  completedAt: string | null;
  date: string;
  dueTime: string | null;
  endDate: string | null;
  /** Soft-deleted series: kept only so its earlier days stay visible. */
  isDeleted: boolean;
  isRecurring: boolean;
  itemId: string;
  repeat: ChecklistRepeat;
  repeatInterval: number;
  repeatUnit: ChecklistRepeatUnit | null;
  startDate: string;
  status: ChecklistStatus;
  title: string;
}

/** One line of a calendar hover preview (skipped tasks are never listed). */
export interface ChecklistDayPreviewTask {
  itemId: string;
  status: ChecklistStatus;
  title: string;
}

/** One task of a day, for the Calendar Focus cells (skipped tasks excluded). */
export interface ChecklistDayTask extends ChecklistDayPreviewTask {
  dueTime: string | null;
  repeat: ChecklistRepeat;
  repeatInterval: number;
  repeatUnit: ChecklistRepeatUnit | null;
}

export interface ChecklistDaySummary {
  completed: number;
  /** Up to 3 tasks, pending first, for the hover preview. */
  preview: ChecklistDayPreviewTask[];
  /** Every non-skipped task of the day, same order as the day view. */
  tasks: ChecklistDayTask[];
  total: number;
}

export interface ChecklistInput {
  dueTime: string | null;
  /** Series end: a date, or null. Mutually exclusive with `endAfter`. */
  endAfter: number | null;
  endDate: string | null;
  repeat: ChecklistRepeat;
  repeatInterval: number;
  repeatUnit: ChecklistRepeatUnit | null;
  title: string;
}

const STALE = {
  error: "This task was changed elsewhere. Refresh and try again.",
} as const;

type Item = typeof checklistTask.$inferSelect;
type Occurrence = typeof checklistTaskOccurrence.$inferSelect;

async function requireMember(
  workspaceId: string
): Promise<{ userId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }
  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) {
    return { error: "Forbidden" };
  }
  return { userId: session.user.id };
}

/**
 * Past days are read-only. "Today" is the caller's browser-local day, so the
 * client passes it; it's only trusted if it's within a day of the server's UTC
 * date (every real timezone is). That also bounds the future-completion check:
 * a day can only count as "today or earlier" if it is <= the client's today,
 * which is itself <= UTC date + 1.
 */
function checkEditable(date: string, today: string): { error: string } | null {
  if (!isValidDateStr(today)) {
    return { error: "Invalid request" };
  }
  const utcToday = new Date().toISOString().slice(0, 10);
  if (today < addDays(utcToday, -1) || today > addDays(utcToday, 1)) {
    return { error: "Invalid request" };
  }
  if (date < today) {
    return { error: "Past days are read-only" };
  }
  return null;
}

function ruleOf(item: Item): RecurrenceRule {
  return {
    startDate: item.startDate,
    endDate: item.endDate,
    repeat: item.repeat as ChecklistRepeat,
    repeatInterval: item.repeatInterval,
    repeatUnit: item.repeatUnit as ChecklistRepeatUnit | null,
  };
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
  }
  return out;
}

/**
 * Expands the user's items into per-date entries across [from, to]. An entry
 * exists when the recurrence rule fires, or when a stored occurrence was
 * completed/skipped (so history survives later rule edits).
 */
async function loadEntries(
  workspaceId: string,
  userId: string,
  from: string,
  to: string
): Promise<Map<string, ChecklistEntry[]>> {
  const items = await db
    .select()
    .from(checklistTask)
    .where(
      and(
        eq(checklistTask.workspaceId, workspaceId),
        eq(checklistTask.userId, userId),
        // Soft-deleted series stay loaded: they are end-dated at deletion, so
        // only their earlier days show (see isOccurrenceVisible).
        or(
          and(
            lte(checklistTask.startDate, to),
            or(isNull(checklistTask.endDate), gte(checklistTask.endDate, from))
          ),
          // A stopped series is past its end date but must keep showing days
          // that were completed or skipped.
          exists(
            db
              .select({ one: checklistTaskOccurrence.id })
              .from(checklistTaskOccurrence)
              .where(
                and(
                  eq(checklistTaskOccurrence.itemId, checklistTask.id),
                  between(checklistTaskOccurrence.occurrenceDate, from, to),
                  ne(checklistTaskOccurrence.status, "INCOMPLETE"),
                  isNull(checklistTaskOccurrence.removedAt),
                  // a recorded row past the series end is never shown
                  or(
                    isNull(checklistTask.endDate),
                    lte(
                      checklistTaskOccurrence.occurrenceDate,
                      checklistTask.endDate
                    )
                  )
                )
              )
          )
        )
      )
    )
    .orderBy(asc(checklistTask.createdAt));

  const result = new Map<string, ChecklistEntry[]>();
  if (items.length === 0) {
    return result;
  }

  const occurrences = await db
    .select()
    .from(checklistTaskOccurrence)
    .where(
      and(
        inArray(
          checklistTaskOccurrence.itemId,
          items.map((i) => i.id)
        ),
        between(checklistTaskOccurrence.occurrenceDate, from, to)
      )
    );

  const occByKey = new Map<string, Occurrence>();
  for (const o of occurrences) {
    occByKey.set(`${o.itemId}|${o.occurrenceDate}`, o);
  }

  for (const date of eachDate(from, to)) {
    const day: ChecklistEntry[] = [];
    for (const item of items) {
      const occ = occByKey.get(`${item.id}|${date}`);
      const status = (occ?.status ?? "INCOMPLETE") as ChecklistStatus;
      if (
        !isOccurrenceVisible(
          ruleOf(item),
          occ ? status : undefined,
          date,
          occ?.removedAt != null
        )
      ) {
        continue;
      }
      const dueTime =
        occ?.dueTimeOverride == null
          ? item.dueTime
          : occ.dueTimeOverride || null;
      day.push({
        itemId: item.id,
        date,
        title: occ?.titleOverride ?? item.title,
        dueTime,
        status,
        completedAt: occ?.completedAt ? occ.completedAt.toISOString() : null,
        repeat: item.repeat as ChecklistRepeat,
        repeatInterval: item.repeatInterval,
        repeatUnit: item.repeatUnit as ChecklistRepeatUnit | null,
        isDeleted: item.deletedAt !== null,
        isRecurring: item.repeat !== "NONE",
        startDate: item.startDate,
        endDate: item.endDate,
      });
    }
    // Timed tasks first (chronological), untimed after; stable by creation.
    day.sort((a, b) => {
      if (a.dueTime && b.dueTime) {
        return a.dueTime.localeCompare(b.dueTime);
      }
      return a.dueTime ? -1 : b.dueTime ? 1 : 0;
    });
    result.set(date, day);
  }
  return result;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getChecklistForDate(
  workspaceId: string,
  date: string
): Promise<{ entries: ChecklistEntry[] } | { error: string }> {
  const ctx = await requireMember(workspaceId);
  if ("error" in ctx) {
    return ctx;
  }
  if (!isValidDateStr(date)) {
    return { error: "Invalid date" };
  }
  const map = await loadEntries(workspaceId, ctx.userId, date, date);
  return { entries: map.get(date) ?? [] };
}

/** Per-day completed/total counts for the calendar dots. `month` = "YYYY-MM". */
export async function getChecklistMonthSummary(
  workspaceId: string,
  month: string
): Promise<{ days: Record<string, ChecklistDaySummary> } | { error: string }> {
  const ctx = await requireMember(workspaceId);
  if ("error" in ctx) {
    return ctx;
  }
  if (!isValidMonthStr(month)) {
    return { error: "Invalid month" };
  }
  const { from, to } = monthRange(month);
  const map = await loadEntries(workspaceId, ctx.userId, from, to);
  const days: Record<string, ChecklistDaySummary> = {};
  for (const [date, entries] of map) {
    // Skipped tasks don't count against the day.
    const summary = summarizeStatuses(entries.map((e) => e.status));
    if (summary.total > 0) {
      days[date] = {
        ...summary,
        tasks: entries
          .filter((e) => e.status !== "SKIPPED")
          .map((e) => ({
            itemId: e.itemId,
            title: e.title,
            status: e.status,
            dueTime: e.dueTime,
            repeat: e.repeat,
            repeatInterval: e.repeatInterval,
            repeatUnit: e.repeatUnit,
          })),
        preview: pickPreviewTasks(
          entries
            .filter((e) => e.status !== "SKIPPED")
            .map((e) => ({
              itemId: e.itemId,
              title: e.title,
              status: e.status,
            }))
        ),
      };
    }
  }
  return { days };
}

// ─── Validation ───────────────────────────────────────────────────────────────

function parseInput(
  raw: ChecklistInput
): { value: ChecklistInput } | { error: string } {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) {
    return { error: "Task name is required" };
  }
  if (title.length > 200) {
    return { error: "Task name must be 200 characters or fewer" };
  }
  const dueTime = raw.dueTime ? raw.dueTime : null;
  if (dueTime && !isValidTimeStr(dueTime)) {
    return { error: "Invalid due time" };
  }
  if (!CHECKLIST_REPEATS.includes(raw.repeat)) {
    return { error: "Invalid repeat option" };
  }
  let repeatInterval = 1;
  let repeatUnit: ChecklistRepeatUnit | null = null;
  if (raw.repeat === "CUSTOM") {
    if (
      !Number.isInteger(raw.repeatInterval) ||
      raw.repeatInterval < 1 ||
      raw.repeatInterval > MAX_REPEAT_INTERVAL
    ) {
      return {
        error: `Repeat interval must be between 1 and ${MAX_REPEAT_INTERVAL}`,
      };
    }
    if (!raw.repeatUnit || !CHECKLIST_REPEAT_UNITS.includes(raw.repeatUnit)) {
      return { error: "Invalid repeat unit" };
    }
    repeatInterval = raw.repeatInterval;
    repeatUnit = raw.repeatUnit;
  }
  const endAfter =
    raw.repeat !== "NONE" && raw.endAfter != null ? raw.endAfter : null;
  const endDate = raw.repeat !== "NONE" && raw.endDate ? raw.endDate : null;
  return {
    value: {
      title,
      endAfter,
      endDate,
      dueTime,
      repeat: raw.repeat,
      repeatInterval,
      repeatUnit,
    },
  };
}

async function getOwnItem(
  workspaceId: string,
  userId: string,
  itemId: string
): Promise<Item | null> {
  const [item] = await db
    .select()
    .from(checklistTask)
    .where(
      and(
        eq(checklistTask.id, itemId),
        eq(checklistTask.workspaceId, workspaceId),
        eq(checklistTask.userId, userId),
        isNull(checklistTask.deletedAt)
      )
    )
    .limit(1);
  return item ?? null;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createChecklistItem(
  workspaceId: string,
  date: string,
  input: ChecklistInput,
  today: string
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireMember(workspaceId);
  if ("error" in ctx) {
    return ctx;
  }
  if (!isValidDateStr(date)) {
    return { error: "Invalid date" };
  }
  const lockedErr = checkEditable(date, today);
  if (lockedErr) {
    return lockedErr;
  }
  const parsed = parseInput(input);
  if ("error" in parsed) {
    return parsed;
  }
  const v = parsed.value;
  const end = resolveSeriesEnd({ ...v, startDate: date });
  if ("error" in end) {
    return end;
  }

  await db.insert(checklistTask).values({
    id: createId(),
    workspaceId,
    userId: ctx.userId,
    title: v.title,
    dueTime: v.dueTime,
    repeat: v.repeat,
    repeatInterval: v.repeatInterval,
    repeatUnit: v.repeatUnit,
    startDate: date,
    endDate: end.endDate,
  });
  return { success: true };
}

/** Set one date's state. Only that (item, date) row is written — no other day is touched. */
export async function setChecklistStatus(
  workspaceId: string,
  itemId: string,
  date: string,
  status: ChecklistStatus,
  today: string
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireMember(workspaceId);
  if ("error" in ctx) {
    return ctx;
  }
  if (!isValidDateStr(date) || !CHECKLIST_STATUSES.includes(status)) {
    return { error: "Invalid request" };
  }
  const lockedErr = checkEditable(date, today);
  if (lockedErr) {
    return lockedErr;
  }
  // No `deleted_at` filter: a series deleted from a later day keeps its
  // earlier days (incl. today) completable. Visibility below enforces the end.
  const [item] = await db
    .select()
    .from(checklistTask)
    .where(
      and(
        eq(checklistTask.id, itemId),
        eq(checklistTask.workspaceId, workspaceId),
        eq(checklistTask.userId, ctx.userId)
      )
    )
    .limit(1);
  if (!item) {
    return { error: "Task not found" };
  }
  const [existing] = await db
    .select({
      status: checklistTaskOccurrence.status,
      removedAt: checklistTaskOccurrence.removedAt,
    })
    .from(checklistTaskOccurrence)
    .where(
      and(
        eq(checklistTaskOccurrence.itemId, itemId),
        eq(checklistTaskOccurrence.occurrenceDate, date)
      )
    )
    .limit(1);
  const current = existing?.status as ChecklistStatus | undefined;
  if (
    !isOccurrenceVisible(
      ruleOf(item),
      current,
      date,
      existing?.removedAt != null
    )
  ) {
    return { error: "Task does not occur on this day" };
  }
  // Upcoming days can be viewed, skipped and restored, but not completed or
  // un-completed ahead of time (enforced here, not just in the UI).
  if (
    date > today &&
    (status === "COMPLETED" ||
      (status === "INCOMPLETE" && current === "COMPLETED"))
  ) {
    return { error: FUTURE_COMPLETION_ERROR };
  }

  const now = new Date();
  const done = status === "COMPLETED";
  const fields = {
    status,
    completedAt: done ? now : null,
    completedBy: done ? ctx.userId : null,
    updatedAt: now,
  };
  await db
    .insert(checklistTaskOccurrence)
    .values({ id: createId(), itemId, occurrenceDate: date, ...fields })
    .onConflictDoUpdate({
      target: [
        checklistTaskOccurrence.itemId,
        checklistTaskOccurrence.occurrenceDate,
      ],
      set: fields,
    });
  return { success: true };
}

/**
 * Edit a task from `date`. Scope:
 * - DAY    → only that day's occurrence (title / time overrides)
 * - FUTURE → split the series: the old one ends the day before, a new one
 *            starts on `date`; earlier days keep their values and state
 * - ALL    → the whole series
 */
export async function updateChecklistItem(
  workspaceId: string,
  itemId: string,
  date: string,
  requestedScope: ChecklistScope,
  input: ChecklistInput,
  today: string
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireMember(workspaceId);
  if ("error" in ctx) {
    return ctx;
  }
  if (
    !isValidDateStr(date) ||
    !["DAY", "FUTURE", "ALL"].includes(requestedScope)
  ) {
    return { error: "Invalid request" };
  }
  const lockedErr = checkEditable(date, today);
  if (lockedErr) {
    return lockedErr;
  }
  const parsed = parseInput(input);
  if ("error" in parsed) {
    return parsed;
  }
  const v = parsed.value;
  const item = await getOwnItem(workspaceId, ctx.userId, itemId);
  if (!item) {
    return { error: "Task not found" };
  }
  let scope: ChecklistScope = requestedScope;
  const now = new Date();
  const recurring = item.repeat !== "NONE";
  // Editing a repeating task only ever affects this day or from this day on.
  // "Entire series" would rewrite how past days look, so it isn't offered.
  if (recurring && scope === "ALL") {
    scope = "FUTURE";
  }

  if (scope === "DAY" && recurring) {
    const overrides = {
      titleOverride: v.title === item.title ? null : v.title,
      dueTimeOverride: v.dueTime === item.dueTime ? null : (v.dueTime ?? ""),
      updatedAt: now,
    };
    await db
      .insert(checklistTaskOccurrence)
      .values({ id: createId(), itemId, occurrenceDate: date, ...overrides })
      .onConflictDoUpdate({
        target: [
          checklistTaskOccurrence.itemId,
          checklistTaskOccurrence.occurrenceDate,
        ],
        set: overrides,
      });
    return { success: true };
  }

  const fields = {
    title: v.title,
    dueTime: v.dueTime,
    repeat: v.repeat,
    repeatInterval: v.repeatInterval,
    repeatUnit: v.repeatUnit,
    updatedAt: now,
  };

  if (scope === "ALL" || !recurring || date <= item.startDate) {
    const end = resolveSeriesEnd({ ...v, startDate: item.startDate });
    if ("error" in end) {
      return end;
    }
    await db
      .update(checklistTask)
      .set({ ...fields, endDate: end.endDate })
      .where(eq(checklistTask.id, itemId));
    return { success: true };
  }

  // FUTURE on a series that has earlier days: split it. The new series starts
  // on `date`, so "after N occurrences" counts from there.
  const end = resolveSeriesEnd({ ...v, startDate: date });
  if ("error" in end) {
    return end;
  }
  const outcome = await db.transaction(async (tx) => {
    // Lock + re-check so a double submit / stale tab can't split twice.
    const [cur] = await tx
      .select({ endDate: checklistTask.endDate })
      .from(checklistTask)
      .where(eq(checklistTask.id, itemId))
      .for("update");
    if (!cur || cur.endDate !== item.endDate) {
      return STALE;
    }
    const newId = createId();
    await tx
      .update(checklistTask)
      .set({ endDate: stopEndDate(item.endDate, date), updatedAt: now })
      .where(eq(checklistTask.id, itemId));
    await tx.insert(checklistTask).values({
      ...fields,
      id: newId,
      workspaceId,
      userId: ctx.userId,
      startDate: date,
      endDate: end.endDate,
    });
    // Hand the future days (state kept, per-day overrides dropped — the new
    // values now apply) to the new series.
    await tx
      .update(checklistTaskOccurrence)
      .set({
        itemId: newId,
        titleOverride: null,
        dueTimeOverride: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(checklistTaskOccurrence.itemId, itemId),
          gte(checklistTaskOccurrence.occurrenceDate, date)
        )
      );
    return null;
  });
  return outcome ?? { success: true };
}

// ─── Stop / delete (history-preserving) ──────────────────────────────────────
//
// Nothing here physically deletes a checklist record. Earlier days keep their
// stored occurrences (status, completedAt, completedBy) exactly as recorded.
// The series `endDate` is a hard visibility bound (`isOccurrenceVisible`), so
// recorded rows on/after the effective date stop showing too.
//   • Stop                      → `endDate` = day before the effective date.
//   • Delete, this & future     → same, plus rows from that day on get `removedAt`.
//   • Delete, entire series     → same end-dating plus a `deletedAt` tombstone
//                                 (blocks later edits). Earlier days stay visible.
// All three lock the row and are idempotent, so repeated clicks and stale tabs
// are harmless.

type Outcome = { success: true } | { error: string };

async function prepare(
  workspaceId: string,
  date: string,
  today: string
): Promise<{ userId: string } | { error: string }> {
  const ctx = await requireMember(workspaceId);
  if ("error" in ctx) {
    return ctx;
  }
  if (!isValidDateStr(date)) {
    return { error: "Invalid request" };
  }
  return checkEditable(date, today) ?? ctx;
}

// No `deleted_at` filter on purpose: stop/delete must stay idempotent and a
// repeated click on an already-deleted series is a no-op, not an error.
const ownTask = (workspaceId: string, userId: string, itemId: string) =>
  and(
    eq(checklistTask.id, itemId),
    eq(checklistTask.workspaceId, workspaceId),
    eq(checklistTask.userId, userId)
  );

/** "Stop from this day onward": ends the series the day before `date`. */
export async function stopChecklistSeries(
  workspaceId: string,
  itemId: string,
  date: string,
  today: string
): Promise<Outcome> {
  const ctx = await prepare(workspaceId, date, today);
  if ("error" in ctx) {
    return ctx;
  }
  return await db.transaction(async (tx): Promise<Outcome> => {
    const [item] = await tx
      .select()
      .from(checklistTask)
      .where(ownTask(workspaceId, ctx.userId, itemId))
      .for("update");
    if (!item) {
      return { error: "Task not found" };
    }
    const endDate = stopEndDate(item.endDate, date);
    if (endDate !== item.endDate) {
      await tx
        .update(checklistTask)
        .set({ endDate, updatedAt: new Date() })
        .where(eq(checklistTask.id, itemId));
    }
    return { success: true };
  });
}

/**
 * Delete a task. For a repeating task `scope` picks FUTURE ("this and future
 * days") or ALL ("entire series"); one-off tasks are always ALL. Both are soft
 * — see the block comment above.
 */
export async function deleteChecklistTask(
  workspaceId: string,
  itemId: string,
  date: string,
  scope: "FUTURE" | "ALL",
  today: string
): Promise<Outcome> {
  const ctx = await prepare(workspaceId, date, today);
  if ("error" in ctx) {
    return ctx;
  }
  if (scope !== "FUTURE" && scope !== "ALL") {
    return { error: "Invalid request" };
  }
  return await db.transaction(async (tx): Promise<Outcome> => {
    const [item] = await tx
      .select()
      .from(checklistTask)
      .where(ownTask(workspaceId, ctx.userId, itemId))
      .for("update");
    if (!item) {
      return { error: "Task not found" };
    }
    const now = new Date();
    if (scope === "ALL" || item.repeat === "NONE") {
      // Tombstone + end-date: nothing is scheduled (or shown) from `date` on,
      // earlier days keep showing, no row is removed.
      await tx
        .update(checklistTask)
        .set({
          deletedAt: item.deletedAt ?? now,
          endDate: stopEndDate(item.endDate, date),
          updatedAt: now,
        })
        .where(eq(checklistTask.id, itemId));
      return { success: true };
    }
    const endDate = stopEndDate(item.endDate, date);
    if (endDate !== item.endDate) {
      await tx
        .update(checklistTask)
        .set({ endDate, updatedAt: now })
        .where(eq(checklistTask.id, itemId));
    }
    // Hide recorded days from `date` on without erasing them.
    await tx
      .update(checklistTaskOccurrence)
      .set({ removedAt: now, updatedAt: now })
      .where(
        and(
          eq(checklistTaskOccurrence.itemId, itemId),
          gte(checklistTaskOccurrence.occurrenceDate, date),
          isNull(checklistTaskOccurrence.removedAt)
        )
      );
    return { success: true };
  });
}
