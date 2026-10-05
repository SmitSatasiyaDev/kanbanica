# Trash (Deleted Tasks)

Deleting a task moves it to the Trash instead of hard-deleting it. Owners and
Admins review, restore or permanently delete trashed tasks from
**Trash** in the bottom user menu (`/[workspaceId]/trash`; not part of Workspace Settings). The menu item and the page are Owner/Admin only.

## Data model
`task.deletedAt` (null = live), `task.deletedBy` (plain text user id, no FK),
`task.deletedWithParentId` (set on subtasks that were trashed *with* their
parent, so a restore brings back only those). Partial index
`task_deleted_at_idx (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL`.
Migration `0029_task_trash.sql` is additive; every existing task stays live.
`isArchived` is independent of the Trash.

## Delete flow
`deleteTask` / `bulkDeleteTasks` (`app/actions/task.ts`) still require space
`full_access`. They call `softDeleteTasks()` (`lib/trash.ts`) in one
transaction: set `deletedAt/deletedBy`, clear list-pin fields, trash the live
subtasks (`parentTaskId` has no FK). They write a `task_deleted` activity row,
send the existing `task_deleted` notification and revalidate. **Nothing is
removed**: comments, history, time entries, attachment rows and files stay.

## Visibility
`notDeleted()` (`lib/task-visibility.ts`) is AND-ed into every read of `task`
(list/board/calendar/sprint/my-tasks/search/overview/export/reminders/pins/
by-id loaders/attachments/comments/time/dependencies). **Any new query that
reads `task` must use it**, except the Trash itself, the workspace task-limit
count and hard-delete cascades (list/space/workspace delete).

## Task limit
Trashed tasks **keep counting** toward `workspace.maxTasks` until purged
(`getWorkspaceTaskUsage` is unchanged). Restore therefore needs no capacity
check and cannot race the limit. Permanently deleting from the Trash
frees capacity.

## Restore / permanent delete (`app/actions/trash.ts`, Owner/Admin only)
- `getDeletedTasks` — top-level trashed rows (subtasks shown as a count).
- `restoreDeletedTasks` — `restoreTasks()` clears the flags and restores the
  subtasks tagged with that parent. A subtask trashed on its own can't be
  restored while its parent is still trashed.
- `permanentlyDeleteTasks` / `emptyTrash` — `purgeTasks()` deletes storage
  files first (`deleteStorageForTasks`), then rows (FK cascade). Only rows with
  `deletedAt` set can be purged. Writes an `audit_logs` entry.
- **Automatic 30-day purge:** pg-boss job `trash.auto-purge` (daily 02:30, plus one catch-up run whenever the worker boots) permanently deletes every task with `deletedAt <= now − 30 days` (`TRASH_RETENTION_DAYS`, `lib/trash-retention.ts`) — `deletedAt` is the only clock. Handler: `lib/worker/handlers/trash-auto-purge.ts`. It is stateless (re-queries each run, so downtime is caught up without relying on pg-boss backfill), batched (100 ids per query, keyset by id, 10-minute budget per run) and one failing task never stops the rest. No user notification is sent; the record is an `audit_logs` entry `trash.auto_purged`.
- **One shared safe purge** (`purgeTrashedTask` / `purgeTasks` in `lib/trash.ts`) is used by the job, *Delete forever* and *Empty trash*. Per top-level task, one transaction: lock the row + its trashed subtasks `FOR UPDATE SKIP LOCKED` and re-check it is still trashed (and still past the cutoff for retention) → delete all attachment files from storage → delete the rows (FK cascade). A task restored, purged or locked by someone else meanwhile is skipped, so restore/manual/auto never race. If any file fails to delete (a missing file counts as done) the transaction rolls back: the task stays in the Trash with its metadata and is retried next run.
- Audit entries: `trash.auto_purged` (retention, no actor) and `trash.purged` (manual, with actor), each with workspace id, task id/title, deletedAt/deletedBy, reason and subtask ids. Task activity rows cascade away with the task, so `audit_logs` is the durable record.
- The Trash page shows "Purges in Nd" (whole days left) or "Pending purge" once a task is past 30 days but not yet processed.

## Deleting a list / project / workspace
Still a hard cascade — it also removes any trashed tasks inside (their rows
cascade away, so they cannot be restored). `deleteList` and `deleteSpace` now
delete attachment files first via `deleteStorageForTasks`. The admin
force-delete of a whole workspace (`app/api/admin/workspaces/[id]`) and the
`DELETING` workspace status still do **not** clean up storage (pre-existing).

## Not built
No undo toast on delete (restore is Owner/Admin-only, a task deleter with
space full access can't restore), no per-task "Restore" for space admins, no
restore-to-different-list, no retention setting UI (30 days is a constant).
