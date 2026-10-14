import type { ActivityEventType } from "@/lib/activity-log";

/**
 * Filter vocabulary for the Space Activity page. Pure + client-safe: the
 * toolbar renders these options and `getSpaceActivity` maps them to SQL, so
 * both sides agree on which event types each category covers.
 */

export const ACTIVITY_RANGES = [
  { value: "1", label: "Last 24 hours", days: 1 },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "14", label: "Last 14 days", days: 14 },
  { value: "30", label: "Last 30 days", days: 30 },
] as const;

export type ActivityRange = (typeof ACTIVITY_RANGES)[number]["value"];

// 30 days is the page's historical window — the widest range offered.
export const DEFAULT_ACTIVITY_RANGE: ActivityRange = "30";

export function rangeDays(range: string): number {
  return (
    ACTIVITY_RANGES.find((r) => r.value === range)?.days ??
    ACTIVITY_RANGES.at(-1)!.days
  );
}

export const ACTIVITY_CATEGORIES = [
  {
    value: "created",
    label: "Created",
    eventTypes: ["task_created", "task_duplicated", "subtask_created"],
  },
  { value: "status", label: "Status changes", eventTypes: ["status_changed"] },
  // `status_changed` whose target status is in the COMPLETED dashboard
  // category (the same definition Workspace Overview uses), plus subtasks.
  {
    value: "completed",
    label: "Completed",
    eventTypes: ["status_changed", "subtask_completed"],
  },
  {
    value: "assignments",
    label: "Assignments",
    eventTypes: ["assignee_added", "assignee_removed"],
  },
  {
    value: "comments",
    label: "Comments",
    eventTypes: [
      "comment_added",
      "comment_edited",
      "comment_deleted",
      "comment_resolved",
      "comment_unresolved",
    ],
  },
  {
    value: "dates",
    label: "Due dates",
    eventTypes: ["due_date_set", "due_date_changed", "due_date_removed"],
  },
  {
    value: "attachments",
    label: "Attachments",
    eventTypes: ["attachment_uploaded", "attachment_deleted"],
  },
  {
    value: "time",
    label: "Time tracking",
    eventTypes: ["time_logged", "timer_started", "timer_stopped"],
  },
] as const satisfies readonly {
  value: string;
  label: string;
  eventTypes: readonly ActivityEventType[];
}[];

export type ActivityCategory =
  | (typeof ACTIVITY_CATEGORIES)[number]["value"]
  | "all";

export function categoryEventTypes(category: string): string[] | null {
  const found = ACTIVITY_CATEGORIES.find((c) => c.value === category);
  return found ? [...found.eventTypes] : null;
}
