import { describe, expect, it } from "vitest";
import { localTime, todayInTz } from "./local-date";

describe("todayInTz — midnight rollover", () => {
  // 2026-10-07T23:30:00Z
  const lateUtc = new Date("2026-10-07T23:30:00Z");

  it("UTC stays on the same date", () => {
    expect(todayInTz(lateUtc, "UTC")).toBe("2026-10-07");
  });

  it("a zone ahead of UTC has already rolled to the next day", () => {
    expect(todayInTz(lateUtc, "Asia/Kolkata")).toBe("2026-10-08"); // +05:30
    expect(todayInTz(lateUtc, "Pacific/Auckland")).toBe("2026-10-08");
  });

  it("a zone behind UTC is still on the previous day early in UTC's day", () => {
    const earlyUtc = new Date("2026-10-08T02:00:00Z");
    expect(todayInTz(earlyUtc, "America/Los_Angeles")).toBe("2026-10-07");
    expect(todayInTz(earlyUtc, "UTC")).toBe("2026-10-08");
  });

  it("flips exactly at local midnight", () => {
    // Kolkata midnight 2026-10-08 00:00 IST = 2026-10-07T18:30:00Z
    expect(todayInTz(new Date("2026-10-07T18:29:59Z"), "Asia/Kolkata")).toBe(
      "2026-10-07"
    );
    expect(todayInTz(new Date("2026-10-07T18:30:00Z"), "Asia/Kolkata")).toBe(
      "2026-10-08"
    );
  });

  it("handles a DST transition day", () => {
    // US fall-back 2026-11-01: 05:30Z is still Nov 1 in New York (01:30 EDT/EST).
    expect(
      todayInTz(new Date("2026-11-01T05:30:00Z"), "America/New_York")
    ).toBe("2026-11-01");
    expect(
      todayInTz(new Date("2026-11-02T04:59:00Z"), "America/New_York")
    ).toBe("2026-11-01");
    expect(
      todayInTz(new Date("2026-11-02T05:00:00Z"), "America/New_York")
    ).toBe("2026-11-02");
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(todayInTz(lateUtc, "Not/AZone")).toBe("2026-10-07");
  });

  it("localTime still reports minutes since midnight", () => {
    expect(localTime(new Date("2026-10-07T00:00:00Z"), "UTC").minutes).toBe(0);
  });
});
