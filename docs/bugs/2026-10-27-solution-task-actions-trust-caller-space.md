# Solution: task actions derive the location from the task row

**What changed**

- New `lib/services/task-context.ts`:
  - `resolveTaskContext(taskId)` reads the task, LEFT joins its list (Sprint
    tasks have none), INNER joins the workspace and applies `notDeleted()`.
    `spaceId` is the list's space, else `task.spaceId` (same rule as
    `getTaskLocation`); a legacy subtask with neither takes its parent's space.
    It returns `null` when the task is missing, trashed, has no space, or its
    workspace is not `ACTIVE`.
  - `resolveCommentContext(commentId)` resolves the comment's task and adds
    `commentId`, `authorId`, `parentCommentId`, `isDeleted`.
  - `taskRevalidatePaths(ctx)` (list page, or project + workspace home for a
    listless task) and `effectiveTaskSpaceId` (SQL `coalesce(list.space_id,
    task.space_id)`) for queries that scope tasks to a space.
- Every action listed in the bug now resolves the context first, **ignores** the
  caller's `workspaceId` / `spaceId` / `listId`, and uses the derived values for
  the permission check, notifications, activity log and `refreshWorkspace`
  (always called with `{ taskId }`, also for listless tasks). Signatures are
  unchanged, so no UI caller changed for this. A mismatch is never rejected
  (stale panels keep working); the real location is used. When the context is
  `null` the action returns "Task not found" ("Comment not found" /
  "Time entry not found" for comment- and entry-keyed actions).
- Comment- and entry-keyed actions go comment/entry -> task -> context.
  `deleteComment` therefore checks full access on the comment's own space.
- `createComment` returns "Parent comment not found" when `parentCommentId` is
  not a comment on the same task.
- `updateTaskStatus` also validates the target status (see the
  view-only-status solution) and only logs/notifies when a row was updated and
  the status changed.
- `duplicateTask` and `createSubtask` load the source/parent row first (list
  space via a LEFT join) and check permission on that space. They keep their
  existing "task belongs to the caller's workspace" check.
- `bulkAssignTasks`, `bulkUpdateStatus` and `bulkMoveTasks` scope tasks with
  `effectiveTaskSpaceId`. `bulkMoveTasks` now only moves tasks that live in the
  space the caller was authorised against.

**Files:** `lib/services/task-context.ts`, `app/actions/task.ts`,
`app/actions/comment.ts`, `app/actions/task-assignee.ts`,
`app/actions/time-tracking.ts`.

**Tests:** `lib/services/task-context.test.ts`, `app/actions/task-scope.test.ts`
(cross-project refusal for status, detail, update, comment, assignee, timer,
comment delete and time entry delete; stale `listId`; listless task; parent
comment from another task; move target cross-workspace / no edit / archived /
valid cross-project move; watcher rules). `app/actions/task-limit-enforcement.test.ts` gained
a `spaceId` on its parent-task fixture because `createSubtask` now needs the
parent's space.

- **Move target:** `moveTask` and `bulkMoveTasks` validate `targetListId` with a
  shared `resolveMoveTarget()`: the list must exist, not be archived, sit in a
  non-archived project of the task's workspace ("List not found" otherwise), and
  the user needs Edit on the target project as well as the source. A move also
  sets `task.space_id` to the target list's project. Both actions already
  refresh the whole workspace, which covers the source and target pages.
- **Watchers:** watching yourself stays at View. Adding someone else needs Edit
  on the task's space and the target must pass `canAccessSpace` ("User cannot
  access this task"). Removing someone else needs Edit only, so a watcher who
  lost access can still be cleaned up. `toggleWatcher` only ever acts on the
  caller.
- **`getTaskDetail`** returns "Task not found" for no access too (no caller
  branches on the old "Forbidden").
- **`bulkDeleteTasks` / `bulkArchiveTasks`** scope with `effectiveTaskSpaceId`.
- The task panel priority Select is disabled without `canEdit`, like status.
