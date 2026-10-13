import { date, pgEnum, pgTable, text, timestamp, integer, boolean, index, unique } from "drizzle-orm/pg-core";
import { space } from "./space";
import { task } from "./task";

export const sprintStatusEnum = pgEnum("sprint_status", ["PLANNED", "ACTIVE", "CLOSED"]);
export const incompleteStrategyEnum = pgEnum("incomplete_strategy", ["move_to_backlog", "move_to_next_sprint", "leave_as_is"]);

export const sprint = pgTable(
  "sprint",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal"),
    status: sprintStatusEnum("status").notNull().default("PLANNED"),
    // Calendar days (`YYYY-MM-DD`), like task due dates — see docs/due-dates.md.
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    durationWeeks: integer("duration_weeks").notNull().default(2),
    autoCreateNext: boolean("auto_create_next").notNull().default(false),
    autoCloseOnNext: boolean("auto_close_on_next").notNull().default(false),
    autoIncompleteStrategy: incompleteStrategyEnum("auto_incomplete_strategy").notNull().default("move_to_backlog"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sprint_space_id_idx").on(t.spaceId)],
);

export const taskSprint = pgTable("task_sprint", {
  taskId: text("task_id")
    .notNull()
    .references(() => task.id, { onDelete: "cascade" }),
  sprintId: text("sprint_id")
    .notNull()
    .references(() => sprint.id, { onDelete: "cascade" }),
  points: integer("points"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("task_sprint_pk").on(t.taskId, t.sprintId)]);
