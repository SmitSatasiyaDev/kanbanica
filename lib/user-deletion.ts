import { and, count, eq, inArray } from "drizzle-orm";
import {
  account,
  channelMember,
  checklistTask,
  commentReaction,
  mutedEntity,
  notification,
  pushSubscription,
  savedFilter,
  session as sessionTable,
  spaceMember,
  taskAssignee,
  taskWatcher,
  timeEntry,
  user,
  userEmailPreference,
  userNotificationPreference,
  userOnboardingProgress,
  userSearchHistory,
  workspaceMember,
} from "@/db/schema";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

/**
 * If the user is the ONLY active owner of one or more workspaces, returns those
 * workspaces (id) — the caller must block deletion and ask for an ownership
 * transfer first. Returns an empty array when deletion is safe.
 */
export async function soleOwnedWorkspaces(userId: string): Promise<string[]> {
  const owned = await db
    .select({ workspaceId: workspaceMember.workspaceId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.userId, userId),
        eq(workspaceMember.role, "OWNER"),
        eq(workspaceMember.status, "ACTIVE")
      )
    );
  if (owned.length === 0) {
    return [];
  }

  const ownedIds = owned.map((r) => r.workspaceId);
  const ownerCounts = await db
    .select({ workspaceId: workspaceMember.workspaceId, ownerCount: count() })
    .from(workspaceMember)
    .where(
      and(
        inArray(workspaceMember.workspaceId, ownedIds),
        eq(workspaceMember.role, "OWNER"),
        eq(workspaceMember.status, "ACTIVE")
      )
    )
    .groupBy(workspaceMember.workspaceId);

  return ownerCounts
    .filter((r) => r.ownerCount === 1)
    .map((r) => r.workspaceId);
}

/**
 * Permanently delete a user and all of their personal data, in the FK-safe
 * order documented in docs/settings.md § 1.1a. Comments and activity logs are
 * intentionally NOT deleted — they use plain text author columns with a
 * "Deleted User" fallback. Avatar storage is cleaned up first (non-fatal).
 *
 * Shared by the self-service account deletion (app/actions/profile.ts) and the
 * admin console "remove user" action so the cleanup can never drift.
 */
export async function purgeUser(
  userId: string,
  imageKey: string | null
): Promise<void> {
  if (imageKey) {
    try {
      await storage.delete(imageKey);
    } catch {
      // Non-fatal — proceed with deletion even if storage cleanup fails.
    }
  }

  await db.transaction(async (tx) => {
    // Notification & preferences
    await tx.delete(notification).where(eq(notification.recipientId, userId));
    await tx
      .delete(userNotificationPreference)
      .where(eq(userNotificationPreference.userId, userId));
    await tx
      .delete(userEmailPreference)
      .where(eq(userEmailPreference.userId, userId));
    await tx.delete(mutedEntity).where(eq(mutedEntity.userId, userId));
    await tx
      .delete(pushSubscription)
      .where(eq(pushSubscription.userId, userId));
    // Search & filters
    await tx
      .delete(userSearchHistory)
      .where(eq(userSearchHistory.userId, userId));
    await tx.delete(savedFilter).where(eq(savedFilter.userId, userId));
    await tx
      .delete(userOnboardingProgress)
      .where(eq(userOnboardingProgress.userId, userId));
    // Task participation
    await tx.delete(taskAssignee).where(eq(taskAssignee.userId, userId));
    await tx.delete(taskWatcher).where(eq(taskWatcher.userId, userId));
    await tx.delete(timeEntry).where(eq(timeEntry.userId, userId));
    await tx.delete(commentReaction).where(eq(commentReaction.userId, userId));
    // Occurrences cascade from their items
    await tx.delete(checklistTask).where(eq(checklistTask.userId, userId));
    // Memberships (comments & activity logs intentionally kept — "Deleted User" fallback)
    await tx.delete(spaceMember).where(eq(spaceMember.userId, userId));
    await tx.delete(workspaceMember).where(eq(workspaceMember.userId, userId));
    await tx.delete(channelMember).where(eq(channelMember.userId, userId));
    // Auth records last
    await tx.delete(sessionTable).where(eq(sessionTable.userId, userId));
    await tx.delete(account).where(eq(account.userId, userId));
    await tx.delete(user).where(eq(user.id, userId));
  });
}
