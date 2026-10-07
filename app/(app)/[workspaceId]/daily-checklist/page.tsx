import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TimezoneAutoDetect } from "@/components/daily-checklist/timezone-auto-detect";
import { DailyChecklistView } from "@/components/daily-checklist/daily-checklist-view";
import { PageHeader } from "@/components/scaffold/page-header";
import { PRODUCT_NAME } from "@/config/platform";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";

interface DailyChecklistPageProps {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export const metadata = { title: `Checklist — ${PRODUCT_NAME}` };

export default async function DailyChecklistPage({
  params,
  searchParams,
}: DailyChecklistPageProps) {
  const { workspaceId } = await params;
  const { tab } = await searchParams;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) {
    redirect("/");
  }

  // Guests keep a personal checklist but are not exposed to the Team Checklist.
  const canSeeTeam = membership.role !== "GUEST";
  const isAdmin = membership.role === "OWNER" || membership.role === "ADMIN";

  const [u] = await db
    .select({ timezone: user.timezone })
    .from(user)
    .where(eq(user.id, session.user.id));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {!u?.timezone && <TimezoneAutoDetect />}
      <PageHeader
        description="What do I need to check off today?"
        title="Checklist"
      />
      <DailyChecklistView
        canSeeTeam={canSeeTeam}
        initialTab={tab === "team" ? "team" : "my"}
        isAdmin={isAdmin}
        workspaceId={workspaceId}
      />
    </div>
  );
}
