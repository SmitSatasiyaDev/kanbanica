ALTER TABLE "user" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
UPDATE "user" u SET "timezone" = p."digest_timezone" FROM "user_email_preference" p WHERE p."user_id" = u."id" AND p."digest_timezone" <> 'UTC';
