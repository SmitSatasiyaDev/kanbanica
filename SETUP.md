# Getting Started with Kanbanica

Run Kanbanica on your own machine in **5–10 minutes**. No prior knowledge of the project needed — just follow the steps top to bottom.

Kanbanica is a project-management app (workspaces → projects → lists/sprints → tasks) with real-time collaboration and notifications. This guide gets a full local copy running: web app **and** the background worker, backed by a database — **without installing Postgres or Docker** (a local database is bundled).

---

## 1. Prerequisites (install these once)

You need three things. Check what you already have:

```bash
node --version   # must be 22.x  (see .node-version)
pnpm --version   # must be 9+    (project uses pnpm 11)
git --version    # any recent version
```

If any are missing:

| Tool | How to get it |
|------|---------------|
| **Node.js 22** | Install from <https://nodejs.org> (choose the "22 LTS" build), or with a version manager: `nvm install 22 && nvm use 22`. |
| **pnpm** | `npm install -g pnpm` (or `corepack enable` if you have Corepack). |
| **git** | <https://git-scm.com/downloads> |

> 💡 You do **not** need to install PostgreSQL or Docker. Kanbanica starts a private database for you in step 4.

---

## 2. Get the code

```bash
git clone https://github.com/sahaj-snapdevio/Kanbanica.git kanbanica
cd kanbanica
pnpm install
```

`pnpm install` downloads all dependencies. It takes a minute or two the first time.

---

## 3. Create your config file

Copy the example environment file. The defaults already work for local development — you don't need to edit anything to get started.

```bash
cp .env.example .env
```

That's it for now. (Email, Google login, and cloud file storage are all **optional** and covered in [Optional extras](#7-optional-extras) later.)

---

## 4. Start the database

Kanbanica ships with a self-contained PostgreSQL that runs from a local folder — nothing to install.

Open a terminal and run:

```bash
pnpm db:local
```

Leave this terminal **running**. When you see a line like:

```
Postgres running at postgresql://kanbanica:kanbanica@localhost:5432/kanbanica
```

…the database is up. The data is saved in a `.kanbanica-postgres/` folder, so it survives restarts.

> Keep this window open the whole time you use the app. To stop the database later, press `Ctrl+C` here.

> **Upgrading an older checkout?** If you already have a `.krova-postgres/` folder from before the rename, it keeps being used automatically — your local data is not lost, and your existing `DATABASE_URL` keeps working.

---

## 5. Set up the database tables (first time only)

Open a **second** terminal (leave the database running in the first one) and run:

```bash
pnpm db:migrate
```

This creates all the tables. You only need to run this once (and again after pulling changes that add new migrations).

---

## 6. Start the app

In that second terminal, run:

```bash
pnpm dev
```

This starts **two** things at once (you'll see color-coded logs):

- `next` — the web app at **<http://localhost:3000>**
- `worker` — the background worker (sends emails, notifications, reminders, sprint auto-close)

Open <http://localhost:3000> in your browser. 🎉

### Sign in (magic link)

Out of the box, Kanbanica uses passwordless **magic-link** sign-in.

1. On the login page, enter any email address (e.g. `you@example.com`) and submit.
2. Because email (SMTP) isn't configured yet, **the magic link is printed in your terminal** — look at the `worker`/`next` logs for a line containing a `http://localhost:3000/...` link.
3. Copy that link into your browser and open it. You're now signed in, and your account is created.

The email contains only the sign-in link. Opened in the browser that requested it, the link signs you in directly. Opened in a different browser or device, it instead shows a 6-digit verification code (valid 10 minutes, 5 attempts) to type under "Enter verification code" on the "Check your inbox" screen where you started. The code is never emailed or logged.

### Sign in with a password (optional)

If you'd rather use a normal email + password, set this in `.env` and restart:

```bash
ALLOW_PASSWORD_SIGNUP=true
```

A password field appears on `/login`, and `/signup` starts working. **With no SMTP
configured, registering signs you straight in — there's no verification email**, because
there'd be no way to deliver one.

Once you add SMTP (see [Real email](#real-email-smtp) below), signup switches to requiring
email verification: the account is created but can't sign in until the link is clicked. In
local dev that link is printed to the terminal too:

```
[verify-email] you@example.com → http://localhost:3000/api/auth/verify-email?token=…
[password-reset] you@example.com → http://localhost:3000/api/auth/reset-password/…
```

Passwords are 8–128 characters. `/forgot-password` only exists once SMTP is configured.

### Become an admin

**Fresh install (recommended):** the very first time you open the app with an empty
database, every page redirects you to the **setup wizard** at
[`/setup`](http://localhost:3000/setup). Create your administrator account there — it's
created as a platform admin and you're signed straight in. Nothing else to do; the page
disappears once the first user exists.

**Already created a user** (e.g. you signed in with a magic link first, or want to promote
an existing account), promote it from the terminal:

```bash
pnpm make:admin you@example.com
```

Use the same email you signed in with. Done — you now have full access.

> Alternatively, set `AUTO_PROMOTE_FIRST_ADMIN=true` before the first sign-in to auto-promote
> the first user instead of using `/setup`. See [DEPLOYMENT.md](./DEPLOYMENT.md) § "Create your
> first admin" for all the options.

---

## ✅ You're running!

You should now have:

| Terminal 1 | Terminal 2 | Browser |
|------------|------------|---------|
| `pnpm db:local` (database) | `pnpm dev` (app + worker) | <http://localhost:3000> |

Create a workspace, add a project, and start making tasks. Invite teammates from **Workspace Settings → Members** (`/[workspaceId]/settings/members`, Owner/Admin only) — by email invite or a shareable invite link. To cap team size, set optional member and guest limits under **Settings → Limits** (unlimited by default). The shared invite link can be given an expiry and a maximum number of uses from the same Members page.

**Learn the core concepts:** [docs/workspace.md](./docs/workspace.md), [docs/space.md](./docs/space.md) (Projects), [docs/list.md](./docs/list.md), [docs/views.md](./docs/views.md) (List/Board/Calendar), and [docs/sprint.md](./docs/sprint.md) cover the main building blocks. The full list is in [CLAUDE.md](./CLAUDE.md)'s "Feature Docs" table.

**To start again next time:** run `pnpm db:local` in one terminal and `pnpm dev` in another. (You do **not** need to repeat `pnpm install` or `pnpm db:migrate` unless dependencies or migrations changed.)

---

## 7. Optional extras

Everything below is optional — the app works fully without it in local development. Each has a step-by-step guide (creating the account, generating credentials, verifying it works, troubleshooting) in **[`docs/credentials/`](./docs/credentials/)** — the summaries below are just the quick version.

> All four of these can also be configured **from inside the app** instead of `.env` — Settings → Integrations, or the `/setup` wizard's "Configure services" step. A value saved there always takes priority over `.env`. SMTP, storage, and Web Push apply immediately; Google OAuth is the one exception that needs a restart. See **[docs/integrations.md](./docs/integrations.md)**.

### Real email (SMTP)
Without SMTP, emails (including magic links) are logged to the terminal instead
of sent — which is all you need for local development. To send real email, fill
these in `.env` (or configure them in Settings → Integrations instead — no
restart needed either way). Kanbanica works with **any SMTP provider** (Resend
recommended, or Brevo, Postmark, Amazon SES, SMTP2GO, …):

```
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=you@yourdomain.com
```

Restart `pnpm dev` after editing `.env` (not needed if you configure it via Settings → Integrations instead). Full walkthrough (provider choices,
domain verification, SPF/DKIM/DMARC, troubleshooting): **[docs/credentials/smtp.md](./docs/credentials/smtp.md)**.

### Google sign-in
Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`, or in Settings → Integrations, to enable "Sign in with Google" — either way needs a restart to activate. Leave blank to use magic links only. Full walkthrough (Google Cloud Console setup, exact redirect URI, common mistakes): **[docs/credentials/google-oauth.md](./docs/credentials/google-oauth.md)**.

### Cloud file storage (S3 / Cloudflare R2)
By default, uploads are stored in the local `./uploads/` folder. For production, set `STORAGE_DRIVER=s3` (or `r2`) and the `S3_*` credentials in `.env`, or configure the same fields in Settings → Integrations — no restart needed either way. Full walkthroughs: **[docs/credentials/storage-s3.md](./docs/credentials/storage-s3.md)** / **[docs/credentials/cloudflare-r2.md](./docs/credentials/cloudflare-r2.md)**.

### Web Push notifications
Set the `VAPID_*` keys in `.env`, or in Settings → Integrations, to enable browser push notifications — no restart needed either way. Full walkthrough: **[docs/credentials/web-push-vapid.md](./docs/credentials/web-push-vapid.md)**.

---

## 8. Handy commands

| Command | What it does |
|---------|--------------|
| `pnpm db:local` | Start the bundled local database (keep running) |
| `pnpm db:migrate` | Create/update database tables (development — uses `drizzle-kit`) |
| `pnpm db:migrate:prod` | Same, without `drizzle-kit`. This is what the Docker `migrate` container runs; it waits for the database and takes an advisory lock. |
| `pnpm dev` | Start web app + worker together |
| `pnpm dev:next` | Start only the web app (no worker) |
| `pnpm worker` | Start only the worker |
| `pnpm make:admin <email>` | Promote an existing user to admin |
| `pnpm db:reset` | ⚠️ Wipe the database and re-apply all migrations |
| `pnpm lint` / `pnpm typecheck` | Check code style / types |
| `pnpm build` | Production build |

---

## 9. Troubleshooting

**`DATABASE_URL is not set`** — You skipped step 3. Run `cp .env.example .env`.

**`pnpm db:migrate` errors with a connection refused** — The database isn't running. Make sure `pnpm db:local` is running in another terminal and shows "Postgres running…" before you migrate.

**Port 3000 already in use** — Another app is using it. Stop that app, or run `pnpm dev:next` on a different port with `next dev -p 3001` (and update `APP_URL` in `.env`).

**Port 5432 already in use** — A previous database is still running. Find and stop it, or delete the `.kanbanica-postgres/` folder to start fresh (this erases local data).

**I never got the magic-link email** — That's expected without SMTP. The link is printed in the terminal running `pnpm dev`. Search the logs for `localhost:3000`.

**Wrong Node version** — Run `node --version`; it must be `22.x`. Switch with `nvm use 22`.

**Start completely over** — Stop everything (`Ctrl+C` in both terminals), delete `.kanbanica-postgres/`, then repeat steps 4 → 5 → 6.

---

## 10. What's running under the hood

- **Web app** (Next.js) — the UI and API at `localhost:3000`.
- **Worker** — a separate process that handles background jobs (email, notification digests, due-date reminders, sprint auto-close). It's why `pnpm dev` starts *two* things.
- **Database** (PostgreSQL) — stores everything; runs locally from `.kanbanica-postgres/` in development.

In production these run as separate processes (web app + worker) against a managed PostgreSQL. See the deployment docs for details.

---

Questions or stuck? Open an issue — and welcome to Kanbanica. 🚀
