-- Due dates become calendar days (no time, no timezone). Existing values are
-- instants that the date picker wrote as *local midnight* in the picker's
-- timezone, so the intended day is recovered by shifting +13h in UTC and taking
-- the date: it is exact for UTC offsets -10..+13 (e.g. 18:30Z -> IST midnight of
-- the next day, 08:00Z -> UTC-8 midnight of the same day). Import-written values
-- (UTC midnight) map to themselves.
-- Safety net for production: the original instants are kept in a side table
-- (not part of the app schema) so the conversion can be audited or reversed:
--   ALTER TABLE task ALTER COLUMN due_date_start TYPE timestamptz USING due_date_start::timestamptz, ...;
--   UPDATE task t SET due_date_start = b.due_date_start, due_date_end = b.due_date_end
--     FROM task_due_dates_backup_0037 b WHERE b.id = t.id;
-- Drop it once the release is verified (DROP TABLE task_due_dates_backup_0037).
CREATE TABLE IF NOT EXISTS "task_due_dates_backup_0037" AS SELECT "id", "due_date_start", "due_date_end" FROM "task" WHERE "due_date_start" IS NOT NULL OR "due_date_end" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "due_date_start" SET DATA TYPE date USING (("due_date_start" AT TIME ZONE 'UTC') + interval '13 hours')::date;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "due_date_end" SET DATA TYPE date USING (("due_date_end" AT TIME ZONE 'UTC') + interval '13 hours')::date;
