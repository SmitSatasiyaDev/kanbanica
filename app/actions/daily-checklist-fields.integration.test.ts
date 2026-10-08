// Real-Postgres integration tests for Checklist custom fields. Same setup and
// gating as daily-checklist.integration.test.ts (CHECKLIST_TEST_DATABASE_URL, scratch DB).
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
const id = (n: string) => `clf-${rid}-${n}`;
const U = {
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
const as = (u: string | null) => {
  current.userId = u;
};
const at = (iso: string) => vi.setSystemTime(new Date(iso));

type Row = {
  id: string;
  title: string;
  editable: boolean;
  assigneeId: string;
  fields: FieldRow[];
};
type FieldRow = {
  id: string;
  name: string;
  type: string;
  value: string | null;
  options: { label: string; value: string }[] | null;
  required: boolean;
};
const myRow = async (u: string, date?: string): Promise<Row> => {
  as(u);
  const r = await m.getMyTeamChecklist(W, date);
  return r.rows.find((x: Row) => x.assigneeId === u);
};
const byName = (row: Row, name: string) =>
  row.fields.find((f) => f.name === name) as FieldRow;
const opt = (f: FieldRow, label: string) =>
  (f.options as { label: string; value: string }[]).find(
    (o) => o.label === label
  )?.value as string;

run("Checklist custom fields (real DB)", () => {
  let tplId: string;

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
    await db.insert(S.workspace).values([
      { id: W, name: "CLF ws", slug: `clf-${rid}`, createdBy: U.admin },
      { id: W2, name: "CLF ws2", slug: `clf2-${rid}`, createdBy: U.out },
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
    await dbm.db.delete(S.workspace).where(inArray(S.workspace.id, [W, W2]));
    await dbm.db.delete(S.user).where(inArray(S.user.id, Object.values(U)));
    await dbm.dbClient.end();
  });

  const input = (over: Record<string, unknown> = {}) => ({
    name: "Customer Support",
    recurrence: "DAILY",
    startDate: "2026-10-01",
    items: [{ title: "Customer Ticket" }],
    assigneeIds: [U.a, U.b],
    fields: [
      {
        name: "Subscription",
        type: "DROPDOWN",
        options: [
          { label: "Free" },
          { label: "Basic" },
          { label: "Pro" },
          { label: "Enterprise" },
        ],
      },
      {
        name: "Return",
        type: "DROPDOWN",
        options: [{ label: "Yes" }, { label: "No" }, { label: "Pending" }],
      },
      { name: "Refund Amount", type: "NUMBER" },
      { name: "VIP", type: "CHECKBOX" },
      { name: "Follow-up", type: "DATE" },
    ],
    ...over,
  });

  describe("definitions & permissions", () => {
    it("only Owner/Admin can manage field definitions", async () => {
      as(U.admin);
      const created = await adm.createChecklistTemplate(W, input());
      expect(created.id).toBeDefined();
      tplId = created.id;
      const t = (await adm.listChecklistTemplates(W)).templates[0];
      const fieldId = t.fields[0].id;
      for (const u of [U.a, U.guest, U.out]) {
        as(u);
        expect(
          (await adm.createTemplateField(W, tplId, { name: "X", type: "TEXT" }))
            .error
        ).toBe("Forbidden");
        expect(
          (
            await adm.updateTemplateField(W, fieldId, {
              name: "X",
              type: "DROPDOWN",
              options: [{ label: "a" }],
            })
          ).error
        ).toBe("Forbidden");
        expect((await adm.deleteTemplateField(W, fieldId)).error).toBe(
          "Forbidden"
        );
        expect((await adm.reorderTemplateFields(W, tplId, [])).error).toBe(
          "Forbidden"
        );
        expect(
          (await adm.updateChecklistTemplate(W, tplId, input({ fields: [] })))
            .error
        ).toBe("Forbidden");
      }
      as(U.admin);
      expect(
        (await adm.listChecklistTemplates(W)).templates[0].fields
      ).toHaveLength(5);
    });

    it("lists fields in order with option values", async () => {
      as(U.admin);
      const t = (await adm.listChecklistTemplates(W)).templates[0];
      expect(t.fields.map((f: { name: string }) => f.name)).toEqual([
        "Subscription",
        "Return",
        "Refund Amount",
        "VIP",
        "Follow-up",
      ]);
      expect(t.fields[0].options).toEqual([
        { label: "Free", value: "free" },
        { label: "Basic", value: "basic" },
        { label: "Pro", value: "pro" },
        { label: "Enterprise", value: "enterprise" },
      ]);
      expect(t.fields[2].options).toEqual([]);
    });

    it("validates field definitions", async () => {
      as(U.admin);
      const bad = async (field: unknown) =>
        (await adm.createTemplateField(W, tplId, field)).error;
      expect(await bad({ name: "", type: "TEXT" })).toBeDefined();
      expect(await bad({ name: "x".repeat(101), type: "TEXT" })).toBeDefined();
      expect(await bad({ name: "Q", type: "RATING" })).toBeDefined();
      expect(await bad({ name: "Q", type: "DROPDOWN", options: [] })).toMatch(
        /at least one option/
      );
      expect(
        await bad({
          name: "Q",
          type: "DROPDOWN",
          options: [{ label: "A" }, { label: "a" }],
        })
      ).toMatch(/Duplicate option/);
      expect(await bad({ name: "subscription", type: "TEXT" })).toMatch(
        /Duplicate field name/
      );
      // template-level validation too
      expect(
        (
          await adm.createChecklistTemplate(
            W,
            input({ fields: [{ name: "D", type: "DROPDOWN" }] })
          )
        ).error
      ).toBeDefined();
    });

    it("create / edit / reorder / delete a field", async () => {
      as(U.admin);
      const c = await adm.createTemplateField(W, tplId, {
        name: "Ticket ID",
        type: "TEXT",
        isRequired: true,
      });
      expect(c.id).toBeDefined();
      const list = async () =>
        (await adm.listChecklistTemplates(W)).templates.find(
          (t: { id: string }) => t.id === tplId
        );
      let t = await list();
      expect(t.fields.at(-1)).toMatchObject({
        name: "Ticket ID",
        type: "TEXT",
        isRequired: true,
      });

      // edit: rename + required; type can't change
      expect(
        await adm.updateTemplateField(W, c.id, {
          name: "Ticket #",
          type: "TEXT",
          isRequired: false,
        })
      ).toEqual({ ok: true });
      expect(
        (
          await adm.updateTemplateField(W, c.id, {
            name: "Ticket #",
            type: "NUMBER",
          })
        ).error
      ).toMatch(/type can't be changed/);
      t = await list();
      expect(t.fields.at(-1)).toMatchObject({
        name: "Ticket #",
        isRequired: false,
      });

      // dropdown option edit keeps existing values stable
      const sub = t.fields[0];
      expect(
        await adm.updateTemplateField(W, sub.id, {
          name: "Subscription",
          type: "DROPDOWN",
          options: [{ label: "Free" }, { label: "Pro" }, { label: "Team" }],
        })
      ).toEqual({ ok: true });
      t = await list();
      expect(t.fields[0].options).toEqual([
        { label: "Free", value: "free" },
        { label: "Pro", value: "pro" },
        { label: "Team", value: "team" },
      ]);

      // reorder
      const ids = t.fields.map((f: { id: string }) => f.id);
      expect(
        await adm.reorderTemplateFields(W, tplId, [...ids].reverse())
      ).toEqual({ ok: true });
      expect((await list()).fields.map((f: { id: string }) => f.id)).toEqual(
        [...ids].reverse()
      );
      expect(
        (await adm.reorderTemplateFields(W, tplId, ids.slice(1))).error
      ).toBe("Invalid order");

      // delete
      expect(await adm.deleteTemplateField(W, c.id)).toEqual({ ok: true });
      expect(
        (await list()).fields.map((f: { id: string }) => f.id)
      ).not.toContain(c.id);
      expect((await adm.deleteTemplateField(W, c.id)).error).toBe(
        "Field not found"
      );

      // restore the original shape for the scenario below
      await adm.updateTemplateField(W, sub.id, {
        name: "Subscription",
        type: "DROPDOWN",
        options: [
          { label: "Free" },
          { label: "Basic" },
          { label: "Pro" },
          { label: "Enterprise" },
        ],
      });
      await adm.reorderTemplateFields(
        W,
        tplId,
        ids.filter((x: string) => x !== c.id)
      );
      const final = await list();
      expect(final.fields.map((f: { name: string }) => f.name)).toEqual([
        "Subscription",
        "Return",
        "Refund Amount",
        "VIP",
        "Follow-up",
      ]);
    });

    it("cross-workspace admins cannot touch another workspace's fields", async () => {
      as(U.out);
      const t = (await adm.listChecklistTemplates(W2)).templates;
      expect(t).toEqual([]);
      expect(
        (await adm.createTemplateField(W2, tplId, { name: "X", type: "TEXT" }))
          .error
      ).toBe("Template not found");
      const fieldId = (
        await dbm.db
          .select()
          .from(S.dailyChecklistField)
          .where(eq(S.dailyChecklistField.templateId, tplId))
      )[0].id;
      expect(
        (
          await adm.updateTemplateField(W2, fieldId, {
            name: "X",
            type: "TEXT",
          })
        ).error
      ).toBe("Field not found");
      expect((await adm.deleteTemplateField(W2, fieldId)).error).toBe(
        "Field not found"
      );
    });
  });

  describe("values, snapshots and history", () => {
    it("generates a day with the template's fields on every item", async () => {
      const row = await myRow(U.a);
      expect(row.fields.map((f) => f.name)).toEqual([
        "Subscription",
        "Return",
        "Refund Amount",
        "VIP",
        "Follow-up",
      ]);
      expect(byName(row, "Subscription").type).toBe("DROPDOWN");
      expect(byName(row, "Subscription").value).toBeNull();
      expect(byName(row, "Return").options?.map((o) => o.label)).toEqual([
        "Yes",
        "No",
        "Pending",
      ]);
    });

    it("saves and updates values with per-type validation", async () => {
      const row = await myRow(U.a);
      const sub = byName(row, "Subscription");
      const ret = byName(row, "Return");
      const amt = byName(row, "Refund Amount");
      const vip = byName(row, "VIP");
      const fu = byName(row, "Follow-up");

      // invalid values are rejected and nothing is saved
      expect(
        (await m.setChecklistItemFieldValues(W, row.id, { [sub.id]: "gold" }))
          .error
      ).toMatch(/Subscription/);
      expect(
        (await m.setChecklistItemFieldValues(W, row.id, { [amt.id]: "abc" }))
          .error
      ).toMatch(/valid number/);
      expect(
        (await m.setChecklistItemFieldValues(W, row.id, { [vip.id]: "maybe" }))
          .error
      ).toMatch(/true or false/);
      expect(
        (
          await m.setChecklistItemFieldValues(W, row.id, {
            [fu.id]: "2026-02-30",
          })
        ).error
      ).toMatch(/valid date/);
      expect(
        (await m.setChecklistItemFieldValues(W, row.id, { nope: "x" })).error
      ).toBe("Unknown field");
      expect(byName(await myRow(U.a), "Subscription").value).toBeNull();

      expect(
        await m.setChecklistItemFieldValues(W, row.id, {
          [sub.id]: opt(sub, "Pro"),
          [ret.id]: opt(ret, "Pending"),
          [amt.id]: "19.90",
          [vip.id]: "yes",
          [fu.id]: "2026-10-09",
        })
      ).toEqual({ ok: true });
      const saved = await myRow(U.a);
      expect(byName(saved, "Subscription").value).toBe("pro");
      expect(byName(saved, "Return").value).toBe("pending");
      expect(byName(saved, "Refund Amount").value).toBe("19.9");
      expect(byName(saved, "VIP").value).toBe("true");
      expect(byName(saved, "Follow-up").value).toBe("2026-10-09");

      // update + clear
      expect(
        await m.setChecklistItemFieldValues(W, row.id, {
          [ret.id]: opt(ret, "Yes"),
          [amt.id]: "",
        })
      ).toEqual({ ok: true });
      const upd = await myRow(U.a);
      expect(byName(upd, "Return").value).toBe("yes");
      expect(byName(upd, "Refund Amount").value).toBeNull();
      expect(byName(upd, "Subscription").value).toBe("pro"); // untouched
      // restore Return=Pending for the history scenario
      await m.setChecklistItemFieldValues(W, row.id, { [ret.id]: "pending" });
    });

    it("members only edit values on their own items; guests/outsiders can't", async () => {
      const a = await myRow(U.a);
      as(U.b);
      expect(
        (
          await m.setChecklistItemFieldValues(W, a.id, {
            [a.fields[0].id]: "free",
          })
        ).error
      ).toBe("Item not found");
      as(U.guest);
      expect((await m.setChecklistItemFieldValues(W, a.id, {})).error).toBe(
        "Forbidden"
      );
      as(U.out);
      expect((await m.setChecklistItemFieldValues(W2, a.id, {})).error).toBe(
        "Item not found"
      );
      expect((await m.setChecklistItemFieldValues(W, a.id, {})).error).toBe(
        "Forbidden"
      );
      as(U.admin); // admins can view everyone's rows but not edit
      expect(
        (
          await m.setChecklistItemFieldValues(W, a.id, {
            [a.fields[0].id]: "free",
          })
        ).error
      ).toBe("Item not found");
      // a Personal item can't be targeted
      as(U.a);
      const p = await m.createChecklistItem(W, { title: "personal" });
      expect((await m.setChecklistItemFieldValues(W, p.id, {})).error).toBe(
        "Item not found"
      );
    });

    it("users have independent values", async () => {
      const b = await myRow(U.b);
      expect(byName(b, "Subscription").value).toBeNull();
      const sub = byName(b, "Subscription");
      await m.setChecklistItemFieldValues(W, b.id, { [sub.id]: "basic" });
      expect(byName(await myRow(U.b), "Subscription").value).toBe("basic");
      expect(byName(await myRow(U.a), "Subscription").value).toBe("pro");
      // everyone's rows carry their own values when listed together
      as(U.admin);
      const all = (await m.getMyTeamChecklist(W)).rows;
      const vals = all
        .map(
          (r: Row) =>
            `${r.assigneeId === U.a ? "a" : "b"}:${byName(r, "Subscription").value}`
        )
        .sort();
      expect(vals).toEqual(["a:pro", "b:basic"]);
    });

    it("template edits affect future days only; history keeps definitions and values", async () => {
      as(U.admin);
      const t = (await adm.listChecklistTemplates(W)).templates[0];
      // Oct 8: add Ticket ID AND change Subscription's options (drop Pro, add Gold)
      at("2026-10-08T09:00:00Z");
      await adm.createTemplateField(W, tplId, {
        name: "Ticket ID",
        type: "TEXT",
      });
      await adm.updateTemplateField(W, t.fields[0].id, {
        name: "Plan",
        type: "DROPDOWN",
        options: [{ label: "Free" }, { label: "Gold" }],
      });

      const d8 = await myRow(U.a);
      expect(d8.fields.map((f) => f.name)).toEqual([
        "Plan",
        "Return",
        "Refund Amount",
        "VIP",
        "Follow-up",
        "Ticket ID",
      ]);
      expect(byName(d8, "Plan").options?.map((o) => o.label)).toEqual([
        "Free",
        "Gold",
      ]);
      expect(d8.fields.every((f) => f.value === null)).toBe(true);

      const d7 = await myRow(U.a, "2026-10-07");
      expect(d7.fields.map((f) => f.name)).toEqual([
        "Subscription",
        "Return",
        "Refund Amount",
        "VIP",
        "Follow-up",
      ]);
      expect(d7.fields.some((f) => f.name === "Ticket ID")).toBe(false);
      expect(byName(d7, "Subscription").value).toBe("pro");
      expect(byName(d7, "Subscription").options?.map((o) => o.label)).toContain(
        "Pro"
      );
      expect(byName(d7, "Return").value).toBe("pending");
      expect(byName(d7, "VIP").value).toBe("true");
      expect(byName(d7, "Follow-up").value).toBe("2026-10-09");

      // Oct 7 is read-only
      expect(
        (
          await m.setChecklistItemFieldValues(W, d7.id, {
            [byName(d7, "Return").id]: "no",
          })
        ).error
      ).toMatch(/read-only/i);

      // History detail shows the stored snapshot, including for an admin
      as(U.admin);
      const hist = await adm.getTeamChecklistHistory(W);
      const day7 = hist.rows.find(
        (r: { date: string; userId: string }) =>
          r.date === "2026-10-07" && r.userId === U.a
      );
      const detail = await m.getChecklistDay(W, day7.dayId);
      expect(
        detail.items[0].fields.map((f: FieldRow) => `${f.name}=${f.value}`)
      ).toEqual([
        "Subscription=pro",
        "Return=pending",
        "Refund Amount=null",
        "VIP=true",
        "Follow-up=2026-10-09",
      ]);

      // Oct 8 can be filled using its own (new) options
      as(U.a);
      expect(
        (
          await m.setChecklistItemFieldValues(W, d8.id, {
            [byName(d8, "Plan").id]: "pro",
          })
        ).error
      ).toMatch(/Plan/);
      expect(
        await m.setChecklistItemFieldValues(W, d8.id, {
          [byName(d8, "Plan").id]: "gold",
          [byName(d8, "Ticket ID").id]: "TK-1024",
        })
      ).toEqual({ ok: true });
      expect(byName(await myRow(U.a), "Ticket ID").value).toBe("TK-1024");
      // …and Oct 7 is still untouched
      expect(byName(await myRow(U.a, "2026-10-07"), "Subscription").value).toBe(
        "pro"
      );
    });

    it("deleting a field keeps saved days readable (snapshot)", async () => {
      as(U.admin);
      const t = (await adm.listChecklistTemplates(W)).templates[0];
      const vip = t.fields.find((f: { name: string }) => f.name === "VIP");
      expect(await adm.deleteTemplateField(W, vip.id)).toEqual({ ok: true });
      const d7 = await myRow(U.a, "2026-10-07");
      expect(byName(d7, "VIP")).toMatchObject({
        value: "true",
        type: "CHECKBOX",
      });
      at("2026-10-09T09:00:00Z");
      const d9 = await myRow(U.a);
      expect(d9.fields.some((f) => f.name === "VIP")).toBe(false);
    });

    it("required fields must be filled before an item can be Done", async () => {
      as(U.admin);
      const t = (await adm.listChecklistTemplates(W)).templates[0];
      await adm.updateTemplateField(
        W,
        t.fields.find((f: { name: string }) => f.name === "Ticket ID").id,
        { name: "Ticket ID", type: "TEXT", isRequired: true }
      );
      at("2026-10-10T09:00:00Z");
      const row = await myRow(U.a);
      expect(byName(row, "Ticket ID").required).toBe(true);
      expect(
        (await m.updateTeamChecklistItem(W, row.id, { status: "DONE" })).error
      ).toMatch(/Ticket ID/);
      await m.setChecklistItemFieldValues(W, row.id, {
        [byName(row, "Ticket ID").id]: "TK-1",
      });
      expect(
        await m.updateTeamChecklistItem(W, row.id, { status: "DONE" })
      ).toEqual({ ok: true });
    });

    it("duplicate value rows per item+field are impossible", async () => {
      const row = await myRow(U.a);
      const f = byName(row, "Ticket ID");
      const [src] = await dbm.db
        .select()
        .from(S.dailyChecklistItemFieldValue)
        .where(eq(S.dailyChecklistItemFieldValue.id, f.id));
      await expect(
        dbm.db
          .insert(S.dailyChecklistItemFieldValue)
          .values({ ...src, id: id("dupval") })
      ).rejects.toThrow();
    });
  });
});
