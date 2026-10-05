import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { list, task, taskAttachment } from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessSpace, getWorkspaceMembership } from "@/lib/permissions";
import { storage } from "@/lib/storage";
import { notDeleted } from "@/lib/task-visibility";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [attachment] = await db
    .select()
    .from(taskAttachment)
    .where(eq(taskAttachment.id, id))
    .limit(1);

  if (!attachment) {
    return NextResponse.json(
      { error: "Attachment not found" },
      { status: 404 }
    );
  }

  // Resolve task → list → workspace/space for permission check
  const [ctx] = await db
    .select({ workspaceId: task.workspaceId, spaceId: list.spaceId })
    .from(task)
    .innerJoin(list, eq(task.listId, list.id))
    .where(and(eq(task.id, attachment.taskId), notDeleted()))
    .limit(1);

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

  const role = membership.role;
  const isOwnerOrAdmin = role === "OWNER" || role === "ADMIN";
  const isUploader = attachment.uploadedBy === session.user.id;

  // Uploader can delete their own; Owner/Admin can delete any
  if (!isUploader && !isOwnerOrAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete storage file first — never delete DB record if storage fails
  try {
    await storage.delete(attachment.fileUrl);
  } catch (err) {
    console.error("Storage delete failed for attachment", id, err);
    return NextResponse.json(
      { error: "Failed to delete file from storage" },
      { status: 503 }
    );
  }

  await db.delete(taskAttachment).where(eq(taskAttachment.id, id));

  void writeActivityLog(
    attachment.taskId,
    session.user.id,
    "attachment_deleted",
    {
      file_name: attachment.fileName,
    }
  );

  return NextResponse.json({ ok: true });
}
