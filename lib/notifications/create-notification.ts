import { createId } from "@paralleldrive/cuid2";
import { addDays } from "date-fns";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  mutedEntity,
  notification,
  user,
  userEmailPreference,
  userNotificationPreference,
  workspace,
} from "@/db/schema";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { notificationTemplate } from "@/lib/email/templates/notification";
import { areNotificationEmailsEnabled } from "@/lib/integration-settings";
import { isSmtpConfigured } from "@/lib/smtp/client";
import { pushToUser } from "@/lib/sse-clients";
import { notificationSettingsUrl, notificationUrl } from "./links";
import { sendPushToUser } from "./push";
import type { NotificationTriggerType } from "./types";
import {
  emailDefaultFor,
  inAppDefaultFor,
  pushDefaultFor,
  soundDefaultFor,
} from "./types";

export interface CreateNotificationParams {
  actorId: string | null;
  body?: string;
  entityId: string;
  entityType: "TASK" | "COMMENT" | "SPACE" | "WORKSPACE" | "SPRINT";
  muteCheckEntityIds?: string[];
  pushBody?: string;
  // Push-specific overrides — separate from in-app title/body
  pushTitle?: string;
  pushUrl?: string;
  recipientIds: string[];
  title: string;
  triggerType: NotificationTriggerType;
  workspaceId: string;
}

// Fire-and-forget — never await this in a mutation handler
export function createNotifications(params: CreateNotificationParams): void {
  void _create(params).catch((err) => {
    console.error("[notifications] create failed", err);
  });
}

async function _create(params: CreateNotificationParams) {
  const {
    workspaceId,
    actorId,
    recipientIds,
    triggerType,
    entityType,
    entityId,
    title,
    body,
    muteCheckEntityIds,
    // `pushTitle` is intentionally not used: the OS push title is now the
    // workspace name (see the push block below). The field stays on
    // CreateNotificationParams for backward compatibility with callers.
    pushBody,
    pushUrl,
  } = params;

  // Remove actor from recipients (no self-notifications), deduplicate
  const eligibleIds = [...new Set(recipientIds.filter((id) => id !== actorId))];
  if (eligibleIds.length === 0) {
    return;
  }

  // Source workspace name — headlines browser push + the in-app toast so
  // multi-workspace users can tell where a notification came from. One cheap
  // primary-key lookup per call (not per recipient).
  const [ws] = await db
    .select({ name: workspace.name, icon: workspace.logoEmoji })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const workspaceName = ws?.name ?? null;
  const workspaceIcon = ws?.icon ?? null;

  // Check muted entities — exclude users who muted this task/space
  const entitiesToCheck = muteCheckEntityIds ?? [entityId];
  const mutedRows = await db
    .select({ userId: mutedEntity.userId })
    .from(mutedEntity)
    .where(
      and(
        inArray(mutedEntity.userId, eligibleIds),
        inArray(mutedEntity.entityId, entitiesToCheck)
      )
    );
  const mutedUserIds = new Set(mutedRows.map((r) => r.userId));
  const finalRecipients = eligibleIds.filter((id) => !mutedUserIds.has(id));
  if (finalRecipients.length === 0) {
    return;
  }

  // Fetch per-trigger preferences for all eligible recipients
  const prefs = await db
    .select({
      userId: userNotificationPreference.userId,
      inAppEnabled: userNotificationPreference.inAppEnabled,
      emailEnabled: userNotificationPreference.emailEnabled,
      pushEnabled: userNotificationPreference.pushEnabled,
      soundEnabled: userNotificationPreference.soundEnabled,
    })
    .from(userNotificationPreference)
    .where(
      and(
        inArray(userNotificationPreference.userId, finalRecipients),
        eq(userNotificationPreference.triggerType, triggerType),
        or(
          isNull(userNotificationPreference.workspaceId),
          eq(userNotificationPreference.workspaceId, workspaceId)
        )
      )
    );

  // Build pref maps — with no stored row, the per-trigger default applies
  // (on, except opt-in triggers like task_created; see ./types).
  const prefMap = new Map(prefs.map((p) => [p.userId, p]));

  const notifRecipients = finalRecipients.filter((id) => {
    const pref = prefMap.get(id);
    return pref ? pref.inAppEnabled : inAppDefaultFor(triggerType);
  });

  const pushRecipients = finalRecipients.filter((id) => {
    const pref = prefMap.get(id);
    return pref ? pref.pushEnabled : pushDefaultFor(triggerType);
  });

  // Email defaults are NOT `true` like in-app/push — only high-signal triggers
  // opt in by default. See emailDefaultFor() in ./types.
  const emailRecipients = finalRecipients.filter((id) => {
    const pref = prefMap.get(id);
    return pref ? pref.emailEnabled : emailDefaultFor(triggerType);
  });

  const now = new Date();
  const expiresAt = addDays(now, 90);

  if (notifRecipients.length > 0) {
    await db.insert(notification).values(
      notifRecipients.map((recipientId) => ({
        id: createId(),
        workspaceId,
        recipientId,
        actorId,
        triggerType,
        entityType,
        entityId,
        title,
        body: body ?? null,
        isRead: false,
        createdAt: now,
        expiresAt,
      }))
    );
    // Push SSE event to all connected browsers for each recipient. Include the
    // title/body/url so the client can show an in-app toast popup, not just
    // refresh the badge.
    const toastUrl = pushUrl ?? `/${workspaceId}/notifications`;
    for (const recipientId of notifRecipients) {
      const pref = prefMap.get(recipientId);
      // Per-event sound preference — defaults per soundDefaultFor() when the
      // user has no stored row. The client separately gates this on its own
      // global "In-App Notification Sound" master switch.
      const soundEligible = pref
        ? pref.soundEnabled
        : soundDefaultFor(triggerType);
      pushToUser(recipientId, {
        type: "new_notification",
        triggerType,
        soundEligible,
        title,
        body: body ?? null,
        url: toastUrl,
        workspaceId,
        workspaceName,
        workspaceIcon,
      });
    }
  }

  // Send push notifications — fire-and-forget per recipient. The workspace name
  // headlines the OS notification so multi-workspace users see the source; the
  // message (and any caller-supplied detail like a comment/attachment) moves to
  // the body. Falls back to the message as the title if the workspace name is
  // unavailable. `pushTitle` is intentionally no longer the OS headline.
  if (pushRecipients.length > 0) {
    const pushDetail = pushBody ?? body ?? null;
    const composedBody = workspaceName
      ? [title, pushDetail].filter(Boolean).join("\n")
      : (pushDetail ?? title);
    await Promise.allSettled(
      pushRecipients.map((userId) =>
        sendPushToUser(userId, {
          title: workspaceName ?? title,
          body: composedBody,
          url: pushUrl ?? `/${workspaceId}/task/${entityId}`,
        })
      )
    );
  }

  // Instant email. Skipped entirely when SMTP isn't configured, so an
  // unconfigured self-host never accumulates undeliverable outbox rows.
  // `digest` recipients are picked up later by the digest worker straight from
  // the `notification` table; `off` recipients get nothing. Also skipped when
  // the platform admin has turned notification email off (Orbit →
  // Integrations) — in-app and push above are unaffected.
  if (
    emailRecipients.length > 0 &&
    (await isSmtpConfigured()) &&
    (await areNotificationEmailsEnabled())
  ) {
    await sendInstantEmails({
      recipientIds: emailRecipients,
      workspaceId,
      entityType,
      entityId,
      title,
      body: body ?? null,
    });
  }
}

async function sendInstantEmails({
  recipientIds,
  workspaceId,
  entityType,
  entityId,
  title,
  body,
}: {
  recipientIds: string[];
  workspaceId: string;
  entityType: CreateNotificationParams["entityType"];
  entityId: string;
  title: string;
  body: string | null;
}) {
  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      deliveryMode: userEmailPreference.deliveryMode,
    })
    .from(user)
    .leftJoin(userEmailPreference, eq(userEmailPreference.userId, user.id))
    .where(inArray(user.id, recipientIds));

  // No preference row means the default delivery mode, "instant".
  const instant = rows.filter(
    (r) => (r.deliveryMode ?? "instant") === "instant"
  );
  if (instant.length === 0) {
    return;
  }

  const url = notificationUrl(workspaceId, entityType, entityId);
  const settingsUrl = notificationSettingsUrl(workspaceId);
  const { html, text } = await notificationTemplate({
    title,
    body,
    url,
    settingsUrl,
  });

  await Promise.allSettled(
    instant.map((r) =>
      enqueueEmail({ to: r.email, subject: title, html, text })
    )
  );
}
