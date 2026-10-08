// Real-Postgres integration tests: Daily Checklist timezone resolution
// (user → workspace → UTC). Same setup/gating as daily-checklist.integration.test.ts
// (CHECKLIST_TEST_DATABASE_URL points at a migrated scratch database).
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_URL = vi.hoisted(() => {
  const url = process.env.CHECKLIST_TEST_DATABASE_URL;
  if (url) {
    process.env.DATABASE_URL = url;
  }
  return url;
});
const current = vi.hoisted(() => ({ userId: "" as string | null }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        current.userId
          ? { user: { id: current.userId, name: `name-${current.userId}` } }
          : null,
    },
  },
}));
vi.mock("@/lib/realtime/refresh", () => ({
  refreshWorkspace: vi.fn(async () => undefined),
}));

const run = describe.skipIf(!TEST_URL);
const rid = Math.random().toString(36).slice(2, 8);
const id = (n: string) => `tz-${rid}-${n}`;
const U = {
  admin: id("admin"),
  smit: id("smit"), // Asia/Kolkata
  john: id("john"), // America/New_York
  fallback: id("fallback"), // no personal tz
  lone: id("lone"), // no personal tz, member of a workspace without tz
};
const W = id("ws"); // America/New_York
const W2 = id("ws2"); // no timezone

let m: any;
let adm: any;
let S: any;
let dbm: any;
let q: any;
let ens: any;
let gen: any;
const as = (u: string | null) => {
  current.userId = u;
};
const at = (iso: string) => vi.setSystemTime(new Date(iso));

run("Checklist — timezone resolution (real DB)", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-10-07T10:00:00Z");
    dbm = await import("@/lib/db");
    S = await import("@/db/schema");
    m = await import("@/app/actions/daily-checklist");
    adm = await import("@/app/actions/daily-checklist-admin");
    q = await import("@/lib/daily-checklist/queries");
    ens = await import("@/lib/daily-checklist/ensure");
    gen = await import("@/lib/worker/handlers/daily-checklist-generate");
    const { db } = dbm;
    await db.insert(S.user).values(
      Object.values(U).map((uid) => ({
        id: uid,
        email: `${uid}@test.local`,
        name: `name-${uid}`,
        timezone:
          uid === U.smit
            ? "Asia/Kolkata"
            : uid === U.john
              ? "America/New_York"
              : null,
      }))
    );
    await db.insert(S.workspace).values([
      {
        id: W,
        name: "TZ ws",
        slug: `tz-${rid}`,
        createdBy: U.admin,
        timezone: "America/New_York",
      },
      { id: W2, name: "TZ ws2", slug: `tz2-${rid}`, createdBy: U.admin },
    ]);
    const mem = (ws: string, uid: string, role: string) => ({
      id: id(`m-${ws}-${uid}`),
      workspaceId: ws,
      userId: uid,
      role,
      status: "ACTIVE",
    });
    await db
      .insert(S.workspaceMember)
      .values([
        mem(W, U.admin, "ADMIN"),
        mem(W, U.smit, "MEMBER"),
        mem(W, U.john, "MEMBER"),
        mem(W, U.fallback, "MEMBER"),
        mem(W2, U.admin, "ADMIN"),
        mem(W2, U.lone, "MEMBER"),
      ]);
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (!dbm) {
      return;
    }
    await dbm.db.delete(S.workspace).where(inArray(S.workspace.id, [W, W2]));
    await dbm.db.delete(S.user).where(inArray(S.user.id, Object.values(U)));
    await dbm.dbClient.end();
  });

  const make = async (ws: string, over: Record<string, unknown> = {}) => {
    as(U.admin);
    const r = await adm.createChecklistTemplate(ws, {
      name: "TZ",
      recurrence: "DAILY",
      startDate: "2026-10-01",
      items: [{ title: "One" }],
      assigneeIds: [U.smit, U.john, U.fallback],
      ...over,
    });
    expect(r.id).toBeDefined();
    return r.id as string;
  };
  const days = (tpl: string, uid?: string) =>
    dbm.db
      .select()
      .from(S.dailyChecklistDay)
      .where(
        uid
          ? and(
              eq(S.dailyChecklistDay.templateId, tpl),
              eq(S.dailyChecklistDay.userId, uid)
            )
          : eq(S.dailyChecklistDay.templateId, tpl)
      );
  const dates = async (tpl: string, uid: string) =>
    (await days(tpl, uid)).map((d: any) => d.date).sort();
  const setTz = (uid: string, timezone: string | null) =>
    dbm.db.update(S.user).set({ timezone }).where(eq(S.user.id, uid));

  it("resolves user → workspace → UTC", async () => {
    expect((await q.userToday(dbm.db, U.smit, W)).timezone).toBe(
      "Asia/Kolkata"
    );
    expect((await q.userToday(dbm.db, U.fallback, W)).timezone).toBe(
      "America/New_York"
    );
    expect((await q.userToday(dbm.db, U.lone, W2)).timezone).toBe("UTC");
  });

  it("ignores the notification digest timezone", async () => {
    await dbm.db.insert(S.userEmailPreference).values({
      id: id("pref"),
      userId: U.lone,
      digestTimezone: "Pacific/Auckland",
    });
    expect((await q.userToday(dbm.db, U.lone, W2)).timezone).toBe("UTC");
    await dbm.db
      .delete(S.userEmailPreference)
      .where(eq(S.userEmailPreference.userId, U.lone));
  });

  it("gives each user in one workspace their own local date", async () => {
    at("2026-10-07T23:30:00Z"); // Kolkata Oct 8, New York (EDT) Oct 7
    as(U.smit);
    expect((await m.getMyChecklist(W)).today).toBe("2026-10-08");
    as(U.john);
    expect((await m.getMyChecklist(W)).today).toBe("2026-10-07");
    as(U.fallback);
    expect((await m.getMyChecklist(W)).today).toBe("2026-10-07");
  });

  it("worker and on-demand generation agree and never duplicate", async () => {
    at("2026-10-07T23:30:00Z");
    const tpl = await make(W); // created → generateForAdded (on-demand path)
    expect(await dates(tpl, U.smit)).toEqual(["2026-10-08"]);
    expect(await dates(tpl, U.john)).toEqual(["2026-10-07"]);
    expect(await dates(tpl, U.fallback)).toEqual(["2026-10-07"]);

    const stats = await gen.runDailyChecklistGenerate({
      now: new Date(),
      workspaceId: W,
    });
    expect(stats.failed).toBe(0);
    as(U.smit);
    await m.getMyTeamChecklist(W); // on-demand again
    expect(await dates(tpl, U.smit)).toEqual(["2026-10-08"]);
    expect(await dates(tpl, U.john)).toEqual(["2026-10-07"]);
    expect(await dates(tpl, U.fallback)).toEqual(["2026-10-07"]);
  });

  it("evaluates template end date in the user's timezone", async () => {
    at("2026-10-07T23:30:00Z");
    const tpl = await make(W, { endDate: "2026-10-07" });
    expect(await dates(tpl, U.smit)).toEqual([]); // already Oct 8 there
    expect(await dates(tpl, U.john)).toEqual(["2026-10-07"]);
  });

  it("evaluates recurrence in the user's timezone (weekdays)", async () => {
    at("2026-10-09T23:30:00Z"); // Fri in New York, already Sat in Kolkata
    const tpl = await make(W, { recurrence: "WEEKDAYS" });
    expect(await dates(tpl, U.smit)).toEqual([]);
    expect(await dates(tpl, U.john)).toEqual(["2026-10-09"]);
  });

  it("evaluates weekly and custom recurrence in the user's timezone", async () => {
    at("2026-10-09T23:30:00Z"); // Fri(5) in NY, Sat(6) in Kolkata
    const weekly = await make(W, {
      recurrence: "WEEKLY",
      recurrenceDays: [6],
    });
    expect(await dates(weekly, U.smit)).toEqual(["2026-10-10"]);
    expect(await dates(weekly, U.john)).toEqual([]);
    const custom = await make(W, {
      recurrence: "CUSTOM",
      recurrenceDays: [5],
    });
    expect(await dates(custom, U.smit)).toEqual([]);
    expect(await dates(custom, U.john)).toEqual(["2026-10-09"]);
  });

  it("changing timezone keeps history and cannot duplicate days", async () => {
    at("2026-10-07T23:30:00Z");
    const tpl = await make(W);
    expect(await dates(tpl, U.john)).toEqual(["2026-10-07"]);
    const before = await days(tpl, U.john);

    await setTz(U.john, "Asia/Kolkata"); // now Oct 8 locally
    as(U.john);
    await m.getMyTeamChecklist(W);
    await gen.runDailyChecklistGenerate({
      now: new Date(),
      workspaceId: W,
    });
    // Oct 7 is untouched; Oct 8 is a *new* local day, created exactly once.
    expect(await dates(tpl, U.john)).toEqual(["2026-10-07", "2026-10-08"]);
    const kept = (await days(tpl, U.john)).find(
      (d: any) => d.date === "2026-10-07"
    );
    expect(kept.id).toBe(before[0].id);

    // Switching back and re-running creates nothing more.
    await setTz(U.john, "America/New_York");
    await m.getMyTeamChecklist(W);
    await gen.runDailyChecklistGenerate({
      now: new Date(),
      workspaceId: W,
    });
    await ens.ensureTeamDays(dbm.db, U.john, "2026-10-07", W);
    expect(await dates(tpl, U.john)).toEqual(["2026-10-07", "2026-10-08"]);
  });

  it("team rows carry each assignee's effective timezone (for the overdue display)", async () => {
    at("2026-10-07T10:00:00Z");
    const tpl = await make(W);
    as(U.admin);
    const res = await m.getMyTeamChecklist(W);
    const tzOf = (uid: string) =>
      res.rows.find((r: any) => r.assigneeId === uid)?.assigneeTimezone;
    expect(tzOf(U.smit)).toBe("Asia/Kolkata");
    expect(tzOf(U.john)).toBe("America/New_York");
    expect(tzOf(U.fallback)).toBe("America/New_York"); // workspace fallback
    expect(res.rows.every((r: any) => typeof r.date === "string")).toBe(true);
    void tpl;
  });

  it("falls back to UTC when neither user nor workspace has a timezone", async () => {
    at("2026-10-07T23:30:00Z");
    as(U.admin);
    const r = await adm.createChecklistTemplate(W2, {
      name: "TZ2",
      recurrence: "DAILY",
      startDate: "2026-10-01",
      items: [{ title: "One" }],
      assigneeIds: [U.lone],
    });
    expect(await dates(r.id, U.lone)).toEqual(["2026-10-07"]);
  });
});
