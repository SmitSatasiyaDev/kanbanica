"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, ne } from "drizzle-orm";
import { headers } from "next/headers";
import {
  list,
  listStatus,
  space,
  spaceMember,
  task,
  workspaceMember,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createNotifications } from "@/lib/notifications/create-notification";
import { getWorkspaceMembership } from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { deleteStorageForTasks } from "@/lib/trash";

type SpacePermission = "FULL_ACCESS" | "EDIT" | "VIEW";

const PERMISSION_LABELS: Record<SpacePermission, string> = {
  FULL_ACCESS: "Full access",
  EDIT: "Edit",
  VIEW: "View",
};

/** Fetch a Space's name for user-facing notification titles ("Project" in UI copy). */
async function spaceName(spaceId: string): Promise<string> {
  const [row] = await db
    .select({ name: space.name })
    .from(space)
    .where(eq(space.id, spaceId))
    .limit(1);
  return row?.name ?? "a project";
}

function actorNameFrom(session: {
  user: { name?: string | null; email?: string | null };
}): string {
  return session.user.name ?? session.user.email ?? "Someone";
}

/**
 * Everyone who can ACCESS a Space — recipients for project-wide events (archive /
 * restore). Mirrors `getAccessibleSpaceIds`: owners/admins always, workspace members
 * for public spaces, and explicit `space_member` rows (guests + private-space members).
 * NOTE: public spaces usually have no explicit `space_member` rows, so we must derive
 * recipients from workspace membership, not just the `space_member` table.
 */
export async function spaceRecipientUserIds(
  workspaceId: string,
  spaceId: string
): Promise<string[]> {
  const [sp] = await db
    .select({ isPrivate: space.isPrivate })
    .from(space)
    .where(eq(space.id, spaceId))
    .limit(1);
  const isPrivate = sp?.isPrivate ?? false;

  const [members, explicit] = await Promise.all([
    db
      .select({ userId: workspaceMember.userId, role: workspaceMember.role })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.status, "ACTIVE")
        )
      ),
    db
      .select({ userId: spaceMember.userId })
      .from(spaceMember)
      .where(eq(spaceMember.spaceId, spaceId)),
  ]);

  const explicitIds = new Set(
    explicit.map((r) => r.userId).filter((id): id is string => id !== null)
  );
  const ids = new Set<string>();
  for (const m of members) {
    if (!m.userId) {
      continue;
    }
    if (m.role === "OWNER" || m.role === "ADMIN") {
      ids.add(m.userId);
    } else if (m.role === "MEMBER" && !isPrivate) {
      ids.add(m.userId);
    } else if (explicitIds.has(m.userId)) {
      ids.add(m.userId); // guest / private-space member
    }
  }
  return [...ids];
}

async function requireWorkspaceAdmin(userId: string, workspaceId: string) {
  const m = await getWorkspaceMembership(userId, workspaceId);
  if (!m || (m.role !== "OWNER" && m.role !== "ADMIN")) {
    return null;
  }
  return m;
}

const DEFAULT_STATUSES = [
  {
    name: "Todo",
    color: "#6B7280",
    type: "OPEN" as const,
    dashboardCategory: "OPEN" as const,
    orderIndex: 0,
  },
  {
    name: "In Progress",
    color: "#3B82F6",
    type: "ACTIVE" as const,
    dashboardCategory: "WORKING" as const,
    orderIndex: 1,
  },
  {
    name: "Review",
    color: "#F59E0B",
    type: "ACTIVE" as const,
    dashboardCategory: "REVIEW" as const,
    orderIndex: 2,
  },
  {
    name: "Done",
    color: "#10B981",
    type: "CLOSED" as const,
    dashboardCategory: "COMPLETED" as const,
    orderIndex: 3,
  },
];

export async function createSpace(
  workspaceId: string,
  data: {
    name: string;
    color: string;
    isPrivate: boolean;
    logoEmoji?: string | null;
  }
): Promise<{ spaceId: string; listId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) {
    return { error: "Only Admin and Owner can create Spaces" };
  }

  const name = data.name.trim();
  if (!name) {
    return { error: "Space name is required" };
  }

  const existing = await db
    .select({ id: space.id })
    .from(space)
    .where(and(eq(space.workspaceId, workspaceId), eq(space.name, name)))
    .limit(1);
  if (existing.length > 0) {
    return {
      error: `A space named "${name}" already exists in this workspace`,
    };
  }

  const [{ value: spaceCount }] = await db
    .select({ value: count() })
    .from(space)
    .where(eq(space.workspaceId, workspaceId));

  const spaceId = createId();
  const listId = createId();

  await db.transaction(async (tx) => {
    await tx.insert(space).values({
      id: spaceId,
      workspaceId,
      name,
      color: data.color,
      logoEmoji: data.logoEmoji ?? null,
      isPrivate: data.isPrivate,
      createdBy: session.user.id,
      orderIndex: spaceCount,
    });

    await tx.insert(spaceMember).values({
      id: createId(),
      spaceId,
      userId: session.user.id,
      permission: "FULL_ACCESS",
    });

    await tx.insert(list).values({
      id: listId,
      spaceId,
      name: "List",
      createdBy: session.user.id,
      orderIndex: 0,
    });

    await tx
      .insert(listStatus)
      .values(DEFAULT_STATUSES.map((s) => ({ id: createId(), listId, ...s })));
  });

  void refreshWorkspace(workspaceId);
  return { spaceId, listId };
}

// ── Update / Archive / Delete ──────────────────────────────────────────────

export async function updateSpace(
  workspaceId: string,
  spaceId: string,
  data: {
    name: string;
    color: string;
    isPrivate: boolean;
    logoEmoji?: string | null;
  }
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) {
    return { error: "Only Admin and Owner can update Spaces" };
  }

  const name = data.name.trim();
  if (!name) {
    return { error: "Name is required" };
  }

  const existing = await db
    .select({ id: space.id })
    .from(space)
    .where(
      and(
        eq(space.workspaceId, workspaceId),
        eq(space.name, name),
        ne(space.id, spaceId)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    return {
      error: `A space named "${name}" already exists in this workspace`,
    };
  }

  await db
    .update(space)
    .set({
      name,
      color: data.color,
      logoEmoji: data.logoEmoji ?? null,
      isPrivate: data.isPrivate,
      updatedAt: new Date(),
    })
    .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)));

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function archiveSpace(
  workspaceId: string,
  spaceId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) {
    return { error: "Only Admin and Owner can archive Spaces" };
  }

  await db
    .update(space)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)));

  const archivedRecipients = await spaceRecipientUserIds(workspaceId, spaceId);
  if (archivedRecipients.length > 0) {
    createNotifications({
      workspaceId,
      actorId: session.user.id,
      recipientIds: archivedRecipients,
      triggerType: "space_archived",
      entityType: "SPACE",
      entityId: spaceId,
      title: `${await spaceName(spaceId)} was archived by ${actorNameFrom(session)}`,
      muteCheckEntityIds: [spaceId],
    });
  }

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function unarchiveSpace(
  workspaceId: string,
  spaceId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) {
    return { error: "Only Admin and Owner can unarchive Spaces" };
  }

  await db
    .update(space)
    .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
    .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)));

  const restoredRecipients = await spaceRecipientUserIds(workspaceId, spaceId);
  if (restoredRecipients.length > 0) {
    createNotifications({
      workspaceId,
      actorId: session.user.id,
      recipientIds: restoredRecipients,
      triggerType: "space_restored",
      entityType: "SPACE",
      entityId: spaceId,
      title: `${actorNameFrom(session)} restored ${await spaceName(spaceId)}`,
      muteCheckEntityIds: [spaceId],
    });
  }

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

export async function deleteSpace(
  workspaceId: string,
  spaceId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const m = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!m || (m.role !== "OWNER" && m.role !== "ADMIN")) {
    return { error: "Only admins can delete spaces" };
  }

  // Tasks (including trashed ones) cascade with the space; storage does not.
  const [owned] = await db
    .select({ id: space.id })
    .from(space)
    .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)))
    .limit(1);
  if (owned) {
    const spaceTasks = await db
      .select({ id: task.id })
      .from(task)
      .where(eq(task.spaceId, spaceId));
    await deleteStorageForTasks(spaceTasks.map((t) => t.id));
  }

  await db
    .delete(space)
    .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)));

  void refreshWorkspace(workspaceId);
  return { ok: true };
}

// ── Space Members ──────────────────────────────────────────────────────────

export async function addSpaceMember(
  workspaceId: string,
  spaceId: string,
  userId: string,
  permission: SpacePermission
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) {
    return { error: "Only Admin and Owner can manage space members" };
  }

  // Validate that the target user is a workspace member
  const targetMembership = await getWorkspaceMembership(userId, workspaceId);
  if (!targetMembership) {
    return { error: "User is not a workspace member" };
  }

  // Guests cannot be assigned full_access
  if (targetMembership.role === "GUEST" && permission === "FULL_ACCESS") {
    return { error: "Guests cannot be granted Full Access" };
  }

  await db.insert(spaceMember).values({
    id: createId(),
    spaceId,
    userId,
    permission,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createNotifications({
    workspaceId,
    actorId: session.user.id,
    recipientIds: [userId],
    triggerType: "space_added",
    entityType: "SPACE",
    entityId: spaceId,
    title: `${actorNameFrom(session)} added you to ${await spaceName(spaceId)}`,
    muteCheckEntityIds: [spaceId],
  });

  return { ok: true };
}

export async function changeSpaceMemberPermission(
  workspaceId: string,
  spaceId: string,
  userId: string,
  permission: SpacePermission
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) {
    return { error: "Only Admin and Owner can manage space members" };
  }

  // Guests cannot be assigned full_access
  const targetMembership = await getWorkspaceMembership(userId, workspaceId);
  if (targetMembership?.role === "GUEST" && permission === "FULL_ACCESS") {
    return { error: "Guests cannot be granted Full Access" };
  }

  await db
    .update(spaceMember)
    .set({ permission, updatedAt: new Date() })
    .where(
      and(eq(spaceMember.spaceId, spaceId), eq(spaceMember.userId, userId))
    );

  createNotifications({
    workspaceId,
    actorId: session.user.id,
    recipientIds: [userId],
    triggerType: "space_permission_changed",
    entityType: "SPACE",
    entityId: spaceId,
    title: `Your permission in ${await spaceName(spaceId)} was changed to ${PERMISSION_LABELS[permission]}`,
    muteCheckEntityIds: [spaceId],
  });

  return { ok: true };
}

export async function removeSpaceMember(
  workspaceId: string,
  spaceId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) {
    return { error: "Only Admin and Owner can manage space members" };
  }

  await db
    .delete(spaceMember)
    .where(
      and(eq(spaceMember.spaceId, spaceId), eq(spaceMember.userId, userId))
    );

  createNotifications({
    workspaceId,
    actorId: session.user.id,
    recipientIds: [userId],
    triggerType: "space_removed",
    entityType: "SPACE",
    entityId: spaceId,
    title: `You were removed from ${await spaceName(spaceId)}`,
    muteCheckEntityIds: [spaceId],
  });

  return { ok: true };
}
