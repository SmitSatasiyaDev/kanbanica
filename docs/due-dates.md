# Due Dates & Timezones

## Model

- A task's `dueDateStart` / `dueDateEnd` are **calendar days** — Postgres `date`
  columns, `YYYY-MM-DD` strings in app code (`db/schema/task.ts`). They have no
  time and no timezone, so they can't drift when a user, a server or a
  database in another zone reads them.
- "Today" is the only timezone-dependent value. It is derived from the viewer's
  IANA timezone, stored on `user.timezone` (default `UTC`, migration `0036`).
- **Overdue = `dueDay < today`.** A task due today is never overdue; it becomes
  overdue when the *viewer's* day rolls over.
- The Due Date column / deadline is `dueDateEnd`; where only the start is set,
  surfaces fall back to `dueDateStart`.

## One place for the logic

`lib/due-date.ts` (pure, client-safe): `todayInTz`, `dueStatus`, `weekRange`,
`daysBetween`, `dateToDay` (picker `Date` → day), `dateStrToLocalDate` (day →
local-midnight `Date` for react-day-picker), `formatDay`, `watchToday`.
Never use `new Date("YYYY-MM-DD")` (that is UTC midnight and lands on the
previous day west of UTC) or raw `isToday` / `isPast` / `startOfDay` on a due
date.

- **Server:** `getUserTimezone(userId)` / `getUserToday(userId)`
  (`lib/user-timezone.ts`, request-cached). Pass `today` into
  `buildTaskFilterConditions(filters, today)`.
- **Client:** `useToday()` / `useTimezone()` (`components/common/timezone-provider.tsx`,
  provided by the workspace layout). `useToday()` re-ticks at the user's
  midnight and when a hidden tab becomes visible.

## Timezone setting

- Profile → Timezone (`components/profile/timezone-settings-form.tsx`,
  `updateTimezone` in `app/actions/profile.ts`, validated against the runtime's
  IANA list).
- Auto-detect: while `user.timezone` is still the default `UTC`, the first page
  load in a browser adopts `Intl.DateTimeFormat().resolvedOptions().timeZone`
  once (guarded by a `localStorage` flag so a deliberate "UTC" isn't overridden).
- The daily digest now reads `user.timezone`. `user_email_preference.digest_timezone`
  is deprecated (kept, not read); `0036` copied non-UTC values across.

## Write paths

`createTask` / `updateTask` accept `string | null` days and reject anything that
isn't a real `YYYY-MM-DD` (`isOptionalDay`). Pickers convert with `dateToDay`.
CSV: export writes `YYYY-MM-DD`; import accepts `YYYY-MM-DD` (and the date part
of an ISO timestamp) — see `docs/import-export.md`.

## Migration `0037` (task due dates, timestamptz → date)

Old values were instants written as *local midnight in the picker's timezone*,
which was never recorded. The migration recovers the intended day with
`((col AT TIME ZONE 'UTC') + interval '13 hours')::date` — exact for UTC offsets
−10…+13, independent of the session timezone, and identity for UTC-midnight
(imported/UTC-created) values. Offsets −11/−12 and +14 are off by one day
(American Samoa, Baker Island, Kiribati line islands).

Before running on a real database:

```sql
-- how the stored instants are distributed (UTC hour of day)
select extract(hour from due_date_end at time zone 'UTC')::int h, count(*)
from task where due_date_end is not null group by 1 order by 2 desc;
```

Hours 10–12 UTC are the only ambiguous ones (UTC−10…−12 vs +14…+12), so
inspect any rows there; every other hour maps unambiguously. Take a backup first — the column type
change is not reversible without the original timezone.

## Sprints

`sprint.start_date` / `end_date` are `date` columns too (migration `0038`),
`YYYY-MM-DD` strings everywhere.

- Creating a sprint takes a `YYYY-MM-DD` start and derives `end = start + weeks*7`
  with `addDays` (string math). Starting a sprint sets `startDate` to the
  starter's **today** (`getUserToday`).
- Days remaining = `daysBetween(today, endDate)` with the viewer's `useToday()`
  (sprint panel) / `getUserTimezone()` (workspace overview).
- **Auto-close** (`lib/worker/handlers/sprint-auto-close.ts`) is platform-wide and
  a project's members span timezones, so it closes a sprint only once its end
  day is over *everywhere*: `endDate < todayInTz("Etc/GMT+12")` (the calendar day
  starts last in UTC-12). The next auto-created sprint starts the day after the
  old end date (`lib/sprint/rollover.ts`), or UTC-today when there is none.
- Migration `0038`: picker values (UTC time-of-day is a quarter-hour multiple with
  0 seconds) use the same `+13h` recovery as tasks; "Start sprint" values were
  real instants and use their UTC date.

## Reminders

`lib/worker/handlers/due-date-reminder.ts` runs hourly for the whole platform. Each
run groups users by `user.timezone`; per zone it finds open, live tasks whose
`dueDateEnd` is tomorrow / today / yesterday **in that zone** and notifies the
assignees and watchers who live there (`due_date_reminder_1day`,
`due_date_today`, `task_overdue`). A reminder therefore goes out in the first
hourly run after the recipient's local midnight, and is deduped **per
recipient** against notifications created since that local midnight
(`startOfDayInTz`). Invalid stored zones count as UTC.

## Deploying to production (existing data)

Nothing is deleted or reformatted by hand: migrations `0036`–`0038` run through
`pnpm db:migrate:prod` / the compose `migrate` service as usual.

- **No data loss, reversible:** `0037` and `0038` first copy the original
  instants into side tables (`task_due_dates_backup_0037`,
  `sprint_dates_backup_0038`, outside the app schema), then convert. Keep them
  for a release; `DROP TABLE` them once verified. To roll back, change the
  columns back to `timestamptz` and `UPDATE` from the backup tables.
- **Before deploying:** take a database backup, and run the UTC-hour query from
  the migration section on production to see the spread of stored times.
- **Rollout order:** run the migration, then start the new app. Old app
  instances that are still serving requests while the columns change type will
  error on due-date reads/writes, so avoid a rolling deploy with old and new code
  side by side (or accept a brief maintenance window). The `ALTER … TYPE`
  rewrites the `task` table under a short exclusive lock — fast for normal sizes.
- **Users:** every account starts on `UTC` and adopts its browser timezone on the
  first page load after deploy (one `router.refresh()`), then can change it in
  Profile → Timezone. Existing digest timezones were copied across by `0036`.
- **Reminders:** the first hourly run after deploy dedupes against each
  recipient's local midnight, so someone may receive one extra reminder that
  day for a notification sent under the old UTC-day rule.
- **Dev databases that used `db:push`:** if `db:migrate` fails with "column …
  already exists", the migration history is behind the schema — insert the
  missing rows into `drizzle.__drizzle_migrations` (hash = sha256 of the `.sql`,
  `created_at` = the journal's `when`) rather than re-running them.

## Known limits / follow-ups

- The cached workspace-overview payload (60 s) is built per `(workspace, user)`
  and so is correct for that viewer's timezone, but the
  `workspace_overview_snapshot` day key uses whichever viewer wrote it.
- Custom DATE fields were already stored as strings and are unchanged.
- Time entries (`time_entry`), `createdAt` / `updatedAt` and activity-log
  timestamps are genuine instants and stay `timestamptz`.
