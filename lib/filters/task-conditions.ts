// Shared server-side task-filter WHERE-clause builder. One place builds the
// Drizzle conditions for status / priority / due / assignee / tags / sprint so
// getFilteredTasks (list view) and globalSearch (omnibox) never duplicate SQL.
//
// Server-only (imports db). Assignee/tags/sprint use subqueries so they compose
// with LIMIT — no post-fetch JS filtering.

import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  type SQL,
} from "drizzle-orm";
import { listStatus, task, taskAssignee, taskTag } from "@/db/schema";
import { taskSprint } from "@/db/schema/sprint";
import { db } from "@/lib/db";
import { weekRange } from "@/lib/due-date";
import type { TaskFilters } from "./options";

type PriorityValue = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

/**
 * Build the reusable task-filter conditions. Returns an array to spread into an
 * `and(...)`.
 *
 * `today` is the viewer's calendar day (`YYYY-MM-DD`, from their timezone — see
 * `getUserToday`). Due dates are calendar days, so "overdue" is strictly before
 * today: a task due today is never overdue.
 *
 * Note: a `statusType` filter references `listStatus.type`, so the caller's query
 * MUST innerJoin `listStatus` (globalSearch does). Callers that filter by concrete
 * `status` IDs (getFilteredTasks) don't need that join.
 */
export function buildTaskFilterConditions(
  filters: TaskFilters,
  today: string
): SQL[] {
  const conditions: SQL[] = [];

  if (filters.status?.length) {
    conditions.push(inArray(task.statusId, filters.status));
  }

  if (filters.statusType?.length) {
    conditions.push(inArray(listStatus.type, filters.statusType));
  }

  if (filters.priority?.length) {
    conditions.push(
      inArray(task.priority, filters.priority as PriorityValue[])
    );
  }

  if (filters.due) {
    if (filters.due === "overdue") {
      conditions.push(lt(task.dueDateEnd, today));
    } else if (filters.due === "today") {
      conditions.push(eq(task.dueDateEnd, today));
    } else if (filters.due === "this_week") {
      const week = weekRange(today, 0);
      conditions.push(gte(task.dueDateEnd, week.from));
      conditions.push(lte(task.dueDateEnd, week.to));
    } else if (filters.due === "no_due_date") {
      conditions.push(isNull(task.dueDateEnd));
    }
  }

  // Assignee — OR of (has any of the picked users) and (unassigned = no rows).
  if (filters.assignee?.length) {
    const hasUnassigned = filters.assignee.includes("unassigned");
    const userIds = filters.assignee.filter((a) => a !== "unassigned");
    const parts: SQL[] = [];
    if (userIds.length) {
      parts.push(
        inArray(
          task.id,
          db
            .select({ id: taskAssignee.taskId })
            .from(taskAssignee)
            .where(inArray(taskAssignee.userId, userIds))
        )
      );
    }
    if (hasUnassigned) {
      parts.push(
        notInArray(
          task.id,
          db.select({ id: taskAssignee.taskId }).from(taskAssignee)
        )
      );
    }
    if (parts.length === 1) {
      conditions.push(parts[0]);
    } else if (parts.length > 1) {
      const combined = or(...parts);
      if (combined) {
        conditions.push(combined);
      }
    }
  }

  // Tags — task has any of the picked tags.
  if (filters.tags?.length) {
    conditions.push(
      inArray(
        task.id,
        db
          .select({ id: taskTag.taskId })
          .from(taskTag)
          .where(inArray(taskTag.tagId, filters.tags))
      )
    );
  }

  // Sprint — membership via the taskSprint join table (no task.sprintId column).
  if (filters.sprint?.length) {
    conditions.push(
      inArray(
        task.id,
        db
          .select({ id: taskSprint.taskId })
          .from(taskSprint)
          .where(inArray(taskSprint.sprintId, filters.sprint))
      )
    );
  }

  return conditions;
}

/** Merge builder conditions with base conditions into a single `and(...)`. */
export function withTaskFilters(
  base: SQL[],
  filters: TaskFilters,
  today: string
): SQL | undefined {
  return and(...base, ...buildTaskFilterConditions(filters, today));
}
