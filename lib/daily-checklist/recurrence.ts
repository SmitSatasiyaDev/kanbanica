import type { Recurrence } from "./constants";

export interface RecurrenceRule {
  endDate: string | null;
  recurrence: Recurrence;
  recurrenceDays: number[];
  startDate: string;
}

/** Weekday (0 = Sunday … 6 = Saturday) of a YYYY-MM-DD date. Pure calendar math — no timezone involved. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Does a template generate an instance on this (local) calendar date?
 * `date` is the assignee's local YYYY-MM-DD; comparisons are lexical, which is
 * correct for zero-padded ISO dates.
 */
export function occursOn(rule: RecurrenceRule, date: string): boolean {
  // One-time: the start date is the only eligible date (any stored end date is ignored).
  if (rule.recurrence === "ONCE") {
    return date === rule.startDate;
  }
  if (date < rule.startDate) {
    return false;
  }
  if (rule.endDate && date > rule.endDate) {
    return false;
  }
  const dow = weekdayOf(date);
  switch (rule.recurrence) {
    case "DAILY":
      return true;
    case "WEEKDAYS":
      return dow >= 1 && dow <= 5;
    case "WEEKLY": {
      // A weekly template repeats on its chosen day, defaulting to the start date's weekday.
      const day = rule.recurrenceDays[0] ?? weekdayOf(rule.startDate);
      return dow === day;
    }
    case "CUSTOM":
      return rule.recurrenceDays.includes(dow);
    default:
      return false;
  }
}
