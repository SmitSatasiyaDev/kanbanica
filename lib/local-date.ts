/**
 * The user's wall-clock time in their own timezone: minutes-since-midnight plus
 * their local YYYY-MM-DD. Falls back to UTC if the stored timezone isn't a
 * valid IANA name.
 */
export function localTime(
  now: Date,
  timeZone: string
): { minutes: number; date: string } {
  const opts: Intl.DateTimeFormatOptions = {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      ...opts,
      timeZone,
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", {
      ...opts,
      timeZone: "UTC",
    }).formatToParts(now);
  }

  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "00";

  // Some hourCycles render midnight as "24"; normalise it.
  const hour = Number(get("hour")) % 24;
  return {
    minutes: hour * 60 + Number(get("minute")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** The user's current local calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayInTz(now: Date, timeZone: string): string {
  return localTime(now, timeZone).date;
}
