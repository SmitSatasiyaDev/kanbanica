/**
 * Pure, client-safe timezone helpers. Timezones are always IANA identifiers
 * (e.g. "Asia/Kolkata") — never fixed UTC offsets, which can't express DST.
 */

export const DEFAULT_TIMEZONE = "UTC";

/** True when `tz` is an IANA zone name the runtime understands. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim() === "") {
    return false;
  }
  // Intl also accepts fixed offsets like "+05:30"; those can't express DST.
  if (/^[+-]/.test(tz.trim())) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The single source of truth for which timezone a user's Daily Checklist runs in:
 * user timezone → workspace timezone → UTC. Invalid/unknown values are skipped.
 */
export function getEffectiveTimezone(
  user: { timezone?: string | null } | null | undefined,
  workspace: { timezone?: string | null } | null | undefined
): string {
  if (isValidTimeZone(user?.timezone)) {
    return user.timezone;
  }
  if (isValidTimeZone(workspace?.timezone)) {
    return workspace.timezone;
  }
  return DEFAULT_TIMEZONE;
}

/** Maps a legacy canonical name (e.g. "Asia/Calcutta") to its preferred IANA name. */
export function normalizeTimeZone(tz: string): string {
  const preferred = PREFERRED_NAMES[tz];
  return preferred && isValidTimeZone(preferred) ? preferred : tz;
}

/** The browser/runtime's IANA timezone, or null when it can't be determined. */
export function detectBrowserTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? normalizeTimeZone(tz) : null;
  } catch {
    return null;
  }
}

// V8 lists some zones under their legacy canonical names. Show the names people
// actually look for (both resolve to identical rules).
const PREFERRED_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
};

/** Every IANA timezone the runtime supports (falls back to a small list). */
export function listTimeZones(): string[] {
  let zones: string[] = [];
  try {
    zones = (
      Intl as unknown as { supportedValuesOf: (k: string) => string[] }
    ).supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  if (zones.length === 0) {
    zones = [
      "Africa/Cairo",
      "America/Chicago",
      "America/Los_Angeles",
      "America/New_York",
      "Asia/Kolkata",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Europe/London",
    ];
  }
  const names = zones.map(normalizeTimeZone);
  // supportedValuesOf omits "UTC" in some runtimes.
  return names.includes("UTC") ? names : [...names, "UTC"];
}

/** "UTC+05:30" for `timeZone` at `at` (DST-aware). */
export function formatUtcOffset(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part || part === "GMT") {
      return "UTC+00:00";
    }
    return part.replace("GMT", "UTC");
  } catch {
    return "UTC";
  }
}

export interface TimezoneGroup {
  region: string;
  zones: { value: string; label: string }[];
}

/** All zones grouped by region ("Asia", "America", …) with "City (UTC+hh:mm)" labels. */
export function groupedTimeZones(at: Date = new Date()): TimezoneGroup[] {
  const groups = new Map<string, TimezoneGroup>();
  for (const tz of listTimeZones()) {
    const slash = tz.indexOf("/");
    const region = slash === -1 ? "Other" : tz.slice(0, slash);
    const city = (slash === -1 ? tz : tz.slice(slash + 1)).replaceAll("_", " ");
    const g = groups.get(region) ?? { region, zones: [] };
    g.zones.push({ value: tz, label: `${city} (${formatUtcOffset(tz, at)})` });
    groups.set(region, g);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      zones: g.zones.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.region.localeCompare(b.region));
}
