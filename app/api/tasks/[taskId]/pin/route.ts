import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { list, task } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessSpace } from "@/lib/permissions";
import { notDeleted } from "@/lib/task-visibility";
import { isTaskPinned, pinTask, unpinTask } from "@/server/pinned-task";

// GET /api/tasks/:taskId/pin — check if pinned by current user
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const pinned = await isTaskPinned(taskId, session.user.id);
  return NextResponse.json({ pinned });
}

async function resolveTask(taskId: string) {
  const [row] = await db
    .select({
      workspaceId: task.workspaceId,
      spaceId: task.spaceId,
      listId: task.listId,
    })
    .from(task)
    .where(and(eq(task.id, taskId), notDeleted()))
    .limit(1);
  if (!row) {
    return null;
  }

  // Tasks in a list may have spaceId null on the task row — fall back to the list's spaceId
  if (!row.spaceId && row.listId) {
    const [l] = await db
      .select({ spaceId: list.spaceId })
      .from(list)
      .where(eq(list.id, row.listId))
      .limit(1);
    if (l) {
      return { ...row, spaceId: l.spaceId };
    }
  }

  return row;
}

// POST /api/tasks/:taskId/pin — personal pin
export async function POST(
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

  const spaceId = ctx.spaceId;
  if (!spaceId) {
    return NextResponse.json({ error: "Task has no space" }, { status: 422 });
  }

  const accessible = await canAccessSpace(
    session.user.id,
    ctx.workspaceId,
    spaceId
  );
  if (!accessible) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await pinTask(taskId, session.user.id, ctx.workspaceId);
  if ("error" in result) {
    const status = result.code === "PIN_LIMIT_REACHED" ? 422 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/tasks/:taskId/pin — personal unpin
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const result = await unpinTask(taskId, session.user.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
