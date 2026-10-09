import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, membershipMock, state } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  membershipMock: vi.fn(),
  state: {
    item: null as Record<string, unknown> | null,
    // Every UPDATE ... SET payload, tagged with which table it hit.
    updates: [] as { table: string; values: Record<string, unknown> }[],
    hardDeletes: 0,
  },
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));
vi.mock("@/lib/permissions", () => ({
  getWorkspaceMembership: membershipMock,
}));
vi.mock("@/lib/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => (state.item ? [state.item] : []),
        }),
      }),
    }),
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push({ table: getTableName(table), values });
        return { where: async () => undefined };
      },
    }),
    delete: () => {
      state.hardDeletes++;
      return { where: async () => undefined };
    },
  };
  return {
    db: {
      transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
      delete: () => {
        state.hardDeletes++;
        return { where: async () => undefined };
      },
    },
  };
});

import {
  deleteChecklistTask,
  stopChecklistSeries,
} from "@/app/actions/daily-checklist";

const TODAY = new Date().toISOString().slice(0, 10);
const TASK = "checklist_task";
const OCC = "checklist_task_occurrence";

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  membershipMock.mockReset().mockResolvedValue({ role: "MEMBER" });
  state.updates = [];
  state.hardDeletes = 0;
  state.item = {
    id: "i1",
    repeat: "DAILY",
    startDate: "2020-01-01",
    endDate: null,
    deletedAt: null,
  };
});

describe("stop / delete never physically delete checklist history", () => {
  it("stop only end-dates the series", async () => {
    expect(await stopChecklistSeries("ws", "i1", TODAY, TODAY)).toEqual({
      success: true,
    });
    expect(state.hardDeletes).toBe(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].table).toBe(TASK);
    expect(String(state.updates[0].values.endDate) < TODAY).toBe(true);
  });

  it("delete this & future end-dates and soft-removes later rows", async () => {
    expect(
      await deleteChecklistTask("ws", "i1", TODAY, "FUTURE", TODAY)
    ).toEqual({ success: true });
    expect(state.hardDeletes).toBe(0);
    const task = state.updates.find((u) => u.table === TASK);
    const occ = state.updates.find((u) => u.table === OCC);
    expect(String(task?.values.endDate) < TODAY).toBe(true);
    expect(task?.values.deletedAt).toBeUndefined();
    expect(occ?.values.removedAt).toBeInstanceOf(Date);
    // status / completedAt / completedBy are never rewritten
    expect(occ?.values).not.toHaveProperty("status");
    expect(occ?.values).not.toHaveProperty("completedAt");
  });

  it("delete entire series soft-deletes the task and leaves occurrences alone", async () => {
    expect(await deleteChecklistTask("ws", "i1", TODAY, "ALL", TODAY)).toEqual({
      success: true,
    });
    expect(state.hardDeletes).toBe(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].table).toBe(TASK);
    expect(state.updates[0].values.deletedAt).toBeInstanceOf(Date);
    // series is end-dated at the effective day so nothing shows from then on
    expect(String(state.updates[0].values.endDate) < TODAY).toBe(true);
  });

  it("deleting an already-deleted series keeps the original deletion time", async () => {
    const original = new Date("2026-01-01T00:00:00Z");
    state.item = { ...state.item, deletedAt: original, endDate: "2026-01-01" };
    expect(await deleteChecklistTask("ws", "i1", TODAY, "ALL", TODAY)).toEqual({
      success: true,
    });
    expect(state.updates[0].values.deletedAt).toBe(original);
    // never extends an earlier end date
    expect(state.updates[0].values.endDate).toBe("2026-01-01");
    expect(state.hardDeletes).toBe(0);
  });

  it("one-off delete is a soft delete too", async () => {
    state.item = { ...state.item, repeat: "NONE", startDate: TODAY };
    await deleteChecklistTask("ws", "i1", TODAY, "FUTURE", TODAY);
    expect(state.hardDeletes).toBe(0);
    expect(state.updates[0].values.deletedAt).toBeInstanceOf(Date);
  });

  it("rejects past dates, unknown tasks and non-members", async () => {
    expect(
      await deleteChecklistTask("ws", "i1", "2020-01-02", "ALL", TODAY)
    ).toEqual({ error: "Past days are read-only" });
    state.item = null;
    expect(await stopChecklistSeries("ws", "nope", TODAY, TODAY)).toEqual({
      error: "Task not found",
    });
    membershipMock.mockResolvedValue(null);
    expect(await deleteChecklistTask("ws", "i1", TODAY, "ALL", TODAY)).toEqual({
      error: "Forbidden",
    });
    expect(state.hardDeletes).toBe(0);
  });
});
