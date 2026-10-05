import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { integrationSettings } from "@/db/schema/integration-settings";

const dir = __dirname;
const journal = JSON.parse(
  readFileSync(join(dir, "meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };

describe("integration_settings.notification_emails_enabled migration", () => {
  const entry = journal.entries.find((e) =>
    e.tag.endsWith("_notification_emails_toggle")
  );

  it("is registered in the journal and its SQL file exists", () => {
    expect(entry).toBeDefined();
    expect(existsSync(join(dir, `${entry?.tag}.sql`))).toBe(true);
  });

  it("adds a NOT NULL boolean defaulting to true, so existing deployments keep sending", () => {
    const sql = readFileSync(join(dir, `${entry?.tag}.sql`), "utf8").trim();
    expect(sql).toBe(
      'ALTER TABLE "integration_settings" ADD COLUMN "notification_emails_enabled" boolean DEFAULT true NOT NULL;'
    );
  });

  it("schema column is NOT NULL with a default", () => {
    const col = getTableColumns(integrationSettings).notificationEmailsEnabled;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
  });
});
