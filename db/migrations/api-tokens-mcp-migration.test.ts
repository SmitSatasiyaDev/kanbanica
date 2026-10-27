import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { apiToken, integrationSettings } from "@/db/schema";

const dir = __dirname;
const journal = JSON.parse(
  readFileSync(join(dir, "meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };

describe("api_token / mcp_enabled migration", () => {
  const entry = journal.entries.find((e) => e.tag.endsWith("_api_tokens_mcp"));

  it("is registered in the journal and its SQL file exists", () => {
    expect(entry).toBeDefined();
    expect(existsSync(join(dir, `${entry!.tag}.sql`))).toBe(true);
  });

  it("creates api_token with a unique hash and a cascading workspace FK", () => {
    const sql = readFileSync(join(dir, `${entry!.tag}.sql`), "utf8");
    expect(sql).toContain('CREATE TABLE "api_token"');
    expect(sql).toContain('CONSTRAINT "api_token_token_hash_unique" UNIQUE("token_hash")');
    expect(sql).toMatch(
      /ALTER TABLE "api_token" ADD CONSTRAINT "api_token_workspace_id_workspace_id_fk" FOREIGN KEY \("workspace_id"\) REFERENCES "public"\."workspace"\("id"\) ON DELETE cascade/
    );
    expect(sql).toContain('CREATE INDEX "api_token_user_id_idx"');
  });

  it("adds a plain (non-unique) index on task (workspace_id, seq_number)", () => {
    const sql = readFileSync(join(dir, `${entry!.tag}.sql`), "utf8");
    expect(sql).toContain(
      'CREATE INDEX "task_workspace_seq_idx" ON "task" USING btree ("workspace_id","seq_number")'
    );
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX "task_workspace_seq_idx"/);
  });

  it("adds integration_settings.mcp_enabled as NOT NULL default true, so MCP stays on for existing installs", () => {
    const sql = readFileSync(join(dir, `${entry!.tag}.sql`), "utf8");
    expect(sql).toContain(
      'ALTER TABLE "integration_settings" ADD COLUMN "mcp_enabled" boolean DEFAULT true NOT NULL;'
    );
    const col = getTableColumns(integrationSettings).mcpEnabled;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
  });

  it("schema keeps the token nullable fields nullable and the hash required", () => {
    const cols = getTableColumns(apiToken);
    expect(cols.tokenHash.notNull).toBe(true);
    expect(cols.workspaceId.notNull).toBe(false);
    expect(cols.lastUsedAt.notNull).toBe(false);
    expect(cols.expiresAt.notNull).toBe(false);
    expect(cols.revokedAt.notNull).toBe(false);
  });
});

describe("migration journal consistency", () => {
  it("has sequential idx values and a SQL file + snapshot for every entry", () => {
    journal.entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      expect(e.tag.startsWith(String(i).padStart(4, "0"))).toBe(true);
      expect(existsSync(join(dir, `${e.tag}.sql`))).toBe(true);
      expect(existsSync(join(dir, `meta/${String(i).padStart(4, "0")}_snapshot.json`))).toBe(true);
    });
  });
});
