import { rateLimit } from "@/lib/rate-limit";

/** Sign-in verification code policy (emailed together with the magic link). */
export const SIGN_IN_CODE_TTL_SECONDS = 10 * 60;
export const SIGN_IN_CODE_MAX_ATTEMPTS = 5;

const SEND_COOLDOWN_MS = 30_000;
const SEND_WINDOW_MS = 15 * 60_000;
const SEND_WINDOW_MAX = 5;
const VERIFY_WINDOW_MS = 15 * 60_000;
const VERIFY_WINDOW_MAX = 10;

/** Matches the identifier the emailOTP plugin uses for `type: "sign-in"`. */
export function signInOtpIdentifier(email: string): string {
  return `sign-in-otp-${email.toLowerCase()}`;
}

/**
 * Per-email throttle on login emails (Better Auth's own limiter is per IP).
 * Applies identically to known and unknown emails, so it leaks nothing.
 */
export function canSendLoginEmail(email: string): boolean {
  const key = email.toLowerCase();
  return (
    rateLimit(`login-email:cooldown:${key}`, 1, SEND_COOLDOWN_MS).ok &&
    rateLimit(`login-email:window:${key}`, SEND_WINDOW_MAX, SEND_WINDOW_MS).ok
  );
}

/** Per-email cap on code verification requests, independent of source IP. */
export function canVerifyLoginCode(email: string): boolean {
  return rateLimit(
    `login-code:verify:${email.toLowerCase()}`,
    VERIFY_WINDOW_MAX,
    VERIFY_WINDOW_MS
  ).ok;
}
