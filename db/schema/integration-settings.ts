import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Admin-configurable alternative to the optional env vars in lib/env.ts
// (SMTP, Google OAuth, S3/R2 storage, Web Push) — set from the setup wizard
// or Settings → Integrations instead of editing .env. Single row (id
// "default"). Every field here is a fallback source: lib/integration-settings.ts
// prefers a non-null DB value and falls back to the matching env var per
// field, so existing .env-only deployments are unaffected. `*Encrypted`
// columns are AES-256-GCM ciphertext (lib/crypto.ts, key derived from
// APP_SECRET) — never sent to the browser in plaintext (see
// app/actions/integrations.ts).
export const integrationSettings = pgTable("integration_settings", {
  id: text("id").primaryKey().default("default"),

  // SMTP
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPassEncrypted: text("smtp_pass_encrypted"),
  emailFrom: text("email_from"),

  // Google OAuth — read once at process boot (lib/auth.ts, top-level await);
  // changes need a restart. See docs/integrations.md.
  googleClientId: text("google_client_id"),
  googleClientSecretEncrypted: text("google_client_secret_encrypted"),

  // File storage — driver switch + credentials. "s3" and "r2" share one
  // files-sdk adapter in this app (see lib/storage.ts), so unlike a
  // split-per-provider schema they share one set of fields.
  storageDriver: text("storage_driver"), // "local" | "s3" | "r2"
  storageEndpoint: text("storage_endpoint"),
  storageRegion: text("storage_region"),
  storageBucket: text("storage_bucket"),
  storagePublicUrl: text("storage_public_url"),
  storageAccessKeyId: text("storage_access_key_id"),
  storageSecretAccessKeyEncrypted: text("storage_secret_access_key_encrypted"),

  // Web Push (VAPID) — resolved fresh per send, applies with no restart.
  vapidPublicKey: text("vapid_public_key"),
  vapidSubject: text("vapid_subject"),
  vapidPrivateKeyEncrypted: text("vapid_private_key_encrypted"),

  // Platform-wide master switch for *notification* email (instant + digest).
  // Auth/transactional mail (magic link, invites, …) is never affected. No env
  // fallback — default on, so existing deployments behave as before.
  notificationEmailsEnabled: boolean("notification_emails_enabled")
    .notNull()
    .default(true),

  // Self-serve email + password sign-UP (/signup). Nullable on purpose:
  // null = never set from the app, so `.env` ALLOW_PASSWORD_SIGNUP decides (and
  // an `.env`-only deployment behaves exactly as before). true/false overrides it.
  // Resolved per request — applies with no restart. Sign-IN is never affected.
  passwordSignupEnabled: boolean("password_signup_enabled"),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
