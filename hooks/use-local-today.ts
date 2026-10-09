"use client";

import * as React from "react";
import { toDateStr, watchLocalToday } from "@/lib/daily-checklist";

/**
 * The browser-local calendar date (`YYYY-MM-DD`), kept current without a page
 * reload: it updates at local midnight and when a backgrounded tab becomes
 * visible again. `null` until mounted (so server and client render match).
 */
export function useLocalToday(): string | null {
  const [today, setToday] = React.useState<string | null>(null);
  React.useEffect(() => {
    setToday(toDateStr(new Date()));
    return watchLocalToday(setToday);
  }, []);
  return today;
}
