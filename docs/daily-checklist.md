# Checklist

A lightweight "what do I need to check off today?" list. It is deliberately **not** a
second task system: no projects, lists, subtasks, comments, attachments or sprints.
Sidebar: **Checklist** (below My Tasks) → `/[workspaceId]/daily-checklist`, with
**My Checklist** and **Team Checklist** tabs. Owner/Admin management lives at
`/[workspaceId]/daily-checklist/admin` (bottom user menu → *Checklist admin*, next to
Trash; not in Workspace Settings).

## Data model (migration `0030_daily_checklist.sql`, additive)
`Template → Day → Item`. Tables are prefixed `daily_checklist_*` because `checklist` /
`checklist_item` already hold per-task subtask checklists.

- `daily_checklist_template` — name, description, `recurrence` (`DAILY|WEEKDAYS|WEEKLY|CUSTOM`),
  `recurrenceDays` (0=Sun…6=Sat), `isActive`, `isArchived` (soft delete), `startDate`, `endDate`.
- `daily_checklist_template_item` — title, description, priority, `dueTime` ("HH:MM"), `sortOrder`.
- `daily_checklist_template_assignment` — unique `(templateId, userId)`.
- `daily_checklist_day` — one user's checklist for one calendar `date` (Postgres `date`,
  the owner's **local** date) and `type` `PERSONAL|TEAM`. Duplicate-proof via two partial
  unique indexes (personal: workspace+user+date; team: workspace+user+template+date).
- `daily_checklist_item` — the day's actual items: status `PENDING|IN_PROGRESS|DONE`,
  priority, due time, notes, `completedAt/By`, `sortOrder`, nullable `templateItemId`.

## Snapshot & history
Generating a TEAM day **copies** the template's items into `daily_checklist_item`. Editing a
template (rename an item, add/remove/reorder, change assignees, disable, delete) only changes
template tables — saved days are never rewritten and history is always read from saved days,
never reconstructed from the current template. Items are never reconstructed or back-filled
for past dates.

**Only today is editable.** Any past day is read-only (UI *and* server: every mutation checks
`day.date === today` in the owner's timezone). There is no correction path in V1.

## Generation (idempotent, concurrency-safe)
- **Personal:** created lazily on first access of today (`ensurePersonalDay`). The worker is
  never involved, so a worker outage cannot make it unavailable.
- **Team:** `ensureTeamDays()` (`lib/daily-checklist/ensure.ts`) runs for the **viewer only**
  when they open Team Checklist, so their own today's instances exist even if the worker hasn't
  run. Opening Team Checklist or admin *Today's Checklists* never sweeps other assignees (those
  views just read). The pg-boss job `daily-checklist.generate`
  (`lib/worker/handlers/daily-checklist-generate.ts`, cron `0 * * * *` — hourly — + once on
  worker boot) is the background safety net that pre-generates everyone's. All paths use the
  same function; `INSERT … ON CONFLICT DO NOTHING`
  on the day's unique index makes racing requests/workers create exactly one day.
- **Newly added assignees:** when an admin creates a template or adds assignees
  (`createChecklistTemplate` / `updateChecklistTemplate` / `updateTemplateAssignments`), the
  action calls `ensureTeamDays()` right after the save commits for **only the newly added
  users**, using each user's own local date — so they get today's checklist immediately, with
  the *current* template snapshot. Existing users' days are never touched (a same-day edit means
  existing users keep their older snapshot). Removing an assignee keeps their already-generated
  days; only future generation stops. A generation failure never fails the save (worker /
  page-open catch up).
- Only *today* is ever generated (never future days). Disabled, archived, out-of-range or
  non-matching-recurrence templates are skipped; only ACTIVE non-guest members get instances.

## Recurrence
`lib/daily-checklist/recurrence.ts` `occursOn(rule, date)` — pure calendar math: Every day,
Every weekday (Mon–Fri), Every week (one chosen weekday, default = start date's), Custom weekly
days; `startDate`/`endDate` are inclusive.

## Timezone
A user's checklist timezone is resolved by one helper, `getEffectiveTimezone(user, workspace)`
(`lib/timezone.ts`): **`user.timezone` → `workspace.timezone` → `UTC`** (both columns are nullable
IANA names; invalid values are skipped). The DB-backed form is `getUserTimezone(executor, userId,
workspaceId)` (`lib/daily-checklist/ensure.ts`), and `userToday(executor, userId, workspaceId)`
(`queries.ts`) = `todayInTz(now, effectiveTz)` is the source of truth for "today" in the page/actions,
on-demand generation, admin views and the worker (which resolves per user *and* workspace). It is
**independent of the notification digest timezone**.

- Set in Profile Settings → Timezone (`updateUserTimezone`) and Workspace Settings → General
  (`updateWorkspace`). First visit to the checklist with no user timezone saves the browser's IANA
  zone once (`initUserTimezone`, writes only while NULL — never overwrites a choice).
- Recurrence and start/end dates compare against the user's *local* date. Past days keep their stored
  date; changing a timezone never rewrites or moves them, and the unique day indexes prevent duplicates.
- `dueTime` is interpreted in the assignee's effective timezone.

## Permissions (all checked server-side — `lib/daily-checklist/access.ts`)
| | Personal | Team (view/complete own) | Templates, assignments, all-team views |
|---|---|---|---|
| Owner / Admin | own only | yes | yes |
| Member | own only | yes (assigned rows; other rows read-only) | no |
| Guest | own only | **no** | no |

Personal checklists are visible only to their owner (not even admins). Entity ids (day, item,
template) from the client are always re-resolved against the DB; `workspaceId` is only used to
look up the caller's own membership. Members may change only `status`/`notes` of items on their
own team days; title/priority/due time are the day's snapshot.

## Actions
`app/actions/daily-checklist.ts` (personal + member team + day detail) and
`app/actions/daily-checklist-admin.ts` (templates, items, assignments, today's instances, team
history). Every mutation calls `refreshWorkspace()`. History is paginated by date cursor
(30 per page); per-day counts are aggregated in SQL (no N+1).

## Custom fields (Team templates)
Owners/Admins define per-template fields (migration `0031_daily_checklist_fields.sql`, additive):
`daily_checklist_field` (name, type `TEXT|DROPDOWN|NUMBER|DATE|CHECKBOX`, required, order),
`daily_checklist_field_option` (dropdown `label`/`value`), `daily_checklist_item_field_value`
(one row per item × field, unique `(itemId, fieldId)`). The field list is edited inside the
template form page (`/daily-checklist/admin/templates/new` and `/[templateId]/edit`) (**Custom fields**, after Checklist items) and saved with the template; the
standalone actions `createTemplateField` / `updateTemplateField` / `deleteTemplateField` /
`reorderTemplateFields` are the same operations. A field's type can't change after creation.
Nothing is hardcoded (no Subscription/Ticket fields); external data (e.g. Stripe) can later
write a *value* but is out of scope.

- **Snapshot:** generating a day copies each field's name, type, required flag and dropdown
  options onto that item's value row (`field_name`, `field_type`, `field_required`,
  `field_options`). Editing or deleting a definition (rename, new options, new field, delete)
  only affects future days; saved days render from their own snapshot (`fieldId` becomes null if
  the definition is deleted).
- **Values:** stored canonically as text (number `19.9`, date `YYYY-MM-DD`, checkbox
  `true`/`false`, dropdown = option `value`). `setChecklistItemFieldValues` validates against
  the *snapshot* (`lib/daily-checklist/fields.ts`), is limited to the caller's own Team item
  for today, and cannot change definitions. A required field must be filled (checkbox checked)
  before the item can be set to Done.
- **UI:** the Team list stays compact; custom fields open from the row's **Details** button
  (editable for the assignee on today, read-only otherwise and in History).

## Tests
Pure: `lib/daily-checklist/*.test.ts` (incl. `fields.test.ts`), `lib/local-date.test.ts`, migration test. Real-DB
integration (`app/actions/daily-checklist*.integration.test.ts`) runs only when
`CHECKLIST_TEST_DATABASE_URL` points at a migrated scratch database — see the file header.
