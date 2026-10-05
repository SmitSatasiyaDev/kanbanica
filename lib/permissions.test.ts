import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canAccessSpace,
  getAccessibleSpaceIds,
  getSpacePermission,
  getWorkspaceMembership,
  hasPermissionLevel,
  requireSpacePermission,
} from "@/lib/permissions";

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { select: selectMock } }));

interface QueryChain extends PromiseLike<unknown[]> {
  from: () => QueryChain;
  innerJoin: () => QueryChain;
  limit: () => Promise<unknown[]>;
  where: () => QueryChain;
}

function createChain(result: unknown[]): QueryChain {
  const chain: QueryChain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    limit: () => Promise.resolve(result),
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return chain;
}

/**
 * Configures `db.select(...)` to return one queued result set per call, in
 * call order — mirroring the sequential / `Promise.all`-concurrent selects
 * `lib/permissions.ts` issues for a given scenario. `.limit()` and awaiting
 * the chain directly (no `.limit()`) both resolve from the same queue slot.
 */
function queueSelectResults(...batches: unknown[][]) {
  let index = 0;
  selectMock.mockImplementation(() => {
    const result = batches[index] ?? [];
    index += 1;
    return createChain(result);
  });
}

beforeEach(() => {
  selectMock.mockReset();
});

describe("hasPermissionLevel", () => {
  it.each([
    ["view", "view", true],
    ["view", "edit", false],
    ["view", "full_access", false],
    ["edit", "view", true],
    ["edit", "edit", true],
    ["edit", "full_access", false],
    ["full_access", "view", true],
    ["full_access", "edit", true],
    ["full_access", "full_access", true],
  ] as const)(
    "permission=%s, minLevel=%s -> %s",
    (permission, minLevel, expected) => {
      expect(hasPermissionLevel(permission, minLevel)).toBe(expected);
    }
  );
});

describe("getWorkspaceMembership", () => {
  it("returns the membership row when an active membership exists", async () => {
    queueSelectResults([{ role: "MEMBER", userId: "u1", workspaceId: "w1" }]);
    const result = await getWorkspaceMembership("u1", "w1");
    expect(result).toEqual({ role: "MEMBER", userId: "u1", workspaceId: "w1" });
  });

  it("returns null when there is no active membership", async () => {
    queueSelectResults([]);
    const result = await getWorkspaceMembership("u1", "w1");
    expect(result).toBeNull();
  });
});

describe("getSpacePermission", () => {
  it("returns null when the user has no workspace membership", async () => {
    queueSelectResults([]);
    const result = await getSpacePermission("u1", "w1", "s1");
    expect(result).toBeNull();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns full_access for OWNER without querying spaceMember", async () => {
    queueSelectResults([{ role: "OWNER" }]);
    const result = await getSpacePermission("u1", "w1", "s1");
    expect(result).toBe("full_access");
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns full_access for ADMIN without querying spaceMember", async () => {
    queueSelectResults([{ role: "ADMIN" }]);
    const result = await getSpacePermission("u1", "w1", "s1");
    expect(result).toBe("full_access");
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["FULL_ACCESS", "full_access"],
    ["EDIT", "edit"],
    ["VIEW", "view"],
  ] as const)(
    "maps a MEMBER's %s spaceMember row to %s",
    async (dbValue, expected) => {
      queueSelectResults([{ role: "MEMBER" }], [{ permission: dbValue }]);
      const result = await getSpacePermission("u1", "w1", "s1");
      expect(result).toBe(expected);
    }
  );

  it("returns null for a MEMBER with no spaceMember row", async () => {
    queueSelectResults([{ role: "MEMBER" }], []);
    const result = await getSpacePermission("u1", "w1", "s1");
    expect(result).toBeNull();
  });
});

describe("requireSpacePermission", () => {
  it("returns null (access granted) when the held permission satisfies minLevel", async () => {
    queueSelectResults([{ role: "MEMBER" }], [{ permission: "FULL_ACCESS" }]);
    const result = await requireSpacePermission("u1", "w1", "s1", "edit");
    expect(result).toBeNull();
  });

  it("returns 403 when the held permission is below minLevel", async () => {
    queueSelectResults([{ role: "MEMBER" }], [{ permission: "VIEW" }]);
    const result = await requireSpacePermission("u1", "w1", "s1", "edit");
    expect(result).toEqual({ error: "Forbidden", status: 403 });
  });

  it("returns 404 for a private space when the user has no access (existence hiding)", async () => {
    queueSelectResults([], [{ isPrivate: true }]);
    const result = await requireSpacePermission("u1", "w1", "s1", "view");
    expect(result).toEqual({ error: "Not found", status: 404 });
  });

  it("returns 404 when the space row does not exist", async () => {
    queueSelectResults([], []);
    const result = await requireSpacePermission("u1", "w1", "s1", "view");
    expect(result).toEqual({ error: "Not found", status: 404 });
  });

  it("returns 403 for a public space when the user has no access", async () => {
    queueSelectResults([{ role: "MEMBER" }], [], [{ isPrivate: false }]);
    const result = await requireSpacePermission("u1", "w1", "s1", "view");
    expect(result).toEqual({ error: "Forbidden", status: 403 });
  });
});

describe("getAccessibleSpaceIds", () => {
  it("returns an empty array when the user has no workspace membership", async () => {
    queueSelectResults([]);
    const result = await getAccessibleSpaceIds("u1", "w1");
    expect(result).toEqual([]);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns all spaces in the workspace for OWNER", async () => {
    queueSelectResults([{ role: "OWNER" }], [{ id: "s1" }, { id: "s2" }]);
    const result = await getAccessibleSpaceIds("u1", "w1");
    expect(result).toEqual(["s1", "s2"]);
  });

  it("returns all spaces in the workspace for ADMIN", async () => {
    queueSelectResults([{ role: "ADMIN" }], [{ id: "s1" }]);
    const result = await getAccessibleSpaceIds("u1", "w1");
    expect(result).toEqual(["s1"]);
  });

  it("returns only explicitly-joined spaces for GUEST", async () => {
    queueSelectResults([{ role: "GUEST" }], [{ spaceId: "s1" }]);
    const result = await getAccessibleSpaceIds("u1", "w1");
    expect(result).toEqual(["s1"]);
  });

  it("returns the union of public spaces and explicit private memberships for MEMBER, deduped", async () => {
    queueSelectResults(
      [{ role: "MEMBER" }],
      [{ id: "s1" }, { id: "shared" }],
      [{ spaceId: "shared" }, { spaceId: "s3" }]
    );
    const result = await getAccessibleSpaceIds("u1", "w1");
    expect(new Set(result)).toEqual(new Set(["s1", "shared", "s3"]));
    expect(result).toHaveLength(3);
  });
});

describe("canAccessSpace", () => {
  it("returns true when the space is in the accessible set", async () => {
    queueSelectResults([{ role: "OWNER" }], [{ id: "s1" }, { id: "s2" }]);
    const result = await canAccessSpace("u1", "w1", "s2");
    expect(result).toBe(true);
  });

  it("returns false when the space is not in the accessible set", async () => {
    queueSelectResults([{ role: "OWNER" }], [{ id: "s1" }]);
    const result = await canAccessSpace("u1", "w1", "s2");
    expect(result).toBe(false);
  });
});
