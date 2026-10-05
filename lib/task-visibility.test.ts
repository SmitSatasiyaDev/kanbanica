import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { notDeleted } from "@/lib/task-visibility";

describe("task-visibility", () => {
  it("notDeleted() filters on task.deleted_at IS NULL", () => {
    const { sql } = new PgDialect().sqlToQuery(notDeleted());
    expect(sql).toBe('"task"."deleted_at" is null');
  });
});
