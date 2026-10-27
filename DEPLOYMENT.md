# Deploying Kanbanica (Self-Hosting for Teams)

This guide runs Kanbanica in **production on your own server** so your team can use it. It's the production counterpart to [SETUP.md](./SETUP.md) (which covers local development).

> **Two ways to run Kanbanica:**
> - **Local development** — contributors use `pnpm db:local` + `pnpm dev` (see [SETUP.md](./SETUP.md)). Unchanged.
> - **Self-hosting** — teams use **Docker Compose** (this guide). This is an *additional* option, not a replacement.

The stack runs as three long-lived services plus a one-shot migration step:

| Service | Command | What it does |
|---------|---------|--------------|
| **postgres** | — | The database (with a persistent volume). |
| **migrate** | `pnpm db:migrate:prod` | Applies pending DB migrations, then exits. Runs automatically on `up`. |
| **app** | `pnpm start` | The Next.js web server on port 3000. |
| **worker** | `pnpm worker:start` | Background jobs: email, notification digests, due-date reminders, sprint auto-close. **Run exactly one.** |

`migrate`, `app` and `worker` are **the same image** with a different `command:` — see [Why one image](#why-one-image). You never build or pull a second one.

> **Deploying on a platform that runs the image once** (Dokploy, Coolify, CapRover, a bare `docker run`)? You don't have to split it up. Given **no** command, the image migrates and then runs the web server *and* the worker in that one container — see [Platforms that aren't Docker Compose](#platforms-that-arent-docker-compose).

Three compose files, and you use exactly one as the base:

| File | When |
|---|---|
| `docker-compose.yml` | **The normal one.** Bundled Postgres, pulls the published image. |
| `docker-compose.build.yml` | Building from source, because you changed the code. |
| `docker-compose.external-db.yml` | An *overlay* for your own Postgres. Layers onto either of the above. |

---

## 1. Prerequisites

- A Linux server with **Docker** and the **Docker Compose plugin** (`docker compose version`).
- A **domain** pointed at the server (e.g. `tasks.yourcompany.com`).
- **An authentication provider** — SMTP, Google OAuth, or `ALLOW_PASSWORD_SIGNUP=true`, configured either in `.env` (see step 3) **or from inside the app** after first boot (Settings → Integrations, or the `/setup` wizard's "Configure services" step — see [docs/integrations.md](./docs/integrations.md)). At least one is needed for anyone besides the first admin to sign in, but the app boots and `/setup` is always reachable even with none configured — it warns instead of refusing to start.

---

## 2. Get the compose file and create `.env`

The published image means you don't need the repository — two files are enough:

```bash
mkdir kanbanica && cd kanbanica
curl -O https://raw.githubusercontent.com/stack256org/kanbanica/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/stack256org/kanbanica/main/.env.example
```

Building from source instead (you're changing the code, or you want the image built on your own hardware)? Clone the repo and use `docker-compose.build.yml` everywhere this guide says `docker compose`:

```bash
git clone https://github.com/stack256org/kanbanica.git kanbanica
cd kanbanica
cp .env.example .env
```

---

## 3. Configure `.env` for production

Edit `.env` and set the following.

### Required

```bash
# Point at the bundled Postgres service (note host = "postgres", port 5432):
DATABASE_URL=postgresql://kanbanica:CHANGE_ME@postgres:5432/kanbanica

# A strong secret (generate one):  openssl rand -hex 32
APP_SECRET=<32+ random characters>

# Your real public URL (HTTPS). Read at runtime — no rebuild if it changes.
APP_URL=https://tasks.yourcompany.com

# Postgres provisioning (must match DATABASE_URL above):
POSTGRES_USER=kanbanica
POSTGRES_PASSWORD=CHANGE_ME
POSTGRES_DB=kanbanica
```

> Bringing your own database instead? See [Using an external PostgreSQL](#using-an-external-postgresql) — you set `DATABASE_URL` and skip the three `POSTGRES_*` variables entirely.

### At least one authentication provider (recommended — `.env` or in-app)

> SMTP, Google OAuth, and object storage no longer need to live in `.env` at
> all — set them once here to bring the instance up, or skip them and
> configure everything from the browser after your first boot (`/setup`'s
> "Configure services" step, or Settings → Integrations at any time after).
> Database-stored config takes priority over `.env`; `.env` remains the
> fallback for existing deployments and advanced setups. See
> [docs/integrations.md](./docs/integrations.md).

**Option A — SMTP** (enables magic-link login). See
[Production email (SMTP)](#production-email-smtp) below for provider choices and
DNS. Minimal shape:

```bash
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587                      # 587 (STARTTLS) for most providers; some use 465
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=noreply@yourdomain.com  # must be on a domain you've verified (SPF/DKIM)
```

**Option B — Google OAuth** (login without email):

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Full walkthrough (Google Cloud Console, exact redirect URI, common mistakes): [docs/credentials/google-oauth.md](./docs/credentials/google-oauth.md).

**Option C — Email + password** (no external service at all): set `ALLOW_PASSWORD_SIGNUP=true`.

> If you configure **none of the three** anywhere (`.env` or in-app) once real users exist, the app logs a warning instead of refusing to start — your admin account still works, but nobody new can join until you configure one.

### Optional

- **File storage** — defaults to `STORAGE_DRIVER=local` (persisted in the `uploads` Docker volume). For object storage set `STORAGE_DRIVER=s3` (or `r2`) and the `S3_*` variables, or configure it in-app via Settings → Integrations. Full walkthroughs: [docs/credentials/storage-s3.md](./docs/credentials/storage-s3.md) / [docs/credentials/cloudflare-r2.md](./docs/credentials/cloudflare-r2.md).
- **Web Push (browser/desktop notifications)** — set the runtime `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (`npx web-push generate-vapid-keys`) on the **app and worker**. That's all — the client fetches the public key at runtime from `/api/push/vapid-public-key`, so it works on **any** deployment (bare `pnpm build && pnpm start`, PM2, Vercel/Railway/Render/Coolify, Docker) with **no build-time key and no rebuild when keys rotate**. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is optional/legacy (a build-time fallback). Requires HTTPS (behind Cloudflare, use SSL mode **Full (strict)**); `/sw.js` is served `no-cache` so CDNs/browsers never keep a stale service worker. Full walkthrough: [docs/credentials/web-push-vapid.md](./docs/credentials/web-push-vapid.md).

### Environment variable reference

Complete list of variables. Most are validated by `lib/env.ts`; `NEXT_PUBLIC_SHOW_LANDING_PAGE` and the Docker-only `POSTGRES_*`/`APP_PORT` vars are read directly (`config/platform.ts`, `docker-compose.yml`) and aren't part of that schema. "Client" means it's inlined into the browser bundle at build time (`NEXT_PUBLIC_*`).

| Variable | Required? | Default | Purpose |
|----------|-----------|---------|---------|
| `DATABASE_URL` | ✅ always | — | PostgreSQL connection string (Docker: host `postgres`, port `5432`). |
| `APP_SECRET` | ✅ always | — | Better Auth signing secret; 32+ chars (`openssl rand -hex 32`). |
| `APP_URL` | ✅ always | — | Public URL; used for auth, invite links, email content, file URLs. **Runtime** — change it and restart, no rebuild. (`NEXT_PUBLIC_APP_URL` is the deprecated old name and still works.) |
| `NODE_ENV` | — | `development` | Set to `production` in prod (compose/images already do). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | optional | `SMTP_PORT=587` | Magic-link + notification email. Unset in dev → emails logged to console. **Also switches signup email-verification on** — see [Authentication](#authentication). Configurable in-app instead (Settings → Integrations); a saved in-app value there takes priority and applies with no restart. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | — | Optional Google OAuth login. Configurable in-app instead (Settings → Integrations); a saved in-app value there takes priority but needs a restart to activate. |
| `ALLOW_PASSWORD_SIGNUP` | optional | `false` | Allow visitors to register at `/signup` with email + password. Off = invite-only. |
| `AUTO_PROMOTE_FIRST_ADMIN` | optional | `false` | Auto-promote the first user to sign in to platform admin instead of using the `/setup` wizard — see [§5 Create your first admin](#5-create-your-first-admin). |
| `EMAIL_WEBHOOK_SECRET` | optional | — | Auth for the SMTP provider delivery webhook. |
| `STORAGE_DRIVER` | optional | `local` | `local` (./uploads volume) or `s3` / `r2`. Configurable in-app instead (Settings → Integrations); a saved in-app value there takes priority and applies with no restart. |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | needed if `STORAGE_DRIVER=s3\|r2` and not configured in-app | MinIO-style defaults | Object-storage credentials. `S3_ENDPOINT` for R2/MinIO; omit for AWS S3. |
| `S3_PUBLIC_URL` | optional | — | CDN/public origin for serving stored files. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | optional | — | Web Push (`npx web-push generate-vapid-keys`). |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | optional | `support@kanbanica.com` | Override the support email shown in the UI. **Client.** |
| `NEXT_PUBLIC_MARKETING_DOMAIN` | optional | `kanbanica.com` | Override the marketing domain shown in the UI. **Client.** |
| `NEXT_PUBLIC_SHOW_LANDING_PAGE` | optional | `false` | Serve the marketing landing page at `/` for logged-out visitors. Unset (default) redirects `/` → `/login` — the usual choice for a self-hosted instance. **Client.** |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Docker only | `kanbanica` | Provision the bundled Postgres; must match `DATABASE_URL`. |
| `APP_PORT` | Docker only | `3000` | Host port mapped to the app container. |

### Using an external PostgreSQL

By default the stack runs a bundled `postgres` container. If you already have a
database — a company cluster, or a managed one — point `DATABASE_URL` at it and
add the overlay file, which skips the bundled container:

```bash
# Bundled Postgres (default, unchanged)
docker compose up -d

# Your own Postgres
docker compose -f docker-compose.yml -f docker-compose.external-db.yml up -d
```

The overlay only *subtracts*: it stops the `postgres` service from being created
and removes the "wait for postgres" dependency. Everything else — the app, the
worker, and the one-shot `migrate` job — is unchanged, so **migrations still run
automatically before the app starts**. `scripts/migrate.ts` waits for the
database itself (retrying with backoff up to ~2 min) instead of relying on a
container healthcheck, and takes a `pg_advisory_lock` so two concurrent deploys
can't apply the same migration twice.

Requires **Docker Compose ≥ 2.20** (for `depends_on.<service>.required`). Check
with `docker compose version`.

There is nothing provider-specific in Kanbanica: **any PostgreSQL 16+ reachable
over the network works.** Some example `DATABASE_URL`s:

```bash
# Self-managed / company cluster
DATABASE_URL=postgresql://kanbanica:pass@db.internal:5432/kanbanica

# Managed providers generally require TLS
DATABASE_URL=postgresql://user:pass@ep-xyz.neon.tech/kanbanica?sslmode=require
DATABASE_URL=postgresql://user:pass@xyz.rds.amazonaws.com:5432/kanbanica?sslmode=require

# Behind a transaction-mode pooler (pgbouncer)
DATABASE_URL=postgresql://user:pass@pooler.example.com:6543/kanbanica?sslmode=require&pgbouncer=true
```

**TLS.** `?sslmode=require` encrypts the connection without verifying the
server's certificate. Use `?sslmode=verify-full` to also verify it against the
system CA store — note this fails for providers that use a private CA (such as
AWS RDS's own root) unless that CA is installed in the image.

**Poolers.** Append `?pgbouncer=true` when connecting through a transaction-mode
pooler. Kanbanica then disables prepared statements, which pgbouncer cannot
support in that mode.

**A database on the Docker host** is not reachable as `localhost` from inside a
container. Use `host.docker.internal` and uncomment the `extra_hosts` block at
the bottom of `docker-compose.external-db.yml`.

**Connections.** The app, worker and migrate containers each open their own pool
(the app allows up to 20 connections). On small managed tiers with low
connection caps, keep that in mind when sizing.

**Copy-pasted URLs are normalised for you.** Connection strings from managed
providers often carry client-only parameters (`channel_binding`, `pgbouncer`,
`sslmode`, …). Kanbanica uses two different PostgreSQL drivers internally, and
they disagree about those parameters, so `lib/pg-connection.ts` strips them and
resolves TLS once for both. You can paste a provider's URL as-is.

### Authentication

Kanbanica ships three login methods. They all create the same session and the same
`user` row — one account per email address, no matter how someone signs in.

| Method | What it needs | Enabled when |
|--------|---------------|--------------|
| **Magic link** | SMTP (in production) | always on |
| **Google OAuth** | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | both are set |
| **Email + password** | nothing | sign-**in** always; sign-**up** needs `ALLOW_PASSWORD_SIGNUP=true` |

> **Production auth rule:** if `NODE_ENV=production` and **none** of SMTP, Google OAuth,
> or `ALLOW_PASSWORD_SIGNUP=true` is configured, the app refuses to start — otherwise
> nobody could obtain an account. Each screen only renders the methods you configured,
> so a deployment without Google never shows a Google button.

#### Signup behaviour depends on SMTP

This surprises people, so it's worth stating plainly. **Configuring SMTP turns on email
verification for password signups.**

| SMTP | What happens at `/signup` |
|------|---------------------------|
| **not configured** | Account is created and the user is signed in **immediately**. No verification email (there'd be no way to deliver it). |
| **configured** | A verification email is sent. The user **cannot sign in** until they click the link. |

Two consequences of the SMTP-configured path worth knowing:

- Only a **verified** account can later link Google to the same email. Better Auth refuses
  to attach an OAuth account to an unverified user, so an unverified password account that
  clicks "Continue with Google" gets an *account not linked* error. Verification is what
  flips that bit.
- Duplicate signups return a generic response instead of "user already exists", so the
  signup form doesn't leak which emails are registered.

Password rules: **8–128 characters**, enforced server-side. `/forgot-password` only exists
when SMTP is configured — without a mail path the reset link could never be delivered.

Full reference: [`docs/authentication.md`](./docs/authentication.md).

### Production email (SMTP)

Kanbanica sends magic-link and notification emails over **standard SMTP via
Nodemailer**, so it works with **any SMTP provider** — you bring the credentials.
Swapping providers is an **environment-variable change only**; no code changes.

Pick whichever fits your deployment:

| Provider | Free tier | Notes |
|----------|-----------|-------|
| **Resend** (recommended) | ~3,000/mo (100/day) | Best developer experience; great docs. Requires a verified domain. |
| **Brevo** | ~300/day | Generous free tier; can start without owning a domain. |
| **SMTP2GO** | ~1,000/mo | Very simple SMTP setup. |
| **Postmark** | 100/mo then paid | Best transactional deliverability. |
| **Amazon SES** | pay-as-you-go | Cheapest at scale; more setup (sandbox → production request). |

Typical settings (check your provider's dashboard for exact values):

```bash
# Example — Resend
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=<your-api-key>
EMAIL_FROM="Kanbanica <noreply@yourdomain.com>"
```

**DNS / deliverability (required):** in your provider's dashboard, add and verify
your sending domain, then create the DNS records it gives you — **SPF** and
**DKIM** at minimum, plus a **DMARC** policy. `EMAIL_FROM` must be an address on
that verified domain, or mail is rejected or spam-filtered. Use port **587
(STARTTLS)** unless the provider specifies **465** (implicit TLS).

**Multiple deployments:** each instance (your hosted demo, and every self-hosted
install) sets its **own** `SMTP_*`/`EMAIL_FROM` in its own environment. Secrets
are never committed — the repo ships only an empty `.env.example`.

Local development needs **no SMTP**: magic links print to the terminal (see
[SETUP.md](./SETUP.md)).

Full walkthrough (account creation, DNS records, verification, troubleshooting): [docs/credentials/smtp.md](./docs/credentials/smtp.md).

---

## 4. Bring it up

```bash
docker compose up -d
```

This pulls the image, starts Postgres, runs migrations (the `migrate` service) to completion, then starts `app` and `worker`.

Pin a version in production — `latest` moves with every release:

```bash
IMAGE_TAG=0.1.0 docker compose up -d
```

Building from source instead: `docker compose -f docker-compose.build.yml up -d --build`. On a small server, `next build` may need more heap than the default — prefix the build with `NODE_OPTIONS=--max-old-space-size=2048`.

Check status and health:

```bash
docker compose ps
curl -f http://localhost:3000/api/health     # → {"ok":true,"db":"connected"}
```

---

## 5. Create your first admin

**First-run setup (recommended):** open the app in a browser right after deploying. On a brand-new install (empty user table) every entry point redirects to the **`/setup` wizard** — enter a name, email, and password and you get the platform (Orbit) admin account, signed straight in. No environment flag, no terminal step. The page disappears the moment the first user exists, so it can't be used to create a second admin.

### Advanced / recovery options

Not needed for a normal first launch — use these only if you prefer a different bootstrap or an instance ends up with zero admins.

- **`AUTO_PROMOTE_FIRST_ADMIN=true`** (set before first launch): the **first** user to sign in — via magic link, Google, or password — is auto-promoted to admin instead of going through `/setup`. Only fires while the user table is empty. Handy if you'd rather bootstrap through an SSO/magic-link sign-in than the setup form.
- **CLI scripts** — the recovery path if the sole admin was removed:

```bash
docker compose exec app pnpm make:admin you@yourcompany.com
```

> Any of the three containers can run this — they're the same image, and it ships the real `scripts/` directory plus `pnpm`. Use `exec worker` instead if you'd rather not touch the serving container.

| Script | Use when |
|---|---|
| `scripts/make-admin.ts <email>` | The user **already signed in** — promotes that existing account. |
| `scripts/create-admin.ts <email> <password> [name]` | No account exists — creates one with a password that can sign in at `/admin/login`. |

---

## 6. HTTPS / reverse proxy

Run a reverse proxy in front of the app on port 3000 to terminate TLS on your domain.

**Caddy** (automatic HTTPS) — `Caddyfile`:

```
tasks.yourcompany.com {
    reverse_proxy localhost:3000
}
```

**Nginx** — key points:

```nginx
server {
    server_name tasks.yourcompany.com;
    # nginx's default is 1 MB, which breaks attachment uploads (10 MB each).
    # The MCP endpoint (/api/mcp) accepts request bodies up to 40 MB, so allow a bit more.
    client_max_body_size 45m;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
    # Real-time (SSE): do not buffer this endpoint, or live updates lag/stall.
    location /api/me/notifications/stream {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }
}
```

**Upload size limits.** The MCP endpoint (`/api/mcp`) accepts up to 40 MB per request (images and files travel as base64), so the proxy must allow it: `client_max_body_size 45m;` for nginx as above. Caddy has no request body limit by default. If the site is behind Cloudflare, note that its request body limit is 100 MB, so 40 MB fits.

Make sure `APP_URL` matches the public HTTPS URL. Auth uses it for secure cookies and callback/magic-link URLs.

---

## 7. Backups & Restore

### Database backup

```bash
docker compose exec postgres pg_dump -U ${POSTGRES_USER:-kanbanica} ${POSTGRES_DB:-kanbanica} > backup-$(date +%F).sql
```

Automate this with cron on the host (outside the container) for regular, unattended backups:

```bash
# /etc/cron.d/kanbanica-backup — daily at 2am, keep 14 days
0 2 * * * cd /path/to/kanbanica && docker compose exec -T postgres pg_dump -U kanbanica kanbanica | gzip > /path/to/backups/kanbanica-$(date +\%F).sql.gz && find /path/to/backups -name 'kanbanica-*.sql.gz' -mtime +14 -delete
```

Using an [external PostgreSQL](#using-an-external-postgresql) instead of the bundled container? Use your provider's own backup/snapshot mechanism (most managed Postgres providers — RDS, Neon, Supabase, Railway, Render — take automated daily snapshots) in addition to, or instead of, `pg_dump`.

### Database restore

```bash
# Stop the app and worker so nothing writes during restore (leave postgres running)
docker compose stop app worker

# Restore into a fresh database (drops and recreates first — see db/reset.ts for the same logic)
docker compose exec -T postgres psql -U ${POSTGRES_USER:-kanbanica} -d ${POSTGRES_DB:-kanbanica} -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose exec -T postgres psql -U ${POSTGRES_USER:-kanbanica} -d ${POSTGRES_DB:-kanbanica} < backup-2026-07-01.sql

# Bring the app back up — the migrate service is a no-op if the restored dump is already current
docker compose up -d
```

If the backup predates a migration that's since been applied, run `docker compose up -d migrate` (or `pnpm db:migrate:prod`) after restoring, before starting `app`/`worker`, to bring the schema up to date.

### Uploaded files backup

- **`STORAGE_DRIVER=local`** (default): files live in the `uploads` Docker volume — back it up as a filesystem copy, e.g. `docker run --rm -v kanbanica_uploads:/data -v $(pwd):/backup alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .` (adjust the volume name to match `docker compose config --volumes`). Restore by extracting the tarball back into the same named volume.
- **`STORAGE_DRIVER=s3` or `r2`**: files live in your S3/R2 bucket, not on this host. Your provider's durability (S3: 11 nines; R2: comparable) covers hardware failure, but **does not protect against accidental deletion from the app** (e.g. a bug that deletes the wrong key). For that, enable your bucket's own versioning/lifecycle rules (S3 bucket versioning, R2's equivalent) or a periodic bucket-to-bucket sync (`aws s3 sync` / `rclone`) to a second bucket — Kanbanica does not manage this for you.

### What's NOT covered by `pg_dump` alone

The database dump captures every table (tasks, workspaces, custom fields, time entries, etc.) but **not** the files referenced by `file_url` / `image` / attachment columns — those are storage keys, not blobs, so a DB-only restore leaves the app pointing at files that must be restored separately (see above). Back up both together and restore both together to avoid orphaned references.

### Disaster recovery checklist

1. Provision a fresh host/container with the same `docker-compose.yml` (or external DB target).
2. Restore the database (see above).
3. Restore uploads (local volume tarball, or confirm the S3/R2 bucket is intact/replicated).
4. Copy `.env` (or recreate it — see [step 3](#3-configure-env-for-production)) with the same `APP_SECRET` (rotating it invalidates all existing sessions and any encrypted data keyed on it).
5. `docker compose up -d` and verify `/api/health` returns 200.
6. Spot-check: sign in, open a workspace, confirm attachments/avatars render (proves storage wiring, not just DB restore).

There is currently no automated backup verification (e.g. periodic restore-to-scratch-DB drills) — treat backups as unverified until you've done a manual restore test at least once.

---

## 8. Updating

```bash
docker compose pull
docker compose up -d
```

The `migrate` service applies any new migrations automatically before the app starts. Building from source: `git pull && docker compose -f docker-compose.build.yml up -d --build`.

Pinning a version? Bump `IMAGE_TAG` and re-run those two commands. Because `app`, `worker` and `migrate` all resolve to the same `${IMAGE_TAG}`, there is no way to end up running an app against a schema its worker never migrated to.

---

## 9. Operational notes & limits

- **Run exactly one worker.** Do **not** `docker compose up --scale worker=N`. Jobs are durable in Postgres, but multiple workers can double-process.
- **Single app instance (for now).** Real-time updates and in-app notifications use an in-memory registry per process. Running **2+ app instances** behind a load balancer would drop cross-instance events — that needs a shared Redis pub/sub, which isn't implemented yet. One app instance is fine for typical team use.
- **Database connections.** The pool is `max: 20` (`lib/db.ts`). Tune for your Postgres if needed.
- **Changing the domain** is a restart, not a rebuild: edit `APP_URL` in `.env`, then `docker compose up -d`. Nothing deployment-specific is baked into the image.

### Why one image

`app`, `worker` and `migrate` are the same image with a different `command:`. That's deliberate, and it's why the image ships the real source tree instead of Next's `output: "standalone"` bundle:

- The worker executes TypeScript through `tsx` (`scripts/worker.ts`), so it needs `scripts/` and `lib/` on disk.
- `scripts/migrate.ts` reads the `.sql` files in `db/migrations` at runtime.
- The admin-recovery scripts have to be runnable inside a live container.
- Two images means two tags to keep in lockstep. One image makes app/worker schema drift impossible.

What it is *not* is the whole dev environment. Runtime `node_modules` is a `--prod` install, so `drizzle-kit`, `typescript`, `vitest` and `embedded-postgres` (a Postgres server binary per platform) stay out. The practical consequence: inside a container use **`pnpm db:migrate:prod`**, never `pnpm db:migrate` — the latter is `drizzle-kit`, which is a devDependency and isn't there. Generating a new migration is a development task, not a production one.

### Platforms that aren't Docker Compose

**Dokploy, Coolify, CapRover, Portainer, Kubernetes, Swarm, ECS.** You have two options.

#### Option A — one container (simplest)

Point the platform at the image, set the env vars, **add a persistent volume for uploads** (see [Persistent storage](#persistent-storage-uploads) — required, not optional), and **leave the command blank**. With no command, the image's entrypoint applies pending migrations and then runs the web server *and* exactly one worker inside that container. This is the path a Dokploy "Docker (registry image)" deployment takes by default.

It supervises both processes: if either one dies the container exits, so your platform's restart policy brings the pair back together. That is deliberate — a container still answering `/api/health` with a dead worker would look healthy while every queued email and reminder piled up unsent.

Two environment variables tune it, and neither is normally needed:

| Variable | Default | What it does |
|---|---|---|
| `KANBANICA_ROLE` | `all` | `all` = migrate + web + worker. Or pick one role: `app`, `worker`, `migrate`. Lets you split the roles on a platform where setting env vars is easier than overriding the command. |
| `KANBANICA_RUN_MIGRATIONS` | `true` for `all`/`migrate`, else `false` | Set `false` if your database user may not run DDL and you apply migrations out-of-band. |

An explicit command always wins: anything you *do* set is run verbatim, which is exactly how the three Compose services select their role.

#### Option B — three services (recommended for production)

Deploy the published image three times with the commands in the table at the top of this guide. It costs more setup but the roles restart independently, the worker can't take the web server down with it, and you can give each one its own resource limits. Two things to get right:

- **The `migrate` step must finish before `app` and `worker` start.** Compose expresses this with `depends_on: {migrate: {condition: service_completed_successfully}}`. If your platform has no equivalent, deploying this repo's `docker-compose.yml` *as a Compose stack* (Dokploy and Coolify both support that) is the easiest way to get the ordering for free. Otherwise run the migration yourself on each upgrade: `docker compose run --rm migrate`, or `pnpm db:migrate:prod` in any container of the new image, before the new app serves traffic.
- **Don't skip the worker.** Magic-link emails are enqueued through pg-boss, so with no worker running nobody can sign in by email. (Option A exists precisely because this was easy to miss.)
- **Still run exactly one worker** — see [Operational notes](#9-operational-notes--limits).

#### Persistent storage (uploads)

> **Required on any platform that runs the image once.** The image does **not** create a persistent volume. Without a mount at `/app/uploads`, uploaded files (task images, attachments, avatars) are written to the container's own disk: they work right after upload and **disappear on the next redeploy**. (`docker-compose.yml` already mounts one; platforms deploying a bare image do not.) The container logs a `[entrypoint] WARNING: /app/uploads is not a mounted volume` at boot when this is missing.

Pick one:

- **Mount a volume at `/app/uploads`** (default `STORAGE_DRIVER=local`):
  - **Dokploy** — your app → **Advanced → Volumes / Mounts → Add** → type **Volume**, name `kanbanica-uploads`, mount path `/app/uploads` → save and redeploy.
  - **Coolify** — resource → **Persistent Storage → Add** → destination path `/app/uploads`.
  - **docker run** — `-v kanbanica-uploads:/app/uploads`.
  - Kubernetes / Swarm / ECS — a PersistentVolumeClaim / named volume / EFS mount at `/app/uploads`.
  - The files must be writable by uid/gid `1001` (the image's user; a fresh named volume inherits this). Back the volume up — it's the only copy.
- **Use S3 / R2** — set `STORAGE_DRIVER=s3|r2` and credentials (or Settings → Integrations). No volume needed, and files survive losing the server.

If you deploy a Compose stack, check that your platform keeps volume names stable across redeploys — some don't (observed with Dokploy), which silently creates a new empty volume and orphans the old one instead of erroring. That's why the volumes in `docker-compose.yml` are pinned to literal names.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| App exits on start: "No authentication provider configured" | Set **one** of: SMTP, Google OAuth, or `ALLOW_PASSWORD_SIGNUP=true` in `.env` (step 3). |
| `unrecognized configuration parameter "channel_binding"` (or `"pgbouncer"`) | You're on a build predating connection-string normalisation. Pull latest; Kanbanica now strips client-only URL params. |
| `self-signed certificate in certificate chain` connecting to a managed DB | Your provider uses a private CA. Use `?sslmode=require` rather than `?sslmode=verify-full`, or install the provider's CA in the image. |
| `migrate` exits 1: database unreachable after 10 attempts | The external DB isn't reachable from the container. Check firewall/VPC rules, and use `host.docker.internal` (not `localhost`) if it runs on the Docker host. |
| Using an external DB but a `postgres` container still starts | You forgot `-f docker-compose.external-db.yml`. Both `-f` flags are required, in that order. |
| `pnpm db:migrate` in a container: "drizzle-kit: not found" | Expected — it's a devDependency and the image is a `--prod` install. Use `pnpm db:migrate:prod`, which runs `scripts/migrate.ts`. |
| Single container on Dokploy/Coolify: no worker running, can't log in, schema missing | You're on a build predating the role-dispatching entrypoint, or you set an explicit command (e.g. `pnpm start`), which overrides it. Pull latest and clear the command field — with none set, one container now migrates and runs web + worker. See [Platforms that aren't Docker Compose](#platforms-that-arent-docker-compose). |
| Single container logs `unknown KANBANICA_ROLE` and exits 64 | Typo in `KANBANICA_ROLE`. Valid values: `all` (default), `app`, `worker`, `migrate`. |
| Single container is reachable but the platform reports it unhealthy | You set `PORT` to something other than 3000. The image's `HEALTHCHECK` probes `:3000` inside the container. Leave `PORT` alone and map the port externally instead. |
| Single container restarts in a loop right after `[worker] pg-boss started` | In the combined role, either process dying takes the container down by design. Read the logs *above* the restart — it's the worker or the web server failing, not the entrypoint. |
| `depends_on` error mentioning `required` | Docker Compose is older than 2.20. Upgrade, or run `docker compose up -d app worker`. |
| Users never receive the magic-link email | SMTP misconfigured or DNS (SPF/DKIM) failing. Check `docker compose logs worker`. |
| New password signups can't log in ("Email not verified") | Expected once SMTP is set — they must click the verification link. See [Authentication](#authentication). |
| Password user gets "account not linked" on Google sign-in | Their email isn't verified yet. Verification is what allows linking Google to an existing account. |
| `/signup` returns 404 | `ALLOW_PASSWORD_SIGNUP` is not `true`. The instance is invite-only by design. |
| `/api/health` returns 503 | App can't reach Postgres — check `DATABASE_URL` host is `postgres` and the DB is healthy (`docker compose ps`). |
| Real-time updates lag or don't appear | Reverse proxy is buffering `/api/me/notifications/stream` (see step 6), or you're running multiple app instances (step 9). |
| Uploaded files disappear after redeploy (new uploads work, old ones 404) | No persistent volume at `/app/uploads` (image-URL deploys on Dokploy/Coolify/etc. get none), or the platform created a new empty one. Add the mount — see [Persistent storage](#persistent-storage-uploads) — or switch to S3/R2. Check the boot log for `[entrypoint] WARNING: /app/uploads is not a mounted volume`. |
| Migrations didn't run | Check `docker compose logs migrate` — it must exit 0 before app/worker start. |

---

Questions or issues? Open a GitHub issue. Happy self-hosting. 🚀
