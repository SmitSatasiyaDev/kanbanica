# Bug: admins created by /setup or create:admin cannot sign in with a password after better-auth 1.7

## Symptom

After upgrading to better-auth 1.7, the first admin created by the `/setup`
wizard (or by `pnpm create:admin`) gets a 401 "invalid email or password" on
email + password sign-in, even with the correct password. Users who signed up
through the normal sign-up form are not affected. A second, smaller change in
the same release: a magic link opened in a different browser no longer shows
the verification code, because the lookup key for the link token changed.

## Where

- `app/actions/setup.ts` (`createFirstAdmin`) and `scripts/create-admin.ts`
  inserted the `credential` row in the `account` table with
  `accountId: email`.
- `lib/login-fallback.ts` (`getFallbackCode`) read the magic-link row from
  `verification` using the raw token.

## Root cause

- better-auth 1.7 finds the password account at email/password sign-in by
  matching the `credential` account whose `accountId` equals the user's id.
  Earlier versions did not check this, so our hand-written rows (which used the
  email as `accountId`) worked. Better Auth's own sign-up has always written the
  user id there, which is why only the setup wizard and the CLI script were hit.
- better-auth 1.7 stores the magic-link token in `verification.identifier` as
  `magic-link:<token>` instead of `<token>`, so `findVerificationValue(token)`
  found nothing and the fallback page treated every link as invalid.
