"use server";

import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { count } from "drizzle-orm";
import { ADMIN_ROLE } from "@/config/platform";
import { account, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Creates the first platform admin from the unauthenticated `/setup`
 * wizard. Only succeeds when the `user` table is empty (re-checked inside
 * the transaction against double-submit races). Mirrors
 * `scripts/create-admin.ts`'s direct insert rather than `auth.api.signUpEmail`,
 * which is blocked when `ALLOW_PASSWORD_SIGNUP` is off.
 */
export async function createFirstAdmin(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ ok: true } | { error: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const { password } = input;

  if (!name) {
    return { error: "Name is required" };
  }
  if (!EMAIL_RE.test(email)) {
    return { error: "Enter a valid email address" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }

  const hashed = await hashPassword(password);

  try {
    const result = await db.transaction(async (tx) => {
      const [{ c }] = await tx.select({ c: count() }).from(user);
      if (c > 0) {
        return { error: "This instance is already set up." as const };
      }

      const now = new Date();
      const userId = randomUUID();

      await tx.insert(user).values({
        id: userId,
        email,
        name,
        // Verified so the account can sign in even when requireEmailVerification
        // is active (SMTP configured). Matches scripts/create-admin.ts.
        emailVerified: true,
        role: ADMIN_ROLE,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(account).values({
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: hashed,
        createdAt: now,
        updatedAt: now,
      });

      return { ok: true as const, userId };
    });

    if ("error" in result) {
      return result;
    }

    await audit({
      action: "setup.first_admin_created",
      actorEmail: email,
      actorId: result.userId,
      description: "First administrator created via first-run setup",
      entityId: result.userId,
      entityType: "user",
    });

    return { ok: true };
  } catch (error) {
    console.error("[setup] failed to create first admin", error);
    return { error: "Something went wrong. Please try again." };
  }
}
