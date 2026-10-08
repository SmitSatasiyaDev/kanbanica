import { describe, expect, it } from "vitest";
import { computeProgress, dayStatus } from "./progress";
import { itemFieldsSchema, templateSchema } from "./validation";

describe("computeProgress", () => {
  it("is safe for zero items", () => {
    expect(computeProgress([])).toEqual({ completed: 0, total: 0, percent: 0 });
  });
  it("counts only DONE", () => {
    expect(
      computeProgress([
        "DONE",
        "DONE",
        "PENDING",
        "IN_PROGRESS",
        "DONE",
        "PENDING",
      ])
    ).toEqual({
      completed: 3,
      total: 6,
      percent: 50,
    });
    expect(computeProgress({ completed: 4, total: 6 }).percent).toBe(67);
  });
});

describe("dayStatus", () => {
  it("classifies days", () => {
    expect(dayStatus(0, 0)).toBe("EMPTY");
    expect(dayStatus(0, 5)).toBe("NOT_STARTED");
    expect(dayStatus(0, 5, true)).toBe("IN_PROGRESS");
    expect(dayStatus(2, 5)).toBe("IN_PROGRESS");
    expect(dayStatus(5, 5)).toBe("COMPLETE");
  });
});

describe("itemFieldsSchema", () => {
  it("requires a title and bounds its length", () => {
    expect(itemFieldsSchema.safeParse({ title: "  " }).success).toBe(false);
    expect(itemFieldsSchema.safeParse({ title: "x".repeat(201) }).success).toBe(
      false
    );
    expect(itemFieldsSchema.safeParse({ title: "ok" }).success).toBe(true);
  });
  it("validates priority and due time", () => {
    expect(
      itemFieldsSchema.safeParse({ title: "a", priority: "BOGUS" }).success
    ).toBe(false);
    expect(
      itemFieldsSchema.safeParse({ title: "a", dueTime: "25:00" }).success
    ).toBe(false);
    expect(
      itemFieldsSchema.safeParse({ title: "a", dueTime: "09:30" }).success
    ).toBe(true);
  });
});

describe("templateSchema", () => {
  const base = { name: "T", recurrence: "DAILY", startDate: "2026-10-07" };
  it("accepts a minimal template", () => {
    expect(templateSchema.safeParse(base).success).toBe(true);
  });
  it("rejects impossible dates and end < start", () => {
    expect(
      templateSchema.safeParse({ ...base, startDate: "2026-02-30" }).success
    ).toBe(false);
    expect(
      templateSchema.safeParse({ ...base, endDate: "2026-10-01" }).success
    ).toBe(false);
  });
  it("requires weekdays for CUSTOM and normalises days", () => {
    expect(
      templateSchema.safeParse({ ...base, recurrence: "CUSTOM" }).success
    ).toBe(false);
    const ok = templateSchema.parse({
      ...base,
      recurrence: "CUSTOM",
      recurrenceDays: [3, 1, 3],
    });
    expect(ok.recurrenceDays).toEqual([1, 3]);
  });
  it("drops weekdays for DAILY/WEEKDAYS and de-duplicates assignees", () => {
    const v = templateSchema.parse({
      ...base,
      recurrenceDays: [1],
      assigneeIds: ["a", "a", "b"],
    });
    expect(v.recurrenceDays).toEqual([]);
    expect(v.assigneeIds).toEqual(["a", "b"]);
  });
  it("ONCE: needs no end date, ignores weekdays and drops any stray end date", () => {
    const v = templateSchema.parse({
      ...base,
      recurrence: "ONCE",
      recurrenceDays: [1, 2],
      endDate: "2026-10-01", // before start — would be invalid for a recurring template
    });
    expect(v.endDate).toBeNull();
    expect(v.recurrenceDays).toEqual([]);
    expect(
      templateSchema.safeParse({ ...base, recurrence: "ONCE" }).success
    ).toBe(true);
    expect(
      templateSchema.safeParse({ recurrence: "ONCE", name: "T" }).success
    ).toBe(false); // start required
  });
  it("rejects an unknown recurrence", () => {
    expect(
      templateSchema.safeParse({ ...base, recurrence: "MONTHLY" }).success
    ).toBe(false);
  });
});
