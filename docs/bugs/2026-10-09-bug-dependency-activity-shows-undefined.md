# Bug: activity feed says `added dependency on "undefined"`

**Symptom:** Adding (or removing) a task dependency produced an activity entry
reading `<user> added dependency on "undefined"`.

**Where:** Task activity feed (`describeEvent()` in `lib/activity-descriptions.ts`),
written by `addDependency` / `removeDependency` in `app/actions/task-dependency.ts`.

**Root cause:** Key mismatch. The actions logged `{ dependsOnTaskId }`, but the
description read `meta.depends_on_task_title`, which was never written, so the
template string interpolated `undefined`.
