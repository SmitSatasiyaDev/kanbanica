# Bug: file route serves any stored file to any signed-in user

**Symptom:** A user with no membership in a workspace could download a private
task attachment from that workspace by requesting `/api/files/<storage key>`.
The same user got 403 from `/api/tasks/<taskId>/attachments` for the same task.

**Where:** `app/api/files/[...key]/route.ts` (GET).

**Root cause:** The route only checked that a session existed, then streamed
whatever storage key was in the URL. It never mapped the key back to a task,
space or workspace, so none of the workspace or project permission rules were
applied to file downloads. Task attachments, channel attachments and avatars all
go through this one route.

**How it was reproduced:** On a local instance with two users, Alice (owner of
workspace A) and Bob (no membership in workspace A). Alice uploaded an
attachment to a task. Bob requested its `/api/files/attachments/...` URL and got
200 with the file contents, while `/api/tasks/<taskId>/attachments` returned 403
for Bob. A logged-out request correctly returned 401.
