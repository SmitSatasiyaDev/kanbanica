import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  dailyChecklistTemplate,
  dailyChecklistTemplateAssignment,
  user,
  workspace,
} from "@/db/schema";
import { ensureTeamDays } from "@/lib/daily-checklist/ensure";
import { db } from "@/lib/db";
import { todayInTz } from "@/lib/local-date";
import { getEffectiveTimezone } from "@/lib/timezone";

export interface DailyChecklistGenerateStats {
  created: number;
  failed: number;
  users: number;
}

/**
 * Background safety net (hourly + once at worker boot): pre-generates today's TEAM checklist
 * instances for every assignee of an active template, using each assignee's own local date in
 * their effective timezone (user → workspace → UTC), per workspace.
 *
 * It is the only path that generates for *everyone*. The Team Checklist page generates just
 * the viewer's own day on demand, a newly added assignee is generated immediately by the admin
 * action, and admin views only read. PERSONAL checklists are created lazily on first access
 * (never by this job). Idempotent — existing days are never touched, so re-runs and overlaps
 * are safe.
 */
export async function runDailyChecklistGenerate(
  opts: { now?: Date; workspaceId?: string } = {}
): Promise<DailyChecklistGenerateStats> {
  const now = opts.now ?? new Date();
  const assignees = await db
    .selectDistinct({
      userId: dailyChecklistTemplateAssignment.userId,
      workspaceId: dailyChecklistTemplate.workspaceId,
      userTimezone: user.timezone,
      workspaceTimezone: workspace.timezone,
    })
    .from(dailyChecklistTemplateAssignment)
    .innerJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistTemplateAssignment.templateId)
    )
    .innerJoin(workspace, eq(workspace.id, dailyChecklistTemplate.workspaceId))
    .leftJoin(user, eq(user.id, dailyChecklistTemplateAssignment.userId))
    .where(
      and(
        eq(dailyChecklistTemplate.isActive, true),
        eq(dailyChecklistTemplate.isArchived, false),
        // Scoping is only for tests/tools; the scheduled job covers every workspace.
        opts.workspaceId
          ? eq(dailyChecklistTemplate.workspaceId, opts.workspaceId)
          : undefined
      )
    );

  const stats: DailyChecklistGenerateStats = {
    users: new Set(assignees.map((a) => a.userId)).size,
    created: 0,
    failed: 0,
  };
  for (const a of assignees) {
    // Same resolution as on-demand generation: user → workspace → UTC.
    const date = todayInTz(
      now,
      getEffectiveTimezone(
        { timezone: a.userTimezone },
        { timezone: a.workspaceTimezone }
      )
    );
    try {
      const created = await db.transaction((tx) =>
        ensureTeamDays(tx, a.userId, date, a.workspaceId)
      );
      stats.created += created.length;
    } catch (err) {
      // One user's failure must not block everyone else's checklist.
      stats.failed++;
      console.error(
        "[daily-checklist-generate] failed for user",
        a.userId,
        err
      );
    }
  }
  console.log("[daily-checklist-generate]", stats);
  return stats;
}

export async function handleDailyChecklistGenerate(
  _jobs: Job<Record<string, never>>[]
) {
  await runDailyChecklistGenerate();
}
