"use server";

import { and, asc, desc, eq, inArray, lt, max, sql } from "drizzle-orm";
import { getWorkspaceMembers } from "@/app/actions/task";
import {
  dailyChecklistDay,
  dailyChecklistField,
  dailyChecklistFieldItem,
  dailyChecklistFieldOption,
  dailyChecklistItem,
  dailyChecklistTemplate,
  dailyChecklistTemplateAssignment,
  dailyChecklistTemplateItem,
  user,
} from "@/db/schema";
import { requireChecklistAccess } from "@/lib/daily-checklist/access";
import type {
  ChecklistPriority,
  Recurrence,
} from "@/lib/daily-checklist/constants";
import { LIMITS } from "@/lib/daily-checklist/constants";
import { ensureTeamDays } from "@/lib/daily-checklist/ensure";
import {
  insertField,
  loadItemKeyMap,
  planItemIds,
  resolveFieldItemIds,
  syncTemplateFields,
  updateField,
} from "@/lib/daily-checklist/field-sync";
import { FIELD_LIMITS } from "@/lib/daily-checklist/fields";
import { dayStatus } from "@/lib/daily-checklist/progress";
import {
  dayCountCols,
  filterAssignableUserIds,
  userToday,
} from "@/lib/daily-checklist/queries";
import type {
  ChecklistActionError,
  HistoryPage,
  HistoryRow,
  TemplateDTO,
  TemplateFieldDTO,
  TodayInstanceRow,
} from "@/lib/daily-checklist/types";
import {
  dateSchema,
  fieldSchema,
  firstError,
  templateItemSchema,
  templateSchema,
} from "@/lib/daily-checklist/validation";
import { db } from "@/lib/db";
import { refreshWorkspace } from "@/lib/realtime/refresh";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A template the caller may manage: must live in the caller's workspace and be un-archived. */
async function loadTemplate(
  executor: Tx | typeof db,
  workspaceId: string,
  templateId: string
) {
  const [t] = await executor
    .select()
    .from(dailyChecklistTemplate)
    .where(
      and(
        eq(dailyChecklistTemplate.id, templateId),
        eq(dailyChecklistTemplate.workspaceId, workspaceId),
        eq(dailyChecklistTemplate.isArchived, false)
      )
    )
    .limit(1);
  return t ?? null;
}

/**
 * Gives users who were just assigned today's checklist right away (instead of at the next
 * worker run / page open). Reuses `ensureTeamDays`, so recurrence, the user's own local date,
 * active/archived and membership rules, snapshots and idempotency are all inherited. Runs
 * after the save committed; a failure is left for the worker / on-demand path to catch up.
 */
async function generateForAdded(workspaceId: string, userIds: string[]) {
  for (const userId of userIds) {
    try {
      const { today } = await userToday(db, userId, workspaceId);
      await ensureTeamDays(db, userId, today, workspaceId);
    } catch {
      // non-fatal: generation is idempotent and retried by the worker / page open
    }
  }
}

/** Returns an error string, or the ids of users newly added by this call. */
async function replaceAssignments(
  tx: Tx,
  workspaceId: string,
  templateId: string,
  userIds: string[]
): Promise<string | { added: string[] }> {
  const valid = await filterAssignableUserIds(tx, workspaceId, userIds);
  if (valid.length !== userIds.length) {
    return "One or more selected users are not active members of this workspace";
  }
  const existing = await tx
    .select({ userId: dailyChecklistTemplateAssignment.userId })
    .from(dailyChecklistTemplateAssignment)
    .where(eq(dailyChecklistTemplateAssignment.templateId, templateId));
  const have = new Set(existing.map((e) => e.userId));
  const want = new Set(valid);
  const remove = [...have].filter((u) => !want.has(u));
  if (remove.length > 0) {
    await tx
      .delete(dailyChecklistTemplateAssignment)
      .where(
        and(
          eq(dailyChecklistTemplateAssignment.templateId, templateId),
          inArray(dailyChecklistTemplateAssignment.userId, remove)
        )
      );
  }
  const add = [...want].filter((u) => !have.has(u));
  if (add.length > 0) {
    await tx
      .insert(dailyChecklistTemplateAssignment)
      .values(
        add.map((userId) => ({ id: crypto.randomUUID(), templateId, userId }))
      )
      .onConflictDoNothing();
  }
  return { added: add };
}

// ───────────────────────────── members for the picker ─────────────────────────────

export async function getAssignableMembers(workspaceId: string) {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const res = await getWorkspaceMembers(workspaceId);
  if ("error" in res) {
    return { error: res.error };
  }
  return { members: res.members.filter((m) => m.role !== "GUEST") };
}

// ───────────────────────────── templates ─────────────────────────────

export async function listChecklistTemplates(
  workspaceId: string
): Promise<{ templates: TemplateDTO[] } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const templates = await db
    .select()
    .from(dailyChecklistTemplate)
    .where(
      and(
        eq(dailyChecklistTemplate.workspaceId, workspaceId),
        eq(dailyChecklistTemplate.isArchived, false)
      )
    )
    .orderBy(desc(dailyChecklistTemplate.createdAt));
  if (templates.length === 0) {
    return { templates: [] };
  }
  const ids = templates.map((t) => t.id);
  // Two batched queries (items, assignees) — no per-template round trips.
  const [items, assignees, fields, options, fieldItems] = await Promise.all([
    db
      .select()
      .from(dailyChecklistTemplateItem)
      .where(inArray(dailyChecklistTemplateItem.templateId, ids))
      .orderBy(asc(dailyChecklistTemplateItem.sortOrder)),
    db
      .select({
        templateId: dailyChecklistTemplateAssignment.templateId,
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(dailyChecklistTemplateAssignment)
      .innerJoin(user, eq(user.id, dailyChecklistTemplateAssignment.userId))
      .where(inArray(dailyChecklistTemplateAssignment.templateId, ids))
      .orderBy(asc(user.name)),
    db
      .select()
      .from(dailyChecklistField)
      .where(inArray(dailyChecklistField.templateId, ids))
      .orderBy(asc(dailyChecklistField.sortOrder)),
    db
      .select({ o: dailyChecklistFieldOption })
      .from(dailyChecklistFieldOption)
      .innerJoin(
        dailyChecklistField,
        eq(dailyChecklistField.id, dailyChecklistFieldOption.fieldId)
      )
      .where(inArray(dailyChecklistField.templateId, ids))
      .orderBy(asc(dailyChecklistFieldOption.sortOrder)),
    db
      .select({
        fieldId: dailyChecklistFieldItem.fieldId,
        templateItemId: dailyChecklistFieldItem.templateItemId,
      })
      .from(dailyChecklistFieldItem)
      .innerJoin(
        dailyChecklistField,
        eq(dailyChecklistField.id, dailyChecklistFieldItem.fieldId)
      )
      .where(inArray(dailyChecklistField.templateId, ids)),
  ]);
  return {
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      isActive: t.isActive,
      recurrence: t.recurrence as Recurrence,
      recurrenceDays: t.recurrenceDays,
      startDate: t.startDate,
      endDate: t.endDate,
      items: items
        .filter((i) => i.templateId === t.id)
        .map((i) => ({
          id: i.id,
          title: i.title,
          description: i.description,
          priority: i.priority as ChecklistPriority,
          dueTime: i.dueTime,
          sortOrder: i.sortOrder,
        })),
      fields: fields
        .filter((f) => f.templateId === t.id)
        .map(
          (f): TemplateFieldDTO => ({
            id: f.id,
            name: f.name,
            type: f.type as TemplateFieldDTO["type"],
            isRequired: f.isRequired,
            appliesToAll: f.appliesToAll,
            itemIds: f.appliesToAll
              ? []
              : fieldItems
                  .filter((x) => x.fieldId === f.id)
                  .map((x) => x.templateItemId),
            sortOrder: f.sortOrder,
            options: options
              .filter((x) => x.o.fieldId === f.id)
              .map((x) => ({ label: x.o.label, value: x.o.value })),
          })
        ),
      assignees: assignees
        .filter((x) => x.templateId === t.id)
        .map((x) => ({
          userId: x.userId,
          name: x.name,
          email: x.email,
          image: x.image,
        })),
    })),
  };
}

export async function createChecklistTemplate(
  workspaceId: string,
  input: unknown
): Promise<{ id: string } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstError(parsed.error) };
  }
  const v = parsed.data;
  const id = crypto.randomUUID();
  const valid = await filterAssignableUserIds(db, workspaceId, v.assigneeIds);
  if (valid.length !== v.assigneeIds.length) {
    return {
      error:
        "One or more selected users are not active members of this workspace",
    };
  }
  // Items get their ids up front so fields can reference items created in this same save.
  const rawItems =
    (input as { items?: { id?: string; key?: string }[] }).items ?? [];
  const plan = planItemIds(rawItems, v.items.length, new Set());
  const fieldTargets: string[][] = [];
  for (const f of v.fields) {
    const target = resolveFieldItemIds(f, plan.keyToId);
    if ("error" in target) {
      return { error: target.error };
    }
    fieldTargets.push(target.ids);
  }
  await db.transaction(async (tx) => {
    await tx.insert(dailyChecklistTemplate).values({
      id,
      workspaceId,
      name: v.name,
      description: v.description,
      recurrence: v.recurrence,
      recurrenceDays: v.recurrenceDays,
      startDate: v.startDate,
      endDate: v.endDate,
      createdBy: a.userId,
    });
    if (v.items.length > 0) {
      await tx.insert(dailyChecklistTemplateItem).values(
        v.items.map((it, i) => ({
          id: plan.ids[i],
          templateId: id,
          title: it.title,
          description: it.description,
          priority: it.priority,
          dueTime: it.dueTime,
          sortOrder: i,
        }))
      );
    }
    for (const [i, f] of v.fields.entries()) {
      await insertField(tx, id, f, i, fieldTargets[i]);
    }
    if (valid.length > 0) {
      await tx.insert(dailyChecklistTemplateAssignment).values(
        valid.map((userId) => ({
          id: crypto.randomUUID(),
          templateId: id,
          userId,
        }))
      );
    }
  });
  await generateForAdded(workspaceId, valid);
  await refreshWorkspace(workspaceId);
  return { id };
}

/**
 * Updates template fields, items (matched by optional `id`; missing ones are removed,
 * order = array order) and assignments. Only template tables change — saved daily
 * instances keep the snapshot they were generated with.
 */
export async function updateChecklistTemplate(
  workspaceId: string,
  templateId: string,
  input: unknown
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstError(parsed.error) };
  }
  const v = parsed.data;
  const rawItems =
    (input as { items?: { id?: string; key?: string }[] }).items ?? [];
  const result = await db.transaction(async (tx) => {
    const t = await loadTemplate(tx, workspaceId, templateId);
    if (!t) {
      return "Template not found";
    }
    const existing = await tx
      .select({ id: dailyChecklistTemplateItem.id })
      .from(dailyChecklistTemplateItem)
      .where(eq(dailyChecklistTemplateItem.templateId, templateId));
    const existingIds = new Set(existing.map((e) => e.id));
    // Validate every field -> item reference before writing anything.
    const plan = planItemIds(rawItems, v.items.length, existingIds);
    if ((input as { fields?: unknown }).fields !== undefined) {
      for (const f of v.fields) {
        const target = resolveFieldItemIds(f, plan.keyToId);
        if ("error" in target) {
          return target.error;
        }
      }
    }
    await tx
      .update(dailyChecklistTemplate)
      .set({
        name: v.name,
        description: v.description,
        recurrence: v.recurrence,
        recurrenceDays: v.recurrenceDays,
        startDate: v.startDate,
        endDate: v.endDate,
        updatedAt: new Date(),
      })
      .where(eq(dailyChecklistTemplate.id, templateId));

    const keep = new Set<string>();
    for (const [i, it] of v.items.entries()) {
      const id = plan.ids[i];
      const fields = {
        title: it.title,
        description: it.description,
        priority: it.priority,
        dueTime: it.dueTime,
        sortOrder: i,
        updatedAt: new Date(),
      };
      if (existingIds.has(id)) {
        keep.add(id);
        await tx
          .update(dailyChecklistTemplateItem)
          .set(fields)
          .where(eq(dailyChecklistTemplateItem.id, id));
      } else {
        await tx
          .insert(dailyChecklistTemplateItem)
          .values({ id, templateId, ...fields });
      }
    }
    const drop = [...existingIds].filter((id) => !keep.has(id));
    if (drop.length > 0) {
      // Day items keep their snapshot; their templateItemId is set to null by the FK.
      await tx
        .delete(dailyChecklistTemplateItem)
        .where(inArray(dailyChecklistTemplateItem.id, drop));
    }
    // Fields are only synced when the payload carries them, so older callers keep theirs.
    if ((input as { fields?: unknown }).fields !== undefined) {
      const fe = await syncTemplateFields(
        tx,
        templateId,
        v.fields,
        plan.keyToId
      );
      if (fe) {
        return fe;
      }
    }
    return replaceAssignments(tx, workspaceId, templateId, v.assigneeIds);
  });
  if (typeof result === "string") {
    return { error: result };
  }
  await generateForAdded(workspaceId, result.added);
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

/** Disable (isActive=false) or re-enable. Existing days and history are untouched. */
export async function disableChecklistTemplate(
  workspaceId: string,
  templateId: string,
  isActive = false
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const t = await loadTemplate(db, workspaceId, templateId);
  if (!t) {
    return { error: "Template not found" };
  }
  await db
    .update(dailyChecklistTemplate)
    .set({ isActive: Boolean(isActive), updatedAt: new Date() })
    .where(eq(dailyChecklistTemplate.id, templateId));
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

/** Soft delete: stops generation, keeps every saved day readable. */
export async function deleteChecklistTemplate(
  workspaceId: string,
  templateId: string
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const t = await loadTemplate(db, workspaceId, templateId);
  if (!t) {
    return { error: "Template not found" };
  }
  await db
    .update(dailyChecklistTemplate)
    .set({
      isArchived: true,
      isActive: false,
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(dailyChecklistTemplate.id, templateId));
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

// ───────────────────────────── template items ─────────────────────────────

export async function createTemplateItem(
  workspaceId: string,
  templateId: string,
  input: unknown
): Promise<{ id: string } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const parsed = templateItemSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstError(parsed.error) };
  }
  if (!(await loadTemplate(db, workspaceId, templateId))) {
    return { error: "Template not found" };
  }
  const [m] = await db
    .select({ v: max(dailyChecklistTemplateItem.sortOrder) })
    .from(dailyChecklistTemplateItem)
    .where(eq(dailyChecklistTemplateItem.templateId, templateId));
  const count = (m?.v ?? -1) + 1;
  if (count >= LIMITS.templateItems) {
    return {
      error: `A template can have at most ${LIMITS.templateItems} items`,
    };
  }
  const id = crypto.randomUUID();
  await db
    .insert(dailyChecklistTemplateItem)
    .values({ id, templateId, ...parsed.data, sortOrder: count });
  await refreshWorkspace(workspaceId);
  return { id };
}

async function resolveTemplateItem(workspaceId: string, itemId: string) {
  const [row] = await db
    .select({ item: dailyChecklistTemplateItem })
    .from(dailyChecklistTemplateItem)
    .innerJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistTemplateItem.templateId)
    )
    .where(
      and(
        eq(dailyChecklistTemplateItem.id, itemId),
        eq(dailyChecklistTemplate.workspaceId, workspaceId),
        eq(dailyChecklistTemplate.isArchived, false)
      )
    )
    .limit(1);
  return row?.item ?? null;
}

export async function updateTemplateItem(
  workspaceId: string,
  itemId: string,
  input: unknown
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const parsed = templateItemSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstError(parsed.error) };
  }
  if (!(await resolveTemplateItem(workspaceId, itemId))) {
    return { error: "Item not found" };
  }
  await db
    .update(dailyChecklistTemplateItem)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(dailyChecklistTemplateItem.id, itemId));
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function deleteTemplateItem(
  workspaceId: string,
  itemId: string
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  if (!(await resolveTemplateItem(workspaceId, itemId))) {
    return { error: "Item not found" };
  }
  // A field limited to selected items must keep at least one of them.
  const soleTargets = await db
    .select({ name: dailyChecklistField.name })
    .from(dailyChecklistFieldItem)
    .innerJoin(
      dailyChecklistField,
      eq(dailyChecklistField.id, dailyChecklistFieldItem.fieldId)
    )
    .where(
      and(
        eq(dailyChecklistFieldItem.templateItemId, itemId),
        sql`(select count(*) from ${dailyChecklistFieldItem} fi where fi.field_id = ${dailyChecklistField.id}) = 1`
      )
    );
  if (soleTargets.length > 0) {
    return {
      error: `"${soleTargets[0].name}" only applies to this item. Change that field first.`,
    };
  }
  await db
    .delete(dailyChecklistTemplateItem)
    .where(eq(dailyChecklistTemplateItem.id, itemId));
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function reorderTemplateItems(
  workspaceId: string,
  templateId: string,
  orderedIds: string[]
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  if (!Array.isArray(orderedIds)) {
    return { error: "Invalid order" };
  }
  const ok = await db.transaction(async (tx) => {
    if (!(await loadTemplate(tx, workspaceId, templateId))) {
      return false;
    }
    const cur = await tx
      .select({ id: dailyChecklistTemplateItem.id })
      .from(dailyChecklistTemplateItem)
      .where(eq(dailyChecklistTemplateItem.templateId, templateId));
    const have = new Set(cur.map((c) => c.id));
    if (
      have.size !== orderedIds.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      !orderedIds.every((id) => have.has(id))
    ) {
      return false;
    }
    for (const [i, id] of orderedIds.entries()) {
      await tx
        .update(dailyChecklistTemplateItem)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(dailyChecklistTemplateItem.id, id));
    }
    return true;
  });
  if (!ok) {
    return { error: "Invalid order" };
  }
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function updateTemplateAssignments(
  workspaceId: string,
  templateId: string,
  userIds: string[]
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  if (
    !Array.isArray(userIds) ||
    userIds.length > LIMITS.assignees ||
    userIds.some((u) => typeof u !== "string")
  ) {
    return { error: "Invalid assignees" };
  }
  const result = await db.transaction(async (tx) => {
    if (!(await loadTemplate(tx, workspaceId, templateId))) {
      return "Template not found";
    }
    return replaceAssignments(tx, workspaceId, templateId, [
      ...new Set(userIds),
    ]);
  });
  if (typeof result === "string") {
    return { error: result };
  }
  await generateForAdded(workspaceId, result.added);
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

// ───────────────────────────── custom fields ─────────────────────────────
// Definitions only; saved days keep their own snapshot (see lib/daily-checklist/ensure.ts).

export async function createTemplateField(
  workspaceId: string,
  templateId: string,
  input: unknown
): Promise<{ id: string } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const parsed = fieldSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstError(parsed.error) };
  }
  const result = await db.transaction(async (tx) => {
    if (!(await loadTemplate(tx, workspaceId, templateId))) {
      return "Template not found";
    }
    const cur = await tx
      .select({ name: dailyChecklistField.name })
      .from(dailyChecklistField)
      .where(eq(dailyChecklistField.templateId, templateId));
    if (cur.length >= FIELD_LIMITS.fieldsPerTemplate) {
      return `A template can have at most ${FIELD_LIMITS.fieldsPerTemplate} custom fields`;
    }
    if (
      cur.some((c) => c.name.toLowerCase() === parsed.data.name.toLowerCase())
    ) {
      return `Duplicate field name "${parsed.data.name}"`;
    }
    const target = resolveFieldItemIds(
      parsed.data,
      await loadItemKeyMap(tx, templateId)
    );
    if ("error" in target) {
      return target.error;
    }
    return {
      id: await insertField(
        tx,
        templateId,
        parsed.data,
        cur.length,
        target.ids
      ),
    };
  });
  if (typeof result === "string") {
    return { error: result };
  }
  await refreshWorkspace(workspaceId);
  return result;
}

async function loadField(
  tx: Tx | typeof db,
  workspaceId: string,
  fieldId: string
) {
  const [row] = await tx
    .select({ f: dailyChecklistField })
    .from(dailyChecklistField)
    .innerJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistField.templateId)
    )
    .where(
      and(
        eq(dailyChecklistField.id, fieldId),
        eq(dailyChecklistTemplate.workspaceId, workspaceId),
        eq(dailyChecklistTemplate.isArchived, false)
      )
    )
    .limit(1);
  return row?.f ?? null;
}

export async function updateTemplateField(
  workspaceId: string,
  fieldId: string,
  input: unknown
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const parsed = fieldSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstError(parsed.error) };
  }
  const err = await db.transaction(async (tx) => {
    const f = await loadField(tx, workspaceId, fieldId);
    if (!f) {
      return "Field not found";
    }
    const siblings = await tx
      .select({ id: dailyChecklistField.id, name: dailyChecklistField.name })
      .from(dailyChecklistField)
      .where(eq(dailyChecklistField.templateId, f.templateId));
    if (
      siblings.some(
        (s) =>
          s.id !== f.id &&
          s.name.toLowerCase() === parsed.data.name.toLowerCase()
      )
    ) {
      return `Duplicate field name "${parsed.data.name}"`;
    }
    const target = resolveFieldItemIds(
      parsed.data,
      await loadItemKeyMap(tx, f.templateId)
    );
    if ("error" in target) {
      return target.error;
    }
    return updateField(tx, f, parsed.data, f.sortOrder, target.ids);
  });
  if (err) {
    return { error: err };
  }
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function deleteTemplateField(
  workspaceId: string,
  fieldId: string
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  if (!(await loadField(db, workspaceId, fieldId))) {
    return { error: "Field not found" };
  }
  // Saved days keep their snapshot rows (fieldId → null via FK).
  await db
    .delete(dailyChecklistField)
    .where(eq(dailyChecklistField.id, fieldId));
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function reorderTemplateFields(
  workspaceId: string,
  templateId: string,
  orderedIds: string[]
): Promise<{ ok: true } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  if (!Array.isArray(orderedIds)) {
    return { error: "Invalid order" };
  }
  const ok = await db.transaction(async (tx) => {
    if (!(await loadTemplate(tx, workspaceId, templateId))) {
      return false;
    }
    const cur = await tx
      .select({ id: dailyChecklistField.id })
      .from(dailyChecklistField)
      .where(eq(dailyChecklistField.templateId, templateId));
    const have = new Set(cur.map((c) => c.id));
    if (
      have.size !== orderedIds.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      !orderedIds.every((id) => have.has(id))
    ) {
      return false;
    }
    for (const [i, id] of orderedIds.entries()) {
      await tx
        .update(dailyChecklistField)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(dailyChecklistField.id, id));
    }
    return true;
  });
  if (!ok) {
    return { error: "Invalid order" };
  }
  await refreshWorkspace(workspaceId);
  return { ok: true };
}

// ───────────────────────────── admin views ─────────────────────────────

/** Today's instances (one row per template × user) that have been generated. */
export async function getTodaysChecklists(
  workspaceId: string,
  date?: string
): Promise<{ date: string; rows: TodayInstanceRow[] } | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  const { today } = await userToday(db, a.userId, workspaceId);
  const parsed =
    date === undefined
      ? { success: true as const, data: today }
      : dateSchema.safeParse(date);
  if (!parsed.success) {
    return { error: "Invalid date" };
  }
  const target = parsed.data;
  if (target > today) {
    return { error: "Cannot open a future day" };
  }
  // Read-only: days are generated by the worker / the viewer's own page / assignee adds.
  // Opening this view never sweeps every assignee.
  const rows = await db
    .select({
      dayId: dailyChecklistDay.id,
      userId: dailyChecklistDay.userId,
      userName: user.name,
      userImage: user.image,
      templateId: dailyChecklistDay.templateId,
      templateName: dailyChecklistTemplate.name,
      ...dayCountCols,
    })
    .from(dailyChecklistDay)
    .innerJoin(user, eq(user.id, dailyChecklistDay.userId))
    .leftJoin(
      dailyChecklistItem,
      eq(dailyChecklistItem.dayId, dailyChecklistDay.id)
    )
    .leftJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistDay.templateId)
    )
    .where(
      and(
        eq(dailyChecklistDay.workspaceId, workspaceId),
        eq(dailyChecklistDay.type, "TEAM"),
        eq(dailyChecklistDay.date, target)
      )
    )
    .groupBy(dailyChecklistDay.id, user.id, dailyChecklistTemplate.name)
    .orderBy(asc(dailyChecklistTemplate.name), asc(user.name));
  return {
    date: target,
    rows: rows.map((r) => ({
      dayId: r.dayId,
      userId: r.userId,
      userName: r.userName,
      userImage: r.userImage,
      templateId: r.templateId,
      templateName: r.templateName,
      total: r.total,
      completed: r.completed,
      status: dayStatus(r.completed, r.total, r.started > 0),
    })),
  };
}

/** Workspace-wide team history, newest first, paginated by date cursor. */
export async function getTeamChecklistHistory(
  workspaceId: string,
  opts?: { before?: string; date?: string; limit?: number }
): Promise<HistoryPage | ChecklistActionError> {
  const a = await requireChecklistAccess(workspaceId, "admin");
  if ("error" in a) {
    return { error: a.error };
  }
  if (opts?.date !== undefined && !dateSchema.safeParse(opts.date).success) {
    return { error: "Invalid date" };
  }
  if (
    opts?.before !== undefined &&
    !dateSchema.safeParse(opts.before).success
  ) {
    return { error: "Invalid date" };
  }
  const limit = Math.min(
    Math.max(opts?.limit ?? LIMITS.adminHistoryDates, 1),
    100
  );
  const scope = and(
    eq(dailyChecklistDay.workspaceId, workspaceId),
    eq(dailyChecklistDay.type, "TEAM")
  );
  // Specific-date mode: exactly that checklist date (no cursor, one date = one whole page).
  // Otherwise: 1) page of DATES only (newest first), served by the (workspace_id, date)
  // index with a plain date cursor `date < before`; one extra date says whether more exist.
  let hasMore = false;
  let pageDates: string[];
  if (opts?.date) {
    pageDates = [opts.date];
  } else {
    const dateRows = await db
      .select({ date: dailyChecklistDay.date })
      .from(dailyChecklistDay)
      .where(
        and(
          scope,
          opts?.before ? lt(dailyChecklistDay.date, opts.before) : undefined
        )
      )
      .groupBy(dailyChecklistDay.date)
      .orderBy(desc(dailyChecklistDay.date))
      .limit(limit + 1);
    hasMore = dateRows.length > limit;
    pageDates = dateRows.slice(0, limit).map((r) => r.date);
  }
  if (pageDates.length === 0) {
    return { rows: [], nextCursor: null };
  }
  // 2) Every day-row of exactly those dates, with its item counts. A date is never split
  //    across pages, and only this page's items are aggregated (not the whole history).
  const rows = await db
    .select({
      dayId: dailyChecklistDay.id,
      date: dailyChecklistDay.date,
      userId: dailyChecklistDay.userId,
      userName: user.name,
      templateId: dailyChecklistDay.templateId,
      templateName: dailyChecklistTemplate.name,
      ...dayCountCols,
    })
    .from(dailyChecklistDay)
    .innerJoin(user, eq(user.id, dailyChecklistDay.userId))
    .leftJoin(
      dailyChecklistItem,
      eq(dailyChecklistItem.dayId, dailyChecklistDay.id)
    )
    .leftJoin(
      dailyChecklistTemplate,
      eq(dailyChecklistTemplate.id, dailyChecklistDay.templateId)
    )
    .where(and(scope, inArray(dailyChecklistDay.date, pageDates)))
    .groupBy(dailyChecklistDay.id, user.id, dailyChecklistTemplate.name)
    .orderBy(
      desc(dailyChecklistDay.date),
      asc(dailyChecklistTemplate.name),
      asc(user.name)
    );
  const out: HistoryRow[] = rows.map((r) => ({
    dayId: r.dayId,
    date: r.date,
    userId: r.userId,
    userName: r.userName,
    templateId: r.templateId,
    templateName: r.templateName,
    total: r.total,
    completed: r.completed,
    status: dayStatus(r.completed, r.total, r.started > 0),
  }));
  return {
    rows: out,
    nextCursor: hasMore ? (pageDates.at(-1) ?? null) : null,
  };
}
