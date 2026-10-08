"use server";

import { and, asc, desc, eq, inArray, lt, max } from "drizzle-orm";
import {
  dailyChecklistDay,
  dailyChecklistItem,
  dailyChecklistItemFieldValue,
  dailyChecklistTemplate,
  user,
  workspace,
} from "@/db/schema";
import { requireChecklistAccess } from "@/lib/daily-checklist/access";
import { LIMITS } from "@/lib/daily-checklist/constants";
import {
  ensurePersonalDay,
  ensureTeamDays,
} from "@/lib/daily-checklist/ensure";
import { isMissing, normalizeFieldValue } from "@/lib/daily-checklist/fields";
import { dayStatus } from "@/lib/daily-checklist/progress";
import {
  completionFields,
  dayCountCols,
  getDayItems,
  loadItemFields,
  mapItem,
  progressOf,
  resolveOwnedItem,
  userToday,
} from "@/lib/daily-checklist/queries";
import type {
  ChecklistActionError,
  DayDetail,
  HistoryPage,
  HistoryRow,
  MyChecklistResult,
  TeamChecklistResult,
  TeamItemRow,
} from "@/lib/daily-checklist/types";
import {
  dateSchema,
  firstError,
  itemFieldsSchema,
  itemPatchSchema,
  statusSchema,
} from "@/lib/daily-checklist/validation";
import { db } from "@/lib/db";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { getEffectiveTimezone } from "@/lib/timezone";

const READ_ONLY = "Past days are read-only history";

function clampLimit(limit?: number) {
  return Math.min(Math.max(limit ?? LIMITS.historyPageSize, 1), 100);
}

// ─────────────────────────────── Personal ───────────────────────────────

/**
 * Today's personal checklist is created lazily here on first access — the worker is
 * never involved, so a worker outage cannot make it unavailable. A past date is only
 * read, never generated; a future date is rejected.
 */
export async function getMyChecklist(
  workspaceId: string,
  date?: string
): Promise<MyChecklistResult | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "personal");
  if ("error" in a) {
    return { error: a.error };
  }
  const { today, timezone } = await userToday(db, a.userId, workspaceId);
  const parsed =
    date === undefined
      ? { success: true as const, data: today }
      : dateSchema.safeParse(date);
  if (!parsed.success) {
    return { error: "Invalid date" };
  }
  const target = parsed.data;
  if (target > today) {
    return { error: "Cannot open a future day" };
  }

  let dayId: string | null;
  if (target === today) {
    dayId = await ensurePersonalDay(db, workspaceId, a.userId, target);
  } else {
    const [d] = await db
      .select({ id: dailyChecklistDay.id })
      .from(dailyChecklistDay)
      .where(
        and(
          eq(dailyChecklistDay.workspaceId, workspaceId),
          eq(dailyChecklistDay.userId, a.userId),
          eq(dailyChecklistDay.type, "PERSONAL"),
          eq(dailyChecklistDay.date, target)
        )
      )
      .limit(1);
    dayId = d?.id ?? null;
  }
  const items = dayId ? await getDayItems(db, dayId) : [];
  return {
    date: target,
    today,
    timezone,
    editable: target === today,
    exists: dayId !== null,
    items,
    progress: progressOf(items),
  };
}

/** Resolves the caller's editable (today) personal day for a mutation. */
type PersonalItemRef = NonNullable<
  Awaited<ReturnType<typeof resolveOwnedItem>>
>;

async function editablePersonalItem(
  workspaceId: string,
  itemId: string
): Promise<
  | { error: string }
  | {
      a: Exclude<
        Awaited<ReturnType<typeof requireChecklistAccess>>,
        { error: string }
      >;
      row: PersonalItemRef;
    }
> {
  const a = await requireChecklistAccess(workspaceId, "personal");
  if ("error" in a) {
    return { error: a.error };
  }
  const row = await resolveOwnedItem(db, itemId, a.userId, workspaceId);
  if (row?.day.type !== "PERSONAL") {
    return { error: "Item not found" };
  }
  const { today } = await userToday(db, a.userId, workspaceId);
  if (row.day.date !== today) {
    return { error: READ_ONLY };
  }
  return { a, row };
}

export async function createChecklistItem(
  workspaceId: string,
  input: unknown
): Promise<{ id: string } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "personal");
  if ("error" in a) {
    return { error: a.error };
  }
  const parsed = itemFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstError(parsed.error) };
  }
  const { today } = await userToday(db, a.userId, workspaceId);
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    const dayId = await ensurePersonalDay(tx, workspaceId, a.userId, today);
    const [m] = await tx
      .select({ v: max(dailyChecklistItem.sortOrder) })
      .from(dailyChecklistItem)
      .where(eq(dailyChecklistItem.dayId, dayId));
    await tx.insert(dailyChecklistItem).values({
      id,
      dayId,
      title: parsed.data.title,
      description: parsed.data.description,
      notes: parsed.data.notes,
      priority: parsed.data.priority,
      dueTime: parsed.data.dueTime,
      sortOrder: (m?.v ?? -1) + 1,
    });
  });
  await refreshWorkspace(workspaceId);
  return { id };
}

export async function updateChecklistItem(
  workspaceId: string,
  itemId: string,
  patch: unknown
): Promise<{ ok: true } | ChecklistActionError> {
  const parsed = itemPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { error: firstError(parsed.error) };
  }
  const status =
    patch && typeof patch === "object" && "status" in patch
      ? statusSchema.safeParse((patch as { status: unknown }).status)
      : null;
  if (status && !status.success) {
    return { error: "Invalid status" };
  }
  const r = await editablePersonalItem(workspaceId, itemId);
  if ("error" in r) {
    return { error: r.error };
  }
  await db
    .update(dailyChecklistItem)
    .set({
      ...parsed.data,
      ...(status?.success ? completionFields(status.data, r.a.userId) : {}),
      updatedAt: new Date(),
    })
    .where(eq(dailyChecklistItem.id, itemId));
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function toggleChecklistItem(
  workspaceId: string,
  itemId: string
): Promise<{ status: "PENDING" | "DONE" } | ChecklistActionError> {
  const r = await editablePersonalItem(workspaceId, itemId);
  if ("error" in r) {
    return { error: r.error };
  }
  const next = r.row.item.status === "DONE" ? "PENDING" : "DONE";
  await db
    .update(dailyChecklistItem)
    .set({ ...completionFields(next, r.a.userId), updatedAt: new Date() })
    .where(eq(dailyChecklistItem.id, itemId));
  await refreshWorkspace(workspaceId);
  return { status: next };
}

export async function deleteChecklistItem(
  workspaceId: string,
  itemId: string
): Promise<{ ok: true } | ChecklistActionError> {
  const r = await editablePersonalItem(workspaceId, itemId);
  if ("error" in r) {
    return { error: r.error };
  }
  await db.delete(dailyChecklistItem).where(eq(dailyChecklistItem.id, itemId));
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

/** `orderedIds` must be exactly today's personal item ids; sort order follows array order. */
export async function reorderChecklistItems(
  workspaceId: string,
  orderedIds: string[]
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "personal");
  if ("error" in a) {
    return { error: a.error };
  }
  if (!Array.isArray(orderedIds) || orderedIds.length > 500) {
    return { error: "Invalid order" };
  }
  const { today } = await userToday(db, a.userId, workspaceId);
  const ok = await db.transaction(async (tx) => {
    const dayId = await ensurePersonalDay(tx, workspaceId, a.userId, today);
    const current = await tx
      .select({ id: dailyChecklistItem.id })
      .from(dailyChecklistItem)
      .where(eq(dailyChecklistItem.dayId, dayId));
    const have = new Set(current.map((c) => c.id));
    if (
      have.size !== orderedIds.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      !orderedIds.every((id) => have.has(id))
    ) {
      return false;
    }
    for (const [i, id] of orderedIds.entries()) {
      await tx
        .update(dailyChecklistItem)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(
          and(
            eq(dailyChecklistItem.id, id),
            eq(dailyChecklistItem.dayId, dayId)
          )
        );
    }
    return true;
  });
  if (!ok) {
    return { error: "Invalid order" };
  }
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function getMyChecklistHistory(
  workspaceId: string,
  opts?: { before?: string; date?: string; limit?: number }
): Promise<HistoryPage | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "personal");
  if ("error" in a) {
    return { error: a.error };
  }
  return historyPage({
    workspaceId,
    userId: a.userId,
    type: "PERSONAL",
    ...opts,
  });
}

// ─────────────────────────────── Team ───────────────────────────────

export async function getMyTeamChecklist(
  workspaceId: string,
  date?: string
): Promise<TeamChecklistResult | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "team");
  if ("error" in a) {
    return { error: a.error };
  }
  const { today, timezone } = await userToday(db, a.userId, workspaceId);
  const parsed =
    date === undefined
      ? { success: true as const, data: today }
      : dateSchema.safeParse(date);
  if (!parsed.success) {
    return { error: "Invalid date" };
  }
  const target = parsed.data;
  if (target > today) {
    return { error: "Cannot open a future day" };
  }

  // On-demand generation for the VIEWER only: their own today's instances exist even if the
  // worker hasn't run yet. Teammates' days are generated by the hourly worker (and
  // immediately when they are first assigned), so this view only reads them — it never
  // sweeps the workspace.
  if (target === today) {
    await db.transaction(async (tx) => {
      await ensureTeamDays(tx, a.userId, target, workspaceId);
    });
  }

  // Admins see every instance in the workspace; members see instances of the
  // templates they are assigned to (their own are the only editable ones).
  const visibleTemplates = a.isAdmin
    ? null
    : db
        .select({ id: dailyChecklistDay.templateId })
        .from(dailyChecklistDay)
        .where(
          and(
            eq(dailyChecklistDay.workspaceId, workspaceId),
            eq(dailyChecklistDay.userId, a.userId),
            eq(dailyChecklistDay.type, "TEAM"),
            eq(dailyChecklistDay.date, target)
          )
        );

  const rows = await db
    .select({
      item: dailyChecklistItem,
      dayId: dailyChecklistDay.id,
      assigneeId: dailyChecklistDay.userId,
      templateId: dailyChecklistDay.templateId,
      templateName: dailyChecklistTemplate.name,
      assigneeName: user.name,
      assigneeImage: user.image,
      assigneeTz: user.timezone,
    })
    .from(dailyChecklistDay)
    .innerJoin(
      dailyChecklistItem,
      eq(dailyChecklistItem.dayId, dailyChecklistDay.id)
    )
    .innerJoin(user, eq(user.id, dailyChecklistDay.userId))
    .leftJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistDay.templateId)
    )
    .where(
      and(
        eq(dailyChecklistDay.workspaceId, workspaceId),
        eq(dailyChecklistDay.type, "TEAM"),
        eq(dailyChecklistDay.date, target),
        visibleTemplates
          ? inArray(dailyChecklistDay.templateId, visibleTemplates)
          : undefined
      )
    )
    .orderBy(
      asc(dailyChecklistTemplate.name),
      asc(user.name),
      asc(dailyChecklistItem.sortOrder)
    );

  const isToday = target === today;
  const [wsRow] = await db
    .select({ tz: workspace.timezone })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const fieldsByItem = await loadItemFields(
    db,
    rows.map((r) => r.item.id)
  );
  const result: TeamItemRow[] = rows.map((r) => ({
    ...mapItem(r.item),
    fields: fieldsByItem.get(r.item.id) ?? [],
    dayId: r.dayId,
    assigneeId: r.assigneeId,
    assigneeName: r.assigneeName,
    assigneeImage: r.assigneeImage,
    assigneeTimezone: getEffectiveTimezone(
      { timezone: r.assigneeTz },
      { timezone: wsRow?.tz }
    ),
    date: target,
    templateId: r.templateId,
    templateItemId: r.item.templateItemId,
    templateName: r.templateName,
    editable: isToday && r.assigneeId === a.userId,
  }));
  return {
    date: target,
    today,
    timezone,
    editable: isToday,
    isAdmin: a.isAdmin,
    rows: result,
  };
}

/**
 * Status / notes only — the assignee owns the instance. Template-derived fields
 * (title, priority, due time) are the day's snapshot and are not editable here.
 */
export async function updateTeamChecklistItem(
  workspaceId: string,
  itemId: string,
  patch: { status?: unknown; notes?: unknown }
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "team");
  if ("error" in a) {
    return { error: a.error };
  }
  const status =
    patch?.status === undefined ? null : statusSchema.safeParse(patch.status);
  if (status && !status.success) {
    return { error: "Invalid status" };
  }
  const notes =
    patch?.notes === undefined
      ? undefined
      : itemPatchSchema.safeParse({ notes: patch.notes });
  if (notes && !notes.success) {
    return { error: firstError(notes.error) };
  }
  if (!status && !notes) {
    return { error: "Nothing to update" };
  }
  const row = await resolveOwnedItem(db, itemId, a.userId, workspaceId);
  if (row?.day.type !== "TEAM") {
    return { error: "Item not found" };
  }
  const { today } = await userToday(db, a.userId, workspaceId);
  if (row.day.date !== today) {
    return { error: READ_ONLY };
  }
  if (status?.success && status.data === "DONE") {
    const missing = await missingRequiredFields(itemId);
    if (missing.length > 0) {
      return { error: `Fill in required fields first: ${missing.join(", ")}` };
    }
  }
  await db
    .update(dailyChecklistItem)
    .set({
      ...(status?.success ? completionFields(status.data, a.userId) : {}),
      ...(notes?.success ? { notes: notes.data.notes ?? null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(dailyChecklistItem.id, itemId));
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

async function missingRequiredFields(itemId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(dailyChecklistItemFieldValue)
    .where(eq(dailyChecklistItemFieldValue.itemId, itemId));
  return rows
    .filter((r) =>
      isMissing(
        { required: r.fieldRequired, type: r.fieldType as never },
        r.value
      )
    )
    .map((r) => r.fieldName);
}

/**
 * Saves custom-field values on the caller's own Team item for today. `values` is keyed by
 * the field-value row id (from `getMyTeamChecklist`); only the stored snapshot is used to
 * validate, never the live template, and definitions can't be changed here.
 */
export async function setChecklistItemFieldValues(
  workspaceId: string,
  itemId: string,
  values: Record<string, unknown>
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "team");
  if ("error" in a) {
    return { error: a.error };
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return { error: "Invalid values" };
  }
  const row = await resolveOwnedItem(db, itemId, a.userId, workspaceId);
  if (row?.day.type !== "TEAM") {
    return { error: "Item not found" };
  }
  const { today } = await userToday(db, a.userId, workspaceId);
  if (row.day.date !== today) {
    return { error: READ_ONLY };
  }
  const fields = await db
    .select()
    .from(dailyChecklistItemFieldValue)
    .where(eq(dailyChecklistItemFieldValue.itemId, itemId));
  const byId = new Map(fields.map((f) => [f.id, f]));
  const updates: { id: string; value: string | null }[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const f = byId.get(key);
    if (!f) {
      return { error: "Unknown field" };
    }
    const res = normalizeFieldValue(
      {
        type: f.fieldType as never,
        required: f.fieldRequired,
        options: f.fieldOptions,
      },
      raw
    );
    if (!res.ok) {
      return { error: `${f.fieldName}: ${res.error}` };
    }
    updates.push({ id: f.id, value: res.value });
  }
  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx
        .update(dailyChecklistItemFieldValue)
        .set({ value: u.value, updatedAt: new Date() })
        .where(eq(dailyChecklistItemFieldValue.id, u.id));
    }
  });
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function getMyTeamChecklistHistory(
  workspaceId: string,
  opts?: { before?: string; date?: string; limit?: number }
): Promise<HistoryPage | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "team");
  if ("error" in a) {
    return { error: a.error };
  }
  return historyPage({ workspaceId, userId: a.userId, type: "TEAM", ...opts });
}

/**
 * Read-only detail of one saved day. Personal days: owner only (admins cannot read
 * other people's personal lists). Team days: the assignee, or a workspace Owner/Admin.
 */
export async function getChecklistDay(
  workspaceId: string,
  dayId: string
): Promise<DayDetail | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "personal");
  if ("error" in a) {
    return { error: a.error };
  }
  const [d] = await db
    .select({
      day: dailyChecklistDay,
      templateName: dailyChecklistTemplate.name,
      userName: user.name,
    })
    .from(dailyChecklistDay)
    .innerJoin(user, eq(user.id, dailyChecklistDay.userId))
    .leftJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistDay.templateId)
    )
    .where(
      and(
        eq(dailyChecklistDay.id, dayId),
        eq(dailyChecklistDay.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!d) {
    return { error: "Not found" };
  }
  const own = d.day.userId === a.userId;
  const type = d.day.type as "PERSONAL" | "TEAM";
  const allowed = own || (type === "TEAM" && a.isAdmin);
  // Guests never see Team data, even their own leftovers.
  if (!allowed || (type === "TEAM" && a.role === "GUEST")) {
    return { error: "Not found" };
  }
  const items = await getDayItems(db, dayId);
  if (type === "TEAM") {
    const fieldsByItem = await loadItemFields(
      db,
      items.map((i) => i.id)
    );
    for (const it of items) {
      it.fields = fieldsByItem.get(it.id) ?? [];
    }
  }
  return {
    date: d.day.date,
    type,
    editable: false,
    templateName: d.templateName,
    userName: d.userName,
    items,
    progress: progressOf(items),
  };
}

/**
 * Read-only batch of `getChecklistDay` for the History matrix: one request for all of a
 * template's member-days instead of one per member. Team days of this workspace only — Owners/
 * Admins may read any, everyone else only their own (same rule as `getChecklistDay`; guests get
 * nothing). Ids that don't qualify are simply absent. Stored snapshots, nothing computed.
 */
export async function getChecklistDays(
  workspaceId: string,
  dayIds: string[]
): Promise<Record<string, DayDetail> | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "personal");
  if ("error" in a) {
    return { error: a.error };
  }
  const ids = [...new Set(dayIds)].slice(0, 200);
  if (ids.length === 0 || a.role === "GUEST") {
    return {};
  }
  const days = await db
    .select({
      day: dailyChecklistDay,
      templateName: dailyChecklistTemplate.name,
      userName: user.name,
    })
    .from(dailyChecklistDay)
    .innerJoin(user, eq(user.id, dailyChecklistDay.userId))
    .leftJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistDay.templateId)
    )
    .where(
      and(
        inArray(dailyChecklistDay.id, ids),
        eq(dailyChecklistDay.workspaceId, workspaceId),
        eq(dailyChecklistDay.type, "TEAM"),
        a.isAdmin ? undefined : eq(dailyChecklistDay.userId, a.userId)
      )
    );
  const out: Record<string, DayDetail> = {};
  await Promise.all(
    days.map(async (d) => {
      const items = await getDayItems(db, d.day.id);
      const fieldsByItem = await loadItemFields(
        db,
        items.map((i) => i.id)
      );
      for (const it of items) {
        it.fields = fieldsByItem.get(it.id) ?? [];
      }
      out[d.day.id] = {
        date: d.day.date,
        type: "TEAM",
        editable: false,
        templateName: d.templateName,
        userName: d.userName,
        items,
        progress: progressOf(items),
      };
    })
  );
  return out;
}

// ─────────────────────────────── shared ───────────────────────────────

async function historyPage(opts: {
  workspaceId: string;
  userId: string;
  type: "PERSONAL" | "TEAM";
  before?: string;
  date?: string;
  limit?: number;
}): Promise<HistoryPage | ChecklistActionError> {
  if (opts.date !== undefined && !dateSchema.safeParse(opts.date).success) {
    return { error: "Invalid date" };
  }
  if (opts.before !== undefined && !dateSchema.safeParse(opts.before).success) {
    return { error: "Invalid date" };
  }
  // Specific-date mode returns that whole date (one user's rows for one date), no cursor.
  const limit = opts.date ? 100 : clampLimit(opts.limit);
  const rows = await db
    .select({
      dayId: dailyChecklistDay.id,
      date: dailyChecklistDay.date,
      userId: dailyChecklistDay.userId,
      templateId: dailyChecklistDay.templateId,
      templateName: dailyChecklistTemplate.name,
      ...dayCountCols,
    })
    .from(dailyChecklistDay)
    .leftJoin(
      dailyChecklistItem,
      eq(dailyChecklistItem.dayId, dailyChecklistDay.id)
    )
    .leftJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistDay.templateId)
    )
    .where(
      and(
        eq(dailyChecklistDay.workspaceId, opts.workspaceId),
        eq(dailyChecklistDay.userId, opts.userId),
        eq(dailyChecklistDay.type, opts.type),
        opts.date
          ? eq(dailyChecklistDay.date, opts.date)
          : opts.before
            ? lt(dailyChecklistDay.date, opts.before)
            : undefined
      )
    )
    .groupBy(dailyChecklistDay.id, dailyChecklistTemplate.name)
    .orderBy(desc(dailyChecklistDay.date), asc(dailyChecklistTemplate.name))
    .limit(limit + 1);
  let page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  // Cursor is a date, so never split one date's rows across two pages.
  if (hasMore && rows[limit].date === page[limit - 1].date) {
    const trimmed = page.filter((r) => r.date !== page[limit - 1].date);
    if (trimmed.length > 0) {
      page = trimmed;
    } else {
      page = rows.filter((r) => r.date === page[0].date);
    }
  }
  const out: HistoryRow[] = page.map((r) => ({
    dayId: r.dayId,
    date: r.date,
    userId: r.userId,
    userName: null,
    templateId: r.templateId,
    templateName: r.templateName,
    total: r.total,
    completed: r.completed,
    status: dayStatus(r.completed, r.total, r.started > 0),
  }));
  return {
    rows: out,
    nextCursor: hasMore ? (page.at(-1)?.date ?? null) : null,
  };
}
