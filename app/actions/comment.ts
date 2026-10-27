"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { headers } from "next/headers";
import { comment, commentReaction, taskAttachment } from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { extractInlineAttachmentIds } from "@/lib/notes";
import { createNotifications } from "@/lib/notifications/create-notification";
import {
  canAccessSpace,
  getSpacePermission,
  hasPermissionLevel,
} from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { webActor } from "@/lib/services/actor";
import {
  type CommentWithReplies,
  createComment as createCommentService,
  listComments,
} from "@/lib/services/comment-service";
import {
  resolveCommentContext,
  taskRevalidatePaths,
} from "@/lib/services/task-context";
import { storage } from "@/lib/storage";

// ─── Types ────────────────────────────────────────────────────────────────────

// Defined in the comment service (shared with the MCP endpoint); re-exported so
// existing imports from this module keep working.
export type {
  CommentAttachment,
  CommentWithReplies,
} from "@/lib/services/comment-service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireSpaceAccess(
  userId: string,
  workspaceId: string,
  spaceId: string
) {
  const accessible = await canAccessSpace(userId, workspaceId, spaceId);
  if (!accessible) {
    return { error: "Unauthorized" } as const;
  }
  return null;
}

// `taskId` lets an open task detail view skip refetching for other tasks. The
// location always comes from the task's own context, never from the caller.
function revalidateTask(ctx: {
  workspaceId: string;
  spaceId: string;
  listId: string | null;
  taskId: string;
}) {
  void refreshWorkspace(ctx.workspaceId, taskRevalidatePaths(ctx), {
    taskId: ctx.taskId,
  });
}

// ─── getTaskComments ──────────────────────────────────────────────────────────

export async function getTaskComments(
  _workspaceId: string,
  _spaceId: string,
  taskId: string
): Promise<{ comments: CommentWithReplies[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // Access is checked against the space the task is really in, not the one the
  // caller sent.
  const res = await listComments(webActor(session), taskId);
  if ("error" in res) {
    return { error: res.error };
  }
  return { comments: res.comments };
}

// ─── createComment ────────────────────────────────────────────────────────────

export async function createComment(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  taskId: string,
  body: unknown,
  parentCommentId?: string
): Promise<{ commentId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the task row.
  const res = await createCommentService(webActor(session), taskId, {
    body,
    parentCommentId,
  });
  if ("error" in res) {
    return { error: res.error };
  }
  return { commentId: res.commentId };
}

// ─── editComment ──────────────────────────────────────────────────────────────

export async function editComment(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  commentId: string,
  body: unknown
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the comment's task.
  const existing = await resolveCommentContext(commentId);
  if (!existing) {
    return { error: "Comment not found" };
  }

  const err = await requireSpaceAccess(
    session.user.id,
    existing.workspaceId,
    existing.spaceId
  );
  if (err) {
    return err;
  }

  if (existing.authorId !== session.user.id) {
    return { error: "You can only edit your own comments" };
  }

  await db
    .update(comment)
    .set({ body, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(comment.id, commentId));

  // Reconcile inline images. Link any newly-added ones (uploaded during the
  // edit, still unlinked) to this comment.
  const newImageIds = extractInlineAttachmentIds(body);
  if (newImageIds.length > 0) {
    await db
      .update(taskAttachment)
      .set({ commentId })
      .where(
        and(
          eq(taskAttachment.isInline, true),
          isNull(taskAttachment.commentId),
          inArray(taskAttachment.id, newImageIds)
        )
      );
  }

  // Delete inline images that were removed from the body (their storage object
  // + row). Scoped to THIS comment's inline images only — never touches other
  // images or file attachments.
  const orphanRows = await db
    .select({ id: taskAttachment.id, fileUrl: taskAttachment.fileUrl })
    .from(taskAttachment)
    .where(
      and(
        eq(taskAttachment.commentId, commentId),
        eq(taskAttachment.isInline, true),
        ...(newImageIds.length > 0
          ? [notInArray(taskAttachment.id, newImageIds)]
          : [])
      )
    );
  if (orphanRows.length > 0) {
    await Promise.all(
      orphanRows.map(async (a) => {
        try {
          await storage.delete(a.fileUrl);
        } catch {
          // Best-effort: a missing storage file must not block the edit.
        }
      })
    );
    await db.delete(taskAttachment).where(
      inArray(
        taskAttachment.id,
        orphanRows.map((a) => a.id)
      )
    );
  }

  revalidateTask(existing);
  return { ok: true };
}

// ─── deleteComment ────────────────────────────────────────────────────────────

export async function deleteComment(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  _taskId: string,
  commentId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list / task are ignored: the real location
  // comes from the comment's own task. "Full access" is therefore checked on
  // the space the comment is in, not any space the caller happens to manage.
  const existing = await resolveCommentContext(commentId);
  if (!existing) {
    return { error: "Comment not found" };
  }
  const { workspaceId, spaceId, taskId } = existing;

  const permission = await getSpacePermission(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (permission === null) {
    return { error: "Forbidden" };
  }

  // full_access can delete any comment; others can only delete their own
  const canDeleteAny = hasPermissionLevel(permission, "full_access");
  if (existing.authorId !== session.user.id && !canDeleteAny) {
    return { error: "You don't have permission to delete this comment" };
  }

  // Remove any attachments belonging to this comment first. The
  // task_attachment.commentId FK has no ON DELETE rule, so leaving these rows
  // would block the hard delete below. Delete the storage files before the DB
  // rows (orphaned files are unrecoverable — see CLAUDE.md).
  const attachments = await db
    .select({ id: taskAttachment.id, fileUrl: taskAttachment.fileUrl })
    .from(taskAttachment)
    .where(eq(taskAttachment.commentId, commentId));

  if (attachments.length > 0) {
    await Promise.all(
      attachments.map(async (a) => {
        try {
          await storage.delete(a.fileUrl);
        } catch {
          // Best-effort: a missing storage file must not block comment deletion.
        }
      })
    );
    await db
      .delete(taskAttachment)
      .where(eq(taskAttachment.commentId, commentId));
  }

  // Check if has replies
  const [replyRow] = await db
    .select({ id: comment.id })
    .from(comment)
    .where(
      and(eq(comment.parentCommentId, commentId), eq(comment.isDeleted, false))
    )
    .limit(1);

  if (replyRow) {
    // Soft delete — keep a tombstone row. `body` is NOT NULL, so clear it to an
    // empty doc (the UI shows "[Comment deleted]" based on isDeleted, not body).
    await db
      .update(comment)
      .set({
        body: { type: "doc", content: [] },
        isDeleted: true,
        updatedAt: new Date(),
      })
      .where(eq(comment.id, commentId));
  } else {
    // Hard delete
    await db.delete(comment).where(eq(comment.id, commentId));
  }

  void writeActivityLog(taskId, session.user.id, "comment_deleted", {
    comment_id: commentId,
  });
  revalidateTask(existing);
  return { ok: true };
}

// ─── resolveComment / unresolveComment ────────────────────────────────────────

export async function resolveComment(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  commentId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the comment's task.
  const resolved = await resolveCommentContext(commentId);
  if (!resolved) {
    return { error: "Comment not found" };
  }
  const { workspaceId, spaceId } = resolved;

  const err = await requireSpaceAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  await db
    .update(comment)
    .set({
      isResolved: true,
      resolvedBy: session.user.id,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(comment.id, commentId));

  // Notify the thread's author + everyone who replied in it (resolver excluded).
  const replies = await db
    .select({ authorId: comment.authorId })
    .from(comment)
    .where(eq(comment.parentCommentId, commentId));
  const recipientIds = [
    ...new Set([resolved.authorId, ...replies.map((r) => r.authorId)]),
  ];
  if (recipientIds.length > 0) {
    const actorName = session.user.name ?? session.user.email ?? "Someone";
    createNotifications({
      workspaceId,
      actorId: session.user.id,
      recipientIds,
      triggerType: "comment_resolved",
      entityType: "TASK",
      entityId: resolved.taskId,
      title: `${actorName} resolved a comment thread on "${resolved.title}"`,
      muteCheckEntityIds: [resolved.taskId],
    });
  }

  revalidateTask(resolved);
  return { ok: true };
}

export async function unresolveComment(
  _workspaceId: string,
  _spaceId: string,
  _listId: string | null,
  commentId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space / list are ignored: the real location comes
  // from the comment's task.
  const ctx = await resolveCommentContext(commentId);
  if (!ctx) {
    return { error: "Comment not found" };
  }

  const err = await requireSpaceAccess(
    session.user.id,
    ctx.workspaceId,
    ctx.spaceId
  );
  if (err) {
    return err;
  }

  await db
    .update(comment)
    .set({
      isResolved: false,
      resolvedBy: null,
      resolvedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(comment.id, commentId));

  revalidateTask(ctx);
  return { ok: true };
}

// ─── toggleReaction ───────────────────────────────────────────────────────────

export async function toggleReaction(
  _workspaceId: string,
  _spaceId: string,
  commentId: string,
  emoji: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The caller's workspace / space are ignored: the real location comes from
  // the comment's task.
  const ctx = await resolveCommentContext(commentId);
  if (!ctx) {
    return { error: "Comment not found" };
  }

  const err = await requireSpaceAccess(
    session.user.id,
    ctx.workspaceId,
    ctx.spaceId
  );
  if (err) {
    return err;
  }

  // Find any existing reaction by this user on this comment (regardless of emoji)
  const [existing] = await db
    .select({ id: commentReaction.id, emoji: commentReaction.emoji })
    .from(commentReaction)
    .where(
      and(
        eq(commentReaction.commentId, commentId),
        eq(commentReaction.userId, session.user.id)
      )
    )
    .limit(1);

  if (existing) {
    // Always remove the old reaction first
    await db.delete(commentReaction).where(eq(commentReaction.id, existing.id));
    // If it was the same emoji, this is a toggle-off — we're done
    if (existing.emoji === emoji) {
      return { ok: true };
    }
  }

  // Add the new reaction (replaces the old one, or adds fresh)
  await db.insert(commentReaction).values({
    id: createId(),
    commentId,
    userId: session.user.id,
    emoji,
    createdAt: new Date(),
  });

  return { ok: true };
}
