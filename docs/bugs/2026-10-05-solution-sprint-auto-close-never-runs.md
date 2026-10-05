# Solution: sprint auto-close catch-up

- `lib/worker/job-types.ts`: new `SPRINT_AUTO_CLOSE_CRON = "0 * * * *"` (hourly). The handler is
  idempotent (only ACTIVE sprints past end date; `closeSprintAndRollover` no-ops otherwise).
- `lib/worker/boss.ts`: schedules with that constant and sends one `sprint.auto-close` job at
  worker startup so sprints that went overdue while the worker was down close immediately. The
  queue's `exclusive` policy prevents duplicate queued runs.
- Tests: `lib/worker/handlers/sprint-auto-close.test.ts` (eligibility SQL), `lib/worker/job-types.test.ts`.
- No migration. `boss.schedule` upserts, so the existing schedule row updates on the next worker start.
