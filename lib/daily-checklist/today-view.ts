import { type DayStatus, dayStatus } from "./progress";
import type { TeamItemRow, TodayInstanceRow } from "./types";

/** Pure helpers behind the member-facing "Today" view (Assigned). Presentation math only. */

export interface TodayChecklist {
  completed: number;
  /** The checklist day's date (YYYY-MM-DD). */
  date: string;
  /** Every item of this checklist the viewer owns (unfiltered — progress is never filter-dependent). */
  items: TeamItemRow[];
  key: string;
  name: string;
  status: DayStatus;
  total: number;
}

/** One entry per checklist (template + day), built from the viewer's OWN item rows, in first-seen order. */
export function groupMyChecklists(rows: TeamItemRow[]): TodayChecklist[] {
  const map = new Map<string, TeamItemRow[]>();
  for (const r of rows) {
    const key = r.dayId;
    const list = map.get(key);
    if (list) {
      list.push(r);
    } else {
      map.set(key, [r]);
    }
  }
  return [...map.entries()].map(([key, items]) => {
    const completed = items.filter((i) => i.status === "DONE").length;
    const started = items.some((i) => i.status === "IN_PROGRESS");
    return {
      key,
      date: items[0].date,
      name: items[0].templateName ?? "Checklist",
      items,
      completed,
      total: items.length,
      status: dayStatus(completed, items.length, started),
    };
  });
}

export interface TodaySummary {
  checklistsComplete: number;
  inProgress: number;
  pending: number;
  tasksDone: number;
  tasksTotal: number;
}

/** Summary cards: item counts across the viewer's items + how many whole checklists are complete. */
export function summarizeToday(rows: TeamItemRow[]): TodaySummary {
  return {
    tasksDone: rows.filter((r) => r.status === "DONE").length,
    tasksTotal: rows.length,
    inProgress: rows.filter((r) => r.status === "IN_PROGRESS").length,
    pending: rows.filter((r) => r.status === "PENDING").length,
    checklistsComplete: groupMyChecklists(rows).filter(
      (g) => g.status === "COMPLETE"
    ).length,
  };
}

export interface AdminTodaySummary {
  complete: number;
  inProgress: number;
  notStarted: number;
  tasksDone: number;
  tasksTotal: number;
}

/** Admin Today cards: tasks across every assigned checklist today + how many checklists are in each state. */
export function summarizeAdminToday(
  rows: TodayInstanceRow[]
): AdminTodaySummary {
  return {
    tasksDone: rows.reduce((n, r) => n + r.completed, 0),
    tasksTotal: rows.reduce((n, r) => n + r.total, 0),
    inProgress: rows.filter((r) => r.status === "IN_PROGRESS").length,
    notStarted: rows.filter((r) => r.status === "NOT_STARTED").length,
    complete: rows.filter((r) => r.status === "COMPLETE").length,
  };
}
