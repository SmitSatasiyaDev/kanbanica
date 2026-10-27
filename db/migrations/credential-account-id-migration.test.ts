import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = __dirname;
const journal = JSON.parse(
  readFileSync(join(dir, "meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };

describe("credential account_id backfill migration", () => {
  const entry = journal.entries.find((e) =>
    e.tag.endsWith("_credential_account_id")
  );

  it("is registered in the journal and its SQL file exists", () => {
    expect(entry).toBeDefined();
    expect(existsSync(join(dir, `${entry?.tag}.sql`))).toBe(true);
  });

  it("points credential accounts at the user id (required by better-auth 1.7) and touches nothing else", () => {
    const sql = readFileSync(join(dir, `${entry?.tag}.sql`), "utf8").trim();
    expect(sql).toBe(
      'UPDATE "account" SET "account_id" = "user_id" WHERE "provider_id" = \'credential\' AND "account_id" <> "user_id";'
    );
  });
});
