import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "db/migrations");
const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
const entry = journal.entries.find((e) => e.tag.endsWith("_checklist_field_items"));
const sql = entry ? readFileSync(join(dir, `${entry.tag}.sql`), "utf8") : "";

describe("checklist field → item applicability migration", () => {
  it("is registered and additive only", () => {
    expect(entry).toBeDefined();
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"/i);
  });
  it("keeps every existing field on 'all items' via a true default", () => {
    expect(sql).toContain('ADD COLUMN "applies_to_all" boolean DEFAULT true NOT NULL');
  });
  it("creates the link table with cascades and a unique pair", () => {
    expect(sql).toContain('CREATE TABLE "daily_checklist_field_item"');
    expect(sql).toContain("ON DELETE cascade");
    expect(sql).toContain("daily_checklist_field_item_uniq");
  });
});
