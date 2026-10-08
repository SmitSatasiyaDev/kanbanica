import type { ChecklistStatus } from "./constants";

export interface Progress {
  completed: number;
  percent: number;
  total: number;
}

/** completed / total, safe for an empty list. */
export function computeProgress(
  statuses: readonly ChecklistStatus[] | { completed: number; total: number }
): Progress {
  const completed = Array.isArray(statuses)
    ? (statuses as ChecklistStatus[]).filter((s) => s === "DONE").length
    : (statuses as { completed: number }).completed;
  const total = Array.isArray(statuses)
    ? statuses.length
    : (statuses as { total: number }).total;
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export type DayStatus = "EMPTY" | "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";

export function dayStatus(
  completed: number,
  total: number,
  anyStarted = false
): DayStatus {
  if (total === 0) {
    return "EMPTY";
  }
  if (completed === total) {
    return "COMPLETE";
  }
  return completed > 0 || anyStarted ? "IN_PROGRESS" : "NOT_STARTED";
}
