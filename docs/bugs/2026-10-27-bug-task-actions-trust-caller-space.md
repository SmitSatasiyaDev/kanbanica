# Bug: task actions trust the caller's workspace / project / list

**Symptom:** A user with access to project A could read or change a task that
lives in project B (same workspace, or any workspace the ids pointed to) by
calling a server action with project A's ids and project B's task id.

**Where:** Server actions that take a `taskId` (or `commentId`) together with a
caller-supplied `workspaceId` / `spaceId` / `listId`:

- `app/actions/task.ts`: `getTaskDetail`, `updateTask`, `updateTaskStatus`,
  `deleteTask`, `archiveTask`, `unarchiveTask`, `moveTask` (source side),
  `getTaskActivity`, `getSubtasks`, `createSubtask`, `duplicateTask`
- `app/actions/comment.ts`: `getTaskComments`, `createComment`, `editComment`,
  `deleteComment`, `resolveComment`, `unresolveComment`, `toggleReaction`
- `app/actions/task.ts` (target side): `moveTask` and `bulkMoveTasks` never
  validated `targetListId`, so a user with edit in one project could move a task
  into any list id, including a list in another workspace.
- `app/actions/task-assignee.ts`: `addAssignee`, `removeAssignee`, `addWatcher`,
  `removeWatcher`, `toggleWatcher`
- `app/actions/time-tracking.ts`: `startTimer`, `stopTimer`, `logTime`,
  `setTimeEntryNote`, `deleteTimeEntry`

**Root cause:** Permission checks ran against the ids the client sent, and the
action never verified that the task or comment was in that space. Examples:

- `updateTaskStatus` changed the status of any task in any project, and logged
  and notified even when the update matched 0 rows.
- `createComment` did not check that the task existed or that `parentCommentId`
  belonged to it.
- `deleteComment` let a user with full access in any space delete any comment.
- `getSubtasks` and `getTaskActivity` only checked access to the caller's space.
- Several actions filtered the write by the caller's `listId`, so a stale
  `listId` (an open panel after `moveTask`) silently updated nothing while still
  logging activity.
- `task-assignee.ts` skipped the cache refresh for tasks with no list.
- `bulkAssignTasks` and `bulkUpdateStatus` scoped tasks with
  `task.space_id = spaceId`, which misses tasks whose own `space_id` is null
  (subtasks) and trusts a stale value on tasks moved to a list in another
  project. `bulkMoveTasks` did not scope the tasks at all.
- `addWatcher` / `removeWatcher` accepted a `watcherUserId` (no UI passes it), so
  anyone could add an outsider as a watcher, who then received notifications
  with task titles and comment previews.
- `getTaskDetail` answered "Forbidden" for a task the user cannot see and "Task
  not found" for a missing one, revealing which ids exist.
