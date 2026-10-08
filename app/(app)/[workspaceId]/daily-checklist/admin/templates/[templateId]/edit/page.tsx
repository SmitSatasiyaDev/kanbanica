import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { listChecklistTemplates } from "@/app/actions/daily-checklist-admin";
import { TemplateForm } from "@/components/daily-checklist/admin/template-form";
import { PageHeader } from "@/components/scaffold/page-header";
import { PRODUCT_NAME } from "@/config/platform";
import { auth } from "@/lib/auth";
import { userToday } from "@/lib/daily-checklist/queries";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";

interface EditTemplatePageProps {
  params: Promise<{ templateId: string; workspaceId: string }>;
}

export const metadata = { title: `Edit template — ${PRODUCT_NAME}` };

export default async function EditTemplatePage({
  params,
}: EditTemplatePageProps) {
  const { workspaceId, templateId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  // Owner/Admin only — enforced again in every action (app/actions/daily-checklist-admin.ts).
  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
    redirect(`/${workspaceId}/daily-checklist`);
  }

  const res = await listChecklistTemplates(workspaceId);
  const template =
    "templates" in res ? res.templates.find((t) => t.id === templateId) : null;
  if (!template) {
    notFound();
  }
  const { today } = await userToday(db, session.user.id, workspaceId);

  return (
    <>
      <Link
        className="mb-2 inline-flex items-center gap-1.5 rounded-md text-base-content/60 text-sm hover:text-base-content"
        href={`/${workspaceId}/daily-checklist/admin`}
      >
        <ArrowLeftIcon className="size-4" /> Back to Templates
      </Link>
      <PageHeader
        description="Changes apply to future days only — past days keep what they were generated with."
        title="Edit template"
      />
      <TemplateForm
        key={template.id}
        template={template}
        today={today}
        workspaceId={workspaceId}
      />
    </>
  );
}
