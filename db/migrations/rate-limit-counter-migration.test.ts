import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rateLimitCounter } from "@/db/schema";

const dir = __dirname;
const journal = JSON.parse(
  readFileSync(join(dir, "meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };

describe("rate_limit_counter migration", () => {
  const entry = journal.entries.find((e) =>
    e.tag.endsWith("_rate_limit_counter")
  );

  it("is registered in the journal as 0040 and its SQL file exists", () => {
    expect(entry?.tag).toBe("0040_rate_limit_counter");
    expect(existsSync(join(dir, `${entry!.tag}.sql`))).toBe(true);
  });

  it("only creates the rate_limit_counter table with a (key, window_start) primary key", () => {
    const sql = readFileSync(join(dir, `${entry!.tag}.sql`), "utf8");
    expect(sql).toContain('CREATE TABLE "rate_limit_counter"');
    expect(sql).toContain('PRIMARY KEY("key","window_start")');
    // Nothing else is touched: no other table, column or index.
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(sql).not.toMatch(/ALTER TABLE|DROP |CREATE (UNIQUE )?INDEX/);
  });

  it("matches the Drizzle schema columns", () => {
    expect(Object.keys(getTableColumns(rateLimitCounter)).sort()).toEqual([
      "count",
      "key",
      "windowStart",
    ]);
  });
});
