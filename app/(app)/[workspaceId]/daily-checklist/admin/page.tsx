import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/daily-checklist/admin/admin-console";
import { PageHeader } from "@/components/scaffold/page-header";
import { PRODUCT_NAME } from "@/config/platform";
import { auth } from "@/lib/auth";
import { userToday } from "@/lib/daily-checklist/queries";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";

interface AdminPageProps {
  params: Promise<{ workspaceId: string }>;
}

export const metadata = { title: `Checklist admin — ${PRODUCT_NAME}` };

export default async function DailyChecklistAdminPage({
  params,
}: AdminPageProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  // Owner/Admin only — enforced again in every action (app/actions/daily-checklist-admin.ts).
  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
    redirect(`/${workspaceId}/daily-checklist`);
  }

  // The admin's own "today" (effective timezone) — default start date for new templates.
  const { today } = await userToday(db, session.user.id, workspaceId);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        description="Recurring team checklists. Each assignee gets their own copy every day; editing a template never changes past days."
        eyebrow="Admin Console"
        title="Checklist"
      />
      <AdminConsole today={today} workspaceId={workspaceId} />
    </div>
  );
}
