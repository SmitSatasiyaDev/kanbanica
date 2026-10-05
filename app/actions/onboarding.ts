"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, count, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PRODUCT_NAME } from "@/config/platform";
import {
  list,
  listStatus,
  space,
  tag,
  task,
  taskAssignee,
  taskTag,
  userOnboardingProgress,
  user as userTable,
  workspace,
  workspaceMember,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";
import { parseThemeCookie, THEME_COOKIE } from "@/lib/theme";

const DEFAULT_STATUSES = [
  {
    name: "Todo",
    color: "#9CA3AF",
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
    color: "#8B5CF6",
    type: "ACTIVE" as const,
    dashboardCategory: "REVIEW" as const,
    orderIndex: 2,
  },
  {
    name: "Done",
    color: "#22C55E",
    type: "CLOSED" as const,
    dashboardCategory: "COMPLETED" as const,
    orderIndex: 3,
  },
];

async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  return session.user;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  );
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const [existing] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.slug, slug))
      .limit(1);
    if (!existing) {
      return slug;
    }
    slug = `${base}-${i}`;
  }
}

export async function saveUserName(
  name: string
): Promise<{ ok: true } | { error: string }> {
  const user = await getSessionUser();
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2) {
    return { error: "Please enter your full name." };
  }
  if (trimmed.length > 100) {
    return { error: "Name is too long." };
  }
  await db
    .update(userTable)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(userTable.id, user.id));
  return { ok: true };
}

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(100),
  logoEmoji: z.string().trim().max(8).optional().nullable(),
});

export async function createOnboardingWorkspace(input: {
  name: string;
  logoEmoji?: string | null;
}): Promise<{ workspaceId: string } | { error: string }> {
  const user = await getSessionUser();

  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { name, logoEmoji } = parsed.data;

  // Check if user already owns a workspace with this name
  const existing = await db
    .select({ id: workspace.id })
    .from(workspace)
    .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
    .where(
      and(
        eq(workspace.name, name),
        eq(workspaceMember.userId, user.id),
        eq(workspaceMember.role, "OWNER"),
        eq(workspaceMember.status, "ACTIVE")
      )
    )
    .limit(1);
  if (existing.length > 0) {
    return { error: `You already have a workspace named "${name}"` };
  }

  const slug = await generateUniqueSlug(name);
  const workspaceId = createId();

  const { theme } = parseThemeCookie(
    (await cookies()).get(THEME_COOKIE)?.value
  );

  await db.transaction(async (tx) => {
    await tx.insert(workspace).values({
      id: workspaceId,
      name,
      slug,
      logoEmoji: logoEmoji ?? null,
      createdBy: user.id,
      theme,
    });

    await tx.insert(workspaceMember).values({
      id: createId(),
      workspaceId,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date(),
    });

    await tx.insert(userOnboardingProgress).values({
      id: createId(),
      userId: user.id,
      workspaceId,
    });
  });

  return { workspaceId };
}

const createSpaceSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1, "Space name is required").max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Invalid color")
    .optional()
    .nullable(),
  logoEmoji: z.string().trim().min(1).max(16).optional().nullable(),
});

export async function createOnboardingSpace(input: {
  workspaceId: string;
  name: string;
  color?: string | null;
  logoEmoji?: string | null;
}): Promise<{ error: string } | undefined> {
  const user = await getSessionUser();

  const parsed = createSpaceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { workspaceId, name, color, logoEmoji } = parsed.data;

  // Only actual members who are allowed to create projects may do so. Guests
  // (and non-members) cannot create a project in an existing workspace.
  const membership = await getWorkspaceMembership(user.id, workspaceId);
  if (!membership || membership.role === "GUEST") {
    return {
      error: "You don't have permission to create a project in this workspace",
    };
  }

  const spaceId = createId();
  const listId = createId();

  await db.transaction(async (tx) => {
    await tx.insert(space).values({
      id: spaceId,
      workspaceId,
      name,
      color: color ?? null,
      logoEmoji: logoEmoji ?? null,
      createdBy: user.id,
    });

    await tx.insert(list).values({
      id: listId,
      spaceId,
      name: "List",
      createdBy: user.id,
    });

    const statusRows = DEFAULT_STATUSES.map((s) => ({
      id: createId(),
      listId,
      ...s,
    }));
    await tx.insert(listStatus).values(statusRows);
    const todoStatusId = statusRows[0].id;

    // Check if this workspace has any tasks yet
    const [{ value: existingTaskCount }] = await tx
      .select({ value: count() })
      .from(task)
      .where(eq(task.workspaceId, workspaceId));

    if (existingTaskCount === 0) {
      // Increment workspace task sequence
      const [updated] = await tx
        .update(workspace)
        .set({ taskSeq: 1 })
        .where(eq(workspace.id, workspaceId))
        .returning({ taskSeq: workspace.taskSeq });

      const taskId = createId();
      const wsRow = await tx
        .select({ name: workspace.name })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1)
        .then((r) => r[0]);

      await tx.insert(task).values({
        id: taskId,
        seqNumber: updated?.taskSeq ?? 1,
        workspaceId,
        spaceId,
        listId,
        statusId: todoStatusId,
        title: `👋 Welcome to ${wsRow?.name ?? PRODUCT_NAME} — click to see how a task works`,
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "This is a task. You can set a status, assign it to someone, add a due date, and leave comments. Try editing this task or create your own.",
                },
              ],
            },
          ],
        },
        reporterId: user.id,
        priority: "NONE",
        orderIndex: 0,
      });

      await tx.insert(taskAssignee).values({ taskId, userId: user.id });

      const tagId = createId();
      const [insertedTag] = await tx
        .insert(tag)
        .values({
          id: tagId,
          workspaceId,
          name: "demo",
          color: "#9CA3AF",
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: tag.id });
      const finalTagId =
        insertedTag?.id ??
        (await tx
          .select({ id: tag.id })
          .from(tag)
          .where(and(eq(tag.workspaceId, workspaceId), eq(tag.name, "demo")))
          .limit(1)
          .then((r) => r[0]?.id));
      if (finalTagId) {
        await tx
          .insert(taskTag)
          .values({ taskId, tagId: finalTagId })
          .onConflictDoNothing();
      }
    }
  });

  redirect(`/${workspaceId}/${spaceId}/list/${listId}`);
}
