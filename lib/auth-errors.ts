/**
 * Human-readable copy for Better Auth error codes.
 *
 * Client-safe (no env, no db) so it can be shared by the login form, the signup
 * form and the server-rendered `?error=` banner on /login.
 */

const MESSAGES: Record<string, string> = {
  // Raised when an OAuth provider returns an email that already belongs to a
  // local account which is not yet verified. Better Auth refuses to link them.
  account_not_linked:
    "An account already exists with this email but isn't linked to Google. Sign in with your password or a magic link first, then verify your email to enable Google sign-in.",
  ACCOUNT_NOT_LINKED:
    "An account already exists with this email but isn't linked to Google. Sign in with your password or a magic link first, then verify your email to enable Google sign-in.",
  EMAIL_NOT_VERIFIED:
    "Please verify your email address before signing in. Check your inbox for the verification link.",
  INVALID_EMAIL_OR_PASSWORD: "Incorrect email or password.",
  // Better Auth reports a bad reset/verification token generically.
  INVALID_TOKEN: "This link is invalid or has expired. Request a new one.",
  TOKEN_EXPIRED: "This link has expired. Request a new one.",
  PASSWORD_TOO_SHORT: "Password must be at least 8 characters.",
  PASSWORD_TOO_LONG: "Password must be at most 128 characters.",
  // Sign-in verification code (emailed with the magic link).
  INVALID_OTP: "Incorrect verification code. Please try again.",
  OTP_EXPIRED: "Verification code expired. Please request a new code.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Please request a new code.",
  TOO_MANY_REQUESTS: "Too many attempts. Please wait a moment and try again.",
  EMAIL_PASSWORD_SIGN_UP_DISABLED: "Registration is disabled on this instance.",
  signup_disabled: "Registration is disabled on this instance.",
};

export function authErrorMessage(
  code: string | null | undefined,
  fallback = "Something went wrong. Please try again."
): string {
  if (!code) {
    return fallback;
  }
  return MESSAGES[code] ?? fallback;
}

/**
 * `/sign-up/email` returns USER_ALREADY_EXISTS, which confirms whether an email
 * is registered. Collapse it into the neutral success copy at the call site
 * rather than echoing it back to the visitor.
 */
export function isUserExistsCode(code: string | null | undefined): boolean {
  return (
    code === "USER_ALREADY_EXISTS" ||
    code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
  );
}

/** Message for a Better Auth client error, covering bare 429 rate-limit replies. */
export function authClientErrorMessage(error: {
  code?: string | null;
  message?: string | null;
  status?: number;
}): string {
  if (error.status === 429 && !error.code) {
    return MESSAGES.TOO_MANY_REQUESTS;
  }
  return authErrorMessage(error.code, error.message ?? undefined);
}
