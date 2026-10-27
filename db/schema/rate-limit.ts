import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// Fixed-window request counters shared by every app process (MCP rate limits,
// see lib/rate-limit-db.ts). One row per key and window; old rows are removed
// by the `rate-limit.cleanup` worker job. No foreign keys: the key is an
// opaque string such as `mcp:user:<userId>`.
export const rateLimitCounter = pgTable(
  "rate_limit_counter",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
