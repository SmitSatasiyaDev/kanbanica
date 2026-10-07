import { describe, expect, it } from "vitest";
import { isValidCode, sanitizeCode } from "@/lib/otp-input";

describe("sanitizeCode", () => {
  it("keeps digits only", () => {
    expect(sanitizeCode("12a3-4 5")).toBe("12345");
  });
  it("caps at 6 digits (paste)", () => {
    expect(sanitizeCode("123 456 789")).toBe("123456");
  });
  it("handles empty / non-numeric input", () => {
    expect(sanitizeCode("abc")).toBe("");
  });
});

describe("isValidCode", () => {
  it("requires exactly 6 digits", () => {
    expect(isValidCode("123456")).toBe(true);
    expect(isValidCode("12345")).toBe(false);
    expect(isValidCode("1234567")).toBe(false);
    expect(isValidCode("12345a")).toBe(false);
  });
});
