import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TemplateForm } from "@/components/daily-checklist/admin/template-form";
import { PRODUCT_NAME } from "@/config/platform";
import { auth } from "@/lib/auth";
import { userToday } from "@/lib/daily-checklist/queries";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";

interface NewTemplatePageProps {
  params: Promise<{ workspaceId: string }>;
}

export const metadata = { title: `Create template — ${PRODUCT_NAME}` };

export default async function NewTemplatePage({
  params,
}: NewTemplatePageProps) {
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
    <TemplateForm
      description="Create a reusable checklist template for recurring work."
      template={null}
      title="Create template"
      today={today}
      workspaceId={workspaceId}
    />
  );
}
