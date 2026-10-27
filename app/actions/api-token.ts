"use server";

import { headers } from "next/headers";
import { z } from "zod";
import {
  ApiTokenError,
  type ApiTokenSummary,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "@/lib/api-token";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { isMcpEnabled } from "@/lib/integration-settings";

// Personal API tokens (MCP). All three actions work on the signed-in user's own
// tokens only. The plain token is returned by `createMyApiToken` once and is
// never logged, audited or stored.

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(["read", "write"]),
  workspaceId: z.string().min(1).max(100).nullable(),
  expiresInDays: z
    .union([z.literal(30), z.literal(90), z.literal(365)])
    .nullable(),
});

const tokenIdSchema = z.string().min(1).max(100);

const ERROR_MESSAGES = {
  unauthorized: "Unauthorized",
  invalid: "Please check the token details and try again.",
  disabled: "API access is turned off for this platform.",
  notEligible:
    "API tokens are only available to members of a workspace, not guests.",
  workspaceNotEligible:
    "You can't create a token for that workspace. Pick a workspace where you are a member.",
  limit: "You have reached the maximum of 20 active tokens. Revoke one first.",
  notFound: "Token not found.",
  failed: "Something went wrong. Please try again.",
} as const;

async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export async function listMyApiTokens(): Promise<
  { tokens: ApiTokenSummary[] } | { error: string }
> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: ERROR_MESSAGES.unauthorized };
  }
  return { tokens: await listApiTokens(sessionUser.id) };
}

export async function createMyApiToken(
  input: unknown
): Promise<{ token: string; id: string; prefix: string } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: ERROR_MESSAGES.unauthorized };
  }
  if (!(await isMcpEnabled())) {
    return { error: ERROR_MESSAGES.disabled };
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: ERROR_MESSAGES.invalid };
  }

  try {
    const { token, row } = await createApiToken({
      userId: sessionUser.id,
      ...parsed.data,
    });

    await audit({
      action: "api_token.created",
      actorEmail: sessionUser.email,
      actorId: sessionUser.id,
      description: `Created API token "${row.name}"`,
      entityId: row.id,
      entityType: "api_token",
      // Never include the token or its hash.
      metadata: {
        name: row.name,
        scope: row.scope,
        workspaceId: row.workspaceId,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      },
    });

    return { token, id: row.id, prefix: row.tokenPrefix };
  } catch (error) {
    if (error instanceof ApiTokenError) {
      if (error.code === "NOT_ELIGIBLE") {
        return { error: ERROR_MESSAGES.notEligible };
      }
      if (error.code === "WORKSPACE_NOT_ELIGIBLE") {
        return { error: ERROR_MESSAGES.workspaceNotEligible };
      }
      return { error: ERROR_MESSAGES.limit };
    }
    console.error("[api-token] create failed", error);
    return { error: ERROR_MESSAGES.failed };
  }
}

export async function revokeMyApiToken(
  tokenId: unknown
): Promise<{ ok: true } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: ERROR_MESSAGES.unauthorized };
  }

  const parsed = tokenIdSchema.safeParse(tokenId);
  if (!parsed.success) {
    return { error: ERROR_MESSAGES.invalid };
  }

  const revoked = await revokeApiToken(sessionUser.id, parsed.data);
  if (!revoked) {
    return { error: ERROR_MESSAGES.notFound };
  }

  await audit({
    action: "api_token.revoked",
    actorEmail: sessionUser.email,
    actorId: sessionUser.id,
    description: "Revoked an API token",
    entityId: parsed.data,
    entityType: "api_token",
  });

  return { ok: true };
}
