import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  setPendingInvite: vi.fn(),
  readPendingInvite: vi.fn(),
  clearPendingInvite: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: { APP_URL: "http://localhost:3000" } }));
vi.mock("@/lib/pending-join", () => h);

import { GET as stash } from "@/app/api/invite/[token]/route";
import { GET as consume } from "@/app/api/invite/consume/route";

beforeEach(() => {
  for (const m of Object.values(h)) {
    m.mockReset();
  }
});

describe("invite redirect handlers", () => {
  it("Accept while signed out stashes the token and goes to login (token survives)", async () => {
    const res = await stash(new Request("http://x"), {
      params: Promise.resolve({ token: "tok123" }),
    });
    expect(h.setPendingInvite).toHaveBeenCalledWith("tok123");
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("after sign-in returns to the invite page marked accepted, clearing the cookie", async () => {
    h.readPendingInvite.mockResolvedValue("tok123");
    const res = await consume();
    expect(h.clearPendingInvite).toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/invite/tok123?accepted=1"
    );
  });

  it("without a pending token falls back to /post-auth", async () => {
    h.readPendingInvite.mockResolvedValue(null);
    const res = await consume();
    expect(res.headers.get("location")).toBe("http://localhost:3000/post-auth");
  });
});
