import { lt, sql } from "drizzle-orm";
import { rateLimitCounter } from "@/db/schema";
import { db } from "@/lib/db";

// Fixed-window rate limits kept in the database, so every app process and every
// restart sees the same counts (the in-memory limiter in lib/rate-limit.ts is
// per process). One statement per check: an upsert that adds to the window's
// counter and returns the new value.

export type RateLimitCheck = {
  key: string;
  limit: number;
  windowMs: number;
  // How much this call adds to the counter (default 1). Uploading five files
  // at once costs five.
  cost?: number;
};

export type RateLimitDecision = {
  key: string;
  ok: boolean;
  // Seconds until the window ends (for Retry-After); 0 when allowed.
  retryAfter: number;
};

// Rows older than this are removed by the cleanup job.
export const RATE_LIMIT_RETENTION_MS = 60 * 60 * 1000;

// Start of the fixed window that contains `now`.
export function windowStartFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

// Seconds from `now` to the end of the window, at least 1.
export function retryAfterSeconds(now: number, windowMs: number): number {
  const end = windowStartFor(now, windowMs) + windowMs;
  return Math.max(1, Math.ceil((end - now) / 1000));
}

// Counts every check in ONE round trip and returns a decision for each. A check
// is allowed while the window's total, including this call, stays within its
// limit. Rejected calls still count, so a client that keeps hammering stays
// limited until the window ends.
//
// Throws when the database fails. Callers decide: reads fail open, writes fail
// closed.
export async function consumeRateLimits(
  checks: RateLimitCheck[],
  now: number = Date.now()
): Promise<RateLimitDecision[]> {
  if (checks.length === 0) {
    return [];
  }
  const keys = checks.map((c) => c.key);
  if (new Set(keys).size !== keys.length) {
    // One upsert cannot touch the same row twice.
    throw new Error("Duplicate rate limit key in one call");
  }

  const rows = checks.map((c) => ({
    key: c.key,
    windowStart: new Date(windowStartFor(now, c.windowMs)),
    count: Math.max(1, Math.floor(c.cost ?? 1)),
  }));

  const counted = await db
    .insert(rateLimitCounter)
    .values(rows)
    .onConflictDoUpdate({
      target: [rateLimitCounter.key, rateLimitCounter.windowStart],
      set: { count: sql`${rateLimitCounter.count} + excluded.count` },
    })
    .returning({
      key: rateLimitCounter.key,
      windowStart: rateLimitCounter.windowStart,
      count: rateLimitCounter.count,
    });

  void maybeCleanUp(now);

  return checks.map((check) => {
    const hit = counted.find((r) => r.key === check.key);
    const ok = hit !== undefined && hit.count <= check.limit;
    return {
      key: check.key,
      ok,
      retryAfter: ok ? 0 : retryAfterSeconds(now, check.windowMs),
    };
  });
}

// One check. See `consumeRateLimits`.
export async function rateLimitDb(
  key: string,
  limit: number,
  windowMs: number,
  cost = 1
): Promise<RateLimitDecision> {
  const [decision] = await consumeRateLimits([{ key, limit, windowMs, cost }]);
  return decision;
}

// Deletes counters from windows that ended more than an hour ago. Returns how
// many rows were removed. Called by the worker job and, rarely, by the limiter.
export async function deleteOldRateLimitRows(
  now: number = Date.now()
): Promise<number> {
  const removed = await db
    .delete(rateLimitCounter)
    .where(
      lt(rateLimitCounter.windowStart, new Date(now - RATE_LIMIT_RETENTION_MS))
    )
    .returning({ key: rateLimitCounter.key });
  return removed.length;
}

// About one call in 500 also cleans up, so a deployment without the worker
// does not grow the table forever. Never throws into a request.
async function maybeCleanUp(now: number): Promise<void> {
  if (Math.random() >= 1 / 500) {
    return;
  }
  try {
    await deleteOldRateLimitRows(now);
  } catch {
    // Best effort.
  }
}
