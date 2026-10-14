import { dbClient } from "@/lib/db";

export interface QueueSummaryRow {
  count: number;
  name: string;
  state: string;
}

export async function getQueueSummary(): Promise<QueueSummaryRow[]> {
  try {
    const rows = await dbClient<QueueSummaryRow[]>`
      select name, state, count(*)::int as count
      from pgboss.job
      group by name, state
      order by name, state
    `;
    return rows;
  } catch {
    return [];
  }
}

export const JOB_STATES = [
  "created",
  "retry",
  "active",
  "completed",
  "cancelled",
  "failed",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export function isJobState(value: unknown): value is JobState {
  return (
    typeof value === "string" &&
    (JOB_STATES as readonly string[]).includes(value)
  );
}

export interface QueueSettings {
  deletionSeconds: number | null;
  expireSeconds: number | null;
  policy: string | null;
  retentionSeconds: number | null;
  retryDelay: number | null;
  retryLimit: number | null;
}

export interface QueueJob {
  completedOn: Date | null;
  createdOn: Date;
  /** One-line error for failed runs (pg-boss stores the thrown error as `output`). */
  error: string | null;
  id: string;
  retryCount: number;
  startedOn: Date | null;
  state: string;
}

export interface QueueDetail {
  counts: { count: number; state: string }[];
  jobs: QueueJob[];
  lastCompletedOn: Date | null;
  latestFailure: { createdOn: Date; output: string } | null;
  name: string;
  schedules: { cron: string; timezone: string | null }[];
  settings: QueueSettings | null;
}

export const QUEUE_DETAIL_JOB_LIMIT = 50;

// `db` is Drizzle's postgres-js client, which returns timestamps as strings.
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** pg-boss serializes the thrown error; surface its root `cause` first, then `message`. */
export function summarizeJobOutput(output: unknown): string | null {
  if (!output || typeof output !== "object") {
    return typeof output === "string" ? output : null;
  }
  const o = output as { message?: unknown; cause?: { message?: unknown } };
  const parts = [o.cause?.message, o.message].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  return parts.length > 0 ? parts.join(" — ") : null;
}

/**
 * Everything Orbit → Queues → [queue] shows: settings, cron schedule, state
 * counts and the most recent runs. Returns null when the pgboss schema doesn't
 * exist yet (worker never started) or the queue is unknown.
 */
export async function getQueueDetail(
  name: string,
  state?: JobState
): Promise<QueueDetail | null> {
  try {
    const [
      settingsRows,
      schedules,
      counts,
      jobs,
      latestFailure,
      lastCompleted,
    ] = await Promise.all([
      dbClient<
        {
          policy: string | null;
          retry_limit: number | null;
          retry_delay: number | null;
          expire_seconds: number | null;
          retention_seconds: number | null;
          deletion_seconds: number | null;
        }[]
      >`
          select policy, retry_limit, retry_delay, expire_seconds,
                 retention_seconds, deletion_seconds
          from pgboss.queue where name = ${name}
        `,
      dbClient<{ cron: string; timezone: string | null }[]>`
          select cron, timezone from pgboss.schedule where name = ${name}
        `,
      dbClient<{ state: string; count: number }[]>`
          select state, count(*)::int as count
          from pgboss.job where name = ${name}
          group by state order by state
        `,
      dbClient<
        {
          id: string;
          state: string;
          created_on: string;
          started_on: string | null;
          completed_on: string | null;
          retry_count: number;
          output: unknown;
        }[]
      >`
          select id, state, created_on, started_on, completed_on, retry_count,
                 case when state = 'failed' then output end as output
          from pgboss.job
          where name = ${name}
            ${state ? dbClient`and state = ${state}` : dbClient``}
          order by created_on desc
          limit ${QUEUE_DETAIL_JOB_LIMIT}
        `,
      dbClient<{ created_on: string; output: unknown }[]>`
          select created_on, output from pgboss.job
          where name = ${name} and state = 'failed'
          order by created_on desc limit 1
        `,
      dbClient<{ completed_on: string | null }[]>`
          select max(completed_on) as completed_on from pgboss.job
          where name = ${name} and state = 'completed'
        `,
    ]);

    const s = settingsRows[0];
    if (!s && counts.length === 0) {
      return null;
    }

    const failure = latestFailure[0];
    return {
      name,
      settings: s
        ? {
            policy: s.policy,
            retryLimit: s.retry_limit,
            retryDelay: s.retry_delay,
            expireSeconds: s.expire_seconds,
            retentionSeconds: s.retention_seconds,
            deletionSeconds: s.deletion_seconds,
          }
        : null,
      schedules: schedules.map((r) => ({ cron: r.cron, timezone: r.timezone })),
      counts: counts.map((r) => ({ state: r.state, count: r.count })),
      jobs: jobs.map((j) => ({
        id: j.id,
        state: j.state,
        createdOn: toDate(j.created_on) ?? new Date(0),
        startedOn: toDate(j.started_on),
        completedOn: toDate(j.completed_on),
        retryCount: j.retry_count,
        error: summarizeJobOutput(j.output),
      })),
      latestFailure: failure
        ? {
            createdOn: toDate(failure.created_on) ?? new Date(0),
            output: JSON.stringify(failure.output, null, 2),
          }
        : null,
      lastCompletedOn: toDate(lastCompleted[0]?.completed_on),
    };
  } catch {
    return null;
  }
}
