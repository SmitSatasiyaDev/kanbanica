import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { integrationSettings } from "@/db/schema/integration-settings";

const dir = __dirname;
const journal = JSON.parse(
  readFileSync(join(dir, "meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };

describe("integration_settings.password_signup_enabled migration", () => {
  const entry = journal.entries.find((e) =>
    e.tag.endsWith("_password_signup_toggle")
  );

  it("is registered in the journal and its SQL file exists", () => {
    expect(entry).toBeDefined();
    expect(existsSync(join(dir, `${entry?.tag}.sql`))).toBe(true);
  });

  it("adds a nullable boolean with no default, so .env keeps deciding until an admin sets it", () => {
    const sql = readFileSync(join(dir, `${entry?.tag}.sql`), "utf8").trim();
    expect(sql).toBe(
      'ALTER TABLE "integration_settings" ADD COLUMN "password_signup_enabled" boolean;'
    );
  });

  it("schema column is nullable without a default", () => {
    const col = getTableColumns(integrationSettings).passwordSignupEnabled;
    expect(col.notNull).toBe(false);
    expect(col.hasDefault).toBe(false);
  });
});
