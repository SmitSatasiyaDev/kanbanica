import { describe, expect, it } from "vitest";
import { occursOn, type RecurrenceRule, weekdayOf } from "./recurrence";

const rule = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
  recurrence: "DAILY",
  recurrenceDays: [],
  startDate: "2026-10-01",
  endDate: null,
  ...over,
});

// 2026-10-05 is a Monday … 2026-10-11 is a Sunday.
describe("weekdayOf", () => {
  it("is calendar math independent of the host timezone", () => {
    expect(weekdayOf("2026-10-05")).toBe(1);
    expect(weekdayOf("2026-10-10")).toBe(6);
    expect(weekdayOf("2026-10-11")).toBe(0);
  });
});

describe("occursOn — ONCE (Does not repeat)", () => {
  const once = rule({ recurrence: "ONCE", startDate: "2026-10-08" });
  it("occurs only on the start date", () => {
    expect(occursOn(once, "2026-10-08")).toBe(true);
    expect(occursOn(once, "2026-10-07")).toBe(false);
    for (const d of ["2026-10-09", "2026-10-10", "2026-10-11", "2026-11-08"]) {
      expect(occursOn(once, d)).toBe(false);
    }
  });
  it("ignores a stray end date and recurrence days", () => {
    const r = rule({ ...once, endDate: "2026-10-01", recurrenceDays: [4] });
    expect(occursOn(r, "2026-10-08")).toBe(true);
    expect(occursOn(r, "2026-10-15")).toBe(false);
  });
});

describe("occursOn", () => {
  it("DAILY occurs every day inside the range", () => {
    for (const d of ["2026-10-01", "2026-10-10", "2026-10-11"]) {
      expect(occursOn(rule({}), d)).toBe(true);
    }
  });

  it("WEEKDAYS skips Saturday and Sunday", () => {
    const r = rule({ recurrence: "WEEKDAYS" });
    expect(occursOn(r, "2026-10-05")).toBe(true); // Mon
    expect(occursOn(r, "2026-10-09")).toBe(true); // Fri
    expect(occursOn(r, "2026-10-10")).toBe(false); // Sat
    expect(occursOn(r, "2026-10-11")).toBe(false); // Sun
  });

  it("WEEKLY repeats on the chosen day", () => {
    const r = rule({ recurrence: "WEEKLY", recurrenceDays: [3] });
    expect(occursOn(r, "2026-10-07")).toBe(true); // Wed
    expect(occursOn(r, "2026-10-14")).toBe(true);
    expect(occursOn(r, "2026-10-08")).toBe(false);
  });

  it("WEEKLY without a day falls back to the start date's weekday", () => {
    const r = rule({ recurrence: "WEEKLY", startDate: "2026-10-06" }); // Tue
    expect(occursOn(r, "2026-10-13")).toBe(true);
    expect(occursOn(r, "2026-10-14")).toBe(false);
  });

  it("CUSTOM uses the selected weekdays only", () => {
    const r = rule({ recurrence: "CUSTOM", recurrenceDays: [1, 3, 6] });
    expect(occursOn(r, "2026-10-05")).toBe(true); // Mon
    expect(occursOn(r, "2026-10-07")).toBe(true); // Wed
    expect(occursOn(r, "2026-10-10")).toBe(true); // Sat
    expect(occursOn(r, "2026-10-06")).toBe(false); // Tue
  });

  it("CUSTOM with no days never occurs", () => {
    expect(occursOn(rule({ recurrence: "CUSTOM" }), "2026-10-05")).toBe(false);
  });

  it("respects start and end dates inclusively (date boundary)", () => {
    const r = rule({ startDate: "2026-10-05", endDate: "2026-10-07" });
    expect(occursOn(r, "2026-10-04")).toBe(false);
    expect(occursOn(r, "2026-10-05")).toBe(true);
    expect(occursOn(r, "2026-10-07")).toBe(true);
    expect(occursOn(r, "2026-10-08")).toBe(false);
  });

  it("works across month and year boundaries", () => {
    const r = rule({ startDate: "2026-12-30", endDate: "2027-01-02" });
    expect(occursOn(r, "2026-12-31")).toBe(true);
    expect(occursOn(r, "2027-01-02")).toBe(true);
    expect(occursOn(r, "2027-01-03")).toBe(false);
  });
});
