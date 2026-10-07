import { describe, expect, it } from "vitest";
import {
  deriveSignInCode,
  hashOtp,
  loginProof,
  proofMatches,
} from "@/lib/login-proof";

describe("login-proof", () => {
  it("derives a stable 6-digit code per token, different across tokens", () => {
    const a = deriveSignInCode("token-a-aaaaaaaa");
    expect(a).toMatch(/^\d{6}$/);
    expect(deriveSignInCode("token-a-aaaaaaaa")).toBe(a);
    const codes = new Set(
      Array.from({ length: 20 }, (_, i) =>
        deriveSignInCode(`tok-${i}-xxxxxxxx`)
      )
    );
    expect(codes.size).toBeGreaterThan(15);
  });

  it("only the matching cookie proves the requesting browser", () => {
    const proof = loginProof("tok-1");
    expect(proofMatches(proof, "tok-1")).toBe(true);
    expect(proofMatches(proof, "tok-2")).toBe(false);
    expect(proofMatches(null, "tok-1")).toBe(false);
    expect(proofMatches("", "tok-1")).toBe(false);
  });

  it("proof and code never reveal each other or the plaintext", () => {
    const code = deriveSignInCode("tok-1");
    expect(loginProof("tok-1")).not.toContain(code);
    expect(hashOtp(code)).not.toContain(code);
  });
});
