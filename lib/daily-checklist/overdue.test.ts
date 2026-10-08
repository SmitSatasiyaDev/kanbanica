import { describe, expect, it } from "vitest";
import { isOverdue, isRowOverdue } from "./overdue";

const base = {
  date: "2026-10-07",
  dueTime: "16:30",
  status: "PENDING",
  timeZone: "UTC",
};
const at = (iso: string) => new Date(iso);

describe("isOverdue", () => {
  it("pending before the due time → not overdue", () => {
    expect(isOverdue({ ...base, now: at("2026-10-07T15:59:00Z") })).toBe(false);
  });
  it("pending after the due time → overdue", () => {
    expect(isOverdue({ ...base, now: at("2026-10-07T16:31:00Z") })).toBe(true);
  });
  it("in progress after the due time → overdue", () => {
    expect(
      isOverdue({
        ...base,
        status: "IN_PROGRESS",
        now: at("2026-10-07T18:00:00Z"),
      })
    ).toBe(true);
  });
  it("done after the due time → not overdue", () => {
    expect(
      isOverdue({ ...base, status: "DONE", now: at("2026-10-07T18:00:00Z") })
    ).toBe(false);
  });
  it("future checklist day → not overdue", () => {
    expect(
      isOverdue({
        ...base,
        date: "2026-10-08",
        now: at("2026-10-07T23:00:00Z"),
      })
    ).toBe(false);
  });
  it("historical day is never overdue (even though its time is long past)", () => {
    expect(
      isOverdue({
        ...base,
        date: "2026-10-06",
        now: at("2026-10-07T10:00:00Z"),
      })
    ).toBe(false);
    // Oct 7 at 18:00 is overdue; once it is Oct 8 the Oct 7 day is history
    expect(isOverdue({ ...base, now: at("2026-10-07T18:00:00Z") })).toBe(true);
    expect(isOverdue({ ...base, now: at("2026-10-08T00:01:00Z") })).toBe(false);
  });
  it("no due time → not overdue", () => {
    expect(
      isOverdue({ ...base, dueTime: null, now: at("2026-10-07T23:00:00Z") })
    ).toBe(false);
  });
  it("exact boundary: not overdue at the due minute, overdue the next minute", () => {
    expect(isOverdue({ ...base, now: at("2026-10-07T16:30:00Z") })).toBe(false);
    expect(isOverdue({ ...base, now: at("2026-10-07T16:30:59Z") })).toBe(false);
    expect(isOverdue({ ...base, now: at("2026-10-07T16:31:00Z") })).toBe(true);
  });
  it("respects the assignee's timezone", () => {
    // 11:30Z = 17:00 in Kolkata (past 16:30) but 07:30 in New York (before it)
    const now = at("2026-10-07T11:30:00Z");
    expect(isOverdue({ ...base, timeZone: "Asia/Kolkata", now })).toBe(true);
    expect(isOverdue({ ...base, timeZone: "America/New_York", now })).toBe(
      false
    );
  });
  it("only counts as today in that timezone's own date", () => {
    // 2026-10-07T20:00Z is already Oct 8 in Kolkata → the Oct 7 day is history there
    const now = at("2026-10-07T20:00:00Z");
    expect(isOverdue({ ...base, timeZone: "Asia/Kolkata", now })).toBe(false);
    expect(isOverdue({ ...base, timeZone: "UTC", now })).toBe(true);
  });
  it("is DST-aware (America/New_York)", () => {
    // EDT (UTC-4): 20:31Z = 16:31 local → overdue; EST (UTC-5): 20:31Z = 15:31 → not
    expect(
      isOverdue({
        ...base,
        date: "2026-10-07",
        timeZone: "America/New_York",
        now: at("2026-10-07T20:31:00Z"),
      })
    ).toBe(true);
    expect(
      isOverdue({
        ...base,
        date: "2026-12-07",
        timeZone: "America/New_York",
        now: at("2026-12-07T20:31:00Z"),
      })
    ).toBe(false);
    expect(
      isOverdue({
        ...base,
        date: "2026-12-07",
        timeZone: "America/New_York",
        now: at("2026-12-07T21:31:00Z"),
      })
    ).toBe(true);
  });
  it("falls back to UTC for an unknown timezone", () => {
    expect(
      isOverdue({
        ...base,
        timeZone: "Not/AZone",
        now: at("2026-10-07T16:31:00Z"),
      })
    ).toBe(true);
  });
});

describe("isRowOverdue", () => {
  it("uses the row's day date and assignee timezone", () => {
    const row = {
      assigneeTimezone: "Asia/Kolkata",
      date: "2026-10-07",
      dueTime: "16:30",
      status: "PENDING",
    };
    expect(isRowOverdue(row, at("2026-10-07T11:30:00Z"))).toBe(true);
    expect(
      isRowOverdue({ ...row, status: "DONE" }, at("2026-10-07T11:30:00Z"))
    ).toBe(false);
  });
});
