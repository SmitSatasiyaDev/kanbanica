import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { workspace } from "./workspace";

// Personal API tokens (MCP). The plain token is shown once at creation and
// never stored — only its SHA-256 hash. `userId` is a plain text column (like
// `pushSubscription.userId`), so rows are removed by hand in `purgeUser`.
// Revoking sets `revokedAt`; the row stays until the user is purged.
export const apiToken = pgTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    // First 8 chars after `kbn_`, shown in the token list.
    tokenPrefix: text("token_prefix").notNull(),
    // "read" | "write"
    scope: text("scope").notNull(),
    // null = all of the user's workspaces.
    workspaceId: text("workspace_id").references(() => workspace.id, {
      onDelete: "cascade",
    }),
    // Written at most once per minute per token.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("api_token_user_id_idx").on(t.userId)]
);
