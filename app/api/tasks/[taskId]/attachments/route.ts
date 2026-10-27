import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { list, task, taskAttachment } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessSpace } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { webActor } from "@/lib/services/actor";
import {
  type AttachmentErrorCode,
  checkUploadAccess,
  uploadAttachment,
} from "@/lib/services/attachment-service";
import { MAX_FILE_SIZE, storage } from "@/lib/storage";
import { notDeleted } from "@/lib/task-visibility";

// HTTP status for each service error code.
const ERROR_STATUS: Record<AttachmentErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  read_only: 403,
  too_large: 413,
  storage: 500,
};

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
  const actor = webActor(session);

  // Check access before reading the body, so a refused user never makes us
  // buffer the file. The service checks again when it stores the file.
  const access = await checkUploadAccess(actor, taskId);
  if ("error" in access) {
    return NextResponse.json(
      { error: access.error },
      { status: ERROR_STATUS[access.code] }
    );
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

  const commentId = formData.get("commentId");
  // Inline files embedded in a comment/note body (images render as pictures,
  // other types as download chips). They render inside the note and are excluded
  // from the task Attachments section, and do NOT generate their own activity/
  // notifications (the note is the event). Any file type is allowed inline, same
  // as a regular attachment — only the shared 10 MB size limit applies (above).
  const isInline = formData.get("inline") === "true";

  const res = await uploadAttachment(actor, taskId, {
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    inline: isInline,
    commentId: typeof commentId === "string" && commentId ? commentId : null,
  });
  if ("error" in res) {
    return NextResponse.json(
      { error: res.error },
      { status: ERROR_STATUS[res.code] }
    );
  }

  const url = await storage.url(res.attachment.key);

  return NextResponse.json({ attachment: { ...res.attachment, url } });
}
