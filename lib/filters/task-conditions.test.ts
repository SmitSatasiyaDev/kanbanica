import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  buildTaskFilterConditions,
  withTaskFilters,
} from "@/lib/filters/task-conditions";

// No @/lib/db mock needed: buildTaskFilterConditions only ever *builds* SQL
// (including unexecuted Drizzle subqueries for assignee/tags/sprint) — it never
// awaits a query, so the real query builder can be exercised safely with no
// network I/O.

const TODAY = "2026-10-12"; // a Monday
const dialect = new PgDialect();

describe("buildTaskFilterConditions", () => {
  it("returns no conditions for empty filters", () => {
    expect(buildTaskFilterConditions({}, TODAY)).toHaveLength(0);
  });

  it("adds one condition for a non-empty status filter", () => {
    expect(buildTaskFilterConditions({ status: ["s1"] }, TODAY)).toHaveLength(
      1
    );
  });

  it("ignores an empty status array", () => {
    expect(buildTaskFilterConditions({ status: [] }, TODAY)).toHaveLength(0);
  });

  it("adds one condition for a non-empty statusType filter", () => {
    expect(
      buildTaskFilterConditions({ statusType: ["OPEN"] }, TODAY)
    ).toHaveLength(1);
  });

  it("adds one condition for a non-empty priority filter", () => {
    expect(
      buildTaskFilterConditions({ priority: ["HIGH"] }, TODAY)
    ).toHaveLength(1);
  });

  describe("due", () => {
    it("adds no condition when due is the empty-string sentinel", () => {
      expect(buildTaskFilterConditions({ due: "" }, TODAY)).toHaveLength(0);
    });

    it("adds one condition for 'overdue'", () => {
      expect(buildTaskFilterConditions({ due: "overdue" }, TODAY)).toHaveLength(
        1
      );
    });

    it("adds one equality condition for 'today'", () => {
      expect(buildTaskFilterConditions({ due: "today" }, TODAY)).toHaveLength(
        1
      );
    });

    it("'overdue' is strictly before today, so a task due today is not overdue", () => {
      const [cond] = buildTaskFilterConditions({ due: "overdue" }, TODAY);
      const q = dialect.sqlToQuery(cond);
      expect(q.sql).toContain('"due_date_end" <');
      expect(q.params).toEqual([TODAY]);
    });

    it("'today' matches the exact day", () => {
      const [cond] = buildTaskFilterConditions({ due: "today" }, TODAY);
      const q = dialect.sqlToQuery(cond);
      expect(q.sql).toContain('"due_date_end" =');
      expect(q.params).toEqual([TODAY]);
    });

    it("'this_week' spans Sunday to Saturday around today", () => {
      const conds = buildTaskFilterConditions({ due: "this_week" }, TODAY);
      expect(conds.map((c) => dialect.sqlToQuery(c).params[0])).toEqual([
        "2026-10-11",
        "2026-10-17",
      ]);
    });

    it("adds two conditions (start/end of week) for 'this_week'", () => {
      expect(
        buildTaskFilterConditions({ due: "this_week" }, TODAY)
      ).toHaveLength(2);
    });

    it("adds one condition for 'no_due_date'", () => {
      expect(
        buildTaskFilterConditions({ due: "no_due_date" }, TODAY)
      ).toHaveLength(1);
    });
  });

  describe("assignee", () => {
    it("ignores an empty assignee array", () => {
      expect(buildTaskFilterConditions({ assignee: [] }, TODAY)).toHaveLength(
        0
      );
    });

    it("adds one condition for specific user ids only", () => {
      expect(
        buildTaskFilterConditions({ assignee: ["u1", "u2"] }, TODAY)
      ).toHaveLength(1);
    });

    it("adds one condition for the 'unassigned' sentinel only", () => {
      expect(
        buildTaskFilterConditions({ assignee: ["unassigned"] }, TODAY)
      ).toHaveLength(1);
    });

    it("combines user ids and 'unassigned' into a single OR condition", () => {
      expect(
        buildTaskFilterConditions({ assignee: ["u1", "unassigned"] }, TODAY)
      ).toHaveLength(1);
    });
  });

  it("adds one condition for a non-empty tags filter", () => {
    expect(buildTaskFilterConditions({ tags: ["t1"] }, TODAY)).toHaveLength(1);
  });

  it("adds one condition for a non-empty sprint filter", () => {
    expect(
      buildTaskFilterConditions({ sprint: ["sprint1"] }, TODAY)
    ).toHaveLength(1);
  });

  it("combines multiple independent filters additively", () => {
    expect(
      buildTaskFilterConditions(
        {
          status: ["s1"],
          priority: ["HIGH"],
          tags: ["t1"],
        },
        TODAY
      )
    ).toHaveLength(3);
  });
});

describe("withTaskFilters", () => {
  it("returns undefined when there are no base or filter conditions", () => {
    expect(withTaskFilters([], {}, TODAY)).toBeUndefined();
  });

  it("returns a defined SQL expression when at least one condition exists", () => {
    expect(withTaskFilters([], { status: ["s1"] }, TODAY)).toBeDefined();
  });

  it("combines base conditions with filter conditions", () => {
    const [baseCondition] = buildTaskFilterConditions(
      { priority: ["HIGH"] },
      TODAY
    );
    expect(
      withTaskFilters([baseCondition], { status: ["s1"] }, TODAY)
    ).toBeDefined();
  });
});
