import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  hasName: vi.fn(),
  readPendingInvite: vi.fn(),
  activate: vi.fn(),
}));

class Redirect extends Error {
  constructor(public url: string) {
    super(url);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: { getSession: vi.fn(async () => ({ user: { id: "u1" } })) },
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/setup", () => ({ redirectToSetupIfNeeded: vi.fn() }));
vi.mock("@/lib/workspace-landing", () => ({
  getWorkspaceLandingState: vi.fn(),
}));
vi.mock("@/lib/last-workspace", () => ({ LAST_WORKSPACE_COOKIE: "lw" }));
vi.mock("@/app/actions/workspace", () => ({
  activatePendingInvites: h.activate,
}));
vi.mock("@/lib/pending-join", () => ({
  readPendingInvite: h.readPendingInvite,
  readPendingJoin: vi.fn(async () => null),
}));
vi.mock("@/lib/profile-name", () => ({
  userHasDisplayName: h.hasName,
  completeProfileUrl: (n: string) => `/complete-profile?next=${n}`,
}));

import PostAuthPage from "@/app/post-auth/page";

async function run() {
  try {
    await PostAuthPage();
  } catch (e) {
    if (e instanceof Redirect) {
      return e.url;
    }
    throw e;
  }
  return null;
}

beforeEach(() => {
  h.hasName.mockReset();
  h.readPendingInvite.mockReset();
  h.activate.mockReset();
});

describe("/post-auth with a pending invite", () => {
  it("returns a nameless new user to the invite BEFORE asking for a name", async () => {
    h.readPendingInvite.mockResolvedValue("tok");
    h.hasName.mockResolvedValue(false);
    expect(await run()).toBe("/api/invite/consume");
    expect(h.hasName).not.toHaveBeenCalled();
  });

  it("without an invite, a nameless user still gets the complete-profile step", async () => {
    h.readPendingInvite.mockResolvedValue(null);
    h.hasName.mockResolvedValue(false);
    expect(await run()).toBe("/complete-profile?next=/post-auth");
  });
});
