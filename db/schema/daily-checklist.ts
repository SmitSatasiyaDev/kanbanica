import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspace } from "./workspace";

// Checklist (docs/daily-checklist.md). Named `daily_checklist_*` because
// `checklist` / `checklist_item` already hold per-task subtask checklists.
//
// Template → Day → Item. A Day is one user's checklist for one date and its Items
// are a *snapshot* copied from the template at generation time, so editing a
// template never rewrites history.

export const dailyChecklistTemplate = pgTable(
  "daily_checklist_template",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // V1: always "TEAM".
    type: text("type").notNull().default("TEAM"),
    // DAILY | WEEKDAYS | WEEKLY | CUSTOM
    recurrence: text("recurrence").notNull().default("WEEKDAYS"),
    // Weekdays 0 (Sun) … 6 (Sat). Used by WEEKLY / CUSTOM.
    recurrenceDays: integer("recurrence_days").array().notNull().default(sql`'{}'::integer[]`),
    isActive: boolean("is_active").notNull().default(true),
    // Soft delete: archived templates stop generating but keep their history.
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("daily_checklist_template_workspace_active_idx").on(
      t.workspaceId,
      t.isActive,
      t.isArchived,
    ),
  ],
);

export const dailyChecklistTemplateItem = pgTable(
  "daily_checklist_template_item",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => dailyChecklistTemplate.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull().default("NONE"),
    // "HH:MM" in the assignee's timezone.
    dueTime: text("due_time"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("daily_checklist_template_item_order_idx").on(t.templateId, t.sortOrder)],
);

export const dailyChecklistTemplateAssignment = pgTable(
  "daily_checklist_template_assignment",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => dailyChecklistTemplate.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("daily_checklist_assignment_template_user_idx").on(t.templateId, t.userId),
    index("daily_checklist_assignment_user_idx").on(t.userId),
  ],
);

export const dailyChecklistDay = pgTable(
  "daily_checklist_day",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Null for PERSONAL days. Plain FK-less reference: templates are only
    // soft-deleted, and a day must outlive any template change.
    templateId: text("template_id").references(() => dailyChecklistTemplate.id, {
      onDelete: "set null",
    }),
    // The owner's *local* calendar date (YYYY-MM-DD) — no timezone semantics.
    date: date("date", { mode: "string" }).notNull(),
    // PERSONAL | TEAM
    type: text("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NULL template ids are distinct in Postgres, so PERSONAL and TEAM need
    // separate partial unique indexes to be duplicate-proof.
    uniqueIndex("daily_checklist_day_personal_uniq")
      .on(t.workspaceId, t.userId, t.date)
      .where(sql`${t.type} = 'PERSONAL'`),
    uniqueIndex("daily_checklist_day_team_uniq")
      .on(t.workspaceId, t.userId, t.templateId, t.date)
      .where(sql`${t.type} = 'TEAM'`),
    index("daily_checklist_day_workspace_date_idx").on(t.workspaceId, t.date),
    index("daily_checklist_day_user_date_idx").on(t.userId, t.date),
    index("daily_checklist_day_template_date_idx").on(t.templateId, t.date),
  ],
);

export const dailyChecklistItem = pgTable(
  "daily_checklist_item",
  {
    id: text("id").primaryKey(),
    dayId: text("day_id")
      .notNull()
      .references(() => dailyChecklistDay.id, { onDelete: "cascade" }),
    templateItemId: text("template_item_id").references(() => dailyChecklistTemplateItem.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    // PENDING | IN_PROGRESS | DONE
    status: text("status").notNull().default("PENDING"),
    priority: text("priority").notNull().default("NONE"),
    dueTime: text("due_time"),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by").references(() => user.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("daily_checklist_item_day_order_idx").on(t.dayId, t.sortOrder),
    // Makes snapshot copying idempotent: re-running generation can't double-insert.
    uniqueIndex("daily_checklist_item_day_template_item_uniq")
      .on(t.dayId, t.templateItemId)
      .where(sql`${t.templateItemId} is not null`),
  ],
);

// ── Custom fields (template-level definitions) ──────────────────────────────
// Admins define fields per Team template. Generating a day SNAPSHOTS them into
// `daily_checklist_item_field_value` (name/type/required/options live on the value row),
// so editing or deleting a definition never changes a saved day.

export const dailyChecklistField = pgTable(
  "daily_checklist_field",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => dailyChecklistTemplate.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // TEXT | DROPDOWN | NUMBER | DATE | CHECKBOX
    type: text("type").notNull(),
    isRequired: boolean("is_required").notNull().default(false),
    // true (default, and every pre-existing field) = the field applies to every template item;
    // false = only the items listed in `daily_checklist_field_item`.
    appliesToAll: boolean("applies_to_all").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("daily_checklist_field_template_order_idx").on(t.templateId, t.sortOrder)],
);

// Which template items a field applies to when `appliesToAll` is false. Deleting an item
// or the field removes its rows; saved days are unaffected (they hold their own snapshot).
export const dailyChecklistFieldItem = pgTable(
  "daily_checklist_field_item",
  {
    fieldId: text("field_id")
      .notNull()
      .references(() => dailyChecklistField.id, { onDelete: "cascade" }),
    templateItemId: text("template_item_id")
      .notNull()
      .references(() => dailyChecklistTemplateItem.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("daily_checklist_field_item_uniq").on(t.fieldId, t.templateItemId),
    index("daily_checklist_field_item_item_idx").on(t.templateItemId),
  ],
);

export const dailyChecklistFieldOption = pgTable(
  "daily_checklist_field_option",
  {
    id: text("id").primaryKey(),
    fieldId: text("field_id")
      .notNull()
      .references(() => dailyChecklistField.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    value: text("value").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("daily_checklist_field_option_field_value_idx").on(t.fieldId, t.value),
    index("daily_checklist_field_option_order_idx").on(t.fieldId, t.sortOrder),
  ],
);

export type FieldOptionSnapshot = { label: string; value: string };

export const dailyChecklistItemFieldValue = pgTable(
  "daily_checklist_item_field_value",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => dailyChecklistItem.id, { onDelete: "cascade" }),
    // Null once the definition is deleted — the snapshot columns below keep the day readable.
    fieldId: text("field_id").references(() => dailyChecklistField.id, { onDelete: "set null" }),
    fieldName: text("field_name").notNull(),
    fieldType: text("field_type").notNull(),
    fieldRequired: boolean("field_required").notNull().default(false),
    fieldOptions: jsonb("field_options").$type<FieldOptionSnapshot[]>(),
    sortOrder: integer("sort_order").notNull().default(0),
    // Canonical string: text / number / YYYY-MM-DD / "true"|"false" / option value. Null = unset.
    value: text("value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("daily_checklist_item_field_value_item_idx").on(t.itemId, t.sortOrder),
    uniqueIndex("daily_checklist_item_field_value_item_field_uniq")
      .on(t.itemId, t.fieldId)
      .where(sql`${t.fieldId} is not null`),
  ],
);
