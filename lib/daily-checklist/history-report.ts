import { LIMITS } from "./constants";
import type { DayStatus } from "./progress";
import type { HistoryReportStatus } from "./types";

/** Pure helpers behind Admin → Checklist → History (report). Presentation/filter math only. */

export const HISTORY_REPORT_STATUSES: readonly HistoryReportStatus[] = [
  "COMPLETED",
  "IN_PROGRESS",
  "NOT_STARTED",
];

export const parseHistoryStatus = (
  v: string | null | undefined
): HistoryReportStatus | undefined =>
  HISTORY_REPORT_STATUSES.find((s) => s === v);

const dayMs = 86_400_000;
const utc = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
};

/** YYYY-MM-DD ± n days — plain calendar math, no timezone involved. */
export function addDays(date: string, n: number): string {
  return new Date(utc(date) + n * dayMs).toISOString().slice(0, 10);
}

/** Inclusive number of days between two plain dates. */
export const daySpan = (from: string, to: string) =>
  Math.round((utc(to) - utc(from)) / dayMs) + 1;

/** Default range: the last 30 days ending on the admin's today. */
export function defaultRange(today: string) {
  return { from: addDays(today, -29), to: today };
}

/**
 * Overdue = not everything is done and the checklist's date is already over (before the
 * admin's today). Today's unfinished lists are in progress / not started, never overdue.
 */
export const isDayOverdue = (
  date: string,
  today: string,
  completed: number,
  total: number
) => total > 0 && completed < total && date < today;

export const pageCountFor = (total: number, pageSize: number) =>
  Math.max(1, Math.ceil(total / pageSize));

/** Clamp a requested page into 1…pageCount (NaN / fractions / out of range are safe). */
export const clampPage = (page: number | undefined, pageCount: number) =>
  Math.min(Math.max(Math.floor(page ?? 1) || 1, 1), pageCount);

/**
 * Page numbers to show: always first and last, a window around the current page, and
 * `null` for each "…" gap. `pageWindow(1, 3)` → [1, 2, 3].
 */
export function pageWindow(page: number, count: number): (number | null)[] {
  const keep = new Set(
    [1, count, page - 1, page, page + 1].filter((p) => p >= 1 && p <= count)
  );
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (const [i, p] of sorted.entries()) {
    if (i > 0 && p - sorted[i - 1] > 1) {
      out.push(null);
    }
    out.push(p);
  }
  return out;
}

export const HISTORY_PAGE_SIZE = LIMITS.historyReportPageSize;

export const STATUS_LABEL: Record<DayStatus, string> = {
  COMPLETE: "Completed",
  IN_PROGRESS: "In Progress",
  NOT_STARTED: "Not Started",
  EMPTY: "No items",
};
