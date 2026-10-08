import { describe, expect, it } from "vitest";
import { summarizeFieldValues } from "./field-summary";
import {
  filterMyRows,
  filterTeamGroups,
  groupKey,
  groupTeamRows,
  myRows,
  normalizeMemberFilter,
  noteCount,
} from "./team-aggregate";
import type { TeamItemRow } from "./types";

let n = 0;
function row(over: Partial<TeamItemRow> & { assigneeId: string }): TeamItemRow {
  n++;
  return {
    id: `item-${n}`,
    dayId: `day-${over.assigneeId}`,
    title: "Email Check",
    description: null,
    notes: null,
    priority: "NONE",
    dueTime: null,
    status: "PENDING",
    sortOrder: 0,
    completedAt: null,
    completedBy: null,
    assigneeName: over.assigneeId,
    assigneeImage: null,
    assigneeTimezone: "UTC",
    date: "2026-10-07",
    editable: false,
    templateId: "tpl-1",
    templateItemId: "ti-1",
    templateName: "Dev",
    fields: [],
    ...over,
  };
}
const three = (
  statuses: TeamItemRow["status"][],
  over: Partial<TeamItemRow> = {}
) =>
  ["smit", "jayesh", "dev"].map((u, i) =>
    row({ assigneeId: u, status: statuses[i], ...over })
  );

describe("groupTeamRows", () => {
  it("one item, one member → one row", () => {
    const g = groupTeamRows([row({ assigneeId: "smit" })]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ total: 1, completed: 0, status: "PENDING" });
  });

  it("one item assigned to three members → one aggregated row (no duplicates)", () => {
    const rows = [
      ...three(["PENDING", "PENDING", "PENDING"]),
      ...three(["DONE", "PENDING", "PENDING"], {
        title: "Today Prio",
        templateItemId: "ti-2",
        sortOrder: 1,
      }),
    ];
    const g = groupTeamRows(rows);
    expect(g.map((x) => x.title)).toEqual(["Email Check", "Today Prio"]);
    expect(g.map((x) => x.members.length)).toEqual([3, 3]);
    expect(new Set(g.map((x) => x.key)).size).toBe(g.length);
  });

  it("progress reflects each member's own status", () => {
    const g = groupTeamRows(three(["DONE", "IN_PROGRESS", "PENDING"]));
    expect(g[0]).toMatchObject({
      completed: 1,
      total: 3,
      status: "IN_PROGRESS",
    });
    expect(
      groupTeamRows(three(["PENDING", "PENDING", "PENDING"]))[0]
    ).toMatchObject({ completed: 0, status: "PENDING" });
    expect(
      groupTeamRows(three(["PENDING", "IN_PROGRESS", "PENDING"]))[0].status
    ).toBe("IN_PROGRESS");
  });

  it("all done → 3/3 Done; one pending → not done", () => {
    expect(groupTeamRows(three(["DONE", "DONE", "DONE"]))[0]).toMatchObject({
      completed: 3,
      total: 3,
      status: "DONE",
    });
    expect(groupTeamRows(three(["DONE", "DONE", "PENDING"]))[0]).toMatchObject({
      completed: 2,
      total: 3,
      status: "IN_PROGRESS",
    });
  });

  it("same title but different template items / templates never merge", () => {
    const g = groupTeamRows([
      row({ assigneeId: "smit", title: "Review", templateItemId: "ti-a" }),
      row({ assigneeId: "jayesh", title: "Review", templateItemId: "ti-b" }),
      row({
        assigneeId: "dev",
        title: "Review",
        templateItemId: "ti-a",
        templateId: "tpl-2",
      }),
    ]);
    expect(g).toHaveLength(3);
  });

  it("falls back to snapshot order+title when the template item was deleted", () => {
    const mk = (u: string, over = {}) =>
      row({
        assigneeId: u,
        templateItemId: null,
        sortOrder: 2,
        title: "Gone",
        ...over,
      });
    expect(groupTeamRows([mk("a"), mk("b")])).toHaveLength(1);
    expect(groupTeamRows([mk("a"), mk("b", { title: "Other" })])).toHaveLength(
      2
    );
    expect(groupKey(mk("a"))).not.toBe(groupKey(mk("a", { sortOrder: 3 })));
  });

  it("keeps each member's own custom-field values (never merged)", () => {
    const f = (v: string) => [
      {
        id: "f",
        name: "Customer",
        type: "TEXT" as const,
        required: false,
        options: null,
        sortOrder: 0,
        value: v,
      },
    ];
    const g = groupTeamRows([
      row({ assigneeId: "smit", fields: f("John") }),
      row({ assigneeId: "jayesh", fields: f("David") }),
    ]);
    expect(g).toHaveLength(1);
    const byUser = Object.fromEntries(
      g[0].members.map((m) => [
        m.assigneeId,
        summarizeFieldValues(m.fields)
          .map((e) => `${e.label}: ${e.text}`)
          .join(" · "),
      ])
    );
    expect(byUser).toEqual({
      smit: "Customer: John",
      jayesh: "Customer: David",
    });
  });

  it("does not mutate or drop the underlying rows", () => {
    const rows = three(["DONE", "PENDING", "PENDING"]);
    const copy = JSON.stringify(rows);
    groupTeamRows(rows);
    expect(JSON.stringify(rows)).toBe(copy);
    expect(groupTeamRows(rows).flatMap((g) => g.members)).toHaveLength(3);
  });
});

describe("filters", () => {
  const rows = [
    ...three(["DONE", "PENDING", "PENDING"], { templateItemId: "ti-1" }),
    ...three(["DONE", "DONE", "DONE"], {
      title: "Today Prio",
      templateItemId: "ti-2",
    }),
    ...three(["PENDING", "PENDING", "PENDING"], {
      title: "One tie",
      templateItemId: "ti-3",
    }),
  ];
  const groups = groupTeamRows(rows);
  it("pending includes partially completed items", () => {
    expect(filterTeamGroups(groups, "pending").map((g) => g.title)).toEqual([
      "Email Check",
      "One tie",
    ]);
  });
  it("done only includes fully completed items", () => {
    expect(filterTeamGroups(groups, "done").map((g) => g.title)).toEqual([
      "Today Prio",
    ]);
  });
  it("all returns every group once", () => {
    expect(filterTeamGroups(groups, "all")).toHaveLength(3);
  });
  it("My Assigned shows only the viewer's own, unaggregated items", () => {
    const withMe = rows.map((r) =>
      r.assigneeId === "smit" ? { ...r, editable: true } : r
    );
    const mine = myRows(withMe);
    expect(mine).toHaveLength(3);
    expect(mine.every((r) => r.assigneeId === "smit")).toBe(true);
  });
});

describe("noteCount", () => {
  const g = (notes: (string | null | undefined)[]) =>
    groupTeamRows(
      notes.map((x, i) => row({ assigneeId: `u${i}`, notes: x as never }))
    )[0];
  it("counts members with a saved note", () => {
    expect(noteCount(g([null, "hi", null]).members)).toBe(1);
    expect(noteCount(g(["a", "b", null]).members)).toBe(2);
    expect(noteCount(g(["a", "b", "c"]).members)).toBe(3);
  });
  it("ignores empty / whitespace / missing notes", () => {
    expect(noteCount(g([null, "", "   ", undefined]).members)).toBe(0);
    expect(noteCount(g(["  x  ", " \n "]).members)).toBe(1);
  });
  it("counts each member independently of who is viewing", () => {
    const m = g(["a", "b"]).members;
    expect(noteCount(m.map((r, i) => ({ ...r, editable: i === 0 })))).toBe(2);
    expect(noteCount(m.map((r) => ({ ...r, editable: false })))).toBe(2);
  });
});

describe("normalizeMemberFilter (member Team Checklist has no 'All' tab)", () => {
  it("keeps the three member filters", () => {
    expect(normalizeMemberFilter("mine")).toBe("mine");
    expect(normalizeMemberFilter("pending")).toBe("pending");
    expect(normalizeMemberFilter("done")).toBe("done");
  });
  it("falls back to 'mine' for the removed 'all' and anything unknown", () => {
    expect(normalizeMemberFilter("all")).toBe("mine");
    expect(normalizeMemberFilter("ALL")).toBe("mine");
    expect(normalizeMemberFilter(undefined)).toBe("mine");
    expect(normalizeMemberFilter(null)).toBe("mine");
    expect(normalizeMemberFilter("nope")).toBe("mine");
  });
});

describe("filterMyRows (member Status / Pending / Done)", () => {
  const rows = [
    row({ assigneeId: "me", editable: true, title: "A", status: "PENDING" }),
    row({
      assigneeId: "me",
      editable: true,
      title: "B",
      status: "IN_PROGRESS",
    }),
    row({ assigneeId: "me", editable: true, title: "C", status: "DONE" }),
    row({ assigneeId: "other", title: "A", status: "PENDING" }),
    row({ assigneeId: "other", title: "C", status: "DONE" }),
  ];
  const titles = (f: Parameters<typeof filterMyRows>[1]) =>
    filterMyRows(rows, f).map((r) => r.title);
  it("Pending = only my not-yet-done items, never a teammate's", () => {
    expect(titles("pending")).toEqual(["A", "B"]);
    expect(filterMyRows(rows, "pending").every((r) => r.editable)).toBe(true);
  });
  it("Done = only my done items", () => {
    expect(titles("done")).toEqual(["C"]);
  });
  it("Status = all of my items", () => {
    expect(titles("mine")).toEqual(["A", "B", "C"]);
  });
});
