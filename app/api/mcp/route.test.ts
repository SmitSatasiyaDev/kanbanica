import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/services/actor";

const mocks = vi.hoisted(() => ({
  isMcpEnabled: vi.fn(),
  resolveApiToken: vi.fn(),
  rateLimit: vi.fn(),
  consumeRateLimits: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.example.com" } }));
vi.mock("@/lib/integration-settings", () => ({
  isMcpEnabled: mocks.isMcpEnabled,
}));
vi.mock("@/lib/api-token", () => ({ resolveApiToken: mocks.resolveApiToken }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/rate-limit-db", () => ({
  consumeRateLimits: mocks.consumeRateLimits,
}));
vi.mock("@/lib/services/notification-service", () => ({
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
}));
vi.mock("@/lib/services/project-service", () => ({
  getCurrentSprint: vi.fn(),
  getListLocation: vi.fn(),
  listLists: vi.fn(),
  listMembers: vi.fn(),
  listProjects: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({ MAX_FILE_SIZE: 10 * 1024 * 1024 }));
vi.mock("@/lib/services/task-context", () => ({ resolveTaskContext: vi.fn() }));
vi.mock("@/lib/services/comment-service", () => ({ createComment: vi.fn() }));
vi.mock("@/lib/services/attachment-service", () => ({
  checkUploadAccess: vi.fn(),
  storeUploadedBytes: vi.fn(),
  deleteStoredFiles: vi.fn(),
  uploadAttachment: vi.fn(),
  readAttachment: vi.fn(),
  safeStorageName: (name: string) => name,
}));
vi.mock("@/lib/services/task-service", () => ({
  listWorkspaces: mocks.listWorkspaces,
  listMyTasks: vi.fn(),
  searchTasks: vi.fn(),
  getTask: vi.fn(),
  listTaskStatuses: vi.fn(),
  setTaskStatus: vi.fn(),
  completeTask: vi.fn(),
  assignTask: vi.fn(),
}));

import { DELETE, GET, POST } from "@/app/api/mcp/route";

const actor: Actor = {
  userId: "u1",
  name: "Dana",
  email: "dana@example.com",
  source: "mcp",
  tokenId: "tok1",
  scope: "write",
  workspaceId: null,
};

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  Authorization: "Bearer kbn_validtoken",
};

function post(
  body: unknown,
  headers: Record<string, string> = {},
  rawBody?: string
) {
  return POST(
    new Request("https://app.example.com/api/mcp", {
      method: "POST",
      headers: { ...MCP_HEADERS, ...headers },
      body: rawBody ?? JSON.stringify(body),
    })
  );
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mocks.isMcpEnabled.mockResolvedValue(true);
  mocks.resolveApiToken.mockResolvedValue(actor);
  mocks.rateLimit.mockReturnValue({ ok: true, retryAfter: 0 });
  mocks.consumeRateLimits.mockImplementation(
    async (checks: { key: string }[]) =>
      checks.map((c) => ({ key: c.key, ok: true, retryAfter: 0 }))
  );
});

describe("/api/mcp checks", () => {
  it("returns 404 when MCP is switched off", async () => {
    mocks.isMcpEnabled.mockResolvedValue(false);
    const res = await post(INITIALIZE);
    expect(res.status).toBe(404);
    expect(mocks.resolveApiToken).not.toHaveBeenCalled();
  });

  it("returns 403 for a foreign Origin", async () => {
    const res = await post(INITIALIZE, { Origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(mocks.resolveApiToken).not.toHaveBeenCalled();
    const garbage = await post(INITIALIZE, { Origin: "null" });
    expect(garbage.status).toBe(403);
  });

  it("allows our own Origin and a request without one", async () => {
    const own = await post(INITIALIZE, { Origin: "https://app.example.com" });
    expect(own.status).toBe(200);
    const none = await post(INITIALIZE);
    expect(none.status).toBe(200);
  });

  it("returns 413 for a declared body over 40 MB", async () => {
    const res = await post(INITIALIZE, {
      "Content-Length": String(41 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
    expect(mocks.resolveApiToken).not.toHaveBeenCalled();
  });

  it("returns 413 when the streamed body goes over 40 MB", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 10) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const res = await POST(
      new Request("https://app.example.com/api/mcp", {
        method: "POST",
        headers: MCP_HEADERS,
        body,
        // @ts-expect-error Node needs this for a streamed request body.
        duplex: "half",
      })
    );
    expect(res.status).toBe(413);
    // The reader gave up early instead of pulling everything.
    expect(sent).toBeLessThan(10);
  });

  it("returns 401 with WWW-Authenticate for a missing or bad token", async () => {
    const missing = await post(INITIALIZE, { Authorization: "" });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("WWW-Authenticate")).toBe("Bearer");

    mocks.resolveApiToken.mockResolvedValue(null);
    const bad = await post(INITIALIZE);
    expect(bad.status).toBe(401);
    expect(bad.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(mocks.resolveApiToken).toHaveBeenCalledWith("kbn_validtoken");
  });

  it("counts the token and the user in one call, with the agreed limits", async () => {
    await post(INITIALIZE);
    expect(mocks.consumeRateLimits).toHaveBeenCalledTimes(1);
    expect(mocks.consumeRateLimits).toHaveBeenCalledWith([
      { key: "mcp:token:tok1", limit: 120, windowMs: 60_000 },
      { key: "mcp:user:u1", limit: 300, windowMs: 60_000 },
    ]);
  });

  it("returns 429 with Retry-After when the token is over its limit", async () => {
    mocks.consumeRateLimits.mockResolvedValue([
      { key: "mcp:token:tok1", ok: false, retryAfter: 42 },
      { key: "mcp:user:u1", ok: true, retryAfter: 0 },
    ]);
    const res = await post(INITIALIZE);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("returns 429 when the user is over their limit across tokens", async () => {
    mocks.consumeRateLimits.mockResolvedValue([
      { key: "mcp:token:tok1", ok: true, retryAfter: 0 },
      { key: "mcp:user:u1", ok: false, retryAfter: 17 },
    ]);
    const res = await post(INITIALIZE);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
  });

  it("fails open when the database limiter errors, still applying the local token limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.consumeRateLimits.mockRejectedValue(new Error("db down"));
    const ok = await post(INITIALIZE);
    expect(ok.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledWith("mcp:tok1", 120, 60_000);

    mocks.rateLimit.mockReturnValue({ ok: false, retryAfter: 9 });
    const limited = await post(INITIALIZE);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("9");
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await post(undefined, {}, "{not json");
    expect(res.status).toBe(400);
  });

  it("returns 405 on GET and DELETE", async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
    expect(((await GET().json()) as { error: string }).error).toBeTruthy();
  });
});

describe("/api/mcp protocol", () => {
  it("answers initialize and then lists the twenty tools", async () => {
    const init = await post(INITIALIZE);
    expect(init.status).toBe(200);
    expect(init.headers.get("Content-Type")).toContain("application/json");
    const initBody = (await init.json()) as {
      result: {
        serverInfo: { name: string };
        capabilities: { tools: unknown };
      };
    };
    expect(initBody.result.serverInfo.name).toBe("kanbanica");
    expect(initBody.result.capabilities.tools).toBeDefined();

    // No session id is issued: every request stands alone.
    expect(init.headers.get("mcp-session-id")).toBeNull();

    const notified = await post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(notified.status).toBe(202);

    const list = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { "Mcp-Protocol-Version": "2025-03-26" }
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      result: { tools: { name: string }[] };
    };
    expect(listBody.result.tools).toHaveLength(20);
    expect(listBody.result.tools.map((t) => t.name)).toContain("add_comment");
  });

  it("runs a tool call for the token's user", async () => {
    mocks.listWorkspaces.mockResolvedValue({
      ok: true,
      workspaces: [{ id: "w1", name: "Acme" }],
    });
    const res = await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_workspaces", arguments: {} },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { content: { text: string }[] };
    };
    expect(JSON.parse(body.result.content[0].text)).toEqual([
      { id: "w1", name: "Acme" },
    ]);
    expect(mocks.listWorkspaces).toHaveBeenCalledWith(actor);
  });

  it("requires the client to accept JSON and event streams", async () => {
    const res = await post(INITIALIZE, { Accept: "application/json" });
    expect(res.status).toBe(406);
  });
});
