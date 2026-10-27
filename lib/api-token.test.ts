import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, insertMock, updateMock, valuesMock, setMock } = vi.hoisted(
  () => ({
    selectMock: vi.fn(),
    insertMock: vi.fn(),
    updateMock: vi.fn(),
    valuesMock: vi.fn(),
    setMock: vi.fn(),
  })
);

vi.mock("@/lib/db", () => ({
  db: { select: selectMock, insert: insertMock, update: updateMock },
}));

import {
  ApiTokenError,
  createApiToken,
  generateToken,
  hashToken,
  listApiTokens,
  resolveApiToken,
  revokeApiToken,
  tokenEligibleWorkspaces,
} from "@/lib/api-token";

interface Chain extends PromiseLike<unknown[]> {
  from: () => Chain;
  innerJoin: () => Chain;
  leftJoin: () => Chain;
  limit: () => Chain;
  orderBy: () => Chain;
  where: () => Chain;
}

function chain(result: unknown[]): Chain {
  const c: Chain = {
    from: () => c,
    innerJoin: () => c,
    leftJoin: () => c,
    where: () => c,
    orderBy: () => c,
    limit: () => c,
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
    then: (ok, fail) => Promise.resolve(result).then(ok, fail),
  };
  return c;
}

function queueSelects(...batches: unknown[][]) {
  let i = 0;
  selectMock.mockImplementation(() => chain(batches[i++] ?? []));
}

const MINUTE = 60_000;

beforeEach(() => {
  vi.clearAllMocks();
  setMock.mockReturnValue({ where: () => Promise.resolve(undefined) });
  updateMock.mockReturnValue({ set: setMock });
  valuesMock.mockImplementation((v: Record<string, unknown>) => ({
    returning: () => Promise.resolve([{ ...v }]),
  }));
  insertMock.mockReturnValue({ values: valuesMock });
});

describe("token format", () => {
  it("is kbn_ + base64url of 32 random bytes", () => {
    const token = generateToken();
    expect(token).toMatch(/^kbn_[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
  });

  it("hashes with SHA-256 hex", () => {
    const hash = hashToken("kbn_abc");
    expect(hash).toBe(createHash("sha256").update("kbn_abc").digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("createApiToken", () => {
  const base = {
    userId: "u1",
    name: "Laptop",
    scope: "write" as const,
    workspaceId: null,
    expiresInDays: 30 as const,
  };

  it("returns the plain token once and stores only its hash", async () => {
    queueSelects([{ id: "w1", name: "Acme" }], [{ n: 0 }]);
    const { token, row } = await createApiToken(base);

    expect(token.startsWith("kbn_")).toBe(true);
    const inserted = valuesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.tokenHash).toBe(hashToken(token));
    expect(inserted.tokenPrefix).toBe(token.slice(4, 12));
    expect(inserted.scope).toBe("write");
    expect(inserted.workspaceId).toBeNull();
    // The plain token appears nowhere in what was written.
    expect(JSON.stringify(inserted)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("sets expiry from the preset, or none for never", async () => {
    queueSelects([{ id: "w1", name: "Acme" }], [{ n: 0 }]);
    await createApiToken(base);
    const expiresAt = (valuesMock.mock.calls[0][0] as { expiresAt: Date })
      .expiresAt;
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThan(30.01);

    valuesMock.mockClear();
    queueSelects([{ id: "w1", name: "Acme" }], [{ n: 0 }]);
    await createApiToken({ ...base, expiresInDays: null });
    expect(
      (valuesMock.mock.calls[0][0] as { expiresAt: Date | null }).expiresAt
    ).toBeNull();
  });

  it("stores a workspace restriction the user is eligible for", async () => {
    queueSelects([{ id: "w1", name: "Acme" }], [{ n: 0 }]);
    await createApiToken({ ...base, workspaceId: "w1" });
    expect(valuesMock.mock.calls[0][0]).toMatchObject({ workspaceId: "w1" });
  });

  it("refuses the 21st active token", async () => {
    queueSelects([{ id: "w1", name: "Acme" }], [{ n: 20 }]);
    await expect(createApiToken(base)).rejects.toMatchObject({
      code: "TOKEN_LIMIT_REACHED",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("allows the 20th token (19 active)", async () => {
    queueSelects([{ id: "w1", name: "Acme" }], [{ n: 19 }]);
    await expect(createApiToken(base)).resolves.toBeDefined();
  });

  it("refuses a user with no non-guest membership (guest everywhere)", async () => {
    queueSelects([]);
    const err = await createApiToken(base).catch((e) => e);
    expect(err).toBeInstanceOf(ApiTokenError);
    expect(err.code).toBe("NOT_ELIGIBLE");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses a workspace where the user is a guest (not in the eligible list)", async () => {
    // Eligible only in w1; asks for w2 where they are GUEST.
    queueSelects([{ id: "w1", name: "Acme" }]);
    await expect(
      createApiToken({ ...base, workspaceId: "w2" })
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_ELIGIBLE" });
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("tokenEligibleWorkspaces", () => {
  it("returns the rows the non-guest/active query yields", async () => {
    queueSelects([{ id: "w1", name: "Acme" }]);
    expect(await tokenEligibleWorkspaces("u1")).toEqual([
      { id: "w1", name: "Acme" },
    ]);
  });
});

describe("resolveApiToken", () => {
  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: "t1",
      userId: "u1",
      scope: "write",
      workspaceId: null,
      lastUsedAt: new Date(),
      expiresAt: null,
      revokedAt: null,
      name: "Ann",
      email: "ann@example.com",
      banned: false,
      banExpires: null,
      ...overrides,
    };
  }

  it("returns an mcp Actor for a valid token", async () => {
    queueSelects([row({ workspaceId: "w1", scope: "read" })]);
    expect(await resolveApiToken("kbn_valid")).toEqual({
      userId: "u1",
      name: "Ann",
      email: "ann@example.com",
      source: "mcp",
      tokenId: "t1",
      scope: "read",
      workspaceId: "w1",
    });
  });

  it("looks up by the hash of the presented token", async () => {
    queueSelects([]);
    expect(await resolveApiToken("kbn_unknown")).toBeNull();
  });

  it("rejects tokens without the kbn_ prefix without touching the DB", async () => {
    expect(await resolveApiToken("sk_whatever")).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rejects a revoked token", async () => {
    queueSelects([row({ revokedAt: new Date() })]);
    expect(await resolveApiToken("kbn_x")).toBeNull();
  });

  it("rejects an expired token and accepts one expiring later", async () => {
    queueSelects([row({ expiresAt: new Date(Date.now() - 1000) })]);
    expect(await resolveApiToken("kbn_x")).toBeNull();
    queueSelects([row({ expiresAt: new Date(Date.now() + 60_000) })]);
    expect(await resolveApiToken("kbn_x")).not.toBeNull();
  });

  it("rejects a banned user with no ban expiry", async () => {
    queueSelects([row({ banned: true, banExpires: null })]);
    expect(await resolveApiToken("kbn_x")).toBeNull();
  });

  it("rejects a banned user whose ban has not expired yet", async () => {
    queueSelects([
      row({ banned: true, banExpires: new Date(Date.now() + 3_600_000) }),
    ]);
    expect(await resolveApiToken("kbn_x")).toBeNull();
  });

  it("accepts a user whose ban already expired", async () => {
    queueSelects([
      row({ banned: true, banExpires: new Date(Date.now() - 3_600_000) }),
    ]);
    expect(await resolveApiToken("kbn_x")).not.toBeNull();
  });

  it("falls back to read scope for an unknown scope value", async () => {
    queueSelects([row({ scope: "admin" })]);
    expect((await resolveApiToken("kbn_x"))?.scope).toBe("read");
  });

  describe("last_used_at throttle", () => {
    it("writes when the token was never used", async () => {
      queueSelects([row({ lastUsedAt: null })]);
      await resolveApiToken("kbn_x");
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(setMock.mock.calls[0][0]).toHaveProperty("lastUsedAt");
    });

    it("writes when the last write is older than a minute", async () => {
      queueSelects([row({ lastUsedAt: new Date(Date.now() - 2 * MINUTE) })]);
      await resolveApiToken("kbn_x");
      expect(updateMock).toHaveBeenCalledTimes(1);
    });

    it("skips the write when the last one is within a minute", async () => {
      queueSelects([row({ lastUsedAt: new Date(Date.now() - 10_000) })]);
      await resolveApiToken("kbn_x");
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("does not write for a rejected token", async () => {
      queueSelects([row({ lastUsedAt: null, revokedAt: new Date() })]);
      await resolveApiToken("kbn_x");
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("never fails the request when the write fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      setMock.mockReturnValue({ where: () => Promise.reject(new Error("db")) });
      queueSelects([row({ lastUsedAt: null })]);
      await expect(resolveApiToken("kbn_x")).resolves.not.toBeNull();
      await new Promise((r) => setTimeout(r, 0));
      errorSpy.mockRestore();
    });
  });
});

describe("revokeApiToken", () => {
  it("revokes the user's own token", async () => {
    queueSelects([{ id: "t1", revokedAt: null }]);
    expect(await revokeApiToken("u1", "t1")).toBe(true);
    expect(setMock.mock.calls[0][0]).toHaveProperty("revokedAt");
  });

  it("refuses a token that does not belong to the user", async () => {
    // The ownership query (id AND user_id) finds nothing for another user.
    queueSelects([]);
    expect(await revokeApiToken("u2", "t1")).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("is a no-op for an already revoked token", async () => {
    queueSelects([{ id: "t1", revokedAt: new Date() }]);
    expect(await revokeApiToken("u1", "t1")).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("listApiTokens", () => {
  it("returns the rows without any hash field", async () => {
    queueSelects([{ id: "t1", name: "Laptop", tokenPrefix: "abcd1234" }]);
    const rows = await listApiTokens("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("tokenHash");
  });
});
