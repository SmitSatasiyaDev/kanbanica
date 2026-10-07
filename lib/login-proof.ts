import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Browser-binding for magic links. The browser that requested the login gets
 * an httpOnly cookie holding `loginProof(token)`; opening the link in any other
 * browser/device lacks it and is sent to the verification-code fallback page
 * instead of being signed in.
 */
export const LOGIN_PROOF_COOKIE = "kb_login_proof";
export const LOGIN_PROOF_MAX_AGE_SECONDS = 10 * 60;

/** Internal header carrying the magic-link token to the OTP generator. */
export const LOGIN_TOKEN_HEADER = "x-kb-login-token";

function hmac(label: string, token: string): Buffer {
  return createHmac("sha256", env.APP_SECRET)
    .update(`${label}:${token}`)
    .digest();
}

/** Value of the requesting-browser cookie for a magic-link token. */
export function loginProof(token: string): string {
  return hmac("login-proof", token).toString("base64url");
}

export function proofMatches(
  cookie: string | null | undefined,
  token: string
): boolean {
  if (!cookie) {
    return false;
  }
  const a = Buffer.from(cookie);
  const b = Buffer.from(loginProof(token));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The 6-digit code for a magic-link request, derived from its (random,
 * single-use) token with a server secret. Unpredictable without the secret,
 * and recomputable server-side so the fallback page can show it without ever
 * storing it in plaintext.
 */
export function deriveSignInCode(token: string): string {
  const n = hmac("sign-in-code", token).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** Same hash the emailOTP plugin uses for `storeOTP: "hashed"`. */
export function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("base64url");
}
