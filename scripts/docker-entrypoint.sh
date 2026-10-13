#!/usr/bin/env bash
#
# Role dispatcher for the Kanbanica image.
#
# The image fills three roles (web server, pg-boss worker, one-shot migration).
# Docker Compose picks one per service with `command:`, and anything passed that
# way is exec'd verbatim by the pass-through below — so the three-service setup
# behaves exactly as it did before this script existed.
#
# A platform that deploys the image ONCE from a registry URL (Dokploy, Coolify,
# CapRover, a bare `docker run`) has no `command:` to set. Before this script it
# therefore got the web server alone: no migrations, and no worker — which means
# no outgoing email at all, so magic-link sign-in silently never arrives. That is
# what the `all` role below fixes: one container that migrates, serves, and runs
# exactly one worker.
#
#   KANBANICA_ROLE=all      (default) migrate, then web server + worker together
#   KANBANICA_ROLE=app      web server only
#   KANBANICA_ROLE=worker   worker only
#   KANBANICA_ROLE=migrate  apply migrations, then exit
#
#   KANBANICA_RUN_MIGRATIONS=false  skip the migration step (managed database
#                                   whose app user may not run DDL). Defaults to
#                                   true for `all`/`migrate`, false otherwise.
#
# bash, not sh: `wait -n PID` (used to notice either child dying) needs bash 5.1+
# and the base image is node:22-bookworm-slim, which ships bash 5.2.

set -euo pipefail

# Call the .bin shims instead of `pnpm start` / `pnpm worker:start`: a pnpm
# wrapper per child costs another Node process and puts another hop between
# Docker's SIGTERM and the process that has to act on it. Both `next` and `tsx`
# are production dependencies, so these exist in the image's --prod node_modules.
NEXT_BIN="node_modules/.bin/next"
TSX_BIN="node_modules/.bin/tsx"

role="${KANBANICA_ROLE:-all}"

# Local-disk uploads only survive a redeploy if /app/uploads is a mounted
# volume. Platforms that run the image once (Dokploy, Coolify, ...) don't add
# one, so uploads then "work" until the next deploy and 404 afterwards. Warn
# loudly. Skipped when .env selects S3/R2; the driver can also be set in-app
# (Settings → Integrations), hence the wording. Never fatal.
case "${STORAGE_DRIVER:-local}" in
  s3 | r2) ;;
  *)
    if [ -d /app/uploads ] && ! grep -q " /app/uploads " /proc/self/mountinfo 2>/dev/null; then
      echo "[entrypoint] WARNING: /app/uploads is not a mounted volume. With local file storage," >&2
      echo "[entrypoint] uploaded files (images, attachments, avatars) will be LOST on redeploy." >&2
      echo "[entrypoint] Mount a persistent volume at /app/uploads, or use S3/R2 (Settings → Integrations)." >&2
      echo "[entrypoint] See DEPLOYMENT.md → Persistent storage." >&2
    fi
    ;;
esac

# Pass-through. Every docker-compose service lands here, as does `docker run
# <image> bash`. "kanbanica" is the image's own CMD: a sentinel meaning "no
# command given, decide from the environment". It has to be a real value rather
# than an empty CMD, because the base image's inherited `CMD ["node"]` would
# otherwise take its place.
if [ "$#" -gt 0 ] && [ "$1" != "kanbanica" ]; then
  exec "$@"
fi

case "$role" in
  all | app | worker | migrate) ;;
  *)
    echo "[entrypoint] unknown KANBANICA_ROLE=\"$role\" (expected: all, app, worker, migrate)" >&2
    exit 64
    ;;
esac

# Migrations default on for the roles that own the schema. `app` and `worker`
# are the compose-style roles, where the dedicated `migrate` service owns it.
case "$role" in
  all | migrate) run_migrations="${KANBANICA_RUN_MIGRATIONS:-true}" ;;
  *) run_migrations="${KANBANICA_RUN_MIGRATIONS:-false}" ;;
esac

# scripts/migrate.ts is safe to run on every boot: it waits for the database
# with backoff and holds a pg_advisory_lock, so two concurrent deploys queue
# instead of racing. Foreground and fatal on failure — serving against a stale
# schema is worse than restarting.
if [ "$run_migrations" = "true" ]; then
  echo "[entrypoint] role=$role — applying migrations"
  "$TSX_BIN" scripts/migrate.ts
fi

case "$role" in
  migrate)
    exit 0
    ;;
  app)
    echo "[entrypoint] role=app — starting web server"
    exec "$NEXT_BIN" start
    ;;
  worker)
    echo "[entrypoint] role=worker — starting background worker"
    exec "$TSX_BIN" scripts/worker.ts
    ;;
esac

# ── role=all: supervise the web server and the worker in one container ────────
echo "[entrypoint] role=all — starting web server and background worker"

"$NEXT_BIN" start &
web_pid=$!

"$TSX_BIN" scripts/worker.ts &
worker_pid=$!

shutting_down=false

shutdown() {
  if [ "$shutting_down" = true ]; then
    return
  fi
  shutting_down=true
  trap - TERM INT
  echo "[entrypoint] received $1; stopping web server and worker"
  # scripts/worker.ts traps SIGTERM and drains in-flight jobs via
  # boss.stop({graceful: true}), so give both children a real TERM and wait.
  kill -TERM "$web_pid" "$worker_pid" 2>/dev/null || true
  wait "$web_pid" "$worker_pid" 2>/dev/null || true
  exit 0
}

trap 'shutdown SIGTERM' TERM
trap 'shutdown SIGINT' INT

# Take the whole container down when EITHER child exits. A container that kept
# answering /api/health with a dead worker would look healthy while every queued
# email, digest and reminder piled up unprocessed — exiting lets the platform's
# restart policy do its job. `|| code=$?` because `set -e` would otherwise abort
# here on a non-zero child and skip the sibling cleanup below.
code=0
wait -n "$web_pid" "$worker_pid" || code=$?

if [ "$shutting_down" = false ]; then
  echo "[entrypoint] a child process exited (status $code); shutting down the container"
  kill -TERM "$web_pid" "$worker_pid" 2>/dev/null || true
  wait "$web_pid" "$worker_pid" 2>/dev/null || true
fi

exit "$code"
