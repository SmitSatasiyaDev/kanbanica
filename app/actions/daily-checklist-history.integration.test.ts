// Real-Postgres integration tests: Admin → Checklist → History report (filters, summary,
// pagination, permissions). Same setup/gating as daily-checklist-admin-history.integration.test.ts
// (CHECKLIST_TEST_DATABASE_URL points at a migrated scratch database).
import { eq, inArray } from "drizzle-orm";
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
const id = (n: string) => `hr-${rid}-${n}`;
const U = {
  admin: id("admin"),
  member: id("member"),
  u2: id("u2"),
  u3: id("u3"),
  other: id("other"),
};
const W = id("ws");
const W2 = id("ws2");
const T = { a: id("tA"), b: id("tB"), other: id("tO") };

let rep: any;
let adm: any;
let S: any;
let dbm: any;
let today = "";
let addDays: (d: string, n: number) => string;
const as = (u: string | null) => {
  current.userId = u;
};
const off = (n: number) => addDays(today, n);

run("Checklist — admin history report (real DB)", () => {
  let n = 0;
  const day = async (o: {
    date: string;
    notes?: (string | null)[];
    statuses: ("DONE" | "PENDING" | "IN_PROGRESS")[];
    template: string;
    user: string;
    ws?: string;
  }) => {
    const dayId = id(`d${++n}`);
    await dbm.db.insert(S.dailyChecklistDay).values({
      id: dayId,
      workspaceId: o.ws ?? W,
      userId: o.user,
      templateId: o.template,
      date: o.date,
      type: "TEAM",
    });
    await dbm.db.insert(S.dailyChecklistItem).values(
      o.statuses.map((status, i) => ({
        id: `${dayId}-${i}`,
        dayId,
        title: `item ${i}`,
        status,
        notes: o.notes?.[i] ?? null,
        sortOrder: i,
      }))
    );
    return dayId;
  };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    dbm = await import("@/lib/db");
    S = await import("@/db/schema");
    rep = await import("@/app/actions/daily-checklist-history");
    adm = await import("@/app/actions/daily-checklist");
    ({ addDays } = await import("@/lib/daily-checklist/history-report"));
    const { db } = dbm;
    await db.insert(S.user).values(
      Object.entries(U).map(([k, uid]) => ({
        id: uid,
        email: `${uid}@test.local`,
        name: k === "member" ? "Smit Satasiya" : `name-${k}`,
      }))
    );
    await db.insert(S.workspace).values([
      { id: W, name: "HR ws", slug: `hr-${rid}`, createdBy: U.admin },
      { id: W2, name: "HR ws2", slug: `hr2-${rid}`, createdBy: U.other },
    ]);
    await db.insert(S.workspaceMember).values(
      [
        [U.admin, W, "ADMIN"],
        [U.member, W, "MEMBER"],
        [U.u2, W, "MEMBER"],
        [U.u3, W, "MEMBER"],
        [U.other, W2, "ADMIN"],
        [U.admin, W2, "MEMBER"],
      ].map(([u, w, role], i) => ({
        id: id(`wm${i}`),
        workspaceId: w,
        userId: u,
        role,
        status: "ACTIVE",
      }))
    );
    await db.insert(S.dailyChecklistTemplate).values(
      [
        [T.a, W, "Development - Daily"],
        [T.b, W, "Design - Daily"],
        [T.other, W2, "Foreign"],
      ].map(([tid, w, name]) => ({
        id: tid,
        workspaceId: w,
        name,
        type: "TEAM",
        recurrence: "DAILY",
        startDate: "2020-01-01",
        createdBy: U.admin,
      }))
    );
    as(U.admin);
    today = (await rep.getChecklistHistoryReport(W)).today;

    ids.d1 = await day({
      date: off(-3),
      user: U.member,
      template: T.a,
      statuses: ["DONE", "DONE", "DONE"],
      notes: [null, "  Good progress  ", "second note"],
    });
    ids.d2 = await day({
      date: off(-3),
      user: U.u2,
      template: T.a,
      statuses: ["DONE", "PENDING", "PENDING"],
      notes: ["   ", null, null],
    });
    ids.d3 = await day({
      date: off(-2),
      user: U.member,
      template: T.b,
      statuses: ["PENDING", "PENDING"],
    });
    ids.d4 = await day({
      date: today,
      user: U.u2,
      template: T.b,
      statuses: ["IN_PROGRESS", "PENDING"],
    });
    ids.d5 = await day({
      date: off(-40),
      user: U.member,
      template: T.a,
      statuses: ["DONE"],
    });
    ids.d6 = await day({
      date: off(-3),
      user: U.other,
      template: T.other,
      ws: W2,
      statuses: ["DONE"],
    });
    ids.d7 = await day({
      date: today,
      user: U.member,
      template: T.a,
      statuses: ["PENDING", "PENDING"],
    });
  });

  afterAll(async () => {
    if (!dbm) {
      return;
    }
    await dbm.db.delete(S.workspace).where(inArray(S.workspace.id, [W, W2]));
    await dbm.db.delete(S.user).where(inArray(S.user.id, Object.values(U)));
    await dbm.dbClient.end();
  });

  const dayIds = (r: any) => r.rows.map((x: any) => x.dayId);
  const set = (...k: string[]) => k.map((x) => ids[x]).sort();
  const sorted = (r: any) => dayIds(r).sort();

  it("default listing: last 30 days, newest first, summary-only rows", async () => {
    as(U.admin);
    const r = await rep.getChecklistHistoryReport(W);
    expect(r.error).toBeUndefined();
    expect(r.filters).toEqual({ from: off(-29), to: today });
    expect(r.total).toBe(5); // d5 (-40d) and the other workspace's d6 are out
    expect(sorted(r)).toEqual(set("d1", "d2", "d3", "d4", "d7"));
    const dates = r.rows.map((x: any) => x.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(r.page).toBe(1);
    expect(r.pageCount).toBe(1);
    expect(r.pageSize).toBe(20);
    // summary-only: no items on a row
    expect(r.rows[0].items).toBeUndefined();
  });

  it("row fields: completed/total, status, overdue, user, template, date", async () => {
    as(U.admin);
    const r = await rep.getChecklistHistoryReport(W);
    const by = (k: string) => r.rows.find((x: any) => x.dayId === ids[k]);
    expect(by("d1")).toMatchObject({
      completed: 3,
      total: 3,
      status: "COMPLETE",
      overdue: false,
      userName: "Smit Satasiya",
      userId: U.member,
      templateName: "Development - Daily",
      templateId: T.a,
      date: off(-3),
    });
    expect(by("d2")).toMatchObject({
      completed: 1,
      total: 3,
      status: "IN_PROGRESS",
      overdue: true,
    });
    expect(by("d3")).toMatchObject({ status: "NOT_STARTED", overdue: true });
    // today's unfinished lists are never overdue
    expect(by("d4")).toMatchObject({ status: "IN_PROGRESS", overdue: false });
    expect(by("d7")).toMatchObject({ status: "NOT_STARTED", overdue: false });
  });

  it("summary cards come from the whole filtered result", async () => {
    as(U.admin);
    const r = await rep.getChecklistHistoryReport(W);
    expect(r.summary).toEqual({
      completed: 1,
      inProgress: 2, // d2, d4
      notStarted: 2, // d3, d7
      members: 2, // member (d1/d3/d7) and u2 (d2/d4)
    });
  });

  it("date range filter (inclusive) and out-of-range history", async () => {
    as(U.admin);
    const one = await rep.getChecklistHistoryReport(W, {
      from: off(-3),
      to: off(-3),
    });
    expect(sorted(one)).toEqual(set("d1", "d2"));
    const old = await rep.getChecklistHistoryReport(W, {
      from: off(-45),
      to: off(-35),
    });
    expect(sorted(old)).toEqual(set("d5"));
    const swapped = await rep.getChecklistHistoryReport(W, {
      from: off(-2),
      to: off(-3),
    });
    expect(swapped.filters).toMatchObject({ from: off(-3), to: off(-2) });
    expect(swapped.total).toBe(3);
  });

  it("user, template and status filters", async () => {
    as(U.admin);
    const byUser = await rep.getChecklistHistoryReport(W, { userId: U.member });
    expect(sorted(byUser)).toEqual(set("d1", "d3", "d7"));
    expect(byUser.summary.members).toBe(1); // cards follow the filter
    const byTpl = await rep.getChecklistHistoryReport(W, { templateId: T.b });
    expect(sorted(byTpl)).toEqual(set("d3", "d4"));
    const q = async (status: string) =>
      sorted(await rep.getChecklistHistoryReport(W, { status }));
    expect(await q("COMPLETED")).toEqual(set("d1"));
    expect(await q("IN_PROGRESS")).toEqual(set("d2", "d4"));
    expect(await q("NOT_STARTED")).toEqual(set("d3", "d7"));
  });

  it("combined filters (+ summary recalculates)", async () => {
    as(U.admin);
    const r = await rep.getChecklistHistoryReport(W, {
      userId: U.member,
      templateId: T.b,
      status: "NOT_STARTED",
      from: off(-5),
      to: today,
    });
    expect(sorted(r)).toEqual(set("d3"));
    expect(r.summary).toEqual({
      completed: 0,
      inProgress: 0,
      notStarted: 1,
      members: 1,
    });
  });

  it("summary cards ignore the status filter (context counts) while rows/total follow it", async () => {
    as(U.admin);
    const all = await rep.getChecklistHistoryReport(W);
    for (const status of ["COMPLETED", "IN_PROGRESS", "NOT_STARTED"]) {
      const r = await rep.getChecklistHistoryReport(W, { status });
      expect(r.summary).toEqual(all.summary);
    }
    const c = await rep.getChecklistHistoryReport(W, { status: "COMPLETED" });
    expect(c.total).toBe(c.summary.completed);
    const i = await rep.getChecklistHistoryReport(W, { status: "IN_PROGRESS" });
    expect(i.total).toBe(i.summary.inProgress);
    const o = await rep.getChecklistHistoryReport(W, { status: "NOT_STARTED" });
    expect(o.total).toBe(o.summary.notStarted);
    // cumulative with user + date
    const m = await rep.getChecklistHistoryReport(W, {
      status: "COMPLETED",
      userId: U.member,
      from: off(-3),
      to: off(-2),
    });
    expect(sorted(m)).toEqual(set("d1"));
    expect(m.summary.completed).toBe(1);
  });

  it("notes: first non-empty item note, trimmed; blank → null", async () => {
    as(U.admin);
    const r = await rep.getChecklistHistoryReport(W);
    const note = (k: string) =>
      r.rows.find((x: any) => x.dayId === ids[k]).note;
    expect(note("d1")).toBe("Good progress");
    expect(note("d2")).toBeNull();
    expect(note("d3")).toBeNull();
  });

  it("pagination: 20 per page, whole result, no gaps/duplicates, clamped", async () => {
    await dbm.db.insert(S.dailyChecklistDay).values(
      Array.from({ length: 45 }, (_, i) => ({
        id: id(`p${i}`),
        workspaceId: W,
        userId: U.u3,
        templateId: T.a,
        date: off(-60 - i),
        type: "TEAM",
      }))
    );
    as(U.admin);
    const f = { userId: U.u3, from: off(-120), to: today };
    const p1 = await rep.getChecklistHistoryReport(W, { ...f, page: 1 });
    const p2 = await rep.getChecklistHistoryReport(W, { ...f, page: 2 });
    const p3 = await rep.getChecklistHistoryReport(W, { ...f, page: 3 });
    expect([p1.rows.length, p2.rows.length, p3.rows.length]).toEqual([
      20, 20, 5,
    ]);
    expect(p1.total).toBe(45);
    expect(p1.pageCount).toBe(3);
    const all = [...p1.rows, ...p2.rows, ...p3.rows].map((x: any) => x.dayId);
    expect(new Set(all).size).toBe(45);
    const dates = all.map(
      (d: string) =>
        [...p1.rows, ...p2.rows, ...p3.rows].find((x: any) => x.dayId === d)
          .date
    );
    expect(dates).toEqual([...dates].sort().reverse());
    const far = await rep.getChecklistHistoryReport(W, { ...f, page: 99 });
    expect(far.page).toBe(3);
    expect(far.rows).toHaveLength(5);
    // empty-item days are listed, never counted as completed / overdue
    expect(p1.summary).toMatchObject({ completed: 0, notStarted: 0 });
  });

  it("empty result", async () => {
    as(U.admin);
    const r = await rep.getChecklistHistoryReport(W, {
      from: off(-200),
      to: off(-190),
    });
    expect(r.total).toBe(0);
    expect(r.rows).toEqual([]);
    expect(r.summary).toEqual({
      completed: 0,
      inProgress: 0,
      notStarted: 0,
      members: 0,
    });
  });

  it("permissions: members / guests / signed-out are refused", async () => {
    as(U.member);
    expect((await rep.getChecklistHistoryReport(W)).error).toBe("Forbidden");
    expect((await rep.exportChecklistHistoryCsv(W)).error).toBe("Forbidden");
    as(null);
    expect((await rep.getChecklistHistoryReport(W)).error).toBeTruthy();
  });

  it("cross-workspace: nothing leaks, foreign ids match nothing", async () => {
    as(U.admin); // ADMIN of W, plain MEMBER of W2
    expect((await rep.getChecklistHistoryReport(W2)).error).toBe("Forbidden");
    const r = await rep.getChecklistHistoryReport(W);
    expect(dayIds(r)).not.toContain(ids.d6);
    const foreignTpl = await rep.getChecklistHistoryReport(W, {
      templateId: T.other,
    });
    expect(foreignTpl.total).toBe(0);
    const foreignUser = await rep.getChecklistHistoryReport(W, {
      userId: U.other,
    });
    expect(foreignUser.total).toBe(0);
    expect(r.members.map((m: any) => m.id)).not.toContain(U.other);
    expect(r.templates.map((t: any) => t.id)).not.toContain(T.other);
  });

  it("validates dates and caps the range", async () => {
    as(U.admin);
    expect(
      (await rep.getChecklistHistoryReport(W, { from: "10/07/2026" })).error
    ).toBe("Invalid date");
    expect(
      (
        await rep.getChecklistHistoryReport(W, {
          from: addDays(today, -400),
          to: today,
        })
      ).error
    ).toBe("Date range is too long");
  });

  it("View target: the row's ids open exactly that saved day (existing read-only detail)", async () => {
    as(U.admin);
    const r = await rep.getChecklistHistoryReport(W, {
      userId: U.member,
      templateId: T.a,
      from: off(-3),
      to: off(-3),
    });
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row).toMatchObject({
      dayId: ids.d1,
      date: off(-3),
      userId: U.member,
      templateId: T.a,
    });
    const detail = (await adm.getChecklistDays(W, [row.dayId]))[row.dayId];
    expect(detail).toMatchObject({
      date: off(-3),
      userName: "Smit Satasiya",
      templateName: "Development - Daily",
      editable: false,
    });
    expect(detail.items).toHaveLength(3);
  });

  it("export: same filters, CSV header + rows, formula cells neutralised", async () => {
    await dbm.db
      .update(S.dailyChecklistItem)
      .set({ notes: "=HYPERLINK(1)" })
      .where(eq(S.dailyChecklistItem.id, `${ids.d3}-0`));
    as(U.admin);
    const r = await rep.exportChecklistHistoryCsv(W, { status: "NOT_STARTED" });
    expect(r.truncated).toBe(false);
    expect(r.filename).toBe(`checklist-history-${off(-29)}_${today}.csv`);
    const lines = r.csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      "Date,User,Template,Completed,Total,Status,Overdue,Notes"
    );
    expect(lines).toHaveLength(3); // d2, d3
    expect(r.csv).toContain("'=HYPERLINK(1)");
  });

  it("'today' follows the admin's effective timezone (date boundary)", async () => {
    const { todayInTz } = await import("@/lib/local-date");
    for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
      await dbm.db
        .update(S.user)
        .set({ timezone: tz })
        .where(eq(S.user.id, U.admin));
      as(U.admin);
      const r = await rep.getChecklistHistoryReport(W);
      expect(r.today).toBe(todayInTz(new Date(), tz));
      expect(r.filters.to).toBe(r.today);
      // d4/d7 are on the original `today`: overdue only if that date is now in this tz's past
      const d4 = r.rows.find((x: any) => x.dayId === ids.d4);
      if (d4) {
        expect(d4.overdue).toBe(d4.date < r.today);
      }
    }
    await dbm.db
      .update(S.user)
      .set({ timezone: null })
      .where(eq(S.user.id, U.admin));
  });

  it("expanded rows: ONE request returns snapshot items + timezone per day; read-only, scoped", async () => {
    as(U.admin);
    const r = await rep.getChecklistHistoryItems(W, [
      ids.d1,
      ids.d2,
      ids.d6,
      "nope",
    ]);
    expect(Object.keys(r).sort()).toEqual(set("d1", "d2")); // foreign / unknown ids are absent
    expect(r[ids.d1].items.map((i: any) => i.status)).toEqual([
      "DONE",
      "DONE",
      "DONE",
    ]);
    expect(r[ids.d1].items[1].notes).toBe("  Good progress  ");
    expect(r[ids.d2].items).toHaveLength(3);
    expect(r[ids.d1].items.every((i: any) => Array.isArray(i.fields))).toBe(
      true
    );
    expect(typeof r[ids.d1].timezone).toBe("string");
    const before = await dbm.db.select().from(S.dailyChecklistDay);
    await rep.getChecklistHistoryItems(W, [ids.d1]);
    expect((await dbm.db.select().from(S.dailyChecklistDay)).length).toBe(
      before.length
    );
    expect(await rep.getChecklistHistoryItems(W, [])).toEqual({});
    as(U.member);
    expect((await rep.getChecklistHistoryItems(W, [ids.d1])).error).toBe(
      "Forbidden"
    );
    as(U.admin);
    expect((await rep.getChecklistHistoryItems(W2, [ids.d1])).error).toBe(
      "Forbidden"
    );
  });

  it("getChecklistDays: personal days are read-only and owner-only", async () => {
    const pid = id("personal");
    await dbm.db.insert(S.dailyChecklistDay).values({
      id: pid,
      workspaceId: W,
      userId: U.member,
      templateId: null,
      date: off(-1),
      type: "PERSONAL",
    });
    await dbm.db.insert(S.dailyChecklistItem).values({
      id: `${pid}-i`,
      dayId: pid,
      title: "mine",
      status: "DONE",
      sortOrder: 0,
    });
    as(U.member);
    const own = await adm.getChecklistDays(W, [pid]);
    expect(own[pid]).toMatchObject({ type: "PERSONAL", editable: false });
    expect(own[pid].items).toHaveLength(1);
    as(U.admin); // a workspace admin still cannot read someone else's personal list
    expect(await adm.getChecklistDays(W, [pid])).toEqual({});
    as(U.u2);
    expect(await adm.getChecklistDays(W, [pid])).toEqual({});
  });
});
