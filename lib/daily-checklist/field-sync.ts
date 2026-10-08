import { and, asc, eq, inArray } from "drizzle-orm";
import {
  dailyChecklistField,
  dailyChecklistFieldItem,
  dailyChecklistFieldOption,
  dailyChecklistTemplateItem,
} from "@/db/schema";
import type { DbLike } from "./ensure";
import { optionValueFor } from "./fields";
import type { FieldInput } from "./validation";

/**
 * Decides the final id of every template item in a save payload (existing ids are kept,
 * new items get a fresh id) and maps both the client `key` and the id to it, so a field can
 * reference an item that is created in the same save.
 */
export function planItemIds(
  raw: { id?: string; key?: string }[],
  count: number,
  existingIds: Set<string>
) {
  const ids: string[] = [];
  const keyToId = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const r = raw[i];
    const id = r?.id && existingIds.has(r.id) ? r.id : crypto.randomUUID();
    ids.push(id);
    if (r?.key) {
      keyToId.set(r.key, id);
    }
    if (r?.id) {
      keyToId.set(r.id, id);
    }
  }
  return { ids, keyToId };
}

/** Item ids a field applies to ([] = all items), or an error if a reference is stale. */
export function resolveFieldItemIds(
  f: Pick<FieldInput, "appliesToAll" | "itemKeys" | "name">,
  keyToId: Map<string, string>
): { ids: string[] } | { error: string } {
  if (f.appliesToAll !== false) {
    return { ids: [] };
  }
  const ids = new Set<string>();
  for (const k of f.itemKeys) {
    const id = keyToId.get(k);
    if (!id) {
      return {
        error: `Field "${f.name}" refers to a checklist item that doesn't exist`,
      };
    }
    ids.add(id);
  }
  if (ids.size === 0) {
    return { error: `Select at least one checklist item for "${f.name}"` };
  }
  return { ids: [...ids] };
}

/** Item-id lookup for callers that reference items by their stored id only. */
export async function loadItemKeyMap(tx: DbLike, templateId: string) {
  const rows = await tx
    .select({ id: dailyChecklistTemplateItem.id })
    .from(dailyChecklistTemplateItem)
    .where(eq(dailyChecklistTemplateItem.templateId, templateId));
  return new Map(rows.map((r) => [r.id, r.id]));
}

async function replaceFieldItems(
  tx: DbLike,
  fieldId: string,
  itemIds: string[]
) {
  await tx
    .delete(dailyChecklistFieldItem)
    .where(eq(dailyChecklistFieldItem.fieldId, fieldId));
  if (itemIds.length > 0) {
    await tx
      .insert(dailyChecklistFieldItem)
      .values(itemIds.map((templateItemId) => ({ fieldId, templateItemId })));
  }
}

/** Replaces a dropdown's options. Existing labels keep their stored value (stable across edits). */
async function replaceOptions(
  tx: DbLike,
  fieldId: string,
  options: { label: string }[]
) {
  const existing = await tx
    .select()
    .from(dailyChecklistFieldOption)
    .where(eq(dailyChecklistFieldOption.fieldId, fieldId));
  const byLabel = new Map(
    existing.map((o) => [o.label.toLowerCase(), o.value])
  );
  await tx
    .delete(dailyChecklistFieldOption)
    .where(eq(dailyChecklistFieldOption.fieldId, fieldId));
  if (options.length === 0) {
    return;
  }
  const taken = new Set<string>();
  const rows = options.map((o, i) => {
    const prev = byLabel.get(o.label.toLowerCase());
    let value: string;
    if (prev && !taken.has(prev)) {
      value = prev;
      taken.add(prev);
    } else {
      value = optionValueFor(o.label, taken);
    }
    return {
      id: crypto.randomUUID(),
      fieldId,
      label: o.label,
      value,
      sortOrder: i,
    };
  });
  await tx.insert(dailyChecklistFieldOption).values(rows);
}

export async function insertField(
  tx: DbLike,
  templateId: string,
  f: FieldInput,
  sortOrder: number,
  itemIds: string[] = []
) {
  const id = crypto.randomUUID();
  await tx.insert(dailyChecklistField).values({
    id,
    templateId,
    name: f.name,
    type: f.type,
    isRequired: f.isRequired,
    appliesToAll: f.appliesToAll !== false,
    sortOrder,
  });
  await replaceOptions(tx, id, f.options);
  await replaceFieldItems(tx, id, f.appliesToAll === false ? itemIds : []);
  return id;
}

/** Returns an error message, or null. The field type can't change after creation. */
export async function updateField(
  tx: DbLike,
  existing: { id: string; type: string },
  f: FieldInput,
  sortOrder: number,
  itemIds: string[] = []
): Promise<string | null> {
  if (existing.type !== f.type) {
    return "A field's type can't be changed after it is created";
  }
  await tx
    .update(dailyChecklistField)
    .set({
      name: f.name,
      isRequired: f.isRequired,
      ...(f.appliesToAll !== undefined && { appliesToAll: f.appliesToAll }),
      sortOrder,
      updatedAt: new Date(),
    })
    .where(eq(dailyChecklistField.id, existing.id));
  if (f.appliesToAll !== undefined) {
    await replaceFieldItems(
      tx,
      existing.id,
      f.appliesToAll === false ? itemIds : []
    );
  }
  if (f.type === "DROPDOWN") {
    await replaceOptions(tx, existing.id, f.options);
  }
  return null;
}

/** Syncs a template's field list (matched by optional `id`; missing ones are deleted; order = array order). */
export async function syncTemplateFields(
  tx: DbLike,
  templateId: string,
  fields: FieldInput[],
  keyToId?: Map<string, string>
): Promise<string | null> {
  const keys = keyToId ?? (await loadItemKeyMap(tx, templateId));
  const existing = await tx
    .select({ id: dailyChecklistField.id, type: dailyChecklistField.type })
    .from(dailyChecklistField)
    .where(eq(dailyChecklistField.templateId, templateId))
    .orderBy(asc(dailyChecklistField.sortOrder));
  const byId = new Map(existing.map((e) => [e.id, e]));
  const keep = new Set<string>();
  for (const [i, f] of fields.entries()) {
    const target = resolveFieldItemIds(f, keys);
    if ("error" in target) {
      return target.error;
    }
    const ex = f.id ? byId.get(f.id) : undefined;
    if (ex) {
      keep.add(ex.id);
      const err = await updateField(tx, ex, f, i, target.ids);
      if (err) {
        return err;
      }
    } else {
      await insertField(tx, templateId, f, i, target.ids);
    }
  }
  const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (drop.length > 0) {
    // Saved days keep their snapshot; value rows just lose the live fieldId (FK set null).
    await tx
      .delete(dailyChecklistField)
      .where(
        and(
          eq(dailyChecklistField.templateId, templateId),
          inArray(dailyChecklistField.id, drop)
        )
      );
  }
  return null;
}
