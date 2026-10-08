// Pure / client-safe constants for the Checklist feature.

export const CHECKLIST_STATUSES = ["PENDING", "IN_PROGRESS", "DONE"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const CHECKLIST_PRIORITIES = [
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
] as const;
export type ChecklistPriority = (typeof CHECKLIST_PRIORITIES)[number];

export const RECURRENCES = [
  "ONCE",
  "DAILY",
  "WEEKDAYS",
  "WEEKLY",
  "CUSTOM",
] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const STATUS_LABEL: Record<ChecklistStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  ONCE: "Does not repeat",
  DAILY: "Every day",
  WEEKDAYS: "Every weekday (Mon–Fri)",
  WEEKLY: "Every week",
  CUSTOM: "Custom weekly days",
};

export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export const LIMITS = {
  title: 200,
  text: 2000,
  templateName: 100,
  templateItems: 50,
  assignees: 500,
  historyPageSize: 30,
  /** Admin → History: number of distinct DATES per page (each date keeps all its rows together). */
  adminHistoryDates: 20,
} as const;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
