# Sprint auto-close never ran for an overdue sprint

**Symptom:** A project with "Auto-mark sprint as done" ON kept showing an ACTIVE sprint
(end 10/02) as "Overdue by 3 days" on 10/05.

**Where:** `lib/worker/boss.ts` scheduling of `sprint.auto-close`.

**Root cause:** The job was scheduled once a day (`0 0 * * *`, UTC = 05:30 IST). pg-boss does
not backfill a cron slot that passes while the worker is not running, and nothing triggered a
run at worker startup. In the local DB no daily job (`sprint.auto-close`,
`notification.cleanup`, `email.events-prune`, ...) had ever run since 2026-10-02; only the
interval jobs fired. The setting was persisted correctly (`space.sprint_auto_mark_done = true`),
and the handler, eligibility query and `closeSprintAndRollover` all work when invoked.
