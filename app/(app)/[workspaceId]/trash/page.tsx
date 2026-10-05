import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDeletedTasks } from "@/app/actions/trash";
import { PageHeader } from "@/components/scaffold/page-header";
import { TrashList } from "@/components/workspace/trash-list";
import { PRODUCT_NAME } from "@/config/platform";
import { auth } from "@/lib/auth";
import { getWorkspaceMembership } from "@/lib/permissions";

interface TrashPageProps {
  params: Promise<{ workspaceId: string }>;
}

export const metadata = { title: `Trash — ${PRODUCT_NAME}` };

export default async function TrashPage({ params }: TrashPageProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  // Trash is Owner/Admin only (matches the actions in app/actions/trash.ts).
  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
    redirect(`/${workspaceId}`);
  }

  const res = await getDeletedTasks(workspaceId);
  if ("error" in res) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        description="Deleted tasks are automatically permanently removed after 30 days. Restore a task to bring it back with its comments, files and history."
        eyebrow="Workspace"
        title="Deleted Tasks"
      />
      <TrashList tasks={res.tasks} workspaceId={workspaceId} />
    </div>
  );
}
