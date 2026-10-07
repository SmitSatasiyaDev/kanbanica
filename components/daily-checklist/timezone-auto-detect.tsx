"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { initUserTimezone } from "@/app/actions/profile";
import { detectBrowserTimezone } from "@/lib/timezone";

/**
 * Mounted only while the user has no timezone. Saves the browser's IANA zone once
 * as the initial default (server-side it only writes while still NULL, so an
 * explicit choice is never overwritten). Browser detection unavailable → nothing
 * happens and the workspace timezone / UTC applies.
 */
export function TimezoneAutoDetect() {
  const router = useRouter();
  useEffect(() => {
    const tz = detectBrowserTimezone();
    if (!tz) {
      return;
    }
    initUserTimezone(tz).then((res) => {
      if ("ok" in res && res.changed) {
        router.refresh();
      }
    });
  }, [router]);
  return null;
}
