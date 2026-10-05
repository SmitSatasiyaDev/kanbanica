"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, inArray, max, ne, sql } from "drizzle-orm";
import { headers } from "next/headers";
import {
  checklist,
  checklistItem,
  list,
  listStatus,
  space,
  spaceMember,
  task,
  taskAssignee,
  taskDependency,
  taskTag,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { notDeleted } from "@/lib/task-visibility";
import { deleteStorageForTasks } from "@/lib/trash";
import { requireTaskCapacity } from "@/lib/workspace-limits";

// ── Permission helpers ─────────────────────────────────────────────────────

async function getEffectiveSpacePermission(
  userId: string,
  workspaceId: string,
  spaceId: string
): Promise<"FULL_ACCESS" | "EDIT" | "VIEW" | null> {
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    return null;
  }
  if (membership.role === "OWNER" || membership.role === "ADMIN") {
    return "FULL_ACCESS";
  }

  const [sm] = await db
    .select({ permission: spaceMember.permission })
    .from(spaceMember)
    .where(
      and(eq(spaceMember.spaceId, spaceId), eq(spaceMember.userId, userId))
    )
    .limit(1);

  return sm?.permission ?? null;
}

async function requireFullAccess(
  userId: string,
  workspaceId: string,
  spaceId: string
): Promise<boolean> {
  const perm = await getEffectiveSpacePermission(userId, workspaceId, spaceId);
  return perm === "FULL_ACCESS";
}

// ── Order index helpers ────────────────────────────────────────────────────

async function getNextListOrderIndex(spaceId: string): Promise<number> {
  const [row] = await db
    .select({ maxIdx: max(list.orderIndex) })
    .from(list)
    .where(and(eq(list.spaceId, spaceId), eq(list.isArchived, false)));
  return (row?.maxIdx ?? 0) + 1000;
}

async function getNextStatusOrderIndex(listId: string): Promise<number> {
  const [row] = await db
    .select({ maxIdx: max(listStatus.orderIndex) })
    .from(listStatus)
    .where(eq(listStatus.listId, listId));
  return (row?.maxIdx ?? 0) + 1000;
}

// ── Default statuses ───────────────────────────────────────────────────────

const DEFAULT_STATUSES = [
  {
    name: "Todo",
    color: "#6B7280",
    type: "OPEN" as const,
    dashboardCategory: "OPEN" as const,
    orderIndex: 1000,
  },
  {
    name: "In Progress",
    color: "#3B82F6",
    type: "ACTIVE" as const,
    dashboardCategory: "WORKING" as const,
    orderIndex: 2000,
  },
  {
    name: "Review",
    color: "#F59E0B",
    type: "ACTIVE" as const,
    dashboardCategory: "REVIEW" as const,
    orderIndex: 3000,
  },
  {
    name: "Done",
    color: "#10B981",
    type: "CLOSED" as const,
    dashboardCategory: "COMPLETED" as const,
    orderIndex: 4000,
  },
];

// ── List CRUD ──────────────────────────────────────────────────────────────

export async function createList(
  workspaceId: string,
  spaceId: string,
  data: { name: string; color?: string; description?: string }
): Promise<{ listId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const canManage = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!canManage) {
    return { error: "You need Full Access to create lists in this space" };
  }

  const name = data.name.trim();
  if (!name) {
    return { error: "List name is required" };
  }

  const orderIndex = await getNextListOrderIndex(spaceId);
  const listId = createId();

  await db.transaction(async (tx) => {
    await tx.insert(list).values({
      id: listId,
      spaceId,
      name,
      color: data.color ?? null,
      description: data.description ?? null,
      orderIndex,
      createdBy: session.user.id,
    });

    await tx
      .insert(listStatus)
      .values(DEFAULT_STATUSES.map((s) => ({ id: createId(), listId, ...s })));
  });

  void refreshWorkspace(workspaceId);
  return { listId };
}

export async function updateList(
  workspaceId: string,
  spaceId: string,
  listId: string,
  data: { name: string; color?: string | null; description?: string | null }
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const canManage = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!canManage) {
    return { error: "You need Full Access to edit lists" };
  }

  const name = data.name.trim();
  if (!name) {
    return { error: "List name is required" };
  }

  await db
    .update(list)
    .set({
      name,
      color: data.color ?? null,
      description: data.description ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId)));

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function archiveList(
  workspaceId: string,
  spaceId: string,
  listId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const canManage = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!canManage) {
    return { error: "You need Full Access to archive lists" };
  }

  await db
    .update(list)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId)));

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function unarchiveList(
  workspaceId: string,
  spaceId: string,
  listId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const canManage = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!canManage) {
    return { error: "You need Full Access to unarchive lists" };
  }

  await db
    .update(list)
    .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId)));

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function deleteList(
  workspaceId: string,
  spaceId: string,
  listId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (
    !membership ||
    (membership.role !== "OWNER" && membership.role !== "ADMIN")
  ) {
    return { error: "Only Admin and Owner can permanently delete lists" };
  }

  // The cascade removes every task in the list — including ones in the Trash —
  // but never touches storage, so delete the files first.
  const tasks = await db
    .select({ id: task.id })
    .from(task)
    .where(eq(task.listId, listId));
  await deleteStorageForTasks(tasks.map((t) => t.id));

  await db
    .delete(list)
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId)));

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

// Options controlling what a Duplicate List operation copies. Everything
// except the two "keep" toggles defaults on; attachments and comments/activity
// are intentionally NOT part of this iteration (the modal shows them disabled).
export interface DuplicateListOptions {
  copyArchived: boolean;
  copyAssignees: boolean;
  copyChecklists: boolean;
  copyDependencies: boolean;
  copyDescriptions: boolean;
  copyDueDates: boolean;
  copyPriorities: boolean;
  copySubtasks: boolean;
  copyTags: boolean;
  copyTasks: boolean;
  keepCompleted: boolean;
  name: string;
}

const FULL_DUPLICATE_OPTIONS: Omit<DuplicateListOptions, "name"> = {
  copyTasks: true,
  copyDescriptions: true,
  copySubtasks: true,
  copyChecklists: true,
  copyDependencies: true,
  copyTags: true,
  copyAssignees: true,
  copyPriorities: true,
  copyDueDates: true,
  keepCompleted: true,
  copyArchived: true,
};

export async function duplicateList(
  workspaceId: string,
  spaceId: string,
  listId: string,
  options?: Partial<DuplicateListOptions>
): Promise<{ listId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const canManage = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!canManage) {
    return { error: "You need Full Access to duplicate lists" };
  }

  const [source] = await db.select().from(list).where(eq(list.id, listId));
  // The list must live in the space the caller was authorised against.
  if (!source || source.spaceId !== spaceId) {
    return { error: "List not found" };
  }

  const opts: DuplicateListOptions = {
    name: `${source.name} (Copy)`,
    ...FULL_DUPLICATE_OPTIONS,
    ...options,
  };

  const statuses = await db
    .select()
    .from(listStatus)
    .where(eq(listStatus.listId, listId))
    .orderBy(listStatus.orderIndex);

  const closedStatusIds = new Set(
    statuses.filter((s) => s.type === "CLOSED").map((s) => s.id)
  );

  // Load all tasks up front so both the top-level filter and the subtask
  // parent-membership check work off the same snapshot.
  const allTasks = opts.copyTasks
    ? await db
        .select()
        .from(task)
        .where(and(eq(task.listId, listId), notDeleted()))
    : [];

  const passesArchived = (t: (typeof allTasks)[number]) =>
    opts.copyArchived || !t.isArchived;
  const passesCompleted = (t: (typeof allTasks)[number]) =>
    opts.keepCompleted || !(t.statusId && closedStatusIds.has(t.statusId));

  const includedTopLevel = allTasks.filter(
    (t) => t.parentTaskId === null && passesArchived(t) && passesCompleted(t)
  );
  const includedIds = new Set(includedTopLevel.map((t) => t.id));

  // Subtasks come along regardless of their own completion state, but only
  // when their parent is being copied and (unless copying archived) not archived.
  const includedSubtasks = opts.copySubtasks
    ? allTasks.filter(
        (t) =>
          t.parentTaskId !== null &&
          includedIds.has(t.parentTaskId) &&
          passesArchived(t)
      )
    : [];

  const copiedTasks = [...includedTopLevel, ...includedSubtasks];
  const oldTaskIds = copiedTasks.map((t) => t.id);

  const orderIndex = await getNextListOrderIndex(spaceId);
  const newListId = createId();

  const duplicated = await db.transaction(async (tx) => {
    // Workspace task-limit gate for every task the copy will create
    // (all-or-nothing), then a contiguous block of seq numbers. Runs before any
    // insert so a rejected copy leaves no half-created list behind.
    let seqBase = 0;
    if (copiedTasks.length > 0) {
      const capacity = await requireTaskCapacity(
        tx,
        workspaceId,
        copiedTasks.length
      );
      if ("error" in capacity) {
        return capacity;
      }
      seqBase = capacity.seqBase;
    }

    await tx.insert(list).values({
      id: newListId,
      spaceId,
      name: opts.name.trim() || `${source.name} (Copy)`,
      color: source.color,
      description: source.description,
      orderIndex,
      createdBy: session.user.id,
    });

    // Statuses first (task.statusId has an FK to listStatus).
    const statusMap = new Map<string, string>();
    if (statuses.length > 0) {
      await tx.insert(listStatus).values(
        statuses.map((s) => {
          const id = createId();
          statusMap.set(s.id, id);
          return {
            id,
            listId: newListId,
            name: s.name,
            color: s.color,
            type: s.type,
            orderIndex: s.orderIndex,
          };
        })
      );
    }

    if (copiedTasks.length === 0) {
      return null;
    }

    const taskMap = new Map<string, string>();
    for (const t of copiedTasks) {
      taskMap.set(t.id, createId());
    }

    await tx.insert(task).values(
      copiedTasks.map((t, i) => ({
        id: taskMap.get(t.id)!,
        seqNumber: seqBase + i + 1,
        workspaceId,
        spaceId,
        listId: newListId,
        parentTaskId: t.parentTaskId
          ? (taskMap.get(t.parentTaskId) ?? null)
          : null,
        statusId: t.statusId ? (statusMap.get(t.statusId) ?? null) : null,
        title: t.title,
        description: opts.copyDescriptions ? t.description : null,
        priority: opts.copyPriorities ? t.priority : ("NONE" as const),
        reporterId: t.reporterId,
        dueDateStart: opts.copyDueDates ? t.dueDateStart : null,
        dueDateEnd: opts.copyDueDates ? t.dueDateEnd : null,
        orderIndex: t.orderIndex,
        isArchived: opts.copyArchived ? t.isArchived : false,
        archivedAt: opts.copyArchived ? t.archivedAt : null,
      }))
    );

    if (opts.copyAssignees) {
      const rows = await tx
        .select()
        .from(taskAssignee)
        .where(inArray(taskAssignee.taskId, oldTaskIds));
      if (rows.length > 0) {
        await tx.insert(taskAssignee).values(
          rows.map((r) => ({
            taskId: taskMap.get(r.taskId)!,
            userId: r.userId,
          }))
        );
      }
    }

    if (opts.copyTags) {
      const rows = await tx
        .select()
        .from(taskTag)
        .where(inArray(taskTag.taskId, oldTaskIds));
      if (rows.length > 0) {
        // Tags are workspace-scoped — reuse the same tagId.
        await tx.insert(taskTag).values(
          rows.map((r) => ({
            taskId: taskMap.get(r.taskId)!,
            tagId: r.tagId,
          }))
        );
      }
    }

    if (opts.copyChecklists) {
      const checklists = await tx
        .select()
        .from(checklist)
        .where(inArray(checklist.taskId, oldTaskIds));
      if (checklists.length > 0) {
        const checklistMap = new Map<string, string>();
        await tx.insert(checklist).values(
          checklists.map((c) => {
            const id = createId();
            checklistMap.set(c.id, id);
            return {
              id,
              taskId: taskMap.get(c.taskId)!,
              name: c.name,
              orderIndex: c.orderIndex,
            };
          })
        );

        const items = await tx
          .select()
          .from(checklistItem)
          .where(
            inArray(
              checklistItem.checklistId,
              checklists.map((c) => c.id)
            )
          );
        if (items.length > 0) {
          await tx.insert(checklistItem).values(
            items.map((it) => ({
              id: createId(),
              checklistId: checklistMap.get(it.checklistId)!,
              title: it.title,
              isChecked: false,
              orderIndex: it.orderIndex,
            }))
          );
        }
      }
    }

    if (opts.copyDependencies) {
      const deps = await tx
        .select()
        .from(taskDependency)
        .where(inArray(taskDependency.taskId, oldTaskIds));
      // Keep only dependencies where both endpoints were copied.
      const remapped = deps.filter(
        (d) => taskMap.has(d.taskId) && taskMap.has(d.dependsOnTaskId)
      );
      if (remapped.length > 0) {
        await tx.insert(taskDependency).values(
          remapped.map((d) => ({
            id: createId(),
            taskId: taskMap.get(d.taskId)!,
            dependsOnTaskId: taskMap.get(d.dependsOnTaskId)!,
            type: d.type,
          }))
        );
      }
    }
    return null;
  });
  if (duplicated) {
    return duplicated;
  }

  void refreshWorkspace(workspaceId);
  return { listId: newListId };
}

// Task counts for the Duplicate List modal summary. Counts every task in the
// list (including subtasks) bucketed by state; the dialog combines these with
// the current toggles to show "N tasks will be copied".
export async function getListTaskCounts(
  workspaceId: string,
  spaceId: string,
  listId: string
): Promise<
  | { activeOpen: number; activeCompleted: number; archived: number }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const perm = await getEffectiveSpacePermission(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!perm) {
    return { error: "Unauthorized" };
  }

  const closedIds = new Set(
    (
      await db
        .select({ id: listStatus.id })
        .from(listStatus)
        .where(
          and(eq(listStatus.listId, listId), eq(listStatus.type, "CLOSED"))
        )
    ).map((s) => s.id)
  );

  const rows = await db
    .select({ statusId: task.statusId, isArchived: task.isArchived })
    .from(task)
    .where(and(eq(task.listId, listId), notDeleted()));

  let activeOpen = 0;
  let activeCompleted = 0;
  let archived = 0;
  for (const r of rows) {
    if (r.isArchived) {
      archived++;
    } else if (r.statusId && closedIds.has(r.statusId)) {
      activeCompleted++;
    } else {
      activeOpen++;
    }
  }

  return { activeOpen, activeCompleted, archived };
}

// ── Status management ──────────────────────────────────────────────────────

// Status names must be unique within a list (case-insensitive, trimmed). Board's
// "Add group" and the Manage Statuses editor both land here, and two columns with
// the same name are indistinguishable on the board. `excludeId` lets a rename
// keep its own name.
async function statusNameTaken(
  listId: string,
  name: string,
  excludeId?: string
): Promise<boolean> {
  const conditions = [
    eq(listStatus.listId, listId),
    sql`lower(trim(${listStatus.name})) = ${name.trim().toLowerCase()}`,
  ];
  if (excludeId) {
    conditions.push(ne(listStatus.id, excludeId));
  }
  const [existing] = await db
    .select({ id: listStatus.id })
    .from(listStatus)
    .where(and(...conditions))
    .limit(1);
  return !!existing;
}

function duplicateStatusError(name: string) {
  return { error: `A group named “${name}” already exists in this list` };
}

export async function createListStatus(
  workspaceId: string,
  spaceId: string,
  listId: string,
  data: {
    name: string;
    color: string;
    type: "OPEN" | "ACTIVE" | "CLOSED";
    dashboardCategory?: "OPEN" | "WORKING" | "REVIEW" | "COMPLETED";
  }
): Promise<{ statusId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const canManage = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!canManage) {
    return { error: "You need Full Access to manage statuses" };
  }

  const name = data.name.trim();
  if (!name) {
    return { error: "Status name is required" };
  }
  if (await statusNameTaken(listId, name)) {
    return duplicateStatusError(name);
  }

  const orderIndex = await getNextStatusOrderIndex(listId);
  const statusId = createId();

  await db.insert(listStatus).values({
    id: statusId,
    listId,
    name,
    color: data.color,
    type: data.type,
    dashboardCategory: data.dashboardCategory ?? "OPEN",
    orderIndex,
  });

  void refreshWorkspace(workspaceId);
  return { statusId };
}

export async function updateListStatus(
  workspaceId: string,
  spaceId: string,
  listId: string,
  statusId: string,
  data: {
    name?: string;
    color?: string;
    type?: "OPEN" | "ACTIVE" | "CLOSED";
    dashboardCategory?: "OPEN" | "WORKING" | "REVIEW" | "COMPLETED";
  }
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const canManage = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!canManage) {
    return { error: "You need Full Access to manage statuses" };
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) {
      return { error: "Status name is required" };
    }
    if (await statusNameTaken(listId, name, statusId)) {
      return duplicateStatusError(name);
    }
    updates.name = name;
  }
  if (data.color !== undefined) {
    updates.color = data.color;
  }
  if (data.type !== undefined) {
    updates.type = data.type;
  }
  if (data.dashboardCategory !== undefined) {
    updates.dashboardCategory = data.dashboardCategory;
  }

  await db
    .update(listStatus)
    .set(updates)
    .where(and(eq(listStatus.id, statusId), eq(listStatus.listId, listId)));

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function deleteListStatus(
  workspaceId: string,
  spaceId: string,
  listId: string,
  statusId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const canManage = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!canManage) {
    return { error: "You need Full Access to manage statuses" };
  }

  try {
    await db.transaction(async (tx) => {
      const [{ taskCount }] = await tx
        .select({ taskCount: count() })
        .from(task)
        .where(and(eq(task.statusId, statusId), eq(task.isArchived, false)));

      if (taskCount > 0) {
        throw new Error(`TASKS_EXIST:${taskCount}`);
      }

      const [status] = await tx
        .select()
        .from(listStatus)
        .where(eq(listStatus.id, statusId));

      if (status?.type === "CLOSED") {
        const [{ remaining }] = await tx
          .select({ remaining: count() })
          .from(listStatus)
          .where(
            and(
              eq(listStatus.listId, listId),
              eq(listStatus.type, "CLOSED"),
              ne(listStatus.id, statusId)
            )
          );
        if (remaining === 0) {
          throw new Error("LAST_CLOSED_STATUS");
        }
      }

      await tx.delete(listStatus).where(eq(listStatus.id, statusId));
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.startsWith("TASKS_EXIST:")) {
      const n = msg.split(":")[1];
      return {
        error: `Reassign or delete the ${n} task(s) using this status first`,
      };
    }
    if (msg === "LAST_CLOSED_STATUS") {
      return { error: "A list must have at least one closed status" };
    }
    throw err;
  }

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function reorderListStatuses(
  workspaceId: string,
  spaceId: string,
  listId: string,
  orderedIds: string[]
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const canManage = await requireFullAccess(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!canManage) {
    return { error: "You need Full Access to reorder statuses" };
  }

  await db.transaction(async (tx) => {
    await Promise.all(
      orderedIds.map((id, i) =>
        tx
          .update(listStatus)
          .set({ orderIndex: (i + 1) * 1000, updatedAt: new Date() })
          .where(and(eq(listStatus.id, id), eq(listStatus.listId, listId)))
      )
    );
  });

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

// ─── getWorkspaceLists ────────────────────────────────────────────────────────

export async function getWorkspaceLists(
  workspaceId: string,
  excludeListId: string
): Promise<
  | {
      spaces: {
        id: string;
        name: string;
        color: string | null;
        logoEmoji: string | null;
        lists: { id: string; name: string; color: string | null }[];
      }[];
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  const rows = await db
    .select({
      spaceId: space.id,
      spaceName: space.name,
      spaceColor: space.color,
      spaceLogoEmoji: space.logoEmoji,
      listId: list.id,
      listName: list.name,
      listColor: list.color,
    })
    .from(space)
    .innerJoin(
      list,
      and(eq(list.spaceId, space.id), eq(list.isArchived, false))
    )
    .where(and(eq(space.workspaceId, workspaceId), eq(space.isArchived, false)))
    .orderBy(space.name, list.name);

  const spaceMap = new Map<
    string,
    {
      id: string;
      name: string;
      color: string | null;
      logoEmoji: string | null;
      lists: { id: string; name: string; color: string | null }[];
    }
  >();
  for (const r of rows) {
    if (r.listId === excludeListId) {
      continue;
    }
    if (!spaceMap.has(r.spaceId)) {
      spaceMap.set(r.spaceId, {
        id: r.spaceId,
        name: r.spaceName,
        color: r.spaceColor,
        logoEmoji: r.spaceLogoEmoji,
        lists: [],
      });
    }
    spaceMap
      .get(r.spaceId)!
      .lists.push({ id: r.listId, name: r.listName, color: r.listColor });
  }

  return { spaces: [...spaceMap.values()].filter((s) => s.lists.length > 0) };
}

export async function getListStatuses(
  workspaceId: string,
  _spaceId: string,
  listId: string
): Promise<
  | {
      id: string;
      name: string;
      color: string;
      type: "OPEN" | "ACTIVE" | "CLOSED";
      dashboardCategory: "OPEN" | "WORKING" | "REVIEW" | "COMPLETED";
      orderIndex: number;
    }[]
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  const statuses = await db
    .select({
      id: listStatus.id,
      name: listStatus.name,
      color: listStatus.color,
      type: listStatus.type,
      dashboardCategory: listStatus.dashboardCategory,
      orderIndex: listStatus.orderIndex,
    })
    .from(listStatus)
    .where(eq(listStatus.listId, listId))
    .orderBy(listStatus.orderIndex);

  return statuses;
}
