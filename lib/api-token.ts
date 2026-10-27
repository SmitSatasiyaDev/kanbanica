import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import { apiToken, user, workspace, workspaceMember } from "@/db/schema";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/services/actor";

// Personal API tokens for the MCP endpoint. The plain token is returned once at
// creation and never stored; only its SHA-256 hash is. Token auth is separate
// from session auth: nothing here touches Better Auth.

export const TOKEN_PREFIX = "kbn_";
export const MAX_ACTIVE_TOKENS_PER_USER = 20;
export const TOKEN_SCOPES = ["read", "write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
export const TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;
export type TokenExpiryDays = (typeof TOKEN_EXPIRY_DAYS)[number] | null;

// `last_used_at` is written at most once per this window per token.
const LAST_USED_THROTTLE_MS = 60_000;

export type ApiTokenErrorCode =
  | "NOT_ELIGIBLE"
  | "WORKSPACE_NOT_ELIGIBLE"
  | "TOKEN_LIMIT_REACHED";

export class ApiTokenError extends Error {
  readonly code: ApiTokenErrorCode;
  constructor(code: ApiTokenErrorCode) {
    super(code);
    this.name = "ApiTokenError";
    this.code = code;
  }
}

/** `kbn_` + 32 random bytes, base64url. */
export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** SHA-256 hex of the full token (including the `kbn_` prefix). */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export type ApiTokenRow = typeof apiToken.$inferSelect;

/** What the UI may see. Never includes the hash. */
export type ApiTokenSummary = Pick<
  ApiTokenRow,
  | "id"
  | "name"
  | "tokenPrefix"
  | "scope"
  | "workspaceId"
  | "lastUsedAt"
  | "expiresAt"
  | "createdAt"
> & { workspaceName: string | null };

export interface EligibleWorkspace {
  id: string;
  name: string;
}

/**
 * Workspaces where the user is an ACTIVE, non-guest member and the workspace
 * itself is ACTIVE. Guests get no token access (docs/mcp.md §2.1): it is
 * decided per workspace, so one person can be a guest in A and a member in B.
 * Also feeds the workspace picker in the create-token dialog.
 */
export async function tokenEligibleWorkspaces(
  userId: string
): Promise<EligibleWorkspace[]> {
  return await db
    .select({ id: workspace.id, name: workspace.name })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
    .where(
      and(
        eq(workspaceMember.userId, userId),
        eq(workspaceMember.status, "ACTIVE"),
        ne(workspaceMember.role, "GUEST"),
        eq(workspace.status, "ACTIVE")
      )
    )
    .orderBy(workspace.name);
}

export interface CreateApiTokenInput {
  expiresInDays: TokenExpiryDays;
  name: string;
  scope: TokenScope;
  userId: string;
  workspaceId: string | null;
}

/**
 * Creates a token and returns the plain value once. Throws `ApiTokenError`
 * when the user is a guest everywhere, the chosen workspace is not one they
 * can use, or they already hold the maximum number of active tokens.
 */
export async function createApiToken(
  input: CreateApiTokenInput
): Promise<{ token: string; row: ApiTokenRow }> {
  const eligible = await tokenEligibleWorkspaces(input.userId);
  if (eligible.length === 0) {
    throw new ApiTokenError("NOT_ELIGIBLE");
  }
  if (
    input.workspaceId !== null &&
    !eligible.some((w) => w.id === input.workspaceId)
  ) {
    throw new ApiTokenError("WORKSPACE_NOT_ELIGIBLE");
  }

  const now = new Date();
  const [active] = await db
    .select({ n: count() })
    .from(apiToken)
    .where(
      and(
        eq(apiToken.userId, input.userId),
        isNull(apiToken.revokedAt),
        or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, now))
      )
    );
  if ((active?.n ?? 0) >= MAX_ACTIVE_TOKENS_PER_USER) {
    throw new ApiTokenError("TOKEN_LIMIT_REACHED");
  }

  const token = generateToken();
  const expiresAt =
    input.expiresInDays === null
      ? null
      : new Date(now.getTime() + input.expiresInDays * 86_400_000);

  const [row] = await db
    .insert(apiToken)
    .values({
      id: randomUUID(),
      userId: input.userId,
      name: input.name,
      // Only the hash is stored; the plain token leaves this function once.
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 8),
      scope: input.scope,
      workspaceId: input.workspaceId,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return { token, row };
}

/**
 * Resolves a presented token to an Actor, or null when it is unknown, revoked,
 * expired, or its owner is banned. The ban is read live on every call because
 * banning a user does not delete their sessions.
 */
export async function resolveApiToken(rawToken: string): Promise<Actor | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  const [row] = await db
    .select({
      id: apiToken.id,
      userId: apiToken.userId,
      scope: apiToken.scope,
      workspaceId: apiToken.workspaceId,
      lastUsedAt: apiToken.lastUsedAt,
      expiresAt: apiToken.expiresAt,
      revokedAt: apiToken.revokedAt,
      name: user.name,
      email: user.email,
      banned: user.banned,
      banExpires: user.banExpires,
    })
    .from(apiToken)
    .innerJoin(user, eq(apiToken.userId, user.id))
    .where(eq(apiToken.tokenHash, hashToken(rawToken)))
    .limit(1);

  if (!row) {
    return null;
  }

  const now = new Date();
  if (row.revokedAt) {
    return null;
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  if (
    row.banned &&
    (!row.banExpires || row.banExpires.getTime() > now.getTime())
  ) {
    return null;
  }

  touchLastUsed(row.id, row.lastUsedAt, now);

  return {
    userId: row.userId,
    name: row.name ?? null,
    email: row.email,
    source: "mcp",
    tokenId: row.id,
    scope: row.scope === "write" ? "write" : "read",
    workspaceId: row.workspaceId,
  };
}

// Fire-and-forget. The WHERE clause repeats the throttle so concurrent
// requests (or several app instances) still write at most once per window.
function touchLastUsed(tokenId: string, lastUsedAt: Date | null, now: Date) {
  if (
    lastUsedAt &&
    now.getTime() - lastUsedAt.getTime() < LAST_USED_THROTTLE_MS
  ) {
    return;
  }
  const cutoff = new Date(now.getTime() - LAST_USED_THROTTLE_MS);
  Promise.resolve(
    db
      .update(apiToken)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiToken.id, tokenId),
          or(isNull(apiToken.lastUsedAt), lt(apiToken.lastUsedAt, cutoff))
        )
      )
  ).catch((error) => {
    console.error("[api-token] failed to update last_used_at", error);
  });
}

/**
 * Revokes one of the user's own tokens. Returns false when the token does not
 * exist or belongs to someone else. Revoking twice is a no-op that still
 * returns true.
 */
export async function revokeApiToken(
  userId: string,
  tokenId: string
): Promise<boolean> {
  const now = new Date();
  const [owned] = await db
    .select({ id: apiToken.id, revokedAt: apiToken.revokedAt })
    .from(apiToken)
    .where(and(eq(apiToken.id, tokenId), eq(apiToken.userId, userId)))
    .limit(1);
  if (!owned) {
    return false;
  }
  if (owned.revokedAt) {
    return true;
  }
  await db
    .update(apiToken)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(apiToken.id, tokenId), eq(apiToken.userId, userId)));
  return true;
}

/**
 * The user's own tokens that are not revoked, newest first (revoked rows stay
 * in the table but are hidden). Expired tokens are included so the UI can
 * label them.
 */
export async function listApiTokens(
  userId: string
): Promise<ApiTokenSummary[]> {
  return await db
    .select({
      id: apiToken.id,
      name: apiToken.name,
      tokenPrefix: apiToken.tokenPrefix,
      scope: apiToken.scope,
      workspaceId: apiToken.workspaceId,
      workspaceName: workspace.name,
      lastUsedAt: apiToken.lastUsedAt,
      expiresAt: apiToken.expiresAt,
      createdAt: apiToken.createdAt,
    })
    .from(apiToken)
    .leftJoin(workspace, eq(apiToken.workspaceId, workspace.id))
    .where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt)))
    .orderBy(desc(apiToken.createdAt));
}
