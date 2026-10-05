import { and, asc, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { activatePendingInvites } from "@/app/actions/workspace";
import { workspace, workspaceMember } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { LAST_WORKSPACE_COOKIE } from "@/lib/last-workspace";
import { readPendingInvite, readPendingJoin } from "@/lib/pending-join";
import { completeProfileUrl, userHasDisplayName } from "@/lib/profile-name";
import { redirectToSetupIfNeeded } from "@/lib/setup";
import { getWorkspaceLandingState } from "@/lib/workspace-landing";

export default async function PostAuthPage() {
  await redirectToSetupIfNeeded();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  // A logged-out visitor's `/invite/<token>` was stashed across login — go back
  // to it. This runs BEFORE the name step: the invite page shows the invitation
  // first and asks for the name only as its "Create account & join" step.
  if (await readPendingInvite()) {
    redirect("/api/invite/consume");
  }

  // First-time users (no display name) set one before any invite is
  // auto-accepted / link join is consumed; the form returns here afterwards.
  if (!(await userHasDisplayName(session.user.id))) {
    redirect(completeProfileUrl("/post-auth"));
  }

  // Auto-accept any invitations addressed to this user's email so invited users
  // (e.g. signing in with Google, no SMTP configured) are joined without needing
  // the invite email/link. Must run before the membership lookup below so a
  // freshly-activated workspace is picked up for the redirect.
  await activatePendingInvites();

  // Continue a shared-invite-link join that started while logged out: the token
  // was stashed in a cookie at `/join/[token]` and survives the auth round-trip
  // (incl. Google OAuth). The actual join + cookie-clear happens in a route
  // handler (cookies can't be mutated during a page render); it redirects to the
  // workspace on success, or back here (cookie cleared) to fall through on error.
  if (await readPendingJoin()) {
    redirect("/api/join/consume");
  }

  // Platform admins are normal users with extra capabilities — they land in the
  // regular app (their workspaces), and reach the Admin Console via the sidebar.

  const memberOf = (workspaceId: string) =>
    db
      .select({
        workspaceId: workspaceMember.workspaceId,
        role: workspaceMember.role,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
      .where(
        and(
          eq(workspaceMember.userId, session.user.id),
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.status, "ACTIVE"),
          eq(workspace.status, "ACTIVE")
        )
      )
      .limit(1);

  // Prefer the workspace the user was last viewing (e.g. "Back to app" from the
  // admin console, or a returning sign-in) — but only if they're still an active
  // member of it. Otherwise fall back to their first-joined workspace.
  const lastWorkspaceId = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;

  let membership = lastWorkspaceId
    ? (await memberOf(lastWorkspaceId))[0]
    : undefined;

  if (!membership) {
    [membership] = await db
      .select({
        workspaceId: workspaceMember.workspaceId,
        role: workspaceMember.role,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
      .where(
        and(
          eq(workspaceMember.userId, session.user.id),
          eq(workspaceMember.status, "ACTIVE"),
          eq(workspace.status, "ACTIVE")
        )
      )
      .orderBy(asc(workspaceMember.createdAt))
      .limit(1);
  }

  if (!membership) {
    redirect("/onboarding");
  }

  const landing = await getWorkspaceLandingState(
    session.user.id,
    membership.workspaceId
  );
  if (landing.kind === "ACTIVE_SPACE") {
    redirect(
      landing.listId
        ? `/${membership.workspaceId}/${landing.spaceId}/list/${landing.listId}`
        : `/${membership.workspaceId}/${landing.spaceId}`
    );
  }
  if (landing.kind === "EMPTY") {
    redirect("/onboarding");
  }
  // ONLY_ARCHIVED / NO_ACCESS — land in the workspace, which renders the right
  // empty state (restore-archived or "ask an admin") instead of onboarding.
  redirect(`/${membership.workspaceId}`);
}
