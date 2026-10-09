import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, membershipMock, state } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  membershipMock: vi.fn(),
  state: {
    item: null as Record<string, unknown> | null,
    occurrence: null as Record<string, unknown> | null,
    selects: 0,
    inserts: [] as Record<string, unknown>[],
    conflictSets: [] as Record<string, unknown>[],
  },
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));
vi.mock("@/lib/permissions", () => ({
  getWorkspaceMembership: membershipMock,
}));
vi.mock("@/lib/db", () => ({
  db: {
    // 1st select = the task, 2nd select = the (item, date) occurrence row.
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const n = state.selects++;
            const row = n % 2 === 0 ? state.item : state.occurrence;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.inserts.push(v);
        return {
          onConflictDoUpdate: async (c: { set: Record<string, unknown> }) => {
            state.conflictSets.push(c.set);
          },
        };
      },
    }),
  },
}));

import { setChecklistStatus } from "@/app/actions/daily-checklist";
import { addDays, FUTURE_COMPLETION_ERROR } from "@/lib/daily-checklist";

const TODAY = new Date().toISOString().slice(0, 10);
const TOMORROW = addDays(TODAY, 1);
const FAR_FUTURE = addDays(TODAY, 30);
const YESTERDAY = addDays(TODAY, -1);

const daily = {
  id: "i1",
  repeat: "DAILY",
  startDate: "2020-01-01",
  endDate: null,
  deletedAt: null,
};

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  membershipMock.mockReset().mockResolvedValue({ role: "MEMBER" });
  state.item = { ...daily };
  state.occurrence = null;
  state.selects = 0;
  state.inserts = [];
  state.conflictSets = [];
});

const call = (date: string, status: "COMPLETED" | "INCOMPLETE" | "SKIPPED") => {
  state.selects = 0;
  return setChecklistStatus("ws", "i1", date, status, TODAY);
};

describe("setChecklistStatus — future completion is enforced on the server", () => {
  it("rejects completing a future occurrence (direct action call)", async () => {
    for (const d of [TOMORROW, FAR_FUTURE]) {
      expect(await call(d, "COMPLETED")).toEqual({
        error: FUTURE_COMPLETION_ERROR,
      });
    }
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects un-completing a future occurrence", async () => {
    state.occurrence = { status: "COMPLETED", removedAt: null };
    expect(await call(TOMORROW, "INCOMPLETE")).toEqual({
      error: FUTURE_COMPLETION_ERROR,
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("still allows skipping a future occurrence and restoring a skipped one", async () => {
    expect(await call(TOMORROW, "SKIPPED")).toEqual({ success: true });
    expect(state.conflictSets.at(-1)).toMatchObject({ status: "SKIPPED" });

    state.occurrence = { status: "SKIPPED", removedAt: null };
    expect(await call(TOMORROW, "INCOMPLETE")).toEqual({ success: true });
    expect(state.conflictSets.at(-1)).toMatchObject({ status: "INCOMPLETE" });
  });

  it("today's completion and un-completion keep working", async () => {
    expect(await call(TODAY, "COMPLETED")).toEqual({ success: true });
    const done = state.conflictSets.at(-1) as Record<string, unknown>;
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.completedBy).toBe("u1");

    state.occurrence = { status: "COMPLETED", removedAt: null };
    expect(await call(TODAY, "INCOMPLETE")).toEqual({ success: true });
    expect(state.conflictSets.at(-1)).toMatchObject({
      status: "INCOMPLETE",
      completedAt: null,
    });
  });

  it("past days stay read-only", async () => {
    expect(await call(YESTERDAY, "COMPLETED")).toEqual({
      error: "Past days are read-only",
    });
    expect(await call("2020-01-02", "SKIPPED")).toEqual({
      error: "Past days are read-only",
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("an invalid client 'today' (more than a day off) is rejected", async () => {
    state.selects = 0;
    expect(
      await setChecklistStatus(
        "ws",
        "i1",
        TODAY,
        "COMPLETED",
        addDays(TODAY, 5)
      )
    ).toEqual({ error: "Invalid request" });
  });
});

describe("setChecklistStatus — recorded rows cannot bypass the series end", () => {
  it("rejects a day after the end date even if a row exists for it", async () => {
    state.item = { ...daily, endDate: YESTERDAY };
    state.occurrence = { status: "COMPLETED", removedAt: null };
    expect(await call(TODAY, "SKIPPED")).toEqual({
      error: "Task does not occur on this day",
    });
  });

  it("rejects a soft-removed occurrence", async () => {
    state.occurrence = { status: "COMPLETED", removedAt: new Date() };
    expect(await call(TODAY, "SKIPPED")).toEqual({
      error: "Task does not occur on this day",
    });
  });

  it("a series deleted from a later day keeps today completable", async () => {
    state.item = {
      ...daily,
      endDate: TODAY, // deleted from tomorrow: end = today
      deletedAt: new Date(),
    };
    expect(await call(TODAY, "COMPLETED")).toEqual({ success: true });
  });

  it("unknown task / non-member", async () => {
    state.item = null;
    expect(await call(TODAY, "COMPLETED")).toEqual({ error: "Task not found" });
    membershipMock.mockResolvedValue(null);
    expect(await call(TODAY, "COMPLETED")).toEqual({ error: "Forbidden" });
  });
});
