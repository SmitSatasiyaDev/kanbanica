import { date, index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { space } from "./space";
import { workspace } from "./workspace";

// A personal daily-checklist entry — one-off or recurring. Owned by a single user
// within a workspace. Dates are plain
// `YYYY-MM-DD` strings (a checklist day has no timezone). Recurrence is a rule
// evaluated on read (`lib/daily-checklist.ts`); no occurrence rows are
// pre-generated. `repeat` is one of NONE | DAILY | WEEKDAYS | WEEKLY | MONTHLY | CUSTOM;
// CUSTOM uses `repeatInterval` + `repeatUnit` (DAY | WEEK | MONTH).
export const checklistTask = pgTable(
  "checklist_task",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    // Legacy: projects are no longer part of the checklist (no UI/API reads or
    // writes this). Kept only so existing rows aren't altered.
    spaceId: text("space_id").references(() => space.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    // "HH:MM" (24h) or null
    dueTime: text("due_time"),
    repeat: text("repeat").notNull().default("NONE"),
    repeatInterval: integer("repeat_interval").notNull().default(1),
    repeatUnit: text("repeat_unit"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    // Soft delete: hides the whole task/series from every day. Never a hard
    // delete — occurrence rows (status, completedAt, completedBy) are untouched.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("checklist_task_user_idx").on(t.workspaceId, t.userId)],
);

// Per-date state of an item. Completion lives HERE (never on the item), so each
// day is independent and history is never overwritten. `status` is
// INCOMPLETE | COMPLETED | SKIPPED. The *Override columns hold "this day only"
// edits (null = inherit from the item; dueTimeOverride "" = time cleared).
export const checklistTaskOccurrence = pgTable(
  "checklist_task_occurrence",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => checklistTask.id, { onDelete: "cascade" }),
    occurrenceDate: date("occurrence_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("INCOMPLETE"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
    titleOverride: text("title_override"),
    dueTimeOverride: text("due_time_override"),
    // Soft remove ("Delete this and future days"): hides the occurrence while
    // keeping its status and timestamps exactly as recorded.
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("checklist_task_occurrence_item_date_uq").on(t.itemId, t.occurrenceDate),
    index("checklist_task_occurrence_date_idx").on(t.occurrenceDate),
  ],
);
