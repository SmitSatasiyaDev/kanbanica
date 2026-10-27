import { createId } from "@paralleldrive/cuid2";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  comment,
  commentReaction,
  taskAttachment,
  taskWatcher,
  user,
} from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { db } from "@/lib/db";
import { extractInlineAttachmentIds, extractMentionIds } from "@/lib/notes";
import { createNotifications } from "@/lib/notifications/create-notification";
import { canAccessSpace, getWorkspaceMembership } from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import {
  type Actor,
  actorDisplayName,
  READ_ONLY_ERROR,
  withActorSource,
} from "@/lib/services/actor";
import { deleteStoredFiles } from "@/lib/services/attachment-service";
import {
  resolveTaskContext,
  type TaskContext,
  taskRevalidatePaths,
} from "@/lib/services/task-context";
import { storage } from "@/lib/storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommentAttachment {
  fileName: string;
  fileSize: number;
  fileUrl: string;
  id: string;
  mimeType: string;
  url: string;
}

export interface CommentWithReplies {
  attachments: CommentAttachment[];
  authorEmail: string | null;
  authorId: string;
  authorImage: string | null;
  authorName: string | null;
  body: unknown;
  createdAt: Date;
  editedAt: Date | null;
  id: string;
  isDeleted: boolean;
  isResolved: boolean;
  parentCommentId: string | null;
  reactions: { emoji: string; userIds: string[]; count: number }[];
  replies: CommentWithReplies[];
  resolvedAt: Date | null;
  resolvedBy: string | null;
  taskId: string;
}

// An image that was already uploaded to storage and whose `noteImage` node is
// already in the comment body. The comment and its attachment rows are then
// written in one transaction (see createComment).
export type InlineImageInput = {
  attachmentId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  alt?: string;
};

export type CommentServiceError = { error: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Comments use "Unauthorized" when the caller cannot see the task's project.
async function requireSpaceAccess(
  userId: string,
  workspaceId: string,
  spaceId: string
): Promise<CommentServiceError | null> {
  const accessible = await canAccessSpace(userId, workspaceId, spaceId);
  if (!accessible) {
    return { error: "Unauthorized" };
  }
  return null;
}

// `taskId` lets an open task detail view skip refetching for other tasks. The
// location always comes from the task's own context.
function revalidateTask(ctx: TaskContext) {
  void refreshWorkspace(ctx.workspaceId, taskRevalidatePaths(ctx), {
    taskId: ctx.taskId,
  });
}

// Extract plain text from Tiptap JSON for push notification body preview
function tiptapToPlainText(node: unknown, depth = 0): string {
  if (!node || typeof node !== "object") {
    return "";
  }
  const n = node as {
    type?: string;
    text?: string;
    content?: unknown[];
    attrs?: { label?: unknown };
  };
  if (n.text) {
    return n.text;
  }
  if (n.type === "mention" && typeof n.attrs?.label === "string") {
    return `@${n.attrs.label}`;
  }
  if (n.content) {
    return n.content.map((c) => tiptapToPlainText(c, depth + 1)).join("");
  }
  return "";
}

type CommentRow = {
  id: string;
  taskId: string;
  parentCommentId: string | null;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  authorImage: string | null;
  body: unknown;
  isDeleted: boolean;
  isResolved: boolean;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
};

const commentColumns = {
  id: comment.id,
  taskId: comment.taskId,
  parentCommentId: comment.parentCommentId,
  authorId: comment.authorId,
  authorName: user.name,
  authorEmail: user.email,
  authorImage: user.image,
  body: comment.body,
  isDeleted: comment.isDeleted,
  isResolved: comment.isResolved,
  resolvedBy: comment.resolvedBy,
  resolvedAt: comment.resolvedAt,
  editedAt: comment.editedAt,
  createdAt: comment.createdAt,
};

// Loads a task's comments as a tree (replies nested under their parent) with
// reactions and attachments. No permission check: callers must have done it.
//
// With `limit`, only the newest `limit` comments are loaded (still returned
// oldest first). A reply whose parent fell outside that window is returned at
// the top level so it is not lost; it keeps its `parentCommentId`.
export async function loadComments(
  taskId: string,
  opts: { limit?: number } = {}
): Promise<CommentWithReplies[]> {
  const baseQuery = db
    .select(commentColumns)
    .from(comment)
    .leftJoin(user, eq(comment.authorId, user.id))
    .where(eq(comment.taskId, taskId));

  // Fetch the comments for this task (flat)
  let rows: Awaited<typeof baseQuery>;
  if (opts.limit === undefined) {
    rows = await baseQuery.orderBy(asc(comment.createdAt));
  } else {
    const newest = await baseQuery
      .orderBy(desc(comment.createdAt))
      .limit(opts.limit);
    rows = [...newest].reverse();
  }
  return assembleComments(rows, opts.limit !== undefined);
}

// Where the next page of older comments starts: the database's own text form
// of the oldest loaded comment's timestamp (no precision lost) and its id.
export type CommentPageKey = { createdAt: string; id: string };

// One page of a task's comments, newest first by window and oldest first within
// it. `before` continues from the key a previous page returned. `nextKey` is
// null when there is nothing older.
export async function loadCommentsPage(
  taskId: string,
  opts: { limit: number; before?: CommentPageKey }
): Promise<{ comments: CommentWithReplies[]; nextKey: CommentPageKey | null }> {
  const conditions = [eq(comment.taskId, taskId)];
  if (opts.before) {
    conditions.push(
      sql`(${comment.createdAt}, ${comment.id}) < (${opts.before.createdAt}::timestamptz, ${opts.before.id})`
    );
  }
  const found = await db
    .select({
      ...commentColumns,
      createdKey: sql<string>`${comment.createdAt}::text`,
    })
    .from(comment)
    .leftJoin(user, eq(comment.authorId, user.id))
    .where(and(...conditions))
    .orderBy(desc(comment.createdAt), desc(comment.id))
    .limit(opts.limit + 1);

  const hasMore = found.length > opts.limit;
  const newest = found.slice(0, opts.limit);
  const oldest = newest[newest.length - 1];
  const comments = await assembleComments([...newest].reverse(), true);
  return {
    comments,
    nextKey:
      hasMore && oldest
        ? { createdAt: oldest.createdKey, id: oldest.id }
        : null,
  };
}

async function assembleComments(
  rows: CommentRow[],
  windowed: boolean
): Promise<CommentWithReplies[]> {
  const reactionMap = new Map<string, Map<string, string[]>>();
  const allCommentIds = rows.map((r) => r.id);
  const reactionRows =
    allCommentIds.length > 0
      ? await db
          .select({
            commentId: commentReaction.commentId,
            emoji: commentReaction.emoji,
            userId: commentReaction.userId,
          })
          .from(commentReaction)
          .where(inArray(commentReaction.commentId, allCommentIds))
      : [];

  for (const r of reactionRows) {
    if (!reactionMap.has(r.commentId)) {
      reactionMap.set(r.commentId, new Map());
    }
    const emojiMap = reactionMap.get(r.commentId)!;
    if (!emojiMap.has(r.emoji)) {
      emojiMap.set(r.emoji, []);
    }
    emojiMap.get(r.emoji)!.push(r.userId);
  }

  function buildReactions(commentId: string) {
    const emojiMap = reactionMap.get(commentId);
    if (!emojiMap) {
      return [];
    }
    return Array.from(emojiMap.entries()).map(([emoji, userIds]) => ({
      emoji,
      userIds,
      count: userIds.length,
    }));
  }

  // Fetch attachments for all comments
  const attachmentRows =
    allCommentIds.length > 0
      ? await db
          .select({
            id: taskAttachment.id,
            commentId: taskAttachment.commentId,
            fileName: taskAttachment.fileName,
            fileUrl: taskAttachment.fileUrl,
            mimeType: taskAttachment.mimeType,
            fileSize: taskAttachment.fileSize,
            isInline: taskAttachment.isInline,
          })
          .from(taskAttachment)
          .where(inArray(taskAttachment.commentId, allCommentIds))
          .orderBy(asc(taskAttachment.createdAt))
      : [];

  const attachmentUrls = await Promise.all(
    attachmentRows.map((a) => storage.url(a.fileUrl))
  );
  const attachmentMap = new Map<string, CommentAttachment[]>();
  for (let i = 0; i < attachmentRows.length; i++) {
    const a = attachmentRows[i];
    if (!a.commentId) {
      continue;
    }
    // Inline images are rendered inside the note body — keep them out of the
    // attachment grid so they aren't shown twice.
    if (a.isInline) {
      continue;
    }
    if (!attachmentMap.has(a.commentId)) {
      attachmentMap.set(a.commentId, []);
    }
    attachmentMap.get(a.commentId)!.push({
      id: a.id,
      fileName: a.fileName,
      fileUrl: a.fileUrl,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      url: attachmentUrls[i],
    });
  }

  // Build tree: top-level comments first, then nest replies
  const byId = new Map<string, CommentWithReplies>();
  for (const row of rows) {
    byId.set(row.id, {
      ...row,
      authorName: row.authorName ?? "Deleted User",
      authorEmail: row.authorEmail ?? null,
      authorImage: row.authorImage ?? null,
      body: row.body,
      reactions: buildReactions(row.id),
      attachments: attachmentMap.get(row.id) ?? [],
      replies: [],
    });
  }

  const topLevel: CommentWithReplies[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parentCommentId ? byId.get(row.parentCommentId) : null;
    if (parent) {
      parent.replies.push(node);
    } else if (!row.parentCommentId || windowed) {
      // Without a limit a missing parent just drops the reply (as before); with
      // a limit the parent may be outside the window, so keep the reply.
      topLevel.push(node);
    }
  }

  return topLevel;
}

// ─── listComments ─────────────────────────────────────────────────────────────

// Comments on a task. Reading is allowed for read-only tokens.
export async function listComments(
  actor: Actor,
  taskId: string,
  opts: { limit?: number } = {}
): Promise<{ ok: true; comments: CommentWithReplies[] } | CommentServiceError> {
  // Access is checked against the space the task is really in.
  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return { error: "Task not found" };
  }

  const err = await requireSpaceAccess(
    actor.userId,
    ctx.workspaceId,
    ctx.spaceId
  );
  if (err) {
    return err;
  }

  return { ok: true, comments: await loadComments(taskId, opts) };
}

// ─── createComment ────────────────────────────────────────────────────────────

export type CreateCommentInput = {
  body: unknown;
  parentCommentId?: string;
  // Already-uploaded images (MCP). When present the comment and the attachment
  // rows are inserted in one transaction with `commentId` already set.
  inlineImages?: InlineImageInput[];
};

// Adds a comment. Needs View on the task's project; with `inlineImages` the
// upload rule also applies (ACTIVE workspace member who is not a GUEST).
//
// If `inlineImages` is given and anything fails, the stored files for this call
// are deleted so no orphan files are left behind.
export async function createComment(
  actor: Actor,
  taskId: string,
  input: CreateCommentInput
): Promise<{ ok: true; commentId: string } | CommentServiceError> {
  const result = await createCommentInner(actor, taskId, input);
  if ("error" in result && input.inlineImages?.length) {
    await deleteStoredFiles(input.inlineImages.map((img) => img.storageKey));
  }
  return result;
}

async function createCommentInner(
  actor: Actor,
  taskId: string,
  input: CreateCommentInput
): Promise<{ ok: true; commentId: string } | CommentServiceError> {
  if (actor.scope === "read") {
    return { error: READ_ONLY_ERROR };
  }

  const { body, parentCommentId, inlineImages } = input;

  // The real location comes from the task row.
  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return { error: "Task not found" };
  }
  const { workspaceId, spaceId } = ctx;

  const err = await requireSpaceAccess(actor.userId, workspaceId, spaceId);
  if (err) {
    return err;
  }

  if (inlineImages?.length) {
    // Upload rule: images need an ACTIVE, non-guest member (same as the
    // attachments upload route).
    const membership = await getWorkspaceMembership(actor.userId, workspaceId);
    if (!membership || membership.role === "GUEST") {
      return { error: "Forbidden" };
    }
    // The files must live under this task's storage folder.
    const prefix = `attachments/${workspaceId}/${taskId}/`;
    if (inlineImages.some((img) => !img.storageKey.startsWith(prefix))) {
      return { error: "Invalid image" };
    }
  }

  // A reply must point at a comment on this same task.
  let parentAuthorId: string | null = null;
  if (parentCommentId) {
    const [parent] = await db
      .select({ authorId: comment.authorId })
      .from(comment)
      .where(and(eq(comment.id, parentCommentId), eq(comment.taskId, taskId)))
      .limit(1);
    if (!parent) {
      return { error: "Parent comment not found" };
    }
    parentAuthorId = parent.authorId;
  }

  const taskTitle = ctx.title;

  const actorName = actorDisplayName(actor);
  const commentText = tiptapToPlainText(body).trim();
  const pushBody = commentText
    ? `${actorName}: ${commentText.slice(0, 120)}${commentText.length > 120 ? "…" : ""}`
    : actorName;
  const pushUrl = `/${workspaceId}/task/${taskId}`;

  const id = createId();
  const now = new Date();

  const commentRow = {
    id,
    taskId,
    parentCommentId: parentCommentId ?? null,
    authorId: actor.userId,
    body,
    isDeleted: false,
    isResolved: false,
    createdAt: now,
    updatedAt: now,
  };

  if (inlineImages?.length) {
    // Comment and image rows go in together, with the images already linked to
    // the comment. Otherwise a description save could sweep the unlinked inline
    // rows between the two writes.
    try {
      await db.transaction(async (tx) => {
        await tx.insert(comment).values(commentRow);
        await tx.insert(taskAttachment).values(
          inlineImages.map((img) => ({
            id: img.attachmentId,
            taskId,
            commentId: id,
            uploadedBy: actor.userId,
            fileName: img.fileName,
            fileUrl: img.storageKey,
            fileSize: img.size,
            mimeType: img.mimeType,
            isInline: true,
            createdAt: now,
          }))
        );
      });
    } catch {
      return { error: "Could not post the comment." };
    }
  } else {
    await db.insert(comment).values(commentRow);

    // Link any inline images (uploaded during compose, commentId still null) to
    // this comment so they're cleaned up when the comment is edited/deleted.
    const inlineImageIds = extractInlineAttachmentIds(body);
    if (inlineImageIds.length > 0) {
      await db
        .update(taskAttachment)
        .set({ commentId: id })
        .where(
          and(
            eq(taskAttachment.taskId, taskId),
            eq(taskAttachment.isInline, true),
            isNull(taskAttachment.commentId),
            inArray(taskAttachment.id, inlineImageIds)
          )
        );
    }
  }

  void writeActivityLog(
    taskId,
    actor.userId,
    "comment_added",
    withActorSource(actor, { comment_id: id })
  );

  // Fire-and-forget notifications
  const watchers = await db
    .select({ userId: taskWatcher.userId })
    .from(taskWatcher)
    .where(eq(taskWatcher.taskId, taskId));

  const watcherIds = watchers.map((w) => w.userId);

  const commentPreview = commentText ? commentText.slice(0, 160) : undefined;

  // Comment added notification to all watchers
  createNotifications({
    workspaceId,
    actorId: actor.userId,
    recipientIds: watcherIds,
    triggerType: "comment_added",
    entityType: "TASK",
    entityId: taskId,
    title: `${actorName} commented on "${taskTitle}"`,
    body: commentPreview,
    muteCheckEntityIds: [taskId],
    pushTitle: taskTitle,
    pushBody,
    pushUrl,
  });

  // Reply notification to parent comment author
  if (parentAuthorId) {
    createNotifications({
      workspaceId,
      actorId: actor.userId,
      recipientIds: [parentAuthorId],
      triggerType: "comment_reply",
      entityType: "TASK",
      entityId: taskId,
      title: `${actorName} replied to your comment on "${taskTitle}"`,
      body: commentPreview,
      muteCheckEntityIds: [taskId],
      pushTitle: taskTitle,
      pushBody,
      pushUrl,
    });
  }

  // Mention notifications
  const mentionedIds = extractMentionIds(body);
  if (mentionedIds.length > 0) {
    createNotifications({
      workspaceId,
      actorId: actor.userId,
      recipientIds: mentionedIds,
      triggerType: "mention_comment",
      entityType: "TASK",
      entityId: taskId,
      title: `${actorName} mentioned you in "${taskTitle}"`,
      body: commentPreview,
      muteCheckEntityIds: [taskId],
      pushTitle: taskTitle,
      pushBody,
      pushUrl,
    });
  }

  revalidateTask(ctx);

  return { ok: true, commentId: id };
}
