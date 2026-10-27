# Bug: creating a task accepts any assignee and any status

## Symptom

A crafted call to the web `createTask` server action could:

- assign a user who is not in the workspace, or who cannot open the task's project. That user got a `task_assigned` notification (with the task title) for a task they cannot see, and became its watcher;
- set `statusId` to a status that belongs to a list in another project.

`createSubtask` had the same assignee gap once it accepted assignees (Phase 5).

## Where

`createTask` in `app/actions/task.ts` (now `lib/services/task-service.ts`). The UI pickers only offer real values, so normal use never showed it. `assignTask` already required an ACTIVE member; only task creation trusted the ids it was given.

## Root cause

The action inserted `assigneeIds` and `statusId` as received. Nothing checked workspace membership, project access, or that the status belonged to the project. Phase 5 added the checks for MCP only, which left the web path as the weaker one.
