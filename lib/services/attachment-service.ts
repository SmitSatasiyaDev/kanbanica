import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { taskAssignee, taskAttachment } from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { db } from "@/lib/db";
import { createNotifications } from "@/lib/notifications/create-notification";
import {
  canAccessSpace,
  getWorkspaceMembership,
  requireViewAccess,
} from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import {
  type Actor,
  actorDisplayName,
  READ_ONLY_ERROR,
  withActorSource,
} from "@/lib/services/actor";
import {
  resolveTaskContext,
  type TaskContext,
} from "@/lib/services/task-context";
import { MAX_FILE_SIZE, storage } from "@/lib/storage";

// `code` lets the web route pick an HTTP status; callers that only show text
// can ignore it.
export type AttachmentErrorCode =
  | "not_found"
  | "forbidden"
  | "read_only"
  | "too_large"
  | "storage";
export type AttachmentServiceError = {
  error: string;
  code: AttachmentErrorCode;
};

const TOO_LARGE_ERROR = "File exceeds 10 MB limit";

// Name used inside the storage key: only [a-zA-Z0-9._-], and never empty or
// made only of dots.
export function safeStorageName(fileName: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return /^\.*$/.test(cleaned) ? "file" : cleaned;
}

// ─── Upload rule ──────────────────────────────────────────────────────────────

// The upload rule: an ACTIVE workspace member who is not a GUEST, plus View on
// the task's project. Over MCP guests never get this far (the task is not found).
export async function checkUploadAccess(
  actor: Actor,
  taskId: string
): Promise<{ ok: true; ctx: TaskContext } | AttachmentServiceError> {
  if (actor.scope === "read") {
    return { error: READ_ONLY_ERROR, code: "read_only" };
  }
  const ctx = await resolveTaskContext(taskId, actor);
  if (!ctx) {
    return { error: "Task not found", code: "not_found" };
  }

  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(actor.userId, ctx.workspaceId),
    canAccessSpace(actor.userId, ctx.workspaceId, ctx.spaceId),
  ]);
  // Only Edit / Full Access / Admin / Owner can upload; guests cannot.
  if (!membership || !accessible || membership.role === "GUEST") {
    return { error: "Forbidden", code: "forbidden" };
  }
  return { ok: true, ctx };
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

// Uploads bytes to storage and returns the key and the generated attachment id.
// It writes nothing to the database and checks no permission: callers run
// `checkUploadAccess` first and insert the `task_attachment` row themselves.
export async function storeUploadedBytes(args: {
  workspaceId: string;
  taskId: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}): Promise<
  | { ok: true; attachmentId: string; storageKey: string; size: number }
  | AttachmentServiceError
> {
  if (args.bytes.byteLength > MAX_FILE_SIZE) {
    return { error: TOO_LARGE_ERROR, code: "too_large" };
  }
  const attachmentId = createId();
  const storageKey = `attachments/${args.workspaceId}/${args.taskId}/${attachmentId}/${safeStorageName(args.fileName)}`;
  try {
    // Stored as-is, no re-encoding, so pasted screenshots stay pixel-perfect.
    await storage.upload(storageKey, args.bytes, {
      contentType: args.mimeType,
    });
  } catch {
    return { error: "Could not store the file.", code: "storage" };
  }
  return {
    ok: true,
    attachmentId,
    storageKey,
    size: args.bytes.byteLength,
  };
}

// Removes stored files, used to roll back an upload that did not complete.
// Best effort: one failure does not stop the rest.
export async function deleteStoredFiles(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.delete(key);
      } catch {
        // Nothing more can be done for an orphan we cannot delete.
      }
    })
  );
}

// ─── uploadAttachment ─────────────────────────────────────────────────────────

export type UploadedAttachment = {
  id: string;
  taskId: string;
  commentId: string | null;
  uploadedBy: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  isInline: boolean;
  key: string;
  createdAt: Date;
};

// Stores a file on a task. `inline` files are embedded in a comment or note body:
// they make no activity row or notification of their own (the note is the
// event) and stay out of the task's Attachments section.
export async function uploadAttachment(
  actor: Actor,
  taskId: string,
  input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
    inline: boolean;
    commentId?: string | null;
  }
): Promise<
  { ok: true; attachment: UploadedAttachment } | AttachmentServiceError
> {
  const access = await checkUploadAccess(actor, taskId);
  if ("error" in access) {
    return access;
  }
  const { ctx } = access;

  const stored = await storeUploadedBytes({
    workspaceId: ctx.workspaceId,
    taskId,
    bytes: input.bytes,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  if ("error" in stored) {
    return stored;
  }

  const now = new Date();
  const commentId = input.commentId ? input.commentId : null;
  try {
    await db.insert(taskAttachment).values({
      id: stored.attachmentId,
      taskId,
      commentId,
      uploadedBy: actor.userId,
      fileName: input.fileName,
      fileUrl: stored.storageKey,
      fileSize: stored.size,
      mimeType: input.mimeType,
      isInline: input.inline,
      createdAt: now,
    });
  } catch {
    await deleteStoredFiles([stored.storageKey]);
    return { error: "Could not store the file.", code: "storage" };
  }

  // Inline note images skip the activity-log row + assignee notification — the
  // parent note's comment_added notification is the single event.
  if (!input.inline) {
    void writeActivityLog(
      taskId,
      actor.userId,
      "attachment_uploaded",
      withActorSource(actor, {
        file_name: input.fileName,
        file_size: stored.size,
      })
    );

    // Notify assignees (other than the uploader) that a file was attached.
    const assignees = await db
      .select({ userId: taskAssignee.userId })
      .from(taskAssignee)
      .where(eq(taskAssignee.taskId, taskId));
    const recipientIds = assignees
      .map((a) => a.userId)
      .filter((id) => id !== actor.userId);
    if (recipientIds.length > 0) {
      createNotifications({
        workspaceId: ctx.workspaceId,
        actorId: actor.userId,
        recipientIds,
        triggerType: "attachment_added",
        entityType: "TASK",
        entityId: taskId,
        title: `${actorDisplayName(actor)} attached a file to "${ctx.title}"`,
        body: input.fileName,
        muteCheckEntityIds: [taskId],
      });
    }

    void refreshWorkspace(ctx.workspaceId, undefined, { taskId });
  }

  return {
    ok: true,
    attachment: {
      id: stored.attachmentId,
      taskId,
      commentId,
      uploadedBy: actor.userId,
      fileName: input.fileName,
      fileSize: stored.size,
      mimeType: input.mimeType,
      isInline: input.inline,
      key: stored.storageKey,
      createdAt: now,
    },
  };
}

// ─── readAttachment ───────────────────────────────────────────────────────────

// Reads an attachment's bytes after a View check on its task. Reading is
// allowed for read-only tokens. With `maxBytes`, a larger file is refused before
// it is downloaded (the error still carries the name and size).
// `maxNonImageBytes` is a lower limit that applies to files that are not images.
export async function readAttachment(
  actor: Actor,
  attachmentId: string,
  opts: { maxBytes?: number; maxNonImageBytes?: number } = {}
): Promise<
  | {
      ok: true;
      bytes: Uint8Array;
      mimeType: string;
      fileName: string;
      size: number;
    }
  | { error: string; fileName?: string; size?: number }
> {
  const [row] = await db
    .select({
      taskId: taskAttachment.taskId,
      fileUrl: taskAttachment.fileUrl,
      fileName: taskAttachment.fileName,
      mimeType: taskAttachment.mimeType,
      fileSize: taskAttachment.fileSize,
    })
    .from(taskAttachment)
    .where(eq(taskAttachment.id, attachmentId))
    .limit(1);
  if (!row) {
    return { error: "Attachment not found" };
  }

  // Access follows the attachment's task; no access looks like a missing file.
  const ctx = await resolveTaskContext(row.taskId, actor);
  if (!ctx) {
    return { error: "Attachment not found" };
  }
  const permErr = await requireViewAccess(
    actor.userId,
    ctx.workspaceId,
    ctx.spaceId
  );
  if (permErr) {
    return { error: "Attachment not found" };
  }

  const limit =
    row.mimeType.startsWith("image/") || opts.maxNonImageBytes === undefined
      ? opts.maxBytes
      : Math.min(
          opts.maxBytes ?? Number.POSITIVE_INFINITY,
          opts.maxNonImageBytes
        );
  if (limit !== undefined && row.fileSize > limit) {
    return {
      error: "File is too large to return.",
      fileName: row.fileName,
      size: row.fileSize,
    };
  }

  try {
    const blob = await storage.download(row.fileUrl);
    if (!blob) {
      return { error: "Attachment not found" };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      ok: true,
      bytes,
      mimeType: row.mimeType,
      fileName: row.fileName,
      size: row.fileSize,
    };
  } catch {
    return { error: "Attachment not found" };
  }
}
