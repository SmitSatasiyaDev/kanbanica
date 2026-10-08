import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "db/migrations");
const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
const entry = journal.entries.find((e) => e.tag.endsWith("_daily_checklist_fields"));
const sql = entry ? readFileSync(join(dir, `${entry.tag}.sql`), "utf8") : "";

describe("daily checklist custom fields migration", () => {
  it("is registered and additive only", () => {
    expect(entry).toBeDefined();
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"/i);
    expect(sql).not.toMatch(/ALTER TABLE "(?!daily_checklist_(field|field_option|item_field_value)")\w+"/);
  });
  it("creates the three field tables with the uniqueness the feature relies on", () => {
    for (const t of ["field", "field_option", "item_field_value"]) {
      expect(sql).toContain(`CREATE TABLE "daily_checklist_${t}"`);
    }
    expect(sql).toContain("daily_checklist_field_option_field_value_idx");
    expect(sql).toContain("daily_checklist_item_field_value_item_field_uniq");
  });
});
