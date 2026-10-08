import { and, asc, eq, inArray } from "drizzle-orm";
import {
  dailyChecklistDay,
  dailyChecklistField,
  dailyChecklistFieldItem,
  dailyChecklistFieldOption,
  dailyChecklistItem,
  dailyChecklistItemFieldValue,
  dailyChecklistTemplate,
  dailyChecklistTemplateAssignment,
  dailyChecklistTemplateItem,
  user,
  workspace,
  workspaceMember,
} from "@/db/schema";
import type { db } from "@/lib/db";
import { getEffectiveTimezone } from "@/lib/timezone";
import { occursOn } from "./recurrence";

export type DbLike =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The one place a user's checklist timezone is resolved from the DB:
 * user.timezone → workspace.timezone → UTC (see `getEffectiveTimezone`).
 * Independent of the notification-digest timezone.
 */
export async function getUserTimezone(
  executor: DbLike,
  userId: string,
  workspaceId: string
): Promise<string> {
  const [u] = await executor
    .select({ tz: user.timezone })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const [w] = await executor
    .select({ tz: workspace.timezone })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return getEffectiveTimezone({ timezone: u?.tz }, { timezone: w?.tz });
}

/**
 * Lazily creates (or returns) the user's PERSONAL day for `date`. Concurrency-safe:
 * the partial unique index makes a racing insert a no-op, then we read the winner.
 * Personal checklists never depend on the worker.
 */
export async function ensurePersonalDay(
  executor: DbLike,
  workspaceId: string,
  userId: string,
  date: string
): Promise<string> {
  const [inserted] = await executor
    .insert(dailyChecklistDay)
    .values({
      id: crypto.randomUUID(),
      workspaceId,
      userId,
      templateId: null,
      date,
      type: "PERSONAL",
    })
    .onConflictDoNothing()
    .returning({ id: dailyChecklistDay.id });
  if (inserted) {
    return inserted.id;
  }
  const [existing] = await executor
    .select({ id: dailyChecklistDay.id })
    .from(dailyChecklistDay)
    .where(
      and(
        eq(dailyChecklistDay.workspaceId, workspaceId),
        eq(dailyChecklistDay.userId, userId),
        eq(dailyChecklistDay.date, date),
        eq(dailyChecklistDay.type, "PERSONAL")
      )
    )
    .limit(1);
  if (!existing) {
    throw new Error("Failed to ensure personal checklist day");
  }
  return existing.id;
}

/**
 * Ensures every TEAM instance the user should have on `date` exists, snapshotting
 * the template's items *as they are right now* into the day. Existing days are never
 * touched, so later template edits cannot rewrite history. Idempotent and
 * concurrency-safe (unique day index + unique (day, templateItem) index); safe to
 * call from both a page request and the worker.
 *
 * `workspaceId` narrows to one workspace (page requests); omit it for the worker.
 * Returns the ids of the days that were newly created.
 */
export async function ensureTeamDays(
  executor: DbLike,
  userId: string,
  date: string,
  workspaceId?: string
): Promise<string[]> {
  const templates = await executor
    .select({
      id: dailyChecklistTemplate.id,
      workspaceId: dailyChecklistTemplate.workspaceId,
      recurrence: dailyChecklistTemplate.recurrence,
      recurrenceDays: dailyChecklistTemplate.recurrenceDays,
      startDate: dailyChecklistTemplate.startDate,
      endDate: dailyChecklistTemplate.endDate,
    })
    .from(dailyChecklistTemplateAssignment)
    .innerJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistTemplateAssignment.templateId)
    )
    // Only ACTIVE, non-guest members of the template's workspace get instances.
    .innerJoin(
      workspaceMember,
      and(
        eq(workspaceMember.workspaceId, dailyChecklistTemplate.workspaceId),
        eq(workspaceMember.userId, dailyChecklistTemplateAssignment.userId),
        eq(workspaceMember.status, "ACTIVE"),
        inArray(workspaceMember.role, ["OWNER", "ADMIN", "MEMBER"])
      )
    )
    .where(
      and(
        eq(dailyChecklistTemplateAssignment.userId, userId),
        eq(dailyChecklistTemplate.isActive, true),
        eq(dailyChecklistTemplate.isArchived, false),
        workspaceId
          ? eq(dailyChecklistTemplate.workspaceId, workspaceId)
          : undefined
      )
    );

  const due = templates.filter((t) =>
    occursOn(
      {
        recurrence: t.recurrence as never,
        recurrenceDays: t.recurrenceDays,
        startDate: t.startDate,
        endDate: t.endDate,
      },
      date
    )
  );

  const created: string[] = [];
  for (const t of due) {
    const [day] = await executor
      .insert(dailyChecklistDay)
      .values({
        id: crypto.randomUUID(),
        workspaceId: t.workspaceId,
        userId,
        templateId: t.id,
        date,
        type: "TEAM",
      })
      .onConflictDoNothing()
      .returning({ id: dailyChecklistDay.id });
    if (!day) {
      continue; // already generated — never overwrite
    }
    created.push(day.id);

    const items = await executor
      .select()
      .from(dailyChecklistTemplateItem)
      .where(eq(dailyChecklistTemplateItem.templateId, t.id))
      .orderBy(asc(dailyChecklistTemplateItem.sortOrder));
    if (items.length > 0) {
      const rows = items.map((it, i) => ({
        id: crypto.randomUUID(),
        dayId: day.id,
        templateItemId: it.id,
        title: it.title,
        description: it.description,
        priority: it.priority,
        dueTime: it.dueTime,
        sortOrder: i,
      }));
      await executor
        .insert(dailyChecklistItem)
        .values(rows)
        .onConflictDoNothing();

      // Snapshot the template's custom field definitions onto every item of this day.
      const fields = await executor
        .select()
        .from(dailyChecklistField)
        .where(eq(dailyChecklistField.templateId, t.id))
        .orderBy(asc(dailyChecklistField.sortOrder));
      if (fields.length > 0) {
        const options = await executor
          .select()
          .from(dailyChecklistFieldOption)
          .where(
            inArray(
              dailyChecklistFieldOption.fieldId,
              fields.map((f) => f.id)
            )
          )
          .orderBy(asc(dailyChecklistFieldOption.sortOrder));
        // Fields limited to selected items only snapshot onto those items.
        const scoped = fields.filter((f) => !f.appliesToAll);
        const targets = new Map<string, Set<string>>();
        if (scoped.length > 0) {
          const links = await executor
            .select()
            .from(dailyChecklistFieldItem)
            .where(
              inArray(
                dailyChecklistFieldItem.fieldId,
                scoped.map((f) => f.id)
              )
            );
          for (const l of links) {
            const set = targets.get(l.fieldId) ?? new Set<string>();
            set.add(l.templateItemId);
            targets.set(l.fieldId, set);
          }
        }
        const appliesTo = (
          f: (typeof fields)[number],
          templateItemId: string | null
        ) =>
          f.appliesToAll ||
          (templateItemId !== null &&
            (targets.get(f.id)?.has(templateItemId) ?? false));
        const valueRows = rows.flatMap((row) =>
          fields
            .flatMap((f, i) =>
              appliesTo(f, row.templateItemId) ? [{ f, i }] : []
            )
            .map(({ f, i }) => ({
              id: crypto.randomUUID(),
              itemId: row.id,
              fieldId: f.id,
              fieldName: f.name,
              fieldType: f.type,
              fieldRequired: f.isRequired,
              fieldOptions:
                f.type === "DROPDOWN"
                  ? options
                      .filter((o) => o.fieldId === f.id)
                      .map((o) => ({ label: o.label, value: o.value }))
                  : null,
              sortOrder: i,
            }))
        );
        if (valueRows.length > 0) {
          await executor
            .insert(dailyChecklistItemFieldValue)
            .values(valueRows)
            .onConflictDoNothing();
        }
      }
    }
  }
  return created;
}
