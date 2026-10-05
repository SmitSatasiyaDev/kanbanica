import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  membershipMock,
  purgeMock,
  restoreMock,
  selectMock,
  transactionMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  membershipMock: vi.fn(),
  purgeMock: vi.fn(),
  restoreMock: vi.fn(),
  selectMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));
vi.mock("@/lib/permissions", () => ({
  getWorkspaceMembership: membershipMock,
}));
vi.mock("@/lib/db", () => ({
  db: { select: selectMock, transaction: transactionMock },
}));
vi.mock("@/lib/trash", () => ({
  purgeTasks: purgeMock,
  restoreTasks: restoreMock,
}));
vi.mock("@/lib/realtime/refresh", () => ({ refreshWorkspace: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: vi.fn() }));

import {
  emptyTrash,
  getDeletedTasks,
  permanentlyDeleteTasks,
  restoreDeletedTasks,
} from "@/app/actions/trash";

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "u1", email: "a@b.c" } });
});

describe("Trash permissions (Owner/Admin only)", () => {
  it.each(["MEMBER", "GUEST"])(
    "rejects a workspace %s on every action",
    async (role) => {
      membershipMock.mockResolvedValue({ role });
      const results = await Promise.all([
        getDeletedTasks("w1"),
        restoreDeletedTasks("w1", ["t1"]),
        permanentlyDeleteTasks("w1", ["t1"]),
        emptyTrash("w1"),
      ]);
      for (const r of results) {
        expect(r).toEqual({ error: "Forbidden" });
      }
      expect(purgeMock).not.toHaveBeenCalled();
      expect(restoreMock).not.toHaveBeenCalled();
      expect(selectMock).not.toHaveBeenCalled();
    }
  );

  it("rejects non-members and unauthenticated callers", async () => {
    membershipMock.mockResolvedValue(null);
    expect(await emptyTrash("w1")).toEqual({ error: "Forbidden" });
    getSessionMock.mockResolvedValue(null);
    expect(await emptyTrash("w1")).toEqual({ error: "Unauthorized" });
  });

  it.each(["OWNER", "ADMIN"])(
    "%s may purge, scoped to trashed rows in the workspace",
    async (role) => {
      membershipMock.mockResolvedValue({ role });
      selectMock.mockReturnValue({
        from: () => ({
          where: () => Promise.resolve([{ id: "t1", parentTaskId: null }]),
        }),
      });
      purgeMock.mockResolvedValue({ purged: ["t1"], failed: [], skipped: 0 });
      expect(await permanentlyDeleteTasks("w1", ["t1"])).toEqual({
        ok: true,
        deleted: 1,
        failed: 0,
      });
      expect(purgeMock).toHaveBeenCalledWith(["t1"], {
        reason: "manual",
        actor: { id: "u1", email: "a@b.c" },
      });
    }
  );

  it("reports nothing to purge when ids are not in this workspace's Trash", async () => {
    membershipMock.mockResolvedValue({ role: "ADMIN" });
    selectMock.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([]) }),
    });
    expect(await permanentlyDeleteTasks("w1", ["x"])).toEqual({
      error: "Nothing to delete",
    });
    expect(purgeMock).not.toHaveBeenCalled();
  });
});

describe("manual Delete forever / Empty trash share the safe purge", () => {
  beforeEach(() => {
    membershipMock.mockResolvedValue({ role: "ADMIN" });
  });

  it("reports an error and keeps the task when file cleanup failed", async () => {
    selectMock.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{ id: "t1", parentTaskId: null }]),
      }),
    });
    purgeMock.mockResolvedValue({ purged: [], failed: ["t1"], skipped: 0 });
    const res = await permanentlyDeleteTasks("w1", ["t1"]);
    expect(res).toHaveProperty("error");
  });

  it("returns ok with a failed count on a partial purge", async () => {
    selectMock.mockReturnValue({
      from: () => ({
        where: () =>
          Promise.resolve([
            { id: "t1", parentTaskId: null },
            { id: "t2", parentTaskId: null },
          ]),
      }),
    });
    purgeMock.mockResolvedValue({ purged: ["t1"], failed: ["t2"], skipped: 0 });
    expect(await permanentlyDeleteTasks("w1", ["t1", "t2"])).toEqual({
      ok: true,
      deleted: 1,
      failed: 1,
    });
  });

  it("Empty trash purges every trashed task in the workspace via the shared helper", async () => {
    selectMock.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{ id: "t1" }, { id: "t2" }]),
      }),
    });
    purgeMock.mockResolvedValue({
      purged: ["t1", "t2"],
      failed: [],
      skipped: 0,
    });
    expect(await emptyTrash("w1")).toEqual({ ok: true, deleted: 2, failed: 0 });
    expect(purgeMock).toHaveBeenCalledWith(["t1", "t2"], {
      reason: "manual",
      actor: { id: "u1", email: "a@b.c" },
    });
  });
});
