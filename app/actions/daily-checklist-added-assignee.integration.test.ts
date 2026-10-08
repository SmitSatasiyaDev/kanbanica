// Real-Postgres integration tests: a newly added Team Checklist assignee gets today's
// checklist immediately. Same setup/gating as daily-checklist.integration.test.ts
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
const id = (n: string) => `cla-${rid}-${n}`;
const U = {
  admin: id("admin"),
  a: id("a"),
  b: id("b"),
  dev: id("dev"),
  nz: id("nz"),
  guest: id("guest"),
};
const W = id("ws");

let m: any;
let adm: any;
let S: any;
let dbm: any;
const as = (u: string | null) => {
  current.userId = u;
};
const at = (iso: string) => vi.setSystemTime(new Date(iso));

run("Checklist — newly added assignee (real DB)", () => {
  const created: string[] = [];

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-10-07T10:00:00Z");
    dbm = await import("@/lib/db");
    S = await import("@/db/schema");
    m = await import("@/app/actions/daily-checklist");
    adm = await import("@/app/actions/daily-checklist-admin");
    const { db } = dbm;
    await db.insert(S.user).values(
      Object.values(U).map((uid) => ({
        id: uid,
        email: `${uid}@test.local`,
        name: `name-${uid}`,
      }))
    );
    await db.insert(S.workspace).values({
      id: W,
      name: "CLA ws",
      slug: `cla-${rid}`,
      createdBy: U.admin,
    });
    const mem = (uid: string, role: string) => ({
      id: id(`m-${uid}`),
      workspaceId: W,
      userId: uid,
      role,
      status: "ACTIVE",
    });
    await db
      .insert(S.workspaceMember)
      .values([
        mem(U.admin, "ADMIN"),
        mem(U.a, "MEMBER"),
        mem(U.b, "MEMBER"),
        mem(U.dev, "MEMBER"),
        mem(U.nz, "MEMBER"),
        mem(U.guest, "GUEST"),
      ]);
    await db
      .update(S.user)
      .set({ timezone: "Pacific/Auckland" })
      .where(eq(S.user.id, U.nz));
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

  const input = (over: Record<string, unknown> = {}) => ({
    name: "Support",
    recurrence: "DAILY",
    startDate: "2026-10-01",
    items: [{ title: "Ticket" }, { title: "Inbox" }],
    assigneeIds: [U.a, U.b],
    fields: [{ name: "Notes", type: "TEXT" }],
    ...over,
  });
  const make = async (over: Record<string, unknown> = {}) => {
    as(U.admin);
    const r = await adm.createChecklistTemplate(W, input(over));
    expect(r.id).toBeDefined();
    created.push(r.id);
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
  const items = (dayId: string) =>
    dbm.db
      .select()
      .from(S.dailyChecklistItem)
      .where(eq(S.dailyChecklistItem.dayId, dayId));
  const tplOf = async (tpl: string) =>
    (await adm.listChecklistTemplates(W)).templates.find(
      (t: { id: string }) => t.id === tpl
    );
  const addAssignee = async (tpl: string, ...uids: string[]) => {
    const t = await tplOf(tpl);
    as(U.admin);
    const r = await adm.updateTemplateAssignments(W, tpl, [
      ...t.assignees.map((x: { userId: string }) => x.userId),
      ...uids,
    ]);
    expect(r.error).toBeUndefined();
  };

  it("A/B: creating generates for assignees; adding Dev creates only Dev's day; others untouched", async () => {
    const tpl = await make();
    // create path already generated A and B for today
    const [dayA] = await days(tpl, U.a);
    expect(dayA.date).toBe("2026-10-07");
    const itemsA = await items(dayA.id);
    await dbm.db
      .update(S.dailyChecklistItem)
      .set({ status: "DONE", notes: "kept" })
      .where(eq(S.dailyChecklistItem.id, itemsA[0].id));

    expect(await days(tpl, U.dev)).toHaveLength(0);
    await addAssignee(tpl, U.dev);

    const [dayDev] = await days(tpl, U.dev);
    expect(dayDev.date).toBe("2026-10-07");
    expect(await items(dayDev.id)).toHaveLength(2);

    const afterA = await days(tpl, U.a);
    expect(afterA).toHaveLength(1);
    expect(afterA[0].id).toBe(dayA.id);
    const itemsA2 = await items(dayA.id);
    expect(itemsA2.map((i: any) => i.id).sort()).toEqual(
      itemsA.map((i: any) => i.id).sort()
    );
    const done = itemsA2.find((i: any) => i.id === itemsA[0].id);
    expect(done.status).toBe("DONE");
    expect(done.notes).toBe("kept");
  });

  it("is idempotent: re-saving / re-adding yields one day and one item set", async () => {
    const tpl = await make({ assigneeIds: [U.a] });
    await addAssignee(tpl, U.dev);
    await addAssignee(tpl, U.dev);
    as(U.admin);
    await adm.updateTemplateAssignments(W, tpl, [U.a, U.dev]);
    const ds = await days(tpl, U.dev);
    expect(ds).toHaveLength(1);
    expect(await items(ds[0].id)).toHaveLength(2);
  });

  it("creates nothing when the template does not occur today", async () => {
    // 2026-10-07 is a Wednesday; recurrenceDays 0=Sun → pick Friday (5)
    const tpl = await make({
      recurrence: "WEEKLY",
      recurrenceDays: [5],
      assigneeIds: [U.a],
    });
    await addAssignee(tpl, U.dev);
    expect(await days(tpl)).toHaveLength(0);
  });

  it("creates nothing for an inactive template", async () => {
    const tpl = await make({ assigneeIds: [] });
    as(U.admin);
    await adm.disableChecklistTemplate(W, tpl, false);
    await addAssignee(tpl, U.dev);
    expect(await days(tpl)).toHaveLength(0);
  });

  it("uses the added user's own local date", async () => {
    at("2026-10-07T20:00:00Z"); // Auckland is already 2026-10-08
    const tpl = await make({
      startDate: "2026-10-08",
      assigneeIds: [U.a],
    });
    await addAssignee(tpl, U.nz, U.dev);
    const nz = await days(tpl, U.nz);
    expect(nz).toHaveLength(1);
    expect(nz[0].date).toBe("2026-10-08");
    expect(await days(tpl, U.dev)).toHaveLength(0); // still 10-07 in UTC
    at("2026-10-07T10:00:00Z");
  });

  it("snapshots current items + fields for the new user; same-day existing users keep theirs", async () => {
    const tpl = await make({ assigneeIds: [U.a] });
    const t = await tplOf(tpl);
    as(U.admin);
    const r = await adm.updateChecklistTemplate(W, tpl, {
      ...input(),
      items: [
        ...t.items.map((i: any) => ({ id: i.id, title: i.title })),
        { title: "New item" },
      ],
      fields: [
        { name: "Notes", type: "TEXT" },
        { name: "Extra", type: "NUMBER" },
      ],
      assigneeIds: [U.a, U.dev],
    });
    expect(r.error).toBeUndefined();
    const [dayDev] = await days(tpl, U.dev);
    const dItems = await items(dayDev.id);
    expect(dItems.map((i: any) => i.title).sort()).toEqual([
      "Inbox",
      "New item",
      "Ticket",
    ]);
    const vals = await dbm.db
      .select()
      .from(S.dailyChecklistItemFieldValue)
      .where(
        inArray(
          S.dailyChecklistItemFieldValue.itemId,
          dItems.map((i: any) => i.id)
        )
      );
    expect(new Set(vals.map((v: any) => v.fieldName))).toEqual(
      new Set(["Notes", "Extra"])
    );
    expect(vals.every((v: any) => v.value === null || v.value === "")).toBe(
      true
    );
    const [dayA] = await days(tpl, U.a);
    expect(await items(dayA.id)).toHaveLength(2); // old snapshot
  });

  it("removing an assignee keeps today's day and stops future generation", async () => {
    const tpl = await make({ assigneeIds: [U.a, U.b] });
    as(U.admin);
    await adm.updateTemplateAssignments(W, tpl, [U.a]);
    expect(await days(tpl, U.b)).toHaveLength(1);
    at("2026-10-08T10:00:00Z");
    as(U.a);
    await m.getMyTeamChecklist(W);
    as(U.b);
    await m.getMyTeamChecklist(W);
    expect(await days(tpl, U.b)).toHaveLength(1);
    expect(await days(tpl, U.a)).toHaveLength(2);
    at("2026-10-07T10:00:00Z");
  });

  it("concurrent assignment save + on-demand generation produces no duplicates", async () => {
    const tpl = await make({ assigneeIds: [U.a] });
    as(U.admin);
    const ens = await import("@/lib/daily-checklist/ensure");
    await Promise.all([
      adm.updateTemplateAssignments(W, tpl, [U.a, U.dev]),
      ens.ensureTeamDays(dbm.db, U.dev, "2026-10-07", W),
      ens.ensureTeamDays(dbm.db, U.dev, "2026-10-07", W),
    ]);
    const ds = await days(tpl, U.dev);
    expect(ds).toHaveLength(1);
    const its = await items(ds[0].id);
    expect(its).toHaveLength(2);
  });

  it("future generation still works for the added user", async () => {
    const tpl = await make({ assigneeIds: [U.a] });
    await addAssignee(tpl, U.dev);
    at("2026-10-09T10:00:00Z");
    as(U.dev);
    await m.getMyTeamChecklist(W);
    expect(await days(tpl, U.dev)).toHaveLength(2);
    at("2026-10-07T10:00:00Z");
  });

  it("adding a user leaves existing users' status, notes and field values untouched", async () => {
    const tpl = await make({ assigneeIds: [U.a, U.b] });
    const [dayA] = await days(tpl, U.a);
    const [itemA] = await items(dayA.id);
    await dbm.db
      .update(S.dailyChecklistItem)
      .set({ status: "DONE", notes: "n" })
      .where(eq(S.dailyChecklistItem.id, itemA.id));
    await dbm.db
      .update(S.dailyChecklistItemFieldValue)
      .set({ value: "typed" })
      .where(eq(S.dailyChecklistItemFieldValue.itemId, itemA.id));
    const snap = async (dayId: string) => ({
      items: await items(dayId),
      vals: await dbm.db
        .select()
        .from(S.dailyChecklistItemFieldValue)
        .where(
          inArray(
            S.dailyChecklistItemFieldValue.itemId,
            (await items(dayId)).map((i: any) => i.id)
          )
        ),
    });
    const [dayB] = await days(tpl, U.b);
    const beforeA = await snap(dayA.id);
    const beforeB = await snap(dayB.id);
    await addAssignee(tpl, U.dev);
    expect(await snap(dayA.id)).toEqual(beforeA);
    expect(await snap(dayB.id)).toEqual(beforeB);
    // Dev gets blank values, never a copy of A's.
    const [dayDev] = await days(tpl, U.dev);
    const devVals = (await snap(dayDev.id)).vals;
    expect(devVals.length).toBeGreaterThan(0);
    expect(devVals.every((v: any) => !v.value)).toBe(true);
  });

  it("creates nothing outside the template's start/end dates", async () => {
    const notStarted = await make({
      startDate: "2026-10-09",
      assigneeIds: [U.a],
    });
    await addAssignee(notStarted, U.dev);
    expect(await days(notStarted, U.dev)).toHaveLength(0);
    const ended = await make({
      startDate: "2026-10-01",
      endDate: "2026-10-06",
      assigneeIds: [U.a],
    });
    await addAssignee(ended, U.dev);
    expect(await days(ended, U.dev)).toHaveLength(0);
  });

  it("assignment save racing the worker and on-demand generation yields one day and one item set", async () => {
    const gen = await import("@/lib/worker/handlers/daily-checklist-generate");
    const tpl = await make({ assigneeIds: [U.a] });
    as(U.admin);
    await Promise.all([
      adm.updateTemplateAssignments(W, tpl, [U.a, U.dev]),
      gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W }),
      m.getMyTeamChecklist(W), // same session user (admin) — on-demand path
    ]);
    await adm.updateTemplateAssignments(W, tpl, [U.a, U.dev]);
    const ds = await days(tpl, U.dev);
    expect(ds).toHaveLength(1);
    expect(await items(ds[0].id)).toHaveLength(2);
  });

  it("removal keeps earlier history and today's day; re-adding never duplicates", async () => {
    at("2026-10-06T10:00:00Z");
    const tpl = await make({ assigneeIds: [U.a, U.dev] });
    expect((await days(tpl, U.dev)).map((d: any) => d.date)).toEqual([
      "2026-10-06",
    ]);
    at("2026-10-07T10:00:00Z");
    as(U.dev);
    await m.getMyTeamChecklist(W); // Oct 7 generated
    as(U.admin);
    await adm.updateTemplateAssignments(W, tpl, [U.a]);
    at("2026-10-08T10:00:00Z");
    as(U.dev);
    await m.getMyTeamChecklist(W);
    expect((await days(tpl, U.dev)).map((d: any) => d.date).sort()).toEqual([
      "2026-10-06",
      "2026-10-07",
    ]);
    // re-add on Oct 8: creates Oct 8 once, earlier days untouched
    as(U.admin);
    await addAssignee(tpl, U.dev);
    await addAssignee(tpl, U.dev);
    expect((await days(tpl, U.dev)).map((d: any) => d.date).sort()).toEqual([
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
    at("2026-10-07T10:00:00Z");
  });

  it("never generates for guests", async () => {
    const tpl = await make({ assigneeIds: [U.a] });
    as(U.admin);
    const r = await adm.updateTemplateAssignments(W, tpl, [U.a, U.guest]);
    expect(r.error).toBeDefined();
    expect(await days(tpl, U.guest)).toHaveLength(0);
  });
});
