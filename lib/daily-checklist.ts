// Pure, client-safe helpers for the Daily Checklist: date-string math and the
// recurrence rule. Dates are `YYYY-MM-DD` strings (no timezone); all arithmetic
// is done in UTC so it can't drift across DST or the server's timezone.

export const CHECKLIST_REPEATS = [
  "NONE",
  "DAILY",
  "WEEKDAYS",
  "WEEKLY",
  "MONTHLY",
  "CUSTOM",
] as const;
export type ChecklistRepeat = (typeof CHECKLIST_REPEATS)[number];

export const CHECKLIST_REPEAT_UNITS = ["DAY", "WEEK", "MONTH"] as const;
export type ChecklistRepeatUnit = (typeof CHECKLIST_REPEAT_UNITS)[number];

export const CHECKLIST_STATUSES = [
  "INCOMPLETE",
  "COMPLETED",
  "SKIPPED",
] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const REPEAT_LABELS: Record<ChecklistRepeat, string> = {
  NONE: "Does not repeat",
  DAILY: "Every day",
  WEEKDAYS: "Every weekday",
  WEEKLY: "Every week",
  MONTHLY: "Every month",
  CUSTOM: "Custom",
};

export const MAX_REPEAT_INTERVAL = 365;

export interface RecurrenceRule {
  endDate: string | null;
  repeat: ChecklistRepeat;
  repeatInterval: number;
  repeatUnit: ChecklistRepeatUnit | null;
  startDate: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;

function parts(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  return [Number(m?.[1]), Number(m?.[2]), Number(m?.[3])];
}

function toUtc(date: string): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

export function isValidDateStr(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    return false;
  }
  const [y, m, d] = parts(value);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isValidTimeStr(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

export function formatDateStr(utcMs: number): string {
  const d = new Date(utcMs);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${mm}-${dd}`;
}

export function addDays(date: string, days: number): string {
  return formatDateStr(toUtc(date) + days * DAY_MS);
}

/** Local calendar date of `d` (the user's "today"), as `YYYY-MM-DD`. */
export function toDateStr(d: Date): string {
  return formatDateStr(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Parses `YYYY-MM-DD` into a local-midnight Date (for display / react-day-picker). */
export function dateStrToLocalDate(date: string): Date {
  const [y, m, d] = parts(date);
  return new Date(y, m - 1, d);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`,
  };
}

export function isValidMonthStr(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthDiff(from: string, to: string): number {
  const [fy, fm] = parts(from);
  const [ty, tm] = parts(to);
  return (ty - fy) * 12 + (tm - fm);
}

// Same day-of-month as the start; a start on the 31st lands on the last day of
// shorter months rather than skipping them.
function matchesMonthDay(startDate: string, date: string): boolean {
  const [, , startDay] = parts(startDate);
  const [y, m, d] = parts(date);
  return d === Math.min(startDay, daysInMonth(y, m));
}

/** Does the rule produce an occurrence on `date`? */
export function occursOn(rule: RecurrenceRule, date: string): boolean {
  if (date < rule.startDate) {
    return false;
  }
  if (rule.endDate && date > rule.endDate) {
    return false;
  }
  const diffDays = Math.round((toUtc(date) - toUtc(rule.startDate)) / DAY_MS);
  switch (rule.repeat) {
    case "NONE":
      return diffDays === 0;
    case "DAILY":
      return true;
    case "WEEKDAYS": {
      const dow = weekdayOf(date);
      return dow >= 1 && dow <= 5;
    }
    case "WEEKLY":
      return diffDays % 7 === 0;
    case "MONTHLY":
      return matchesMonthDay(rule.startDate, date);
    case "CUSTOM": {
      const n = Math.max(1, rule.repeatInterval);
      if (rule.repeatUnit === "WEEK") {
        return diffDays % (7 * n) === 0;
      }
      if (rule.repeatUnit === "MONTH") {
        return (
          monthDiff(rule.startDate, date) % n === 0 &&
          matchesMonthDay(rule.startDate, date)
        );
      }
      return diffDays % n === 0;
    }
    default:
      return false;
  }
}

/** Short human label for a rule, e.g. "Every 2 weeks". */
export function describeRepeat(
  repeat: ChecklistRepeat,
  interval: number,
  unit: ChecklistRepeatUnit | null
): string {
  if (repeat !== "CUSTOM") {
    return REPEAT_LABELS[repeat];
  }
  const u = (unit ?? "DAY").toLowerCase();
  return interval === 1 ? `Every ${u}` : `Every ${interval} ${u}s`;
}

/** "14:30" → "2:30 PM" */
export function formatDueTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

// ─── Series end / stop planning ───────────────────────────────────────────────

const MAX_END_AFTER = 999;
// Safety cap when scanning for the Nth occurrence (~30 years of days).
const MAX_SCAN_DAYS = 366 * 30;

export { MAX_END_AFTER };

/** Date of the Nth occurrence of a rule (inclusive), or null if out of range. */
export function endDateAfterOccurrences(
  rule: Omit<RecurrenceRule, "endDate">,
  count: number
): string | null {
  const open: RecurrenceRule = { ...rule, endDate: null };
  let seen = 0;
  for (let i = 0; i <= MAX_SCAN_DAYS; i++) {
    const d = addDays(rule.startDate, i);
    if (occursOn(open, d)) {
      seen++;
      if (seen === count) {
        return d;
      }
    }
  }
  return null;
}

/**
 * Turns the form's "Ends" choice into a stored `endDate`. Never → null,
 * "on a date" → that date, "after N occurrences" → the date of the Nth.
 * Non-repeating tasks never have an end date.
 */
export function resolveSeriesEnd(input: {
  endAfter: number | null;
  endDate: string | null;
  repeat: ChecklistRepeat;
  repeatInterval: number;
  repeatUnit: ChecklistRepeatUnit | null;
  startDate: string;
}): { endDate: string | null } | { error: string } {
  if (input.repeat === "NONE") {
    return { endDate: null };
  }
  if (input.endDate && input.endAfter) {
    return { error: "Choose either an end date or a number of occurrences" };
  }
  if (input.endDate) {
    if (!isValidDateStr(input.endDate)) {
      return { error: "Invalid end date" };
    }
    if (input.endDate < input.startDate) {
      return { error: "End date must be on or after the start date" };
    }
    return { endDate: input.endDate };
  }
  if (input.endAfter != null) {
    if (
      !Number.isInteger(input.endAfter) ||
      input.endAfter < 1 ||
      input.endAfter > MAX_END_AFTER
    ) {
      return {
        error: `Occurrences must be between 1 and ${MAX_END_AFTER}`,
      };
    }
    const end = endDateAfterOccurrences(input, input.endAfter);
    return end ? { endDate: end } : { error: "End date is out of range" };
  }
  return { endDate: null };
}

/**
 * Effective-date stop used by both "Stop" and "Delete this and future days": the series ends the
 * day before `date`. Nothing is deleted — rows on/after `date` simply stop
 * being scheduled, and earlier days are untouched. An existing earlier end
 * date is kept (stopping never extends a series).
 */
export function stopEndDate(existingEnd: string | null, date: string): string {
  const dayBefore = addDays(date, -1);
  return existingEnd !== null && existingEnd < dayBefore
    ? existingEnd
    : dayBefore;
}

/**
 * Whether an occurrence is shown on `date`.
 * - A soft-removed occurrence never shows.
 * - The series' end date is a hard bound: a recorded (completed/skipped) row
 *   can NOT show on a day after it, so stopping/deleting a series hides every
 *   recorded day on/after the effective date instead of leaving it behind.
 * - Otherwise it shows when the rule fires, or when it was completed/skipped
 *   (so earlier history survives rule edits).
 */
export function isOccurrenceVisible(
  rule: RecurrenceRule,
  status: ChecklistStatus | undefined,
  date: string,
  removed = false
): boolean {
  if (removed) {
    return false;
  }
  if (rule.endDate && date > rule.endDate) {
    return false;
  }
  return (
    occursOn(rule, date) || (status !== undefined && status !== "INCOMPLETE")
  );
}

/**
 * Optimistic status flip for one task of a day. Pure and applied to the
 * current cache value (SWR updater), so rapid successive clicks each build on
 * the previous result instead of a stale render snapshot.
 */
export function withStatus<
  T extends { itemId: string; status: ChecklistStatus },
>(
  entries: T[] | undefined,
  itemId: string,
  status: ChecklistStatus
): T[] | undefined {
  return entries?.map((e) => (e.itemId === itemId ? { ...e, status } : e));
}

/** Day totals: skipped tasks are excluded from both numbers. */
export function summarizeStatuses(statuses: ChecklistStatus[]): {
  completed: number;
  total: number;
} {
  const counted = statuses.filter((s) => s !== "SKIPPED");
  return {
    total: counted.length,
    completed: counted.filter((s) => s === "COMPLETED").length,
  };
}

export const FUTURE_COMPLETION_ERROR =
  "This task can be completed on its scheduled date.";

/** Visual state of a calendar day, derived from its (non-skipped) totals. */
export type DayStatusKind =
  | "none" // no tasks
  | "all" // everything done
  | "some" // partly done
  | "missed" // past day, tasks but none done
  | "pending"; // today / upcoming, tasks but none done yet

export function dayStatus(
  summary: { completed: number; total: number } | undefined,
  date: string,
  today: string
): { kind: DayStatusKind; overdue: boolean; pending: number } {
  if (!summary || summary.total === 0) {
    return { kind: "none", overdue: false, pending: 0 };
  }
  const pending = summary.total - summary.completed;
  const overdue = date < today && pending > 0;
  if (pending === 0) {
    return { kind: "all", overdue, pending };
  }
  if (summary.completed > 0) {
    return { kind: "some", overdue, pending };
  }
  return { kind: date < today ? "missed" : "pending", overdue, pending };
}

// ─── "Today" tracking (browser-local calendar day) ────────────────────────────

/** Milliseconds until the next local midnight (+ a small buffer so the date has flipped). */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return next.getTime() - now.getTime() + 250;
}

interface VisibilityTarget {
  addEventListener(type: "visibilitychange", cb: () => void): void;
  removeEventListener(type: "visibilitychange", cb: () => void): void;
  visibilityState?: string;
}

/**
 * Calls `onChange(today)` whenever the browser-local calendar date changes —
 * via one timer aimed at the next local midnight (re-armed each time), plus a
 * re-check whenever a hidden tab becomes visible again (timers can be
 * throttled or the machine may have slept). No polling; `onChange` only fires
 * when the date actually changed. Returns a cleanup function.
 */
export function watchLocalToday(
  onChange: (today: string) => void,
  doc: VisibilityTarget | undefined = typeof document === "undefined"
    ? undefined
    : document
): () => void {
  let current = toDateStr(new Date());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    const t = toDateStr(new Date());
    if (t !== current) {
      current = t;
      onChange(t);
    }
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      check();
      arm();
    }, msUntilNextLocalMidnight(new Date()));
  };
  const onVisible = () => {
    if (doc?.visibilityState === "visible") {
      check();
      arm();
    }
  };

  doc?.addEventListener("visibilitychange", onVisible);
  arm();
  return () => {
    clearTimeout(timer);
    doc?.removeEventListener("visibilitychange", onVisible);
  };
}

// ─── Month grid + calendar cell helpers ───────────────────────────────────────

/**
 * The weeks (Sunday-first) shown for `month` ("YYYY-MM"): 4–6 rows of 7 date
 * strings, padded with the neighbouring months' days.
 */
export function buildMonthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lead = weekdayOf(first);
  const weeks = Math.ceil((lead + daysInMonth(y, m)) / 7);
  const start = addDays(first, -lead);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d))
  );
}

/**
 * Up to `max` tasks for a calendar hover preview: pending first (the
 * actionable ones), then completed; otherwise the loader's order is kept.
 */
export function pickPreviewTasks<T extends { status: ChecklistStatus }>(
  tasks: T[],
  max = 3
): T[] {
  return [
    ...tasks.filter((t) => t.status !== "COMPLETED"),
    ...tasks.filter((t) => t.status === "COMPLETED"),
  ].slice(0, max);
}

// ─── View modes & navigation state ────────────────────────────────────────────

export const VIEW_MODES = ["split", "task", "calendar"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export type ChecklistFilter = "all" | "pending" | "completed";

export type NavState = {
  view: ViewMode;
  /** Selected date (null until the browser-local today is known). */
  date: string | null;
  /** Visible calendar month, YYYY-MM. */
  month: string | null;
  filter: ChecklistFilter;
};

export type NavAction =
  | { type: "init"; today: string; view?: ViewMode }
  | { type: "setView"; view: ViewMode }
  | { type: "selectDate"; date: string }
  | { type: "setMonth"; month: string }
  | { type: "setFilter"; filter: ChecklistFilter };

export function isViewMode(v: unknown): v is ViewMode {
  return VIEW_MODES.includes(v as ViewMode);
}

export const initialNavState: NavState = {
  view: "split",
  date: null,
  month: null,
  filter: "all",
};

/**
 * Single source of truth for the page's navigation. Switching view only
 * changes `view` — date, month and filter are preserved. Selecting a date
 * (Previous/Next/Today/calendar click) moves the month with it; paging the
 * calendar month leaves the selected date alone.
 */
export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "init":
      // Only the first resolution of "today" picks the date; midnight never
      // moves a selection the user may have made.
      return state.date === null
        ? {
            ...state,
            view: action.view ?? state.view,
            date: action.today,
            month: action.today.slice(0, 7),
          }
        : state;
    case "setView":
      return { ...state, view: action.view };
    case "selectDate":
      return {
        ...state,
        date: action.date,
        month: action.date.slice(0, 7),
      };
    case "setMonth":
      return { ...state, month: action.month };
    case "setFilter":
      return { ...state, filter: action.filter };
    default:
      return state;
  }
}

// ─── Calendar Focus cells ─────────────────────────────────────────────────────

/**
 * Splits a day's tasks into the rows that fit a cell and an overflow count.
 * When anything overflows, one row is given up for the "+N more" line so the
 * cell never grows past `capacity` rows.
 */
export function splitCellTasks<T>(
  tasks: T[],
  capacity: number
): { visible: T[]; hidden: T[] } {
  const cap = Math.max(0, Math.floor(capacity));
  if (tasks.length <= cap) {
    return { visible: tasks, hidden: [] };
  }
  const shown = Math.max(0, cap - 1);
  return { visible: tasks.slice(0, shown), hidden: tasks.slice(shown) };
}

/** Completion from the calendar follows the day rules: today only. */
export function canCompleteOnDate(date: string, today: string): boolean {
  return date === today;
}

/** Escape leaves Focus Mode only when nothing else claimed the keypress. */
export function shouldExitFocus(
  key: string,
  defaultPrevented: boolean,
  overlayOpen: boolean
): boolean {
  return key === "Escape" && !defaultPrevented && !overlayOpen;
}
