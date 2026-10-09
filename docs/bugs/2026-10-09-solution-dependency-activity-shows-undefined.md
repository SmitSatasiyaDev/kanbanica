# Solution: dependency activity names the task

- `addDependency` now selects the target task's title and logs
  `depends_on_task_title` alongside `dependsOnTaskId`.
- `removeDependency` joins `task` to log the title of the task being unblocked.
- `describeEvent()` (`lib/activity-descriptions.ts`) falls back to
  `added a dependency` / `removed a dependency` when no title is stored, so
  entries created before this fix (id only) no longer print `undefined`.
- Regression test: `lib/activity-descriptions.test.ts`.

Old entries keep the neutral wording; no data migration was done.
