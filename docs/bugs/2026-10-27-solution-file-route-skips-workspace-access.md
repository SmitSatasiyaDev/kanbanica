# Solution: check access to the owning workspace before serving a file

**What changed**
- New `lib/file-access.ts` with `canReadStoredFile(userId, key)`. It maps a
  storage key to the data it belongs to and applies the normal permission rules:
  - Keys with a `.` or `..` path segment, backslashes, empty segments or a leading `/` are refused. Dots inside a file name (`report..final.pdf`) are fine.
  - `avatars/...`: any signed-in user (avatars are shown across workspaces).
  - `attachments/...`: looks up the `task_attachment` row by exact `fileUrl`,
    joined to the task, its list and the workspace. The space comes from
    `list.spaceId ?? task.spaceId` and the workspace from the task row, never from
    the key. The workspace must be `ACTIVE` and the user must be able to see the
    space. Archived spaces count as visible. If the task is in the Trash, only
    workspace Owners and Admins can read it.
  - `channels/...`: needs a `channel_message_attachment` row for the key, an
    `ACTIVE` workspace, and an active membership in the workspace named in the key
    (those keys are always server generated).
  - Any other prefix is refused.
- `app/api/files/[...key]/route.ts` calls `canReadStoredFile` after the session
  check and before `storage.download`. A denied file returns the same 404 as a
  missing file, so callers cannot tell which keys exist.

**Tests:** `lib/file-access.test.ts`, `app/api/files/[...key]/route.test.ts`.

**Why it works:** Every download now goes through the same workspace and project
permission checks as the rest of the app, using values read from the database.

**Out of scope:** When storage is S3/R2, `storage.url()` style links point at the
bucket and are not checked by this route. Those links are only as private as the
bucket configuration or presigned URL lifetime.

**Known limit:** `duplicateTask` and `duplicateList` copy the description JSON but
not the attachment rows, so a copied task's inline images still point at the
original task's attachments. Access to those images is decided by the original
task. Copies always stay in the same project, so this matches in normal use. It
differs only if the original is later moved to another project (the copy's
images follow the original's new project), or trashed (only Owners/Admins can
see them until the original is restored). Copying the attachment rows and files
on duplicate would remove this limit and is a separate change.

**Browser cache:** file responses are cached (`private, max-age=3600`). The
browser re-test found that after signing out and in as another account, the
browser served the first account's cached file without asking the server. File
responses now send `Vary: Cookie`, so the cache keeps a separate entry per
session cookie.

**Verified in the browser (2026-10-27, local instance):** outsider gets 404
(server); member of a public project gets 200; after the member is removed, 404;
a different account on the same browser gets 404 even with the default cache
mode; logged out gets 401; keys with a `..` segment get 404. The owner's PNG and SVG still
display through `<img>`.
