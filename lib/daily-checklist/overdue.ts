import { localTime } from "@/lib/local-date";
import { TIME_RE } from "./constants";

/**
 * Display-only overdue state for a generated checklist item. `dueTime` ("HH:MM") belongs to
 * the checklist day's date in the assignee's effective timezone (`timeZone`, resolved by
 * `getEffectiveTimezone`), so an item is overdue only when ALL hold:
 *  - the day is *today* in that timezone (history and future days are never overdue),
 *  - it has a due time and it is not DONE,
 *  - the local time of day is past the due time (due 16:30 → overdue from 16:31).
 * Nothing is stored; completion is never blocked.
 */
export function isOverdue(input: {
  date: string;
  dueTime: string | null;
  now: Date;
  status: string;
  timeZone: string;
}): boolean {
  const { date, dueTime, now, status, timeZone } = input;
  if (!dueTime || status === "DONE" || !TIME_RE.test(dueTime)) {
    return false;
  }
  const local = localTime(now, timeZone);
  if (local.date !== date) {
    return false;
  }
  const [h, m] = dueTime.split(":").map(Number);
  return local.minutes > h * 60 + m;
}

/** Overdue for one team row (uses the row's day date and its assignee's timezone). */
export function isRowOverdue(
  row: {
    assigneeTimezone: string;
    date: string;
    dueTime: string | null;
    status: string;
  },
  now: Date
): boolean {
  return isOverdue({
    date: row.date,
    dueTime: row.dueTime,
    now,
    status: row.status,
    timeZone: row.assigneeTimezone,
  });
}
