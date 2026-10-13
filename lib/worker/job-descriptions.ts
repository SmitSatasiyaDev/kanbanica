import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Plain-language summary of each queue, shown on Orbit → Queues → [queue].
 * Keep in sync with the handlers in `lib/worker/handlers/` and the cron
 * schedules in `lib/worker/boss.ts` (the schedule itself is read live from
 * pg-boss, so only the behavior is described here).
 */
export const JOB_DESCRIPTIONS: Record<string, string> = {
  [JOB_NAMES.EMAIL_SEND]:
    "Sends one email from the outbox over SMTP. Enqueued whenever the app sends mail (magic links, invites, notifications, support).",
  [JOB_NAMES.EMAIL_OUTBOX_REAP]:
    "Safety net for the outbox: marks emails stuck in the 'sending' state for more than 30 minutes as failed, so a crashed send doesn't stay pending forever.",
  [JOB_NAMES.EMAIL_EVENTS_PRUNE]:
    "Deletes email provider events (delivered, bounced, …) older than 90 days to keep the email_events table small.",
  [JOB_NAMES.SCAFFOLD_HEALTHCHECK]:
    "Heartbeat that only logs 'ok'. Steady completed runs mean the worker is alive and processing jobs.",
  [JOB_NAMES.SPRINT_AUTO_CLOSE]:
    "Closes ACTIVE sprints whose end date is over, in projects that have 'Auto-mark sprint as done' enabled. Also runs once on worker boot to catch up.",
  [JOB_NAMES.NOTIFICATION_CLEANUP]:
    "Deletes notifications that have passed their expiry date.",
  [JOB_NAMES.DUE_DATE_REMINDER]:
    "Sends due-date reminders (due tomorrow / today / overdue), evaluated in each user's own timezone, at most once per user per local day.",
  [JOB_NAMES.NOTIFICATION_DIGEST_SCAN]:
    "Finds users whose email digest is due in this window and enqueues a notification.digest-send job for each.",
  [JOB_NAMES.NOTIFICATION_DIGEST_SEND]:
    "Builds and sends one user's notification digest email.",
  [JOB_NAMES.IMPERSONATION_CLEANUP]:
    "Deletes admin impersonation sessions older than 1 hour.",
  [JOB_NAMES.SUPPORT_TICKET_AUTO_CLOSE]:
    "Closes OPEN support tickets with no activity for 14 days.",
  [JOB_NAMES.TRASH_AUTO_PURGE]:
    "Permanently deletes tasks that have been in the Trash for 30+ days (storage files first). Also runs once on worker boot to catch up.",
  "__pgboss__send-it":
    "Internal pg-boss queue. The scheduler uses it to deliver each cron tick into the target queue.",
};

export function describeJob(name: string): string | null {
  return JOB_DESCRIPTIONS[name] ?? null;
}

/** Text color for a pg-boss job state badge. */
export function jobStateClass(state: string): string {
  switch (state) {
    case "completed":
      return "text-success";
    case "failed":
      return "text-error";
    case "active":
      return "text-info";
    case "cancelled":
      return "text-base-content/60";
    default:
      return "text-warning";
  }
}
