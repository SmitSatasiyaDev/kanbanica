import type { CustomFieldRow } from "@/app/actions/custom-field";
import { validateCustomFieldValue } from "@/lib/custom-fields/validation";
import { isValidDateStr } from "@/lib/due-date";
import {
  FIXED_MAPPABLE_FIELDS,
  IGNORE_TARGET,
  isCustomFieldTarget,
} from "./column-mapping";

export type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
const PRIORITIES: Priority[] = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"];

export interface ListStatusOption {
  id: string;
  name: string;
  type: "OPEN" | "ACTIVE" | "CLOSED";
}

export interface WorkspaceMemberOption {
  email: string | null;
  name: string | null;
  userId: string;
}

export interface ExistingTaskRef {
  hasParent: boolean;
  taskId: string;
}

export interface ValidationContext {
  customFields: CustomFieldRow[];
  // Existing, non-archived tasks in the target list, keyed by lowercased
  // title AND by "#<seqNumber>" — either form can be used as a Parent Task
  // reference.
  existingTasksByRef: Map<string, ExistingTaskRef>;
  // Other rows in the same file, keyed by lowercased title — lets a row
  // reference a parent that's being created in the same import.
  fileRowTitleToIndex: Map<string, number>;
  listStatuses: ListStatusOption[];
  membersByEmail: Map<string, WorkspaceMemberOption>;
  tagNamesLower: Set<string>;
  workspaceId: string;
}

export type ParentRef =
  | { type: "existing"; taskId: string }
  | { type: "inFile"; rowIndex: number }
  | null;

export interface MappedTaskData {
  assigneeIds: string[];
  // fieldId -> validated value, ready for customFieldValue insertion.
  customFieldValues: Record<string, unknown>;
  description: string | null;
  dueDateEnd: string | null;
  dueDateStart: string | null;
  parentRef: ParentRef;
  priority: Priority;
  statusId: string | null;
  tagNames: string[];
  title: string;
}

export type RowStatus = "valid" | "warning" | "invalid" | "skipped";

export interface ValidatedRow {
  data: MappedTaskData | null;
  errors: string[];
  rowIndex: number;
  status: RowStatus;
  warnings: string[];
}

// The mapping object is the single source of truth for which CSV column (if
// any) feeds a given Kanbanica field. A column explicitly mapped to
// IGNORE_TARGET ("Do not import") looks identical here to a field that was
// never mapped at all — in both cases no header points at `target`, so the
// raw CSV value is never read, matching every other optional field's
// behavior generically (no per-field special-casing needed).
function cell(
  row: Record<string, string>,
  mapping: Record<string, string>,
  target: string
): string {
  const header = Object.keys(mapping).find((h) => mapping[h] === target);
  return header ? (row[header] ?? "").trim() : "";
}

// Whether any CSV column is mapped to `target` at all (as opposed to that
// column's cell merely being blank for this row). Used to gate warnings that
// should only fire when the user mapped a column and left a row's value
// empty — not when the field is globally unmapped/ignored, which should
// silently fall back with no per-row noise.
function isMapped(mapping: Record<string, string>, target: string): boolean {
  return Object.values(mapping).includes(target);
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveDefaultStatus(
  statuses: ListStatusOption[]
): ListStatusOption | null {
  const firstOpen = statuses.find((s) => s.type === "OPEN");
  return firstOpen ?? statuses[0] ?? null;
}

function parseCheckboxValue(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0", "n"].includes(normalized)) {
    return false;
  }
  return null;
}

function isRowEmpty(
  row: Record<string, string>,
  mapping: Record<string, string>
): boolean {
  return Object.keys(mapping).every((header) => {
    if (mapping[header] === IGNORE_TARGET) {
      return true;
    }
    return !(row[header] ?? "").trim();
  });
}

// Validates and maps a single CSV row against the target list's statuses,
// workspace members, tags, and custom fields. Pure given its `context` — no
// DB calls — so the same function runs identically in the /validate preview
// and the /confirm re-check (confirm just builds `context` from a fresh
// fetch). Returns `status: "skipped"` for fully-blank rows (not counted as
// invalid, per the CSV-handling spec).
export async function validateImportRow(
  row: Record<string, string>,
  mapping: Record<string, string>,
  context: ValidationContext,
  rowIndex: number
): Promise<ValidatedRow> {
  if (isRowEmpty(row, mapping)) {
    return {
      rowIndex,
      status: "skipped",
      data: null,
      errors: [],
      warnings: [],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const title = cell(row, mapping, "title");
  if (!title) {
    errors.push("Title is required");
  }

  // ─── Status ──────────────────────────────────────────────────────────────
  const statusRaw = cell(row, mapping, "status");
  let statusId: string | null = null;
  if (statusRaw) {
    const match = context.listStatuses.find(
      (s) => s.name.toLowerCase() === statusRaw.toLowerCase()
    );
    if (match) {
      statusId = match.id;
    } else {
      const validNames = context.listStatuses.map((s) => s.name).join(", ");
      errors.push(
        `Status "${statusRaw}" was not found. Valid statuses: ${validNames}`
      );
    }
  } else {
    const fallback = resolveDefaultStatus(context.listStatuses);
    statusId = fallback?.id ?? null;
    // Only worth flagging when the user mapped a column to Status and this
    // particular row left it blank. When Status itself is mapped to "Do not
    // import" (or never mapped), every row would hit this path — that's the
    // user's explicit choice to ignore the field entirely, not something to
    // warn about per row.
    if (fallback && isMapped(mapping, "status")) {
      warnings.push(`Status not specified — defaulting to "${fallback.name}"`);
    }
  }

  // ─── Priority ────────────────────────────────────────────────────────────
  const priorityRaw = cell(row, mapping, "priority");
  let priority: Priority = "NONE";
  if (priorityRaw) {
    const match = PRIORITIES.find((p) => p === priorityRaw.toUpperCase());
    if (match) {
      priority = match;
    } else {
      errors.push(
        `Priority "${priorityRaw}" is invalid. Valid values: ${PRIORITIES.join(", ")}`
      );
    }
  }

  // ─── Dates ───────────────────────────────────────────────────────────────
  // Due dates are calendar days. Accepts `YYYY-MM-DD` (what the export writes)
  // and, for older exports, a full ISO timestamp — whose leading date part is used.
  function parseDate(raw: string, label: string): string | null {
    if (!raw) {
      return null;
    }
    const day = raw.trim().slice(0, 10);
    if (
      !(/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw.trim()) && isValidDateStr(day))
    ) {
      errors.push(`${label} "${raw}" is not a valid date (use YYYY-MM-DD)`);
      return null;
    }
    return day;
  }
  const dueDateStartRaw = cell(row, mapping, "dueDateStart");
  const dueDateEndRaw = cell(row, mapping, "dueDateEnd");
  const dueDateStart = parseDate(dueDateStartRaw, "Start date");
  const dueDateEnd = parseDate(dueDateEndRaw, "Due date");
  if (dueDateStart && dueDateEnd && dueDateEnd < dueDateStart) {
    warnings.push("Due date is before the start date");
  }

  // ─── Assignees ───────────────────────────────────────────────────────────
  const assigneesRaw = cell(row, mapping, "assignees");
  const assigneeIds: string[] = [];
  for (const name of splitList(assigneesRaw)) {
    const member = context.membersByEmail.get(name.toLowerCase());
    if (member) {
      assigneeIds.push(member.userId);
    } else {
      errors.push(`Assignee "${name}" was not found`);
    }
  }

  // ─── Tags ────────────────────────────────────────────────────────────────
  const tagsRaw = cell(row, mapping, "tags");
  const tagNames = [...new Set(splitList(tagsRaw))];
  const newTagNames = tagNames.filter(
    (name) => !context.tagNamesLower.has(name.toLowerCase())
  );
  if (newTagNames.length > 0) {
    warnings.push(
      `New tag${newTagNames.length > 1 ? "s" : ""} will be created: ${newTagNames.join(", ")}`
    );
  }

  // ─── Parent task ─────────────────────────────────────────────────────────
  const parentRaw = cell(row, mapping, "parentTask").replace(/^#/, "");
  let parentRef: ParentRef = null;
  if (parentRaw) {
    const existing = context.existingTasksByRef.get(parentRaw.toLowerCase());
    const inFileIndex = context.fileRowTitleToIndex.get(
      parentRaw.toLowerCase()
    );
    if (existing) {
      if (existing.hasParent) {
        errors.push(
          `Cannot nest subtasks more than one level ("${parentRaw}" is itself a subtask)`
        );
      } else {
        parentRef = { type: "existing", taskId: existing.taskId };
      }
    } else if (inFileIndex !== undefined && inFileIndex !== rowIndex) {
      parentRef = { type: "inFile", rowIndex: inFileIndex };
    } else {
      errors.push(`Parent task "${parentRaw}" was not found`);
    }
  }

  // ─── Custom fields ───────────────────────────────────────────────────────
  const customFieldValues: Record<string, unknown> = {};
  for (const field of context.customFields) {
    const header = Object.keys(mapping).find(
      (h) => isCustomFieldTarget(mapping[h]) === field.id
    );
    if (!header) {
      if (field.required) {
        errors.push(`${field.name} is required but is not mapped to a column`);
      }
      continue;
    }
    const raw = (row[header] ?? "").trim();
    if (!raw) {
      if (field.required) {
        errors.push(`${field.name} is required`);
      }
      continue;
    }

    if (field.type === "PERSON") {
      const member = context.membersByEmail.get(raw.toLowerCase());
      if (member) {
        customFieldValues[field.id] = member.userId;
      } else {
        errors.push(`${field.name}: "${raw}" was not found`);
      }
      continue;
    }

    let parsedValue: unknown = raw;
    if (field.type === "CHECKBOX") {
      const parsed = parseCheckboxValue(raw);
      if (parsed === null) {
        errors.push(`${field.name}: "${raw}" must be true/false`);
        continue;
      }
      parsedValue = parsed;
    } else if (field.type === "SINGLE_SELECT") {
      const option = (field.config.options ?? []).find(
        (o) => o.label.toLowerCase() === raw.toLowerCase()
      );
      if (!option) {
        errors.push(`${field.name}: "${raw}" is not a valid option`);
        continue;
      }
      parsedValue = option.id;
    } else if (field.type === "MULTI_SELECT") {
      const options = field.config.options ?? [];
      const ids: string[] = [];
      let bad: string | null = null;
      for (const label of splitList(raw)) {
        const option = options.find(
          (o) => o.label.toLowerCase() === label.toLowerCase()
        );
        if (!option) {
          bad = label;
          break;
        }
        ids.push(option.id);
      }
      if (bad) {
        errors.push(`${field.name}: "${bad}" is not a valid option`);
        continue;
      }
      parsedValue = ids;
    }

    const result = await validateCustomFieldValue(
      field,
      context.workspaceId,
      parsedValue
    );
    if ("error" in result) {
      errors.push(`${field.name}: ${result.error}`);
    } else {
      customFieldValues[field.id] = result.value;
    }
  }

  const data: MappedTaskData = {
    title,
    description: cell(row, mapping, "description") || null,
    statusId,
    priority,
    assigneeIds,
    dueDateStart,
    dueDateEnd,
    tagNames,
    parentRef,
    customFieldValues,
  };

  return {
    rowIndex,
    status:
      errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
    data,
    errors,
    warnings,
  };
}

// Required custom fields that aren't mapped to any column at all — surfaced
// once, up front, instead of as the same error repeated on every row.
export function findUnmappedRequiredFields(
  mapping: Record<string, string>,
  customFields: Pick<CustomFieldRow, "id" | "name" | "required">[]
): string[] {
  const mappedTargets = new Set(Object.values(mapping));
  return customFields
    .filter((f) => f.required && !mappedTargets.has(`customField:${f.id}`))
    .map((f) => f.name);
}

// Required fixed fields missing from the mapping (today: just Title).
export function findUnmappedRequiredFixedFields(
  mapping: Record<string, string>
): string[] {
  const mappedTargets = new Set(Object.values(mapping));
  return FIXED_MAPPABLE_FIELDS.filter(
    (f) => f.required && !mappedTargets.has(f.key)
  ).map((f) => f.label);
}

// Flags rows that look like accidental duplicates (same title + status +
// assignees + due date) — a warning, not a hard error, so the user decides.
export function detectDuplicateRowIndexes(
  rows: { rowIndex: number; data: MappedTaskData }[]
): Set<number> {
  const seen = new Map<string, number>();
  const duplicates = new Set<number>();
  for (const { rowIndex, data } of rows) {
    const key = [
      data.title.toLowerCase(),
      data.statusId ?? "",
      [...data.assigneeIds].sort().join(","),
      data.dueDateEnd ?? "",
    ].join("|");
    if (seen.has(key)) {
      duplicates.add(rowIndex);
      duplicates.add(seen.get(key)!);
    } else {
      seen.set(key, rowIndex);
    }
  }
  return duplicates;
}
