import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { task } from "@/db/schema";

const dir = __dirname;
const journal = JSON.parse(
  readFileSync(join(dir, "meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };

describe("task trash migration", () => {
  const entry = journal.entries.find((e) => e.tag.endsWith("_task_trash"));

  it("is registered in the journal and its SQL file exists", () => {
    expect(entry).toBeDefined();
    expect(existsSync(join(dir, `${entry!.tag}.sql`))).toBe(true);
  });

  it("is purely additive: nullable columns, no defaults, no backfill, no drops", () => {
    const sql = readFileSync(join(dir, `${entry!.tag}.sql`), "utf8");
    expect(sql).toContain('ADD COLUMN "deleted_at" timestamp with time zone;');
    expect(sql).toContain('ADD COLUMN "deleted_by" text;');
    expect(sql).toContain('ADD COLUMN "deleted_with_parent_id" text;');
    const alters = sql
      .split("\n")
      .filter((l) => l.startsWith("ALTER"))
      .join("\n");
    expect(alters).not.toMatch(/NOT NULL|DEFAULT|DROP/i);
    expect(sql).not.toMatch(/UPDATE |DROP /i);
  });

  it("schema columns are nullable so every existing task stays live", () => {
    const cols = getTableColumns(task);
    for (const c of [cols.deletedAt, cols.deletedBy, cols.deletedWithParentId]) {
      expect(c.notNull).toBe(false);
      expect(c.hasDefault).toBe(false);
    }
  });
});
