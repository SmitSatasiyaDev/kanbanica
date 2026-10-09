import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, normalizeHexColor } from "@/lib/status-color";

describe("normalizeHexColor", () => {
  it("accepts 6-digit hex with or without #, any case, and uppercases it", () => {
    expect(normalizeHexColor("#ff8800")).toBe("#FF8800");
    expect(normalizeHexColor("ff8800")).toBe("#FF8800");
    expect(normalizeHexColor("  #Ab12Cd ")).toBe("#AB12CD");
  });

  it("expands 3-digit shorthand", () => {
    expect(normalizeHexColor("f80")).toBe("#FF8800");
    expect(normalizeHexColor("#0a9")).toBe("#00AA99");
  });

  it.each([
    "",
    "#",
    "#ff88",
    "#ff88000",
    "#gg0000",
    "red",
    "rgb(0,0,0)",
    "#fff; background:url(x)",
    "url(javascript:alert(1))",
  ])("rejects %j", (bad) => {
    expect(normalizeHexColor(bad)).toBeNull();
  });
});

describe("hex <-> hsv", () => {
  it("converts primary colors", () => {
    expect(hexToHsv("#FF0000")).toEqual({ h: 0, s: 100, v: 100 });
    expect(hexToHsv("#00FF00").h).toBeCloseTo(120);
    expect(hexToHsv("#0000FF").h).toBeCloseTo(240);
    expect(hexToHsv("#FFFFFF")).toEqual({ h: 0, s: 0, v: 100 });
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
  });

  it("round-trips every preset-style color exactly", () => {
    for (const hex of [
      "#6B7280",
      "#EF4444",
      "#F97316",
      "#EAB308",
      "#22C55E",
      "#14B8A6",
      "#3B82F6",
      "#8B5CF6",
      "#EC4899",
      "#F43F5E",
      "#123456",
      "#FEDCBA",
    ]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("clamps out-of-range hsv and never throws on bad hex", () => {
    expect(hsvToHex({ h: 400, s: 150, v: -5 })).toBe("#000000");
    expect(hsvToHex({ h: 0, s: 0, v: 100 })).toBe("#FFFFFF");
    expect(hexToHsv("nope")).toEqual({ h: 0, s: 0, v: 0 });
  });
});
