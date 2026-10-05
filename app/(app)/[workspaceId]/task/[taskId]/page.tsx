import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { list, task, workspace } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  canAccessSpace,
  getSpacePermission,
  getWorkspaceMembership,
} from "@/lib/permissions";
import { notDeleted } from "@/lib/task-visibility";
import { TaskDetailPage } from "./_components/task-detail-page";

interface TaskPageProps {
  params: Promise<{ workspaceId: string; taskId: string }>;
}

export async function generateMetadata({
  params,
}: TaskPageProps): Promise<Metadata> {
  const { taskId } = await params;
  const row = await db
    .select({ title: task.title })
    .from(task)
    .where(and(eq(task.id, taskId), notDeleted()))
    .limit(1)
    .then((r) => r[0]);
  if (!row) {
    return { title: "Task" };
  }
  return { title: row.title };
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { workspaceId, taskId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) {
    notFound();
  }

  const [ws] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  const [t] = await db
    .select({
      id: task.id,
      listId: task.listId,
      spaceId: task.spaceId,
      workspaceId: task.workspaceId,
    })
    .from(task)
    .where(and(eq(task.id, taskId), notDeleted()))
    .limit(1);

  if (!t || t.workspaceId !== workspaceId) {
    notFound();
  }

  let spaceId: string;
  let listId: string | null = null;
  let listName: string | null = null;

  if (t.listId) {
    const [l] = await db
      .select({ id: list.id, spaceId: list.spaceId, name: list.name })
      .from(list)
      .where(and(eq(list.id, t.listId)))
      .limit(1);
    if (!l) {
      notFound();
    }
    spaceId = l.spaceId;
    listId = l.id;
    listName = l.name;
  } else if (t.spaceId) {
    spaceId = t.spaceId;
  } else {
    notFound();
  }

  const accessible = await canAccessSpace(
    session.user.id,
    workspaceId,
    spaceId!
  );
  if (!accessible) {
    notFound();
  }

  const spacePermission = await getSpacePermission(
    session.user.id,
    workspaceId,
    spaceId!
  );
  const canPinToList = spacePermission === "full_access";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <TaskDetailPage
        canPinToList={canPinToList}
        listId={listId ?? ""}
        listName={listName ?? ""}
        spaceId={spaceId!}
        taskId={taskId}
        workspaceId={workspaceId}
        workspaceName={ws?.name ?? ""}
      />
    </div>
  );
}
