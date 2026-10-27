# Solution: validate assignees and status when creating a task

## What changed

`lib/services/task-service.ts`, used by the web actions and the MCP tools alike:

- `createTask` and `createSubtask` check every assignee with `resolveProjectUsers`: the user must be an ACTIVE workspace member and pass `canAccessSpace` for the task's project. Otherwise nothing is written and the error is "User cannot access this task".
- `createTask` checks a given `statusId` before anything is written, else "Status not found". MCP callers need a status of the target list. Web callers need a status of a list in the same project, because the Sprint view creates tasks from statuses of several lists (the same rule `setTaskStatus` uses). Subtasks take their status from the parent's list, so there is nothing to send.

## Callers checked

All `createTask` / `createSubtask` call sites (quick create, list view, create modal, sprint panel and list, board and task page subtasks) pass pickers' values. The assignee pickers list every ACTIVE workspace member, so choosing someone who cannot see a private project now shows the error instead of silently notifying them.

## Tests

`lib/services/task-service-write.test.ts`: web and MCP refusals for outsiders and members without project access, nothing inserted or notified, valid assignees accepted, status from another project refused, status from the same project accepted, listless Sprint creation.
