import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  hasName: vi.fn(),
  selectQueue: [] as unknown[][],
  update: vi.fn(),
  del: vi.fn(),
  updateReturning: [] as unknown[][],
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.getSession } } }));
vi.mock("@/lib/permissions", () => ({ getWorkspaceMembership: vi.fn() }));
vi.mock("@/lib/realtime/refresh", () => ({ refreshWorkspace: vi.fn() }));
vi.mock("@/lib/email", () => ({ enqueueEmail: vi.fn() }));
vi.mock("@/lib/email/templates/workspace-invite", () => ({
  workspaceInviteTemplate: vi.fn(),
}));
vi.mock("@/lib/notifications/create-notification", () => ({
  createNotifications: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/env", () => ({
  env: { APP_URL: "http://localhost", NODE_ENV: "test" },
}));
vi.mock("@/lib/invite-link-server", () => ({ consumeInviteLinkUse: vi.fn() }));
vi.mock("@/lib/workspace-limits", () => ({ requireMemberCapacity: vi.fn() }));
vi.mock("@/lib/profile-name", () => ({ userHasDisplayName: h.hasName }));

function selectChain() {
  const rows = h.selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "innerJoin", "leftJoin"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(selectChain),
    update: vi.fn(() => ({
      set: (v: unknown) => {
        h.update(v);
        return {
          where: () => ({
            returning: () => Promise.resolve(h.updateReturning.shift() ?? []),
          }),
        };
      },
    })),
    delete: vi.fn(() => ({
      where: () => {
        h.del();
        return Promise.resolve();
      },
    })),
  },
}));

import { acceptInvite, getInviteState } from "@/app/actions/workspace";

const FUTURE = new Date(Date.now() + 86_400_000);
const invite = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  workspaceId: "w1",
  userId: null,
  email: "invited@x.io",
  role: "MEMBER",
  status: "INVITED",
  invitedBy: "inviter1",
  inviteToken: "tok",
  inviteExpiresAt: FUTURE,
  ...over,
});

// getInviteState reads: invite, workspace, inviter
function queuePending(over: Record<string, unknown> = {}) {
  h.selectQueue.push(
    [invite(over)],
    [{ name: "Test" }],
    [{ name: "Smit", email: "smit@x.io" }]
  );
}

beforeEach(() => {
  h.selectQueue.length = 0;
  h.updateReturning.length = 0;
  h.update.mockReset();
  h.del.mockReset();
  h.getSession.mockReset().mockResolvedValue(null);
  h.hasName.mockReset().mockResolvedValue(true);
});

describe("getInviteState — invitation shown first, never consumes", () => {
  it("shows workspace, inviter, role and email to a signed-out visitor", async () => {
    queuePending();
    expect(await getInviteState("tok")).toEqual({
      state: "pending",
      workspaceName: "Test",
      inviterName: "Smit",
      role: "Member",
      email: "invited@x.io",
      authenticated: false,
      needsName: false,
    });
  });

  it("is read-only: refresh / reopen / back-forward only re-read (no write)", async () => {
    for (let i = 0; i < 3; i++) {
      queuePending();
      const res = await getInviteState("tok");
      expect(res.state).toBe("pending");
    }
    expect(h.update).not.toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
  });

  it("flags a signed-in user with no display name so the name step comes after Accept", async () => {
    h.getSession.mockResolvedValue({
      user: { id: "u1", email: "invited@x.io" },
    });
    h.hasName.mockResolvedValue(false);
    queuePending();
    expect(await getInviteState("tok")).toMatchObject({
      state: "pending",
      authenticated: true,
      needsName: true,
    });
  });

  it("existing user with a complete profile needs no name step", async () => {
    h.getSession.mockResolvedValue({
      user: { id: "u1", email: "invited@x.io" },
    });
    queuePending();
    expect(await getInviteState("tok")).toMatchObject({
      authenticated: true,
      needsName: false,
    });
  });

  it.each([
    ["unknown token", [] as unknown[], "invalid"],
    [
      "expired",
      [invite({ inviteExpiresAt: new Date(Date.now() - 1000) })],
      "expired",
    ],
    [
      "already used by someone else",
      [invite({ status: "ACTIVE", userId: "other" })],
      "used",
    ],
  ])(
    "invalid invitation (%s) returns an error, not a pending state",
    async (_n, rows, code) => {
      h.selectQueue.push(rows);
      expect(await getInviteState("tok")).toMatchObject({
        state: "error",
        code,
      });
    }
  );

  it("rejects a signed-in user whose email differs from the invite", async () => {
    h.getSession.mockResolvedValue({ user: { id: "u2", email: "other@x.io" } });
    h.selectQueue.push([invite()]);
    expect(await getInviteState("tok")).toMatchObject({
      state: "error",
      code: "wrong_user",
    });
  });

  it("an invite this user already accepted resolves to the workspace", async () => {
    h.getSession.mockResolvedValue({
      user: { id: "u1", email: "invited@x.io" },
    });
    h.selectQueue.push([invite({ status: "ACTIVE", userId: "u1" })]);
    expect(await getInviteState("tok")).toEqual({
      state: "accepted",
      workspaceId: "w1",
    });
  });
});

describe("acceptInvite — consumes only on explicit accept", () => {
  beforeEach(() => {
    h.getSession.mockResolvedValue({
      user: { id: "u1", email: "invited@x.io", name: "New" },
    });
  });

  it("creates the membership (single guarded update) and returns the workspace", async () => {
    h.selectQueue.push([invite()], [{ name: "Test" }]);
    h.updateReturning.push([{ id: "m1" }]);
    expect(await acceptInvite("tok")).toEqual({ workspaceId: "w1" });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", status: "ACTIVE" })
    );
  });

  it("a repeat/double accept is idempotent: no second membership write", async () => {
    h.selectQueue.push([invite({ status: "ACTIVE", userId: "u1" })]);
    expect(await acceptInvite("tok")).toEqual({ workspaceId: "w1" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("requires a session (signed-out visitor cannot consume)", async () => {
    h.getSession.mockResolvedValue(null);
    expect(await acceptInvite("tok")).toMatchObject({ code: "auth_required" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("does not accept an expired invite", async () => {
    h.selectQueue.push([
      invite({ inviteExpiresAt: new Date(Date.now() - 1000) }),
    ]);
    expect(await acceptInvite("tok")).toMatchObject({ code: "expired" });
    expect(h.update).not.toHaveBeenCalled();
  });
});
