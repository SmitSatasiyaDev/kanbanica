import { describe, expect, it } from "vitest";
import { groupHistory } from "./history-group";
import type { HistoryRow } from "./types";

let n = 0;
const row = (
  o: Partial<HistoryRow> & Pick<HistoryRow, "date" | "userId">
): HistoryRow => ({
  dayId: `d${++n}`,
  completed: 0,
  total: 3,
  status: "NOT_STARTED",
  templateId: "t1",
  templateName: "Daily Work",
  userName: o.userId,
  ...o,
});

describe("groupHistory", () => {
  it("multiple records on one date → one date group", () => {
    const g = groupHistory([
      row({ date: "2026-10-07", userId: "smit" }),
      row({ date: "2026-10-07", userId: "jayesh" }),
      row({
        date: "2026-10-07",
        userId: "dev",
        templateId: "t2",
        templateName: "Tickets",
      }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].date).toBe("2026-10-07");
  });

  it("several templates on a date are grouped under it; members don't duplicate the template", () => {
    const g = groupHistory([
      row({ date: "2026-10-07", userId: "smit" }),
      row({ date: "2026-10-07", userId: "jayesh" }),
      row({ date: "2026-10-07", userId: "dev" }),
      row({
        date: "2026-10-07",
        userId: "dev",
        templateId: "t2",
        templateName: "Tickets",
      }),
    ])[0];
    expect(g.templates.map((t) => t.name)).toEqual(["Daily Work", "Tickets"]);
    expect(g.templates[0].members.map((m) => m.userId)).toEqual([
      "smit",
      "jayesh",
      "dev",
    ]);
  });

  it("different dates → separate groups, newest first (even if input is unsorted)", () => {
    const g = groupHistory([
      row({ date: "2026-10-06", userId: "a" }),
      row({ date: "2026-10-08", userId: "a" }),
      row({ date: "2026-10-07", userId: "a" }),
    ]);
    expect(g.map((x) => x.date)).toEqual([
      "2026-10-08",
      "2026-10-07",
      "2026-10-06",
    ]);
  });

  it("date progress = total completed / total items, not an average of percentages", () => {
    const g = groupHistory([
      row({
        date: "2026-10-07",
        userId: "a",
        completed: 1,
        total: 1,
        status: "COMPLETE",
      }), // 100%
      row({
        date: "2026-10-07",
        userId: "b",
        completed: 1,
        total: 9,
        status: "IN_PROGRESS",
      }), // 11%
    ])[0];
    expect(g).toMatchObject({
      completed: 2,
      total: 10,
      percent: 20,
      status: "IN_PROGRESS",
    });
  });

  it("template- and member-level progress stay correct", () => {
    const g = groupHistory([
      row({ date: "2026-10-07", userId: "smit", completed: 0 }),
      row({
        date: "2026-10-07",
        userId: "jayesh",
        completed: 1,
        status: "IN_PROGRESS",
      }),
      row({
        date: "2026-10-07",
        userId: "dev",
        completed: 1,
        status: "IN_PROGRESS",
      }),
    ])[0];
    expect(g.templates[0]).toMatchObject({
      completed: 2,
      total: 9,
      status: "IN_PROGRESS",
    });
    expect(
      g.templates[0].members.map((m) => `${m.userId} ${m.completed}/${m.total}`)
    ).toEqual(["smit 0/3", "jayesh 1/3", "dev 1/3"]);
  });

  it("complete / not started / empty statuses", () => {
    expect(
      groupHistory([
        row({ date: "d", userId: "a", completed: 3, status: "COMPLETE" }),
      ])[0].status
    ).toBe("COMPLETE");
    expect(groupHistory([row({ date: "d", userId: "a" })])[0]).toMatchObject({
      status: "NOT_STARTED",
      percent: 0,
    });
    expect(
      groupHistory([
        row({ date: "d", userId: "a", total: 0, status: "EMPTY" }),
      ])[0]
    ).toMatchObject({ status: "EMPTY", percent: 0 });
  });

  it("a date split across two fetched pages still yields one group", () => {
    const page1 = [row({ date: "2026-10-07", userId: "smit" })];
    const page2 = [
      row({ date: "2026-10-07", userId: "jayesh" }),
      row({ date: "2026-10-06", userId: "smit" }),
    ];
    const g = groupHistory([...page1, ...page2]);
    expect(g.map((x) => x.date)).toEqual(["2026-10-07", "2026-10-06"]);
    expect(g[0].templates[0].members).toHaveLength(2);
  });

  it("same template name but different template ids stay separate", () => {
    const g = groupHistory([
      row({ date: "2026-10-07", userId: "a", templateId: "t1" }),
      row({ date: "2026-10-07", userId: "b", templateId: "t9" }),
    ])[0];
    expect(g.templates).toHaveLength(2);
  });

  it("empty history", () => {
    expect(groupHistory([])).toEqual([]);
  });

  it("never merges or drops the underlying rows", () => {
    const rows = [
      row({ date: "2026-10-07", userId: "a" }),
      row({ date: "2026-10-07", userId: "b" }),
    ];
    const copy = JSON.stringify(rows);
    const members = groupHistory(rows).flatMap((d) =>
      d.templates.flatMap((t) => t.members)
    );
    expect(members).toHaveLength(2);
    expect(JSON.stringify(rows)).toBe(copy);
  });
});
