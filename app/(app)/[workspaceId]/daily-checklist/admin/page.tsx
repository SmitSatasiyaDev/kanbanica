import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/daily-checklist/admin/admin-console";
import { PageHeader } from "@/components/scaffold/page-header";
import { PRODUCT_NAME } from "@/config/platform";
import { auth } from "@/lib/auth";
import { userToday } from "@/lib/daily-checklist/queries";
import { dateSchema } from "@/lib/daily-checklist/validation";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";

interface AdminPageProps {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ date?: string }>;
}

export const metadata = { title: `Checklist admin — ${PRODUCT_NAME}` };

export default async function DailyChecklistAdminPage({
  params,
  searchParams,
}: AdminPageProps) {
  const { workspaceId } = await params;
  const { date } = await searchParams;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  // Owner/Admin only — enforced again in every action (app/actions/daily-checklist-admin.ts).
  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
    redirect(`/${workspaceId}/daily-checklist`);
  }

  // The admin's own "today" bounds the history date picker; an invalid ?date= is ignored.
  const { today } = await userToday(db, session.user.id, workspaceId);
  const initialDate = date && dateSchema.safeParse(date).success ? date : null;

  return (
    <>
      <PageHeader
        description="Create reusable checklist templates for recurring work. Assign them to people and choose when they should repeat. Past checklist days remain unchanged."
        eyebrow="Admin Console"
        title="Checklist"
      />
      <AdminConsole
        initialDate={initialDate}
        today={today}
        workspaceId={workspaceId}
      />
    </>
  );
}
