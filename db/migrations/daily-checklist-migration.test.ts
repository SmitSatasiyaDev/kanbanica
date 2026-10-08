import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "db/migrations");
const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as {
  entries: { tag: string }[];
};
const entry = journal.entries.find((e) => e.tag.endsWith("_daily_checklist"));
const sql = entry ? readFileSync(join(dir, `${entry.tag}.sql`), "utf8") : "";

describe("daily checklist migration", () => {
  it("is registered in the journal", () => {
    expect(entry).toBeDefined();
  });

  it("is purely additive", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"/i);
    expect(sql).not.toMatch(/ALTER TABLE "(?!daily_checklist_)\w+" (DROP|ALTER COLUMN)/);
  });

  it("creates the five daily_checklist tables", () => {
    for (const t of ["day", "item", "template", "template_assignment", "template_item"]) {
      expect(sql).toContain(`CREATE TABLE "daily_checklist_${t}"`);
    }
  });

  it("does not touch the task subtask checklist tables", () => {
    expect(sql).not.toMatch(/"checklist(_item)?"/);
  });

  it("enforces the uniqueness the feature relies on", () => {
    expect(sql).toContain("daily_checklist_assignment_template_user_idx");
    expect(sql).toContain("daily_checklist_day_personal_uniq");
    expect(sql).toContain("daily_checklist_day_team_uniq");
    expect(sql).toContain("daily_checklist_item_day_template_item_uniq");
  });
});
