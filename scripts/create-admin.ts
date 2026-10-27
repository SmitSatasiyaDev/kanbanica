import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { ADMIN_ROLE } from "@/config/platform";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main() {
  const [email, password, name = "Admin"] = process.argv.slice(2);

  if (!email || !password) {
    console.error("Usage: pnpm create:admin <email> <password> [name]");
    console.error(
      "  e.g. pnpm create:admin admin@example.com secret123 'Super Admin'"
    );
    process.exit(1);
  }

  const [{ db }, { user, account }] = await Promise.all([
    import("@/lib/db"),
    import("@/db/schema"),
  ]);

  // Check if user already exists
  const [existing] = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.email, email));

  if (existing) {
    // Already exists — just set the password and promote to admin
    const hashed = await hashPassword(password);
    const now = new Date();

    // `emailVerified` so the account can sign in even when
    // `requireEmailVerification` is active (SMTP configured).
    await db
      .update(user)
      .set({ role: ADMIN_ROLE, emailVerified: true, updatedAt: now })
      .where(eq(user.id, existing.id));

    // Upsert the CREDENTIAL account. Filtering on providerId matters: a user who
    // signed up with Google has a `google` account row, and writing the password
    // into that row would both corrupt it and leave password sign-in broken.
    const [existingAccount] = await db
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.userId, existing.id),
          eq(account.providerId, "credential")
        )
      );

    if (existingAccount) {
      await db
        .update(account)
        .set({ accountId: existing.id, password: hashed, updatedAt: now })
        .where(eq(account.id, existingAccount.id));
    } else {
      await db.insert(account).values({
        id: randomUUID(),
        userId: existing.id,
        accountId: existing.id,
        providerId: "credential",
        password: hashed,
        createdAt: now,
        updatedAt: now,
      });
    }

    console.log(
      `✓ Existing user ${email} promoted to admin with new password.`
    );
    process.exit(0);
  }

  // Create brand new admin user
  const userId = randomUUID();
  const hashed = await hashPassword(password);
  const now = new Date();

  await db.insert(user).values({
    id: userId,
    email,
    name,
    emailVerified: true,
    role: ADMIN_ROLE,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(account).values({
    id: randomUUID(),
    userId,
    accountId: userId,
    providerId: "credential",
    password: hashed,
    createdAt: now,
    updatedAt: now,
  });

  console.log(`✓ Admin user created: ${email} (name: "${name}")`);
  console.log("  Login at /admin/login with the password you provided.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
