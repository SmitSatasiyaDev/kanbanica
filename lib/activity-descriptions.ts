import type { DashboardCategory } from "@/lib/dashboard-category";
import { formatDuration } from "@/lib/format-duration";

export function describeEvent(
  eventType: string,
  meta: Record<string, unknown>
): string {
  switch (eventType) {
    case "task_created":
      return "created this task";
    case "task_duplicated":
      return meta.from_seq
        ? `duplicated this task from #${meta.from_seq}`
        : "duplicated this task";
    case "title_changed":
      return `renamed to "${meta.to}"`;
    case "status_changed":
      return `changed status from ${meta.from_status_name ?? "—"} → ${meta.to_status_name ?? "—"}`;
    case "priority_changed":
      return `changed priority to ${meta.to}`;
    case "description_updated":
      return "updated the description";
    case "assignee_added":
      return `assigned ${meta.user_name ?? "someone"}`;
    case "assignee_removed":
      return `unassigned ${meta.user_name ?? "someone"}`;
    case "watcher_added":
      return "started watching";
    case "watcher_removed":
      return "stopped watching";
    case "due_date_set":
      return `set due date to ${meta.date}`;
    case "due_date_changed":
      return `changed due date from ${meta.from} → ${meta.to}`;
    case "due_date_removed":
      return "removed due date";
    case "tag_added":
      return `added tag "${meta.tagName}"`;
    case "tag_removed":
      return `removed tag "${meta.tagName}"`;
    case "checklist_created":
      return `added checklist "${meta.checklist_name}"`;
    case "checklist_deleted":
      return `deleted checklist "${meta.checklist_name}"`;
    case "checklist_item_checked":
      return `checked "${meta.item_title}"`;
    case "checklist_item_unchecked":
      return `unchecked "${meta.item_title}"`;
    case "custom_field_value_set":
      return `set "${meta.fieldName}"`;
    case "custom_field_value_cleared":
      return `cleared "${meta.fieldName}"`;
    case "dependency_added":
      return `added dependency on "${meta.depends_on_task_title}"`;
    case "dependency_removed":
      return `removed dependency on "${meta.depends_on_task_title}"`;
    case "attachment_uploaded":
      return `uploaded "${meta.file_name}"`;
    case "attachment_deleted":
      return `deleted "${meta.file_name}"`;
    case "task_archived":
      return "archived this task";
    case "task_unarchived":
      return "unarchived this task";
    case "task_deleted":
      return "moved this task to Trash";
    case "task_restored":
      return "restored this task from Trash";
    case "task_moved":
      return "moved this task";
    case "time_logged":
      return `logged ${formatDuration(Number(meta.seconds))}`;
    case "timer_started":
      return "started time tracking";
    case "timer_stopped":
      return "stopped time tracking";
    case "comment_added":
      return "left a comment";
    case "subtask_created":
      return `created subtask "${meta.subtask_title}"`;
    case "subtask_completed":
      return `completed subtask "${meta.subtask_title}"`;
    case "sprint_assigned":
      return `added to ${meta.sprint_name}`;
    case "sprint_unassigned":
      return `removed from ${meta.sprint_name}`;
    default:
      return eventType.replace(/_/g, " ");
  }
}

const ACTIVITY_ICON: Record<string, string> = {
  task_created: "✨",
  task_duplicated: "📄",
  title_changed: "✏️",
  status_changed: "🔄",
  priority_changed: "🚩",
  description_updated: "📝",
  assignee_added: "👤",
  assignee_removed: "👤",
  watcher_added: "👀",
  watcher_removed: "👀",
  due_date_set: "📅",
  due_date_changed: "📅",
  due_date_removed: "📅",
  tag_added: "🏷️",
  tag_removed: "🏷️",
  checklist_created: "☑️",
  checklist_deleted: "☑️",
  checklist_item_checked: "✅",
  checklist_item_unchecked: "⬜",
  custom_field_value_set: "🧩",
  custom_field_value_cleared: "🧩",
  dependency_added: "🔗",
  dependency_removed: "🔗",
  attachment_uploaded: "📎",
  attachment_deleted: "🗑️",
  task_archived: "📦",
  task_unarchived: "📤",
  task_deleted: "🗑️",
  task_restored: "♻️",
  task_moved: "🔀",
  time_logged: "⏱️",
  timer_started: "▶️",
  timer_stopped: "⏸️",
  comment_added: "💬",
  subtask_created: "➕",
  subtask_completed: "✅",
  sprint_assigned: "🏁",
  sprint_unassigned: "🏁",
};

const DEFAULT_ACTIVITY_ICON = "🔹";

/**
 * Icon shown next to each Recent Activity row, keyed by `eventType`. A
 * `status_changed` row that lands on a COMPLETED-category status shows ✅
 * instead of the generic 🔄 — `toDashboardCategory` is only meaningful for
 * that one event type, everything else ignores it.
 */
export function activityIcon(
  eventType: string,
  toDashboardCategory?: DashboardCategory | null
): string {
  if (eventType === "status_changed" && toDashboardCategory === "COMPLETED") {
    return "✅";
  }
  return ACTIVITY_ICON[eventType] ?? DEFAULT_ACTIVITY_ICON;
}
