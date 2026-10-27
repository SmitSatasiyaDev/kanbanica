# Bug: view-only members can change a task's status

**Symptom:** A member with View permission on a project could change the status
of its tasks: from the task panel status Select, the task page status pickers,
the list row "Move Status" menu, and by dragging cards on the List, Board and
Sprint views.

**Where:** `updateTaskStatus` in `app/actions/task.ts`, plus the status controls
in `components/task/task-detail-panel.tsx`,
`app/(app)/[workspaceId]/task/[taskId]/_components/task-detail-page.tsx`,
`components/task/task-list-row.tsx`, the List and Board views
(`app/(app)/[workspaceId]/[spaceId]/list/[listId]/_components/`) and
`components/sprint/sprint-list-view.tsx`.

**Root cause:** `updateTaskStatus` only called `requireViewAccess`, while
`bulkUpdateStatus` required Edit. The task panel status Select and the
"Move Status" menu were not gated by `canEdit`, and drag and drop on the three
views was enabled for everyone (the server only rejected the reorder, not the
status change). The action also did not check that the target status belongs to
the task's project, and it wrote activity and notifications even when the update
matched no row.
