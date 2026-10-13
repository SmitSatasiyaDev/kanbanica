import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { user } from "@/db/schema/auth";

const dir = __dirname;
const journal = JSON.parse(
  readFileSync(join(dir, "meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };

describe("user.timezone migration", () => {
  const entry = journal.entries.find((e) => e.tag.endsWith("_user_timezone"));

  it("is registered in the journal and its SQL file exists", () => {
    expect(entry).toBeDefined();
    expect(existsSync(join(dir, `${entry?.tag}.sql`))).toBe(true);
  });

  it("adds a NOT NULL text column defaulting to UTC and backfills from the digest timezone", () => {
    const sql = readFileSync(join(dir, `${entry?.tag}.sql`), "utf8");
    expect(sql).toContain(
      'ALTER TABLE "user" ADD COLUMN "timezone" text DEFAULT \'UTC\' NOT NULL;'
    );
    expect(sql).toContain('"digest_timezone" <> \'UTC\'');
  });

  it("schema column is NOT NULL with a default", () => {
    const col = getTableColumns(user).timezone;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
  });
});
