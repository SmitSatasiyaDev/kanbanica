import { describe, expect, it } from "vitest";
import { formatSavedFieldValue, summarizeFieldValues } from "./field-summary";
import type { FieldValueDTO } from "./types";

const f = (over: Partial<FieldValueDTO>): FieldValueDTO => ({
  id: "x",
  name: "F",
  type: "TEXT",
  required: false,
  options: null,
  sortOrder: 0,
  value: null,
  ...over,
});
const line = (fields: FieldValueDTO[]) =>
  summarizeFieldValues(fields)
    .map((e) => `${e.label}: ${e.text}`)
    .join(" · ");

describe("summarizeFieldValues", () => {
  it("single field", () => {
    expect(line([f({ name: "Check", value: "hey2" })])).toBe("Check: hey2");
  });
  it("multiple fields joined", () => {
    expect(
      line([
        f({ id: "1", name: "Subscription", value: "Pro" }),
        f({ id: "2", name: "Return", value: "Pending", sortOrder: 1 }),
      ])
    ).toBe("Subscription: Pro · Return: Pending");
  });
  it("skips empty / null / blank values", () => {
    expect(
      line([
        f({ id: "1", name: "Subscription", value: "Pro" }),
        f({ id: "2", name: "Return", value: null, sortOrder: 1 }),
        f({ id: "3", name: "Ticket ID", value: "  ", sortOrder: 2 }),
      ])
    ).toBe("Subscription: Pro");
    expect(line([f({ value: null })])).toBe("");
  });
  it("shows the dropdown label, never the stored value", () => {
    const opts = [{ label: "Pro Plan", value: "pro" }];
    expect(
      line([
        f({
          name: "Subscription",
          type: "DROPDOWN",
          options: opts,
          value: "pro",
        }),
      ])
    ).toBe("Subscription: Pro Plan");
    // a stored value whose option vanished from the snapshot falls back to the raw value
    expect(
      formatSavedFieldValue(f({ type: "DROPDOWN", options: [], value: "gone" }))
    ).toBe("gone");
  });
  it("formats each type", () => {
    expect(formatSavedFieldValue(f({ type: "NUMBER", value: "250" }))).toBe(
      "250"
    );
    expect(
      formatSavedFieldValue(f({ type: "DATE", value: "2026-10-10" }))
    ).toBe("Oct 10, 2026");
    expect(formatSavedFieldValue(f({ type: "CHECKBOX", value: "true" }))).toBe(
      "Yes"
    );
    expect(formatSavedFieldValue(f({ type: "CHECKBOX", value: "false" }))).toBe(
      "No"
    );
  });
  it("keeps the template order, not alphabetical", () => {
    expect(
      line([
        f({ id: "c", name: "Ticket ID", value: "TK-1", sortOrder: 2 }),
        f({ id: "a", name: "Subscription", value: "Pro", sortOrder: 0 }),
        f({ id: "b", name: "Return", value: "Pending", sortOrder: 1 }),
      ])
    ).toBe("Subscription: Pro · Return: Pending · Ticket ID: TK-1");
  });
  it("handles missing fields", () => {
    expect(summarizeFieldValues(undefined)).toEqual([]);
  });
});
