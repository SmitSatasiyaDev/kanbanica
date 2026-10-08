import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/daily-checklist/admin/admin-console";
import { PageHeader } from "@/components/scaffold/page-header";
import { PRODUCT_NAME } from "@/config/platform";
import { auth } from "@/lib/auth";
import { dateSchema } from "@/lib/daily-checklist/validation";
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

  // An invalid legacy ?date= is ignored (the History report bounds its own dates server-side).
  const initialDate = date && dateSchema.safeParse(date).success ? date : null;

  // ONE container for the whole page (header, tabs and every tab's content) so they share the
  // same left/right edges — tab content must not add its own max-width.
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        description="Create reusable checklist templates for recurring work. Assign them to people and choose when they should repeat. Past checklist days remain unchanged."
        eyebrow="Admin Console"
        title="Checklist"
      />
      <AdminConsole initialDate={initialDate} workspaceId={workspaceId} />
    </div>
  );
}
