import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq } from "drizzle-orm";
import { getCustomFieldDefinitions } from "@/app/actions/custom-field";
import { spaceRecipientUserIds } from "@/app/actions/space";
import { findOrCreateTagsByNames } from "@/app/actions/task-tag";
import {
  customFieldValue,
  listStatus,
  tag,
  task,
  taskAssignee,
  taskTag,
  taskWatcher,
  user,
  workspaceMember,
} from "@/db/schema";
import { writeActivityLogBulk } from "@/lib/activity-log";
import { db } from "@/lib/db";
import { createBulkNotifications } from "@/lib/notifications/create-bulk-notifications";
import { requireEditAccess } from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { notDeleted } from "@/lib/task-visibility";
import {
  getWorkspaceCapacity,
  requireTaskCapacity,
  TASK_LIMIT_CODE,
  taskLimitReachedMessage,
} from "@/lib/workspace-limits";
import { plainTextToTiptapDoc } from "./tiptap-text";
import {
  type ExistingTaskRef,
  type MappedTaskData,
  type ValidationContext,
  validateImportRow,
  type WorkspaceMemberOption,
} from "./validate-row";

export interface BulkImportResult {
  createdTaskIds: string[];
  failedRows: { rowIndex: number; title: string; reason: string }[];
  successCount: number;
}

// Builds a fresh ValidationContext from the DB — called once per import, by
// both the /validate and /confirm route handlers, so a row is always checked
// against the current state of statuses/members/tags/custom fields (they can
// change between the two requests).
export async function buildValidationContext(
  workspaceId: string,
  spaceId: string,
  listId: string
): Promise<ValidationContext> {
  const [statuses, members, tags, fieldsResult, existingTasks] =
    await Promise.all([
      db
        .select({
          id: listStatus.id,
          name: listStatus.name,
          type: listStatus.type,
        })
        .from(listStatus)
        .where(eq(listStatus.listId, listId))
        .orderBy(asc(listStatus.orderIndex)),
      db
        .select({
          userId: workspaceMember.userId,
          name: user.name,
          email: user.email,
        })
        .from(workspaceMember)
        .innerJoin(user, eq(user.id, workspaceMember.userId))
        .where(
          and(
            eq(workspaceMember.workspaceId, workspaceId),
            eq(workspaceMember.status, "ACTIVE")
          )
        ),
      db
        .select({ name: tag.name })
        .from(tag)
        .where(eq(tag.workspaceId, workspaceId)),
      getCustomFieldDefinitions(workspaceId, spaceId, listId),
      db
        .select({
          id: task.id,
          title: task.title,
          seqNumber: task.seqNumber,
          parentTaskId: task.parentTaskId,
        })
        .from(task)
        .where(
          and(eq(task.listId, listId), eq(task.isArchived, false), notDeleted())
        ),
    ]);

  const membersByEmail = new Map<string, WorkspaceMemberOption>();
  for (const m of members) {
    if (m.email && m.userId) {
      membersByEmail.set(m.email.toLowerCase(), {
        userId: m.userId,
        name: m.name,
        email: m.email,
      });
    }
  }

  const existingTasksByRef = new Map<string, ExistingTaskRef>();
  for (const t of existingTasks) {
    const ref: ExistingTaskRef = {
      taskId: t.id,
      hasParent: Boolean(t.parentTaskId),
    };
    existingTasksByRef.set(t.title.toLowerCase(), ref);
    existingTasksByRef.set(String(t.seqNumber), ref);
  }

  return {
    workspaceId,
    listStatuses: statuses.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
    })),
    membersByEmail,
    tagNamesLower: new Set(tags.map((t) => t.name.toLowerCase())),
    customFields: "fields" in fieldsResult ? fieldsResult.fields : [],
    existingTasksByRef,
    fileRowTitleToIndex: new Map(),
  };
}

// Maps lowercased title -> rowIndex for every row that has one — lets a row's
// Parent Task column reference another row in the same file.
export function buildFileRowTitleIndex(
  mapping: Record<string, string>,
  rows: { rowIndex: number; row: Record<string, string> }[]
): Map<string, number> {
  const titleHeader = Object.keys(mapping).find((h) => mapping[h] === "title");
  const index = new Map<string, number>();
  if (!titleHeader) {
    return index;
  }
  for (const r of rows) {
    const title = (r.row[titleHeader] ?? "").trim();
    if (title) {
      index.set(title.toLowerCase(), r.rowIndex);
    }
  }
  return index;
}

// Re-validates every row against a freshly-built context, then bulk-creates
// the surviving tasks in one transaction — modeled on duplicateTask's bulk
// approach (batched taskSeq reservation, one insert for N rows, map-based id
// resolution for parent linkage) rather than looping createTask(), which
// would mean N sequential taskSeq round-trips and N space-wide notification
// fan-outs for a single import. Permission, status-fallback, and custom-field
// validation rules are the same ones createTask/setCustomFieldValue enforce
// (validateImportRow mirrors them; validateCustomFieldValue is reused
// directly) — this does not bypass any business rule, it batches the same one.
export async function bulkImportTasks(
  userId: string,
  {
    workspaceId,
    spaceId,
    listId,
  }: { workspaceId: string; spaceId: string; listId: string },
  mapping: Record<string, string>,
  rows: { rowIndex: number; row: Record<string, string> }[]
): Promise<
  BulkImportResult | { error: string; code?: typeof TASK_LIMIT_CODE }
> {
  const permErr = await requireEditAccess(userId, workspaceId, spaceId);
  if (permErr) {
    return permErr;
  }

  const context = await buildValidationContext(workspaceId, spaceId, listId);
  context.fileRowTitleToIndex = buildFileRowTitleIndex(mapping, rows);

  const results = await Promise.all(
    rows.map((r) => validateImportRow(r.row, mapping, context, r.rowIndex))
  );
  const byIndex = new Map(results.map((r) => [r.rowIndex, r]));

  const failedRows: BulkImportResult["failedRows"] = [];
  const candidates = results.filter(
    (r) => r.status === "valid" || r.status === "warning"
  );

  for (const r of results) {
    if (r.status === "invalid") {
      failedRows.push({
        rowIndex: r.rowIndex,
        title: r.data?.title || `Row ${r.rowIndex}`,
        reason: r.errors.join("; "),
      });
    }
  }

  // Dependency pass: a row referencing an in-file parent fails if that parent
  // failed, or if the parent is itself a child (no deeper-than-one nesting).
  const survivingIndexes = new Set(candidates.map((r) => r.rowIndex));
  const finalCandidates = candidates.filter((r) => {
    if (r.data?.parentRef?.type !== "inFile") {
      return true;
    }
    const parentRow = byIndex.get(r.data.parentRef.rowIndex);
    if (!parentRow || !survivingIndexes.has(r.data.parentRef.rowIndex)) {
      failedRows.push({
        rowIndex: r.rowIndex,
        title: r.data?.title || `Row ${r.rowIndex}`,
        reason: "Parent task row failed to import",
      });
      return false;
    }
    if (parentRow.data?.parentRef) {
      failedRows.push({
        rowIndex: r.rowIndex,
        title: r.data?.title || `Row ${r.rowIndex}`,
        reason: "Cannot nest subtasks more than one level",
      });
      return false;
    }
    return true;
  });

  if (finalCandidates.length === 0) {
    return { successCount: 0, createdTaskIds: [], failedRows };
  }

  // Early, non-locking capacity check so a batch that cannot fit is rejected
  // before tags are created. The authoritative (locked) check is
  // requireTaskCapacity inside the insert transaction below.
  const capacity = await getWorkspaceCapacity(workspaceId);
  if (capacity.limit !== null && finalCandidates.length > capacity.remaining!) {
    return {
      error: taskLimitReachedMessage(capacity.limit),
      code: TASK_LIMIT_CODE,
    };
  }

  // Resolve/create every unique tag name across the whole batch in one pass.
  const allTagNames = finalCandidates.flatMap((r) => r.data!.tagNames);
  const tagIdByNameLower = await findOrCreateTagsByNames(
    workspaceId,
    allTagNames
  );

  // Pre-generate ids so in-file parent references can be resolved before insert.
  const rowIdByIndex = new Map(
    finalCandidates.map((r) => [r.rowIndex, createId()])
  );

  const createdTaskIds: string[] = [];
  const taskValues: (typeof task.$inferInsert)[] = [];
  const watcherValues: { taskId: string; userId: string }[] = [];
  const assigneeValues: { taskId: string; userId: string }[] = [];
  const tagValues: { taskId: string; tagId: string }[] = [];
  const fieldValues: { taskId: string; fieldId: string; value: unknown }[] = [];
  const activityEntries: Parameters<typeof writeActivityLogBulk>[0] = [];
  const assigneeNotifyTasks: {
    taskId: string;
    recipientIds: string[];
    data: { title: string };
  }[] = [];

  for (const r of finalCandidates) {
    const data = r.data as MappedTaskData;
    const taskId = rowIdByIndex.get(r.rowIndex)!;
    const parentTaskId =
      data.parentRef?.type === "existing"
        ? data.parentRef.taskId
        : data.parentRef?.type === "inFile"
          ? (rowIdByIndex.get(data.parentRef.rowIndex) ?? null)
          : null;

    createdTaskIds.push(taskId);
    taskValues.push({
      id: taskId,
      // Real seqNumber/orderIndex are assigned inside the transaction, once the
      // capacity gate has reserved the seq block.
      seqNumber: 0,
      workspaceId,
      spaceId,
      listId,
      parentTaskId,
      statusId: data.statusId,
      title: data.title,
      description: data.description
        ? (plainTextToTiptapDoc(data.description) as Record<string, unknown>)
        : null,
      priority: data.priority,
      reporterId: userId,
      dueDateStart: data.dueDateStart,
      dueDateEnd: data.dueDateEnd,
      orderIndex: 0,
    });

    const watcherIds = [...new Set([userId, ...data.assigneeIds])];
    for (const w of watcherIds) {
      watcherValues.push({ taskId, userId: w });
    }
    for (const a of data.assigneeIds) {
      assigneeValues.push({ taskId, userId: a });
    }
    for (const tagName of data.tagNames) {
      const tagId = tagIdByNameLower.get(tagName.toLowerCase());
      if (tagId) {
        tagValues.push({ taskId, tagId });
      }
    }
    for (const [fieldId, value] of Object.entries(data.customFieldValues)) {
      fieldValues.push({ taskId, fieldId, value });
    }
    activityEntries.push({
      taskId,
      userId,
      eventType: "task_created",
      meta: { title: data.title },
    });

    const notifyIds = data.assigneeIds.filter((id) => id !== userId);
    if (notifyIds.length > 0) {
      assigneeNotifyTasks.push({
        taskId,
        recipientIds: notifyIds,
        data: { title: data.title },
      });
    }
  }

  const inserted = await db.transaction(async (tx) => {
    // Authoritative all-or-nothing capacity gate (locks the workspace row) +
    // seq reservation. Nothing is inserted if the batch does not fit.
    const gate = await requireTaskCapacity(tx, workspaceId, taskValues.length);
    if ("error" in gate) {
      return gate;
    }
    await tx.insert(task).values(
      taskValues.map((v, i) => ({
        ...v,
        seqNumber: gate.seqBase + i + 1,
        orderIndex: (gate.seqBase + i + 1) * 1000,
      }))
    );
    if (watcherValues.length > 0) {
      await tx.insert(taskWatcher).values(watcherValues).onConflictDoNothing();
    }
    if (assigneeValues.length > 0) {
      await tx
        .insert(taskAssignee)
        .values(assigneeValues)
        .onConflictDoNothing();
    }
    if (tagValues.length > 0) {
      await tx.insert(taskTag).values(tagValues).onConflictDoNothing();
    }
    if (fieldValues.length > 0) {
      await tx.insert(customFieldValue).values(fieldValues);
    }
    return null;
  });
  if (inserted) {
    return inserted;
  }

  await writeActivityLogBulk(activityEntries);

  if (assigneeNotifyTasks.length > 0) {
    createBulkNotifications({
      workspaceId,
      actorId: userId,
      triggerType: "task_assigned",
      entityType: "TASK",
      tasks: assigneeNotifyTasks,
      buildMessage: ({ tasks }) => ({
        title:
          tasks.length === 1
            ? `You were assigned to "${tasks[0].data.title}"`
            : `You were assigned to ${tasks.length} imported tasks`,
      }),
    });
  }

  // Space-wide "task created" notice — excludes the importer and, per task,
  // that task's own assignees (they already got task_assigned), matching
  // createTask's single-task exclusion rule.
  const spaceMemberIds = await spaceRecipientUserIds(workspaceId, spaceId);
  const createdTasksForNotify = finalCandidates
    .map((r) => {
      const data = r.data as MappedTaskData;
      const recipientIds = spaceMemberIds.filter(
        (id) => id !== userId && !data.assigneeIds.includes(id)
      );
      return recipientIds.length > 0
        ? {
            taskId: rowIdByIndex.get(r.rowIndex)!,
            recipientIds,
            data: { title: data.title },
          }
        : null;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
  if (createdTasksForNotify.length > 0) {
    createBulkNotifications({
      workspaceId,
      actorId: userId,
      triggerType: "task_created",
      entityType: "TASK",
      tasks: createdTasksForNotify,
      buildMessage: ({ tasks }) => ({
        title:
          tasks.length === 1
            ? `${tasks.length} task imported: "${tasks[0].data.title}"`
            : `${tasks.length} tasks imported`,
      }),
    });
  }

  void refreshWorkspace(workspaceId, [
    `/${workspaceId}/${spaceId}/list/${listId}`,
  ]);

  return { successCount: finalCandidates.length, createdTaskIds, failedRows };
}
