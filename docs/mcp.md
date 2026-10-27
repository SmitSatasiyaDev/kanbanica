# MCP Server (External Agent Access)

Status: **built (Phases 0–5, 2026-10-27)** on branch `feat/mcp-server`. Tested end to end with the official MCP SDK client against a local instance. User guide: `docs/mcp-user-guide.md`. Revision 2 of this spec was checked line by line against the code at `3eca52d` (see §10 verification log). Differences found while building are noted in place.

Kanbanica exposes a [Model Context Protocol](https://modelcontextprotocol.io) server so a user can work on their Kanbanica tasks from an outside tool — Claude Code, Cursor, or any other MCP client. From that tool the user (or their agent) can:

- see the tasks assigned to them, across workspaces
- read a task: description, status, subtasks, comments, images
- take a task (assign it to themselves)
- change its status or mark it done
- add a comment, optionally with images
- upload a file to the task

The MCP server acts **as the user**. It never has more access than the user has in the web app, and every change goes through the same code as the UI: permissions, activity log, notifications and real-time refresh.

This is not a sync with other systems such as Jira or GitHub. Importing tasks from another system is a separate feature (see `docs/import-export.md`).

---

## 1. Why this needs new work

| Gap | Today |
|-----|-------|
| Authentication | Every route and action calls `auth.api.getSession({ headers })`, which only reads the session cookie. The Better Auth `bearer` plugin is not enabled (`lib/auth.ts:207`). No token login exists. |
| Mutations | Status changes, comments, assignees etc. are **server actions** (`app/actions/*.ts`). Outside clients cannot call them. |
| File reads | `GET /api/files/[...key]` needs the session cookie, so an agent cannot open image URLs. |
| Permission scoping | Many task and comment actions trust the `spaceId` the caller sends and never check the task is in that space (§4.2). The MCP work must not build on that. |

The work: (0) close the permission gap, (1) token login, (2) shared service functions, (3) one MCP endpoint.

---

## 2. Authentication

### 2.1 MVP: personal API tokens

Each user creates tokens on their own page, **API tokens & MCP** (`app/(app)/[workspaceId]/api-tokens/page.tsx`), reached from the bottom-left user menu right after "Notification settings". The page is personal even though its URL has a workspace: any signed-in member can open it, and it returns 404 when `isMcpEnabled()` is false. It holds a permanent "How to connect" card above the token list. `settings/security` is not an option: it is workspace-level and Owner-only.

The client sends:

```
Authorization: Bearer kbn_<random>
```

**Why our own table:** installed `better-auth@1.6.27` has no API-key plugin (no `./plugins/api-key` export). `@better-auth/api-key` (1.7.x) needs `better-auth ^1.7`, so it would force an auth upgrade. A token table is small and follows our schema conventions. Do **not** enable the `bearer` plugin. Keep token auth and session auth fully separate.

**Table `api_token`** (`db/schema/api-token.ts`, exported from `db/schema/index.ts`):

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | `crypto.randomUUID()` |
| `user_id` | text, not null, indexed | Plain text column, like `pushSubscription.userId`. Rows are removed by hand in `purgeUser` (see below). |
| `name` | text, not null | label the user gives it ("Claude Code on laptop") |
| `token_hash` | text, not null, unique | SHA-256 hex of the full token. The plain token is never stored. |
| `token_prefix` | text, not null | first 8 chars after `kbn_`, shown in the list |
| `scope` | text, not null | `read` or `write` |
| `workspace_id` | text, FK → `workspace.id` on delete cascade, nullable | `null` = all the user's workspaces |
| `last_used_at` | timestamptz, nullable | written at most once per minute per token |
| `expires_at` | timestamptz, nullable | presets 30 / 90 / 365 days, or never |
| `revoked_at` | timestamptz, nullable | revoke = set this. The row is kept until the user is purged. |
| `created_at`, `updated_at` | timestamptz, not null | standard |

Migration: one additive `CREATE TABLE` (`pnpm db:generate`) plus a sibling `db/migrations/*-migration.test.ts`, like `workspace-max-tasks-migration.test.ts`.

**Token rules** (`lib/api-token.ts`):

- Format: `kbn_` + 32 random bytes, base64url.
- Lookup: hash the presented token, then select by `token_hash` **joined to `user`**. Reject (`401`, one fixed message) when any of these holds:
  - the token is revoked or expired;
  - `user.banned` is true **and** `user.banExpires` is null or in the future.
- The ban is read live on every call because Orbit's `toggleUserBanAction` (`app/actions/orbit-users.ts:51`) sets `banned` but does not delete sessions.
- Max 20 active tokens per user.
- **Guests get no token access.** "Guest" is a role per workspace, not a user type: one person can be GUEST in workspace A and MEMBER in B. So the rule is per workspace, checked live on every call: a token **never** reaches a workspace where its owner's role is `GUEST`.
  - `list_workspaces` leaves those workspaces out, and `resolveTaskContext` returns `null` for their tasks ("Task not found").
  - If a member is changed to guest, token access to that workspace stops at once. If a guest is promoted, it starts.
  - A user can create a token only if they have at least one ACTIVE, non-guest membership in an ACTIVE workspace. Otherwise the API tokens card explains why it is unavailable.
  - The workspace-restriction picker lists only those non-guest workspaces.
  - Why: guests are usually outside people (clients, contractors). A token is long-lived and works outside the browser, and the workspace Owner can neither see nor revoke it. There is also no workspace-level opt-out (§9.3). Letting guests hold tokens would give owners no way to stop a guest pulling every task they can see into an outside tool.
- Workspace and project access are computed live on every call. `removeMember` hard-deletes the `workspace_member` row (`app/actions/workspace.ts:1173`), so access ends at once.
- Audit entries go through `audit()`: `api_token.created` and `api_token.revoked`. They show in the legacy admin audit log only. Orbit has no audit view today.
- **Account deletion:** in `lib/user-deletion.ts` `purgeUser`, add `tx.delete(apiToken).where(eq(apiToken.userId, userId))` next to the `pushSubscription` delete. Update `lib/user-deletion.test.ts` and the "Full transaction order" line in `CLAUDE.md`.

```ts
type Actor = {
  userId: string;
  name: string | null;
  email: string;
  source: "web" | "mcp";
  tokenId?: string;
  scope: "read" | "write";      // web actors are always "write"
  workspaceId: string | null;   // token restriction; null for web
};
```

**Token UI:**

- The server action returns the plain token **once**. The client holds it only in component state inside a `Dialog`, and drops it when the dialog closes.
- The `Dialog` primitive's overlay **does** close on click (`<DialogOverlay onClick={() => setOpen(false)} />`; `closeOnOutsidePointerDown: false` only affects the floating dismiss hook). So while a token is shown, the card ignores every `onOpenChange(false)`, hides the X button (`showCloseButton={false}`) and prevents Escape. The dialog closes only with an explicit "I've copied it" button.
- Copy button: same pattern as `components/workspace/invite-link-card.tsx:140` (`navigator.clipboard.writeText` + toast).
- Under the token, show the setup snippet (§3).
- The token list (name, prefix, scope, workspace, last used, expires) uses the `Table` primitive, modelled on `components/profile/sessions-card.tsx`.
- Revoke uses the standard confirmation dialog.
- After create or revoke, `router.refresh()`. Don't copy `profile.ts`'s stale `revalidatePath("/dashboard/profile")`.

### 2.2 Later: OAuth (one-click connect)

Claude Code and Cursor accept a custom header, so tokens are enough for the MVP. The claude.ai / Claude Desktop custom-connector flow expects OAuth. For that, add OAuth 2.1 with dynamic client registration. The installed Better Auth ships `better-auth/plugins/mcp`, with no deprecation notice in 1.6.27. The OAuth access token resolves to the same `Actor`, so nothing outside §2 changes.

---

## 3. Endpoint

- **Route:** `app/api/mcp/route.ts`. Add `export const runtime = "nodejs"`. That is the default today, but it must never become Edge: notifications and real-time broadcasts use in-process state (`lib/sse-clients.ts`). No route-name collision exists (only catch-alls are `api/auth/[...all]` and `api/files/[...key]`), and there is no `proxy.ts`/`middleware.ts` that could intercept the route.
- **Library:** `@modelcontextprotocol/sdk` **1.x**, pinned to an exact version. Peers are `zod ^3.25 || ^4`, so our `zod@4` works.
  - Use `McpServer` plus `WebStandardStreamableHTTPServerTransport`, imported from `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js` (the `.js` suffix is required).
  - Do not use `mcp-handler`: it pins the separate 2.x server package and adds no auth.
  - The repo sets a pnpm `minimumReleaseAge`. Pick a release older than that window, e.g. `1.32.1`. Also add `@cfworker/json-schema` if pnpm reports it as a missing peer.
  - After install, run `pnpm build` once to confirm nothing in the SDK's dependency tree (express, hono) needs an `allowBuilds` entry.
- **Transport:** stateless Streamable HTTP.
  - Create a **new `McpServer` and a new transport for every request**, with `sessionIdGenerator: undefined` and `enableJsonResponse: true`. The SDK forbids reusing a stateless transport.
  - Call `transport.handleRequest(request, { parsedBody, authInfo })`. Pass the body we already parsed for the size check.
- **Methods:** `POST` handles MCP. `GET` and `DELETE` return `405`.
- **Order of checks on POST:**
  1. `isMcpEnabled()` is false → `404`.
  2. `Origin` header present and its parsed origin ≠ the parsed origin of `env.APP_URL` → `403`. A request with no `Origin` is allowed. MCP clients don't send one.
  3. `Content-Length` > 40 MB → `413`. While reading the body, count bytes and abort past 40 MB (some clients don't send `Content-Length`).
  4. Resolve the token → `401` with `WWW-Authenticate: Bearer` if invalid. The handshake (`initialize`) needs a token too.
  5. `rateLimit(\`mcp:${tokenId}\`, 120, 60_000)` → `429` with `Retry-After`, same pattern as the attachments route.
- **Reverse proxies:** the nginx example in `DEPLOYMENT.md` has no `client_max_body_size`, so nginx's 1 MB default applies. That already breaks 10 MB attachment uploads today. Add `client_max_body_size 45m;` to the example and a note about Cloudflare's 100 MB limit. The Caddy example has no limit.
- **Platform switch:**
  - Add a column `integration_settings.mcp_enabled boolean not null default true`, like `notificationEmailsEnabled`.
  - Getter: `isMcpEnabled()` in `lib/integration-settings.ts`. Also extend `IntegrationSettingsSummary` with `mcp: { enabled }`.
  - Save path: `saveIntegrationSettingsAction` gets a new `mcp?: { enabled }` section.
  - UI: a new Orbit page `app/(orbit)/orbit/settings/mcp/page.tsx` ("API access (MCP)"), plus an entry in the `SETTINGS_SECTIONS` index. Copy `components/orbit/settings/notification-email-settings-form.tsx`.
  - The setting is read per request (React `cache` only), so a change applies at once.
  - When off, the API tokens & MCP page returns 404 and the user-menu item is hidden.

User setup (shown under a new token):

```bash
claude mcp add --transport http kanbanica https://<APP_URL>/api/mcp \
  --header "Authorization: Bearer kbn_..."
```

---

## 4. Shared core

### 4.1 Task context

`lib/services/task-context.ts`:

```ts
resolveTaskContext(taskId, actor) → {
  taskId, workspaceId, spaceId, listId: string | null, statusId: string | null, title
} | null
```

- Select `task` **left join** `list`, with `notDeleted()`.
- `spaceId = COALESCE(list.space_id, task.space_id)`. This is the same rule as `getTaskLocation` (`app/actions/task.ts:2297`) and the task page. Tasks can have no list: `task.listId`, `task.spaceId` and `task.statusId` are all nullable (`db/schema/task.ts:15-24`), and Sprint view creates tasks with `listId: null`. An inner join would hide these tasks.
- `workspaceId = task.workspace_id` (not null).
- Return `null` when:
  - there is no row;
  - the space is null;
  - the workspace is not `ACTIVE` (the enum is `ACTIVE | DELETING`, and `getWorkspaceMembership` does not check it);
  - `actor.workspaceId` is set and differs;
  - `actor.source === "mcp"` and the actor's role in that workspace is `GUEST` (§2.1).
- Callers turn `null` into "Task not found". The same message covers a trashed task, a missing one, and one the user can't see.

`resolveCommentContext(commentId, actor)` resolves the comment to its task, then calls `resolveTaskContext`.

### 4.2 Permission gap to close first (Phase 0)

These actions check access against the **caller-supplied** `spaceId` (and sometimes `workspaceId`) and never check that the task or comment is in that space:

| Action | Effect today |
|--------|--------------|
| `updateTaskStatus` (`task.ts:866`) | change status of any task in any project. It also logs activity and notifies, even when the update matched 0 rows. |
| `getTaskDetail` (`task.ts:342`) | read any task |
| `getTaskComments`, `createComment`, `deleteComment`, `resolveComment`, `unresolveComment`, `toggleReaction` (`comment.ts`) | read or act on any task's comments. `createComment` doesn't even check the task exists or that `parentCommentId` belongs to it. `deleteComment` lets full-access in *any* space delete any comment. |
| `addAssignee`, `removeAssignee`, `addWatcher`, `removeWatcher`, `toggleWatcher` (`task-assignee.ts`) | change people on any task |
| `startTimer`, `stopTimer`, `logTime`, `setTimeEntryNote`, `deleteTimeEntry` (`time-tracking.ts`) | log time on any task |

`editComment` is author-only (low risk), but it is fixed the same way. `bulkAssignTasks` and `bulkUpdateStatus` already scope by space. Re-check them for tasks whose `task.space_id` is null.

**Fix:** each action resolves the context from `taskId` / `commentId` with `resolveTaskContext` / `resolveCommentContext`, and **ignores** the caller's `workspaceId` / `spaceId` / `listId`. Keep the function signatures so no UI caller changes. Don't reject on mismatch: open panels can hold stale props after `moveTask`, and rejecting would show users errors where today they see none. Permission, notifications, activity and `refreshWorkspace` then all use the real location. Always call `refreshWorkspace` with the `taskId`. Today `task-assignee.ts` skips the refresh when `listId` is null.

**Status validation in the web path:** check that the target status's list is in the **same space** as the task. Do **not** require the task's own list. The Sprint board shows statuses from every list in the sprint and assigns them across lists (`sprint.ts:1085`, `sprint-list-view.tsx:1698`). A strict check would break it. The same-space check matches `bulkUpdateStatus`.

### 4.3 Permission levels

These follow the helpers exactly as they behave today:

- **View** = `canAccessSpace(userId, workspaceId, spaceId)`. This covers Owner/Admin, public spaces for members, and explicit spaces for guests.
- **Edit** = `getSpacePermission(...) ≥ "edit"`. Note that a plain member of a public space with no `space_member` row gets `null` and cannot edit (`permissions.test.ts:154`). MCP inherits this, the same as the web.
- **Upload** (attachment or comment image) = an ACTIVE workspace member who is not GUEST, plus View. This matches `POST /api/tasks/[taskId]/attachments`. On the web a guest can comment but cannot attach images. Over MCP, guests have no access at all (§2.1).
- **Status change** = **Edit**, on the web and over MCP. Today `updateTaskStatus` only checks View. That is a bug, fixed in Phase 0 (§7.4).

### 4.4 Services

```
lib/services/
├── task-context.ts       ← resolveTaskContext, resolveCommentContext
├── task-service.ts       ← listMyTasks, searchTasks, getTask, listTaskStatuses, setTaskStatus, completeTask, assignTask
├── comment-service.ts    ← listComments, createComment
└── attachment-service.ts ← uploadAttachment, readAttachment
```

Rules for every service function:

1. Get the context from `resolveTaskContext`, never from arguments.
2. Check the permission level in §5.1 using §4.3.
3. Keep every side effect: `writeActivityLog`, `createNotifications`, `refreshWorkspace`. None of them read request headers or session (checked), so they work from a route handler. Add `source: actor.source` to activity `meta`. The feed ignores unknown meta keys. Known quirk: the Space Activity search does `meta::text ILIKE`, so a search for "mcp" matches MCP rows.
4. Return `{ error }` with fixed messages only.

The server actions become thin wrappers: session → `Actor { source: "web", scope: "write", workspaceId: null }` → service. The attachments route POST calls `attachment-service.uploadAttachment`. Read scope and the token's workspace restriction are enforced in the MCP layer (scope) and in `resolveTaskContext` (workspace). Existing tests mock module paths such as `@/lib/permissions` and `@/lib/activity-log`. Services import those same paths, so the mocks still apply.

---

## 5. Tools

Tools only, no MCP resources or prompts. Client support is best for tools.

### 5.1 Tool list

| Tool | Input | Returns | Needs |
|------|-------|---------|-------|
| `list_workspaces` | — | `[{ id, name }]`. ACTIVE memberships in ACTIVE workspaces, after the token restriction. | read |
| `list_my_tasks` | `workspaceId?`, `includeCompleted?` (false), `limit?` (50, max 200), `cursor?` | `{ items: [{ id, number, title, status{ id, name, type }, priority, dueDate, project, list, workspace, url }], nextCursor }` (since Phase 5; was a bare array) | read · view |
| `search_tasks` | `workspaceId`, `query` (≥ 2 chars), `projectId?`, `includeArchived?` (false), `limit?` (25, max 100), `cursor?` | `{ items, nextCursor }`, same item shape | read · view |
| `get_task` | `taskId` **or** `workspaceId` + `number`, `commentsCursor?` | title, description (Markdown), status, priority, due dates, assignees, subtasks, 20 comments (Markdown) plus `commentsNextCursor`, attachments `[{ id, fileName, mimeType, size, isImage }]`, `url` | read · view |
| `get_attachment` | `attachmentId` | images → MCP `image` content (base64). Other files → `resource` content (base64 blob) up to 5 MB, else an error with the file name and size. | read · view |
| `list_task_statuses` | `taskId` | the task's list statuses, `[{ id, name, type }]`, ordered by `orderIndex` | read · view |
| `set_task_status` | `taskId`, `statusId` | new status | write · **edit** |
| `complete_task` | `taskId` | new status: the first `CLOSED` status by `orderIndex` of the task's list. Every list has at least one (`list.ts:820`). | write · **edit** |
| `assign_task` | `taskId`, `userId?` (default me), `unassign?` | assignee list | write · edit |
| `add_comment` | `taskId`, `text` (Markdown), `images?` (§5.4), `parentCommentId?` | `{ commentId, url }` | write · view. With images: upload rule (§4.3). |
| `upload_attachment` | `taskId`, `fileName`, `dataBase64` | `{ attachmentId, fileName, size }` | write · upload rule |

Phase 5 added `list_projects`, `list_lists`, `list_members`, `create_task`, `create_subtask`, `update_task`, `list_notifications`, `mark_notifications_read` and `get_current_sprint`. They are specified in §11.1 (20 tools in total).

Notes:

- **Listless tasks:**
  - `get_task` works for them.
  - `list_task_statuses`, `set_task_status` and `complete_task` return "This task is not in a list, so it has no statuses."
  - `list_my_tasks` and `search_tasks` skip them, same as the web My Tasks page and search today (both inner-join the status).
- **MCP status rule:** stricter than the web. `statusId` must belong to the task's own list, which matches what `list_task_statuses` returns.
- **`listMyTasks`:** built from `getMyTasks` (`app/actions/my-tasks.ts`), plus a workspace filter and a limit in SQL. Today there is no limit, and completed tasks are filtered in JS.
- **`searchTasks`:** built from `globalSearch` (`app/actions/search.ts:120`). Today it has a hard-coded 25 cap, top-level tasks only, includes archived tasks, and filters by `filters.space`. The service adds `limit` and `includeArchived`.
- **Task numbers:** `seqNumber` is allocated per workspace under a row lock (`lib/workspace-limits.ts:76`), so it is unique in practice, but there is no DB unique index. Add an index on `(workspace_id, seq_number)` in the Phase 1 migration (non-unique, safe), so `get_task` by number is not a scan. The UI shows numbers as `#123`, and responses use the same form.
- **`url`:** `${env.APP_URL}/${workspaceId}/task/${taskId}`.
- **Phase 2 candidates:** timer tools. (`create_task` and `update_task` shipped in Phase 5.)
- **Never exposed:** delete, archive, trash, bulk operations, settings. Members are read-only through `list_members`.

### 5.2 Tool descriptions and annotations

Write each description for the model reading it: what it does, when to use it, what not to do. Mark read tools `readOnlyHint: true` and write tools `destructiveHint: false`. Mark `set_task_status`, `complete_task`, `assign_task`, `update_task` and `mark_notifications_read` `idempotentHint: true`. A write tool called with a `read` token returns `isError` "This token is read-only."

### 5.3 Text format (Markdown ↔ Tiptap)

Comments are stored as Tiptap JSON objects. Descriptions are stored as either a JSON string or an object, so always pass them through `toTiptapDoc()` (`lib/notes.ts:11`) first.

**In (`add_comment.text`)**, `lib/mcp/markdown-to-tiptap.ts`:

- Parse with `markdown-it` (new dependency, `html: false`). Use only its token stream and map tokens to Tiptap nodes ourselves. No markdown library is installed today.
- Emit only nodes the comment editor registers: StarterKit + Mention + NoteImage + Link (`task-activity-feed.tsx:322`, renderer `:680`).
  - Nodes: `doc`, `paragraph`, `text`, `hardBreak`, `heading` (1-6), `blockquote`, `bulletList`, `orderedList` (`start`), `listItem`, `codeBlock` (`language`), `horizontalRule`, `noteImage`.
  - Marks: `bold`, `italic`, `strike`, `code`, `link` (`href` only), `underline`.
- **Never** emit `noteFile`, `taskList` or tables: comments can't render them.
- Unsupported Markdown (tables, raw HTML, images-by-URL) becomes plain text.
- Link `href` must match `/^(https?:|mailto:)/i`, the same `SAFE_LINK` rule as `lib/comment-clipboard.ts:40`. Otherwise the text stays without a link.
- Mentions are not parsed in the MVP, so watchers are notified but `@name` is not.

**Validation:** `lib/mcp/tiptap-validate.ts` walks the produced doc and rejects any node, mark or attribute outside that allowlist. `createComment` does no shape validation of its own, so this is the only guard.

**Out (`get_task`)**, `lib/mcp/tiptap-to-markdown.ts`:

- A pure walker, using the traversal in `lib/comment-clipboard.ts` as the model.
- It handles the comment nodes above, plus description-only nodes: `taskList`/`taskItem` → `- [ ]`/`- [x]`, `textAlign` ignored, `noteFile`.
- `noteImage` / `noteFile` become `![alt](attachment:<attachmentId>)` / `[fileName](attachment:<attachmentId>)`. The agent fetches the bytes with `get_attachment`. We never hand out `/api/files` URLs, because they need a browser cookie.
- Mentions become `@label`.

Both converters are pure and unit-tested (round trip for the supported subset).

### 5.4 Images in comments

`add_comment.images`: up to **5** items, each `{ dataBase64, alt? }`. Each image is at most 10 MB decoded (`MAX_FILE_SIZE`, `lib/storage.ts:159`), and about 30 MB per call in total because of the 40 MB body limit.

Flow, in `comment-service.createComment`:

1. **Permission.** Run the upload rule (§4.3) before decoding anything.
2. **Decode and check the type from bytes.** Read the magic bytes (`lib/mcp/image-check.ts`):
   - PNG `89 50 4E 47`
   - JPEG `FF D8 FF`
   - GIF `GIF8`
   - WebP `RIFF....WEBP`

   Anything else, including SVG, is refused. The client sends no MIME type or file name. The stored `mimeType`, the file extension and the name (`image-1.png` …) all come from the sniffed type.
3. **Generate ids up front.** Create the comment id and one attachment id per image.
4. **Upload to storage.** Store each image at `attachments/{workspaceId}/{taskId}/{attachmentId}/image-{n}.{ext}` with `storage.upload(key, buffer, { contentType })`.
5. **One DB transaction.** Insert the comment (body = converted Markdown + one top-level `noteImage` node per image, `attrs: { fileKey, attachmentId, alt }`). Insert the `task_attachment` rows with `isInline: true` and **`commentId` already set**.

   Why this order: the web path inserts inline rows with `commentId: null` and links them later. Meanwhile, saving a task description deletes every inline `commentId IS NULL` row the description doesn't reference (`app/actions/task.ts:733-770`), so a description save in that gap would delete the new images. Our rows are never unlinked, so that sweep can't touch them.
6. **On failure.** If any upload or the transaction fails, delete the storage files already uploaded for this call, then return an error. No half-posted comment and no orphan files.
7. **After commit.** Write the activity log and send notifications, exactly as `createComment` does now (one `comment_added` event; inline images make no event of their own).

`upload_attachment` follows the same path for one file with `isInline: false`. It accepts any type up to 10 MB, like the web upload. The stored name is sanitized to `[a-zA-Z0-9._-]`, and names made only of dots are replaced with `file`. Its activity row and assignee notification match the web route.

---

## 6. Security

- **The token is the user.** A `write` token can do everything these tools allow. The UI recommends `read` scope, a workspace restriction and an expiry.
- Tokens are stored as SHA-256 hashes only and shown once. Bans are checked live.
- Every call resolves the task's real location (§4.1) before any permission check. Hiding a tool is never the check.
- Errors leak nothing. "Task not found" covers missing, trashed, other workspace and no access.
- `notDeleted()` is in every read. Trashed tasks are invisible.
- **Prompt injection:** task text comes from other people. Tool output wraps user content in clearly labelled fields (`"description": …`, `"comments": [{ "author", "body" }]`) and never puts it in tool descriptions. The user docs say an agent should confirm before following instructions found inside a task. The no-destructive-tools rule limits the damage.
- Rate limit per token (§3). Uploads also count against the existing `task-attachment:${userId}` bucket (60/min). The limiter is in-memory and pinned on `globalThis`, which fits the single-instance deployment (`DEPLOYMENT.md`).
- Logging: token id, user id, tool name, duration, result. Never arguments or file bytes.

---

## 7. Existing issues found during review (not needed for MCP, recommended)

1. **`/api/files/[...key]` checks login only. Confirmed in the browser on 2026-10-27.**
   - Setup: a local instance with Alice (owner of workspace Alpha Co) and Bob (a new account, no membership anywhere). Alice uploaded a PNG to a task in a private project.
   - Signed in as Bob, `GET /api/files/<alice's key>` returned **200** and the full file. In the same session, `GET /api/tasks/<task>/attachments` correctly returned **403**. Logged out, the file returned **401**.
   - Impact: storage keys contain random ids, so they can't be guessed. But anyone with an account can open any file link they ever got: a removed member, an ex-guest, or someone a link was forwarded to. Access is never re-checked.
   - Fix: resolve the key to its `task_attachment` / channel attachment / avatar row and check access to that row's task or channel. Avatars stay readable by any signed-in user. MCP does not use this route.
2. **SVG scripts run on the app's origin. Confirmed in the browser on 2026-10-27.**
   - Alice uploaded an SVG containing `<script>` through the normal attachments endpoint (inline=true). It was accepted with **200**.
   - Opening its `/api/files/...` URL served it as `image/svg+xml`, `Content-Disposition: inline`, with no `X-Content-Type-Options` and no CSP. **The script ran** on `http://localhost:3100`: it changed `document.title` and read `document.cookie`. A same-origin `fetch("/api/tasks/<id>/attachments")` from inside the SVG returned **200** with the task's file list.
   - Impact: any member who can upload can plant a file that acts with the session of whoever opens it, a teammate or an admin.
   - Fix: refuse active types on upload (SVG, HTML, XML), or store them as download-only. Add `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox` to every file response. Serve anything that isn't PNG / JPEG / GIF / WebP / PDF as `Content-Disposition: attachment`.
3. **The nginx example breaks uploads over 1 MB** (§3).
4. **View-only members can change status (bug, decided 2026-10-27).** `updateTaskStatus` checks View, while `bulkUpdateStatus` checks Edit. The task panel's status Select is not gated by `canEdit`. **Decision: status change needs Edit everywhere.** Fixed in Phase 0: the action requires Edit, and every status control is disabled when `canEdit` is false. Before changing anything, check each status control (panel, task page, list row, board card drag, subtask row, sprint board). **Done in Phase 0** and checked in the browser: a view-only member sees status disabled and cannot drag cards, and the server refuses the change. Follow-up: on the full task page, the priority, date and assignee pickers still open for view-only members. The server refuses the change, so this is UI only.
5. **Most docs listed in `CLAUDE.md`'s Feature Docs table don't exist** (`permission-model.md`, `settings.md`, `realtime.md`, …). This spec cites code instead.

---

## 8. Implementation plan

Each phase ships on its own and is additive. Every phase ends with `pnpm test`, `pnpm lint`, `pnpm lint:tokens` and `pnpm build` passing.

### Phase 0: permission fix (no MCP code)
1. `lib/services/task-context.ts`: `resolveTaskContext`, `resolveCommentContext` (§4.1).
2. Rewire every action in the §4.2 table to derive the context and ignore caller location arguments. Signatures stay the same. Add the web status rule (same space). `updateTaskStatus` requires Edit, and status controls are disabled when `canEdit` is false (§7.4).
3. Tests (mocked DB, existing Vitest pattern from `app/actions/trash.test.ts`):
   - the cross-project status change, comment and assign are refused;
   - a status from another space is refused, while a status from another list in the same space works (sprint board);
   - a listless task works;
   - a stale `listId` from the caller still updates the right task.
4. Bug docs: `docs/bugs/2026-10-27-bug-task-actions-trust-caller-space.md` + `...-solution-...`.

**Done when:** all web flows behave the same (manual pass: List, Board, Sprint drag, task panel, task page, comments, assignees, timer), and the new tests pass.

### Phase 1: tokens
1. `db/schema/api-token.ts` + migration + migration test. Same migration: add the `(workspace_id, seq_number)` index on `task`, and `integration_settings.mcp_enabled`.
2. `lib/api-token.ts`: create (returns the plain token once), resolve (hash lookup, user join, ban, expiry, revoked), revoke, throttled `last_used_at`.
3. `app/actions/api-token.ts`: list / create / revoke own tokens. Audit entries.
4. `components/profile/api-tokens-card.tsx` (on `app/(app)/[workspaceId]/api-tokens/page.tsx`), plus the one-time token dialog (§2.1). Primitives only.
5. `purgeUser` + its test + the CLAUDE.md account-deletion line.
6. `isMcpEnabled()`, the summary field, the save-action section, the Orbit page.
7. Tests: hash-only storage; revoked / expired / banned (with and without `banExpires`) rejected; 20-token cap; scope and workspace stored correctly.

**Done when:** a user can create, copy and revoke a token, an admin can toggle MCP, and account deletion removes tokens.

### Phase 2: shared services
1. `lib/services/*` (§4.4), built from `getMyTasks`, `globalSearch`, `getTaskDetail`, `getTaskComments`, `updateTaskStatus`, `addAssignee`/`removeAssignee`, `createComment` and the attachments route POST.
2. Server actions and the attachments POST become thin wrappers.
3. `createComment` in the service supports the "pre-linked inline attachments in one transaction" path (§5.4 step 5). The web path keeps its current flow.
4. `source` in activity meta.

**Done when:** the existing tests pass unchanged, and the manual web pass from Phase 0 is unchanged.

### Phase 3: MCP endpoint
1. Add `@modelcontextprotocol/sdk` (exact 1.x version, §3) and `markdown-it`. Run `pnpm build` to check `allowBuilds`.
2. `lib/mcp/`: `server.ts` (per-request `McpServer` + tool registration), `markdown-to-tiptap.ts`, `tiptap-to-markdown.ts`, `tiptap-validate.ts`, `image-check.ts`.
3. `app/api/mcp/route.ts` (§3 check order).
4. Tests:
   - each tool, the happy path;
   - each tool, denied for: guest (every tool, including `list_workspaces` leaving the workspace out), view-only (write tools), public-space member without a row (edit tools), other workspace, read token;
   - a user who is a guest in A and a member in B sees only B;
   - listless task;
   - image check rejects SVG, wrong bytes and over 10 MB;
   - rollback deletes uploaded files when the transaction fails;
   - converter round trips;
   - the validator rejects an unknown node or an unsafe link.
5. `DEPLOYMENT.md`: `client_max_body_size 45m;` and the Cloudflare note.
6. Manual acceptance against a local DB (`pnpm db:local`) with Claude Code:
   - connect with `claude mcp add`;
   - list my tasks;
   - get a task with an image in its description, and fetch the image via `get_attachment`;
   - comment with two screenshots;
   - complete the task.

   Check: an open Board updates live, watchers get notified, the activity feed shows the events, a revoked token gets `401` at once, and turning MCP off in Orbit gets `404`.

### Phase 4: docs and later work
1. User guide (create a token, connect Claude Code / Cursor, safety notes). Add this doc to the CLAUDE.md Feature Docs table, plus a short CLAUDE.md "MCP" section with the rules in §4.
2. Later: OAuth (§2.2), timer and task-creation tools, a "via MCP" badge (reads `meta.source`), the §7 fixes if not done.

---

## 9. Decisions (2026-10-27)

1. **Status permission:** Edit is required on the web and over MCP. The current View check is a bug, fixed in Phase 0 (§7.4).
2. **Guest tokens:** guests get **no** token access, per workspace (§2.1).
3. **Workspace-level opt-out:** no. Only the platform switch (§3).
4. **§7 fixes 1-2 (file access, SVG):** first reproduce both in the browser (BrowserOS Neo) against a local instance. Fix only after they are confirmed, as their own task with `docs/bugs/` pairs. **Both reproduced on 2026-10-27 (details in §7).** Fixes are not started yet.

---

## 10. Verification log (2026-10-27, `3eca52d`)

| Claim the plan relies on | Evidence | Result |
|---|---|---|
| Nothing intercepts `/api/mcp` | no `proxy.ts`/`middleware.ts`; catch-alls only under `api/auth`, `api/files` | OK |
| No framework body cap on route handlers | `next.config.mjs` has no body-size settings | OK (nginx example needs a fix) |
| SDK fits a Next route handler | `WebStandardStreamableHTTPServerTransport.handleRequest(Request) → Response`, stateless via `sessionIdGenerator: undefined` | OK |
| SDK works with `zod@4` | peer `zod ^3.25 \|\| ^4.0` | OK |
| No API-key plugin in installed Better Auth | no `./plugins/api-key` export; `@better-auth/api-key` needs `^1.7` | OK, own table |
| `banned` / `banExpires` columns exist | `db/schema/auth.ts:16-21` | OK, checked live |
| Tasks may have no list | `task.listId`/`spaceId`/`statusId` nullable; `getTaskLocation` uses `COALESCE` | Left join |
| Every list has a CLOSED status | `list.ts:820-847` | OK for `complete_task` |
| Sprint board uses statuses across lists | `sprint.ts:1085`, `sprint-list-view.tsx:1698` | Web rule = same space |
| Side-effect helpers need no request context | no `headers()`/`cookies()` in activity-log, notifications, realtime | OK |
| Inline images: storage key in `fileKey`, top-level block node | `hooks/use-note-image-upload.ts`, `note-image.tsx` | OK |
| Description save deletes unlinked inline images | `task.ts:733-770` | Pre-linked rows (§5.4) |
| `/api/files` needs a cookie | `app/api/files/[...key]/route.ts:10` | Images via `get_attachment` |
| `storage.upload` accepts Buffer | files-sdk `Body` type | OK |
| Dialog can't be dismissed by an outside click | `components/ui/dialog.tsx:173` | **Wrong** (found in Phase 1): the overlay closes on click. The token card blocks every close while the token is shown |
| Integration settings apply at once | `getRow` uses React `cache` only | OK |
| Account deletion is manual per table | `lib/user-deletion.ts:70-120` | Add explicit delete |
| Tests mock the DB | `vitest.config.ts`, `trash.test.ts` | Service-level mocks + manual acceptance |
| Single-instance deployment | `DEPLOYMENT.md`, Dockerfile `next start` | In-memory rate limit OK |

---

## 11. Phase 5: more tools, mentions, paging, shared rate limits (decided 2026-10-27)

### 11.1 New tools

| Tool | Input | Returns | Needs |
|------|-------|---------|-------|
| `list_projects` | `workspaceId?`, `includeArchived?` (false), `cursor?`, `limit?` | `{ items: [{ id, name, workspaceId, isPrivate, isArchived }], nextCursor }`, i.e. the projects the actor can see (`getAccessibleSpaceIds`; archived via `archivedOnly`) | read · view |
| `list_lists` | `projectId`, `includeArchived?` (false), `cursor?`, `limit?` | `{ items: [{ id, name, projectId, isArchived }], nextCursor }` | read · view |
| `list_members` | `workspaceId`, `query?` (name/email contains), `cursor?`, `limit?` | `{ items: [{ userId, name, email, role }], nextCursor }`: ACTIVE members, same data the web members list shows | read · member of the workspace |
| `create_task` | `listId`, `title` (1-500), `description?` (Markdown), `priority?`, `startDate?`, `dueDate?` (`YYYY-MM-DD`), `statusId?` (from that list), `assigneeIds?` | the new task (same shape as `list_my_tasks` items) | write · edit on the list's project |
| `create_subtask` | `parentTaskId`, `title`, `description?`, `priority?`, `dueDate?`, `assigneeIds?` | the new subtask | write · edit |
| `update_task` | `taskId` + any of `title`, `description` (Markdown, replaces the whole description), `priority`, `startDate`, `dueDate` (`null` clears) | the updated task | write · edit |
| `list_notifications` | `unreadOnly?` (true), `workspaceId?`, `cursor?`, `limit?` | `{ items: [{ id, type, title, body, isRead, createdAt, workspaceId, task: { id, number, url } \| null }], nextCursor }` for the actor only, honouring the token's workspace restriction and the guest rule | read |
| `mark_notifications_read` | `ids?` or `all: true` (+ `workspaceId?`) | `{ marked }`, only the actor's own notifications | write |
| `get_current_sprint` | `projectId`, `cursor?`, `limit?` | `{ sprint: { id, name, goal, startDate, endDate, status } \| null, tasks: { items, nextCursor } }`. "Current" = the project's `ACTIVE` sprint; if none, `sprint: null` and the next `PLANNED` sprint by `startDate` in `upcoming` | read · view |

Rules:
- `create_task` / `create_subtask` reuse the web `createTask` / `createSubtask` core through new services (`task-service.createTask`, `createSubtask`). That includes **`requireTaskCapacity` as the first statement of the inserting transaction**, assignee validation, the `task_created` fan-out (opt-in trigger), `task_assigned` for assignees and `mention_description` for mentions. The web actions become thin wrappers like in Phase 2.
- Status and assignees are not part of `update_task`; `set_task_status` and `assign_task` do that.
- Dates are calendar days (`docs/due-dates.md`): validate `YYYY-MM-DD` with the existing helpers, never `new Date("YYYY-MM-DD")`.
- `update_task.description` replaces the description. Saving a description deletes inline attachments it no longer references (`updateTask` sweep). So the Markdown converter must turn `![alt](attachment:<id>)` back into a `noteImage` node and `[name](attachment:<id>)` into a `noteFile` node, for ids that are inline attachments **of the same task**. Unknown ids are dropped to plain text. An agent that reads a description with `get_task` and writes it back unchanged must keep every image. Descriptions also allow `taskList`/`taskItem` (`- [ ]` / `- [x]`). Comments still don't.

### 11.2 Real mentions

- Syntax in `add_comment.text` and in descriptions: `<@userId>`, with the id taken from `list_members`. The converter emits a `mention` node `{ id, label: user's name, mentionSuggestionChar: "@" }` only if the user is an ACTIVE member of the task's workspace **and** can see the task's project (`canAccessSpace`). Otherwise it emits plain text `@name` (or the raw text), so nobody outside the task is notified.
- Notifications then come from the existing paths: `extractMentionIds` → `mention_comment` / `mention_description`.
- A bare `@name` stays plain text. Tool descriptions tell the agent to look up `list_members` and use `<@userId>`.
- `get_task` output renders mentions as `<@userId|Name>`, so a round trip keeps them.

### 11.3 Paging

- Every list tool takes `cursor?` + `limit?` and returns `{ items, nextCursor }` (`nextCursor: null` at the end). This applies to `list_my_tasks`, `search_tasks`, `list_projects`, `list_lists`, `list_members`, `list_notifications` and the `get_current_sprint` tasks. `get_task` takes `commentsCursor?` for older comments.
- The cursor is opaque base64url JSON of a keyset position (for example `{ createdAt, id }` or `{ name, id }`), never a bare offset. Invalid or tampered cursors → `isError` "Invalid cursor".
- Default limit 50, max 200 (search max 100).
- Breaking change for `list_my_tasks` / `search_tasks` output (array → `{ items, nextCursor }`). This is acceptable because nothing has been released yet.

### 11.4 Shared rate limits

The Phase 3 limiter was in memory: per process, reset on restart, and per token only.

- New table `rate_limit_counter (key text, window_start timestamptz, count int, primary key (key, window_start))`. `lib/rate-limit-db.ts` does a fixed-window `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` (one round trip, correct across processes and restarts).
- Rows older than 1 hour are deleted by the existing worker (`lib/worker/`, a small periodic job) and opportunistically.
- Limits per minute:

  | Key | Limit | Applies to |
  |---|---|---|
  | `mcp:token:<id>` | 120 | every request (HTTP 429 + `Retry-After`) |
  | `mcp:user:<id>` | 300 | every request, across all of a user's tokens (429) |
  | `mcp:write:<userId>` | 60 | every write tool (`isError` "Rate limit reached, try again in N seconds") |
  | `mcp:create:<userId>` | 30 | `create_task`, `create_subtask` |
  | `task-attachment:<userId>` | 60 | per uploaded file, MCP uploads only (the web upload route keeps its in-memory limiter) |

- If the database limiter errors, fail **open** for reads and **closed** for writes, and log it.
- The web's existing in-memory limits are unchanged.

### 11.5 Out of scope (decided)

Setup docs for other AI tools (Cursor, VS Code, ChatGPT, …) are skipped for now.

### 11.6 As built (2026-10-27)

**Cursors.** Each is base64url JSON `{ k: <kind>, ... }`. The kind is checked, so a cursor from one list is refused on another, and every field is checked against a strict shape (`lib/services/cursor.ts`). They only ever reach SQL as parameters in a row comparison (`(a, b, id) > (…)`), never as an offset.

| List | Order | Cursor fields |
|---|---|---|
| `list_my_tasks` | due end day, due start day (no date last), task id | `e`, `s` (days or null), `id` |
| `search_tasks` | last update (newest first), task id | `u` (database timestamp text), `id` |
| `list_projects` | workspace id, order index, project id | `w`, `o`, `i` |
| `list_lists` | order index, list id | `o`, `i` |
| `list_members` | name, user id | `n`, `i` |
| `list_notifications` | created at (newest first), notification id | `c` (timestamp text), `i` |
| `get_current_sprint` tasks | order index, task id | `o`, `i` |
| `get_task` comments | created at (newest first window), comment id | `c`, `i` |

Timestamps travel as the database's own text (`created_at::text`) and are cast back with `::timestamptz`, so microseconds are not lost. Services fetch `limit + 1` rows to know whether another page exists. The web My Tasks page still passes `limit: null` and loads everything.

**Deviations from §11.1 as written, and why.**
- `list_projects` / `list_lists` are ordered by the order shown in the app, not by name.
- `get_current_sprint` also returns `upcoming` (the next planned sprint when there is no active one).
- Notifications about a task are hidden once the task is trashed or the user can no longer see its project, and channel messages (`COMMENT` entity) are not offered. `mark_notifications_read` is limited to the allowed workspaces and, like the web endpoints, does not broadcast a refresh.
- `createTask` / `createSubtask` check, for web and MCP alike, that every assignee is an ACTIVE member who can see the project ("User cannot access this task"), and that a given `statusId` exists ("Status not found"): in the target list for MCP, in the same project for the web (the Sprint view mixes lists). See `docs/bugs/2026-10-27-bug-create-task-accepts-any-assignee.md`.
- `task-attachment:<userId>` is counted in the database for MCP uploads. The web upload route keeps its in-memory limiter (§11.4: web limits unchanged), so web and MCP uploads are no longer one shared counter.
- The request-level limit (`mcp:token`, `mcp:user`) fails open: if the database errors, the request is let through with the old in-memory per-token limit as a floor. Writes fail closed in the tool (they are refused with "rate limiter is unavailable").

**Descriptions.** Only inline attachments of the same task with no comment (`isInline` and `commentId` null) can be linked from a description; their storage keys, names, sizes and types come from the database. Embedded images and files may sit inside quotes and list items (the web editor allows it, and dropping them would make the sweep delete them). A list whose items all start with `[ ]` / `[x]` becomes a task list; a mixed list stays a bullet list. A literal `<@id>` typed by a person matches the mention syntax if that id is a valid mention target.

**Token page placement (as built).** The token UI moved off the Profile page to its own page, `app/(app)/[workspaceId]/api-tokens/page.tsx` ("API tokens & MCP"). It loads the session, the user's tokens, the eligible workspaces and `env.APP_URL`, and calls `notFound()` when `isMcpEnabled()` is false. The user-menu item (`KeyIcon`, after "Notification settings") is shown only when the workspace layout passes `mcpEnabled` (from `isMcpEnabled()`) to `WorkspaceShell`. `components/profile/mcp-connect-card.tsx` is an always-visible reference above the token card: server URL, the Claude Code command and the Claude app connector steps, with `kbn_YOUR_TOKEN` placeholders only. A real token still appears only in the one-time reveal dialog, which also shows the filled-in Claude Code command.
