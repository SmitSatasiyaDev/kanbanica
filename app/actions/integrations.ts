"use server";

import { revalidatePath } from "next/cache";
import webpush from "web-push";
import { pushSubscription } from "@/db/schema";
import { integrationSettings } from "@/db/schema/integration-settings";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/authz";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import {
  getSmtpSettings,
  getStorageSettings,
} from "@/lib/integration-settings";
import { testSmtpConnection } from "@/lib/smtp/client";
import { testStorageConnection } from "@/lib/storage";

const VALID_STORAGE_DRIVERS = new Set(["local", "s3", "r2"]);

/** undefined = leave column untouched; "" clears it (stored as null); non-empty sets it, trimmed. */
function plainField(incoming: unknown): string | null | undefined {
  if (typeof incoming !== "string") {
    return;
  }
  const trimmed = incoming.trim();
  return trimmed === "" ? null : trimmed;
}

/** Same semantics as plainField, but encrypts non-empty values before storing. */
function secretField(incoming: unknown): string | null | undefined {
  if (typeof incoming !== "string") {
    return;
  }
  if (incoming === "") {
    return null;
  }
  return encryptSecret(incoming);
}

/** Drops keys whose resolved value is undefined, so drizzle only touches submitted fields. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

interface SaveInput {
  google?: { clientId?: unknown; clientSecret?: unknown };
  notifications?: { emailsEnabled?: unknown };
  smtp?: {
    host?: unknown;
    port?: unknown;
    user?: unknown;
    pass?: unknown;
    from?: unknown;
  };
  storage?: {
    driver?: unknown;
    endpoint?: unknown;
    region?: unknown;
    bucket?: unknown;
    publicUrl?: unknown;
    accessKeyId?: unknown;
    secretAccessKey?: unknown;
  };
  webPush?: { publicKey?: unknown; subject?: unknown; privateKey?: unknown };
}

/**
 * Partial update, one section (smtp/google/storage/webPush/notifications) at a time.
 * Within a section: key omitted = unchanged, "" = clear, non-empty = set
 * (encrypted for secret fields).
 */
export async function saveIntegrationSettingsAction(
  body: SaveInput
): Promise<{ ok: true } | { error: string }> {
  const admin = await requireAdmin();

  const updates: Record<string, unknown> = {};
  const auditSections: string[] = [];

  if (body.smtp) {
    const port =
      typeof body.smtp.port === "number"
        ? Math.trunc(body.smtp.port)
        : undefined;
    if (port !== undefined && (port < 1 || port > 65_535)) {
      return { error: "Invalid SMTP port." };
    }
    Object.assign(
      updates,
      compact({
        smtpHost: plainField(body.smtp.host),
        smtpPort: port,
        smtpUser: plainField(body.smtp.user),
        smtpPassEncrypted: secretField(body.smtp.pass),
        emailFrom: plainField(body.smtp.from),
      })
    );
    auditSections.push("smtp");
  }

  if (body.google) {
    Object.assign(
      updates,
      compact({
        googleClientId: plainField(body.google.clientId),
        googleClientSecretEncrypted: secretField(body.google.clientSecret),
      })
    );
    auditSections.push("google");
  }

  if (body.storage) {
    if (
      body.storage.driver !== undefined &&
      !VALID_STORAGE_DRIVERS.has(body.storage.driver as string)
    ) {
      return { error: "Invalid storage driver." };
    }
    Object.assign(
      updates,
      compact({
        storageDriver:
          typeof body.storage.driver === "string"
            ? body.storage.driver
            : undefined,
        storageEndpoint: plainField(body.storage.endpoint),
        storageRegion: plainField(body.storage.region),
        storageBucket: plainField(body.storage.bucket),
        storagePublicUrl: plainField(body.storage.publicUrl),
        storageAccessKeyId: plainField(body.storage.accessKeyId),
        storageSecretAccessKeyEncrypted: secretField(
          body.storage.secretAccessKey
        ),
      })
    );
    auditSections.push("storage");
  }

  if (body.webPush) {
    if (
      typeof body.webPush.subject === "string" &&
      body.webPush.subject.trim()
    ) {
      const normalized = normalizeVapidSubject(body.webPush.subject);
      if (!normalized) {
        return {
          error:
            "Subject must be an email address, mailto: address or https:// URL.",
        };
      }
      body.webPush.subject = normalized;
    }
    Object.assign(
      updates,
      compact({
        vapidPublicKey: plainField(body.webPush.publicKey),
        vapidSubject: plainField(body.webPush.subject),
        vapidPrivateKeyEncrypted: secretField(body.webPush.privateKey),
      })
    );
    auditSections.push("webPush");
  }

  if (body.notifications) {
    if (typeof body.notifications.emailsEnabled !== "boolean") {
      return { error: "Invalid notification email setting." };
    }
    updates.notificationEmailsEnabled = body.notifications.emailsEnabled;
    auditSections.push(
      `notifications (emails ${body.notifications.emailsEnabled ? "on" : "off"})`
    );
  }

  if (auditSections.length === 0) {
    return { error: "No settings provided." };
  }

  const now = new Date();
  await db
    .insert(integrationSettings)
    .values({ id: "default", ...updates, updatedAt: now })
    .onConflictDoUpdate({
      target: integrationSettings.id,
      set: { ...updates, updatedAt: now },
    });

  await audit({
    action: "integration_settings.updated",
    actorEmail: admin.user.email,
    actorId: admin.user.id,
    description: `Updated integration settings: ${auditSections.join(", ")}`,
    entityId: "default",
    entityType: "integration_settings",
    metadata: { sections: auditSections },
  });

  revalidatePath("/orbit/integrations");
  return { ok: true };
}

function strOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

interface TestSmtpInput {
  host?: unknown;
  pass?: unknown;
  port?: unknown;
  user?: unknown;
}

/**
 * Verifies SMTP credentials without sending an email (nodemailer's
 * `transporter.verify()`) — backs the "Test Connection" button. Field values
 * come from the (possibly unsaved) form; an empty password falls back to the
 * currently saved one so testing doesn't require re-entering it every time.
 */
export async function testSmtpConnectionAction(
  input: TestSmtpInput
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();

  const host = typeof input.host === "string" ? input.host.trim() : "";
  const user = typeof input.user === "string" ? input.user.trim() : "";
  const port =
    typeof input.port === "number" && Number.isFinite(input.port)
      ? Math.trunc(input.port)
      : 587;
  let pass = typeof input.pass === "string" ? input.pass : "";

  if (!pass) {
    pass = (await getSmtpSettings())?.pass ?? "";
  }

  if (!(host && user && pass)) {
    return { error: "Enter host, username, and password to test." };
  }
  if (port < 1 || port > 65_535) {
    return { error: "Invalid SMTP port." };
  }

  return testSmtpConnection({ host, port, user, pass });
}

interface TestStorageInput {
  accessKeyId?: unknown;
  bucket?: unknown;
  driver?: unknown;
  endpoint?: unknown;
  publicUrl?: unknown;
  region?: unknown;
  secretAccessKey?: unknown;
}

/**
 * Round-trips a throwaway object through the candidate storage config
 * (upload + delete) — backs the "Test Connection" button. An empty secret
 * key falls back to the currently saved one, same as testSmtpConnectionAction.
 */
export async function testStorageConnectionAction(
  input: TestStorageInput
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();

  const driver =
    input.driver === "s3" || input.driver === "r2" ? input.driver : "local";

  if (driver === "local") {
    return testStorageConnection({ driver: "local" });
  }

  const bucket = typeof input.bucket === "string" ? input.bucket.trim() : "";
  if (!bucket) {
    return { error: "Enter a bucket name to test." };
  }

  let secretAccessKey =
    typeof input.secretAccessKey === "string" ? input.secretAccessKey : "";
  if (!secretAccessKey) {
    const saved = await getStorageSettings();
    secretAccessKey =
      (saved.driver === "local" ? undefined : saved.secretAccessKey) ?? "";
  }

  return testStorageConnection({
    driver,
    bucket,
    endpoint: strOrUndefined(input.endpoint),
    region: strOrUndefined(input.region),
    publicUrl: strOrUndefined(input.publicUrl),
    accessKeyId: strOrUndefined(input.accessKeyId),
    secretAccessKey: secretAccessKey || undefined,
  });
}

/** web-push accepts only `mailto:` or `https://` subjects; a bare email gets the prefix. */
function normalizeVapidSubject(raw: string): string | null {
  const value = raw.trim();
  if (/^https:\/\/\S+$/i.test(value) || /^mailto:\S+@\S+$/i.test(value)) {
    return value;
  }
  return /^\S+@\S+\.\S+$/.test(value) ? `mailto:${value}` : null;
}

/**
 * Generates a fresh VAPID key pair server-side and saves it (private key
 * encrypted). Regenerating invalidates every existing browser subscription,
 * so those rows are deleted — users re-subscribe with the new key. Returns
 * only the public key + normalized subject; the private key never leaves
 * the server.
 */
export async function generateVapidKeysAction(input: {
  subject?: unknown;
}): Promise<
  { ok: true; publicKey: string; subject: string } | { error: string }
> {
  const admin = await requireAdmin();

  const rawSubject =
    typeof input.subject === "string" && input.subject.trim()
      ? input.subject
      : admin.user.email;
  const subject = normalizeVapidSubject(rawSubject);
  if (!subject) {
    return {
      error:
        "Subject must be an email address, mailto: address or https:// URL.",
    };
  }

  const keys = webpush.generateVAPIDKeys();
  const now = new Date();
  const values = {
    vapidPublicKey: keys.publicKey,
    vapidPrivateKeyEncrypted: encryptSecret(keys.privateKey),
    vapidSubject: subject,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(integrationSettings)
      .values({ id: "default", ...values, updatedAt: now })
      .onConflictDoUpdate({
        target: integrationSettings.id,
        set: { ...values, updatedAt: now },
      });
    await tx.delete(pushSubscription);
  });

  await audit({
    action: "integration_settings.updated",
    actorEmail: admin.user.email,
    actorId: admin.user.id,
    description: "Generated new Web Push (VAPID) keys",
    entityId: "default",
    entityType: "integration_settings",
    metadata: { sections: ["webPush"], generated: true },
  });

  revalidatePath("/orbit/integrations");
  return { ok: true, publicKey: keys.publicKey, subject };
}
