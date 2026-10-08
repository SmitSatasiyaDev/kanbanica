"use server";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  dailyChecklistDay,
  dailyChecklistItem,
  dailyChecklistTemplate,
  user,
  workspaceMember,
} from "@/db/schema";
import { requireChecklistAccess } from "@/lib/daily-checklist/access";
import { LIMITS } from "@/lib/daily-checklist/constants";
import { getUserTimezone } from "@/lib/daily-checklist/ensure";
import {
  clampPage,
  daySpan,
  defaultRange,
  HISTORY_PAGE_SIZE,
  isDayOverdue,
  pageCountFor,
  STATUS_LABEL,
} from "@/lib/daily-checklist/history-report";
import { dayStatus } from "@/lib/daily-checklist/progress";
import {
  dayCountCols,
  loadItemFields,
  mapItem,
  userToday,
} from "@/lib/daily-checklist/queries";
import type {
  ChecklistActionError,
  HistoryItemsResult,
  HistoryReportFilters,
  HistoryReportResult,
  HistoryReportRow,
} from "@/lib/daily-checklist/types";
import { dateSchema } from "@/lib/daily-checklist/validation";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/import-export/csv";

/**
 * Admin → Checklist → History (report). READ-ONLY and summary-only: per-day counts are
 * aggregated in SQL (never loading items), filtering / paging / summary all happen in the
 * database, and the saved items of one day are only fetched when "View" opens it
 * (`getChecklistDays`). Owners/Admins only, scoped to this workspace's TEAM days.
 */

const hasItems = sql`count(${dailyChecklistItem.id}) > 0`;
const unfinished = sql`count(*) filter (where ${dailyChecklistItem.status} = 'DONE') < count(${dailyChecklistItem.id})`;

function statusHaving(status: HistoryReportFilters["status"]) {
  switch (status) {
    case "COMPLETED":
      return sql`${hasItems} and not (${unfinished})`;
    case "IN_PROGRESS":
      return sql`${hasItems} and ${unfinished} and (count(*) filter (where ${dailyChecklistItem.status} = 'DONE') > 0 or count(*) filter (where ${dailyChecklistItem.status} = 'IN_PROGRESS') > 0)`;
    case "NOT_STARTED":
      return sql`${hasItems} and count(*) filter (where ${dailyChecklistItem.status} in ('DONE','IN_PROGRESS')) = 0`;
    default:
      return;
  }
}

async function resolveFilters(
  workspaceId: string,
  input: HistoryReportFilters
): Promise<
  | ChecklistActionError
  | {
      filters: HistoryReportResult["filters"];
      today: string;
    }
> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const { today } = await userToday(db, a.userId, workspaceId);
  const def = defaultRange(today);
  for (const d of [input.from, input.to]) {
    if (d !== undefined && !dateSchema.safeParse(d).success) {
      return { error: "Invalid date" };
    }
  }
  let from = input.from ?? def.from;
  let to = input.to ?? today;
  if (input.from && !input.to) {
    to = today;
  }
  if (from > to) {
    [from, to] = [to, from];
  }
  if (daySpan(from, to) > LIMITS.historyReportMaxDays) {
    return { error: "Date range is too long" };
  }
  return {
    today,
    filters: {
      from,
      to,
      userId: input.userId || undefined,
      templateId: input.templateId || undefined,
      status: input.status,
    },
  };
}

function where(workspaceId: string, f: HistoryReportResult["filters"]) {
  return and(
    eq(dailyChecklistDay.workspaceId, workspaceId),
    eq(dailyChecklistDay.type, "TEAM"),
    gte(dailyChecklistDay.date, f.from),
    lte(dailyChecklistDay.date, f.to),
    f.userId ? eq(dailyChecklistDay.userId, f.userId) : undefined,
    f.templateId ? eq(dailyChecklistDay.templateId, f.templateId) : undefined
  );
}

async function loadRows(
  workspaceId: string,
  f: HistoryReportResult["filters"],
  today: string,
  limit: number,
  offset: number
): Promise<HistoryReportRow[]> {
  const rows = await db
    .select({
      dayId: dailyChecklistDay.id,
      date: dailyChecklistDay.date,
      userId: dailyChecklistDay.userId,
      userName: user.name,
      userImage: user.image,
      templateId: dailyChecklistDay.templateId,
      templateName: dailyChecklistTemplate.name,
      note: sql<
        string | null
      >`(array_agg(btrim(${dailyChecklistItem.notes}) order by ${dailyChecklistItem.sortOrder}) filter (where btrim(coalesce(${dailyChecklistItem.notes}, '')) <> ''))[1]`,
      ...dayCountCols,
    })
    .from(dailyChecklistDay)
    .innerJoin(user, eq(user.id, dailyChecklistDay.userId))
    .leftJoin(
      dailyChecklistItem,
      eq(dailyChecklistItem.dayId, dailyChecklistDay.id)
    )
    .leftJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistDay.templateId)
    )
    .where(where(workspaceId, f))
    .groupBy(dailyChecklistDay.id, user.id, dailyChecklistTemplate.name)
    .having(statusHaving(f.status))
    .orderBy(
      desc(dailyChecklistDay.date),
      asc(dailyChecklistTemplate.name),
      asc(user.name),
      asc(dailyChecklistDay.id)
    )
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    dayId: r.dayId,
    date: r.date,
    userId: r.userId,
    userName: r.userName,
    userImage: r.userImage,
    templateId: r.templateId,
    templateName: r.templateName,
    total: r.total,
    completed: r.completed,
    note: r.note,
    status: dayStatus(r.completed, r.total, r.started > 0),
    overdue: isDayOverdue(r.date, today, r.completed, r.total),
  }));
}

export async function getChecklistHistoryReport(
  workspaceId: string,
  input: HistoryReportFilters = {}
): Promise<HistoryReportResult | ChecklistActionError> {
  const r = await resolveFilters(workspaceId, input);
  if ("error" in r) {
    return r;
  }
  const { filters, today } = r;

  // One aggregate over the days matching date / user / template. The summary cards count this
  // CONTEXT (status filter ignored) so they stay meaningful as clickable filters; `days` (total
  // + paging) additionally applies the selected status.
  const g = db
    .select({
      userId: dailyChecklistDay.userId,
      total: dayCountCols.total.as("total"),
      completed: dayCountCols.completed.as("completed"),
      started: dayCountCols.started.as("started"),
      date: sql<string>`${dailyChecklistDay.date}`.as("date"),
    })
    .from(dailyChecklistDay)
    .leftJoin(
      dailyChecklistItem,
      eq(dailyChecklistItem.dayId, dailyChecklistDay.id)
    )
    .where(where(workspaceId, filters))
    .groupBy(dailyChecklistDay.id)
    .as("g");
  const isCompleted = sql`${g.total} > 0 and ${g.completed} = ${g.total}`;
  const isInProgress = sql`${g.total} > 0 and ${g.completed} < ${g.total} and (${g.completed} > 0 or ${g.started} > 0)`;
  const isNotStarted = sql`${g.total} > 0 and ${g.completed} = 0 and ${g.started} = 0`;
  const selected = {
    COMPLETED: isCompleted,
    IN_PROGRESS: isInProgress,
    NOT_STARTED: isNotStarted,
  }[filters.status ?? "COMPLETED"];
  const [agg] = await db
    .select({
      days: filters.status
        ? sql<number>`count(*) filter (where ${selected})::int`
        : sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${isCompleted})::int`,
      inProgress: sql<number>`count(*) filter (where ${isInProgress})::int`,
      notStarted: sql<number>`count(*) filter (where ${isNotStarted})::int`,
      members: sql<number>`count(distinct ${g.userId})::int`,
    })
    .from(g);

  const total = agg?.days ?? 0;
  const pageCount = pageCountFor(total, HISTORY_PAGE_SIZE);
  const page = clampPage(input.page, pageCount);
  const rows =
    total === 0
      ? []
      : await loadRows(
          workspaceId,
          filters,
          today,
          HISTORY_PAGE_SIZE,
          (page - 1) * HISTORY_PAGE_SIZE
        );

  const [members, templates] = await Promise.all([
    db
      .select({ id: user.id, name: user.name })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.status, "ACTIVE")
        )
      )
      .orderBy(asc(user.name)),
    db
      .select({
        id: dailyChecklistTemplate.id,
        name: dailyChecklistTemplate.name,
      })
      .from(dailyChecklistTemplate)
      .where(
        and(
          eq(dailyChecklistTemplate.workspaceId, workspaceId),
          eq(dailyChecklistTemplate.type, "TEAM")
        )
      )
      .orderBy(asc(dailyChecklistTemplate.name)),
  ]);

  return {
    filters,
    today,
    rows,
    total,
    page,
    pageCount,
    pageSize: HISTORY_PAGE_SIZE,
    summary: {
      completed: agg?.completed ?? 0,
      inProgress: agg?.inProgress ?? 0,
      notStarted: agg?.notStarted ?? 0,
      members: agg?.members ?? 0,
    },
    members,
    templates,
  };
}

/** Spreadsheet formula-injection guard for user-entered text (names, notes). */
const safeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** CSV of the current filters (all pages, capped). Same filters, same permission, read-only. */
export async function exportChecklistHistoryCsv(
  workspaceId: string,
  input: HistoryReportFilters = {}
): Promise<
  { csv: string; filename: string; truncated: boolean } | ChecklistActionError
> {
  const r = await resolveFilters(workspaceId, input);
  if ("error" in r) {
    return r;
  }
  const { filters, today } = r;
  const cap = LIMITS.historyReportExportRows;
  const rows = await loadRows(workspaceId, filters, today, cap + 1, 0);
  const truncated = rows.length > cap;
  const columns = [
    "Date",
    "User",
    "Template",
    "Completed",
    "Total",
    "Status",
    "Overdue",
    "Notes",
  ];
  const csv = toCsv(
    rows.slice(0, cap).map((x) => ({
      Date: x.date,
      User: safeCell(x.userName ?? ""),
      Template: safeCell(x.templateName ?? ""),
      Completed: String(x.completed),
      Total: String(x.total),
      Status: STATUS_LABEL[x.status],
      Overdue: x.overdue ? "Yes" : "No",
      Notes: safeCell(x.note ?? ""),
    })),
    columns
  );
  return {
    csv,
    truncated,
    filename: `checklist-history-${filters.from}_${filters.to}.csv`,
  };
}

/**
 * History → expanded rows. Read-only: ONE request for the saved snapshot items (+ custom-field
 * values) of up to 50 Team days, plus each assignee's timezone for completion times. Admin only,
 * scoped to this workspace; ids that don't qualify are simply absent. Nothing is generated.
 */
export async function getChecklistHistoryItems(
  workspaceId: string,
  dayIds: string[]
): Promise<Record<string, HistoryItemsResult> | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const ids = [...new Set(dayIds)].slice(0, 50);
  if (ids.length === 0) {
    return {};
  }
  const days = await db
    .select({ id: dailyChecklistDay.id, userId: dailyChecklistDay.userId })
    .from(dailyChecklistDay)
    .where(
      and(
        inArray(dailyChecklistDay.id, ids),
        eq(dailyChecklistDay.workspaceId, workspaceId),
        eq(dailyChecklistDay.type, "TEAM")
      )
    );
  if (days.length === 0) {
    return {};
  }
  const itemRows = await db
    .select()
    .from(dailyChecklistItem)
    .where(
      inArray(
        dailyChecklistItem.dayId,
        days.map((d) => d.id)
      )
    )
    .orderBy(
      asc(dailyChecklistItem.sortOrder),
      asc(dailyChecklistItem.createdAt)
    );
  const fields = await loadItemFields(
    db,
    itemRows.map((i) => i.id)
  );
  const tzByUser = new Map<string, string>();
  for (const uid of new Set(days.map((d) => d.userId))) {
    tzByUser.set(uid, await getUserTimezone(db, uid, workspaceId));
  }
  const out: Record<string, HistoryItemsResult> = {};
  for (const d of days) {
    out[d.id] = {
      dayId: d.id,
      items: [],
      timezone: tzByUser.get(d.userId) ?? "UTC",
    };
  }
  for (const r of itemRows) {
    out[r.dayId].items.push({ ...mapItem(r), fields: fields.get(r.id) ?? [] });
  }
  return out;
}
