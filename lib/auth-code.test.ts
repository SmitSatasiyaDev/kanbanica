import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sent, memDb, signup } = vi.hoisted(() => ({
  signup: { enabled: false },
  sent: [] as { to: string; html: string; text?: string }[],
  memDb: {
    user: [],
    session: [],
    account: [],
    verification: [],
  } as Record<string, unknown[]>,
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: () => memoryAdapter(memDb),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/email", () => ({
  enqueueEmail: vi.fn(
    async (m: { to: string; html: string; text?: string }) => {
      sent.push(m);
    }
  ),
}));
vi.mock("@/lib/integration-settings", () => ({
  getGoogleOAuthSettings: async () => null,
  isPasswordSignupEnabled: async () => signup.enabled,
  isSmtpConfigured: async () => false,
}));

import { auth } from "@/lib/auth";
import { getFallbackCode } from "@/lib/login-fallback";
import { deriveSignInCode, LOGIN_PROOF_COOKIE } from "@/lib/login-proof";

let n = 0;
const nextEmail = () => `user${++n}@example.com`;

/** The code is never emailed; derive it from the link's token like the server. */
function lastCode(to: string): string {
  const token = new URL(lastLink(to)).searchParams.get("token") ?? "";
  return deriveSignInCode(token);
}
function lastLink(to: string): string {
  const mail = [...sent].reverse().find((m) => m.to === to);
  return mail?.text?.match(/https?:\/\/\S+/)?.[0] ?? "";
}
/** Browser A's requesting cookie, per email (set by the login request). */
const cookies = new Map<string, string>();
async function request(email: string) {
  const res = await auth.api.signInMagicLink({
    body: { email, callbackURL: "/post-auth" },
    headers: new Headers(),
    asResponse: true,
  });
  const m = res.headers
    .get("set-cookie")
    ?.match(new RegExp(`${LOGIN_PROOF_COOKIE}=([^;]+)`));
  if (m) {
    cookies.set(email, m[1]);
  }
}
const openLink = (email: string, withCookie: boolean) =>
  auth.handler(
    new Request(lastLink(email), {
      headers: withCookie
        ? { cookie: `${LOGIN_PROOF_COOKIE}=${cookies.get(email)}` }
        : {},
      redirect: "manual",
    })
  );
const tokenOf = (email: string) =>
  new URL(lastLink(email)).searchParams.get("token") ?? "";
async function signInCode(email: string, otp: string) {
  return auth.api.signInEmailOTP({
    body: { email, otp },
    headers: new Headers(),
    asResponse: true,
  });
}
const rows = (k: string) => memDb[k] as Record<string, unknown>[];

beforeEach(() => {
  sent.length = 0;
  vi.useRealTimers();
});

describe("emailed code + magic link", () => {
  it("one email has the link only (no code); the code is stored hashed", async () => {
    const email = nextEmail();
    await request(email);
    expect(sent).toHaveLength(1);
    const code = lastCode(email);
    expect(code).toMatch(/^\d{6}$/);
    expect(lastLink(email)).toContain("/magic-link/verify");
    expect(sent[0].html).not.toContain(code);
    expect(sent[0].text ?? "").not.toContain(code);
    const stored = rows("verification").find((r) =>
      String(r.identifier).startsWith("sign-in-otp-")
    );
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it("codes are unpredictable (distinct across requests)", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const e = nextEmail();
      await request(e);
      codes.add(lastCode(e));
    }
    expect(codes.size).toBeGreaterThan(3);
  });

  it("valid code signs in, creates one user + session, and is single-use", async () => {
    const email = nextEmail();
    await request(email);
    const code = lastCode(email);
    const res = await signInCode(email, code);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session_token");
    expect(rows("user").filter((u) => u.email === email)).toHaveLength(1);
    const again = await signInCode(email, code);
    expect(again.status).toBe(400);
  });

  it("existing user signs in with a code without a duplicate user", async () => {
    const email = nextEmail();
    await request(email);
    await signInCode(email, lastCode(email));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    await request(email);
    const res = await signInCode(email, lastCode(email));
    expect(res.status).toBe(200);
    expect(rows("user").filter((u) => u.email === email)).toHaveLength(1);
  });

  it("wrong code is rejected and counted", async () => {
    const email = nextEmail();
    await request(email);
    const code = lastCode(email);
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await signInCode(email, wrong)).status).toBe(400);
    const row = rows("verification").find(
      (r) => r.identifier === `sign-in-otp-${email}`
    );
    expect(String(row?.value).endsWith(":1")).toBe(true);
    expect((await signInCode(email, code)).status).toBe(200);
  });

  it("expired code is rejected", async () => {
    const email = nextEmail();
    await request(email);
    const code = lastCode(email);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    expect((await signInCode(email, code)).status).toBe(400);
  });

  it("5 wrong attempts lock the code; the right code then fails", async () => {
    const email = nextEmail();
    await request(email);
    const code = lastCode(email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await signInCode(email, wrong);
    }
    expect((await signInCode(email, code)).status).toBe(403);
  });

  it("resend invalidates the old code; the new one works", async () => {
    const email = nextEmail();
    await request(email);
    const oldCode = lastCode(email);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    await request(email);
    const newCode = lastCode(email);
    if (newCode !== oldCode) {
      expect((await signInCode(email, oldCode)).status).toBe(400);
    }
    expect((await signInCode(email, newCode)).status).toBe(200);
  });

  it("same-browser magic link signs in directly (no code step)", async () => {
    const email = nextEmail();
    await request(email);
    const res = await openLink(email, true);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/post-auth");
    expect(res.headers.get("set-cookie")).toContain("session_token");
  });

  it("different-browser magic link does NOT sign in; redirects to the fallback", async () => {
    const email = nextEmail();
    await request(email);
    const res = await openLink(email, false);
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain(`/login/code?token=${tokenOf(email)}`);
    expect(location).not.toContain(lastCode(email));
    expect(res.headers.get("set-cookie") ?? "").not.toContain("session_token");
    // The token was not consumed, so the proper browser can still use it.
    expect((await openLink(email, true)).headers.get("location")).toContain(
      "/post-auth"
    );
  });

  it("fallback shows the same code that was emailed, and it signs in", async () => {
    const email = nextEmail();
    await request(email);
    const fb = await getFallbackCode(tokenOf(email));
    expect(fb).toEqual({ ok: true, code: lastCode(email), email });
    expect((await signInCode(email, lastCode(email))).status).toBe(200);
  });

  it("fallback is refused after a resend supersedes the code", async () => {
    const email = nextEmail();
    await request(email);
    const oldToken = tokenOf(email);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    await request(email);
    expect(await getFallbackCode(oldToken)).toEqual({
      ok: false,
      reason: "superseded",
    });
    expect((await getFallbackCode(tokenOf(email))).ok).toBe(true);
  });

  it("fallback rejects garbage and unknown tokens", async () => {
    expect(await getFallbackCode("nope")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await getFallbackCode("A".repeat(32))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("unknown email gets the same generic failure (no enumeration)", async () => {
    const res = await signInCode(nextEmail(), "123456");
    expect(res.status).toBe(400);
  });

  it("throttles rapid resend requests per email", async () => {
    const email = nextEmail();
    await request(email);
    const res = await auth.api.signInMagicLink({
      body: { email, callbackURL: "/post-auth" },
      headers: new Headers(),
      asResponse: true,
    });
    expect(res.status).toBe(429);
  });

  it("throttles repeated verification attempts per email", async () => {
    const email = nextEmail();
    for (let i = 0; i < 10; i++) {
      await signInCode(email, "123456");
    }
    await expect(signInCode(email, "123456")).rejects.toMatchObject({
      status: "TOO_MANY_REQUESTS",
    });
  });
});

describe("password sign-up switch (applies per request, no restart)", () => {
  const signUp = (email: string) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: "correct-horse-battery",
          name: "Test User",
        }),
      })
    );

  it("rejects registration while off", async () => {
    signup.enabled = false;
    const email = nextEmail();
    const res = await signUp(email);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "EMAIL_PASSWORD_SIGN_UP_DISABLED"
    );
    expect(rows("user").some((u) => u.email === email)).toBe(false);
  });

  it("allows registration as soon as it is switched on, then closes again", async () => {
    signup.enabled = true;
    const email = nextEmail();
    expect((await signUp(email)).status).toBe(200);
    expect(rows("user").some((u) => u.email === email)).toBe(true);

    signup.enabled = false;
    const blocked = nextEmail();
    expect((await signUp(blocked)).status).toBe(400);
    expect(rows("user").some((u) => u.email === blocked)).toBe(false);
  });
});
