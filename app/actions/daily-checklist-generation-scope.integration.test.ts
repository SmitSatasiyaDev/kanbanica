// Real-Postgres integration tests: who generates what. Team Checklist generates only the
// VIEWER; admin Today's Checklists only reads; the worker and newly-added-assignee paths
// still generate. Same setup/gating as daily-checklist.integration.test.ts.
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
const id = (n: string) => `gs-${rid}-${n}`;
const U = {
  admin: id("admin"),
  a: id("a"),
  b: id("b"),
  dev: id("dev"),
  nz: id("nz"), // Pacific/Auckland
};
const W = id("ws");

let m: any;
let adm: any;
let S: any;
let dbm: any;
let gen: any;
const as = (u: string | null) => {
  current.userId = u;
};
const at = (iso: string) => vi.setSystemTime(new Date(iso));

run("Checklist — generation scope (real DB)", () => {
  let n = 0;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-10-07T10:00:00Z");
    dbm = await import("@/lib/db");
    S = await import("@/db/schema");
    m = await import("@/app/actions/daily-checklist");
    adm = await import("@/app/actions/daily-checklist-admin");
    gen = await import("@/lib/worker/handlers/daily-checklist-generate");
    const { db } = dbm;
    await db.insert(S.user).values(
      Object.values(U).map((uid) => ({
        id: uid,
        email: `${uid}@test.local`,
        name: `name-${uid}`,
        timezone: uid === U.nz ? "Pacific/Auckland" : null,
      }))
    );
    await db
      .insert(S.workspace)
      .values({ id: W, name: "GS ws", slug: `gs-${rid}`, createdBy: U.admin });
    await db.insert(S.workspaceMember).values(
      Object.values(U).map((uid) => ({
        id: id(`m-${uid}`),
        workspaceId: W,
        userId: uid,
        role: uid === U.admin ? "ADMIN" : "MEMBER",
        status: "ACTIVE",
      }))
    );
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (!dbm) {
      return;
    }
    await dbm.db.delete(S.workspace).where(eq(S.workspace.id, W));
    await dbm.db.delete(S.user).where(inArray(S.user.id, Object.values(U)));
    await dbm.dbClient.end();
  });

  /** A template + assignments written straight to the DB, so NOTHING is generated yet. */
  const seed = async (
    assignees: string[],
    over: Record<string, unknown> = {}
  ) => {
    n++;
    const tid = id(`t${n}`);
    await dbm.db.insert(S.dailyChecklistTemplate).values({
      id: tid,
      workspaceId: W,
      name: `T${n}`,
      type: "TEAM",
      recurrence: "DAILY",
      startDate: "2026-10-01",
      isActive: true,
      createdBy: U.admin,
      ...over,
    });
    await dbm.db.insert(S.dailyChecklistTemplateItem).values([
      { id: id(`i${n}a`), templateId: tid, title: "One", sortOrder: 0 },
      { id: id(`i${n}b`), templateId: tid, title: "Two", sortOrder: 1 },
    ]);
    await dbm.db.insert(S.dailyChecklistTemplateAssignment).values(
      assignees.map((userId) => ({
        id: id(`a${n}${userId}`),
        templateId: tid,
        userId,
      }))
    );
    return tid;
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
  const items = (dayId: string) =>
    dbm.db
      .select()
      .from(S.dailyChecklistItem)
      .where(eq(S.dailyChecklistItem.dayId, dayId));

  describe("one-time (ONCE) templates", () => {
    const START = "2026-10-08";
    const once = (assignees: string[], over: Record<string, unknown> = {}) =>
      seed(assignees, { recurrence: "ONCE", startDate: START, ...over });

    it("worker: nothing before, one day on, nothing after the start date; idempotent; history kept", async () => {
      const tpl = await once([U.a]);
      at("2026-10-07T10:00:00Z");
      await gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W });
      expect(await days(tpl)).toHaveLength(0);
      at("2026-10-08T10:00:00Z");
      for (let i = 0; i < 3; i++) {
        await gen.runDailyChecklistGenerate({
          now: new Date(),
          workspaceId: W,
        });
      }
      const gen1 = await days(tpl);
      expect(gen1).toHaveLength(1);
      expect(gen1[0].date).toBe(START);
      expect(await items(gen1[0].id)).toHaveLength(2);
      for (const d of ["2026-10-09T10:00:00Z", "2026-10-12T10:00:00Z"]) {
        at(d);
        await gen.runDailyChecklistGenerate({
          now: new Date(),
          workspaceId: W,
        });
      }
      expect((await days(tpl)).map((x: any) => x.date)).toEqual([START]);
      at("2026-10-07T10:00:00Z");
    });

    it("viewer on-demand: generates on the start date only, never backfills", async () => {
      const tpl = await once([U.a]);
      as(U.a);
      at("2026-10-07T10:00:00Z");
      await m.getMyTeamChecklist(W);
      expect(await days(tpl)).toHaveLength(0);
      at("2026-10-08T10:00:00Z");
      await m.getMyTeamChecklist(W);
      await m.getMyTeamChecklist(W);
      expect(await days(tpl)).toHaveLength(1);
      at("2026-10-09T10:00:00Z");
      await m.getMyTeamChecklist(W);
      expect(await days(tpl)).toHaveLength(1); // Oct 8 kept, nothing new
      at("2026-10-07T10:00:00Z");
    });

    it("new assignee: immediate on the start date, nothing before, no backfill after", async () => {
      as(U.admin);
      for (const [now, expected] of [
        ["2026-10-07T10:00:00Z", 0],
        ["2026-10-08T10:00:00Z", 1],
        ["2026-10-09T10:00:00Z", 0],
      ] as const) {
        const tpl = await once([U.a]);
        at(now);
        const r = await adm.updateTemplateAssignments(W, tpl, [U.a, U.dev]);
        expect(r.error).toBeUndefined();
        expect(await days(tpl, U.dev)).toHaveLength(expected);
      }
      at("2026-10-07T10:00:00Z");
    });

    it("a disabled one-time template generates nothing; generated history survives disabling", async () => {
      const off = await once([U.a], { isActive: false });
      const on = await once([U.a]);
      at("2026-10-08T10:00:00Z");
      await gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W });
      expect(await days(off)).toHaveLength(0);
      expect(await days(on)).toHaveLength(1);
      await dbm.db
        .update(S.dailyChecklistTemplate)
        .set({ isActive: false })
        .where(eq(S.dailyChecklistTemplate.id, on));
      expect(await days(on)).toHaveLength(1);
      at("2026-10-07T10:00:00Z");
    });

    it("the user's own timezone decides 'start date' (Auckland is already Oct 8)", async () => {
      const tpl = await once([U.nz]);
      at("2026-10-07T20:00:00Z"); // Oct 8 09:00 in Auckland
      await gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W });
      expect((await days(tpl, U.nz)).map((x: any) => x.date)).toEqual([START]);
      at("2026-10-07T10:00:00Z");
    });
  });

  it("Team Checklist generates only the viewer, even on repeated (realtime) refetches", async () => {
    const tpl = await seed([U.a, U.b]);
    as(U.a);
    for (let i = 0; i < 3; i++) {
      await m.getMyTeamChecklist(W); // open + two realtime-style refetches
    }
    expect(await days(tpl, U.a)).toHaveLength(1); // viewer: generated immediately
    expect(await days(tpl, U.b)).toHaveLength(0); // teammate: not swept
  });

  it("admin Today's Checklists is read-only (no sweep) but shows what exists", async () => {
    const tpl = await seed([U.a, U.b]);
    as(U.a);
    await m.getMyTeamChecklist(W);
    as(U.admin);
    const r = await adm.getTodaysChecklists(W);
    expect(r.error).toBeUndefined();
    expect(await days(tpl, U.b)).toHaveLength(0);
    const mine = r.rows.filter((x: any) => x.templateId === tpl);
    expect(mine.map((x: any) => x.userId)).toEqual([U.a]);
    expect(mine[0]).toMatchObject({ total: 2, completed: 0 });
  });

  it("the worker still generates every eligible assignee; page views then show them", async () => {
    const tpl = await seed([U.a, U.b]);
    const stats = await gen.runDailyChecklistGenerate({
      now: new Date(),
      workspaceId: W,
    });
    expect(stats.failed).toBe(0);
    expect(await days(tpl, U.a)).toHaveLength(1);
    expect(await days(tpl, U.b)).toHaveLength(1);
    // teammate's already-generated rows appear in the viewer's Team Checklist, untouched
    as(U.a);
    const res = await m.getMyTeamChecklist(W);
    const rows = res.rows.filter((r: any) => r.templateId === tpl);
    expect(new Set(rows.map((r: any) => r.assigneeId))).toEqual(
      new Set([U.a, U.b])
    );
    expect(rows).toHaveLength(4);
    as(U.admin);
    const adminRows = (await adm.getTodaysChecklists(W)).rows.filter(
      (x: any) => x.templateId === tpl
    );
    expect(adminRows.map((x: any) => x.userId).sort()).toEqual(
      [U.a, U.b].sort()
    );
  });

  it("a newly added assignee still gets today's checklist immediately; others untouched", async () => {
    const tpl = await seed([U.a, U.b]);
    await gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W });
    const [dayA] = await days(tpl, U.a);
    const itemsA = await items(dayA.id);
    as(U.admin);
    const r = await adm.updateTemplateAssignments(W, tpl, [U.a, U.b, U.dev]);
    expect(r.error).toBeUndefined();
    expect(await days(tpl, U.dev)).toHaveLength(1);
    expect((await days(tpl, U.a))[0].id).toBe(dayA.id);
    expect((await items(dayA.id)).map((i: any) => i.id).sort()).toEqual(
      itemsA.map((i: any) => i.id).sort()
    );
  });

  it("worker and viewer generation racing stay idempotent", async () => {
    const tpl = await seed([U.a, U.b]);
    as(U.a);
    await Promise.all([
      gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W }),
      m.getMyTeamChecklist(W),
      m.getMyTeamChecklist(W),
    ]);
    for (const uid of [U.a, U.b]) {
      const ds = await days(tpl, uid);
      expect(ds).toHaveLength(1);
      expect(await items(ds[0].id)).toHaveLength(2);
    }
  });

  it("still respects each user's own timezone, recurrence and date range", async () => {
    at("2026-10-07T20:00:00Z"); // Auckland already Oct 8; UTC users still Oct 7
    const tz = await seed([U.a, U.nz]);
    const future = await seed([U.a, U.nz], { startDate: "2026-10-08" });
    const ended = await seed([U.a, U.nz], { endDate: "2026-10-07" });
    await gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W });
    expect((await days(tz, U.a)).map((d: any) => d.date)).toEqual([
      "2026-10-07",
    ]);
    expect((await days(tz, U.nz)).map((d: any) => d.date)).toEqual([
      "2026-10-08",
    ]);
    expect(await days(future, U.a)).toHaveLength(0); // starts tomorrow for UTC
    expect((await days(future, U.nz)).map((d: any) => d.date)).toEqual([
      "2026-10-08",
    ]);
    expect((await days(ended, U.a)).map((d: any) => d.date)).toEqual([
      "2026-10-07",
    ]);
    expect(await days(ended, U.nz)).toHaveLength(0); // already past its end date there
    at("2026-10-07T10:00:00Z");
  });

  it("custom-field applicability is still honoured by viewer and worker generation", async () => {
    const tpl = await seed([U.a, U.b]);
    const fid = id("f1");
    await dbm.db.insert(S.dailyChecklistField).values({
      id: fid,
      templateId: tpl,
      name: "Only first",
      type: "TEXT",
      appliesToAll: false,
    });
    await dbm.db
      .insert(S.dailyChecklistFieldItem)
      .values({ fieldId: fid, templateItemId: id(`i${n}a`) });
    as(U.a);
    await m.getMyTeamChecklist(W);
    await gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W });
    for (const uid of [U.a, U.b]) {
      const [d] = await days(tpl, uid);
      const its = await items(d.id);
      const counts: Record<string, number> = {};
      for (const it of its) {
        const v = await dbm.db
          .select()
          .from(S.dailyChecklistItemFieldValue)
          .where(eq(S.dailyChecklistItemFieldValue.itemId, it.id));
        counts[it.title] = v.length;
      }
      expect(counts).toEqual({ One: 1, Two: 0 });
    }
  });

  it("personal checklist stays lazy: the worker never creates personal days", async () => {
    await gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W });
    const personal = () =>
      dbm.db
        .select()
        .from(S.dailyChecklistDay)
        .where(
          and(
            eq(S.dailyChecklistDay.workspaceId, W),
            eq(S.dailyChecklistDay.type, "PERSONAL")
          )
        );
    expect(await personal()).toHaveLength(0);
    as(U.b);
    expect((await m.getMyChecklist(W)).exists).toBe(true); // created on first open
    expect(await personal()).toHaveLength(1);
    await m.getMyChecklist(W); // repeat open → still one
    expect(await personal()).toHaveLength(1);
  });

  it("history is unchanged by later page opens", async () => {
    at("2026-10-06T10:00:00Z");
    const tpl = await seed([U.a]);
    as(U.a);
    await m.getMyTeamChecklist(W);
    const [old] = await days(tpl, U.a);
    const oldItems = await items(old.id);
    at("2026-10-07T10:00:00Z");
    await m.getMyTeamChecklist(W);
    await gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W });
    const all = await days(tpl, U.a);
    expect(all.map((d: any) => d.date).sort()).toEqual([
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(await items(old.id)).toEqual(oldItems);
  });
});
