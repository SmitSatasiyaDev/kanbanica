"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signInOtpIdentifier } from "@/lib/auth-code";
import { env } from "@/lib/env";
import { getFallbackCode } from "@/lib/login-fallback";
import {
  LOGIN_PROOF_COOKIE,
  LOGIN_PROOF_MAX_AGE_SECONDS,
  loginProof,
} from "@/lib/login-proof";

/**
 * "Sign in here instead": the visitor explicitly chooses to finish the login
 * in THIS browser. We claim the login request for it (same cookie the
 * requesting browser got), retire the emailed code so it can't also be used
 * elsewhere, and hand over to the normal magic-link verification.
 */
export async function continueInThisBrowser(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const fallback = await getFallbackCode(token);
  if (!fallback.ok) {
    redirect("/login/code?token=invalid");
  }

  const { internalAdapter } = await auth.$context;
  await internalAdapter.deleteVerificationByIdentifier(
    signInOtpIdentifier(fallback.email)
  );

  (await cookies()).set(LOGIN_PROOF_COOKIE, loginProof(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: LOGIN_PROOF_MAX_AGE_SECONDS,
  });

  redirect(
    `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent("/post-auth")}`
  );
}
