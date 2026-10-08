// Real-Postgres integration tests: custom-field → checklist-item applicability.
// Same setup/gating as daily-checklist.integration.test.ts (CHECKLIST_TEST_DATABASE_URL
// points at a migrated scratch database).
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
const id = (n: string) => `fs-${rid}-${n}`;
const U = {
  admin: id("admin"),
  a: id("a"),
  b: id("b"),
  dev: id("dev"),
};
const W = id("ws");

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
const FE = "k-fe";
const BE = "k-be";
const QA = "k-qa";

run("Checklist — field → item applicability (real DB)", () => {
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
    await db
      .insert(S.workspace)
      .values({ id: W, name: "FS ws", slug: `fs-${rid}`, createdBy: U.admin });
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
      ]);
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

  const items3 = () => [
    { title: "Frontend", key: FE },
    { title: "Backend", key: BE },
    { title: "QA", key: QA },
  ];
  const input = (over: Record<string, unknown> = {}) => ({
    name: "Scope",
    recurrence: "DAILY",
    startDate: "2026-10-01",
    items: items3(),
    assigneeIds: [U.a],
    fields: [{ name: "Customer", type: "TEXT" }],
    ...over,
  });
  const make = async (over: Record<string, unknown> = {}) => {
    as(U.admin);
    const r = await adm.createChecklistTemplate(W, input(over));
    expect(r.error).toBeUndefined();
    return r.id as string;
  };
  const tplOf = async (tpl: string) => {
    as(U.admin);
    return (await adm.listChecklistTemplates(W)).templates.find(
      (t: { id: string }) => t.id === tpl
    );
  };
  /** The template as an edit payload, with the given overrides. */
  const editPayload = async (tpl: string, over: Record<string, unknown>) => {
    const t = await tplOf(tpl);
    return {
      name: t.name,
      recurrence: t.recurrence,
      startDate: t.startDate,
      items: t.items.map((i: any) => ({ id: i.id, key: i.id, title: i.title })),
      assigneeIds: t.assignees.map((x: any) => x.userId),
      fields: t.fields.map((f: any) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        isRequired: f.isRequired,
        options: f.options.map((o: any) => ({ label: o.label })),
        appliesToAll: f.appliesToAll,
        itemKeys: f.itemIds,
      })),
      ...over,
    };
  };
  const itemIdOf = async (tpl: string, title: string) =>
    (await tplOf(tpl)).items.find((i: any) => i.title === title).id as string;
  /** { itemTitle: [fieldName,...] } for one user's day of a template on a date. */
  const snapshot = async (tpl: string, uid: string, date: string) => {
    const [day] = await dbm.db
      .select()
      .from(S.dailyChecklistDay)
      .where(
        and(
          eq(S.dailyChecklistDay.templateId, tpl),
          eq(S.dailyChecklistDay.userId, uid),
          eq(S.dailyChecklistDay.date, date)
        )
      );
    if (!day) {
      return null;
    }
    const its = await dbm.db
      .select()
      .from(S.dailyChecklistItem)
      .where(eq(S.dailyChecklistItem.dayId, day.id));
    const out: Record<string, string[]> = {};
    for (const it of its) {
      const vals = await dbm.db
        .select()
        .from(S.dailyChecklistItemFieldValue)
        .where(eq(S.dailyChecklistItemFieldValue.itemId, it.id));
      out[it.title] = vals.map((v: any) => v.fieldName).sort();
    }
    return out;
  };

  it("fields default to all checklist items (and legacy payloads without the flag too)", async () => {
    const tpl = await make();
    const t = await tplOf(tpl);
    expect(t.fields[0]).toMatchObject({ appliesToAll: true, itemIds: [] });
    expect(await snapshot(tpl, U.a, "2026-10-07")).toEqual({
      Frontend: ["Customer"],
      Backend: ["Customer"],
      QA: ["Customer"],
    });
  });

  it("explicit 'all items' behaves like the default", async () => {
    const tpl = await make({
      fields: [{ name: "Customer", type: "TEXT", appliesToAll: true }],
    });
    expect(Object.values((await snapshot(tpl, U.a, "2026-10-07"))!)).toEqual([
      ["Customer"],
      ["Customer"],
      ["Customer"],
    ]);
  });

  it("selected items: only those items get the field (generated on create)", async () => {
    const tpl = await make({
      fields: [
        { name: "Customer", type: "TEXT", appliesToAll: false, itemKeys: [FE] },
        { name: "Everyone", type: "TEXT" },
      ],
    });
    expect(await snapshot(tpl, U.a, "2026-10-07")).toEqual({
      Frontend: ["Customer", "Everyone"],
      Backend: ["Everyone"],
      QA: ["Everyone"],
    });
    const t = await tplOf(tpl);
    const fe = t.items.find((i: any) => i.title === "Frontend").id;
    expect(t.fields[0]).toMatchObject({ appliesToAll: false, itemIds: [fe] });
  });

  it("multiple selected items", async () => {
    const tpl = await make({
      fields: [
        {
          name: "PR Link",
          type: "TEXT",
          appliesToAll: false,
          itemKeys: [BE, QA],
        },
      ],
    });
    expect(await snapshot(tpl, U.a, "2026-10-07")).toEqual({
      Frontend: [],
      Backend: ["PR Link"],
      QA: ["PR Link"],
    });
  });

  it("rejects selected-items with nothing selected, or unknown items", async () => {
    as(U.admin);
    for (const itemKeys of [[], ["nope"]]) {
      const r = await adm.createChecklistTemplate(
        W,
        input({
          fields: [{ name: "X", type: "TEXT", appliesToAll: false, itemKeys }],
        })
      );
      expect(r.error).toBeDefined();
    }
    const noItems = await adm.createChecklistTemplate(
      W,
      input({
        items: [],
        fields: [
          { name: "X", type: "TEXT", appliesToAll: false, itemKeys: [FE] },
        ],
      })
    );
    expect(noItems.error).toBeDefined();
  });

  it("editing applicability affects future days only; history and values stay", async () => {
    const tpl = await make();
    const before = await snapshot(tpl, U.a, "2026-10-07");
    const fe = await itemIdOf(tpl, "Frontend");
    as(U.admin);
    const r = await adm.updateChecklistTemplate(
      W,
      tpl,
      await editPayload(tpl, {
        fields: [
          {
            ...(await editPayload(tpl, {})).fields[0],
            appliesToAll: false,
            itemKeys: [fe],
          },
        ],
      })
    );
    expect(r.error).toBeUndefined();
    expect(await snapshot(tpl, U.a, "2026-10-07")).toEqual(before); // history unchanged
    at("2026-10-08T10:00:00Z");
    as(U.a);
    await m.getMyTeamChecklist(W); // on-demand
    expect(await snapshot(tpl, U.a, "2026-10-08")).toEqual({
      Frontend: ["Customer"],
      Backend: [],
      QA: [],
    });
    expect(await snapshot(tpl, U.a, "2026-10-07")).toEqual(before);
    // and back to a different selection: only newer days follow
    const be = await itemIdOf(tpl, "Backend");
    const qa = await itemIdOf(tpl, "QA");
    as(U.admin);
    await adm.updateChecklistTemplate(
      W,
      tpl,
      await editPayload(tpl, {
        fields: [
          {
            ...(await editPayload(tpl, {})).fields[0],
            appliesToAll: false,
            itemKeys: [be, qa],
          },
        ],
      })
    );
    at("2026-10-09T10:00:00Z");
    const stats = await gen.runDailyChecklistGenerate({
      now: new Date(),
      workspaceId: W,
    }); // worker
    expect(stats.failed).toBe(0);
    expect(await snapshot(tpl, U.a, "2026-10-09")).toEqual({
      Frontend: [],
      Backend: ["Customer"],
      QA: ["Customer"],
    });
    expect(await snapshot(tpl, U.a, "2026-10-08")).toEqual({
      Frontend: ["Customer"],
      Backend: [],
      QA: [],
    });
    at("2026-10-07T10:00:00Z");
  });

  it("a new item gets all-items fields but not selected-items fields (unless selected)", async () => {
    const tpl = await make({
      fields: [
        { name: "Everyone", type: "TEXT" },
        { name: "OnlyFE", type: "TEXT", appliesToAll: false, itemKeys: [FE] },
      ],
    });
    as(U.admin);
    const payload = await editPayload(tpl, {});
    const r = await adm.updateChecklistTemplate(W, tpl, {
      ...payload,
      items: [...payload.items, { key: "k-docs", title: "Docs" }],
      fields: [
        ...payload.fields,
        {
          name: "DocsOnly",
          type: "TEXT",
          appliesToAll: false,
          itemKeys: ["k-docs"], // references an item created in the same save
        },
      ],
    });
    expect(r.error).toBeUndefined();
    at("2026-10-08T10:00:00Z");
    as(U.a);
    await m.getMyTeamChecklist(W);
    expect(await snapshot(tpl, U.a, "2026-10-08")).toEqual({
      Frontend: ["Everyone", "OnlyFE"],
      Backend: ["Everyone"],
      QA: ["Everyone"],
      Docs: ["DocsOnly", "Everyone"],
    });
    at("2026-10-07T10:00:00Z");
  });

  it("renaming/reordering items keeps applicability", async () => {
    const tpl = await make({
      fields: [
        { name: "Customer", type: "TEXT", appliesToAll: false, itemKeys: [FE] },
      ],
    });
    const t = await tplOf(tpl);
    const feId = t.items.find((i: any) => i.title === "Frontend").id;
    as(U.admin);
    const reordered = [...t.items].reverse().map((i: any) => i.id);
    expect(
      (await adm.reorderTemplateItems(W, tpl, reordered)).error
    ).toBeUndefined();
    const payload = await editPayload(tpl, {});
    payload.items = payload.items.map((i: any) =>
      i.id === feId ? { ...i, title: "Web UI" } : i
    );
    expect(
      (await adm.updateChecklistTemplate(W, tpl, payload)).error
    ).toBeUndefined();
    const after = await tplOf(tpl);
    expect(after.fields[0].itemIds).toEqual([feId]);
    at("2026-10-08T10:00:00Z");
    as(U.a);
    await m.getMyTeamChecklist(W);
    expect(await snapshot(tpl, U.a, "2026-10-08")).toEqual({
      "Web UI": ["Customer"],
      Backend: [],
      QA: [],
    });
    at("2026-10-07T10:00:00Z");
  });

  it("deleting an item cleans its links; the last target can't be deleted", async () => {
    const tpl = await make({
      fields: [
        {
          name: "Customer",
          type: "TEXT",
          appliesToAll: false,
          itemKeys: [FE, QA],
        },
        { name: "Solo", type: "TEXT", appliesToAll: false, itemKeys: [BE] },
      ],
    });
    const before = await snapshot(tpl, U.a, "2026-10-07");
    const qa = await itemIdOf(tpl, "QA");
    const be = await itemIdOf(tpl, "Backend");
    as(U.admin);
    expect((await adm.deleteTemplateItem(W, be)).error).toMatch(/Solo/);
    expect((await adm.deleteTemplateItem(W, qa)).error).toBeUndefined();
    const t = await tplOf(tpl);
    const customer = t.fields.find((f: any) => f.name === "Customer");
    expect(customer.itemIds).toHaveLength(1);
    expect(
      await dbm.db
        .select()
        .from(S.dailyChecklistFieldItem)
        .where(eq(S.dailyChecklistFieldItem.templateItemId, qa))
    ).toHaveLength(0);
    expect(await snapshot(tpl, U.a, "2026-10-07")).toEqual(before); // history untouched
    // via the edit payload: dropping the only selected item of a field is rejected
    const payload = await editPayload(tpl, {});
    payload.items = payload.items.filter((i: any) => i.id !== be);
    expect(
      (await adm.updateChecklistTemplate(W, tpl, payload)).error
    ).toBeDefined();
    expect((await tplOf(tpl)).items).toHaveLength(2); // nothing was written
  });

  it("a newly added assignee gets only the applicable fields", async () => {
    const tpl = await make({
      fields: [
        { name: "Customer", type: "TEXT", appliesToAll: false, itemKeys: [QA] },
      ],
    });
    as(U.admin);
    const r = await adm.updateTemplateAssignments(W, tpl, [U.a, U.dev]);
    expect(r.error).toBeUndefined();
    expect(await snapshot(tpl, U.dev, "2026-10-07")).toEqual({
      Frontend: [],
      Backend: [],
      QA: ["Customer"],
    });
  });

  it("concurrent generation stays idempotent with scoped fields", async () => {
    const tpl = await make({
      assigneeIds: [U.a],
      fields: [
        {
          name: "Customer",
          type: "TEXT",
          appliesToAll: false,
          itemKeys: [FE, BE],
        },
        { name: "Everyone", type: "TEXT" },
      ],
    });
    as(U.admin);
    await Promise.all([
      adm.updateTemplateAssignments(W, tpl, [U.a, U.b]),
      ens.ensureTeamDays(dbm.db, U.b, "2026-10-07", W),
      ens.ensureTeamDays(dbm.db, U.b, "2026-10-07", W),
      gen.runDailyChecklistGenerate({ now: new Date(), workspaceId: W }),
    ]);
    expect(await snapshot(tpl, U.b, "2026-10-07")).toEqual({
      Frontend: ["Customer", "Everyone"],
      Backend: ["Customer", "Everyone"],
      QA: ["Everyone"],
    });
    const rows = await dbm.db
      .select()
      .from(S.dailyChecklistDay)
      .where(
        and(
          eq(S.dailyChecklistDay.templateId, tpl),
          eq(S.dailyChecklistDay.userId, U.b)
        )
      );
    expect(rows).toHaveLength(1);
  });

  it("options and required flags are snapshotted only where the field applies, and gate Done there", async () => {
    const tpl = await make({
      fields: [
        {
          name: "Plan",
          type: "DROPDOWN",
          isRequired: true,
          options: [{ label: "Free" }, { label: "Pro" }],
          appliesToAll: false,
          itemKeys: [FE],
        },
      ],
    });
    const [day] = await dbm.db
      .select()
      .from(S.dailyChecklistDay)
      .where(
        and(
          eq(S.dailyChecklistDay.templateId, tpl),
          eq(S.dailyChecklistDay.userId, U.a)
        )
      );
    const its = await dbm.db
      .select()
      .from(S.dailyChecklistItem)
      .where(eq(S.dailyChecklistItem.dayId, day.id));
    const byTitle = (t: string) => its.find((i: any) => i.title === t);
    const vals = await dbm.db
      .select()
      .from(S.dailyChecklistItemFieldValue)
      .where(eq(S.dailyChecklistItemFieldValue.itemId, byTitle("Frontend").id));
    expect(vals).toHaveLength(1);
    expect(vals[0].fieldRequired).toBe(true);
    expect(vals[0].fieldOptions.map((o: any) => o.value)).toEqual([
      "free",
      "pro",
    ]);
    as(U.a);
    // Backend has no required field → can be completed
    expect(
      (
        await m.updateTeamChecklistItem(W, byTitle("Backend").id, {
          status: "DONE",
        })
      ).error
    ).toBeUndefined();
    // Frontend is blocked until the required field has a value
    expect(
      (
        await m.updateTeamChecklistItem(W, byTitle("Frontend").id, {
          status: "DONE",
        })
      ).error
    ).toBeDefined();
    // a member can't write a field that isn't on that item
    expect(
      (
        await m.setChecklistItemFieldValues(W, byTitle("QA").id, {
          [vals[0].id]: "free",
        })
      ).error
    ).toBe("Unknown field");
    expect(
      (
        await m.setChecklistItemFieldValues(W, byTitle("Frontend").id, {
          [vals[0].id]: "pro",
        })
      ).error
    ).toBeUndefined();
    expect(
      (
        await m.updateTeamChecklistItem(W, byTitle("Frontend").id, {
          status: "DONE",
        })
      ).error
    ).toBeUndefined();
  });

  it("only Owner/Admin can set applicability", async () => {
    const tpl = await make();
    const fe = await itemIdOf(tpl, "Frontend");
    const f = (await tplOf(tpl)).fields[0];
    for (const u of [U.a, U.dev]) {
      as(u);
      expect(
        (
          await adm.createTemplateField(W, tpl, {
            name: "Z",
            type: "TEXT",
            appliesToAll: false,
            itemKeys: [fe],
          })
        ).error
      ).toBe("Forbidden");
      expect(
        (
          await adm.updateTemplateField(W, f.id, {
            name: "Customer",
            type: "TEXT",
            appliesToAll: false,
            itemKeys: [fe],
          })
        ).error
      ).toBe("Forbidden");
    }
    // standalone admin path: update keeps scope when the flag is omitted
    as(U.admin);
    expect(
      (
        await adm.updateTemplateField(W, f.id, {
          name: "Customer",
          type: "TEXT",
          appliesToAll: false,
          itemKeys: [fe],
        })
      ).error
    ).toBeUndefined();
    expect(
      (
        await adm.updateTemplateField(W, f.id, {
          name: "Customer 2",
          type: "TEXT",
        })
      ).error
    ).toBeUndefined();
    expect((await tplOf(tpl)).fields[0]).toMatchObject({
      name: "Customer 2",
      appliesToAll: false,
      itemIds: [fe],
    });
  });
});
