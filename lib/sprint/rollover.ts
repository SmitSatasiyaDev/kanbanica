import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import { listStatus, sprint, task, taskSprint } from "@/db/schema";
import { db } from "@/lib/db";
import { notDeleted } from "@/lib/task-visibility";

// Shared sprint close + rollover logic, driven by space-level settings.
//
// Used by both the manual "Close Sprint" server action (app/actions/sprint.ts)
// and the scheduled pg-boss worker (lib/worker/handlers/sprint-auto-close.ts).
// This is a plain module (no "use server") so the standalone worker process can
// import it safely.

export type IncompleteStrategy =
  | "move_to_backlog"
  | "move_to_next_sprint"
  | "leave_as_is";

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// "Sprint 3" → "Sprint 4", "Sprint 10" → "Sprint 11"; falls back to "<name> 2".
export function incrementSprintName(name: string): string {
  const match = name.match(/^(.*?)(\d+)(\s*)$/);
  if (match) {
    return `${match[1]}${Number.parseInt(match[2], 10) + 1}${match[3]}`;
  }
  return `${name} 2`;
}

/**
 * Close an ACTIVE sprint and, depending on the resolved settings, create the
 * next PLANNED sprint and roll incomplete tasks over to it.
 *
 * Idempotent: a no-op (returns `{ nextSprintId: null }`) when the sprint is not
 * currently ACTIVE, so it's safe to call from both the manual action and a retried
 * background job.
 *
 * Callers resolve `incompleteStrategy` / `autoCreateNext` from the space settings
 * (or, for manual close, from the user's explicit choice).
 */
export async function closeSprintAndRollover(params: {
  spaceId: string;
  sprintId: string;
  actorId: string;
  incompleteStrategy: IncompleteStrategy;
  /** Explicit target sprint for `move_to_next_sprint` (manual flow). */
  targetSprintId?: string;
  /** Whether to create the next sprint when none is targeted/planned. */
  autoCreateNext: boolean;
}): Promise<{ nextSprintId: string | null }> {
  const {
    spaceId,
    sprintId,
    actorId,
    incompleteStrategy,
    targetSprintId,
    autoCreateNext,
  } = params;

  // ── 1. Load + idempotency guard ───────────────────────────────────────────
  const [current] = await db
    .select({
      status: sprint.status,
      name: sprint.name,
      endDate: sprint.endDate,
      durationWeeks: sprint.durationWeeks,
    })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.spaceId, spaceId)))
    .limit(1);

  if (current?.status !== "ACTIVE") {
    return { nextSprintId: null };
  }

  const now = new Date();

  // ── 2. Collect incomplete tasks ───────────────────────────────────────────
  const sprintTasks = await db
    .select({ taskId: taskSprint.taskId, statusType: listStatus.type })
    .from(taskSprint)
    .innerJoin(task, eq(taskSprint.taskId, task.id))
    .leftJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(
      and(
        eq(taskSprint.sprintId, sprintId),
        notDeleted(),
        eq(task.isArchived, false)
      )
    );

  const incompleteTaskIds = sprintTasks
    .filter((t) => t.statusType !== "CLOSED")
    .map((t) => t.taskId);

  // ── 3. Resolve the next / target sprint ───────────────────────────────────
  let nextSprintId: string | null = null;

  // Explicit target (manual flow) wins, if it's a valid PLANNED sprint.
  if (targetSprintId) {
    const [target] = await db
      .select({ id: sprint.id, status: sprint.status })
      .from(sprint)
      .where(and(eq(sprint.id, targetSprintId), eq(sprint.spaceId, spaceId)))
      .limit(1);
    if (target && target.status === "PLANNED") {
      nextSprintId = target.id;
    }
  }

  // Otherwise auto-create (or reuse an existing PLANNED sprint) when enabled.
  if (!nextSprintId && autoCreateNext) {
    const [existingPlanned] = await db
      .select({ id: sprint.id })
      .from(sprint)
      .where(and(eq(sprint.spaceId, spaceId), eq(sprint.status, "PLANNED")))
      .limit(1);

    if (existingPlanned) {
      nextSprintId = existingPlanned.id;
    } else {
      const newStartDate = current.endDate ? addDays(current.endDate, 1) : now;
      const newEndDate = addDays(newStartDate, current.durationWeeks * 7);
      const newId = createId();

      await db.insert(sprint).values({
        id: newId,
        spaceId,
        name: incrementSprintName(current.name),
        goal: null,
        status: "PLANNED",
        startDate: newStartDate,
        endDate: newEndDate,
        durationWeeks: current.durationWeeks,
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      });
      nextSprintId = newId;
    }
  }

  // ── 4. Roll incomplete tasks over ─────────────────────────────────────────
  if (incompleteTaskIds.length > 0 && incompleteStrategy !== "leave_as_is") {
    await db
      .delete(taskSprint)
      .where(
        and(
          eq(taskSprint.sprintId, sprintId),
          inArray(taskSprint.taskId, incompleteTaskIds)
        )
      );

    // move_to_next_sprint with a resolved sprint → carry over; otherwise the
    // delete above already returned them to the backlog.
    if (incompleteStrategy === "move_to_next_sprint" && nextSprintId) {
      await db
        .insert(taskSprint)
        .values(
          incompleteTaskIds.map((taskId) => ({
            taskId,
            sprintId: nextSprintId!,
            points: null,
            addedAt: now,
          }))
        )
        .onConflictDoNothing();
    }
  }

  // ── 5. Close the sprint ───────────────────────────────────────────────────
  await db
    .update(sprint)
    .set({ status: "CLOSED", closedAt: now, updatedAt: now })
    .where(eq(sprint.id, sprintId));

  return { nextSprintId };
}
