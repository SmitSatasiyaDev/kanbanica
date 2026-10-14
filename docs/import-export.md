# Task Import & Export

CSV export and import for tasks, built on top of the existing task-creation,
permission, and custom-field logic — no parallel task system.

## What's supported

**Export** (CSV download):
- Current list (List/Board toolbar)
- Selected tasks (List view's bulk action bar, once tasks are checked)
- Whole project — every non-archived task across all of a project's lists (Project Settings → General → Export)

**Import** (CSV upload, into a specific list):
- Upload → Map columns → Validate → Preview → Confirm → Result
- List/Board toolbar → "Import Tasks" (requires Edit access or higher)

Only data the current user is authorized to see is exported, and import
requires the same Edit-level permission `createTask` itself requires
(`requireEditAccess` — see `lib/permissions.ts`). Guests and view-only members
cannot import; export only returns tasks in spaces/lists the user can already
access.

## Limits (MVP)

- **200 rows** per file (excluding the header)
- **2 MB** file size

These are enforced both client-side (immediate feedback) and server-side
(hard reject). The app already has a background job system (`lib/worker/`,
pg-boss) — raising this limit later means adding a `CSV_IMPORT` job that calls
the same `bulkImportTasks()` function (`lib/import-export/bulk-import-tasks.ts`),
not a rewrite.

## Workspace task limit

If the workspace has a task limit (`workspace.maxTasks`, Settings → Limits;
`null` = unlimited), imports are subject to it. Every task row in the
workspace counts — active, completed, **archived** and subtasks.

- **Validate** (`/import/validate`) returns an informational
  `capacity: { limit, used, remaining }` (`limit`/`remaining` are `null` when
  unlimited). It never blocks validation.
- **Preview** shows remaining capacity. If the number of selected rows exceeds
  it, a warning appears and the Import button is disabled (relabelled
  "Only N fit") until enough rows are unchecked.
- **Confirm** (`/import/confirm`) is authoritative: `bulkImportTasks()` calls
  `requireTaskCapacity()` inside the insert transaction (workspace row locked),
  for the number of rows that survive row-level validation. The check is
  **all-or-nothing** — if the batch doesn't fit, nothing is inserted and the
  route returns **HTTP 409** (not 403) with the limit message.
- Row-level validation failures (invalid rows) are still reported per row and
  don't consume capacity.

## CSV format

- UTF-8, comma-separated, standard RFC4180 quoting (quote a value containing
  a comma, quote, or newline; double a literal quote inside a quoted value).
- First row is the header row. "Row N" in validation messages refers to the
  Nth **data** row (the header doesn't count).
- Fully blank rows are skipped silently (not counted as valid or invalid).

### Exported columns

| Column | Notes |
|---|---|
| Task ID | `#<seqNumber>`, e.g. `#142` |
| Title | |
| Description | Plain text (Tiptap JSON flattened to one line per paragraph) |
| Status | The list's status name |
| Priority | `NONE` / `LOW` / `MEDIUM` / `HIGH` / `URGENT` |
| Assignees | `Name <email>`, multiple separated by `; ` |
| Start Date | `YYYY-MM-DD` (a calendar day, no time or timezone) |
| Due Date | `YYYY-MM-DD` (a calendar day, no time or timezone) |
| Tags | Names, separated by `; ` |
| Project | The space's name |
| List | |
| Parent Task | `#<seqNumber>` of the parent, if any |
| *(one column per applicable custom field)* | Select/Multi-select export as label(s), Person as name, Checkbox as `true`/`false` |
| Created At | ISO 8601 |
| Updated At | ISO 8601 |

A whole-project export (no single list) only includes **space-scoped and
workspace-wide** custom fields — list-specific fields are omitted since tasks
span multiple lists with different field sets.

## Column mapping

Importable fields: Title (**required**), Description, Status, Priority,
Assignee(s), Due Date (Start), Due Date (End), Tags, Parent Task, plus one
entry per custom field that applies to the target list.

Common header names are auto-detected (case-insensitive, tolerant of `_`/`-`):

| CSV Column (examples) | Kanbanica Field |
|---|---|
| Title, Task, Task Name, Task Title, Name | Title |
| Description, Details, Notes | Description |
| Status, State | Status |
| Priority | Priority |
| Assignee, Assignees, Assigned To, Owner | Assignee(s) |
| Due Date, Due, Deadline | Due Date (End) |
| Start Date, Start | Due Date (Start) |
| Tags, Labels | Tags |
| Parent, Parent Task, Parent Id | Parent Task |
| *(exact custom field name)* | that custom field |

Deliberately **not** auto-detected for Title, even though they're common
spreadsheet headers: `Job Title`, `Position`, `Role`, `Designation`,
`Employee Title`, `Summary`, `Subject` — these read as person/role or
free-text fields, not a task's name, so guessing wrong here would silently
mis-map data. Map them manually if you actually want one as the title.

Detection is a convenience — every column's target can be changed in the
mapping step, and a column can be left as "Do not import" to ignore it.

## Validation rules

Every row is validated before anything is shown in the preview, and
re-validated against fresh data when you confirm the import (statuses,
members, tags, and custom fields can change between the two steps):

- **Title** is required.
- **Status**: must match an existing status name in the target list
  (case-insensitive). Blank defaults to the list's first "Open" status (or
  its first status if none is marked Open) — this is a warning, not an error.
- **Priority**: must be `NONE`/`LOW`/`MEDIUM`/`HIGH`/`URGENT` (case-insensitive)
  or blank (defaults to `NONE`).
- **Dates**: must be a real calendar day written `YYYY-MM-DD` (a full ISO
  timestamp from an older export is accepted — its date part is used);
  anything else (`01/31/2030`, `2030-02-30`) is an error. A due date before
  the start date is a warning, not an error. See `docs/due-dates.md`.
- **Assignee(s)**: each name/value must match an active workspace member's
  email (case-insensitive). An unresolved one is an error:
  `Assignee "John Doe" was not found`.
- **Tags**: existing tag names (case-insensitive) are reused; unrecognized
  names are **not** an error — they'll be created, with a warning saying so.
- **Parent Task**: resolved by `#<seqNumber>` or exact title against either
  an existing task in the target list or another row in the same file.
  Kanbanica only supports one level of subtasks — referencing a task that is
  itself a subtask is an error (`Cannot nest subtasks more than one level`),
  as is a parent row that itself fails to import.
- **Custom fields**: validated per the field's type (the same validator real
  task edits use) — numbers respect configured min/max, checkboxes accept
  `true/false/yes/no/1/0`, Select options are matched by label, Person fields
  by member email. A required custom field with no value on a row is an
  error; a required field not mapped to any column at all is flagged once,
  up front, instead of on every row.
- **Duplicates**: rows with the same title, status, assignees, and due date
  are flagged as a possible duplicate — a warning, so you decide whether to
  keep them.
- **Empty rows** are skipped, not flagged as invalid.

## Preview and confirmation

The preview shows a summary (`142 ready · 7 need attention · 2 invalid`) and
a per-row table of errors/warnings. Rows with errors are locked out of the
import; rows with only warnings are included by default but can be
unchecked. Nothing is written to the database until you click **Import N
Tasks**.

## What happens on import

Confirmed rows are created as real Kanbanica tasks — same statuses,
priorities, assignees (watched automatically, same as manual creation), tags
(created if new), custom field values, and one-level parent/subtask links as
any other task. Each creates the same `task_created` activity log entry and
the same assignee/space notifications a manually-created task would.

Rows are re-validated immediately before insert; a row that fails this final
check (e.g. an assignee left the workspace between preview and confirm) is
reported as a failure without blocking the rest of the batch. The result
screen always shows how many tasks were created and lists every failed row
with its reason — never a bare "Import failed".

## Common errors

| Message | Cause |
|---|---|
| `Title is required` | The mapped Title column is blank for this row |
| `Status "X" was not found. Valid statuses: ...` | No status named X exists in the target list |
| `Priority "X" is invalid. Valid values: ...` | X isn't one of the five priority levels |
| `Assignee "X" was not found` | No active workspace member has that email |
| `Parent task "X" was not found` | No task with that title/`#seq` exists in this list or file |
| `Cannot nest subtasks more than one level` | The referenced parent is itself a subtask |
| `<Field>: "X" is not a valid option` | The value doesn't match any Select option's label |
| `Workspace task limit reached (N). …` (HTTP 409) | The surviving rows don't fit in the workspace's remaining task capacity; nothing was imported |
| `This file has X rows — imports are limited to 200 rows per file` | File exceeds the MVP row limit |

## Key files

- `lib/import-export/csv.ts` — CSV parse/generate (papaparse)
- `lib/import-export/column-mapping.ts` — field list + header auto-detection
- `lib/import-export/validate-row.ts` — per-row validation (pure, reused by preview and confirm)
- `lib/import-export/bulk-import-tasks.ts` — bulk task creation (reuses `validateCustomFieldValue`, the same permission guards, and `createTask`'s business rules, batched for efficiency)
- `lib/workspace-limits.ts` — `requireTaskCapacity()` (the task-limit gate) and `getWorkspaceCapacity()`
- `lib/import-export/export-tasks.ts` — authorized task export query
- `app/api/lists/[listId]/export/route.ts`, `app/api/spaces/[spaceId]/export/route.ts` — CSV downloads
- `app/api/lists/[listId]/import/validate/route.ts`, `.../import/confirm/route.ts` — import pipeline
- `components/import-export/` — Export buttons + the Import wizard dialog

## Limitations / future work

- Import targets a single List (statuses are per-list); there's no
  whole-project import.
- A row that fails the final pre-insert re-check is reported as a failure
  without rolling back the rest of the batch; an unexpected database error
  during the bulk insert itself would still fail the whole batch (rare, since
  every row is validated twice beforehand).
- Sprint view has no Import/Export entry point in this pass.
