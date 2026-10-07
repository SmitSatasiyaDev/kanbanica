# Changelog

All notable changes to Kanbanica are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning policy

Given a version `MAJOR.MINOR.PATCH`:

- **MAJOR** — incompatible changes: database migrations that require manual
  steps, removed/renamed environment variables, or breaking API changes.
- **MINOR** — new features and enhancements that are backward compatible.
- **PATCH** — backward-compatible bug fixes and small improvements.

Until `1.0.0`, the project is considered pre-release: `0.x` versions may include
breaking changes in a MINOR bump. From `1.0.0` onward, the rules above apply
strictly. Each release is tagged `vX.Y.Z` in git.

<!--
Maintainers: when cutting a release, move items from "Unreleased" into a new
dated section, e.g.:

## [1.0.0] - 2026-08-01
### Added
### Changed
### Fixed
-->

## [Unreleased]

### Added
- **User and workspace timezones for the Checklist.** Checklist dates, recurrence,
  start/end dates and generation (worker and on-demand) now use the user's timezone, then
  the workspace timezone, then UTC — no longer the notification digest timezone. Set it in
  Profile Settings → Timezone (auto-detected from the browser on first use) and Workspace
  Settings → General. Past days never move. Adds migration `0032_timezones` (two nullable
  columns, additive).
- **Checklist.** A personal daily checklist ("My Checklist") plus recurring
  Team Checklists that Owners/Admins define as templates and assign to members. Every
  user gets their own copy each day, and past days are saved read-only history that
  later template edits never change. Sidebar → *Checklist*; management at
  bottom user menu → *Checklist admin*. Adds migration `0030_daily_checklist`
  (additive) and the `daily-checklist.generate` worker job. See docs/daily-checklist.md.
- **Custom fields on Team Checklist templates.** Owners/Admins can add Text, Dropdown,
  Number, Date and Checkbox fields (optionally required) to a template; members fill
  them in per item from a *Details* dialog. Each day snapshots the fields it was generated
  with, so later template edits never change past days. Adds migration
  `0031_daily_checklist_fields` (additive). See docs/daily-checklist.md.
- **Checklist: instant checklist for newly added assignees.** Adding a user to an
  active Team Checklist template now creates their checklist for today right away instead of
  at the next worker run or page open. Existing users' days are never changed. No migration.
- **Checklist: checkbox + note on Team Checklist rows.** The Status dropdown column is replaced by a checkbox (Done = checked, Pending/In progress = unchecked) and an optional note action stored in the existing item `notes` field. No migration.
- **Checklist: aggregate note count on shared Team rows.** A collapsed row with several assignees shows how many members have a saved note; clicking it expands the members. No migration.
- **Verification-code sign-in.** A magic link opened in a different browser shows
  a 6-digit one-time code (not emailed) to enter where sign-in started. Codes are stored
  hashed, expire after 10 minutes, lock after 5 wrong attempts, and are rate
  limited per IP and per email. No migration required. A magic link opened in a
  different browser than the one that requested it no longer signs in directly;
  it shows the code (copy button, or "Sign in here instead") at `/login/code`.

## [0.4.0] - 2026-10-05

### Added
- **Trash for deleted tasks.** Deleting a task (or bulk-deleting) now moves it to a
  workspace Trash instead of removing it. Owners and admins can restore tasks or
  delete them forever from the user menu → Trash; tasks left in the Trash for 30
  days are purged automatically. Trashed tasks still count toward the workspace
  task limit until permanently deleted. See `docs/trash.md`.
- Platform-wide switch to turn notification emails on or off (Orbit → Settings →
  Notifications). Magic-link, invite and password-reset emails are unaffected.
- Member search in the assignee pickers, and an Orbit Settings landing page.
- Each subtask row on Board cards shows a status dot with the subtask's own
  status name on hover.
- Web Push: server-side VAPID key generation in Integrations settings.

### Changed
- Invite links: the invite page and post-auth handling were reworked so logged-out
  and mismatched-account visitors land in the right place.
- Web Push VAPID subject is normalized when saved.

### Fixed
- **Sprint auto-close never ran** — the job is now registered and scheduled.
- The comment composer no longer grows without bound on large pastes.

### Upgrade notes
- Two new database migrations (task trash, notification-email toggle) are applied
  automatically on start. No environment variable changes.

## [0.3.0] - 2026-10-02

### Added
- First-time users with no display name are asked for one (`/complete-profile`)
  before an invitation is auto-accepted or an invite link is joined.
- Workspace owners and admins are notified when someone joins through the
  shared invite link.
- **One container is now a complete deployment.** Run the image with no command
  and it applies pending migrations, then runs the web server *and* one
  background worker together — the flow you get from a platform that deploys a
  registry image once (Dokploy, Coolify, CapRover, a bare `docker run`). A new
  entrypoint (`scripts/docker-entrypoint.sh`) picks the role; both processes are
  supervised, so if either one exits the container exits and your restart policy
  brings the pair back.
- `KANBANICA_ROLE` selects the role by environment instead of by command:
  `all` (the default — migrate + web + worker), or `app`, `worker`, `migrate`
  individually. Useful where setting an env var is easier than overriding a
  container's command.
- `KANBANICA_RUN_MIGRATIONS=false` skips the migration step, for a managed
  database whose application user may not run DDL. Defaults to `true` for
  `all`/`migrate` and `false` for `app`/`worker`.
- `.gitattributes` pinning `*.sh` to LF, so a Windows checkout can't bake a CRLF
  entrypoint into an image built with `docker-compose.build.yml`.

### Changed
- The image's default `CMD` is a sentinel (`kanbanica`) read by the new
  `ENTRYPOINT`, rather than `pnpm start`. **Any explicit command is still run
  verbatim**, which is how all three compose services continue to select their
  role — see the upgrade notes.
- `HEALTHCHECK --start-period` raised from 40s to 90s: in the default `all` role
  the web server starts only after migrations have been applied, and the
  migration step itself waits for a cold database.

### Fixed
- **Invitation acceptance showed "Invitation invalid" / "Unauthorized"** even
  though the invitation had been accepted. The invite page now checks the
  invite's state first, treats an invite already accepted by the current user as
  success, and shows a distinct message per error. A logged-out visitor's
  `/invite/<token>` now survives login. Blank user names fall back to the email
  in notification titles and the project Add Member dropdown. Documented in
  `docs/bugs/2026-10-02-bug-invite-accept-shows-invalid-and-blank-names.md`.
- **Background worker never started on a single-container deploy.** Pointing
  Dokploy (or any platform that runs the image once) at the registry image gave
  the web server alone: no worker, and no migrations. Because email is enqueued
  by the app and sent by the worker, magic-link sign-in silently never arrived —
  and `/api/health` passed throughout, so nothing looked wrong. Documented in
  `docs/bugs/2026-10-02-bug-worker-not-started-on-single-container-deploy.md`.

### Upgrade notes
- **Nothing to do for a `docker-compose.yml` deployment.** `docker compose pull
  && docker compose up -d` is the whole upgrade. All three services set
  `command:` explicitly, and the entrypoint runs an explicit command verbatim —
  behavior is unchanged. No migration needs manual steps, no environment
  variable changed, and both volume names and the runtime uid/gid (1001) are
  untouched.
- **Deploying a single container? Clear the command field.** If your platform's
  app has a command override set (e.g. `pnpm start` carried over from an earlier
  release), that still wins and you will still get the web server alone. Leave it
  empty to get migrate + web + worker.
- **Keep a single-container deployment at one replica.** Each replica would run
  its own worker, and two workers can double-process jobs. To scale the web tier,
  split the roles instead (`KANBANICA_ROLE=app` plus one `KANBANICA_ROLE=worker`)
  — and see the single-app-instance limit in `DEPLOYMENT.md` § 9.
- **Don't set `PORT`.** The image's `HEALTHCHECK` probes `:3000` inside the
  container; map the port externally instead.

## [0.2.0] - 2026-10-01

### Added
- Published-image install path: `docker compose up -d` now pulls
  `ghcr.io/stack256org/kanbanica` instead of building on your server. New
  `docker-compose.build.yml` covers build-from-source.
- `docs/releasing.md` documenting the release pipeline, and product screenshots
  in `docs/screenshots/`.
- `pnpm docs:sync` / `pnpm docs:check` (`scripts/sync-readme.mjs`) keep the
  README's `docker pull` block in step with `package.json`.

### Changed
- Docker: one image now serves all three roles (`app`, `worker`, `migrate`),
  selected by `command:` — `Dockerfile.worker` is removed and
  `next.config.mjs` no longer uses `output: "standalone"`. The image ships the
  real source tree with a `--prod` `node_modules`, so `pnpm worker:start`,
  `pnpm db:migrate:prod` and the admin-recovery scripts all run inside any
  container. This also removes the hand-maintained copy of sharp's native
  libvips that the standalone file-tracer needed.
- `docker-compose.yml` now **pulls the published image** instead of building
  locally (`docker compose up -d`, no `--build`), with `IMAGE_TAG` to pin a
  version and `APP_PORT` to move the host port. Build-from-source moved to the
  new `docker-compose.build.yml`; `docker-compose.external-db.yml` still
  overlays either one. Volume names are unchanged, so existing deployments
  reattach to their data.

### Fixed
- Documented commands that could not work: `pnpm worker:start` /
  `pnpm db:migrate:prod` were listed for an image with no `pnpm` in it, and
  `curl localhost:3000` was documented while the compose file bound no host
  port.
- README links, and the release workflow's handling of the commit CI actually
  tested (`workflow_run.head_sha` rather than `github.sha`).

### Upgrade notes
- **Nothing to do for a `docker-compose.yml` deployment.** `docker compose pull
  && docker compose up -d` is the whole upgrade. No migration needs manual
  steps, no environment variable changed, and both volume names and the
  runtime uid/gid (1001) are untouched.
- **`Dockerfile.worker` no longer exists.** If your platform (Dokploy, Coolify,
  Kubernetes, …) has a service configured to build from that path, point it at
  the single published image with `command: pnpm worker:start` instead. Same for
  a migration service: `command: pnpm db:migrate:prod`.
- **`docker compose up -d --build` no longer builds anything** — the default
  compose file has no `build:` section. Use
  `docker compose -f docker-compose.build.yml up -d --build`.
- **The app now binds a host port** (`${APP_PORT:-3000}:3000`), where before it
  only used `expose:`. Behind a reverse proxy on the same Docker network,
  replace that block with `expose: ["3000"]`, or set `APP_PORT` to something
  free.

## [0.1.0] - 2026-08-17

### Added
- Open-source release preparation: `LICENSE` (MIT), `README`, `CONTRIBUTING`,
  `SECURITY`, `CODE_OF_CONDUCT`, issue/PR templates, and CI (typecheck + build).
- Self-hosting support: application `Dockerfile`, `docker-compose.yml`,
  `/api/health` endpoint, container-safe migration runner, and `DEPLOYMENT.md`.
- Local-development guide (`SETUP.md`) and architecture overview
  (`ARCHITECTURE.md`).
- Configurable object storage via `STORAGE_DRIVER` (local / S3 / R2).
- Environment-overridable branding (support email, marketing domain).

### Changed
- Production startup now requires at least one authentication provider
  (SMTP or Google OAuth) so login cannot silently fail.

### Notes
- This is the pre-1.0 development line. The first public release will be tagged
  `v1.0.0` after the Release Candidate verification pass.
