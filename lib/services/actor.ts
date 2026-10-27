// Who is performing an action. Web actions build one from the session; the MCP
// endpoint builds one from a personal API token (see lib/api-token.ts).
export type Actor = {
  userId: string;
  name: string | null;
  email: string;
  source: "web" | "mcp";
  tokenId?: string;
  // Web actors are always "write".
  scope: "read" | "write";
  // Token restriction to one workspace; null for web actors and for tokens that
  // cover all of the user's workspaces.
  workspaceId: string | null;
};

// Fixed message returned when a read-only token tries to change something.
export const READ_ONLY_ERROR = "This token is read-only.";

// Builds the actor for a signed-in web session. Web actors are never
// restricted to a workspace and may always write.
export function webActor(session: {
  user: { id: string; name?: string | null; email?: string | null };
}): Actor {
  return {
    userId: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    source: "web",
    scope: "write",
    workspaceId: null,
  };
}

// Name used in notification titles.
export function actorDisplayName(actor: Actor): string {
  return actor.name ?? actor.email ?? "Someone";
}

// Adds `source` to activity-log meta for non-web actors only. Web rows keep the
// exact meta they had before this field existed.
export function withActorSource(
  actor: Actor,
  meta: Record<string, unknown>
): Record<string, unknown> {
  return actor.source === "web" ? meta : { ...meta, source: actor.source };
}
