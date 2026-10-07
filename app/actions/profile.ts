"use server";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session as sessionTable, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/authz";
import { db } from "@/lib/db";
import { isValidTimeZone } from "@/lib/timezone";
import { purgeUser, soleOwnedWorkspaces } from "@/lib/user-deletion";

export interface ActionState {
  error?: string;
  success?: string;
}

export async function updateNameAction(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Name is required." };
  }
  if (name.length > 100) {
    return { error: "Name must be 100 characters or fewer." };
  }

  await db
    .update(user)
    .set({ name, updatedAt: new Date() })
    .where(eq(user.id, session.user.id));

  await audit({
    action: "profile.name_updated",
    actorEmail: session.user.email,
    actorId: session.user.id,
    description: "Updated profile name",
    entityId: session.user.id,
    entityType: "user",
    metadata: { name },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/profile");
  return { success: "Name updated." };
}

// Light/dark/auto is personal, not workspace state — any signed-in user can
// set their own, with no workspace-role check and no `refreshWorkspace` call
// (unlike workspace mutations, this never needs to reach other users' clients).
export async function updateAppearanceMode(
  appearanceMode: "light" | "dark" | "auto"
): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();

  await db
    .update(user)
    .set({ appearanceMode, updatedAt: new Date() })
    .where(eq(user.id, session.user.id));

  return { ok: true };
}

// Personal IANA timezone for Daily Checklist dates. null clears it (falls back
// to the workspace timezone, then UTC). Existing checklist days are never touched.
export async function updateUserTimezone(
  timezone: string | null
): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (timezone !== null && !isValidTimeZone(timezone)) {
    return { error: "Invalid timezone" };
  }
  await db
    .update(user)
    .set({ timezone, updatedAt: new Date() })
    .where(eq(user.id, session.user.id));
  revalidatePath("/", "layout");
  return { ok: true };
}

// First-time default from the browser. Only writes while the user has no
// timezone, so it can never overwrite an explicit choice.
export async function initUserTimezone(
  timezone: string
): Promise<{ ok: true; changed: boolean } | { error: string }> {
  const session = await requireSession();
  if (!isValidTimeZone(timezone)) {
    return { error: "Invalid timezone" };
  }
  const rows = await db
    .update(user)
    .set({ timezone, updatedAt: new Date() })
    .where(and(eq(user.id, session.user.id), isNull(user.timezone)))
    .returning({ id: user.id });
  return { ok: true, changed: rows.length > 0 };
}

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const current = await requireSession();
  const sessionId = String(formData.get("sessionId") ?? "");

  const [row] = await db
    .select({
      id: sessionTable.id,
      token: sessionTable.token,
      userId: sessionTable.userId,
    })
    .from(sessionTable)
    .where(eq(sessionTable.id, sessionId))
    .limit(1);

  if (!row || row.userId !== current.user.id) {
    return;
  }
  if (row.token === current.session.token) {
    return;
  }

  await db.delete(sessionTable).where(eq(sessionTable.id, sessionId));
  await audit({
    action: "profile.session_revoked",
    actorEmail: current.user.email,
    actorId: current.user.id,
    description: "Revoked an active session",
    entityId: sessionId,
    entityType: "session",
  });

  revalidatePath("/dashboard/profile");
}

export async function signOutOtherSessionsAction(): Promise<void> {
  const current = await requireSession();
  const rows = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, current.user.id),
        ne(sessionTable.token, current.session.token)
      )
    );

  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await db.delete(sessionTable).where(inArray(sessionTable.id, ids));
  }

  await audit({
    action: "profile.other_sessions_revoked",
    actorEmail: current.user.email,
    actorId: current.user.id,
    description: `Signed out ${ids.length} other session(s)`,
    entityId: current.user.id,
    entityType: "user",
    metadata: { revokedCount: ids.length },
  });

  revalidatePath("/dashboard/profile");
}

export async function deleteAccountAction(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const current = await requireSession();
  const confirmEmail = String(formData.get("confirmEmail") ?? "")
    .trim()
    .toLowerCase();

  const [freshUser] = await db
    .select({ email: user.email, id: user.id, image: user.image })
    .from(user)
    .where(eq(user.id, current.user.id))
    .limit(1);

  if (!freshUser) {
    return { error: "Account not found." };
  }

  if (confirmEmail !== freshUser.email.toLowerCase()) {
    return { error: "Type your email address to confirm deletion." };
  }

  // Block deletion if this user is the sole owner of any workspace
  const soleOwned = await soleOwnedWorkspaces(freshUser.id);
  if (soleOwned.length > 0) {
    return {
      error:
        "You are the sole owner of one or more workspaces. Transfer ownership to another member before deleting your account.",
    };
  }

  await audit({
    action: "profile.account_deleted",
    actorEmail: freshUser.email,
    actorId: freshUser.id,
    description: "Deleted account",
    entityId: freshUser.id,
    entityType: "user",
  });

  await purgeUser(freshUser.id, freshUser.image);

  redirect("/login");
}
