-- Sprint start/end become calendar days (no time, no timezone), like task due
-- dates (0037). Values written from the date picker are local midnight in an
-- unknown timezone (UTC time-of-day is a quarter-hour multiple with 0 seconds):
-- recovered with +13h in UTC, exact for UTC offsets -10..+13. Values written by
-- "Start sprint" were a real instant (arbitrary time-of-day), for which the UTC
-- date is used.
-- Original instants are kept in a side table (same safety net as 0037); drop
-- sprint_dates_backup_0038 once the release is verified.
CREATE TABLE IF NOT EXISTS "sprint_dates_backup_0038" AS SELECT "id", "start_date", "end_date" FROM "sprint" WHERE "start_date" IS NOT NULL OR "end_date" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "sprint" ALTER COLUMN "start_date" SET DATA TYPE date USING (CASE WHEN "start_date" IS NULL THEN NULL WHEN extract(second from "start_date" AT TIME ZONE 'UTC') = 0 AND extract(minute from "start_date" AT TIME ZONE 'UTC')::int % 15 = 0 THEN (("start_date" AT TIME ZONE 'UTC') + interval '13 hours')::date ELSE ("start_date" AT TIME ZONE 'UTC')::date END);--> statement-breakpoint
ALTER TABLE "sprint" ALTER COLUMN "end_date" SET DATA TYPE date USING (CASE WHEN "end_date" IS NULL THEN NULL WHEN extract(second from "end_date" AT TIME ZONE 'UTC') = 0 AND extract(minute from "end_date" AT TIME ZONE 'UTC')::int % 15 = 0 THEN (("end_date" AT TIME ZONE 'UTC') + interval '13 hours')::date ELSE ("end_date" AT TIME ZONE 'UTC')::date END);
