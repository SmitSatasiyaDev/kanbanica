import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  auditMock,
  mcpEnabledMock,
  createMock,
  revokeMock,
  listMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  auditMock: vi.fn(),
  mcpEnabledMock: vi.fn(),
  createMock: vi.fn(),
  revokeMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));
vi.mock("@/lib/audit", () => ({ audit: auditMock }));
vi.mock("@/lib/integration-settings", () => ({ isMcpEnabled: mcpEnabledMock }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/api-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-token")>()),
  createApiToken: createMock,
  revokeApiToken: revokeMock,
  listApiTokens: listMock,
}));

import {
  createMyApiToken,
  listMyApiTokens,
  revokeMyApiToken,
} from "@/app/actions/api-token";
import { ApiTokenError } from "@/lib/api-token";

const PLAIN = "kbn_PLAINTEXTSECRETVALUE0123456789abcdefghijk";
const input = {
  name: "Laptop",
  scope: "read",
  workspaceId: null,
  expiresInDays: 90,
};

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "u1", email: "a@b.c" } });
  mcpEnabledMock.mockResolvedValue(true);
  createMock.mockResolvedValue({
    token: PLAIN,
    row: {
      id: "t1",
      name: "Laptop",
      scope: "read",
      workspaceId: null,
      expiresAt: null,
      tokenPrefix: "PLAINTEX",
    },
  });
});

describe("createMyApiToken", () => {
  it("returns the plain token once, scoped to the session user", async () => {
    const result = await createMyApiToken(input);
    expect(result).toEqual({ token: PLAIN, id: "t1", prefix: "PLAINTEX" });
    expect(createMock).toHaveBeenCalledWith({ userId: "u1", ...input });
  });

  it("writes an audit entry that never contains the token", async () => {
    await createMyApiToken(input);
    expect(auditMock).toHaveBeenCalledTimes(1);
    const entry = auditMock.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: "api_token.created",
      entityType: "api_token",
      entityId: "t1",
      actorId: "u1",
    });
    expect(JSON.stringify(entry)).not.toContain(PLAIN);
  });

  it("is refused when MCP is disabled", async () => {
    mcpEnabledMock.mockResolvedValue(false);
    const result = await createMyApiToken(input);
    expect(result).toHaveProperty("error");
    expect(createMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await createMyApiToken(input)).toEqual({ error: "Unauthorized" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, name: "  " },
    { ...input, scope: "admin" },
    { ...input, expiresInDays: 7 },
    { ...input, workspaceId: 5 },
    null,
  ])("rejects invalid input %#", async (bad) => {
    expect(await createMyApiToken(bad)).toHaveProperty("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each([
    "NOT_ELIGIBLE",
    "WORKSPACE_NOT_ELIGIBLE",
    "TOKEN_LIMIT_REACHED",
  ] as const)("maps %s to a fixed message without audit", async (code) => {
    createMock.mockRejectedValue(new ApiTokenError(code));
    const result = await createMyApiToken(input);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).not.toContain(code);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("hides unexpected errors behind a generic message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    createMock.mockRejectedValue(new Error("connection refused 10.0.0.5"));
    const result = (await createMyApiToken(input)) as { error: string };
    expect(result.error).not.toContain("10.0.0.5");
    spy.mockRestore();
  });
});

describe("revokeMyApiToken", () => {
  it("revokes an own token and audits it", async () => {
    revokeMock.mockResolvedValue(true);
    expect(await revokeMyApiToken("t1")).toEqual({ ok: true });
    expect(revokeMock).toHaveBeenCalledWith("u1", "t1");
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: "api_token.revoked",
      entityType: "api_token",
      entityId: "t1",
    });
  });

  it("refuses another user's token", async () => {
    revokeMock.mockResolvedValue(false);
    expect(await revokeMyApiToken("t-other")).toEqual({
      error: "Token not found.",
    });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("still works when MCP is disabled", async () => {
    mcpEnabledMock.mockResolvedValue(false);
    revokeMock.mockResolvedValue(true);
    expect(await revokeMyApiToken("t1")).toEqual({ ok: true });
  });

  it("requires a session", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await revokeMyApiToken("t1")).toEqual({ error: "Unauthorized" });
  });
});

describe("listMyApiTokens", () => {
  it("lists the session user's tokens, also when MCP is disabled", async () => {
    mcpEnabledMock.mockResolvedValue(false);
    listMock.mockResolvedValue([{ id: "t1" }]);
    expect(await listMyApiTokens()).toEqual({ tokens: [{ id: "t1" }] });
    expect(listMock).toHaveBeenCalledWith("u1");
  });

  it("requires a session", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await listMyApiTokens()).toEqual({ error: "Unauthorized" });
  });
});
