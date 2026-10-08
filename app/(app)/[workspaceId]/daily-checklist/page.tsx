import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DailyChecklistView } from "@/components/daily-checklist/daily-checklist-view";
import { TimezoneAutoDetect } from "@/components/daily-checklist/timezone-auto-detect";
import { PageHeader } from "@/components/scaffold/page-header";
import { PRODUCT_NAME } from "@/config/platform";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { userToday } from "@/lib/daily-checklist/queries";
import { normalizeMemberFilter } from "@/lib/daily-checklist/team-aggregate";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";

interface DailyChecklistPageProps {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ filter?: string; tab?: string; view?: string }>;
}

export const metadata = { title: `Checklist — ${PRODUCT_NAME}` };

export default async function DailyChecklistPage({
  params,
  searchParams,
}: DailyChecklistPageProps) {
  const { workspaceId } = await params;
  const { tab, view, filter } = await searchParams;

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

  const { today } = await userToday(db, session.user.id, workspaceId);

  return (
    <>
      {!u?.timezone && <TimezoneAutoDetect />}
      <PageHeader
        description="What do I need to check off today?"
        title="Checklist"
      />
      <DailyChecklistView
        canSeeTeam={canSeeTeam}
        initialFilter={normalizeMemberFilter(filter)}
        initialTab={tab === "my" ? "my" : "team"}
        initialView={view === "history" ? "history" : "today"}
        isAdmin={isAdmin}
        today={today}
        workspaceId={workspaceId}
      />
    </>
  );
}
