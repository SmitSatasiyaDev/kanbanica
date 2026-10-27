import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireEditAccess: vi.fn(),
  requireTaskCapacity: vi.fn(),
  selectQueue: [] as unknown[][],
  txInsert: vi.fn(),
  order: [] as string[],
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.getSession } } }));
vi.mock("@/lib/permissions", () => ({
  requireEditAccess: h.requireEditAccess,
  requireViewAccess: vi.fn(),
  requireFullAccess: vi.fn(),
  getWorkspaceMembership: vi.fn(),
}));
vi.mock("@/lib/workspace-limits", () => ({
  requireTaskCapacity: h.requireTaskCapacity,
}));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: vi.fn() }));
vi.mock("@/lib/realtime/refresh", () => ({ refreshWorkspace: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storage: {} }));
vi.mock("@/app/actions/space", () => ({
  spaceRecipientUserIds: vi.fn(async () => []),
}));
vi.mock("@/lib/notifications/create-notification", () => ({
  createNotifications: vi.fn(),
}));
vi.mock("@/lib/notifications/create-bulk-notifications", () => ({
  createBulkNotifications: vi.fn(),
}));

// Thenable select chain fed from a queue (one entry per db.select() call).
function selectChain() {
  const rows = h.selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin", "innerJoin"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const tx = {
  select: vi.fn(selectChain),
  insert: vi.fn(() => ({
    values: (v: unknown) => {
      h.txInsert(v);
      h.order.push("insert");
      return { onConflictDoNothing: () => Promise.resolve() };
    },
  })),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(selectChain),
    update: vi.fn(),
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  },
}));

import { createSubtask, createTask, duplicateTask } from "@/app/actions/task";
import { db } from "@/lib/db";

const LIMIT_ERROR = {
  error: "Workspace task limit reached (10).",
  code: "TASK_LIMIT_REACHED",
};

beforeEach(() => {
  h.selectQueue.length = 0;
  h.order.length = 0;
  h.txInsert.mockReset();
  h.getSession.mockReset().mockResolvedValue({
    user: { id: "u1", name: "U", email: "u@x.io" },
  });
  h.requireEditAccess.mockReset().mockResolvedValue(null);
  h.requireTaskCapacity.mockReset().mockImplementation(async () => {
    h.order.push("capacity");
    return { seqBase: 41 };
  });
  vi.mocked(db.update).mockClear();
});

describe("createTask", () => {
  it("rejects with the limit error and inserts nothing; seq is only reserved by the gate", async () => {
    h.requireTaskCapacity.mockResolvedValue(LIMIT_ERROR);

    const res = await createTask("ws-1", "sp-1", null, { title: "T" });

    expect(res).toEqual(LIMIT_ERROR);
    expect(h.txInsert).not.toHaveBeenCalled();
    // No taskSeq bump outside the transaction any more.
    expect(db.update).not.toHaveBeenCalled();
  });

  it("gates inside the transaction, before the insert, and uses the reserved seq", async () => {
    const res = await createTask("ws-1", "sp-1", null, { title: "T" });

    expect(res).toHaveProperty("taskId");
    expect(h.requireTaskCapacity).toHaveBeenCalledWith(tx, "ws-1", 1);
    expect(h.order.slice(0, 2)).toEqual(["capacity", "insert"]);
    expect(h.txInsert.mock.calls[0][0]).toMatchObject({
      seqNumber: 42,
      orderIndex: 42_000,
      workspaceId: "ws-1",
    });
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("createSubtask", () => {
  const parent = (over: Record<string, unknown> = {}) => [
    [
      {
        id: "p1",
        listId: null,
        spaceId: "sp-1",
        workspaceId: "ws-1",
        parentTaskId: null,
        ...over,
      },
    ],
  ];

  it("rejects with the limit error and inserts nothing", async () => {
    h.selectQueue.push(...parent());
    h.requireTaskCapacity.mockResolvedValue(LIMIT_ERROR);

    expect(await createSubtask("ws-1", "sp-1", "p1", "Sub")).toEqual(
      LIMIT_ERROR
    );
    expect(h.txInsert).not.toHaveBeenCalled();
  });

  it("is transactional: gate → insert, subtask counts as 1 task", async () => {
    h.selectQueue.push(...parent());

    const res = await createSubtask("ws-1", "sp-1", "p1", "Sub");

    expect(res).toHaveProperty("taskId");
    expect(h.requireTaskCapacity).toHaveBeenCalledWith(tx, "ws-1", 1);
    expect(h.order).toEqual(["capacity", "insert"]);
    expect(h.txInsert.mock.calls[0][0]).toMatchObject({
      seqNumber: 42,
      parentTaskId: "p1",
    });
  });

  it("workspace mismatch: parent from another workspace is rejected before any gate", async () => {
    h.selectQueue.push(...parent({ workspaceId: "other-ws" }));

    expect(await createSubtask("ws-1", "sp-1", "p1", "Sub")).toEqual({
      error: "Parent task not found",
    });
    expect(h.requireTaskCapacity).not.toHaveBeenCalled();
    expect(h.txInsert).not.toHaveBeenCalled();
  });
});

describe("duplicateTask", () => {
  const original = {
    id: "t1",
    workspaceId: "ws-1",
    spaceId: "sp-1",
    listId: "l1",
    parentTaskId: null,
    statusId: "s1",
    title: "Orig",
    description: null,
    priority: "NONE",
    reporterId: "u1",
    dueDateStart: null,
    dueDateEnd: null,
    orderIndex: 1000,
    isArchived: false,
  };
  const sub = { ...original, id: "t2", parentTaskId: "t1", title: "Sub" };

  it("workspace mismatch: a task from another workspace is rejected before any gate", async () => {
    h.selectQueue.push([{ ...original, workspaceId: "other-ws" }]);

    expect(await duplicateTask("ws-1", "sp-1", "l1", "t1")).toEqual({
      error: "Task not found",
    });
    expect(h.requireTaskCapacity).not.toHaveBeenCalled();
  });

  it("reserves capacity for the task PLUS its non-archived subtasks, all-or-nothing", async () => {
    // original, subtasks, nextSibling
    h.selectQueue.push([original], [sub, { ...sub, id: "t3" }], []);
    h.requireTaskCapacity.mockResolvedValue(LIMIT_ERROR);

    const res = await duplicateTask("ws-1", "sp-1", "l1", "t1");

    expect(res).toEqual(LIMIT_ERROR);
    expect(h.requireTaskCapacity).toHaveBeenCalledWith(tx, "ws-1", 3);
    expect(h.txInsert).not.toHaveBeenCalled();
  });

  it("uses the gate's seq block for the copies", async () => {
    h.selectQueue.push([original], [sub], []);

    const res = await duplicateTask("ws-1", "sp-1", "l1", "t1");

    expect(res).toHaveProperty("taskId");
    expect(h.requireTaskCapacity).toHaveBeenCalledWith(tx, "ws-1", 2);
    const rows = h.txInsert.mock.calls[0][0] as { seqNumber: number }[];
    expect(rows.map((r) => r.seqNumber)).toEqual([42, 43]);
  });
});
