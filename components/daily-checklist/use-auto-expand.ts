"use client";

import { useCallback, useState } from "react";

const keyFor = (scope: string) => `checklist:auto-expand:${scope}`;

function read(scope: string): boolean {
  try {
    return sessionStorage.getItem(keyFor(scope)) !== "0";
  } catch {
    return true;
  }
}

/**
 * "Do checklist details start open?" — true the first time, then it follows the user's LAST
 * explicit expand/collapse (remembered for the browser session, so it survives refreshes,
 * filter changes and leaving the page). Filters/paging use it to decide whether the rows they
 * bring in open or stay closed.
 */
export function useAutoExpand(scope: string) {
  const [auto, setAutoState] = useState(() => read(scope));
  const setAuto = useCallback(
    (v: boolean) => {
      setAutoState(v);
      try {
        sessionStorage.setItem(keyFor(scope), v ? "1" : "0");
      } catch {
        /* storage unavailable — just not remembered */
      }
    },
    [scope]
  );
  return [auto, setAuto] as const;
}
