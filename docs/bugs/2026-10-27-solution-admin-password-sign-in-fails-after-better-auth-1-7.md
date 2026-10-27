# Solution: write credential accounts with accountId = user id, backfill old rows

## What changed

- `app/actions/setup.ts`: `createFirstAdmin` inserts the credential account with
  `accountId: userId`.
- `scripts/create-admin.ts`: the insert for a new user uses the new user id; when
  the user already exists and already has a credential account, the update also
  sets `accountId` to the user id, so re-running the script repairs the row.
- **Migration `db/migrations/0041_credential_account_id.sql`** repairs existing
  rows:
  `UPDATE "account" SET "account_id" = "user_id" WHERE "provider_id" = 'credential' AND "account_id" <> "user_id";`
  It only touches `credential` rows that are wrong, so it is safe to run more
  than once and leaves Google (and any other provider) rows alone. Test:
  `db/migrations/credential-account-id-migration.test.ts`.
- `lib/login-fallback.ts`: looks the token up as `magic-link:${token}`, the
  identifier better-auth 1.7 writes. Magic links issued before the upgrade are
  stored under the old key and stop working; they expire after 5 minutes.

## Why it works

Sign-in now finds the credential account by user id, which is what both our code
and Better Auth's sign-up write. The migration brings admins created before the
upgrade in line, so no one is locked out.

## Verification

Migrations were applied from scratch on a fresh Postgres (42 migrations). On the
migrated database a credential row with `account_id` = email became the user id,
a Google row with a different `account_id` was untouched, and a credential row
that already matched was unchanged.
