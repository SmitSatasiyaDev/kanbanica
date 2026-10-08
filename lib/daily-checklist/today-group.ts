import { computeProgress, type DayStatus } from "./progress";
import type { TodayInstanceRow } from "./types";

export interface TodayTemplateGroup {
  /** Checklist items done / total across all users. */
  itemsCompleted: number;
  itemsPercent: number;
  itemsTotal: number;
  key: string;
  name: string | null;
  /** Parent status: all users complete → COMPLETE; none started → NOT_STARTED; no items → EMPTY; else IN_PROGRESS. */
  status: DayStatus;
  templateId: string | null;
  /** One entry per user — the untouched per-user daily checklist records. */
  users: TodayInstanceRow[];
  /** Users whose whole checklist is complete. */
  usersComplete: number;
}

/**
 * Admin "Today's Checklists": ONE group per template + date (by template id, never by name).
 * Presentation only — the rows are the per-user daily checklists and are not merged or changed.
 */
export function groupTodayRows(
  rows: TodayInstanceRow[],
  date: string
): TodayTemplateGroup[] {
  const map = new Map<string, TodayInstanceRow[]>();
  for (const r of rows) {
    const key = `${r.templateId ?? `name:${r.templateName ?? ""}`}|${date}`;
    const list = map.get(key);
    if (list) {
      list.push(r);
    } else {
      map.set(key, [r]);
    }
  }
  return [...map.entries()].map(([key, users]) => {
    const itemsCompleted = users.reduce((n, u) => n + u.completed, 0);
    const itemsTotal = users.reduce((n, u) => n + u.total, 0);
    const usersComplete = users.filter((u) => u.status === "COMPLETE").length;
    const status: DayStatus =
      itemsTotal === 0
        ? "EMPTY"
        : usersComplete === users.length
          ? "COMPLETE"
          : users.every(
                (u) => u.status === "NOT_STARTED" || u.status === "EMPTY"
              )
            ? "NOT_STARTED"
            : "IN_PROGRESS";
    return {
      key,
      templateId: users[0].templateId,
      name: users[0].templateName,
      users,
      usersComplete,
      itemsCompleted,
      itemsTotal,
      itemsPercent: computeProgress({
        completed: itemsCompleted,
        total: itemsTotal,
      }).percent,
      status,
    };
  });
}
