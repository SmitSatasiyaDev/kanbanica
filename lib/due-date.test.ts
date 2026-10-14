import { describe, expect, it } from "vitest";
import {
  daysBetween,
  dueStatus,
  formatDay,
  formatDayWithWeekday,
  isValidTimeZone,
  msUntilNextMidnightInTz,
  resolveTimezone,
  startOfDayInTz,
  toDay,
  todayInTz,
  weekRange,
} from "@/lib/due-date";

describe("todayInTz", () => {
  // 2026-10-11 20:00 UTC == 2026-10-12 01:30 in Asia/Kolkata == 2026-10-11 16:00 in New York
  const instant = new Date("2026-10-11T20:00:00Z");

  it("returns the calendar day in each zone", () => {
    expect(todayInTz("UTC", instant)).toBe("2026-10-11");
    expect(todayInTz("Asia/Kolkata", instant)).toBe("2026-10-12");
    expect(todayInTz("America/New_York", instant)).toBe("2026-10-11");
  });

  it("flips exactly at local midnight", () => {
    expect(todayInTz("Asia/Kolkata", new Date("2026-10-11T18:29:59Z"))).toBe(
      "2026-10-11"
    );
    expect(todayInTz("Asia/Kolkata", new Date("2026-10-11T18:30:00Z"))).toBe(
      "2026-10-12"
    );
  });

  it("handles the US DST change", () => {
    // DST ended 2026-11-01 02:00 local (06:00 UTC).
    expect(
      todayInTz("America/New_York", new Date("2026-11-01T05:59:00Z"))
    ).toBe("2026-11-01");
    expect(
      todayInTz("America/New_York", new Date("2026-11-02T04:59:00Z"))
    ).toBe("2026-11-01");
    expect(
      todayInTz("America/New_York", new Date("2026-11-02T05:00:00Z"))
    ).toBe("2026-11-02");
  });

  it("falls back to UTC for an invalid zone", () => {
    expect(todayInTz("Not/AZone", instant)).toBe("2026-10-11");
  });
});

describe("timezone validation", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Nope/Nope")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(resolveTimezone("Nope/Nope")).toBe("UTC");
    expect(resolveTimezone("Europe/Paris")).toBe("Europe/Paris");
  });
});

describe("dueStatus", () => {
  it("a task due today is never overdue", () => {
    expect(dueStatus("2026-10-12", "2026-10-12")).toBe("today");
  });
  it("classifies other days", () => {
    expect(dueStatus("2026-10-11", "2026-10-12")).toBe("overdue");
    expect(dueStatus("2026-10-13", "2026-10-12")).toBe("tomorrow");
    expect(dueStatus("2026-10-20", "2026-10-12")).toBe("later");
  });
  it("tomorrow rolls over month ends", () => {
    expect(dueStatus("2026-11-01", "2026-10-31")).toBe("tomorrow");
  });
});

describe("weekRange", () => {
  it("Sunday-start and Monday-start weeks", () => {
    // 2026-10-12 is a Monday
    expect(weekRange("2026-10-12", 0)).toEqual({
      from: "2026-10-11",
      to: "2026-10-17",
    });
    expect(weekRange("2026-10-12", 1)).toEqual({
      from: "2026-10-12",
      to: "2026-10-18",
    });
    expect(weekRange("2026-10-11", 1)).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
  });
});

describe("day helpers", () => {
  it("daysBetween", () => {
    expect(daysBetween("2026-10-12", "2026-10-15")).toBe(3);
    expect(daysBetween("2026-10-12", "2026-10-09")).toBe(-3);
    expect(daysBetween("2026-10-12", "2026-10-12")).toBe(0);
  });
  it("toDay normalises strings and rejects junk", () => {
    expect(toDay("2026-10-12")).toBe("2026-10-12");
    expect(toDay("2026-10-12T00:00:00.000Z")).toBe("2026-10-12");
    expect(toDay("garbage")).toBeNull();
    expect(toDay(null)).toBeNull();
  });
  it("formatDay is timezone-free", () => {
    expect(formatDay("2030-01-05")).toBe("Jan 5");
    expect(formatDay("2030-01-05", true)).toBe("Jan 5, 2030");
    expect(formatDayWithWeekday("2026-10-12")).toBe("Mon, Oct 12");
  });
});

describe("msUntilNextMidnightInTz", () => {
  it("counts down to the zone's own midnight", () => {
    // 18:00 UTC == 23:30 IST -> 30 min to midnight
    const ms = msUntilNextMidnightInTz(
      "Asia/Kolkata",
      new Date("2026-10-11T18:00:00Z")
    );
    expect(ms).toBe(30 * 60 * 1000 + 250);
  });
});

describe("startOfDayInTz", () => {
  it("returns the instant the zone's current day began", () => {
    // 2026-10-11 20:00Z is 01:30 on Oct 12 in Kolkata -> the day began 18:30Z.
    expect(
      startOfDayInTz(
        "Asia/Kolkata",
        new Date("2026-10-11T20:00:00Z")
      ).toISOString()
    ).toBe("2026-10-11T18:30:00.000Z");
    expect(
      startOfDayInTz("UTC", new Date("2026-10-11T20:00:00.123Z")).toISOString()
    ).toBe("2026-10-11T00:00:00.000Z");
  });
});
