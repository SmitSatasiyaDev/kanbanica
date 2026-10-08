import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getWorkspaceMembership } from "@/lib/permissions";

export type ChecklistRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

export type ChecklistAuth =
  | { error: string }
  | { userId: string; userName: string; role: ChecklistRole; isAdmin: boolean };

/**
 * Server-side gate for every Checklist action. The workspace id comes from
 * the client but is only ever used to look up the caller's *own* membership; any
 * entity id (day / item / template) is re-resolved against the DB by the caller.
 *
 *  - `personal` : any ACTIVE member (guests included — it touches no shared data)
 *  - `team`     : OWNER / ADMIN / MEMBER (guests are not exposed to Team Checklist)
 *  - `admin`    : OWNER / ADMIN
 */
export async function requireChecklistAccess(
  workspaceId: string,
  level: "personal" | "team" | "admin"
): Promise<ChecklistAuth> {
  if (!workspaceId || typeof workspaceId !== "string") {
    return { error: "Forbidden" };
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }
  const m = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!m) {
    return { error: "Forbidden" };
  }
  const role = m.role as ChecklistRole;
  const isAdmin = role === "OWNER" || role === "ADMIN";
  if (level === "admin" && !isAdmin) {
    return { error: "Forbidden" };
  }
  if (level === "team" && role === "GUEST") {
    return { error: "Forbidden" };
  }
  return {
    userId: session.user.id,
    userName: session.user.name ?? "",
    role,
    isAdmin,
  };
}
