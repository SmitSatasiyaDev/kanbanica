import { describe, expect, it } from "vitest";
import { todayInTz } from "./local-date";
import {
  formatUtcOffset,
  getEffectiveTimezone,
  groupedTimeZones,
  isValidTimeZone,
  listTimeZones,
} from "./timezone";

describe("getEffectiveTimezone", () => {
  it("prefers the user timezone over the workspace's", () => {
    expect(
      getEffectiveTimezone(
        { timezone: "Asia/Kolkata" },
        { timezone: "America/New_York" }
      )
    ).toBe("Asia/Kolkata");
  });
  it("falls back to the workspace timezone", () => {
    expect(
      getEffectiveTimezone({ timezone: null }, { timezone: "America/New_York" })
    ).toBe("America/New_York");
  });
  it("falls back to UTC", () => {
    expect(getEffectiveTimezone({ timezone: null }, { timezone: null })).toBe(
      "UTC"
    );
    expect(getEffectiveTimezone(null, undefined)).toBe("UTC");
  });
  it("skips invalid values rather than throwing", () => {
    expect(
      getEffectiveTimezone({ timezone: "+05:30" }, { timezone: "Mars/Base" })
    ).toBe("UTC");
    expect(
      getEffectiveTimezone({ timezone: "nope" }, { timezone: "Europe/London" })
    ).toBe("Europe/London");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects offsets/garbage", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("+05:30")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
});

describe("different users, same instant", () => {
  it("each gets their own local date", () => {
    const now = new Date("2026-10-07T23:30:00Z");
    const smit = getEffectiveTimezone({ timezone: "Asia/Kolkata" }, null);
    const john = getEffectiveTimezone({ timezone: "America/New_York" }, null);
    expect(todayInTz(now, smit)).toBe("2026-10-08");
    expect(todayInTz(now, john)).toBe("2026-10-07");
  });
  it("is DST-aware for America/New_York", () => {
    // 03:30Z is 23:30 the previous day in EDT (UTC-4) but 22:30 in EST (UTC-5)
    expect(todayInTz(new Date("2026-07-01T03:30:00Z"), "America/New_York")).toBe(
      "2026-06-30"
    );
    // The 4:30Z/5:30Z edge: local midnight is 04:00Z in EDT, 05:00Z in EST.
    expect(todayInTz(new Date("2026-10-08T04:00:00Z"), "America/New_York")).toBe(
      "2026-10-08"
    );
    expect(todayInTz(new Date("2026-12-08T04:30:00Z"), "America/New_York")).toBe(
      "2026-12-07"
    );
    expect(todayInTz(new Date("2026-12-08T05:00:00Z"), "America/New_York")).toBe(
      "2026-12-08"
    );
  });
});

describe("timezone listing", () => {
  it("lists the full runtime set and groups it by region", () => {
    expect(listTimeZones().length).toBeGreaterThan(100);
    const groups = groupedTimeZones();
    const asia = groups.find((g) => g.region === "Asia");
    expect(asia?.zones.some((z) => z.value === "Asia/Kolkata")).toBe(true);
    expect(formatUtcOffset("Asia/Kolkata")).toBe("UTC+05:30");
  });
});

describe("normalizeTimeZone", () => {
  it("maps legacy browser names to the preferred IANA name", async () => {
    const { normalizeTimeZone } = await import("./timezone");
    expect(normalizeTimeZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(normalizeTimeZone("Europe/London")).toBe("Europe/London");
  });
});
