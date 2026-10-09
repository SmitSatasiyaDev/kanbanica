import { eq } from "drizzle-orm";
import { cache } from "react";
import { integrationSettings } from "@/db/schema/integration-settings";
import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * The single integration_settings row, or undefined if never written to (a
 * fresh install, or one that only ever used .env). Memoized per-request —
 * every getter below shares one query.
 */
const getRow = cache(async () => {
  const [row] = await db
    .select()
    .from(integrationSettings)
    .where(eq(integrationSettings.id, "default"))
    .limit(1);
  return row;
});

function nonEmpty(value: string | null | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

export interface SmtpSettings {
  from: string;
  host: string;
  pass: string;
  port: number;
  user: string;
}

/** DB value wins per field, env var is the fallback — see db/schema/integration-settings.ts. */
export async function getSmtpSettings(): Promise<SmtpSettings | null> {
  const row = await getRow();
  const host = nonEmpty(row?.smtpHost) ?? env.SMTP_HOST;
  const user = nonEmpty(row?.smtpUser) ?? env.SMTP_USER;
  const from = nonEmpty(row?.emailFrom) ?? env.EMAIL_FROM;
  const pass = row?.smtpPassEncrypted
    ? decryptSecret(row.smtpPassEncrypted)
    : env.SMTP_PASS;
  const port = row?.smtpPort ?? env.SMTP_PORT ?? 587;

  if (!(host && user && pass && from)) {
    return null;
  }
  return { host, port, user, pass, from };
}

export async function isSmtpConfigured(): Promise<boolean> {
  return (await getSmtpSettings()) !== null;
}

export interface GoogleOAuthSettings {
  clientId: string;
  clientSecret: string;
}

/**
 * Read once at process boot by lib/auth.ts (top-level await) — Better Auth
 * builds its social-providers config once when that module is first
 * evaluated, so changes here only take effect after an app restart. UI
 * "is Google configured" checks call this too, for consistency, even though
 * it's a fresh DB read each time — see docs/integrations.md.
 */
export async function getGoogleOAuthSettings(): Promise<GoogleOAuthSettings | null> {
  const row = await getRow();
  const clientId = nonEmpty(row?.googleClientId) ?? env.GOOGLE_CLIENT_ID;
  const clientSecret = row?.googleClientSecretEncrypted
    ? decryptSecret(row.googleClientSecretEncrypted)
    : env.GOOGLE_CLIENT_SECRET;

  if (!(clientId && clientSecret)) {
    return null;
  }
  return { clientId, clientSecret };
}

export async function isGoogleOAuthConfigured(): Promise<boolean> {
  return (await getGoogleOAuthSettings()) !== null;
}

export type StorageSettings =
  | { driver: "local" }
  | {
      driver: "s3" | "r2";
      bucket: string;
      endpoint: string | undefined;
      region: string | undefined;
      publicUrl: string | undefined;
      accessKeyId: string | undefined;
      secretAccessKey: string | undefined;
    };

/**
 * Resolves the storage driver + its credentials, DB value winning per field
 * over the matching env var. Used lazily by lib/storage.ts on every call
 * (not cached beyond the per-request memoization above) — a saved change
 * there rebuilds the underlying client on next use, no restart needed.
 */
export async function getStorageSettings(): Promise<StorageSettings> {
  const row = await getRow();
  const driver = (nonEmpty(row?.storageDriver) ??
    env.STORAGE_DRIVER) as StorageSettings["driver"];

  if (driver === "s3" || driver === "r2") {
    const bucket = nonEmpty(row?.storageBucket) ?? env.S3_BUCKET;
    return {
      driver,
      bucket,
      endpoint: nonEmpty(row?.storageEndpoint) ?? env.S3_ENDPOINT,
      region: nonEmpty(row?.storageRegion) ?? env.S3_REGION,
      publicUrl: nonEmpty(row?.storagePublicUrl) ?? env.S3_PUBLIC_URL,
      accessKeyId: nonEmpty(row?.storageAccessKeyId) ?? env.S3_ACCESS_KEY_ID,
      secretAccessKey: row?.storageSecretAccessKeyEncrypted
        ? decryptSecret(row.storageSecretAccessKeyEncrypted)
        : env.S3_SECRET_ACCESS_KEY,
    };
  }

  return { driver: "local" };
}

/**
 * True only for a fully usable s3/r2 config with *genuinely provided*
 * bucket + both keys — local disk doesn't need this check since it always
 * works with zero setup. Used to detect a section that's live via .env even
 * though the DB row (or the relevant DB fields) is empty.
 *
 * Deliberately bypasses getStorageSettings()'s resolved value: S3_BUCKET /
 * S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY all fall back to MinIO-shaped
 * local-dev defaults in lib/env.ts (`"kanbanica"` / `"minioadmin"` /
 * `"minioadmin"`) even when unset in .env, precisely so STORAGE_DRIVER=s3
 * "just works" against a local Docker Compose MinIO. Using the resolved
 * value here would make an admin's bare driver switch (no real credentials)
 * read as "Connected · Using .env" — so this checks the DB and the raw env
 * vars directly, ignoring those schema defaults.
 */
export async function isStorageConfiguredViaS3(): Promise<boolean> {
  const row = await getRow();
  const driver = nonEmpty(row?.storageDriver) ?? env.STORAGE_DRIVER;
  if (driver === "local") {
    return false;
  }

  const bucket =
    nonEmpty(row?.storageBucket) ?? nonEmpty(process.env.S3_BUCKET);
  const accessKeyId =
    nonEmpty(row?.storageAccessKeyId) ?? nonEmpty(process.env.S3_ACCESS_KEY_ID);
  const secretAccessKey = row?.storageSecretAccessKeyEncrypted
    ? decryptSecret(row.storageSecretAccessKeyEncrypted)
    : nonEmpty(process.env.S3_SECRET_ACCESS_KEY);

  return !!(bucket && accessKeyId && secretAccessKey);
}

export interface WebPushSettings {
  privateKey: string;
  publicKey: string;
  subject: string;
}

/** Resolved fresh before every send (lib/notifications/push.ts) and on every
 * fetch of the public key (app/api/push/vapid-public-key) — applies with no
 * restart either way. */
export async function getWebPushSettings(): Promise<WebPushSettings | null> {
  const row = await getRow();
  const publicKey = nonEmpty(row?.vapidPublicKey) ?? env.VAPID_PUBLIC_KEY;
  const subject = nonEmpty(row?.vapidSubject) ?? env.VAPID_SUBJECT;
  const privateKey = row?.vapidPrivateKeyEncrypted
    ? decryptSecret(row.vapidPrivateKeyEncrypted)
    : env.VAPID_PRIVATE_KEY;

  if (!(publicKey && subject && privateKey)) {
    return null;
  }
  return { publicKey, subject, privateKey };
}

export async function isWebPushConfigured(): Promise<boolean> {
  return (await getWebPushSettings()) !== null;
}

/**
 * Platform-wide master switch for notification email (instant + digest). Does
 * not cover auth/transactional mail. True when the row was never written.
 */
export async function areNotificationEmailsEnabled(): Promise<boolean> {
  const row = await getRow();
  return row?.notificationEmailsEnabled ?? true;
}

/** DB override (when set) wins; otherwise the `.env` flag. Pure, for testing. */
export function resolvePasswordSignup(
  dbValue: boolean | null | undefined,
  envValue: boolean
): boolean {
  return dbValue ?? envValue;
}

/**
 * Whether self-serve email + password registration is open. DB column (if
 * set) → `ALLOW_PASSWORD_SIGNUP` → closed. Resolved per call, no restart.
 */
export async function isPasswordSignupEnabled(): Promise<boolean> {
  const row = await getRow();
  return resolvePasswordSignup(
    row?.passwordSignupEnabled,
    env.ALLOW_PASSWORD_SIGNUP
  );
}

export interface IntegrationSettingsSummary {
  /** Effective value (DB override → `.env`), unlike the DB-only fields below —
   * the admin needs to see what is actually in force. */
  auth: { passwordSignupEnabled: boolean };
  google: { clientId: string; hasClientSecret: boolean };
  notifications: { emailsEnabled: boolean };
  smtp: {
    host: string;
    port: number;
    user: string;
    from: string;
    hasPassword: boolean;
  };
  storage: {
    driver: "local" | "s3" | "r2";
    endpoint: string;
    region: string;
    bucket: string;
    publicUrl: string;
    accessKeyId: string;
    hasSecretAccessKey: boolean;
  };
  webPush: { publicKey: string; subject: string; hasPrivateKey: boolean };
}

/**
 * DB-only view (no env fallback) of every field editable from
 * Settings → Integrations — used to prefill that page's forms (and the setup
 * wizard's, which always gets the empty-row shape since nothing's been saved
 * yet at that point). Deliberately DB-only, not the resolved DB+env value:
 * this is what the admin *typed and saved*, not what's currently in effect,
 * so an env-var-configured field correctly shows blank/unset here rather
 * than leaking the env value into a form that would then treat it as
 * DB-authoritative on next save. Secrets are represented as
 * `has<Field>: boolean` only — never sent to the browser in plaintext.
 */
export async function getIntegrationSettingsSummary(): Promise<IntegrationSettingsSummary> {
  const row = await getRow();
  return {
    auth: {
      passwordSignupEnabled: resolvePasswordSignup(
        row?.passwordSignupEnabled,
        env.ALLOW_PASSWORD_SIGNUP
      ),
    },
    notifications: { emailsEnabled: row?.notificationEmailsEnabled ?? true },
    smtp: {
      host: row?.smtpHost ?? "",
      port: row?.smtpPort ?? 587,
      user: row?.smtpUser ?? "",
      from: row?.emailFrom ?? "",
      hasPassword: !!row?.smtpPassEncrypted,
    },
    google: {
      clientId: row?.googleClientId ?? "",
      hasClientSecret: !!row?.googleClientSecretEncrypted,
    },
    storage: {
      driver: (row?.storageDriver as "local" | "s3" | "r2" | null) ?? "local",
      endpoint: row?.storageEndpoint ?? "",
      region: row?.storageRegion ?? "",
      bucket: row?.storageBucket ?? "",
      publicUrl: row?.storagePublicUrl ?? "",
      accessKeyId: row?.storageAccessKeyId ?? "",
      hasSecretAccessKey: !!row?.storageSecretAccessKeyEncrypted,
    },
    webPush: {
      publicKey: row?.vapidPublicKey ?? "",
      subject: row?.vapidSubject ?? "",
      hasPrivateKey: !!row?.vapidPrivateKeyEncrypted,
    },
  };
}
