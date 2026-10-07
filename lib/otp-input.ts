/** Length of the sign-in verification code emailed alongside the magic link. */
export const SIGN_IN_CODE_LENGTH = 6;

/** Keep digits only and cap at the code length (handles typing and pasting). */
export function sanitizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, SIGN_IN_CODE_LENGTH);
}

export function isValidCode(code: string): boolean {
  return new RegExp(`^\\d{${SIGN_IN_CODE_LENGTH}}$`).test(code);
}
