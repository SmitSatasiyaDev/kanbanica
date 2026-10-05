import { sql } from "drizzle-orm";
import { pgEnum, pgTable, text, timestamp, integer, boolean, json, index, unique } from "drizzle-orm/pg-core";
import { workspace } from "./workspace";
import { space } from "./space";
import { list, listStatus } from "./list";

export const priorityEnum = pgEnum("priority", ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]);
export const dependencyTypeEnum = pgEnum("dependency_type", ["BLOCKED_BY"]);

export const task = pgTable(
  "task",
  {
    id: text("id").primaryKey(),
    seqNumber: integer("seq_number").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .references(() => space.id, { onDelete: "cascade" }),
    listId: text("list_id")
      .references(() => list.id, { onDelete: "cascade" }),
    parentTaskId: text("parent_task_id"),
    statusId: text("status_id")
      .references(() => listStatus.id),
    title: text("title").notNull(),
    description: json("description"),
    priority: priorityEnum("priority").notNull().default("NONE"),
    reporterId: text("reporter_id").notNull(),
    dueDateStart: timestamp("due_date_start", { withTimezone: true }),
    dueDateEnd: timestamp("due_date_end", { withTimezone: true }),
    timeEstimate: integer("time_estimate"),
    orderIndex: integer("order_index").notNull().default(0),
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Trash: null deletedAt = live. Rows are purged permanently from Admin → Deleted Tasks.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    deletedWithParentId: text("deleted_with_parent_id"),
    isPinnedToList: boolean("is_pinned_to_list").notNull().default(false),
    pinnedToListBy: text("pinned_to_list_by"),
    pinnedToListAt: timestamp("pinned_to_list_at", { withTimezone: true }),
    pinnedToListOrder: integer("pinned_to_list_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_list_id_idx").on(t.listId),
    index("task_workspace_id_idx").on(t.workspaceId),
    index("task_parent_task_id_idx").on(t.parentTaskId),
    index("task_status_id_idx").on(t.statusId),
    index("task_pinned_to_list_idx").on(t.listId, t.isPinnedToList),
    index("task_deleted_at_idx").on(t.workspaceId, t.deletedAt).where(sql`${t.deletedAt} IS NOT NULL`),
  ],
);

export const taskAssignee = pgTable("task_assignee", {
  taskId: text("task_id")
    .notNull()
    .references(() => task.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("task_assignee_pk").on(t.taskId, t.userId)]);

export const taskWatcher = pgTable("task_watcher", {
  taskId: text("task_id")
    .notNull()
    .references(() => task.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("task_watcher_pk").on(t.taskId, t.userId)]);

export const tag = pgTable("tag", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("tag_workspace_name_unique").on(t.workspaceId, t.name)]);

export const taskTag = pgTable("task_tag", {
  taskId: text("task_id")
    .notNull()
    .references(() => task.id, { onDelete: "cascade" }),
  tagId: text("tag_id")
    .notNull()
    .references(() => tag.id, { onDelete: "cascade" }),
}, (t) => [unique("task_tag_pk").on(t.taskId, t.tagId)]);

export const taskDependency = pgTable("task_dependency", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => task.id, { onDelete: "cascade" }),
  dependsOnTaskId: text("depends_on_task_id")
    .notNull()
    .references(() => task.id, { onDelete: "cascade" }),
  type: dependencyTypeEnum("type").notNull().default("BLOCKED_BY"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("task_dependency_unique").on(t.taskId, t.dependsOnTaskId)]);

export const taskDescriptionSnapshot = pgTable("task_description_snapshot", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .unique()
    .references(() => task.id, { onDelete: "cascade" }),
  content: json("content").notNull(),
  savedBy: text("saved_by").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
});

// NOTE: the old minutes-based `time_log` table was removed. Time tracking now
// lives in `db/schema/time-tracking.ts` (seconds-based `time_entry`, with a
// live-timer concept). Do not re-add a minutes-based log here.
