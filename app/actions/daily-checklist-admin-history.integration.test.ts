// Real-Postgres integration tests: Admin → Checklist → History pagination (date cursor,
// whole dates per page). Same setup/gating as daily-checklist.integration.test.ts.
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
const id = (n: string) => `ah-${rid}-${n}`;
const U = { admin: id("admin"), member: id("member"), other: id("other") };
const W = id("ws");
const W2 = id("ws2"); // someone else's workspace
const PAGE = 20;

let adm: any;
let m: any;
let S: any;
let dbm: any;
const as = (u: string | null) => {
  current.userId = u;
};
const dateN = (i: number) => {
  const d = new Date(Date.UTC(2026, 5, 1 + i)); // Jun 1 + i
  return d.toISOString().slice(0, 10);
};

run("Checklist — admin history pagination (real DB)", () => {
  let tpl = "";
  let n = 0;

  beforeAll(async () => {
    dbm = await import("@/lib/db");
    S = await import("@/db/schema");
    adm = await import("@/app/actions/daily-checklist-admin");
    m = await import("@/app/actions/daily-checklist");
    const { db } = dbm;
    await db.insert(S.user).values(
      Object.values(U).map((uid) => ({
        id: uid,
        email: `${uid}@test.local`,
        name: `name-${uid}`,
      }))
    );
    await db.insert(S.workspace).values([
      { id: W, name: "AH ws", slug: `ah-${rid}`, createdBy: U.admin },
      { id: W2, name: "AH ws2", slug: `ah2-${rid}`, createdBy: U.other },
    ]);
    await db.insert(S.workspaceMember).values([
      {
        id: id("m1"),
        workspaceId: W,
        userId: U.admin,
        role: "ADMIN",
        status: "ACTIVE",
      },
      {
        id: id("m2"),
        workspaceId: W,
        userId: U.member,
        role: "MEMBER",
        status: "ACTIVE",
      },
      {
        id: id("m3"),
        workspaceId: W2,
        userId: U.other,
        role: "ADMIN",
        status: "ACTIVE",
      },
    ]);
    tpl = id("tpl");
    await db.insert(S.dailyChecklistTemplate).values([
      {
        id: tpl,
        workspaceId: W,
        name: "T",
        type: "TEAM",
        recurrence: "DAILY",
        startDate: "2026-01-01",
        createdBy: U.admin,
      },
      {
        id: id("tpl2"),
        workspaceId: W2,
        name: "T2",
        type: "TEAM",
        recurrence: "DAILY",
        startDate: "2026-01-01",
        createdBy: U.other,
      },
    ]);
  });

  afterAll(async () => {
    if (!dbm) {
      return;
    }
    await dbm.db.delete(S.workspace).where(inArray(S.workspace.id, [W, W2]));
    await dbm.db.delete(S.user).where(inArray(S.user.id, Object.values(U)));
    await dbm.dbClient.end();
  });

  /** One TEAM day (+1 item) per date for the given user/template. */
  const seedDays = async (
    dates: string[],
    opts: { ws?: string; user?: string; template?: string } = {}
  ) => {
    const rows = dates.map((date) => ({
      id: id(`d${++n}`),
      workspaceId: opts.ws ?? W,
      userId: opts.user ?? U.member,
      templateId: opts.template ?? tpl,
      date,
      type: "TEAM",
    }));
    await dbm.db.insert(S.dailyChecklistDay).values(rows);
    await dbm.db.insert(S.dailyChecklistItem).values(
      rows.map((r) => ({
        id: `${r.id}-i`,
        dayId: r.id,
        title: "x",
        sortOrder: 0,
      }))
    );
    return rows;
  };
  const clear = async () => {
    await dbm.db
      .delete(S.dailyChecklistDay)
      .where(inArray(S.dailyChecklistDay.workspaceId, [W, W2]));
  };
  const dateList = (rows: any[]) => [...new Set(rows.map((r) => r.date))];

  it("empty history: no rows, no cursor", async () => {
    await clear();
    as(U.admin);
    const r = await adm.getTeamChecklistHistory(W);
    expect(r).toEqual({ rows: [], nextCursor: null });
  });

  it("fewer than a page: everything, no next page", async () => {
    await clear();
    await seedDays(Array.from({ length: 5 }, (_, i) => dateN(i)));
    as(U.admin);
    const r = await adm.getTeamChecklistHistory(W);
    expect(dateList(r.rows)).toHaveLength(5);
    expect(r.nextCursor).toBeNull();
  });

  it("exactly one page of dates: no second page", async () => {
    await clear();
    await seedDays(Array.from({ length: PAGE }, (_, i) => dateN(i)));
    as(U.admin);
    const r = await adm.getTeamChecklistHistory(W);
    expect(dateList(r.rows)).toHaveLength(PAGE);
    expect(r.nextCursor).toBeNull();
  });

  it("one more than a page: second page has the remaining older date", async () => {
    await clear();
    await seedDays(Array.from({ length: PAGE + 1 }, (_, i) => dateN(i)));
    as(U.admin);
    const first = await adm.getTeamChecklistHistory(W);
    expect(dateList(first.rows)).toHaveLength(PAGE);
    expect(first.nextCursor).toBe(dateN(1)); // 20th newest date; the oldest (index 0) remains
    const second = await adm.getTeamChecklistHistory(W, {
      before: first.nextCursor,
    });
    expect(dateList(second.rows)).toEqual([dateN(0)]);
    expect(second.nextCursor).toBeNull();
  });

  it("paginates newest → oldest with no duplicates or gaps across pages", async () => {
    await clear();
    const all = Array.from({ length: 53 }, (_, i) => dateN(i));
    await seedDays(all);
    await seedDays(all, { user: U.admin }); // two days per date
    as(U.admin);
    const seen: string[] = [];
    const dayIds: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const r = await adm.getTeamChecklistHistory(
        W,
        cursor ? { before: cursor } : undefined
      );
      expect(r.error).toBeUndefined();
      const ds = dateList(r.rows);
      expect(ds.length).toBeLessThanOrEqual(PAGE);
      seen.push(...ds);
      dayIds.push(...r.rows.map((x: any) => x.dayId));
      cursor = r.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3); // 20 + 20 + 13
    expect(seen).toEqual([...all].reverse()); // newest first, every date exactly once
    expect(new Set(dayIds).size).toBe(dayIds.length); // no duplicate days
    expect(dayIds).toHaveLength(106); // none lost
  });

  it("never splits a wide date: 350 day-rows on one date all arrive in one page", async () => {
    await clear();
    // 10 members × 35 templates on the same date
    const { db } = dbm;
    const users = Array.from({ length: 10 }, (_, i) => id(`wu${i}`));
    await db
      .insert(S.user)
      .values(
        users.map((uid) => ({ id: uid, email: `${uid}@test.local`, name: uid }))
      );
    const tpls = Array.from({ length: 35 }, (_, i) => id(`wt${i}`));
    await db.insert(S.dailyChecklistTemplate).values(
      tpls.map((t, i) => ({
        id: t,
        workspaceId: W,
        name: `W${i}`,
        type: "TEAM",
        recurrence: "DAILY",
        startDate: "2026-01-01",
      }))
    );
    for (const t of tpls) {
      await seedDays([dateN(10)], { template: t, user: users[0] });
      for (const u of users.slice(1)) {
        await seedDays([dateN(10)], { template: t, user: u });
      }
    }
    await seedDays([dateN(3)]); // an older date that must follow on the next page
    as(U.admin);
    const first = await adm.getTeamChecklistHistory(W);
    expect(first.rows.filter((r: any) => r.date === dateN(10))).toHaveLength(
      350
    );
    const second = await adm.getTeamChecklistHistory(W, { before: dateN(10) });
    expect(dateList(second.rows)).toEqual([dateN(3)]);
    await db
      .delete(S.dailyChecklistTemplate)
      .where(inArray(S.dailyChecklistTemplate.id, tpls));
    await db.delete(S.user).where(inArray(S.user.id, users));
  });

  it("a cursor beyond the oldest history returns nothing", async () => {
    await clear();
    await seedDays([dateN(5), dateN(6)]);
    as(U.admin);
    const r = await adm.getTeamChecklistHistory(W, { before: "2000-01-01" });
    expect(r).toEqual({ rows: [], nextCursor: null });
  });

  it("new history created between page loads doesn't disturb older pages", async () => {
    await clear();
    await seedDays(Array.from({ length: 30 }, (_, i) => dateN(i)));
    as(U.admin);
    const first = await adm.getTeamChecklistHistory(W);
    await seedDays([dateN(40), dateN(41)]); // newer days appear meanwhile
    const second = await adm.getTeamChecklistHistory(W, {
      before: first.nextCursor,
    });
    expect(dateList(second.rows)).toEqual(
      Array.from({ length: 10 }, (_, i) => dateN(9 - i))
    );
    const firstDates = new Set(dateList(first.rows));
    expect(dateList(second.rows).some((d) => firstDates.has(d))).toBe(false);
  });

  it("rejects non-admins, other workspaces' admins and bad cursors; never leaks other workspaces", async () => {
    await clear();
    await seedDays([dateN(1)]);
    await seedDays([dateN(2)], { ws: W2, user: U.other, template: id("tpl2") });
    as(U.member);
    expect((await adm.getTeamChecklistHistory(W)).error).toBe("Forbidden");
    as(U.other); // admin of W2 only
    expect((await adm.getTeamChecklistHistory(W)).error).toBe("Forbidden");
    as(U.admin);
    expect(
      (await adm.getTeamChecklistHistory(W, { before: "not-a-date" })).error
    ).toBe("Invalid date");
    const r = await adm.getTeamChecklistHistory(W);
    expect(dateList(r.rows)).toEqual([dateN(1)]); // W2's day is never included
  });

  it("date filter: returns only that date, all of its rows, with no cursor", async () => {
    await clear();
    const all = Array.from({ length: 30 }, (_, i) => dateN(i));
    await seedDays(all);
    await seedDays([dateN(12)], { user: U.admin }); // second row on the same date
    as(U.admin);
    const r = await adm.getTeamChecklistHistory(W, { date: dateN(12) });
    expect(r.error).toBeUndefined();
    expect(dateList(r.rows)).toEqual([dateN(12)]);
    expect(r.rows).toHaveLength(2);
    expect(r.nextCursor).toBeNull();
    expect(new Set(r.rows.map((x: any) => x.dayId)).size).toBe(2);
    // plain history pagination is untouched by the new option
    const normal = await adm.getTeamChecklistHistory(W);
    expect(dateList(normal.rows)).toHaveLength(PAGE);
    expect(normal.nextCursor).not.toBeNull();
  });

  it("date filter: a date without history is empty; bad dates rejected; other workspaces never leak", async () => {
    await clear();
    await seedDays([dateN(1)]);
    await seedDays([dateN(2)], { ws: W2, user: U.other, template: id("tpl2") });
    as(U.admin);
    expect(await adm.getTeamChecklistHistory(W, { date: dateN(5) })).toEqual({
      rows: [],
      nextCursor: null,
    });
    expect(
      await adm.getTeamChecklistHistory(W, { date: "2999-01-01" })
    ).toEqual({ rows: [], nextCursor: null });
    expect(
      (await adm.getTeamChecklistHistory(W, { date: "10/07/2026" })).error
    ).toBe("Invalid date");
    expect(
      (await adm.getTeamChecklistHistory(W, { date: dateN(2) })).rows
    ).toEqual([]); // W2's day
    as(U.member);
    expect(
      (await adm.getTeamChecklistHistory(W, { date: dateN(1) })).error
    ).toBe("Forbidden");
    as(U.other);
    expect(
      (await adm.getTeamChecklistHistory(W, { date: dateN(1) })).error
    ).toBe("Forbidden");
  });

  it("date filter returns the stored checklist date verbatim (no timezone shift)", async () => {
    await clear();
    await seedDays(["2026-10-07", "2026-03-08"]); // incl. a US DST-change date
    as(U.admin);
    for (const d of ["2026-10-07", "2026-03-08"]) {
      const r = await adm.getTeamChecklistHistory(W, { date: d });
      expect(r.rows.map((x: any) => x.date)).toEqual([d]);
    }
  });

  it("member Personal/Team history: date filter returns only that date, own rows, bad date rejected", async () => {
    await clear();
    await seedDays([dateN(1), dateN(2), dateN(3)]); // member's TEAM days
    await seedDays([dateN(2)], { user: U.admin }); // someone else's
    as(U.member);
    const t = await m.getMyTeamChecklistHistory(W, { date: dateN(2) });
    expect(t.rows.map((r: any) => r.date)).toEqual([dateN(2)]);
    expect(t.rows.every((r: any) => r.userId === U.member)).toBe(true);
    expect(t.nextCursor).toBeNull();
    expect(
      (await m.getMyTeamChecklistHistory(W, { date: dateN(9) })).rows
    ).toEqual([]);
    expect((await m.getMyTeamChecklistHistory(W, { date: "x" })).error).toBe(
      "Invalid date"
    );
    expect((await m.getMyChecklistHistory(W, { date: dateN(2) })).rows).toEqual(
      []
    ); // personal: none
    // unfiltered pagination unchanged
    expect((await m.getMyTeamChecklistHistory(W)).rows).toHaveLength(3);
    as(U.other);
    expect(
      (await m.getMyTeamChecklistHistory(W, { date: dateN(2) })).error
    ).toBe("Forbidden");
  });

  it("history rows carry counts, status and still open in the day detail", async () => {
    await clear();
    const [d] = await seedDays([dateN(7)]);
    await dbm.db
      .update(S.dailyChecklistItem)
      .set({ status: "DONE" })
      .where(eq(S.dailyChecklistItem.dayId, d.id));
    as(U.admin);
    const r = await adm.getTeamChecklistHistory(W);
    expect(r.rows[0]).toMatchObject({
      dayId: d.id,
      total: 1,
      completed: 1,
      status: "COMPLETE",
    });
    const detail = await m.getChecklistDay(W, d.id);
    expect(detail.error).toBeUndefined();
    expect(detail.items).toHaveLength(1);
    // pagination is read-only: the stored rows are unchanged
    const days = await dbm.db
      .select()
      .from(S.dailyChecklistDay)
      .where(
        and(
          eq(S.dailyChecklistDay.workspaceId, W),
          eq(S.dailyChecklistDay.type, "TEAM")
        )
      );
    expect(days).toHaveLength(1);
  });
  it("getChecklistDays (matrix batch): admins read any Team day, others only their own; stored snapshot", async () => {
    await clear();
    const [d1, d2] = await seedDays([dateN(3), dateN(4)]);
    const [other] = await seedDays([dateN(5)], {
      ws: W2,
      user: U.other,
      template: id("tpl2"),
    });
    await dbm.db
      .update(S.dailyChecklistItem)
      .set({ title: "Snapshot title", notes: "kept", status: "DONE" })
      .where(eq(S.dailyChecklistItem.dayId, d1.id));
    as(U.admin);
    const r = await m.getChecklistDays(W, [d1.id, d2.id, other.id, d1.id]);
    expect(r.error).toBeUndefined();
    expect(Object.keys(r).sort()).toEqual([d1.id, d2.id].sort()); // other workspace's day absent
    expect(r[d1.id].items[0]).toMatchObject({
      title: "Snapshot title",
      notes: "kept",
      status: "DONE",
    });
    expect(r[d1.id].progress.completed).toBe(1);
    expect(r[d1.id]).toMatchObject(await m.getChecklistDay(W, d1.id)); // same data as the single-day read
    expect(await m.getChecklistDays(W, [])).toEqual({});
    // non-admins only ever get their own days; other workspaces' admins get nothing here
    const [adminsDay] = await seedDays([dateN(6)], { user: U.admin });
    as(U.member);
    const mine = await m.getChecklistDays(W, [d1.id, d2.id, adminsDay.id]);
    expect(Object.keys(mine).sort()).toEqual([d1.id, d2.id].sort());
    as(U.other);
    expect((await m.getChecklistDays(W, [d1.id])).error).toBe("Forbidden"); // not a member of W
  });
});
