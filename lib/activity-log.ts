import { createId } from "@paralleldrive/cuid2";
import { activityLog } from "@/db/schema";
import { db } from "@/lib/db";

export type ActivityEventType =
  | "task_created"
  | "task_duplicated"
  | "title_changed"
  | "status_changed"
  | "priority_changed"
  | "description_updated"
  | "assignee_added"
  | "assignee_removed"
  | "watcher_added"
  | "watcher_removed"
  | "due_date_set"
  | "due_date_changed"
  | "due_date_removed"
  | "tag_added"
  | "tag_removed"
  | "checklist_created"
  | "checklist_deleted"
  | "checklist_item_checked"
  | "checklist_item_unchecked"
  | "dependency_added"
  | "dependency_removed"
  | "attachment_uploaded"
  | "attachment_deleted"
  | "task_moved"
  | "task_archived"
  | "task_unarchived"
  | "task_deleted"
  | "task_restored"
  | "time_logged"
  | "timer_started"
  | "timer_stopped"
  | "comment_added"
  | "comment_edited"
  | "comment_deleted"
  | "comment_resolved"
  | "comment_unresolved"
  | "subtask_created"
  | "subtask_deleted"
  | "subtask_completed"
  | "sprint_assigned"
  | "sprint_unassigned"
  | "story_points_set"
  | "checklist_item_added"
  | "checklist_item_deleted"
  | "checklist_renamed"
  | "custom_field_value_set"
  | "custom_field_value_cleared";

export type ActivityMeta = Record<string, unknown>;

export async function writeActivityLog(
  taskId: string,
  userId: string,
  eventType: ActivityEventType,
  meta: ActivityMeta = {}
): Promise<void> {
  try {
    await db.insert(activityLog).values({
      id: createId(),
      taskId,
      userId,
      eventType,
      meta,
    });
  } catch {
    // Activity logging is fire-and-forget — never block the main action
  }
}

// Batch variant of writeActivityLog — one insert for N entries instead of N
// round trips. Used by the CSV importer (lib/import-export/bulk-import-tasks.ts)
// to log one `task_created` entry per created task without looping the
// single-row insert above. Same fire-and-forget contract: never throws.
export async function writeActivityLogBulk(
  entries: {
    taskId: string;
    userId: string;
    eventType: ActivityEventType;
    meta?: ActivityMeta;
  }[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  try {
    await db.insert(activityLog).values(
      entries.map((e) => ({
        id: createId(),
        taskId: e.taskId,
        userId: e.userId,
        eventType: e.eventType,
        meta: e.meta ?? {},
      }))
    );
  } catch {
    // Activity logging is fire-and-forget — never block the main action
  }
}
