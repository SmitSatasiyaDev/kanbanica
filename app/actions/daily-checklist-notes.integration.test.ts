// Real-Postgres integration tests: a newly added Team Checklist assignee gets today's
// checklist immediately. Same setup/gating as daily-checklist.integration.test.ts
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
const id = (n: string) => `cln-${rid}-${n}`;
const U = { admin: id("admin"), a: id("a"), b: id("b") };
const W = id("ws");

let m: any;
let adm: any;
let S: any;
let dbm: any;
const as = (u: string | null) => {
  current.userId = u;
};
const at = (iso: string) => vi.setSystemTime(new Date(iso));

run("Checklist — item notes & checkbox status (real DB)", () => {
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
      name: "CLN ws",
      slug: `cln-${rid}`,
      createdBy: U.admin,
    });
    await db.insert(S.workspaceMember).values(
      [
        [U.admin, "ADMIN"],
        [U.a, "MEMBER"],
        [U.b, "MEMBER"],
      ].map(([uid, role]) => ({
        id: id(`m-${uid}`),
        workspaceId: W,
        userId: uid,
        role,
        status: "ACTIVE",
      }))
    );
    as(U.admin);
    const r = await adm.createChecklistTemplate(W, {
      name: "Notes",
      recurrence: "DAILY",
      startDate: "2026-10-01",
      items: [{ title: "One" }, { title: "Two" }],
      assigneeIds: [U.a, U.b],
      fields: [{ name: "Ref", type: "TEXT" }],
    });
    expect(r.id).toBeDefined();
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

  const mine = async (u: string) => {
    as(u);
    const r = await m.getMyTeamChecklist(W);
    return r.rows.filter((x: any) => x.assigneeId === u && x.editable);
  };

  it("checkbox: Pending -> Done -> Pending, persisted", async () => {
    const [one] = await mine(U.a);
    expect(one.status).toBe("PENDING");
    expect(
      (await m.updateTeamChecklistItem(W, one.id, { status: "DONE" })).error
    ).toBeUndefined();
    expect((await mine(U.a)).find((r: any) => r.id === one.id).status).toBe(
      "DONE"
    );
    await m.updateTeamChecklistItem(W, one.id, { status: "PENDING" });
    expect((await mine(U.a)).find((r: any) => r.id === one.id).status).toBe(
      "PENDING"
    );
  });

  it("notes: save, persist, edit, clear; independent per item; status untouched", async () => {
    const [one, two] = await mine(U.a);
    await m.updateTeamChecklistItem(W, one.id, { status: "IN_PROGRESS" });
    expect(
      (await m.updateTeamChecklistItem(W, one.id, { notes: "waiting" })).error
    ).toBeUndefined();
    let rows = await mine(U.a);
    const o = rows.find((r: any) => r.id === one.id);
    expect(o.notes).toBe("waiting");
    expect(o.status).toBe("IN_PROGRESS"); // note save keeps internal status
    expect(rows.find((r: any) => r.id === two.id).notes).toBeNull();
    await m.updateTeamChecklistItem(W, one.id, { notes: "  updated  " });
    rows = await mine(U.a);
    expect(rows.find((r: any) => r.id === one.id).notes).toBe("updated");
    await m.updateTeamChecklistItem(W, one.id, { notes: "   " });
    rows = await mine(U.a);
    expect(rows.find((r: any) => r.id === one.id).notes).toBeNull();
  });

  it("notes/status changes do not alter custom field values", async () => {
    const [one] = await mine(U.a);
    const f = one.fields[0];
    await m.setChecklistItemFieldValues(W, one.id, { [f.id]: "REF-1" });
    await m.updateTeamChecklistItem(W, one.id, { notes: "n", status: "DONE" });
    const after = (await mine(U.a)).find((r: any) => r.id === one.id);
    expect(after.fields[0].value).toBe("REF-1");
  });

  it("another member cannot edit someone else's item or note", async () => {
    const [one] = await mine(U.a);
    as(U.b);
    expect(
      (await m.updateTeamChecklistItem(W, one.id, { notes: "hax" })).error
    ).toBeDefined();
    expect(
      (await m.updateTeamChecklistItem(W, one.id, { status: "DONE" })).error
    ).toBeDefined();
    as(U.admin);
    expect(
      (await m.updateTeamChecklistItem(W, one.id, { notes: "hax" })).error
    ).toBeDefined();
  });

  it("past days are read-only for notes", async () => {
    const [one] = await mine(U.a);
    at("2026-10-08T10:00:00Z");
    as(U.a);
    expect(
      (await m.updateTeamChecklistItem(W, one.id, { notes: "late" })).error
    ).toBeDefined();
    at("2026-10-07T10:00:00Z");
  });
  it("historical notes: each day keeps its own note, per member and item; later edits and status changes never leak", async () => {
    // Oct 7 (today): A notes + completes "One"; B notes "One" differently.
    at("2026-10-07T10:00:00Z");
    const [a1, a2] = await mine(U.a);
    await m.updateTeamChecklistItem(W, a1.id, {
      notes: "Waiting for customer",
    });
    await m.updateTeamChecklistItem(W, a1.id, { status: "DONE" });
    await m.updateTeamChecklistItem(W, a2.id, { notes: "   " }); // whitespace → stored as no note
    const [b1] = await mine(U.b);
    await m.updateTeamChecklistItem(W, b1.id, { notes: "B's own note" });
    // Oct 8: A's new day is generated on open and gets its own note.
    at("2026-10-08T10:00:00Z");
    const [a1b] = await mine(U.a);
    expect(a1b.id).not.toBe(a1.id);
    expect(a1b.notes).toBeNull(); // yesterday's note is not carried over
    await m.updateTeamChecklistItem(W, a1b.id, { notes: "Customer confirmed" });
    // Oct 9: both days are History now.
    at("2026-10-09T10:00:00Z");
    as(U.a);
    const hist = await m.getMyTeamChecklistHistory(W);
    const days = hist.rows.filter((r: any) =>
      ["2026-10-07", "2026-10-08"].includes(r.date)
    );
    expect(days.map((d: any) => d.date).sort()).toEqual([
      "2026-10-07",
      "2026-10-08",
    ]);
    const byDate = Object.fromEntries(days.map((d: any) => [d.date, d.dayId]));
    const got = await m.getChecklistDays(W, Object.values(byDate) as string[]);
    const note = (date: string, title: string) =>
      got[byDate[date]].items.find((i: any) => i.title === title)?.notes ??
      null;
    expect(note("2026-10-07", "One")).toBe("Waiting for customer");
    expect(note("2026-10-08", "One")).toBe("Customer confirmed");
    expect(note("2026-10-07", "Two")).toBeNull(); // whitespace note was never stored
    expect(
      got[byDate["2026-10-07"]].items.find((i: any) => i.title === "One").status
    ).toBe("DONE");
    // the date filter returns the same stored notes
    const one = await m.getMyTeamChecklistHistory(W, { date: "2026-10-07" });
    const viaFilter = await m.getChecklistDays(
      W,
      one.rows.map((r: any) => r.dayId)
    );
    expect(
      Object.values(viaFilter as Record<string, any>)[0].items.find(
        (i: any) => i.title === "One"
      ).notes
    ).toBe("Waiting for customer");
    // members never see each other's notes; admin sees each member's own
    expect(JSON.stringify(got)).not.toContain("B's own note");
    as(U.admin);
    const bDay = (
      await adm.getTeamChecklistHistory(W, { date: "2026-10-07" })
    ).rows.find((r: any) => r.userId === U.b);
    const adminView = await m.getChecklistDays(W, [bDay.dayId]);
    expect(
      adminView[bDay.dayId].items.find((i: any) => i.title === "One").notes
    ).toBe("B's own note");
    at("2026-10-07T10:00:00Z");
  });
});
