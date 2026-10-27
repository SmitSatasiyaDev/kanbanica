import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveApiToken } from "@/lib/api-token";
import { env } from "@/lib/env";
import { isMcpEnabled } from "@/lib/integration-settings";
import { createMcpServer } from "@/lib/mcp/server";
import { rateLimit } from "@/lib/rate-limit";
import { consumeRateLimits } from "@/lib/rate-limit-db";

// Never Edge: notifications and real-time broadcasts use in-process state.
export const runtime = "nodejs";

// A request carries up to five 10 MB images as base64, so the body limit is
// well above the biggest file.
const MAX_BODY_BYTES = 40 * 1024 * 1024;

// Requests per minute, per token and per user (across all of a user's tokens).
const TOKEN_LIMIT_PER_MINUTE = 120;
const USER_LIMIT_PER_MINUTE = 300;
const WINDOW_MS = 60_000;

// Counts this request against the token and user limits in one database round
// trip. Returns the seconds to wait when either is over, else null.
//
// Fails OPEN: if the database cannot be reached the request is let through,
// with the old per-process limit on the token as a floor. Writes are protected
// separately: each write tool checks its own limit and fails closed.
async function requestRetryAfter(
  tokenId: string,
  userId: string
): Promise<number | null> {
  try {
    const decisions = await consumeRateLimits([
      {
        key: `mcp:token:${tokenId}`,
        limit: TOKEN_LIMIT_PER_MINUTE,
        windowMs: WINDOW_MS,
      },
      {
        key: `mcp:user:${userId}`,
        limit: USER_LIMIT_PER_MINUTE,
        windowMs: WINDOW_MS,
      },
    ]);
    const blocked = decisions.filter((d) => !d.ok);
    return blocked.length > 0
      ? Math.max(...blocked.map((d) => d.retryAfter))
      : null;
  } catch (error) {
    console.error(
      "[mcp] request rate limiter failed, allowing the request",
      error instanceof Error ? error.name : "error"
    );
    const local = rateLimit(
      `mcp:${tokenId}`,
      TOKEN_LIMIT_PER_MINUTE,
      WINDOW_MS
    );
    return local.ok ? null : local.retryAfter;
  }
}

function json(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {}
) {
  return Response.json(body, { status, headers });
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// An Origin header means a browser sent this. It must be our own site. MCP
// clients send no Origin, so a missing header is fine.
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return true;
  }
  const requested = originOf(origin);
  const own = originOf(env.APP_URL);
  return requested !== null && own !== null && requested === own;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  return match ? match[1] : null;
}

// Reads the body, counting bytes, and gives up past the limit. Some clients
// send no Content-Length, so the header alone cannot be trusted.
async function readLimitedText(
  request: Request
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!request.body) {
    return { ok: true, text: "" };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

export function GET() {
  return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
}

export function DELETE() {
  return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
}

export async function POST(request: Request) {
  // 1. The platform switch.
  if (!(await isMcpEnabled())) {
    return json({ error: "Not found" }, 404);
  }

  // 2. Origin.
  if (!originAllowed(request)) {
    return json({ error: "Forbidden" }, 403);
  }

  // 3. Declared size. The body itself is counted again while it is read.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: "Request too large" }, 413);
  }

  // 4. Token. The handshake needs one too.
  const rawToken = bearerToken(request);
  const actor = rawToken ? await resolveApiToken(rawToken) : null;
  if (!actor) {
    return json({ error: "Unauthorized" }, 401, {
      "WWW-Authenticate": "Bearer",
    });
  }

  // 5. Rate limits: per token, and per user across all their tokens.
  const retryAfter = await requestRetryAfter(
    actor.tokenId ?? "unknown",
    actor.userId
  );
  if (retryAfter !== null) {
    return json({ error: "Too many requests" }, 429, {
      "Retry-After": String(retryAfter),
    });
  }

  // 6. Body.
  const body = await readLimitedText(request);
  if (!body.ok) {
    return json({ error: "Request too large" }, 413);
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body.text);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // A new server and transport for every request: the SDK forbids reusing a
  // stateless transport, and the tools are bound to this request's actor.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMcpServer(actor);
  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { parsedBody });
  } catch {
    return json({ error: "Internal error" }, 500);
  } finally {
    await server.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}
