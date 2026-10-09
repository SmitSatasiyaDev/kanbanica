# Kanbanica — Claude Code Context

## What this project is

Kanbanica is a project management SaaS (ClickUp-style). Teams use it to organize work in Workspaces, Projects, Lists, Sprints, and Tasks.

Full product specs live in `docs/`. Read the relevant doc before implementing any feature.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Auth | Better Auth (with Admin Plugin) |
| Styling | Tailwind CSS v4 |
| UI Components | DaisyUI + hand-rolled primitives in `components/ui/`, positioned by a shared Floating UI-based overlay system |
| Rich Text | Tiptap |
| Emoji Picker | emoji-mart (`@emoji-mart/react` + `@emoji-mart/data`) |
| State | SWR (server) + React state/context (client) |
| Real-time | SSE via `lib/sse-clients.ts` — notifications + live `data_changed` broadcasts (`refreshWorkspace`); see `docs/realtime.md` |
| File Storage | files-sdk (local `fs` adapter in dev → S3/R2/GCS in prod) |
| Background Jobs | pg-boss |
| Email | Nodemailer (SMTP) |

---

## Project Structure

```
app/                       ← Next.js App Router
├── (auth)/                ← sign-in, onboarding (unauthenticated layout)
├── (app)/                 ← main app (authenticated layout)
│   └── [workspaceId]/     ← workspace-scoped routes
├── (orbit)/               ← platform admin panel (canonical — session-based)
├── actions/               ← server actions (primary location — most mutations live here)
├── api/                   ← API route handlers
└── admin/                 ← platform admin panel (legacy — password-based login; see docs/admin-panel.md)
components/
├── ui/                    ← UI primitives (DaisyUI + hand-rolled, see "UI Components" below)
└── common/                ← shared app components
config/                    ← platform config (branding, dev-database settings)
db/
├── schema/                ← Drizzle table definitions (one file per domain)
└── migrations/            ← generated SQL migrations
docs/                      ← feature specs, credential guides, architecture notes
hooks/                     ← custom React hooks
lib/
├── db.ts                  ← Drizzle client singleton
├── auth.ts                ← Better Auth server instance
└── utils.ts               ← shared utilities
public/                    ← static assets served at "/"
scripts/                   ← CLI scripts (migrations, admin bootstrap, local dev DB)
server/                    ← pinned-task / list-pin server actions (see app/actions/ for the primary location)
tasks/                     ← ad-hoc agent/dev planning notes — not app code
uploads/                   ← local file storage (STORAGE_DRIVER=local only), gitignored
```

---

## Key Decisions & Conventions

### UI Components
- **Always use the primitives in `components/ui/`** — never hand-roll a one-off dialog, dropdown, select, or input for a feature.
- **Tokens are daisyUI-native.** Style against `bg-base-100/200/300`, `text-base-content` (+ `/60` opacity for muted text), `bg-elevated` (custom — cards/popovers/modals), `bg-primary`/`text-primary-content`, `bg-error`/`text-error-content`, `bg-success`/`bg-warning`/`bg-info` (+ `-content`), `border-base-300`, `ring-ring`. The pre-migration shadcn-style names (`bg-background`, `text-foreground`, `bg-muted`, `border-border`, `bg-card`, `bg-popover`, `text-muted-foreground`, `bg-destructive`, `text-accent-foreground`, plain `bg-accent` as a neutral highlight, etc.) are retired — most no longer resolve to a real color. `pnpm lint:tokens` (`scripts/lint-tokens.sh`) fails the build if one reappears outside `components/ui/`. `bg-secondary`/`text-secondary-foreground` are the one deliberate exception, still on the old pale-neutral token — check current status before adding new usages. See `docs/design-system.md` § Color Palette for the full table and `.claude/plans/i-need-complete-migration-refactored-kite.md` for the migration's reasoning.
- Primitives use DaisyUI classes **only where they're a genuine structural fit** for the primitive's markup/behavior (`btn`, `card`, `input`, `select`, `badge`, `alert`, `tabs`, `table`, `progress`, `avatar`, `textarea`, `checkbox`/`radio`/`toggle` where backed by a real `<input>`). Where daisyUI's component class assumes different markup or an interaction model this app's primitive can't use — the floating-ui-based overlays (Dialog, Popover, DropdownMenu, Select, Tooltip, Sheet, AlertDialog) and the button-driven Switch/Checkbox — the primitive stays on its existing custom markup/behavior and only the **tokens** move to daisyUI's vocabulary, not the component class. Don't "finish the job" by swapping these to daisyUI's native `<dialog>`/checkbox-hack/`:checked`-driven mechanisms — that was a deliberate call, not an oversight.
- Every floating/overlay primitive shares one system: `components/ui/floating.tsx` (Floating UI-based portal, positioning, presence/exit-animation, dismiss-on-outside-click/Escape via the `overlayLayers` registry in `components/ui/overlay-stack.ts`) and `components/ui/overlay.tsx` (focus trap, scroll lock, return-focus). Reuse these hooks (`useFloatingPosition`, `useDismiss`, `usePresence`) for any new overlay — don't reimplement positioning or dismissal. These files have zero daisyUI/styling coupling and were untouched by the token migration.
- There is no CLI to generate a new primitive — add one by hand to `components/ui/`, following the pattern of the closest existing one.
- Custom components are only acceptable for app-specific composite UI that has no primitive equivalent.

### Emoji Picker
- **Library:** emoji-mart (`@emoji-mart/react` + `@emoji-mart/data`) — used because there's no built-in emoji-picker primitive.
- **Where it's used:** `components/task/task-activity-feed.tsx` — inserting emoji into the Tiptap comment composer and choosing comment reaction emoji.
- **Pattern:** dynamically import the picker (`dynamic(() => import("@emoji-mart/react"), { ssr: false })`), lazy-load `@emoji-mart/data`, render it inside a `Popover` (`components/ui/popover.tsx`), and pass `theme` based on the `.dark` class. Reuse this pattern for any new emoji picker — do not add a second emoji library.

### Slash ("/") Command Menu
- **Shared module:** `components/task/slash-command-menu.tsx` — exports `useSlashCommands`, `SlashCommandMenu`, `SlashCommandGrid`, `computeSlash`, and the `SlashCommand` type.
- **Where it's used:** the task description editor (`components/task/task-description-editor.tsx`) and the comment composer (`components/task/task-activity-feed.tsx`, where the composer's "+" button reuses `SlashCommandGrid`).
- **Pattern:** for any new `/` menu, reuse this module — wire `refresh` (onUpdate/onSelectionUpdate), `handleKeyDown` (editorProps), `close` (onBlur), and `setEditor`. Each `SlashCommand.run(editor)` must only invoke an **existing** editor action — the menu is a shortcut, not new formatting. Do not re-implement a second slash menu.

### Time Tracking (MVP)
- Time tracking is a **live timer + manual logging** feature (ClickUp-style MVP). Data lives in the seconds-based `timeEntry` table (`db/schema/time-tracking.ts`); the old minutes-based `time_log` table was **removed**. Do not re-add a minutes-based log.
- **Actions:** `app/actions/time-tracking.ts` — `startTimer` / `stopTimer` / `logTime` / `deleteTimeEntry` / `setTimeEntryNote`. At most one running timer per user (DB partial-unique index + app auto-stop on start). Each mutation writes an activity log (`timer_started` / `timer_stopped` / `time_logged`) and calls `refreshWorkspace`. Never write to the table on a per-second interval — the live clock ticks client-side only.
- **Entry notes** are optional and live in `timeEntry.description`. `logTime` takes one up front; the timer path collects it **after** the stop — `stopTimer` returns `{ entryId, seconds }` and the stop dialog attaches the note via `setTimeEntryNote`. Never prompt *before* stopping: the duration is computed server-side as `now - startTime`, so time spent typing would be billed to the task.
- **UI:** one shared section `components/task/task-time-tracking.tsx` (used by the full task page accordion and the drawer panel via `hideHeader`). List/Board cards show a `TrackedTimeBadge` (`components/task/tracked-time-badge.tsx`) of total *completed* tracked time.
- **Formatting:** `lib/format-duration.ts` — `formatDuration` ("3h 42m") and `formatTimer` ("HH:MM:SS"). Reuse these; don't reformat inline.
- **Out of scope (do NOT build):** estimates, remaining time, billable/rates, timesheets, reports, CSV, pomodoro, idle/screenshot, badge on Sprint & My-Tasks views, a global topbar timer widget. `task.timeEstimate` stays untouched (separate/future concern).

### User Avatars
- **Shared component:** `components/common/user-avatar.tsx` (`UserAvatar`) — use this everywhere a user avatar is shown. Props: `name`, `email`, `image` (storage key or null), `size` (`xs/sm/md/lg`), `className`.
- **Storage key → URL:** `user.image` in the DB is a storage key (e.g. `avatars/{userId}/{uuid}.webp`). Never use it directly as an `<img src>`. `UserAvatar` converts it internally. For files that use raw `AvatarImage` (e.g. task views with custom stacking styles), use the local helper `avatarSrc(key)` → `/api/files/${key}`.
- **Upload pipeline:** Sharp resizes to 256×256 WebP (quality 85) server-side before storing. Max raw upload: 2 MB.

### Confirmation Dialogs
- **Never use `window.confirm()` or `confirm()`** — always use the `Dialog` primitive (`components/ui/dialog.tsx`) with Cancel + destructive Delete buttons.
- Pattern: add `deleteOpen` / `deleting` state, a `confirmDelete` async function, and render the Dialog alongside the triggering component.
- The delete button sets `deleteOpen(true)`; `confirmDelete` does the actual deletion with a loading state.
- Standard layout: centered `TrashIcon` in a red circle, bold title, muted description, full-width Cancel + Delete buttons side by side.

### UI Consistency
- **Border radius:** All cards, modals, dialogs, popovers, and section containers must use `rounded-xl`. Buttons use `rounded-md`. Inputs use `rounded-md`. Never leave border radius missing on any surface.
- **Use the shared primitives only** — do not use native HTML `<select>`, `<input type="checkbox">`, `<input type="date">`, etc. Always use the equivalent primitive in `components/ui/` (Select, Checkbox, Calendar/DatePicker).
- **Spacing:** Use consistent padding inside cards (`p-6` via `--card-spacing`). Section gaps use `space-y-6`.
- Before shipping any UI, verify every interactive element and container has correct border radius, hover states, and focus rings matching the design system.

### Routing
- All workspace routes use `[workspaceId]` (uuid) — NOT slug. Slug is a vanity alias only.
- Route shape: `/[workspaceId]/[spaceId]/list/[listId]` or `/[workspaceId]/[spaceId]/sprint/[sprintId]`

### Auth
- Magic link is always available. Email + Password (sign-in always, sign-up opt-in via `ALLOW_PASSWORD_SIGNUP=true`) and Google OAuth (when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set) are additional, independently-configurable methods — all three converge on the same `session`/`user` rows. See `docs/authentication.md`.
- Better Auth handles sessions. Use `auth.api.getSession()` server-side.
- All API routes check session first, return 401 if missing.

### Integrations (Service Configuration)
- **What moved out of `.env`:** SMTP, Google OAuth, S3/R2 storage, and Web Push (VAPID) are now optional, DB-backed settings, configurable from Settings → Integrations (`/orbit/integrations`) or the `/setup` wizard's "Configure services" step — not just `.env`. Only `DATABASE_URL`, `APP_SECRET`, and `APP_URL` remain required.
- **Structure:** a single-row table (`integration_settings`, `db/schema/integration-settings.ts`), one column per field (`smtpHost`, `googleClientId`, `storageDriver`, `vapidPublicKey`, …, `*Encrypted` alongside each secret) — not a generic provider registry. `lib/integration-settings.ts` is the one file with a getter per concern (`getSmtpSettings()`, `getGoogleOAuthSettings()`, `getStorageSettings()`, `getWebPushSettings()`, `getIntegrationSettingsSummary()`). One form component per concern under `components/orbit/integrations/`, all sharing `IntegrationCard`. One server action, `saveIntegrationSettingsAction()` (`app/actions/integrations.ts`), taking a partial section-keyed body.
- **Resolution order, per field (everywhere, no exceptions):** DB column (if non-empty) → `.env` var → unconfigured. An existing `.env`-only deployment (the single row never written) behaves identically to before this system existed. No `enabled` flag — a section is "configured" simply by having its required fields present.
- **Encryption:** secret fields (SMTP password, OAuth client secret, storage access/secret keys, VAPID private key) are AES-256-GCM encrypted at rest (`lib/crypto.ts`'s generic `encryptSecret()`/`decryptSecret()`), keyed off `APP_SECRET` — never a second required env var. Secrets are never sent back to the client after saving — only a `has<Field>: boolean`.
- **Restart-required exception:** only Google OAuth — `lib/auth.ts` resolves it via a top-level `await getGoogleOAuthSettings()`, baked into the `betterAuth({...})` singleton once per process. SMTP, storage, and Web Push all resolve fresh per call/request — a saved change applies immediately, no restart.
- Full spec: `docs/integrations.md`.

### Database
- Drizzle ORM. Schema files in `db/schema/`, migrations in `db/migrations/`.
- All IDs are UUIDs (generated via `crypto.randomUUID()` before insert).
- All tables have `createdAt` and `updatedAt` (updated manually on each write).
- Soft deletes use `isArchived` + `archivedAt` pattern (not a deleted flag).
- Hard deletes are immediate with no recovery unless otherwise stated in the feature doc. **Tasks are the exception: deleting a task moves it to the Trash** (see "Trash" below).

### Permissions
- Two-level model: Workspace Role + Project Permission.
- Check workspace role first, then project permission for anything inside a project.
- Guests can only see Projects they are explicitly invited to.
- See `docs/permission-model.md` for the full matrix.

### API
- REST API under `/api/`.
- Always return `{ error: string }` on failure with the correct HTTP status.
- Never expose internal error messages to the client.

### File Uploads
- File storage is handled via **files-sdk** (`lib/storage.ts`) — a unified adapter layer.
- **Local dev:** `fs` adapter stores files in `./uploads/` and serves them via `/api/files/[...key]`.
- **Production:** swap adapter to S3/R2/GCS by setting `STORAGE_DRIVER` env var and credentials — no app code changes.
- The DB stores the **storage key** (e.g. `attachments/{workspaceId}/{taskId}/{uuid}/{filename}`) in the `file_url` column — never a full URL.
- Always delete the storage file before deleting the DB record (orphaned files are unrecoverable).
- Generate serving URLs on demand by calling `storage.url(key)` — never persist URLs.
- File size limit: 10 MB per file.

### Account Deletion
- **Block if sole owner**: before deleting, check `workspaceMember` for any workspace where this user is the only ACTIVE OWNER. If found, return an error telling them to transfer ownership first.
- **Storage cleanup**: delete the avatar file from storage (`storage.delete(user.image)`) before the DB transaction. Non-fatal — proceed even if it fails.
- **Full transaction order**: `notification` → `userNotificationPreference` / `userEmailPreference` / `mutedEntity` / `pushSubscription` → `userSearchHistory` / `savedFilter` / `userOnboardingProgress` → `taskAssignee` / `taskWatcher` / `timeEntry` / `commentReaction` / `checklistTask` → `spaceMember` / `workspaceMember` / `channelMember` → `session` / `account` / `user`.
- **Comments & activity logs are NOT deleted** — `comment.authorId` and `activityLog.userId` are plain `text` columns with no FK constraint, so orphaned values are safe. Queries use `.leftJoin(user, ...)` which returns `null` for deleted users. Fallback: `authorName ?? "Deleted User"` and `name ?? "Deleted User"` in the mapping layer.
- See full spec in `docs/settings.md` § 1.1a.

### Task Descriptions
- Stored as Tiptap JSON in a `jsonb` column (`description`).
- Full-text search on description is post-MVP.

### Real-time Sync
- Live collaboration is broadcast over SSE. **Every mutation (server action AND route handler) must call `refreshWorkspace(workspaceId, paths?)`** (`lib/realtime/refresh.ts`) after writing — it does the `revalidatePath` + the `data_changed` broadcast. Never call `broadcastDataChanged()` directly.
- **Gotcha:** the SSE `clients` registry in `lib/sse-clients.ts` is pinned to `globalThis`. Turbopack bundles route handlers and server actions separately, so a plain module-level `Map` gets duplicated and `pushToUser` reads an empty copy. Any in-memory singleton shared across route handlers + actions needs the same treatment.
- Client: `RealtimeProvider` (`components/realtime/`) — one EventSource, debounced refresh, **pause-while-busy** (editing / open overlay / dragging). List/Board/sidebar refresh via `router.refresh()`; Sprint via `useRealtimeRefetch`. Registry is in-memory per process (prod → Redis). Full detail in `docs/realtime.md`.

### Notifications
- `createNotifications()` (`lib/notifications/create-notification.ts`) is the single, **fire-and-forget** entry (errors are swallowed silently). Trigger types are a plain **text** column — add to `NOTIFICATION_TRIGGERS` (`lib/notifications/types.ts`) + a settings label, **no migration**.
- **Platform email master switch:** `integration_settings.notificationEmailsEnabled` (default `true`, DB-only, no `.env` fallback), toggled in Orbit → Settings → Notifications (`/orbit/settings/notifications`), read via `areNotificationEmailsEnabled()` (`lib/integration-settings.ts`). When off it blocks **notification** email only — the instant-email gate in `create-notification.ts` and the digest scan/send handlers. **Never gate `enqueueEmail()` itself**: it's shared with magic link, invites, password reset and support mail, which must keep working. In-app/push are unaffected; users' own email prefs are kept (the settings page just disables the email controls via `notificationEmailsEnabled` from `/api/me/notification-preferences`).
- User-facing titles say **"Project"**, never "Space" (`entityType` stays `"SPACE"`).
- For project-wide notifications (archive/restore) use **`spaceRecipientUserIds()`** (`app/actions/space.ts`) — public projects have no explicit `space_member` rows, so querying that table notifies nobody.
- Inbox click behavior lives in `getNotificationTarget()` (`notifications/page.tsx`): navigate or show an info-toast — never route to a broken page. See `docs/notifications.md` § Implementation Notes.

### My Tasks (global)
- `getMyTasks()` (`app/actions/my-tasks.ts`) is **cross-workspace** — it aggregates tasks assigned to the user across ALL their workspaces (union of `getAccessibleSpaceIds` per workspace), not just the current one. Navigate to a task via `task.workspace.id` (each task carries its workspace).

### Daily Checklist
- Personal, per-user recurring checklist on **one** page (`/[workspaceId]/daily-checklist`) — calendar/history/recurrence live inside it; do not add separate History/Calendar/Recurring pages. Items are `checklist_task` (not `task` rows); per-date completion lives only in `checklist_task_occurrence`, recurrence is evaluated on read (`lib/daily-checklist.ts`). Its mutations intentionally skip `refreshWorkspace()` (personal data). **Checklist history is never hard-deleted by task actions** — stop end-dates the series; delete is soft (`deleted_at` on the task, `removed_at` on occurrences). There is no archive feature. Full spec: `docs/daily-checklist.md`.

### Undo Toast
- For reversible actions (task/list archive & unarchive) use **`toastWithUndo(message, onUndo)`** (`lib/undo-toast.tsx`) — shows an "Undo" toast and wires **Ctrl/Cmd+Z** to the same undo. The `<Toaster>` is **bottom-right** (`app/layout.tsx`); the default ("normal") toast is inverted/elevated (`components/ui/sonner.tsx`). Do not add a second toast library.

### Space (Project) Landing Page
- `app/(app)/[workspaceId]/[spaceId]/page.tsx` redirects to the space's first non-archived list, or renders `EmptySpace` if it has none. After archiving a list or project, navigation goes here (or the workspace's first list) — **never to `/onboarding`**. The workspace-home + onboarding pages search **all** accessible spaces (not just the first) before falling back to onboarding.

### Trash (Deleted Tasks)
- `deleteTask` / `bulkDeleteTasks` are **soft deletes**: they set `task.deletedAt/deletedBy` (+ `deletedWithParentId` on subtasks trashed with a parent) via `softDeleteTasks()` (`lib/trash.ts`). Nothing is removed — comments, history, time entries and attachment files stay until a permanent delete.
- **Every read of `task` must AND in `notDeleted()`** (`lib/task-visibility.ts`). Exceptions: the Trash itself, the task-limit count, and hard-delete cascades.
- **Trashed tasks still count toward `workspace.maxTasks`** until permanently deleted (restore needs no capacity check).
- Trash UI/actions are **Owner/Admin only**: bottom user menu → Trash (`/[workspaceId]/trash`, `app/actions/trash.ts`; not a Workspace Settings tab). Permanent delete = `purgeTasks()` (storage files first, then rows), also run automatically: job `trash.auto-purge` (daily + on worker boot) purges tasks whose `deletedAt` is 30+ days old (`lib/trash-retention.ts`, `lib/worker/handlers/trash-auto-purge.ts`). Manual *Delete forever*, *Empty trash* and the job all go through the shared locked, storage-first `purgeTrashedTask()` (a storage failure leaves the task in Trash and retries next run).
- Deleting a list/project/workspace is still a hard cascade (trashed tasks inside are lost); `deleteList`/`deleteSpace` delete files first via `deleteStorageForTasks`.
- Full spec: `docs/trash.md`.

### Folder
- Folder is **post-MVP**. Do not implement it. `folder_id` on List is nullable and always null in MVP.

### Custom Fields
- Definitions are scoped to workspace/space/list (`db/schema/custom-field.ts`); "which fields apply here" is a **union across scopes**, not an override chain (`queryFieldDefinitions()` in `app/actions/custom-field.ts`). Project Settings → Custom Fields (`components/space/custom-fields-settings.tsx`) only manages **space-scoped** fields today — workspace-wide/list-scoped are backend-supported but have no settings UI yet.
- **Archive vs Delete are separate, non-overlapping paths.** Archive is reversible and keeps stored values; Delete (`deleteCustomFieldDefinition`) is permanent and cascades to every `customFieldValue` row (`onDelete: "cascade"` on the FK — no manual cleanup query needed). Delete requires the standard confirmation `Dialog` (never `window.confirm`), never the reverse.
- A field's **type cannot change after creation** — the Edit form (which reuses the Create dialog, `FieldFormDialog`) disables the Type select rather than migrating existing values/config.
- Permission is `requireFieldAdmin()`: **Full Access** on the Space for a space-scoped field, or **Workspace Owner/Admin** for a workspace-wide one (no space to check). The List/Board "Manage Custom Fields" toolbar shortcut reuses the same page-level `canManage` (`spacePermission === "full_access"`) flag, not `isAdmin`.
- **Filters and Columns are hidden entirely when a project has zero active custom fields** (`filterFields.length > 0` / `columnOptions.length > 0`) — a control with nothing to act on is confusing, not helpful. Because of that, the **Manage Custom Fields** icon shortcut (`components/common/manage-fields-icon.tsx`, placed right after Columns) is the one control shown regardless of field count — it's how a permitted user reaches the settings page to create the first field.
- `FacetOptionList` (`components/filters/facet-filter.tsx`) took on optional `searchPlaceholder` / `clearLabel` / `showClearDivider` / `maxListHeight` props for the Columns/Filters pickers — all default to the original behavior, so don't assume every caller needs them.
- Full spec: `docs/custom-fields.md`.

### Task Import/Export (CSV, MVP)
- **Export** (`app/api/lists/[listId]/export`, `app/api/spaces/[spaceId]/export`, both `GET` route handlers): generates CSV for the current list, a selection of tasks (`?taskIds=`), or a whole project. Gated by `requireViewAccess` only — never exposes data outside the caller's permissions. Core query logic lives in `lib/import-export/export-tasks.ts`; CSV generation is `lib/import-export/csv.ts` (`papaparse`-backed, RFC4180-correct escaping).
- **Import** is a route-handler pipeline, not server actions (`app/api/lists/[listId]/import/validate` and `.../import/confirm`) — same reasoning as attachment uploads: avoids the smaller server-action body-size limit. Upload → Map → Preview → Confirm → Result wizard lives in `components/import-export/import-wizard.tsx`, gated by the same edit-level permission `createTask` requires.
- **Validation is pure and reused in both steps**: `lib/import-export/validate-row.ts`'s `validateImportRow()` takes a pre-fetched `ValidationContext` (no DB calls of its own) so the `/validate` preview and the `/confirm` re-check run identical rules against possibly-different data.
- **Bulk creation does not loop `createTask()`** (`lib/import-export/bulk-import-tasks.ts`) — it mirrors `duplicateTask`'s bulk-insert approach (batched `taskSeq` reservation, one transaction, map-based parent-id resolution) instead, since looping would mean N sequential `taskSeq` round-trips and N space-wide notification fan-outs. It still enforces the exact same rules `createTask`/`setCustomFieldValue` do (reuses `validateCustomFieldValue` directly) — batching the business logic, not bypassing it.
- MVP limits: **200 rows / 2 MB** per file (`lib/import-export/limits.ts`), enforced client- and server-side. Raising this later means wiring a pg-boss job around the same `bulkImportTasks()` call, not a rewrite (`lib/worker/` already exists).
- Full spec: `docs/import-export.md`.

### Workspace Task Limit
- **Setting:** `workspace.maxTasks` (`db/schema/workspace.ts`, nullable `integer`). **`null` = unlimited** (the default for every existing workspace — migration is a nullable column, no backfill). Valid values when set: integer 1…10,000,000. Edited by Workspace **Owner/Admin** only via `updateWorkspaceTaskLimit` (`app/actions/workspace.ts`, reuses the local `requireAdmin`) from Settings → **Limits** (`app/(app)/[workspaceId]/settings/limits` — one page holding both the Task Limit and Member & Guest Limits cards; `components/workspace/limits-settings-form.tsx`). No quota table, usage table or counter column — usage is computed.
- **What counts:** `COUNT(*) FROM task WHERE workspace_id = ?` — active, completed, **archived**, **trashed**, subtasks and orphaned rows all count. Deleting a task only moves it to the Trash, so **capacity is freed only when it is permanently deleted (manually from the Trash, or by the 30-day auto-purge); archiving does not free it either**. Archive/unarchive/move/edit/complete/delete are never gated. Lowering the limit below current usage is allowed (nothing is deleted; creation stays blocked until usage drops).
- **Single gate:** `requireTaskCapacity(tx, workspaceId, n)` (`lib/workspace-limits.ts`). **Every task-creating path must call it as the first statement of the transaction that inserts the task rows** — it locks the workspace row (`SELECT … FOR UPDATE`), counts only if a limit is set, rejects when `used + n > maxTasks`, then reserves `n` `taskSeq` numbers and returns `seqBase` (new tasks get `seqBase+1…seqBase+n`). A rejection writes nothing, so no seq numbers are burned. Never bump `workspace.taskSeq` anywhere else, and never do an unlocked count-then-insert.
- **Protected paths:** `createTask`, `createSubtask`, `duplicateTask` (task + non-archived subtasks), `duplicateList` (every copied task), `bulkImportTasks`. The onboarding sample task is intentionally exempt (brand-new workspace). Any new creation path (API, job, integration) must use the gate.
- **Batches are all-or-nothing:** a duplicate/import that doesn't fit is rejected whole. Import: `/import/validate` returns informational `capacity`, the wizard disables Import when selected rows exceed it, and `/import/confirm` re-checks under the lock and returns **HTTP 409**. Capacity errors carry `code: "TASK_LIMIT_REACHED"` (`lib/task-limit.ts` — pure/client-safe constants + message, re-exported by `lib/workspace-limits.ts`).
- **UX:** `TaskLimitBanner` (`components/workspace/task-limit-banner.tsx`) — ≥90% shown to Owner/Admin, 100% shown to everyone. Display only; enforcement is server-side. Call sites of create actions must surface `res.error` (toast) — never swallow it.
- Full detail: `docs/import-export.md` § Workspace task limit.

### Workspace Member Limits
- **Settings:** `workspace.maxMembers` and `workspace.maxGuests` (`db/schema/workspace.ts`, nullable `integer`; **`null` = unlimited**, the default for every existing workspace — migration is two nullable columns, no backfill). Members = OWNER + ADMIN + MEMBER; guests = GUEST. Valid values: members 1…100,000, guests 0…100,000 (0 = no guests). Edited by Owner/Admin via `updateWorkspaceMemberLimits` (`app/actions/workspace.ts`, reuses the local `requireAdmin`) from the same Settings → **Limits** page (`settings/limits`; the old `settings/member-limits` route redirects there; `components/workspace/member-limits-settings-form.tsx`). No quota table or counter column — usage is computed.
- **What counts:** `getWorkspaceMemberUsage()` (`lib/workspace-limits.ts`) — `ACTIVE` rows plus **unexpired** `INVITED` rows, split by bucket. A pending invite reserves a seat, so **accepting an invite (`acceptInvite`, `activatePendingInvites`) is intentionally not gated**; removing a member or cancelling/declining an invite frees a seat. Lowering a limit below usage is allowed (nobody is removed; new invites/joins stay blocked).
- **Single gate:** `requireMemberCapacity(tx, workspaceId, bucket, n)` — call it as the **first statement of the transaction** that adds a seat. It locks the workspace row (`FOR UPDATE`, the same row the task gate locks), counts only if that bucket has a limit, rejects when `used + n > limit`, writes nothing. Errors carry `code: "MEMBER_LIMIT_REACHED" | "GUEST_LIMIT_REACHED"` (`lib/member-limit.ts` — pure/client-safe constants, `memberBucket(role)`, messages).
- **Gated paths:** `inviteMember` (gate + duplicate check + insert in one transaction; email after commit), `joinViaLink` (after the already-a-member short-circuit), `resendInvite` (only when the invite had **expired** — it re-takes a seat), `changeMemberRole` (only when moving between members and guests; gates the destination bucket). `transferOwnership` and MEMBER↔ADMIN changes stay in the member bucket and are not gated. The onboarding owner row is exempt (new workspace). Any new path that adds or revives a seat must use the gate.
- **UX:** the Members page shows usage and disables the invite button / shows a hint on the invite-link card when a bucket is full (display only). `/api/join/consume` redirects to `/join/[token]?error=member_limit|guest_limit` so a full workspace explains itself instead of failing silently.

### Invite Link Controls
- **Settings:** three columns on `workspace` — `inviteLinkExpiresAt` (nullable timestamptz), `inviteLinkMaxUses` (nullable int), `inviteLinkUses` (int, default 0). **Defaults (`null`/`null`/`0`) = never expires, unlimited uses**, so existing links behave exactly as before. One shared link per workspace; role stays `inviteLinkRole`.
- **State function:** `getInviteLinkState()` (`lib/invite-link.ts`, pure/client-safe) → `disabled | active | expired | exhausted` (expired wins). It is the single source of truth for the server gate, the join page and the invite-link card; presets (`INVITE_LINK_EXPIRY_PRESETS` 1/7/30/90 days, `INVITE_LINK_MAX_USES_PRESETS`) and fixed messages/codes (`INVITE_LINK_EXPIRED` / `INVITE_LINK_EXHAUSTED`) live there too.
- **Enforcement (only consumer is `joinViaLink`):** in the join transaction the order is **`requireMemberCapacity` → `consumeInviteLinkUse` (`lib/invite-link-server.ts`) → member insert**. `consumeInviteLinkUse` re-reads the link under the workspace row lock, checks the token still matches (a regenerate/disable racing a join is refused), rejects expired/exhausted, and only then increments `inviteLinkUses`. Capacity runs first and writes nothing, so a full workspace never burns a use. An existing member re-opening the link is an idempotent success that consumes nothing. Uses are a counter (not derivable from member rows — removed members free their seat but the use stays consumed).
- **Admin actions (`app/actions/workspace.ts`, Owner/Admin via `requireAdmin`):** `updateInviteLinkSettings({ workspaceId, expiresInDays: preset | null | "keep", maxUses: null | 1…10,000 })` (needs an active link; never touches the use count; lowering max uses below current uses just exhausts the link). **`regenerateInviteLink` (also "Enable") is a clean slate:** new token, uses 0, no expiry, no max uses; role is kept. Disable only clears the token.
- **UX:** the invite-link card shows "Expires in N days · X of Y uses" plus Expires / Max uses selects (saved immediately). Dead links show a warning on the card and a specific message on `/join/[token]`; `/api/join/consume` redirects with `?error=link_expired|link_exhausted` (fixed messages keyed by short code).

### Bug Fix Documentation
- **Whenever a bug is fixed, record it as two Markdown files in `docs/bugs/`** (create the folder if missing):
  1. `{YYYY-MM-DD}-bug-{bug-title}.md` — describes the bug: symptom, where it happened, root cause.
  2. `{YYYY-MM-DD}-solution-{solution-title}.md` — describes the fix: what was changed, files touched, why it works.
- Use today's date (`YYYY-MM-DD`) and a short kebab-case title. Keep the `bug-` and `solution-` titles matching so the pair is easy to find.
- Example: `2026-07-20-bug-autofill-popup-drifts-on-scroll.md` + `2026-07-20-solution-autofill-popup-drifts-on-scroll.md`.

---

## Feature Docs (read before implementing)

| Feature | Doc |
|---------|-----|
| Auth | `docs/authentication.md` |
| Workspace | `docs/workspace.md` |
| Project (Space) | `docs/space.md` |
| List | `docs/list.md` |
| Task | `docs/task.md` |
| Subtask | `docs/subtask.md` |
| Sprint | `docs/sprint.md` |
| Workspace Overview | `docs/workspace-overview.md` |
| Pinned Tasks | `docs/pinned-tasks.md` |
| Views | `docs/views.md` |
| Calendar View | `docs/calendar-view.md` |
| Time Tracking | `docs/time-tracking.md` |
| Daily Checklist | `docs/daily-checklist.md` |
| Collaboration | `docs/collaboration.md` |
| Real-time Sync | `docs/realtime.md` |
| Notifications | `docs/notifications.md` |
| Search & Filters | `docs/search-and-filters.md` |
| Custom Fields | `docs/custom-fields.md` |
| Task Import/Export | `docs/import-export.md` |
| Trash (Deleted Tasks) | `docs/trash.md` |
| Permissions | `docs/permission-model.md` |
| Settings | `docs/settings.md` |
| Integrations | `docs/integrations.md` |
| Admin Panel | `docs/admin-panel.md` |
| Empty States | `docs/empty-states.md` |
| Design System | `docs/design-system.md` |
| UI Redesign Guide | `docs/ui-redesign.md` |
| Database Schema | `docs/database-schema.md` |

---

## Development Plan

Feature-by-feature specs live in the `docs/` files listed above — read the relevant doc before implementing a feature. Historical build phases and retroactive-change notes live in `docs/internal/` for reference; they describe how the project was originally built and are not required reading for contributing a change.
