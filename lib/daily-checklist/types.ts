import type {
  ChecklistPriority,
  ChecklistStatus,
  Recurrence,
} from "./constants";
import type { FieldOption, FieldType } from "./fields";
import type { DayStatus, Progress } from "./progress";

export type ChecklistActionError = { error: string };

/** One custom field on a saved checklist item — definition snapshot + the member's value. */
export interface FieldValueDTO {
  id: string;
  name: string;
  options: FieldOption[] | null;
  required: boolean;
  sortOrder: number;
  type: FieldType;
  value: string | null;
}

export interface TemplateFieldDTO {
  /** true = applies to every template item; otherwise only `itemIds`. */
  appliesToAll: boolean;
  id: string;
  isRequired: boolean;
  /** Template item ids the field applies to (empty when `appliesToAll`). */
  itemIds: string[];
  name: string;
  options: FieldOption[];
  sortOrder: number;
  type: FieldType;
}

export interface ChecklistItemDTO {
  completedAt: string | null;
  completedBy: string | null;
  description: string | null;
  dueTime: string | null;
  /** Team items only. */
  fields?: FieldValueDTO[];
  id: string;
  notes: string | null;
  priority: ChecklistPriority;
  sortOrder: number;
  status: ChecklistStatus;
  title: string;
}

export interface MyChecklistResult {
  date: string;
  /** True only for today in the viewer's timezone — past days are read-only history. */
  editable: boolean;
  /** False when a past date has no saved checklist (nothing is ever generated retroactively). */
  exists: boolean;
  items: ChecklistItemDTO[];
  progress: Progress;
  timezone: string;
  today: string;
}

export interface HistoryRow {
  completed: number;
  date: string;
  /** Present for TEAM history. */
  dayId: string;
  status: DayStatus;
  templateId: string | null;
  templateName: string | null;
  total: number;
  userId: string;
  userName: string | null;
}

export interface HistoryPage {
  nextCursor: string | null;
  rows: HistoryRow[];
}

export interface TeamItemRow extends ChecklistItemDTO {
  assigneeId: string;
  assigneeImage: string | null;
  assigneeName: string;
  /** The assignee's effective timezone (user → workspace → UTC) — used for the overdue display. */
  assigneeTimezone: string;
  /** The checklist day's date (YYYY-MM-DD). */
  date: string;
  dayId: string;
  /** Viewer owns this instance AND it is today → can change status. */
  editable: boolean;
  templateId: string | null;
  /** Template item this day's item was snapshotted from (null if that item was later deleted). */
  templateItemId: string | null;
  templateName: string | null;
}

export interface TeamChecklistResult {
  date: string;
  editable: boolean;
  isAdmin: boolean;
  rows: TeamItemRow[];
  timezone: string;
  today: string;
}

export interface DayDetail {
  date: string;
  editable: false;
  items: ChecklistItemDTO[];
  progress: Progress;
  templateName: string | null;
  type: "PERSONAL" | "TEAM";
  userName: string | null;
}

export interface TemplateItemDTO {
  description: string | null;
  dueTime: string | null;
  id: string;
  priority: ChecklistPriority;
  sortOrder: number;
  title: string;
}

export interface TemplateAssigneeDTO {
  email: string;
  image: string | null;
  name: string;
  userId: string;
}

export interface TemplateDTO {
  assignees: TemplateAssigneeDTO[];
  description: string | null;
  endDate: string | null;
  fields: TemplateFieldDTO[];
  id: string;
  isActive: boolean;
  items: TemplateItemDTO[];
  name: string;
  recurrence: Recurrence;
  recurrenceDays: number[];
  startDate: string;
}

export interface TodayInstanceRow {
  completed: number;
  dayId: string;
  status: DayStatus;
  templateId: string | null;
  templateName: string | null;
  total: number;
  userId: string;
  userImage: string | null;
  userName: string;
}

/** Admin → Checklist → History (report): server-side filters. All optional; dates are plain YYYY-MM-DD. */
export type HistoryReportStatus = "COMPLETED" | "IN_PROGRESS" | "NOT_STARTED";

export interface HistoryReportFilters {
  from?: string;
  page?: number;
  status?: HistoryReportStatus;
  templateId?: string;
  to?: string;
  userId?: string;
}

/** One saved Team day, summary only (no items) — items load when "View" is opened. */
export interface HistoryReportRow {
  completed: number;
  date: string;
  dayId: string;
  /** First non-empty item note of the day (full text; the UI truncates). */
  note: string | null;
  /** Incomplete AND the checklist date is before the admin's today. */
  overdue: boolean;
  status: DayStatus;
  templateId: string | null;
  templateName: string | null;
  total: number;
  userId: string;
  userImage: string | null;
  userName: string | null;
}

export interface HistoryReportSummary {
  /** Checklists (days) fully done / started-but-unfinished / nothing started. */
  completed: number;
  inProgress: number;
  /** Distinct people with at least one checklist in the filtered result. */
  members: number;
  notStarted: number;
}

export interface HistoryReportResult {
  /** The filters actually applied (defaults filled in). */
  filters: Required<Pick<HistoryReportFilters, "from" | "to">> &
    Omit<HistoryReportFilters, "from" | "to" | "page">;
  members: { id: string; name: string }[];
  page: number;
  pageCount: number;
  pageSize: number;
  rows: HistoryReportRow[];
  summary: HistoryReportSummary;
  templates: { id: string; name: string }[];
  today: string;
  total: number;
}

/** Admin → History → expanded row: one saved Team day's snapshot items (read-only). */
export interface HistoryItemsResult {
  dayId: string;
  items: ChecklistItemDTO[];
  /** The assignee's effective timezone — completion times are shown in it. */
  timezone: string;
}
