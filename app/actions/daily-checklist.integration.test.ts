// Real-Postgres integration tests for Checklist. They need a *scratch* database
// that already has the migrations applied, so they only run when
// CHECKLIST_TEST_DATABASE_URL is set (never against your dev DB by accident):
//
//   createdb kanbanica_checklist_test
//   DATABASE_URL=<that url> pnpm db:migrate
//   CHECKLIST_TEST_DATABASE_URL=<that url> pnpm vitest run app/actions/daily-checklist.integration
//
// Auth/session and realtime are mocked; the DB, permission lookups, SQL constraints
// and generation logic are real.
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
const id = (n: string) => `clt-${rid}-${n}`;
const U = {
  owner: id("owner"),
  admin: id("admin"),
  a: id("a"),
  b: id("b"),
  guest: id("guest"),
  out: id("out"),
};
const W = id("ws");
const W2 = id("ws2");

let m: any;
let adm: any;
let S: any;
let dbm: any;
let ens: any;
let gen: any;

const as = (u: string | null) => {
  current.userId = u;
};
const at = (iso: string) => vi.setSystemTime(new Date(iso));

run("Checklist (real DB)", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-10-07T10:00:00Z");
    dbm = await import("@/lib/db");
    S = await import("@/db/schema");
    m = await import("@/app/actions/daily-checklist");
    adm = await import("@/app/actions/daily-checklist-admin");
    ens = await import("@/lib/daily-checklist/ensure");
    gen = await import("@/lib/worker/handlers/daily-checklist-generate");
    const { db } = dbm;
    await db.insert(S.user).values(
      Object.values(U).map((uid) => ({
        id: uid,
        email: `${uid}@test.local`,
        name: `name-${uid}`,
      }))
    );
    await db.insert(S.workspace).values([
      { id: W, name: "CL ws", slug: `cl-${rid}`, createdBy: U.owner },
      { id: W2, name: "CL ws2", slug: `cl2-${rid}`, createdBy: U.out },
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
        mem(W, U.owner, "OWNER"),
        mem(W, U.admin, "ADMIN"),
        mem(W, U.a, "MEMBER"),
        mem(W, U.b, "MEMBER"),
        mem(W, U.guest, "GUEST"),
        mem(W2, U.out, "OWNER"),
      ]);
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (!dbm) {
      return;
    }
    const { db, dbClient } = dbm;
    await db.delete(S.workspace).where(inArray(S.workspace.id, [W, W2]));
    await db.delete(S.user).where(inArray(S.user.id, Object.values(U)));
    await dbClient.end();
  });

  describe("personal checklist", () => {
    it("is created lazily on first read — no worker involved", async () => {
      as(U.a);
      const r = await m.getMyChecklist(W);
      expect(r.date).toBe("2026-10-07");
      expect(r.editable).toBe(true);
      expect(r.items).toEqual([]);
      expect(r.progress).toEqual({ completed: 0, total: 0, percent: 0 });
    });

    it("create / update / toggle / reorder / delete", async () => {
      as(U.a);
      const t = async (title: string) =>
        (await m.createChecklistItem(W, { title })).id as string;
      const i1 = await t("Check emails");
      const i2 = await t("Review tasks");
      const i3 = await t("Submit report");
      expect(
        (await m.getMyChecklist(W)).items.map((i: { title: string }) => i.title)
      ).toEqual(["Check emails", "Review tasks", "Submit report"]);

      expect(await m.toggleChecklistItem(W, i1)).toEqual({ status: "DONE" });
      expect(
        await m.updateChecklistItem(W, i2, {
          status: "DONE",
          priority: "HIGH",
          dueTime: "09:30",
          notes: "n",
        })
      ).toEqual({ ok: true });
      let r = await m.getMyChecklist(W);
      expect(r.progress).toEqual({ completed: 2, total: 3, percent: 67 });
      const done = r.items.find((i: { id: string }) => i.id === i1);
      expect(done.completedAt).not.toBeNull();
      expect(done.completedBy).toBe(U.a);

      // uncomplete clears completion fields
      await m.toggleChecklistItem(W, i1);
      r = await m.getMyChecklist(W);
      const back = r.items.find((i: { id: string }) => i.id === i1);
      expect(back.status).toBe("PENDING");
      expect(back.completedAt).toBeNull();
      expect(back.completedBy).toBeNull();

      expect(await m.reorderChecklistItems(W, [i3, i1, i2])).toEqual({
        ok: true,
      });
      r = await m.getMyChecklist(W);
      expect(r.items.map((i: { id: string }) => i.id)).toEqual([i3, i1, i2]);
      // reorder must contain exactly the day's items
      expect((await m.reorderChecklistItems(W, [i3, i1])).error).toBeDefined();
      expect(
        (await m.reorderChecklistItems(W, [i3, i1, "bogus"])).error
      ).toBeDefined();

      expect(await m.deleteChecklistItem(W, i3)).toEqual({ ok: true });
      expect((await m.getMyChecklist(W)).items).toHaveLength(2);
    });

    it("validates input", async () => {
      as(U.a);
      expect(
        (await m.createChecklistItem(W, { title: "   " })).error
      ).toBeDefined();
      expect(
        (await m.createChecklistItem(W, { title: "x".repeat(201) })).error
      ).toBeDefined();
      expect(
        (await m.createChecklistItem(W, { title: "ok", priority: "NOPE" }))
          .error
      ).toBeDefined();
      const r = await m.getMyChecklist(W);
      expect(
        (await m.updateChecklistItem(W, r.items[0].id, { status: "WAT" })).error
      ).toBeDefined();
      expect((await m.getMyChecklist(W, "not-a-date")).error).toBeDefined();
      expect((await m.getMyChecklist(W, "2099-01-01")).error).toBeDefined(); // future
    });

    it("is private: another user (even an admin) cannot see or touch it", async () => {
      as(U.a);
      const mine = await m.getMyChecklist(W);
      const itemId = mine.items[0].id;
      const dayId = (
        await dbm.db
          .select()
          .from(S.dailyChecklistItem)
          .where(eq(S.dailyChecklistItem.id, itemId))
      )[0].dayId;

      for (const u of [U.b, U.admin, U.owner]) {
        as(u);
        expect((await m.toggleChecklistItem(W, itemId)).error).toBe(
          "Item not found"
        );
        expect(
          (await m.updateChecklistItem(W, itemId, { title: "hax" })).error
        ).toBe("Item not found");
        expect((await m.deleteChecklistItem(W, itemId)).error).toBe(
          "Item not found"
        );
        expect((await m.getChecklistDay(W, dayId)).error).toBe("Not found");
        // their own personal list is separate
        expect(
          (await m.getMyChecklist(W)).items.map((i: { id: string }) => i.id)
        ).not.toContain(itemId);
      }
    });

    it("rejects workspaces the caller isn't a member of (cross-workspace)", async () => {
      as(U.a);
      expect((await m.getMyChecklist(W2)).error).toBe("Forbidden");
      expect((await m.createChecklistItem(W2, { title: "x" })).error).toBe(
        "Forbidden"
      );
      as(U.out);
      expect((await m.getMyChecklist(W)).error).toBe("Forbidden");
      as(null);
      expect((await m.getMyChecklist(W)).error).toBe("Unauthorized");
    });

    it("guests keep a personal checklist", async () => {
      as(U.guest);
      expect(
        (await m.createChecklistItem(W, { title: "guest item" })).id
      ).toBeDefined();
    });

    it("a new day never overwrites the previous day; history is read-only", async () => {
      as(U.a);
      const day1 = await m.getMyChecklist(W);
      const before = JSON.stringify(day1.items);

      at("2026-10-08T10:00:00Z");
      const day2 = await m.getMyChecklist(W);
      expect(day2.date).toBe("2026-10-08");
      expect(day2.items).toEqual([]);

      const created = await m.createChecklistItem(W, { title: "Day 2 item" });
      expect(created.id).toBeDefined();

      // yesterday is untouched and now read-only
      const y = await m.getMyChecklist(W, "2026-10-07");
      expect(y.editable).toBe(false);
      expect(JSON.stringify(y.items)).toBe(before);
      const yId = y.items[0].id;
      expect((await m.toggleChecklistItem(W, yId)).error).toMatch(/read-only/i);
      expect(
        (await m.updateChecklistItem(W, yId, { title: "x" })).error
      ).toMatch(/read-only/i);
      expect((await m.deleteChecklistItem(W, yId)).error).toMatch(/read-only/i);

      // a past date with no saved day is not generated retroactively
      const never = await m.getMyChecklist(W, "2026-09-01");
      expect(never.exists).toBe(false);
      expect(never.items).toEqual([]);

      const h = await m.getMyChecklistHistory(W);
      expect(h.rows.map((r: { date: string }) => r.date)).toEqual([
        "2026-10-08",
        "2026-10-07",
      ]);
      expect(h.rows[1]).toMatchObject({ completed: 1, total: 2 });
      at("2026-10-07T10:00:00Z");
    });

    it("midnight rollover follows the user's own timezone", async () => {
      await dbm.db
        .update(S.user)
        .set({ timezone: "Asia/Kolkata" })
        .where(eq(S.user.id, U.a));
      at("2026-10-07T20:00:00Z"); // 01:30 on Oct 8 in Kolkata
      as(U.a);
      expect((await m.getMyChecklist(W)).today).toBe("2026-10-08");
      as(U.b); // UTC
      expect((await m.getMyChecklist(W)).today).toBe("2026-10-07");
      await dbm.db
        .update(S.user)
        .set({ timezone: null })
        .where(eq(S.user.id, U.a));
      at("2026-10-07T10:00:00Z");
    });

    it("concurrent first-access creates exactly one day", async () => {
      await Promise.all(
        Array.from({ length: 12 }, () =>
          ens.ensurePersonalDay(dbm.db, W, U.b, "2026-10-20")
        )
      );
      const rows = await dbm.db
        .select()
        .from(S.dailyChecklistDay)
        .where(eq(S.dailyChecklistDay.userId, U.b));
      expect(
        rows.filter((r: { date: string }) => r.date === "2026-10-20")
      ).toHaveLength(1);
    });
  });

  describe("team checklist", () => {
    let tplId: string;
    let itemIds: string[];

    it("only Owner/Admin can manage templates", async () => {
      const input = {
        name: "Daily Developer Checklist",
        recurrence: "WEEKDAYS",
        startDate: "2026-10-01",
        items: [
          { title: "Check GitHub", priority: "HIGH" },
          { title: "Review assigned tasks" },
          { title: "Submit EOD report", dueTime: "17:00" },
        ],
        assigneeIds: [U.a, U.b],
      };
      for (const u of [U.a, U.guest, U.out]) {
        as(u);
        expect((await adm.createChecklistTemplate(W, input)).error).toBe(
          "Forbidden"
        );
        expect((await adm.listChecklistTemplates(W)).error).toBe("Forbidden");
      }
      as(U.admin);
      const r = await adm.createChecklistTemplate(W, input);
      expect(r.id).toBeDefined();
      tplId = r.id;
      const list = await adm.listChecklistTemplates(W);
      expect(list.templates).toHaveLength(1);
      expect(
        list.templates[0].items.map((i: { title: string }) => i.title)
      ).toEqual(["Check GitHub", "Review assigned tasks", "Submit EOD report"]);
      expect(list.templates[0].assignees).toHaveLength(2);
      itemIds = list.templates[0].items.map((i: { id: string }) => i.id);
    });

    it("rejects invalid templates and non-member / guest assignees", async () => {
      as(U.admin);
      const base = { name: "X", recurrence: "DAILY", startDate: "2026-10-01" };
      expect(
        (
          await adm.createChecklistTemplate(W, {
            ...base,
            assigneeIds: [U.out],
          })
        ).error
      ).toMatch(/not active members/);
      expect(
        (
          await adm.createChecklistTemplate(W, {
            ...base,
            assigneeIds: [U.guest],
          })
        ).error
      ).toMatch(/not active members/);
      expect(
        (await adm.createChecklistTemplate(W, { ...base, name: "" })).error
      ).toBeDefined();
      expect(
        (
          await adm.createChecklistTemplate(W, {
            ...base,
            recurrence: "CUSTOM",
          })
        ).error
      ).toBeDefined();
      expect((await adm.listChecklistTemplates(W)).templates).toHaveLength(1);
    });

    it("another workspace's admin cannot touch this template", async () => {
      as(U.out);
      expect(
        (
          await adm.updateChecklistTemplate(W2, tplId, {
            name: "x",
            recurrence: "DAILY",
            startDate: "2026-10-01",
          })
        ).error
      ).toBe("Template not found");
      expect((await adm.disableChecklistTemplate(W2, tplId)).error).toBe(
        "Template not found"
      );
      expect((await adm.deleteChecklistTemplate(W2, tplId)).error).toBe(
        "Template not found"
      );
      expect(
        (await adm.updateTemplateAssignments(W2, tplId, [U.out])).error
      ).toBe("Template not found");
      expect(
        (await adm.updateTemplateItem(W2, itemIds[0], { title: "x" })).error
      ).toBe("Item not found");
      expect((await adm.deleteTemplateItem(W2, itemIds[0])).error).toBe(
        "Item not found"
      );
    });

    it("generates on demand when a member opens the Team Checklist (no worker)", async () => {
      as(U.a);
      const r = await m.getMyTeamChecklist(W);
      expect(r.date).toBe("2026-10-07");
      const mine = r.rows.filter((x: { editable: boolean }) => x.editable);
      expect(mine.map((x: { title: string }) => x.title)).toEqual([
        "Check GitHub",
        "Review assigned tasks",
        "Submit EOD report",
      ]);
      expect(mine[0]).toMatchObject({ priority: "HIGH", status: "PENDING" });
      expect(mine[2].dueTime).toBe("17:00");
    });

    it("each assignee has independent state", async () => {
      as(U.a);
      const a = await m.getMyTeamChecklist(W);
      const aGithub = a.rows.find(
        (x: { editable: boolean; title: string }) =>
          x.editable && x.title === "Check GitHub"
      );
      expect(
        await m.updateTeamChecklistItem(W, aGithub.id, { status: "DONE" })
      ).toEqual({ ok: true });

      as(U.b);
      const b = await m.getMyTeamChecklist(W);
      const bMine = b.rows.filter((x: { editable: boolean }) => x.editable);
      expect(
        bMine.every((x: { status: string }) => x.status === "PENDING")
      ).toBe(true);
      // B sees A's rows but cannot edit them
      const aRowSeenByB = b.rows.find(
        (x: { id: string }) => x.id === aGithub.id
      );
      expect(aRowSeenByB.status).toBe("DONE");
      expect(aRowSeenByB.editable).toBe(false);
      expect(
        (await m.updateTeamChecklistItem(W, aGithub.id, { status: "PENDING" }))
          .error
      ).toBe("Item not found");

      // both users' items point at the same template item (what the Team view groups on)
      const aItem = (await m.getMyTeamChecklist(W)).rows.find(
        (x: { id: string }) => x.id === aGithub.id
      );
      const bItem = b.rows.find(
        (x: { editable: boolean; title: string }) =>
          x.editable && x.title === "Check GitHub"
      );
      expect(aItem.templateItemId).toBeTruthy();
      expect(bItem.templateItemId).toBe(aItem.templateItemId);
      expect(bItem.id).not.toBe(aItem.id);

      // A's DONE has completion bookkeeping; IN_PROGRESS then back clears it
      const row = (
        await dbm.db
          .select()
          .from(S.dailyChecklistItem)
          .where(eq(S.dailyChecklistItem.id, aGithub.id))
      )[0];
      expect(row.completedBy).toBe(U.a);
      expect(row.completedAt).not.toBeNull();
      as(U.a);
      await m.updateTeamChecklistItem(W, aGithub.id, { status: "IN_PROGRESS" });
      const row2 = (
        await dbm.db
          .select()
          .from(S.dailyChecklistItem)
          .where(eq(S.dailyChecklistItem.id, aGithub.id))
      )[0];
      expect(row2.status).toBe("IN_PROGRESS");
      expect(row2.completedAt).toBeNull();
      expect(row2.completedBy).toBeNull();
      await m.updateTeamChecklistItem(W, aGithub.id, { status: "DONE" });
    });

    it("members cannot alter template-derived fields; bad status rejected", async () => {
      as(U.a);
      const a = await m.getMyTeamChecklist(W);
      const mine = a.rows.find((x: { editable: boolean }) => x.editable);
      expect(
        (await m.updateTeamChecklistItem(W, mine.id, { status: "NOPE" })).error
      ).toBeDefined();
      expect(
        (await m.updateTeamChecklistItem(W, mine.id, {})).error
      ).toBeDefined();
      // personal-item action can't be pointed at a team item
      expect((await m.toggleChecklistItem(W, mine.id)).error).toBe(
        "Item not found"
      );
    });

    it("guests are not exposed to the Team Checklist", async () => {
      as(U.guest);
      expect((await m.getMyTeamChecklist(W)).error).toBe("Forbidden");
      expect((await m.getMyTeamChecklistHistory(W)).error).toBe("Forbidden");
    });

    it("a non-assigned member sees no team rows; admins see everything", async () => {
      as(U.owner);
      const o = await m.getMyTeamChecklist(W);
      expect(o.isAdmin).toBe(true);
      expect(o.rows).toHaveLength(6); // 3 items × 2 assignees
      expect(o.rows.every((x: { editable: boolean }) => !x.editable)).toBe(
        true
      );
      const t = await adm.getTodaysChecklists(W);
      expect(t.rows).toHaveLength(2);
      const aRow = t.rows.find((r: { userId: string }) => r.userId === U.a);
      expect(aRow).toMatchObject({
        completed: 1,
        total: 3,
        status: "IN_PROGRESS",
        templateName: "Daily Developer Checklist",
      });
      const bRow = t.rows.find((r: { userId: string }) => r.userId === U.b);
      expect(bRow).toMatchObject({
        completed: 0,
        total: 3,
        status: "NOT_STARTED",
      });
      as(U.a);
      expect((await adm.getTodaysChecklists(W)).error).toBe("Forbidden");
    });

    it("concurrent generation never duplicates days or snapshot items", async () => {
      // fresh weekday with nothing generated yet
      await Promise.all(
        Array.from({ length: 10 }, () =>
          ens.ensureTeamDays(dbm.db, U.a, "2026-10-12", W)
        )
      );
      const days = await dbm.db
        .select()
        .from(S.dailyChecklistDay)
        .where(eq(S.dailyChecklistDay.userId, U.a));
      const d12 = days.filter(
        (d: { date: string; type: string }) =>
          d.date === "2026-10-12" && d.type === "TEAM"
      );
      expect(d12).toHaveLength(1);
      const items = await dbm.db
        .select()
        .from(S.dailyChecklistItem)
        .where(eq(S.dailyChecklistItem.dayId, d12[0].id));
      expect(items).toHaveLength(3);
    });

    it("duplicate assignments are impossible", async () => {
      await expect(
        dbm.db
          .insert(S.dailyChecklistTemplateAssignment)
          .values({ id: id("dup"), templateId: tplId, userId: U.a })
      ).rejects.toThrow();
      as(U.admin);
      expect(
        await adm.updateTemplateAssignments(W, tplId, [U.a, U.a, U.b])
      ).toEqual({ ok: true });
      const rows = await dbm.db
        .select()
        .from(S.dailyChecklistTemplateAssignment)
        .where(eq(S.dailyChecklistTemplateAssignment.templateId, tplId));
      expect(rows).toHaveLength(2);
    });

    it("template edits never rewrite past days (snapshot)", async () => {
      // Oct 7 exists for A (generated above). Edit the template on Oct 8.
      at("2026-10-08T09:00:00Z");
      as(U.admin);
      const list = await adm.listChecklistTemplates(W);
      const t = list.templates[0];
      const res = await adm.updateChecklistTemplate(W, tplId, {
        name: t.name,
        recurrence: "WEEKDAYS",
        startDate: "2026-10-01",
        items: [
          {
            id: t.items[0].id,
            title: "Check GitHub and GitLab",
            priority: "HIGH",
          },
          { id: t.items[1].id, title: "Review assigned tasks" },
          { id: t.items[2].id, title: "Submit EOD report", dueTime: "17:00" },
          { title: "Update task statuses" },
        ],
        assigneeIds: [U.a, U.b],
      });
      expect(res).toEqual({ ok: true });

      as(U.a);
      const oct8 = await m.getMyTeamChecklist(W);
      expect(oct8.date).toBe("2026-10-08");
      const mine8 = oct8.rows.filter((x: { editable: boolean }) => x.editable);
      expect(mine8.map((x: { title: string }) => x.title)).toEqual([
        "Check GitHub and GitLab",
        "Review assigned tasks",
        "Submit EOD report",
        "Update task statuses",
      ]);
      expect(
        mine8.every((x: { status: string }) => x.status === "PENDING")
      ).toBe(true);

      // Oct 7 still says what it said, with its saved statuses
      const oct7 = await m.getMyTeamChecklist(W, "2026-10-07");
      expect(oct7.editable).toBe(false);
      const mine7 = oct7.rows.filter(
        (x: { assigneeId: string }) => x.assigneeId === U.a
      );
      expect(mine7.map((x: { title: string }) => x.title)).toEqual([
        "Check GitHub",
        "Review assigned tasks",
        "Submit EOD report",
      ]);
      expect(mine7[0].status).toBe("DONE");

      // completing on Oct 8 does not touch Oct 7; Oct 7 is read-only
      await m.updateTeamChecklistItem(W, mine8[1].id, { status: "DONE" });
      const oct7b = await m.getMyTeamChecklist(W, "2026-10-07");
      expect(
        oct7b.rows.filter(
          (x: { assigneeId: string; status: string }) =>
            x.assigneeId === U.a && x.status === "DONE"
        )
      ).toHaveLength(1);
      expect(
        (await m.updateTeamChecklistItem(W, mine7[1].id, { status: "DONE" }))
          .error
      ).toMatch(/read-only/i);

      // history: both days, each with its own progress
      const h = await m.getMyTeamChecklistHistory(W);
      // (Oct 12 also exists, generated by the concurrency test above)
      const hist = h.rows.filter(
        (r: { date: string }) => r.date <= "2026-10-08"
      );
      expect(hist.map((r: { date: string }) => r.date)).toEqual([
        "2026-10-08",
        "2026-10-07",
      ]);
      expect(hist[0]).toMatchObject({ completed: 1, total: 4 });
      expect(hist[0].templateId).toBe(tplId); // history rows carry the template id the UI groups on
      expect(hist[1]).toMatchObject({ completed: 1, total: 3 });

      // admin drill-in shows the stored items for any user's day
      as(U.admin);
      const ah = await adm.getTeamChecklistHistory(W);
      expect(ah.rows.map((r: { date: string }) => r.date)).toContain(
        "2026-10-07"
      );
      const oldDay = ah.rows.find(
        (r: { date: string; userId: string }) =>
          r.date === "2026-10-07" && r.userId === U.a
      );
      const detail = await m.getChecklistDay(W, oldDay.dayId);
      expect(detail.items.map((i: { title: string }) => i.title)).toEqual([
        "Check GitHub",
        "Review assigned tasks",
        "Submit EOD report",
      ]);
      // a member can't open someone else's team day
      as(U.b);
      expect((await m.getChecklistDay(W, oldDay.dayId)).error).toBe(
        "Not found"
      );
    });

    it("weekends don't generate for a WEEKDAYS template", async () => {
      at("2026-10-10T09:00:00Z"); // Saturday
      as(U.b);
      const r = await m.getMyTeamChecklist(W);
      expect(r.rows).toEqual([]);
    });

    it("the worker generates per assignee-local date and is idempotent", async () => {
      await dbm.db
        .update(S.user)
        .set({ timezone: "Pacific/Auckland" })
        .where(eq(S.user.id, U.b));
      // Mon Oct 12 20:00Z → Auckland already Tue Oct 13 (UTC+13 in DST), UTC user still Mon Oct 12
      const now = new Date("2026-10-12T20:00:00Z");
      const first = await gen.runDailyChecklistGenerate({ now });
      expect(first.failed).toBe(0);
      const days = await dbm.db
        .select()
        .from(S.dailyChecklistDay)
        .where(inArray(S.dailyChecklistDay.userId, [U.a, U.b]));
      const key = (d: { userId: string; date: string; type: string }) =>
        `${d.userId === U.a ? "a" : "b"}:${d.date}:${d.type}`;
      const keys = days.map(key);
      expect(keys).toContain("b:2026-10-13:TEAM"); // Auckland's today
      expect(keys).not.toContain("b:2026-10-12:TEAM");
      expect(keys).toContain("a:2026-10-12:TEAM"); // created earlier by the concurrency test, not duplicated
      const second = await gen.runDailyChecklistGenerate({ now });
      expect(second.failed).toBe(0); // (global counts can include other test files' users)
      const again = await dbm.db
        .select()
        .from(S.dailyChecklistDay)
        .where(inArray(S.dailyChecklistDay.userId, [U.a, U.b]));
      expect(again).toHaveLength(days.length);
      await dbm.db
        .update(S.user)
        .set({ timezone: null })
        .where(eq(S.user.id, U.b));
    });

    it("respects start / end dates", async () => {
      as(U.admin);
      const r = await adm.createChecklistTemplate(W, {
        name: "Window",
        recurrence: "DAILY",
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        items: [{ title: "Only in window" }],
        assigneeIds: [U.a],
      });
      expect(r.id).toBeDefined();
      as(U.a);
      const count = async (iso: string) => {
        at(iso);
        const t = await m.getMyTeamChecklist(W);
        return t.rows.filter(
          (x: { templateName: string }) => x.templateName === "Window"
        ).length;
      };
      expect(await count("2026-11-01T10:00:00Z")).toBe(0);
      expect(await count("2026-11-02T10:00:00Z")).toBe(1);
      expect(await count("2026-11-03T10:00:00Z")).toBe(1);
      expect(await count("2026-11-04T10:00:00Z")).toBe(0);
    });

    it("disable and soft-delete stop generation but keep history", async () => {
      as(U.admin);
      at("2026-10-14T09:00:00Z"); // Wednesday
      expect(await adm.disableChecklistTemplate(W, tplId, false)).toEqual({
        ok: true,
      });
      as(U.a);
      let r = await m.getMyTeamChecklist(W);
      expect(
        r.rows.filter((x: { templateId: string }) => x.templateId === tplId)
      ).toHaveLength(0);
      const h = await m.getMyTeamChecklistHistory(W);
      expect(h.rows.length).toBeGreaterThanOrEqual(2); // Oct 7 and 8 still there
      const gen1 = await gen.runDailyChecklistGenerate({
        now: new Date("2026-10-15T09:00:00Z"),
      });
      expect(gen1.failed).toBe(0);
      const afterGen = await dbm.db
        .select()
        .from(S.dailyChecklistDay)
        .where(eq(S.dailyChecklistDay.templateId, tplId));
      expect(
        afterGen.some(
          (d: { date: string }) =>
            d.date === "2026-10-14" || d.date === "2026-10-15"
        )
      ).toBe(false);

      // re-enable → generates again
      as(U.admin);
      expect(await adm.disableChecklistTemplate(W, tplId, true)).toEqual({
        ok: true,
      });
      at("2026-10-15T09:00:00Z");
      as(U.a);
      r = await m.getMyTeamChecklist(W);
      expect(
        r.rows.filter((x: { templateId: string }) => x.templateId === tplId)
          .length
      ).toBeGreaterThan(0);

      // soft delete
      as(U.admin);
      expect(await adm.deleteChecklistTemplate(W, tplId)).toEqual({ ok: true });
      expect(
        (await adm.listChecklistTemplates(W)).templates.map(
          (t: { id: string }) => t.id
        )
      ).not.toContain(tplId);
      at("2026-10-16T09:00:00Z");
      as(U.a);
      r = await m.getMyTeamChecklist(W);
      expect(
        r.rows.filter((x: { templateId: string }) => x.templateId === tplId)
      ).toHaveLength(0);
      const stillThere = await dbm.db
        .select()
        .from(S.dailyChecklistDay)
        .where(eq(S.dailyChecklistDay.templateId, tplId));
      expect(stillThere.length).toBeGreaterThanOrEqual(3); // history rows were not destroyed
      const h2 = await m.getMyTeamChecklistHistory(W);
      expect(
        h2.rows.some((x: { date: string }) => x.date === "2026-10-07")
      ).toBe(true);
    });

    it("removing an assignee or an item keeps past day snapshots", async () => {
      as(U.admin);
      const r = await adm.createChecklistTemplate(W, {
        name: "Snap2",
        recurrence: "DAILY",
        startDate: "2026-12-01",
        items: [{ title: "keep me" }],
        assigneeIds: [U.b],
      });
      at("2026-12-02T10:00:00Z");
      as(U.b);
      const before = await m.getMyTeamChecklist(W);
      const mine = before.rows.filter(
        (x: { templateName: string }) => x.templateName === "Snap2"
      );
      expect(mine).toHaveLength(1);
      as(U.admin);
      const t = (await adm.listChecklistTemplates(W)).templates.find(
        (x: { id: string }) => x.id === r.id
      );
      await adm.deleteTemplateItem(W, t.items[0].id);
      await adm.updateTemplateAssignments(W, r.id, []);
      const after = (
        await dbm.db
          .select()
          .from(S.dailyChecklistItem)
          .where(eq(S.dailyChecklistItem.id, mine[0].id))
      )[0];
      expect(after.title).toBe("keep me");
      expect(after.templateItemId).toBeNull();
    });
  });
});
