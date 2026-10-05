export const JOB_NAMES = {
  EMAIL_EVENTS_PRUNE: "email.events-prune",
  EMAIL_OUTBOX_REAP: "email.outbox-reap",
  EMAIL_SEND: "email.send",
  SCAFFOLD_HEALTHCHECK: "scaffold.healthcheck",
  SPRINT_AUTO_CLOSE: "sprint.auto-close",
  NOTIFICATION_CLEANUP: "notification.cleanup",
  DUE_DATE_REMINDER: "notification.due-date-reminder",
  NOTIFICATION_DIGEST_SCAN: "notification.digest-scan",
  NOTIFICATION_DIGEST_SEND: "notification.digest-send",
  IMPERSONATION_CLEANUP: "impersonation.cleanup",
  SUPPORT_TICKET_AUTO_CLOSE: "support.ticket-auto-close",
} as const;

// Sprint auto-close is idempotent (it only touches ACTIVE sprints past their end
// date), so it runs hourly instead of once a day: pg-boss does not backfill a
// cron slot missed while the worker was down, and a single 00:00 UTC slot meant
// one missed boot left an overdue sprint ACTIVE for a full extra day (or more).
export const SPRINT_AUTO_CLOSE_CRON = "0 * * * *";

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export interface EmailSendPayload {
  outboxId: string;
}

export type JobPayloads = {
  [JOB_NAMES.EMAIL_EVENTS_PRUNE]: Record<string, never>;
  [JOB_NAMES.EMAIL_OUTBOX_REAP]: Record<string, never>;
  [JOB_NAMES.EMAIL_SEND]: EmailSendPayload;
  [JOB_NAMES.SCAFFOLD_HEALTHCHECK]: Record<string, never>;
  [JOB_NAMES.SPRINT_AUTO_CLOSE]: Record<string, never>;
  [JOB_NAMES.NOTIFICATION_CLEANUP]: Record<string, never>;
  [JOB_NAMES.DUE_DATE_REMINDER]: Record<string, never>;
  [JOB_NAMES.NOTIFICATION_DIGEST_SCAN]: Record<string, never>;
  [JOB_NAMES.NOTIFICATION_DIGEST_SEND]: {
    userId: string;
    windowStart: string;
    windowEnd: string;
  };
  [JOB_NAMES.IMPERSONATION_CLEANUP]: Record<string, never>;
  [JOB_NAMES.SUPPORT_TICKET_AUTO_CLOSE]: { dryRun?: boolean };
};
