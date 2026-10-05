import { and, eq, gte, lt } from "drizzle-orm";
import type { Job } from "pg-boss";
import { PRODUCT_NAME } from "@/config/platform";
import { notification, user, userNotificationPreference } from "@/db/schema";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email/index";
import { areNotificationEmailsEnabled } from "@/lib/integration-settings";
import { emailDefaultFor } from "@/lib/notifications/types";

interface DigestSendPayload {
  userId: string;
  windowEnd: string;
  windowStart: string;
}

export async function handleNotificationDigestSend(
  jobs: Job<DigestSendPayload>[]
) {
  // Re-checked at send time so digests queued before the switch was turned off
  // are dropped too.
  if (!(await areNotificationEmailsEnabled())) {
    return;
  }
  for (const job of jobs) {
    await processDigest(job.data);
  }
}

async function processDigest({
  userId,
  windowStart,
  windowEnd,
}: DigestSendPayload) {
  const [userRow] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!userRow) {
    return;
  }

  const unread = await db
    .select()
    .from(notification)
    .where(
      and(
        eq(notification.recipientId, userId),
        eq(notification.isRead, false),
        gte(notification.createdAt, new Date(windowStart)),
        lt(notification.createdAt, new Date(windowEnd))
      )
    )
    .limit(50);

  if (unread.length === 0) {
    return;
  }

  // Honour the per-trigger Email toggles. Without this the digest mails every
  // unread notification regardless of what the user chose.
  const prefs = await db
    .select({
      triggerType: userNotificationPreference.triggerType,
      emailEnabled: userNotificationPreference.emailEnabled,
    })
    .from(userNotificationPreference)
    .where(eq(userNotificationPreference.userId, userId));

  const emailPref = new Map(prefs.map((p) => [p.triggerType, p.emailEnabled]));
  const notifications = unread.filter(
    (n) => emailPref.get(n.triggerType) ?? emailDefaultFor(n.triggerType)
  );

  if (notifications.length === 0) {
    return;
  }

  const rows = notifications
    .map(
      (n) => `<tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${escapeHtml(n.title)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 12px;">${n.createdAt.toUTCString()}</td>
      </tr>`
    )
    .join("");

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Your ${PRODUCT_NAME} Notification Digest</h2>
      <p>Here are your notifications from the last 30 minutes:</p>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #eee;">
        <thead>
          <tr style="background: #f9f9f9;">
            <th style="padding: 8px 12px; text-align: left; border-bottom: 2px solid #eee;">Notification</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 2px solid #eee;">Time</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color: #666; font-size: 12px; margin-top: 24px;">
        You're receiving this digest because you have digest notifications enabled in ${PRODUCT_NAME}.
      </p>
    </div>
  `;

  const text = notifications
    .map((n) => `- ${n.title} (${n.createdAt.toUTCString()})`)
    .join("\n");

  await enqueueEmail({
    to: userRow.email,
    subject: `[${PRODUCT_NAME}] Your notification digest`,
    html,
    text,
  });

  console.log(
    "[notification-digest-send] sent digest to",
    userRow.email,
    "with",
    notifications.length,
    "notifications"
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
