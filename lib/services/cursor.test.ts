import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  decodeCursor,
  encodeCursor,
  pageOf,
  readCursor,
} from "@/lib/services/cursor";

describe("cursors", () => {
  it("round-trips a position as opaque base64url JSON", () => {
    const raw = encodeCursor("my_tasks", {
      e: "2026-11-05",
      s: null,
      id: "t1",
    });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(raw, "base64url").toString())).toEqual({
      k: "my_tasks",
      e: "2026-11-05",
      s: null,
      id: "t1",
    });
    expect(readCursor("my_tasks", raw)).toEqual({
      e: "2026-11-05",
      s: null,
      id: "t1",
    });
  });

  it("refuses a cursor made for another list", () => {
    const raw = encodeCursor("lists", { o: 3, i: "l1" });
    expect(readCursor("projects", raw)).toBeNull();
    expect(readCursor("lists", raw)).toEqual({ o: 3, i: "l1" });
  });

  it.each([
    ["not base64 characters", "%%%"],
    ["empty", ""],
    ["not JSON", Buffer.from("hello").toString("base64url")],
    ["a JSON array", Buffer.from("[1,2]").toString("base64url")],
    [
      "wrong field types",
      Buffer.from(JSON.stringify({ k: "lists", o: "1", i: 5 })).toString(
        "base64url"
      ),
    ],
    [
      "a missing field",
      Buffer.from(JSON.stringify({ k: "lists", o: 1 })).toString("base64url"),
    ],
    [
      "a SQL-looking date",
      Buffer.from(
        JSON.stringify({
          k: "my_tasks",
          e: "x'; drop table task;--",
          s: null,
          id: "t",
        })
      ).toString("base64url"),
    ],
    ["too long", "A".repeat(2000)],
  ])("refuses %s", (_name, raw) => {
    expect(readCursor("my_tasks", raw)).toBeNull();
    expect(readCursor("lists", raw)).toBeNull();
  });

  it("decodeCursor needs the exact shape for the kind", () => {
    const raw = encodeCursor("comments", {
      c: "2026-10-27 10:15:30.123456+00",
      i: "c1",
    });
    expect(readCursor("comments", raw)).toEqual({
      c: "2026-10-27 10:15:30.123456+00",
      i: "c1",
    });
    expect(
      decodeCursor("comments", raw, z.object({ nothing: z.string() }))
    ).toBeNull();
  });

  it("pageOf cuts the extra row and reports more", () => {
    expect(pageOf([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
    expect(pageOf([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
    expect(pageOf([], 2)).toEqual({ items: [], hasMore: false });
  });
});
