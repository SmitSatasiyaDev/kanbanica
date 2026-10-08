import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { userEmailPreference } from "@/db/schema";
import { db } from "@/lib/db";
import { areNotificationEmailsEnabled } from "@/lib/integration-settings";
import { localTime } from "@/lib/local-date";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

const SCAN_INTERVAL_MINUTES = 30; // must match the cron in lib/worker/boss.ts

export { localTime };

export async function handleNotificationDigestScan(
  _jobs: Job<Record<string, never>>[]
) {
  // Platform master switch is off: queue nothing. Each digest covers a fixed
  // 30-minute window, so skipped windows are simply dropped — turning email
  // back on never sends a backlog.
  if (!(await areNotificationEmailsEnabled())) {
    return;
  }

  const now = new Date();

  // Get all users with digest delivery mode
  const digestUsers = await db
    .select()
    .from(userEmailPreference)
    .where(eq(userEmailPreference.deliveryMode, "digest"));

  let queued = 0;

  for (const pref of digestUsers) {
    const [hours, minutes] = pref.digestTime.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      continue;
    }

    // Compare against the user's OWN timezone, not UTC.
    const local = localTime(now, pref.digestTimezone);
    const digestMinutes = hours * 60 + minutes;

    // Fire in exactly one scan bucket: [digestTime, digestTime + interval).
    // The old `Math.abs(diff) <= 30` test matched three consecutive scans
    // (07:30, 08:00 and 08:30 for an 08:00 digest) — up to three digests.
    const delta = local.minutes - digestMinutes;
    if (delta < 0 || delta >= SCAN_INTERVAL_MINUTES) {
      continue;
    }

    const windowEnd = now.toISOString();
    const windowStart = new Date(
      now.getTime() - SCAN_INTERVAL_MINUTES * 60 * 1000
    ).toISOString();

    await enqueueJob(
      JOB_NAMES.NOTIFICATION_DIGEST_SEND,
      { userId: pref.userId, windowStart, windowEnd },
      {
        // Date-scoped: pg-boss only dedupes while a job is active, so without
        // the local date the same key becomes reusable the next day.
        singletonKey: `digest-${pref.userId}-${local.date}-${pref.digestTime}`,
      }
    );
    queued++;
  }

  console.log(
    "[notification-digest-scan] scanned",
    digestUsers.length,
    "digest users, queued",
    queued
  );
}
