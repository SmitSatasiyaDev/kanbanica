import { describe, expect, it } from "vitest";
import { isMissing, normalizeFieldValue, optionValueFor } from "./fields";
import { fieldSchema, templateSchema } from "./validation";

const f = (
  type: never,
  options: { label: string; value: string }[] | null = null,
  required = false
) => ({
  type,
  options,
  required,
});

describe("normalizeFieldValue", () => {
  it("treats blank as unset for every type", () => {
    for (const t of ["TEXT", "NUMBER", "DATE", "CHECKBOX", "DROPDOWN"]) {
      expect(normalizeFieldValue(f(t as never), "  ")).toEqual({
        ok: true,
        value: null,
      });
      expect(normalizeFieldValue(f(t as never), null)).toEqual({
        ok: true,
        value: null,
      });
    }
  });
  it("TEXT trims and bounds length", () => {
    expect(normalizeFieldValue(f("TEXT" as never), " TK-1 ")).toEqual({
      ok: true,
      value: "TK-1",
    });
    expect(normalizeFieldValue(f("TEXT" as never), "x".repeat(501)).ok).toBe(
      false
    );
    expect(normalizeFieldValue(f("TEXT" as never), 5).ok).toBe(false);
  });
  it("NUMBER accepts valid numbers only", () => {
    expect(normalizeFieldValue(f("NUMBER" as never), "12.50")).toEqual({
      ok: true,
      value: "12.5",
    });
    expect(normalizeFieldValue(f("NUMBER" as never), "-3")).toEqual({
      ok: true,
      value: "-3",
    });
    expect(normalizeFieldValue(f("NUMBER" as never), 7)).toEqual({
      ok: true,
      value: "7",
    });
    for (const bad of ["abc", "1e5", "1,5", "NaN", "Infinity", "1.2.3"]) {
      expect(normalizeFieldValue(f("NUMBER" as never), bad).ok).toBe(false);
    }
  });
  it("DATE needs a real calendar date", () => {
    expect(normalizeFieldValue(f("DATE" as never), "2026-10-07").ok).toBe(true);
    expect(normalizeFieldValue(f("DATE" as never), "2026-02-30").ok).toBe(
      false
    );
    expect(normalizeFieldValue(f("DATE" as never), "07/10/2026").ok).toBe(
      false
    );
  });
  it("CHECKBOX canonicalises boolean representations", () => {
    for (const t of ["true", "1", "YES", true]) {
      expect(normalizeFieldValue(f("CHECKBOX" as never), t)).toEqual({
        ok: true,
        value: "true",
      });
    }
    for (const t of ["false", "0", "no", false]) {
      expect(normalizeFieldValue(f("CHECKBOX" as never), t)).toEqual({
        ok: true,
        value: "false",
      });
    }
    expect(normalizeFieldValue(f("CHECKBOX" as never), "maybe").ok).toBe(false);
  });
  it("DROPDOWN only accepts a configured option value", () => {
    const opts = [{ label: "Pro", value: "pro" }];
    expect(normalizeFieldValue(f("DROPDOWN" as never, opts), "pro")).toEqual({
      ok: true,
      value: "pro",
    });
    expect(normalizeFieldValue(f("DROPDOWN" as never, opts), "Pro").ok).toBe(
      false
    );
    expect(normalizeFieldValue(f("DROPDOWN" as never, opts), "gold").ok).toBe(
      false
    );
    expect(normalizeFieldValue(f("DROPDOWN" as never, null), "pro").ok).toBe(
      false
    );
  });
});

describe("isMissing", () => {
  it("only applies to required fields", () => {
    expect(isMissing({ required: false, type: "TEXT" }, null)).toBe(false);
    expect(isMissing({ required: true, type: "TEXT" }, null)).toBe(true);
    expect(isMissing({ required: true, type: "TEXT" }, "x")).toBe(false);
    expect(isMissing({ required: true, type: "CHECKBOX" }, "false")).toBe(true);
    expect(isMissing({ required: true, type: "CHECKBOX" }, "true")).toBe(false);
  });
});

describe("optionValueFor", () => {
  it("slugifies and keeps values unique", () => {
    const taken = new Set<string>();
    expect(optionValueFor("Enterprise Plan", taken)).toBe("enterprise-plan");
    expect(optionValueFor("enterprise  plan!", taken)).toBe(
      "enterprise-plan-2"
    );
    expect(optionValueFor("???", taken)).toBe("option");
  });
});

describe("fieldSchema", () => {
  const ok = {
    name: "Subscription",
    type: "DROPDOWN",
    options: [{ label: "Free" }, { label: "Pro" }],
  };
  it("accepts a dropdown with options", () => {
    expect(fieldSchema.safeParse(ok).success).toBe(true);
  });
  it("requires a name within the max length", () => {
    expect(fieldSchema.safeParse({ ...ok, name: " " }).success).toBe(false);
    expect(
      fieldSchema.safeParse({ ...ok, name: "x".repeat(101) }).success
    ).toBe(false);
  });
  it("rejects unsupported types", () => {
    expect(fieldSchema.safeParse({ ...ok, type: "RATING" }).success).toBe(
      false
    );
  });
  it("dropdown needs ≥1 option and no duplicates (case-insensitive)", () => {
    expect(fieldSchema.safeParse({ ...ok, options: [] }).success).toBe(false);
    expect(
      fieldSchema.safeParse({
        ...ok,
        options: [{ label: "Pro" }, { label: "pro" }],
      }).success
    ).toBe(false);
    expect(
      fieldSchema.safeParse({ ...ok, options: [{ label: " " }] }).success
    ).toBe(false);
  });
  it("drops options for non-dropdown types", () => {
    const v = fieldSchema.parse({
      name: "Ticket ID",
      type: "TEXT",
      options: [{ label: "x" }],
    });
    expect(v.options).toEqual([]);
    expect(v.isRequired).toBe(false);
  });
});

describe("templateSchema fields", () => {
  const base = { name: "T", recurrence: "DAILY", startDate: "2026-10-07" };
  it("rejects duplicate field names", () => {
    const r = templateSchema.safeParse({
      ...base,
      fields: [
        { name: "Customer", type: "TEXT" },
        { name: "customer", type: "TEXT" },
      ],
    });
    expect(r.success).toBe(false);
  });
  it("defaults to no fields", () => {
    expect(templateSchema.parse(base).fields).toEqual([]);
  });
});
