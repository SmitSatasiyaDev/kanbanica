import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  inserted: [] as unknown[],
  conflict: undefined as unknown,
  returned: [] as { key: string; windowStart: Date; count: number }[],
  fail: false,
  deleteWhere: undefined as unknown,
  deleted: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        h.inserted.push(v);
        return {
          onConflictDoUpdate: (c: unknown) => {
            h.conflict = c;
            return {
              returning: async () => {
                if (h.fail) {
                  throw new Error("db down");
                }
                return h.returned;
              },
            };
          },
        };
      },
    })),
    delete: vi.fn(() => ({
      where: (w: unknown) => {
        h.deleteWhere = w;
        return { returning: async () => h.deleted };
      },
    })),
  },
}));

import {
  consumeRateLimits,
  deleteOldRateLimitRows,
  RATE_LIMIT_RETENTION_MS,
  rateLimitDb,
  retryAfterSeconds,
  windowStartFor,
} from "@/lib/rate-limit-db";

const dialect = new PgDialect();

beforeEach(() => {
  h.inserted.length = 0;
  h.conflict = undefined;
  h.returned = [];
  h.fail = false;
  h.deleted = [];
});

describe("window math", () => {
  it("aligns a window to a multiple of its length", () => {
    const minute = 60_000;
    const now = 10 * minute + 12_345;
    expect(windowStartFor(now, minute)).toBe(10 * minute);
    expect(windowStartFor(10 * minute, minute)).toBe(10 * minute);
    expect(windowStartFor(10 * minute - 1, minute)).toBe(9 * minute);
  });

  it("retryAfter is the whole seconds left in the window, at least 1", () => {
    const minute = 60_000;
    expect(retryAfterSeconds(10 * minute + 12_345, minute)).toBe(48);
    expect(retryAfterSeconds(10 * minute, minute)).toBe(60);
    expect(retryAfterSeconds(11 * minute - 1, minute)).toBe(1);
  });
});

describe("consumeRateLimits", () => {
  const now = 10 * 60_000 + 5000;
  const start = new Date(10 * 60_000);

  it("upserts every key in one statement with the window start and cost", async () => {
    h.returned = [
      { key: "mcp:token:t1", windowStart: start, count: 1 },
      { key: "task-attachment:u1", windowStart: start, count: 5 },
    ];
    await consumeRateLimits(
      [
        { key: "mcp:token:t1", limit: 120, windowMs: 60_000 },
        { key: "task-attachment:u1", limit: 60, windowMs: 60_000, cost: 5 },
      ],
      now
    );
    expect(h.inserted).toEqual([
      [
        { key: "mcp:token:t1", windowStart: start, count: 1 },
        { key: "task-attachment:u1", windowStart: start, count: 5 },
      ],
    ]);
    // The conflict adds to the stored count in SQL (atomic across processes).
    const set = (h.conflict as { set: { count: unknown } }).set.count;
    expect(dialect.sqlToQuery(set as never).sql).toContain("excluded.count");
  });

  it("allows up to the limit and blocks the call after it", async () => {
    h.returned = [{ key: "k", windowStart: start, count: 60 }];
    const atLimit = await rateLimitDb("k", 60, 60_000);
    expect(atLimit).toMatchObject({ key: "k", ok: true, retryAfter: 0 });

    h.returned = [{ key: "k", windowStart: start, count: 61 }];
    const over = await consumeRateLimits(
      [{ key: "k", limit: 60, windowMs: 60_000 }],
      now
    );
    expect(over).toEqual([{ key: "k", ok: false, retryAfter: 55 }]);
  });

  it("a costly call that pushes the total over the limit is blocked", async () => {
    h.returned = [{ key: "up", windowStart: start, count: 62 }];
    const [d] = await consumeRateLimits(
      [{ key: "up", limit: 60, windowMs: 60_000, cost: 5 }],
      now
    );
    expect(d.ok).toBe(false);
  });

  it("decides each key by its own limit", async () => {
    h.returned = [
      { key: "mcp:token:t1", windowStart: start, count: 121 },
      { key: "mcp:user:u1", windowStart: start, count: 121 },
    ];
    const decisions = await consumeRateLimits(
      [
        { key: "mcp:token:t1", limit: 120, windowMs: 60_000 },
        { key: "mcp:user:u1", limit: 300, windowMs: 60_000 },
      ],
      now
    );
    expect(decisions.map((d) => [d.key, d.ok])).toEqual([
      ["mcp:token:t1", false],
      ["mcp:user:u1", true],
    ]);
  });

  it("rejects the same key twice in one call and an empty call does nothing", async () => {
    await expect(
      consumeRateLimits([
        { key: "k", limit: 1, windowMs: 1000 },
        { key: "k", limit: 1, windowMs: 1000 },
      ])
    ).rejects.toThrow();
    expect(await consumeRateLimits([])).toEqual([]);
    expect(h.inserted).toHaveLength(0);
  });

  it("throws when the database fails, so callers choose open or closed", async () => {
    h.fail = true;
    await expect(rateLimitDb("k", 1, 1000)).rejects.toThrow("db down");
  });
});

describe("cleanup", () => {
  it("deletes windows that started more than an hour ago", async () => {
    h.deleted = [{ key: "a" }, { key: "b" }];
    const now = 1_000_000_000_000;
    expect(await deleteOldRateLimitRows(now)).toBe(2);
    const where = dialect.sqlToQuery(h.deleteWhere as never);
    expect(where.sql).toContain('"window_start" <');
    expect(where.params[0]).toEqual(
      new Date(now - RATE_LIMIT_RETENTION_MS).toISOString()
    );
    expect(RATE_LIMIT_RETENTION_MS).toBe(3_600_000);
  });
});
