import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sprint } from "@/db/schema/sprint";

const dir = __dirname;
const journal = JSON.parse(
  readFileSync(join(dir, "meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };

describe("sprint dates -> date migration", () => {
  const entry = journal.entries.find((e) =>
    e.tag.endsWith("_sprint_dates_to_date")
  );

  it("is registered in the journal and its SQL file exists", () => {
    expect(entry).toBeDefined();
    expect(existsSync(join(dir, `${entry?.tag}.sql`))).toBe(true);
  });

  it("converts both columns, +13h for picker midnights and the UTC date for real instants", () => {
    const sql = readFileSync(join(dir, `${entry?.tag}.sql`), "utf8");
    for (const col of ["start_date", "end_date"]) {
      expect(sql).toContain(`ALTER COLUMN "${col}" SET DATA TYPE date USING`);
      expect(sql).toContain(
        `(("${col}" AT TIME ZONE 'UTC') + interval '13 hours')::date`
      );
      expect(sql).toContain(`ELSE ("${col}" AT TIME ZONE 'UTC')::date`);
    }
  });

  it("keeps the original instants in a backup table before converting", () => {
    const sql = readFileSync(join(dir, `${entry?.tag}.sql`), "utf8");
    const backup = sql.indexOf('CREATE TABLE IF NOT EXISTS "sprint_dates_backup_0038"');
    const convert = sql.indexOf('ALTER TABLE "sprint" ALTER COLUMN');
    expect(backup).toBeGreaterThan(-1);
    expect(backup).toBeLessThan(convert);
  });

  it("schema columns are plain day strings", () => {
    const cols = getTableColumns(sprint);
    expect(cols.startDate.columnType).toBe("PgDateString");
    expect(cols.endDate.columnType).toBe("PgDateString");
  });
});
