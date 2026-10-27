import type { Job } from "pg-boss";
import { deleteOldRateLimitRows } from "@/lib/rate-limit-db";

// Removes rate-limit counters from windows that ended more than an hour ago.
export async function handleRateLimitCleanup(
  _jobs: Job<Record<string, never>>[]
) {
  const removed = await deleteOldRateLimitRows();
  console.log("[rate-limit-cleanup] old counters deleted", removed);
}
