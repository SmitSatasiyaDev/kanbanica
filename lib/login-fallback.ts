import { auth } from "@/lib/auth";
import { signInOtpIdentifier } from "@/lib/auth-code";
import { deriveSignInCode, hashOtp } from "@/lib/login-proof";

export type FallbackCode =
  | { ok: true; code: string; email: string }
  | { ok: false; reason: "invalid" | "superseded" };

/**
 * Resolves the verification code for a magic-link token opened in a browser
 * that did not request the login. Read-only: nothing is consumed.
 */
export async function getFallbackCode(token: string): Promise<FallbackCode> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
    return { ok: false, reason: "invalid" };
  }
  const { internalAdapter } = await auth.$context;
  const row = await internalAdapter.findVerificationValue(token);
  if (!row || row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "invalid" };
  }
  let email: string | undefined;
  try {
    email = (JSON.parse(row.value) as { email?: string }).email;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!email) {
    return { ok: false, reason: "invalid" };
  }
  const code = deriveSignInCode(token);
  const otpRow = await internalAdapter.findVerificationValue(
    signInOtpIdentifier(email)
  );
  const stored = otpRow?.value.slice(0, otpRow.value.lastIndexOf(":"));
  if (
    !otpRow ||
    otpRow.expiresAt.getTime() <= Date.now() ||
    stored !== hashOtp(code)
  ) {
    return { ok: false, reason: "superseded" };
  }
  return { ok: true, code, email };
}
