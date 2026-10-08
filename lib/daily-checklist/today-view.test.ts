import { describe, expect, it } from "vitest";
import {
  groupMyChecklists,
  summarizeAdminToday,
  summarizeToday,
} from "./today-view";
import type { TeamItemRow, TodayInstanceRow } from "./types";

let n = 0;
const row = (over: Partial<TeamItemRow> = {}): TeamItemRow =>
  ({
    id: `i${++n}`,
    title: "t",
    description: null,
    notes: null,
    priority: "NONE",
    dueTime: null,
    status: "PENDING",
    sortOrder: 0,
    completedAt: null,
    completedBy: null,
    assigneeId: "u",
    assigneeImage: null,
    assigneeName: "U",
    assigneeTimezone: "UTC",
    date: "2026-10-08",
    dayId: "d1",
    editable: true,
    templateId: "t1",
    templateItemId: null,
    templateName: "Daily dev",
    ...over,
  }) as TeamItemRow;

describe("today view helpers", () => {
  it("groups the viewer's items per checklist day with progress + status", () => {
    const g = groupMyChecklists([
      row({ status: "DONE" }),
      row({ status: "PENDING" }),
      row({ dayId: "d2", templateName: "HR", status: "DONE" }),
      row({ dayId: "d3", templateName: null }),
    ]);
    expect(g.map((x) => [x.name, x.completed, x.total, x.status])).toEqual([
      ["Daily dev", 1, 2, "IN_PROGRESS"],
      ["HR", 1, 1, "COMPLETE"],
      ["Checklist", 0, 1, "NOT_STARTED"],
    ]);
  });

  it("in-progress items make an otherwise untouched checklist In Progress", () => {
    const [g] = groupMyChecklists([row({ status: "IN_PROGRESS" })]);
    expect(g.status).toBe("IN_PROGRESS");
  });

  it("summarises items and complete checklists", () => {
    const s = summarizeToday([
      row({ status: "DONE" }),
      row({ status: "IN_PROGRESS" }),
      row({ status: "PENDING" }),
      row({ dayId: "d2", status: "DONE" }),
    ]);
    expect(s).toEqual({
      tasksDone: 2,
      tasksTotal: 4,
      inProgress: 1,
      pending: 1,
      checklistsComplete: 1,
    });
  });

  it("empty input", () => {
    expect(groupMyChecklists([])).toEqual([]);
    expect(summarizeToday([]).tasksTotal).toBe(0);
  });
});

describe("summarizeAdminToday", () => {
  const r = (over: Partial<TodayInstanceRow>): TodayInstanceRow => ({
    completed: 0,
    dayId: "d",
    status: "NOT_STARTED",
    templateId: "t",
    templateName: "T",
    total: 3,
    userId: "u",
    userImage: null,
    userName: "U",
    ...over,
  });
  it("counts tasks and checklists per state", () => {
    expect(
      summarizeAdminToday([
        r({ completed: 3, status: "COMPLETE" }),
        r({ completed: 1, status: "IN_PROGRESS" }),
        r({}),
        r({ total: 0, status: "EMPTY" }),
      ])
    ).toEqual({
      tasksDone: 4,
      tasksTotal: 9,
      inProgress: 1,
      notStarted: 1,
      complete: 1,
    });
  });
  it("empty", () => {
    expect(summarizeAdminToday([]).tasksTotal).toBe(0);
  });
});
