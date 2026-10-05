import { type Job, PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { sanitizeDatabaseUrl } from "@/lib/pg-connection";
import { sleep } from "@/lib/utils";
import { ensureJobQueues } from "@/lib/worker/ensure-queues";
import {
  JOB_NAMES,
  SPRINT_AUTO_CLOSE_CRON,
  TRASH_AUTO_PURGE_CRON,
} from "@/lib/worker/job-types";

// `ssl` must be passed explicitly: `pg` lets a parsed connection string override
// its own `ssl` option, so `sslmode` is stripped from the URL instead.
const { url: bossUrl, ssl: bossSsl } = sanitizeDatabaseUrl(env.DATABASE_URL);

const boss = new PgBoss({
  connectionString: bossUrl,
  ssl: bossSsl,
});

export { boss };

function work<T>(name: string, handler: (jobs: Job<T>[]) => Promise<void>) {
  return boss.work<T>(name, { includeMetadata: true }, handler);
}

async function startBossWithRetry(maxRetries = 10) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await boss.start();
      console.log("[worker] pg-boss started");
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      const delay = Math.min(2000 * 2 ** (attempt - 1), 30_000);
      console.error(
        `[worker] pg-boss start failed (${attempt}/${maxRetries}); retrying in ${
          delay / 1000
        }s`,
        error
      );
      await sleep(delay);
    }
  }
}

export async function startWorker() {
  boss.on("error", (error) => {
    console.error("[worker] pg-boss error", error);
  });

  await startBossWithRetry();
  await ensureJobQueues(boss);

  const { handleEmailSend } = await import("@/lib/worker/handlers/email-send");
  const { handleEmailOutboxReap } = await import(
    "@/lib/worker/handlers/email-outbox-reap"
  );
  const { handleEmailEventsPrune } = await import(
    "@/lib/worker/handlers/email-events-prune"
  );
  const { handleScaffoldHealthcheck } = await import(
    "@/lib/worker/handlers/scaffold-healthcheck"
  );
  const { handleSprintAutoClose } = await import(
    "@/lib/worker/handlers/sprint-auto-close"
  );
  const { handleNotificationCleanup } = await import(
    "@/lib/worker/handlers/notification-cleanup"
  );
  const { handleDueDateReminder } = await import(
    "@/lib/worker/handlers/due-date-reminder"
  );
  const { handleNotificationDigestScan } = await import(
    "@/lib/worker/handlers/notification-digest-scan"
  );
  const { handleNotificationDigestSend } = await import(
    "@/lib/worker/handlers/notification-digest-send"
  );
  const { handleImpersonationCleanup } = await import(
    "@/lib/worker/handlers/impersonation-cleanup"
  );
  const { handleSupportTicketAutoClose } = await import(
    "@/lib/worker/handlers/support-ticket-auto-close"
  );
  const { handleTrashAutoPurge } = await import(
    "@/lib/worker/handlers/trash-auto-purge"
  );

  await Promise.all([
    work(JOB_NAMES.TRASH_AUTO_PURGE, handleTrashAutoPurge),
    work(JOB_NAMES.EMAIL_SEND, handleEmailSend),
    work(JOB_NAMES.EMAIL_OUTBOX_REAP, handleEmailOutboxReap),
    work(JOB_NAMES.EMAIL_EVENTS_PRUNE, handleEmailEventsPrune),
    work(JOB_NAMES.SCAFFOLD_HEALTHCHECK, handleScaffoldHealthcheck),
    work(JOB_NAMES.SPRINT_AUTO_CLOSE, handleSprintAutoClose),
    work(JOB_NAMES.NOTIFICATION_CLEANUP, handleNotificationCleanup),
    work(JOB_NAMES.DUE_DATE_REMINDER, handleDueDateReminder),
    work(JOB_NAMES.NOTIFICATION_DIGEST_SCAN, handleNotificationDigestScan),
    work(JOB_NAMES.NOTIFICATION_DIGEST_SEND, handleNotificationDigestSend),
    work(JOB_NAMES.IMPERSONATION_CLEANUP, handleImpersonationCleanup),
    work(JOB_NAMES.SUPPORT_TICKET_AUTO_CLOSE, handleSupportTicketAutoClose),
  ]);

  await boss.schedule(JOB_NAMES.EMAIL_OUTBOX_REAP, "*/15 * * * *", {});
  await boss.schedule(JOB_NAMES.EMAIL_EVENTS_PRUNE, "17 3 * * *", {});
  await boss.schedule(JOB_NAMES.SCAFFOLD_HEALTHCHECK, "*/10 * * * *", {});
  await boss.schedule(JOB_NAMES.SPRINT_AUTO_CLOSE, SPRINT_AUTO_CLOSE_CRON, {});
  await boss.schedule(JOB_NAMES.NOTIFICATION_CLEANUP, "0 1 * * *", {});
  await boss.schedule(JOB_NAMES.DUE_DATE_REMINDER, "0 * * * *", {});
  await boss.schedule(JOB_NAMES.NOTIFICATION_DIGEST_SCAN, "*/30 * * * *", {});
  await boss.schedule(JOB_NAMES.IMPERSONATION_CLEANUP, "*/5 * * * *", {});
  await boss.schedule(JOB_NAMES.SUPPORT_TICKET_AUTO_CLOSE, "0 2 * * *", {});
  await boss.schedule(JOB_NAMES.TRASH_AUTO_PURGE, TRASH_AUTO_PURGE_CRON, {});

  // Catch-up run: closes sprints that went overdue while the worker was down,
  // without waiting for the next cron slot. The queue's "exclusive" policy
  // prevents a duplicate if a scheduled run is already queued.
  await boss.send(JOB_NAMES.SPRINT_AUTO_CLOSE, {});
  // Same for Trash: purge anything that expired while the worker was offline.
  await boss.send(JOB_NAMES.TRASH_AUTO_PURGE, {});

  console.log("[worker] handlers registered");
}

export async function stopWorker() {
  await boss.stop({ graceful: true });
}
