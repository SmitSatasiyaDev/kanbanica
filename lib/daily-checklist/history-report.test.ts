import { describe, expect, it } from "vitest";
import {
  addDays,
  clampPage,
  daySpan,
  defaultRange,
  isDayOverdue,
  pageCountFor,
  pageWindow,
  parseHistoryStatus,
} from "./history-report";

describe("history report helpers", () => {
  it("addDays / daySpan are plain calendar math (month + year boundaries)", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daySpan("2026-09-01", "2026-09-30")).toBe(30);
    expect(daySpan("2026-10-08", "2026-10-08")).toBe(1);
  });

  it("default range is the last 30 days ending today", () => {
    expect(defaultRange("2026-10-08")).toEqual({
      from: "2026-09-09",
      to: "2026-10-08",
    });
  });

  it("overdue = unfinished AND the date is already over", () => {
    expect(isDayOverdue("2026-10-07", "2026-10-08", 1, 3)).toBe(true);
    expect(isDayOverdue("2026-10-07", "2026-10-08", 0, 3)).toBe(true);
    expect(isDayOverdue("2026-10-07", "2026-10-08", 3, 3)).toBe(false);
    expect(isDayOverdue("2026-10-08", "2026-10-08", 0, 3)).toBe(false); // today
    expect(isDayOverdue("2026-10-07", "2026-10-08", 0, 0)).toBe(false); // empty
  });

  it("paging: counts, clamping and the number window", () => {
    expect(pageCountFor(0, 20)).toBe(1);
    expect(pageCountFor(20, 20)).toBe(1);
    expect(pageCountFor(21, 20)).toBe(2);
    expect(clampPage(undefined, 3)).toBe(1);
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(99, 3)).toBe(3);
    expect(clampPage(Number.NaN, 3)).toBe(1);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });

  it("parses only known status params", () => {
    expect(parseHistoryStatus("NOT_STARTED")).toBe("NOT_STARTED");
    expect(parseHistoryStatus("OVERDUE")).toBeUndefined();
    expect(parseHistoryStatus("nope")).toBeUndefined();
    expect(parseHistoryStatus(null)).toBeUndefined();
  });
});
