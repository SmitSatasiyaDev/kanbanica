import { computeProgress, type DayStatus } from "./progress";
import type { HistoryRow } from "./types";

export interface HistoryTotals {
  completed: number;
  percent: number;
  status: DayStatus;
  total: number;
}

export interface HistoryTemplateGroup extends HistoryTotals {
  key: string;
  /** One entry per member/daily instance — the untouched per-user records. */
  members: HistoryRow[];
  name: string | null;
}

export interface HistoryDateGroup extends HistoryTotals {
  date: string;
  templates: HistoryTemplateGroup[];
}

/** Sums items (not percentages): completed items / total items across the rows. */
function totals(rows: HistoryRow[]): HistoryTotals {
  const completed = rows.reduce((n, r) => n + r.completed, 0);
  const total = rows.reduce((n, r) => n + r.total, 0);
  const { percent } = computeProgress({ completed, total });
  const status: DayStatus =
    total === 0
      ? "EMPTY"
      : completed === total
        ? "COMPLETE"
        : completed > 0 || rows.some((r) => r.status === "IN_PROGRESS")
          ? "IN_PROGRESS"
          : "NOT_STARTED";
  return { completed, total, percent, status };
}

/**
 * Presentation-only: date → template → member. Pages are merged by date, so a date split
 * across two fetched pages still yields ONE group. Dates newest-first; templates and members
 * keep the order they arrived in.
 */
export function groupHistory(rows: HistoryRow[]): HistoryDateGroup[] {
  const byDate = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) {
      list.push(r);
    } else {
      byDate.set(r.date, [r]);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, dayRows]) => {
      const byTemplate = new Map<string, HistoryRow[]>();
      for (const r of dayRows) {
        const key = r.templateId ?? `name:${r.templateName ?? ""}`;
        const list = byTemplate.get(key);
        if (list) {
          list.push(r);
        } else {
          byTemplate.set(key, [r]);
        }
      }
      return {
        date,
        ...totals(dayRows),
        templates: [...byTemplate.entries()].map(([key, members]) => ({
          key,
          name: members[0].templateName,
          members,
          ...totals(members),
        })),
      };
    });
}
