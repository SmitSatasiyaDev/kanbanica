import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DailyChecklistView } from "@/components/daily-checklist/daily-checklist-view";
import { auth } from "@/lib/auth";
import { getWorkspaceMembership } from "@/lib/permissions";

interface Props {
  params: Promise<{ workspaceId: string }>;
}

export default async function DailyChecklistPage({ params }: Props) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) {
    redirect("/");
  }

  return <DailyChecklistView workspaceId={workspaceId} />;
}

export const metadata = { title: "Daily Checklist" };
