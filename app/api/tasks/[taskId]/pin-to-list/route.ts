import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { list, task } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireSpacePermission } from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { notDeleted } from "@/lib/task-visibility";
import { pinTaskToList, unpinTaskFromList } from "@/server/list-pin";

async function resolveTask(taskId: string) {
  const [row] = await db
    .select({
      workspaceId: task.workspaceId,
      listId: task.listId,
      spaceId: list.spaceId,
    })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .where(and(eq(task.id, taskId), notDeleted()))
    .limit(1);
  return row ?? null;
}

// POST /api/tasks/:taskId/pin-to-list — list pin
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
  if (!ctx?.spaceId) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const permErr = await requireSpacePermission(
    session.user.id,
    ctx.workspaceId,
    ctx.spaceId,
    "full_access"
  );
  if (permErr) {
    return NextResponse.json(
      { error: permErr.error },
      { status: permErr.status }
    );
  }

  const result = await pinTaskToList(taskId, session.user.id);
  if ("error" in result) {
    const status = result.code === "LIST_PIN_LIMIT_REACHED" ? 422 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  await refreshWorkspace(ctx.workspaceId, undefined, { taskId });
  return NextResponse.json({ ok: true });
}

// DELETE /api/tasks/:taskId/pin-to-list — list unpin
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const ctx = await resolveTask(taskId);
  if (!ctx?.spaceId) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const permErr = await requireSpacePermission(
    session.user.id,
    ctx.workspaceId,
    ctx.spaceId,
    "full_access"
  );
  if (permErr) {
    return NextResponse.json(
      { error: permErr.error },
      { status: permErr.status }
    );
  }

  const result = await unpinTaskFromList(taskId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await refreshWorkspace(ctx.workspaceId, undefined, { taskId });
  return NextResponse.json({ ok: true });
}
