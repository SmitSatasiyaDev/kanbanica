import { and, eq, inArray } from "drizzle-orm";
import { getCustomFieldsForTasks } from "@/app/actions/custom-field";
import {
  list,
  listStatus,
  space,
  tag,
  task,
  taskAssignee,
  taskTag,
  user,
} from "@/db/schema";
import { db } from "@/lib/db";
import { requireViewAccess } from "@/lib/permissions";
import { notDeleted } from "@/lib/task-visibility";
import { tiptapToPlainText } from "./tiptap-text";

export const EXPORT_BASE_COLUMNS = [
  "Task ID",
  "Title",
  "Description",
  "Status",
  "Priority",
  "Assignees",
  "Start Date",
  "Due Date",
  "Tags",
  "Project",
  "List",
  "Parent Task",
  "Created At",
  "Updated At",
] as const;

export interface ExportScope {
  // Omit to export every non-archived list in the space (whole-project export).
  listId?: string;
  spaceId: string;
  // When set, export only these task ids (still scoped to workspace/space/list above).
  taskIds?: string[];
  workspaceId: string;
}

export interface ExportResult {
  columns: string[];
  rows: Record<string, string>[];
}

function formatDate(d: Date | null): string {
  return d ? d.toISOString() : "";
}

// Fetches every task the current user is authorized to see within the given
// scope and shapes it into CSV-ready rows. Mirrors the read patterns already
// used by getTaskDetail/getCustomFieldsForTasks — no new query style, just
// aggregated for a flat export row.
export async function getExportableTasks(
  userId: string,
  scope: ExportScope
): Promise<ExportResult | { error: string }> {
  const permErr = await requireViewAccess(
    userId,
    scope.workspaceId,
    scope.spaceId
  );
  if (permErr) {
    return permErr;
  }

  const conditions = [
    eq(task.workspaceId, scope.workspaceId),
    eq(task.spaceId, scope.spaceId),
    eq(task.isArchived, false),
    notDeleted(),
  ];
  if (scope.listId) {
    conditions.push(eq(task.listId, scope.listId));
  }
  if (scope.taskIds && scope.taskIds.length > 0) {
    conditions.push(inArray(task.id, scope.taskIds));
  }

  const tasks = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      parentTaskId: task.parentTaskId,
      listId: task.listId,
      listName: list.name,
      statusName: listStatus.name,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })
    .from(task)
    .leftJoin(list, eq(list.id, task.listId))
    .leftJoin(listStatus, eq(listStatus.id, task.statusId))
    .where(and(...conditions));

  if (tasks.length === 0) {
    return { columns: [...EXPORT_BASE_COLUMNS], rows: [] };
  }

  const taskIds = tasks.map((t) => t.id);
  const parentIds = [
    ...new Set(
      tasks.map((t) => t.parentTaskId).filter((id): id is string => Boolean(id))
    ),
  ];

  const [spaceRow, assigneeRows, tagRows, parentRows, fieldsResult] =
    await Promise.all([
      db
        .select({ name: space.name })
        .from(space)
        .where(eq(space.id, scope.spaceId))
        .limit(1),
      db
        .select({
          taskId: taskAssignee.taskId,
          name: user.name,
          email: user.email,
        })
        .from(taskAssignee)
        .innerJoin(user, eq(user.id, taskAssignee.userId))
        .where(inArray(taskAssignee.taskId, taskIds)),
      db
        .select({ taskId: taskTag.taskId, name: tag.name })
        .from(taskTag)
        .innerJoin(tag, eq(tag.id, taskTag.tagId))
        .where(inArray(taskTag.taskId, taskIds)),
      parentIds.length > 0
        ? db
            .select({ id: task.id, seqNumber: task.seqNumber })
            .from(task)
            .where(and(inArray(task.id, parentIds), notDeleted()))
        : Promise.resolve([]),
      // listId=null (whole-project export) returns space-wide + workspace-wide
      // fields only — list-specific fields are intentionally omitted when
      // tasks span multiple lists (see docs/import-export.md).
      getCustomFieldsForTasks(
        scope.workspaceId,
        scope.spaceId,
        scope.listId ?? null,
        taskIds
      ),
    ]);

  const spaceName = spaceRow[0]?.name ?? "";
  const assigneesByTask = new Map<string, string[]>();
  for (const a of assigneeRows) {
    const label =
      a.name && a.email ? `${a.name} <${a.email}>` : a.name || a.email || "";
    assigneesByTask.set(a.taskId, [
      ...(assigneesByTask.get(a.taskId) ?? []),
      label,
    ]);
  }
  const tagsByTask = new Map<string, string[]>();
  for (const t of tagRows) {
    tagsByTask.set(t.taskId, [...(tagsByTask.get(t.taskId) ?? []), t.name]);
  }
  const parentById = new Map(parentRows.map((p) => [p.id, p.seqNumber]));

  const customFields = "fields" in fieldsResult ? fieldsResult.fields : [];
  const valuesByTask =
    "valuesByTask" in fieldsResult ? fieldsResult.valuesByTask : {};
  const customFieldColumns = customFields.map((f) => f.name);

  function formatCustomFieldValue(
    field: (typeof customFields)[number],
    value: unknown
  ): string {
    if (value === null || value === undefined) {
      return "";
    }
    switch (field.type) {
      case "SINGLE_SELECT": {
        const option = (field.config.options ?? []).find((o) => o.id === value);
        return option?.label ?? "";
      }
      case "MULTI_SELECT": {
        const options = field.config.options ?? [];
        return (Array.isArray(value) ? value : [])
          .map((id) => options.find((o) => o.id === id)?.label ?? "")
          .filter(Boolean)
          .join("; ");
      }
      case "CHECKBOX":
        return value ? "true" : "false";
      // PERSON is resolved by the caller (personNameById) before this
      // function is reached — see the row-building loop below.
      default:
        return String(value);
    }
  }

  // PERSON fields store a userId — resolve to a display name via the same
  // assignee rows already fetched (a superset of every user referenced by
  // this export's tasks is good enough; fall back to a fresh lookup for any
  // PERSON value that doesn't happen to be an assignee elsewhere).
  const personIds = new Set<string>();
  for (const f of customFields) {
    if (f.type !== "PERSON") {
      continue;
    }
    for (const taskId of taskIds) {
      const v = valuesByTask[taskId]?.[f.id];
      if (typeof v === "string") {
        personIds.add(v);
      }
    }
  }
  const personNameById = new Map<string, string>();
  if (personIds.size > 0) {
    const people = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(inArray(user.id, [...personIds]));
    for (const p of people) {
      personNameById.set(p.id, p.name || p.email || p.id);
    }
  }

  const rows: Record<string, string>[] = tasks.map((t) => {
    const row: Record<string, string> = {
      "Task ID": `#${t.seqNumber}`,
      Title: t.title,
      Description: tiptapToPlainText(t.description),
      Status: t.statusName ?? "",
      Priority: t.priority,
      Assignees: (assigneesByTask.get(t.id) ?? []).join("; "),
      "Start Date": formatDate(t.dueDateStart),
      "Due Date": formatDate(t.dueDateEnd),
      Tags: (tagsByTask.get(t.id) ?? []).join("; "),
      Project: spaceName,
      List: t.listName ?? "",
      "Parent Task": t.parentTaskId
        ? `#${parentById.get(t.parentTaskId) ?? ""}`
        : "",
      "Created At": formatDate(t.createdAt),
      "Updated At": formatDate(t.updatedAt),
    };
    for (const field of customFields) {
      const value = valuesByTask[t.id]?.[field.id];
      row[field.name] =
        field.type === "PERSON" && typeof value === "string"
          ? (personNameById.get(value) ?? value)
          : formatCustomFieldValue(field, value);
    }
    return row;
  });

  return { columns: [...EXPORT_BASE_COLUMNS, ...customFieldColumns], rows };
}
