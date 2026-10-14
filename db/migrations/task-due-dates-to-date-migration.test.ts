import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { task } from "@/db/schema/task";

const dir = __dirname;
const journal = JSON.parse(
  readFileSync(join(dir, "meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };

describe("task due dates -> date migration", () => {
  const entry = journal.entries.find((e) =>
    e.tag.endsWith("_task_due_dates_to_date")
  );

  it("is registered in the journal and its SQL file exists", () => {
    expect(entry).toBeDefined();
    expect(existsSync(join(dir, `${entry?.tag}.sql`))).toBe(true);
  });

  it("converts both columns with the +13h-in-UTC recovery, not the session timezone", () => {
    const sql = readFileSync(join(dir, `${entry?.tag}.sql`), "utf8");
    for (const col of ["due_date_start", "due_date_end"]) {
      expect(sql).toContain(
        `ALTER COLUMN "${col}" SET DATA TYPE date USING (("${col}" AT TIME ZONE 'UTC') + interval '13 hours')::date`
      );
    }
  });

  it("keeps the original instants in a backup table before converting", () => {
    const sql = readFileSync(join(dir, `${entry?.tag}.sql`), "utf8");
    const backup = sql.indexOf('CREATE TABLE IF NOT EXISTS "task_due_dates_backup_0037"');
    const convert = sql.indexOf('ALTER TABLE "task" ALTER COLUMN');
    expect(backup).toBeGreaterThan(-1);
    expect(backup).toBeLessThan(convert);
  });

  it("schema columns are plain day strings", () => {
    const cols = getTableColumns(task);
    expect(cols.dueDateStart.dataType).toBe("string");
    expect(cols.dueDateEnd.dataType).toBe("string");
    expect(cols.dueDateEnd.columnType).toBe("PgDateString");
  });
});
