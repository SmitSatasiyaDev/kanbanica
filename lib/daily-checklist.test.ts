import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  buildMonthGrid,
  type ChecklistStatus,
  canCompleteOnDate,
  dayStatus,
  endDateAfterOccurrences,
  initialNavState,
  isOccurrenceVisible,
  isValidDateStr,
  isViewMode,
  msUntilNextLocalMidnight,
  navReducer,
  occursOn,
  pickPreviewTasks,
  type RecurrenceRule,
  resolveSeriesEnd,
  shouldExitFocus,
  splitCellTasks,
  stopEndDate,
  summarizeStatuses,
  VIEW_MODES,
  watchLocalToday,
  withStatus,
} from "./daily-checklist";

const rule = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
  startDate: "2026-10-08",
  endDate: null,
  repeat: "DAILY",
  repeatInterval: 1,
  repeatUnit: null,
  ...over,
});

describe("daily checklist recurrence", () => {
  it("never occurs before the start date", () => {
    expect(occursOn(rule({}), "2026-10-07")).toBe(false);
    expect(occursOn(rule({}), "2026-10-08")).toBe(true);
  });

  it("NONE occurs only on the start date", () => {
    const r = rule({ repeat: "NONE" });
    expect(occursOn(r, "2026-10-08")).toBe(true);
    expect(occursOn(r, "2026-10-09")).toBe(false);
  });

  it("respects the end date (inclusive)", () => {
    const r = rule({ endDate: "2026-10-10" });
    expect(occursOn(r, "2026-10-10")).toBe(true);
    expect(occursOn(r, "2026-10-11")).toBe(false);
  });

  it("WEEKDAYS skips weekends", () => {
    const r = rule({ repeat: "WEEKDAYS", startDate: "2026-10-05" }); // Monday
    expect(occursOn(r, "2026-10-09")).toBe(true); // Fri
    expect(occursOn(r, "2026-10-10")).toBe(false); // Sat
    expect(occursOn(r, "2026-10-11")).toBe(false); // Sun
    expect(occursOn(r, "2026-10-12")).toBe(true); // Mon
  });

  it("WEEKLY repeats on the same weekday", () => {
    const r = rule({ repeat: "WEEKLY" });
    expect(occursOn(r, "2026-10-15")).toBe(true);
    expect(occursOn(r, "2026-10-16")).toBe(false);
  });

  it("MONTHLY clamps a 31st start to shorter months", () => {
    const r = rule({ repeat: "MONTHLY", startDate: "2026-01-31" });
    expect(occursOn(r, "2026-02-28")).toBe(true);
    expect(occursOn(r, "2026-02-27")).toBe(false);
    expect(occursOn(r, "2026-03-31")).toBe(true);
  });

  it("CUSTOM supports day / week / month intervals", () => {
    const days = rule({
      repeat: "CUSTOM",
      repeatInterval: 3,
      repeatUnit: "DAY",
    });
    expect(occursOn(days, "2026-10-11")).toBe(true);
    expect(occursOn(days, "2026-10-10")).toBe(false);
    const weeks = rule({
      repeat: "CUSTOM",
      repeatInterval: 2,
      repeatUnit: "WEEK",
    });
    expect(occursOn(weeks, "2026-10-22")).toBe(true);
    expect(occursOn(weeks, "2026-10-15")).toBe(false);
    const months = rule({
      repeat: "CUSTOM",
      repeatInterval: 2,
      repeatUnit: "MONTH",
    });
    expect(occursOn(months, "2026-12-08")).toBe(true);
    expect(occursOn(months, "2026-11-08")).toBe(false);
  });
});

describe("date helpers", () => {
  it("adds days across month and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("validates real calendar dates", () => {
    expect(isValidDateStr("2026-02-30")).toBe(false);
    expect(isValidDateStr("2026-10-08")).toBe(true);
    expect(isValidDateStr("nope")).toBe(false);
  });
});

describe("series end", () => {
  const base = {
    startDate: "2026-10-08",
    repeatInterval: 1,
    repeatUnit: null,
    endDate: null,
    endAfter: null,
  } as const;

  it("Never / non-repeating produce no end date", () => {
    expect(resolveSeriesEnd({ ...base, repeat: "DAILY" })).toEqual({
      endDate: null,
    });
    expect(
      resolveSeriesEnd({ ...base, repeat: "NONE", endDate: "2026-12-01" })
    ).toEqual({ endDate: null });
  });

  it("accepts an end date on/after the start, rejects earlier or both", () => {
    expect(
      resolveSeriesEnd({ ...base, repeat: "DAILY", endDate: "2026-10-08" })
    ).toEqual({ endDate: "2026-10-08" });
    expect(
      resolveSeriesEnd({ ...base, repeat: "DAILY", endDate: "2026-10-07" })
    ).toHaveProperty("error");
    expect(
      resolveSeriesEnd({
        ...base,
        repeat: "DAILY",
        endDate: "2026-10-20",
        endAfter: 3,
      })
    ).toHaveProperty("error");
  });

  it("'after N' lands on the Nth occurrence", () => {
    expect(endDateAfterOccurrences({ ...base, repeat: "DAILY" }, 3)).toBe(
      "2026-10-10"
    );
    // 2026-10-08 is a Thursday: weekdays are Thu, Fri, Mon, Tue.
    expect(endDateAfterOccurrences({ ...base, repeat: "WEEKDAYS" }, 3)).toBe(
      "2026-10-12"
    );
    expect(
      resolveSeriesEnd({ ...base, repeat: "WEEKLY", endAfter: 2 })
    ).toEqual({ endDate: "2026-10-15" });
    expect(
      resolveSeriesEnd({ ...base, repeat: "DAILY", endAfter: 0 })
    ).toHaveProperty("error");
  });
});

describe("stopping a series (history-preserving)", () => {
  const daily: RecurrenceRule = {
    startDate: "2026-10-01",
    endDate: null,
    repeat: "DAILY",
    repeatInterval: 1,
    repeatUnit: null,
  };
  // Stored records: completed Oct 3, skipped Oct 5, completed Oct 9 (today).
  const recorded: Record<string, ChecklistStatus> = {
    "2026-10-03": "COMPLETED",
    "2026-10-05": "SKIPPED",
    "2026-10-09": "COMPLETED",
  };
  const view = (rule: RecurrenceRule, d: string) => {
    const st = recorded[d];
    return isOccurrenceVisible(rule, st, d) ? (st ?? "INCOMPLETE") : null;
  };
  const day = (rule: RecurrenceRule, d: string) =>
    summarizeStatuses(
      [view(rule, d)].filter((x): x is ChecklistStatus => x !== null)
    );

  it("ends the day before the effective date and never extends a series", () => {
    expect(stopEndDate(null, "2026-10-09")).toBe("2026-10-08");
    expect(stopEndDate("2026-10-20", "2026-10-09")).toBe("2026-10-08");
    expect(stopEndDate("2026-10-05", "2026-10-09")).toBe("2026-10-05");
  });

  it("past days render exactly as before the stop", () => {
    const stopped = { ...daily, endDate: stopEndDate(null, "2026-10-09") };
    for (const d of ["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-08"]) {
      expect(view(stopped, d)).toBe(view(daily, d));
      expect(day(stopped, d)).toEqual(day(daily, d));
    }
    expect(view(stopped, "2026-10-03")).toBe("COMPLETED");
    expect(view(stopped, "2026-10-05")).toBe("SKIPPED");
    expect(view(stopped, "2026-10-04")).toBe("INCOMPLETE");
  });

  it("hides recorded rows on/after the effective date (no bypass of the end date)", () => {
    const stopped = { ...daily, endDate: stopEndDate(null, "2026-10-09") };
    // today's completed record and a pre-completed future record are both hidden
    expect(view(stopped, "2026-10-09")).toBeNull();
    const future: Record<string, ChecklistStatus> = {
      "2026-10-15": "COMPLETED",
      "2026-10-16": "SKIPPED",
    };
    for (const [d, st] of Object.entries(future)) {
      expect(isOccurrenceVisible(stopped, st, d)).toBe(false);
    }
    // unrecorded future days are gone too
    expect(view(stopped, "2026-10-10")).toBeNull();
    expect(view(stopped, "2026-11-01")).toBeNull();
  });

  it("is stable: the same answer before and after a refresh (pure function of stored data)", () => {
    const stopped = { ...daily, endDate: stopEndDate(null, "2026-10-09") };
    const first = ["2026-10-08", "2026-10-09", "2026-10-15"].map((d) =>
      view(stopped, d)
    );
    const second = ["2026-10-08", "2026-10-09", "2026-10-15"].map((d) =>
      view(stopped, d)
    );
    expect(second).toEqual(first);
  });

  it("a stop on the first day leaves nothing visible (there is no earlier history)", () => {
    const stopped = { ...daily, endDate: stopEndDate(null, "2026-10-01") };
    expect(occursOn(stopped, "2026-10-01")).toBe(false);
    expect(view(stopped, "2026-10-03")).toBeNull();
  });

  it("a soft-removed occurrence never shows, even if completed", () => {
    expect(isOccurrenceVisible(daily, "COMPLETED", "2026-10-03", true)).toBe(
      false
    );
    expect(isOccurrenceVisible(daily, undefined, "2026-10-04", true)).toBe(
      false
    );
    expect(isOccurrenceVisible(daily, "COMPLETED", "2026-10-03", false)).toBe(
      true
    );
  });
});

describe("per-date state of a daily series", () => {
  const rule: RecurrenceRule = {
    startDate: "2026-10-01",
    endDate: null,
    repeat: "DAILY",
    repeatInterval: 1,
    repeatUnit: null,
  };
  // One stored row per touched date, exactly like checklist_task_occurrence.
  const stored: Record<string, ChecklistStatus> = {
    "2026-10-08": "COMPLETED",
    "2026-10-09": "SKIPPED",
  };
  const statusOn = (d: string): ChecklistStatus | null =>
    isOccurrenceVisible(rule, stored[d], d)
      ? (stored[d] ?? "INCOMPLETE")
      : null;

  it("completing or skipping one day leaves the others untouched", () => {
    expect(statusOn("2026-10-07")).toBe("INCOMPLETE");
    expect(statusOn("2026-10-08")).toBe("COMPLETED");
    expect(statusOn("2026-10-09")).toBe("SKIPPED");
    expect(statusOn("2026-10-10")).toBe("INCOMPLETE");
  });

  it("a skipped/completed day stays visible even if the rule no longer fires", () => {
    const weekly = { ...rule, repeat: "WEEKLY" as const };
    expect(isOccurrenceVisible(weekly, "COMPLETED", "2026-10-09")).toBe(true);
    expect(isOccurrenceVisible(weekly, "INCOMPLETE", "2026-10-09")).toBe(false);
  });

  it("totals exclude skipped tasks", () => {
    expect(summarizeStatuses(["COMPLETED", "INCOMPLETE", "SKIPPED"])).toEqual({
      total: 2,
      completed: 1,
    });
    expect(summarizeStatuses(["SKIPPED"])).toEqual({ total: 0, completed: 0 });
  });
});

describe("calendar day status", () => {
  const TODAY = "2026-10-09";
  it("classifies days from their non-skipped totals", () => {
    expect(dayStatus(undefined, "2026-10-05", TODAY).kind).toBe("none");
    expect(
      dayStatus({ total: 0, completed: 0 }, "2026-10-05", TODAY).kind
    ).toBe("none");
    expect(dayStatus({ total: 3, completed: 3 }, "2026-10-05", TODAY)).toEqual({
      kind: "all",
      overdue: false,
      pending: 0,
    });
    expect(dayStatus({ total: 3, completed: 1 }, "2026-10-05", TODAY)).toEqual({
      kind: "some",
      overdue: true,
      pending: 2,
    });
  });

  it("separates missed (past) from pending (today/upcoming) and only flags past pending as overdue", () => {
    expect(dayStatus({ total: 2, completed: 0 }, "2026-10-08", TODAY)).toEqual({
      kind: "missed",
      overdue: true,
      pending: 2,
    });
    for (const d of [TODAY, "2026-10-10"]) {
      expect(dayStatus({ total: 2, completed: 0 }, d, TODAY)).toEqual({
        kind: "pending",
        overdue: false,
        pending: 2,
      });
    }
  });

  it("recomputes when today moves forward (overdue follows the new boundary)", () => {
    const s = { total: 2, completed: 0 };
    expect(dayStatus(s, "2026-10-09", "2026-10-09").overdue).toBe(false);
    expect(dayStatus(s, "2026-10-09", "2026-10-10").overdue).toBe(true);
  });

  it("totals and percentage match after a stop hides recorded rows", () => {
    const rule: RecurrenceRule = {
      startDate: "2026-10-01",
      endDate: "2026-10-08",
      repeat: "DAILY",
      repeatInterval: 1,
      repeatUnit: null,
    };
    const recorded: Record<string, ChecklistStatus> = {
      "2026-10-08": "COMPLETED",
      "2026-10-09": "COMPLETED",
    };
    const on = (d: string) =>
      summarizeStatuses(
        isOccurrenceVisible(rule, recorded[d], d)
          ? [recorded[d] ?? "INCOMPLETE"]
          : []
      );
    expect(on("2026-10-08")).toEqual({ total: 1, completed: 1 });
    expect(on("2026-10-09")).toEqual({ total: 0, completed: 0 });
  });
});

describe("local-midnight tracking", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes the delay to the next local midnight (buffered)", () => {
    const now = new Date(2026, 9, 9, 23, 59, 0, 0); // local
    expect(msUntilNextLocalMidnight(now)).toBe(60_000 + 250);
    const morning = new Date(2026, 9, 9, 0, 0, 0, 0);
    expect(msUntilNextLocalMidnight(morning)).toBe(86_400_000 + 250);
  });

  it("fires once when the local date rolls over, then re-arms for the next midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 23, 59, 30));
    const seen: string[] = [];
    const stop = watchLocalToday((d) => seen.push(d), undefined);
    vi.advanceTimersByTime(29_000);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(2000);
    expect(seen).toEqual(["2026-10-10"]);
    vi.advanceTimersByTime(24 * 3_600_000);
    expect(seen).toEqual(["2026-10-10", "2026-10-11"]);
    stop();
    vi.advanceTimersByTime(48 * 3_600_000);
    expect(seen).toHaveLength(2);
  });

  it("re-checks when a backgrounded tab becomes visible and only reports real changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 22, 0, 0));
    const listeners: Record<string, () => void> = {};
    const doc = {
      visibilityState: "hidden" as string,
      addEventListener: (t: string, cb: () => void) => {
        listeners[t] = cb;
      },
      removeEventListener: (t: string) => {
        delete listeners[t];
      },
    };
    const seen: string[] = [];
    const stop = watchLocalToday((d) => seen.push(d), doc as never);
    // Becoming visible on the same day: no change reported.
    doc.visibilityState = "visible";
    listeners.visibilitychange();
    expect(seen).toEqual([]);
    // Tab was throttled across midnight: the system clock moves without timers firing.
    doc.visibilityState = "hidden";
    vi.setSystemTime(new Date(2026, 9, 10, 9, 0, 0));
    listeners.visibilitychange(); // still hidden → ignored
    expect(seen).toEqual([]);
    doc.visibilityState = "visible";
    listeners.visibilitychange();
    expect(seen).toEqual(["2026-10-10"]);
    stop();
    expect(listeners.visibilitychange).toBeUndefined();
  });
});

describe("editing from a day onward (series split) never double-books a date", () => {
  const base: RecurrenceRule = {
    startDate: "2026-10-01",
    endDate: null,
    repeat: "DAILY",
    repeatInterval: 1,
    repeatUnit: null,
  };
  const splitAt = "2026-10-09";
  const oldRule = { ...base, endDate: stopEndDate(base.endDate, splitAt) };
  const newRule: RecurrenceRule = {
    ...base,
    startDate: splitAt,
    repeat: "WEEKLY",
  };

  it("each date belongs to exactly one of the two series", () => {
    for (let i = -8; i <= 40; i++) {
      const d = addDays(splitAt, i);
      const owners = [oldRule, newRule].filter((r) => occursOn(r, d)).length;
      expect(owners).toBeLessThanOrEqual(1);
    }
    expect(occursOn(oldRule, "2026-10-08")).toBe(true);
    expect(occursOn(newRule, "2026-10-08")).toBe(false);
    expect(occursOn(newRule, splitAt)).toBe(true);
  });

  it("a stray recorded row left on the old series after the split stays hidden", () => {
    expect(isOccurrenceVisible(oldRule, "COMPLETED", splitAt)).toBe(false);
    expect(isOccurrenceVisible(oldRule, "SKIPPED", "2026-10-20")).toBe(false);
  });
});

describe("month calendar grid", () => {
  it("is Sunday-first, padded with neighbouring days, and covers the whole month once", () => {
    const grid = buildMonthGrid("2026-10"); // Oct 1 2026 is a Thursday
    expect(grid).toHaveLength(5);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0][0]).toBe("2026-09-27");
    expect(grid[0][4]).toBe("2026-10-01");
    expect(grid[4][6]).toBe("2026-10-31");
    const inMonth = grid.flat().filter((d) => d.startsWith("2026-10"));
    expect(inMonth).toHaveLength(31);
    expect(new Set(grid.flat()).size).toBe(grid.flat().length);
  });

  it("handles 4-, 5- and 6-row months and leap years", () => {
    expect(buildMonthGrid("2026-02")).toHaveLength(4); // Feb 2026 starts Sunday, 28 days
    expect(buildMonthGrid("2026-03")).toHaveLength(5);
    expect(buildMonthGrid("2026-08")).toHaveLength(6); // Aug 1 2026 is Saturday, 31 days
    const leap = buildMonthGrid("2028-02").flat();
    expect(leap).toContain("2028-02-29");
    expect(leap.filter((d) => d.startsWith("2028-02"))).toHaveLength(29);
  });

  it("crosses year boundaries", () => {
    const dec = buildMonthGrid("2026-12").flat();
    expect(dec[0] <= "2026-12-01").toBe(true);
    expect(
      dec.at(-1)?.startsWith("2027-01") || dec.at(-1)?.startsWith("2026-12")
    ).toBe(true);
    const jan = buildMonthGrid("2027-01").flat();
    expect(jan[0].startsWith("2026-12") || jan[0] === "2027-01-01").toBe(true);
  });
});

describe("calendar hover preview data", () => {
  type Task = { itemId: string; status: ChecklistStatus; title: string };
  const t = (id: string, status: ChecklistStatus): Task => ({
    itemId: id,
    status,
    title: id,
  });
  // Same pipeline the month-summary action runs per day.
  const preview = (tasks: Task[]) => {
    const active = tasks.filter((x) => x.status !== "SKIPPED");
    return {
      ...summarizeStatuses(active.map((x) => x.status)),
      preview: pickPreviewTasks(active),
    };
  };

  it("a day with no tasks has no preview lines", () => {
    expect(preview([])).toEqual({ total: 0, completed: 0, preview: [] });
    expect(dayStatus(undefined, "2026-10-09", "2026-10-09").kind).toBe("none");
  });

  it("one task", () => {
    const p = preview([t("a", "INCOMPLETE")]);
    expect(p.total).toBe(1);
    expect(p.preview.map((x) => x.itemId)).toEqual(["a"]);
  });

  it("several tasks: three titles, pending first, remainder counted", () => {
    const p = preview([
      t("done", "COMPLETED"),
      t("p1", "INCOMPLETE"),
      t("p2", "INCOMPLETE"),
      t("p3", "INCOMPLETE"),
      t("p4", "INCOMPLETE"),
    ]);
    expect(p.total).toBe(5);
    expect(p.completed).toBe(1);
    expect(p.preview.map((x) => x.itemId)).toEqual(["p1", "p2", "p3"]);
    expect(p.total - p.preview.length).toBe(2); // "+2 more tasks"
  });

  it("completed and pending mix: completed shown after pending, percentage matches", () => {
    const p = preview([t("a", "COMPLETED"), t("b", "INCOMPLETE")]);
    expect(p.preview.map((x) => x.status)).toEqual(["INCOMPLETE", "COMPLETED"]);
    expect(Math.round((p.completed / p.total) * 100)).toBe(50);
  });

  it("skipped tasks are neither listed nor counted", () => {
    const p = preview([t("s", "SKIPPED"), t("a", "INCOMPLETE")]);
    expect(p.total).toBe(1);
    expect(p.preview.map((x) => x.itemId)).toEqual(["a"]);
  });

  it("overdue: a past day with pending tasks is flagged, today is not", () => {
    const p = preview([t("a", "INCOMPLETE")]);
    expect(dayStatus(p, "2026-10-08", "2026-10-09").overdue).toBe(true);
    expect(dayStatus(p, "2026-10-09", "2026-10-09").overdue).toBe(false);
    expect(dayStatus(p, "2026-10-08", "2026-10-09").kind).toBe("missed");
  });

  it("recurring task appears on every month day including the first and last, and stops at its end", () => {
    const rule: RecurrenceRule = {
      startDate: "2026-09-20",
      endDate: "2026-10-31",
      repeat: "DAILY",
      repeatInterval: 1,
      repeatUnit: null,
    };
    const recorded: Record<string, ChecklistStatus> = {
      "2026-10-01": "COMPLETED",
      "2026-10-31": "SKIPPED",
    };
    const dayTasks = (d: string): Task[] =>
      isOccurrenceVisible(rule, recorded[d], d)
        ? [t("daily", recorded[d] ?? "INCOMPLETE")]
        : [];
    expect(preview(dayTasks("2026-10-01"))).toMatchObject({
      total: 1,
      completed: 1,
    });
    expect(preview(dayTasks("2026-10-15"))).toMatchObject({
      total: 1,
      completed: 0,
    });
    // last day is skipped → not counted or listed
    expect(preview(dayTasks("2026-10-31"))).toMatchObject({
      total: 0,
      preview: [],
    });
    // after the series ends: nothing
    expect(dayTasks("2026-11-01")).toEqual([]);
  });
});

describe("view modes & navigation state", () => {
  const start = navReducer(initialNavState, {
    type: "init",
    today: "2026-10-09",
  });

  it("defaults to split view on today", () => {
    expect(start).toMatchObject({
      view: "split",
      date: "2026-10-09",
      month: "2026-10",
      filter: "all",
    });
  });

  it("switching views preserves date, month and filter", () => {
    let s = navReducer(start, { type: "selectDate", date: "2026-09-30" });
    s = navReducer(s, { type: "setFilter", filter: "pending" });
    for (const view of VIEW_MODES) {
      const next = navReducer(s, { type: "setView", view });
      expect(next).toEqual({ ...s, view });
    }
  });

  it("calendar selection sets date and month; month paging keeps date", () => {
    let s = navReducer(start, { type: "setView", view: "calendar" });
    s = navReducer(s, { type: "selectDate", date: "2026-11-03" });
    expect(s).toMatchObject({
      view: "calendar",
      date: "2026-11-03",
      month: "2026-11",
    });
    s = navReducer(s, { type: "setMonth", month: "2026-12" });
    expect(s).toMatchObject({ date: "2026-11-03", month: "2026-12" });
  });

  it("returns to split view without losing the selection", () => {
    let s = navReducer(start, { type: "setView", view: "task" });
    s = navReducer(s, { type: "selectDate", date: "2026-10-12" });
    s = navReducer(s, { type: "setView", view: "split" });
    expect(s).toMatchObject({
      view: "split",
      date: "2026-10-12",
      month: "2026-10",
    });
  });

  it("a new 'today' (midnight) never moves a chosen date", () => {
    const s = navReducer(start, { type: "selectDate", date: "2026-10-01" });
    expect(navReducer(s, { type: "init", today: "2026-10-10" })).toBe(s);
  });
});

describe("calendar focus cells", () => {
  const t = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

  it("shows everything that fits, no overflow row", () => {
    expect(splitCellTasks(t(0), 3)).toEqual({ visible: [], hidden: [] });
    expect(splitCellTasks(t(1), 3)).toEqual({ visible: ["t0"], hidden: [] });
    expect(splitCellTasks(t(3), 3).hidden).toEqual([]);
  });

  it("gives one row to '+N more' when tasks overflow", () => {
    const r = splitCellTasks(t(10), 3);
    expect(r.visible).toEqual(["t0", "t1"]);
    expect(r.hidden).toHaveLength(8);
    expect(splitCellTasks(t(2), 1)).toEqual({
      visible: [],
      hidden: ["t0", "t1"],
    });
    expect(splitCellTasks(t(2), 0).hidden).toHaveLength(2);
  });

  it("never loses a task", () => {
    for (let n = 0; n < 12; n++) {
      for (let cap = 0; cap < 6; cap++) {
        const r = splitCellTasks(t(n), cap);
        expect(r.visible.length + r.hidden.length).toBe(n);
        expect(
          r.visible.length + (r.hidden.length ? 1 : 0)
        ).toBeLessThanOrEqual(Math.max(cap, r.hidden.length ? 1 : 0));
      }
    }
  });

  it("only today can be completed from the calendar", () => {
    expect(canCompleteOnDate("2026-10-09", "2026-10-09")).toBe(true);
    expect(canCompleteOnDate("2026-10-08", "2026-10-09")).toBe(false);
    expect(canCompleteOnDate("2026-10-10", "2026-10-09")).toBe(false);
  });
});

describe("restoring the saved view", () => {
  it("init applies a stored view once, keeping today's date", () => {
    const s = navReducer(initialNavState, {
      type: "init",
      today: "2026-10-09",
      view: "calendar",
    });
    expect(s).toMatchObject({ view: "calendar", date: "2026-10-09" });
    expect(
      navReducer(s, { type: "init", today: "2026-10-10", view: "task" })
    ).toBe(s);
  });

  it("validates stored values", () => {
    expect(isViewMode("task")).toBe(true);
    expect(isViewMode("bogus")).toBe(false);
    expect(isViewMode(null)).toBe(false);
  });
});

describe("focus mode escape", () => {
  it("exits only on a free Escape", () => {
    expect(shouldExitFocus("Escape", false, false)).toBe(true);
    expect(shouldExitFocus("Escape", false, true)).toBe(false);
    expect(shouldExitFocus("Escape", true, false)).toBe(false);
    expect(shouldExitFocus("Enter", false, false)).toBe(false);
  });
});

describe("optimistic status updates", () => {
  const base = [
    { itemId: "a", status: "INCOMPLETE" as ChecklistStatus },
    { itemId: "b", status: "INCOMPLETE" as ChecklistStatus },
  ];

  it("flips only the targeted task", () => {
    expect(withStatus(base, "a", "COMPLETED")).toEqual([
      { itemId: "a", status: "COMPLETED" },
      { itemId: "b", status: "INCOMPLETE" },
    ]);
  });

  it("rapid successive clicks compose on the latest value, not a stale snapshot", () => {
    const afterA = withStatus(base, "a", "COMPLETED");
    const afterB = withStatus(afterA, "b", "COMPLETED");
    expect(afterB?.map((e) => e.status)).toEqual(["COMPLETED", "COMPLETED"]);
    expect(base[0].status).toBe("INCOMPLETE");
  });

  it("is a no-op while the cache is empty", () => {
    expect(withStatus(undefined, "a", "COMPLETED")).toBeUndefined();
  });
});
