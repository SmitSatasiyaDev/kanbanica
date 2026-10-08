import { describe, expect, it } from "vitest";
import { groupTodayRows } from "./today-group";
import type { TodayInstanceRow } from "./types";

let n = 0;
const row = (
  o: Partial<TodayInstanceRow> & { userId: string }
): TodayInstanceRow => ({
  dayId: `d${++n}`,
  completed: 0,
  total: 3,
  status: "NOT_STARTED",
  templateId: "t1",
  templateName: "Daily Work",
  userImage: null,
  userName: o.userId,
  ...o,
});
const D = "2026-10-07";

describe("groupTodayRows", () => {
  it("one template + one user → one row", () => {
    const g = groupTodayRows([row({ userId: "a" })], D);
    expect(g).toHaveLength(1);
    expect(g[0].users).toHaveLength(1);
  });

  it("one template + three users → one parent row; users stay individually listed", () => {
    const g = groupTodayRows(
      [
        row({ userId: "a" }),
        row({ userId: "b" }),
        row({ userId: "c", completed: 2, status: "IN_PROGRESS" }),
      ],
      D
    );
    expect(g).toHaveLength(1);
    expect(
      g[0].users.map((u) => `${u.userId} ${u.completed}/${u.total} ${u.status}`)
    ).toEqual(["a 0/3 NOT_STARTED", "b 0/3 NOT_STARTED", "c 2/3 IN_PROGRESS"]);
  });

  it("multiple templates → separate parent rows, no duplicates", () => {
    const g = groupTodayRows(
      [
        row({ userId: "a" }),
        row({ userId: "b" }),
        row({ userId: "a", templateId: "t2", templateName: "Tickets" }),
        row({ userId: "a", templateId: "t3", templateName: "Daily Work1" }),
      ],
      D
    );
    expect(g.map((x) => x.name)).toEqual([
      "Daily Work",
      "Tickets",
      "Daily Work1",
    ]);
    expect(new Set(g.map((x) => x.key)).size).toBe(3);
  });

  it("same name but different template ids stay separate", () => {
    const g = groupTodayRows(
      [
        row({ userId: "a", templateId: "t1" }),
        row({ userId: "b", templateId: "t9" }),
      ],
      D
    );
    expect(g).toHaveLength(2);
  });

  it("the group key includes the date", () => {
    const a = groupTodayRows([row({ userId: "a" })], "2026-10-07")[0].key;
    const b = groupTodayRows([row({ userId: "a" })], "2026-10-08")[0].key;
    expect(a).not.toBe(b);
  });

  it("parent progress: users complete + items", () => {
    const g = groupTodayRows(
      [
        row({ userId: "a", completed: 3, status: "COMPLETE" }),
        row({ userId: "b", completed: 2, status: "IN_PROGRESS" }),
        row({ userId: "c" }),
      ],
      D
    )[0];
    expect(g).toMatchObject({
      usersComplete: 1,
      itemsCompleted: 5,
      itemsTotal: 9,
      itemsPercent: 56,
      status: "IN_PROGRESS",
    });
  });

  it("all users complete → Complete; none started → Not started; some started → In progress", () => {
    const done = (u: string) =>
      row({ userId: u, completed: 3, status: "COMPLETE" });
    expect(groupTodayRows([done("a"), done("b")], D)[0]).toMatchObject({
      status: "COMPLETE",
      usersComplete: 2,
    });
    expect(
      groupTodayRows([row({ userId: "a" }), row({ userId: "b" })], D)[0].status
    ).toBe("NOT_STARTED");
    expect(groupTodayRows([done("a"), row({ userId: "b" })], D)[0].status).toBe(
      "IN_PROGRESS"
    );
    expect(
      groupTodayRows(
        [
          row({ userId: "a", completed: 1, status: "IN_PROGRESS" }),
          row({ userId: "b" }),
        ],
        D
      )[0].status
    ).toBe("IN_PROGRESS");
  });

  it("no items → No items (EMPTY)", () => {
    const g = groupTodayRows(
      [
        row({ userId: "a", total: 0, status: "EMPTY" }),
        row({ userId: "b", total: 0, status: "EMPTY" }),
      ],
      D
    )[0];
    expect(g).toMatchObject({
      status: "EMPTY",
      itemsTotal: 0,
      itemsPercent: 0,
    });
  });

  it("no rows → no groups", () => {
    expect(groupTodayRows([], D)).toEqual([]);
  });

  it("keeps each user's own record (day id) and never mutates the rows", () => {
    const rows = [row({ userId: "a" }), row({ userId: "b" })];
    const copy = JSON.stringify(rows);
    const g = groupTodayRows(rows, D);
    expect(g[0].users.map((u) => u.dayId)).toEqual(rows.map((r) => r.dayId));
    expect(JSON.stringify(rows)).toBe(copy);
  });
});
