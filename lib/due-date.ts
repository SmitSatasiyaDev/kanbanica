// Pure, client-safe helpers for due dates. A due date is a calendar day
// (`YYYY-MM-DD`, no time, no timezone). "Today" is the only timezone-dependent
// value and is always derived here from the viewer's IANA zone (`user.timezone`),
// so every surface (server filters, dashboard, reminders, browser) agrees.
// Day arithmetic reuses the UTC-based string helpers from the daily checklist.
import {
  addDays,
  dateStrToLocalDate,
  isValidDateStr,
  toDateStr,
  weekdayOf,
} from "@/lib/daily-checklist";

export { addDays, dateStrToLocalDate, isValidDateStr, toDateStr, weekdayOf };

export const DEFAULT_TIMEZONE = "UTC";

export type DueStatus = "overdue" | "today" | "tomorrow" | "later";

/** True when `tz` is an IANA zone this runtime understands. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** `tz` if valid, otherwise UTC — never throws. */
export function resolveTimezone(tz: unknown): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** The browser's IANA zone, or UTC when it can't be determined. */
export function detectBrowserTimezone(): string {
  try {
    return resolveTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Calendar day (`YYYY-MM-DD`) it currently is in `tz`. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTimezone(tz),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Input guard for server actions: `undefined`/`null` or a real `YYYY-MM-DD` day. */
export function isOptionalDay(value: unknown): boolean {
  return value === undefined || value === null || isValidDateStr(value);
}

/** Converts a react-day-picker Date (local midnight) to its calendar day. */
export function dateToDay(date: Date): string {
  return toDateStr(date);
}

/** Normalises a stored day / ISO string / Date to `YYYY-MM-DD`, or null. */
export function toDay(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toDateStr(value);
  }
  const day = value.slice(0, 10);
  return isValidDateStr(day) ? day : null;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const ms = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export function dueStatus(dueDay: string, today: string): DueStatus {
  if (dueDay < today) {
    return "overdue";
  }
  if (dueDay === today) {
    return "today";
  }
  if (dueDay === addDays(today, 1)) {
    return "tomorrow";
  }
  return "later";
}

/** Inclusive `[from, to]` days of the week containing `day`. */
export function weekRange(
  day: string,
  weekStartsOn: 0 | 1 = 0
): { from: string; to: string } {
  const offset = (weekdayOf(day) - weekStartsOn + 7) % 7;
  const from = addDays(day, -offset);
  return { from, to: addDays(from, 6) };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Jan 5" (or "Jan 5, 2030" with `withYear`). Timezone-free, unlike date-fns `format`. */
export function formatDay(day: string, withYear = false): string {
  const [y, m, d] = day.split("-").map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return withYear ? `${base}, ${y}` : base;
}

/** "Mon, Jan 5". */
export function formatDayWithWeekday(day: string): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[weekdayOf(day)]}, ${formatDay(day)}`;
}

/** The instant `tz`'s current calendar day began (its local midnight). */
export function startOfDayInTz(tz: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: resolveTimezone(tz),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsedMs =
    ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 +
    now.getUTCMilliseconds();
  return new Date(now.getTime() - elapsedMs);
}

/** Milliseconds until the next midnight in `tz` (+ a small buffer). */
export function msUntilNextMidnightInTz(
  tz: string,
  now: Date = new Date()
): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: resolveTimezone(tz),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = (get("hour") * 60 + get("minute")) * 60 + get("second");
  // Capped at 24h; on a DST day the timer may fire early, and the caller's
  // re-check + re-arm absorbs that.
  return Math.max(1, 86_400 - elapsed) * 1000 + 250;
}

interface VisibilityTarget {
  addEventListener(type: "visibilitychange", cb: () => void): void;
  removeEventListener(type: "visibilitychange", cb: () => void): void;
  visibilityState?: string;
}

/**
 * Calls `onChange(today)` whenever the calendar day in `tz` changes — one timer
 * aimed at the next midnight in that zone (re-armed each time) plus a re-check
 * when a hidden tab becomes visible. No polling. Returns a cleanup function.
 */
export function watchToday(
  tz: string,
  onChange: (today: string) => void,
  doc: VisibilityTarget | undefined = typeof document === "undefined"
    ? undefined
    : document
): () => void {
  let current = todayInTz(tz);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    const t = todayInTz(tz);
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
    }, msUntilNextMidnightInTz(tz));
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
