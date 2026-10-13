import { and, eq, lt } from "drizzle-orm";
import type { Job } from "pg-boss";
import { space, sprint } from "@/db/schema";
import { db } from "@/lib/db";
import { todayInTz } from "@/lib/due-date";
import { closeSprintAndRollover } from "@/lib/sprint/rollover";

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleSprintAutoClose(
  _jobs: Job<Record<string, never>>[]
) {
  // Sprint end dates are calendar days, and a project's members span many
  // timezones. A calendar day ends last in UTC-12, so compare against the day
  // there: a sprint auto-closes only once its end day is over for everyone.
  const today = todayInTz("Etc/GMT+12");

  // ACTIVE sprints past their end date, in spaces that have "Auto-mark sprint as
  // done" enabled. The space-level settings are the single source of truth (the
  // same toggles the Sprints settings page saves).
  const eligibleSprints = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      spaceId: sprint.spaceId,
      createdBy: sprint.createdBy,
      autoCreateNext: space.sprintAutoCreateNext,
      moveIncomplete: space.sprintAutoMoveIncomplete,
    })
    .from(sprint)
    .innerJoin(space, eq(sprint.spaceId, space.id))
    .where(
      and(
        eq(sprint.status, "ACTIVE"),
        eq(space.sprintAutoMarkDone, true),
        lt(sprint.endDate, today)
      )
    );

  if (eligibleSprints.length === 0) {
    return;
  }

  console.log(
    `[sprint.auto-close] processing ${eligibleSprints.length} sprint(s)`
  );

  for (const s of eligibleSprints) {
    try {
      const { nextSprintId } = await closeSprintAndRollover({
        spaceId: s.spaceId,
        sprintId: s.id,
        actorId: s.createdBy,
        autoCreateNext: s.autoCreateNext,
        incompleteStrategy: s.moveIncomplete
          ? "move_to_next_sprint"
          : "move_to_backlog",
      });
      console.log(
        `[sprint.auto-close] closed "${s.name}" (${s.id})` +
          (nextSprintId ? ` → next sprint ${nextSprintId}` : "")
      );
    } catch (err) {
      console.error(`[sprint.auto-close] failed for sprint ${s.id}`, err);
    }
  }
}
