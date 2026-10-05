import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { list, task, taskAssignee, taskAttachment } from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createNotifications } from "@/lib/notifications/create-notification";
import { canAccessSpace, getWorkspaceMembership } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { MAX_FILE_SIZE, storage } from "@/lib/storage";
import { notDeleted } from "@/lib/task-visibility";

async function resolveTask(taskId: string) {
  const [row] = await db
    .select({
      workspaceId: task.workspaceId,
      listId: task.listId,
      spaceId: list.spaceId,
      title: task.title,
    })
    .from(task)
    .innerJoin(list, eq(task.listId, list.id))
    .where(and(eq(task.id, taskId), notDeleted()))
    .limit(1);
  return row ?? null;
}

// GET /api/tasks/:taskId/attachments — list attachments with serving URLs
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const ctx = await resolveTask(taskId);
  if (!ctx) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const accessible = await canAccessSpace(
    session.user.id,
    ctx.workspaceId,
    ctx.spaceId
  );
  if (!accessible) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(taskAttachment)
    .where(eq(taskAttachment.taskId, taskId));

  const attachments = await Promise.all(
    rows.map(async (a) => ({
      id: a.id,
      taskId: a.taskId,
      commentId: a.commentId,
      uploadedBy: a.uploadedBy,
      fileName: a.fileName,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
      isInline: a.isInline,
      createdAt: a.createdAt,
      url: await storage.url(a.fileUrl),
    }))
  );

  return NextResponse.json({ attachments });
}

// POST /api/tasks/:taskId/attachments — upload a file (multipart/form-data)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 60 task-attachment uploads per user per minute.
  const limit = rateLimit(`task-attachment:${session.user.id}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const { taskId } = await params;
  const ctx = await resolveTask(taskId);
  if (!ctx) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(session.user.id, ctx.workspaceId),
    canAccessSpace(session.user.id, ctx.workspaceId, ctx.spaceId),
  ]);
  if (!membership || !accessible) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only Edit / Full Access / Admin / Owner can upload
  const role = membership.role;
  if (role === "GUEST") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File exceeds 10 MB limit" },
      { status: 413 }
    );
  }

  const mimeType = file.type || "application/octet-stream";
  const commentId = formData.get("commentId");
  // Inline files embedded in a comment/note body (images render as pictures,
  // other types as download chips). They render inside the note and are excluded
  // from the task Attachments section, and do NOT generate their own activity/
  // notifications (the note is the event). Any file type is allowed inline, same
  // as a regular attachment — only the shared 10 MB size limit applies (above).
  const isInline = formData.get("inline") === "true";

  const attachmentId = createId();
  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `attachments/${ctx.workspaceId}/${taskId}/${attachmentId}/${safeFileName}`;

  // Store the original bytes as-is — no re-encoding, so pasted screenshots stay
  // pixel-perfect.
  const buffer = await file.arrayBuffer();
  await storage.upload(storageKey, buffer, { contentType: mimeType });

  const now = new Date();
  await db.insert(taskAttachment).values({
    id: attachmentId,
    taskId,
    commentId: typeof commentId === "string" && commentId ? commentId : null,
    uploadedBy: session.user.id,
    fileName: file.name,
    fileUrl: storageKey,
    fileSize: file.size,
    mimeType,
    isInline,
    createdAt: now,
  });

  // Inline note images skip the activity-log row + assignee notification — the
  // parent note's comment_added notification is the single event.
  if (!isInline) {
    void writeActivityLog(taskId, session.user.id, "attachment_uploaded", {
      file_name: file.name,
      file_size: file.size,
    });

    // Notify assignees (other than the uploader) that a file was attached.
    const assignees = await db
      .select({ userId: taskAssignee.userId })
      .from(taskAssignee)
      .where(eq(taskAssignee.taskId, taskId));
    const recipientIds = assignees
      .map((a) => a.userId)
      .filter((id) => id !== session.user.id);
    if (recipientIds.length > 0) {
      const actorName = session.user.name ?? session.user.email ?? "Someone";
      createNotifications({
        workspaceId: ctx.workspaceId,
        actorId: session.user.id,
        recipientIds,
        triggerType: "attachment_added",
        entityType: "TASK",
        entityId: taskId,
        title: `${actorName} attached a file to "${ctx.title}"`,
        body: file.name,
        muteCheckEntityIds: [taskId],
      });
    }

    void refreshWorkspace(ctx.workspaceId, undefined, { taskId });
  }

  const url = await storage.url(storageKey);

  return NextResponse.json({
    attachment: {
      id: attachmentId,
      taskId,
      commentId: typeof commentId === "string" && commentId ? commentId : null,
      uploadedBy: session.user.id,
      fileName: file.name,
      fileSize: file.size,
      mimeType,
      isInline,
      key: storageKey,
      createdAt: now,
      url,
    },
  });
}
