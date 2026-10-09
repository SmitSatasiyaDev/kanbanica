import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { emailOTP } from "better-auth/plugins/email-otp";
import { magicLink } from "better-auth/plugins/magic-link";
import { and, eq, sql } from "drizzle-orm";
import { ADMIN_ROLE, PRODUCT_NAME } from "@/config/platform";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  canSendLoginEmail,
  canVerifyLoginCode,
  SIGN_IN_CODE_MAX_ATTEMPTS,
  SIGN_IN_CODE_TTL_SECONDS,
  signInOtpIdentifier,
} from "@/lib/auth-code";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { magicLinkTemplate } from "@/lib/email/templates/magic-link";
import { passwordResetTemplate } from "@/lib/email/templates/password-reset";
import { verifyEmailTemplate } from "@/lib/email/templates/verify-email";
import { env } from "@/lib/env";
import {
  getGoogleOAuthSettings,
  isPasswordSignupEnabled,
  isSmtpConfigured,
} from "@/lib/integration-settings";
import {
  deriveSignInCode,
  LOGIN_PROOF_COOKIE,
  LOGIN_PROOF_MAX_AGE_SECONDS,
  LOGIN_TOKEN_HEADER,
  loginProof,
  proofMatches,
} from "@/lib/login-proof";

// Top-level await: resolved once, the first time this module is imported in
// a given server process, then baked into the betterAuth() singleton below
// for the process's lifetime. Google OAuth credentials changed later via
// Settings → Integrations therefore only take effect after an app restart —
// see docs/integrations.md. SMTP, storage, and Web Push all read their
// settings per-call instead and apply changes live; Google is the one
// exception because Better Auth builds `socialProviders` once, synchronously,
// right here.
//
// Never let this throw: `next build`'s page-data-collection phase imports
// this module against a placeholder DATABASE_URL with no real Postgres to
// query — and at real runtime, a DB hiccup on the very first request that
// imports this module shouldn't take the whole server down. Either way,
// falling back to "Google not configured" is the same failure mode as the
// env vars simply being unset, and self-heals on the next restart.
let googleOAuth: Awaited<ReturnType<typeof getGoogleOAuthSettings>> = null;
try {
  googleOAuth = await getGoogleOAuthSettings();
} catch (error) {
  console.warn(
    "[auth] Could not resolve Google OAuth settings at startup — Google sign-in disabled until next restart.",
    error
  );
}
let smtpConfiguredAtBoot = false;
try {
  smtpConfiguredAtBoot = await isSmtpConfigured();
} catch (error) {
  console.warn(
    "[auth] Could not resolve SMTP settings at startup — treating as unconfigured until next restart.",
    error
  );
}

/**
 * Whether the Google OAuth credentials currently saved match what this
 * process loaded at boot (into `googleOAuth` above) — Settings →
 * Integrations uses this to show "Connected" only once a restart has
 * actually picked up the latest values, instead of always showing "Restart
 * required" for a saved (but never-restarted-into) config.
 */
export async function isGoogleOAuthLive(): Promise<boolean> {
  let current: Awaited<ReturnType<typeof getGoogleOAuthSettings>> = null;
  try {
    current = await getGoogleOAuthSettings();
  } catch {
    return false;
  }
  if (!(current && googleOAuth)) {
    return current === googleOAuth;
  }
  return (
    current.clientId === googleOAuth.clientId &&
    current.clientSecret === googleOAuth.clientSecret
  );
}

// Lets `sendMagicLink` (defined inside the config) mint the sign-in code via
// the server-only emailOTP endpoint without a self-referential type cycle.
let authRef:
  | {
      api: {
        createVerificationOTP: (args: {
          body: { email: string; type: "sign-in" };
          headers: Headers;
        }) => Promise<string>;
      };
    }
  | undefined;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  secret: env.APP_SECRET,
  baseURL: env.APP_URL,
  socialProviders: {
    ...(googleOAuth ? { google: googleOAuth } : {}),
  },
  emailAndPassword: {
    enabled: true,
    // Self-serve registration is an explicit opt-in, but it is NOT decided here:
    // this object is built once per process, and the switch lives in Orbit →
    // Settings (DB, `.env` fallback) so it must apply without a restart. The
    // `before` hook below rejects `/sign-up/email` while it is off. Sign-IN is
    // always on, so `create:admin`-provisioned accounts keep working.
    disableSignUp: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // Only enforce verification when we can actually deliver the email —
    // otherwise an SMTP-less self-host could never sign in. A verified user is
    // also what lets Better Auth implicitly link a Google account onto the same
    // row later (it requires `emailVerified` on the local user).
    requireEmailVerification: smtpConfiguredAtBoot,
    // A reset means the old password may be compromised — kill every existing
    // session for that user. (Password *changes* pass `revokeOtherSessions`
    // per-request from the profile card, keeping the current session alive.)
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Dev convenience, mirroring sendMagicLink: never log in production.
      if (env.NODE_ENV !== "production") {
        console.log(`[password-reset] ${user.email} → ${url}`);
      }
      const { html, text } = await passwordResetTemplate({
        email: user.email,
        resetUrl: url,
      });

      await enqueueEmail({
        to: user.email,
        subject: `Reset your ${PRODUCT_NAME} password`,
        html,
        text,
      });

      await audit({
        action: "auth.password_reset_requested",
        actorEmail: user.email,
        actorId: user.id,
        description: `Password reset requested for ${user.email}`,
        entityId: user.id,
        entityType: "user",
      });
    },
    onPasswordReset: async ({ user }) => {
      await audit({
        action: "auth.password_reset_completed",
        actorEmail: user.email,
        actorId: user.id,
        description: `Password reset completed for ${user.email}`,
        entityId: user.id,
        entityType: "user",
      });
    },
  },
  emailVerification: {
    // Sign the user in the moment they click the verification link — they've
    // proven ownership of the email, so send them into the app (via the
    // signup callbackURL → /post-auth) instead of dropping them on /login.
    autoSignInAfterVerification: true,
    // Serves BOTH new sign-ups and email changes — Better Auth passes an
    // identical payload for each, so the copy is deliberately neutral.
    sendVerificationEmail: async ({ user, url }) => {
      if (env.NODE_ENV !== "production") {
        console.log(`[verify-email] ${user.email} → ${url}`);
      }
      const { html, text } = await verifyEmailTemplate({
        email: user.email,
        verifyUrl: url,
      });
      await enqueueEmail({
        to: user.email,
        subject: `Verify your email address for ${PRODUCT_NAME}`,
        html,
        text,
      });
    },
  },
  user: {
    changeEmail: {
      enabled: true,
    },
  },
  plugins: [
    admin({
      impersonationSessionDuration: 3600,
      allowImpersonatingAdmins: false,
    }),
    // Verification-code sign-in. The code is minted inside `sendMagicLink`
    // below and emailed together with the link, so this plugin's own send
    // route is never used (its sender is a no-op and the route is blocked).
    // Stored hashed in the `verification` table; 5 wrong tries lock the code.
    emailOTP({
      otpLength: 6,
      expiresIn: SIGN_IN_CODE_TTL_SECONDS,
      allowedAttempts: SIGN_IN_CODE_MAX_ATTEMPTS,
      storeOTP: "hashed",
      // Derive the code from the magic-link token so the same code can be
      // shown on the cross-browser fallback page (see lib/login-proof.ts).
      generateOTP: (_data, ctx) => {
        const token = ctx?.headers?.get(LOGIN_TOKEN_HEADER);
        return token ? deriveSignInCode(token) : "";
      },
      sendVerificationOTP: async () => {},
    }),
    magicLink({
      sendMagicLink: async ({ email, url, token }, ctx) => {
        // Per-email throttle (known and unknown emails alike).
        if (!canSendLoginEmail(email)) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many requests",
            code: "TOO_MANY_REQUESTS",
          });
        }
        // A new request replaces any earlier code: only the newest works.
        const normalized = email.toLowerCase();
        await ctx?.context.internalAdapter.deleteVerificationByIdentifier(
          signInOtpIdentifier(normalized)
        );
        await authRef?.api.createVerificationOTP({
          body: { email: normalized, type: "sign-in" },
          headers: new Headers({ [LOGIN_TOKEN_HEADER]: token }),
        });
        // Bind this login request to the requesting browser.
        ctx?.setCookie(LOGIN_PROOF_COOKIE, loginProof(token), {
          httpOnly: true,
          sameSite: "lax",
          secure: env.NODE_ENV === "production",
          path: "/",
          maxAge: LOGIN_PROOF_MAX_AGE_SECONDS,
        });
        // Dev convenience: print the link so you can sign in without SMTP.
        // Never log the email + magic-link URL in production (sensitive).
        // The verification code is generated here but deliberately NOT emailed
        // or logged: it is only revealed by the cross-browser fallback page.
        if (env.NODE_ENV !== "production") {
          console.log(`[magic-link] ${email} → ${url}`);
        }
        const { html, text } = await magicLinkTemplate({
          email,
          magicLinkUrl: url,
        });

        await enqueueEmail({
          to: email,
          subject: `Sign in to ${PRODUCT_NAME}`,
          html,
          text,
        });

        await audit({
          action: "auth.magic_link_sent",
          actorEmail: email,
          description: `Magic link sent to ${email}`,
          entityType: "user",
          metadata: { email },
        });
      },
    }),
  ],
  // OAuth callback failures (notably "account not linked") redirect here instead
  // of Better Auth's built-in error page, so we can explain what happened.
  onAPIError: {
    errorURL: "/login",
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },
  // Throttle auth endpoints (in-memory store; fine for a single instance).
  // Stricter limits on the credential/magic-link entry points to curb abuse
  // (magic-link email spam, password guessing).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/magic-link": { window: 60, max: 5 },
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
      "/sign-in/email-otp": { window: 60, max: 10 },
      // Unused (the code ships in the magic-link email); keep it near-closed.
      "/email-otp/send-verification-otp": { window: 3600, max: 1 },
    },
  },
  hooks: {
    // Per-email brute-force guard on code sign-in, on top of the per-code
    // attempt limit and the per-IP limit.
    before: createAuthMiddleware(async (ctx) => {
      // Magic link opened in a different browser than the one that asked for
      // it: don't sign in; show the verification-code fallback instead.
      if (ctx.path === "/magic-link/verify") {
        const token = (ctx.query as { token?: unknown } | undefined)?.token;
        if (
          typeof token === "string" &&
          !proofMatches(ctx.getCookie(LOGIN_PROOF_COOKIE), token)
        ) {
          throw ctx.redirect(`/login/code?token=${encodeURIComponent(token)}`);
        }
      }
      if (ctx.path === "/sign-up/email" && !(await isPasswordSignupEnabled())) {
        // Same shape Better Auth's own `disableSignUp` produces.
        throw new APIError("BAD_REQUEST", {
          message: "Email and password sign up is not enabled",
          code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
        });
      }
      if (ctx.path === "/sign-in/email-otp") {
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email === "string" && !canVerifyLoginCode(email)) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many requests",
            code: "TOO_MANY_REQUESTS",
          });
        }
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await audit({
            action: "user.created",
            actorEmail: user.email,
            actorId: user.id,
            description: `User created: ${user.email}`,
            entityId: user.id,
            entityType: "user",
          });

          // Self-hosted bootstrap: promote the very first user to platform
          // (Orbit) admin so no manual CLI step is needed. Opt-in via env, and
          // guarded to the first user ONLY (the count subquery makes concurrent
          // or later signups no-ops, and prevents silently promoting a new
          // signup on a running multi-user instance that lost its admin).
          // Owner is assigned separately via onboarding, so the first user ends
          // up Owner + Admin. A pre-seeded admin (create:admin) makes count > 1,
          // so this correctly no-ops and the CLI takes precedence.
          if (env.AUTO_PROMOTE_FIRST_ADMIN) {
            const [promoted] = await db
              .update(schema.user)
              .set({ role: ADMIN_ROLE, updatedAt: new Date() })
              .where(
                and(
                  eq(schema.user.id, user.id),
                  sql`(select count(*) from ${schema.user}) = 1`
                )
              )
              .returning({ id: schema.user.id });

            if (promoted) {
              await audit({
                action: "user.first_admin_promoted",
                actorEmail: user.email,
                actorId: user.id,
                description:
                  "First user auto-promoted to platform admin (self-hosted bootstrap)",
                entityId: user.id,
                entityType: "user",
              });
            }
          }
        },
      },
    },
  },
});

authRef = auth;
