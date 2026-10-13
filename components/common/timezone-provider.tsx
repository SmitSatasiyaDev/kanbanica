"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { updateTimezone } from "@/app/actions/profile";
import {
  DEFAULT_TIMEZONE,
  detectBrowserTimezone,
  todayInTz,
  watchToday,
} from "@/lib/due-date";

interface TimezoneContextValue {
  timezone: string;
  /** Current calendar day (`YYYY-MM-DD`) in the user's timezone; re-ticks at their midnight. */
  today: string;
}

// Auto-detect runs at most once per browser, so someone who deliberately picks
// UTC on Profile isn't overridden on the next page load.
export const TZ_AUTODETECT_KEY = "kanbanica:tz-autodetect-done";

const TimezoneContext = React.createContext<TimezoneContextValue>({
  timezone: DEFAULT_TIMEZONE,
  today: todayInTz(DEFAULT_TIMEZONE),
});

export function useTimezone(): string {
  return React.useContext(TimezoneContext).timezone;
}

/** The user's current day. Components using it re-render when the day rolls over. */
export function useToday(): string {
  return React.useContext(TimezoneContext).today;
}

export function TimezoneProvider({
  timezone,
  autoDetect,
  children,
}: {
  timezone: string;
  /** True while the user's timezone is still the untouched default. */
  autoDetect: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [today, setToday] = React.useState(() => todayInTz(timezone));

  React.useEffect(() => {
    setToday(todayInTz(timezone));
    return watchToday(timezone, setToday);
  }, [timezone]);

  // First visit: the column still holds its UTC default, so adopt the browser's
  // zone once. After that the user owns it (Profile → Timezone).
  React.useEffect(() => {
    if (!autoDetect) {
      return;
    }
    try {
      if (localStorage.getItem(TZ_AUTODETECT_KEY)) {
        return;
      }
      localStorage.setItem(TZ_AUTODETECT_KEY, "1");
    } catch {
      // Storage blocked: fall through and try once for this page load.
    }
    const detected = detectBrowserTimezone();
    if (detected === timezone) {
      return;
    }
    updateTimezone(detected).then((res) => {
      if ("ok" in res) {
        router.refresh();
      }
    });
  }, [autoDetect, timezone, router]);

  const value = React.useMemo(() => ({ timezone, today }), [timezone, today]);
  return (
    <TimezoneContext.Provider value={value}>
      {children}
    </TimezoneContext.Provider>
  );
}
