import { beforeEach, describe, expect, it, vi } from "vitest";

// Server actions must derive a task's location (workspace / project / list)
// from the task row and ignore the ids the client sends. These tests give the
// user access to project A only, put the task in project B, and pass A as the
// caller's space.

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  selectQueue: [] as unknown[][],
  // Permission per space id for the signed-in user.
  perms: {} as Record<string, "view" | "edit" | "full_access">,
  // Other users who have no access to any space.
  blockedUsers: [] as string[],
  resolveTaskContext: vi.fn(),
  resolveCommentContext: vi.fn(),
  updateRows: [] as unknown[],
  update: vi.fn(),
  insert: vi.fn(),
  del: vi.fn(),
  transaction: vi.fn(),
  writeActivityLog: vi.fn(),
  refreshWorkspace: vi.fn(),
  createNotifications: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.getSession } } }));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: h.writeActivityLog }));
vi.mock("@/lib/realtime/refresh", () => ({
  refreshWorkspace: h.refreshWorkspace,
}));
vi.mock("@/lib/storage", () => ({
  storage: { url: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/workspace-limits", () => ({ requireTaskCapacity: vi.fn() }));
vi.mock("@/app/actions/space", () => ({
  spaceRecipientUserIds: vi.fn(async () => []),
}));
vi.mock("@/lib/notifications/create-notification", () => ({
  createNotifications: h.createNotifications,
}));
vi.mock("@/lib/notifications/create-bulk-notifications", () => ({
  createBulkNotifications: vi.fn(),
}));

// A tiny permission model: the user can only act in the spaces listed in
// `h.perms`. The space id passed in is what decides the outcome.
vi.mock("@/lib/permissions", () => {
  const order = { view: 0, edit: 1, full_access: 2 } as const;
  const level = (spaceId: string) => h.perms[spaceId] ?? null;
  return {
    hasPermissionLevel: (p: keyof typeof order, min: keyof typeof order) =>
      order[p] >= order[min],
    getSpacePermission: vi.fn(async (_u: string, _w: string, s: string) =>
      level(s)
    ),
    canAccessSpace: vi.fn(
      async (u: string, _w: string, s: string) =>
        !h.blockedUsers.includes(u) && level(s) !== null
    ),
    requireViewAccess: vi.fn(async (_u: string, _w: string, s: string) =>
      level(s) === null ? { error: "Forbidden" } : null
    ),
    requireEditAccess: vi.fn(async (_u: string, _w: string, s: string) => {
      const p = level(s);
      return p === null || order[p] < order.edit
        ? { error: "Forbidden" }
        : null;
    }),
    getWorkspaceMembership: vi.fn(async () => ({ status: "ACTIVE" })),
  };
});

// Keep the real helpers (paths, SQL fragment); only the lookups are faked.
vi.mock("@/lib/services/task-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/task-context")>();
  return {
    ...actual,
    resolveTaskContext: h.resolveTaskContext,
    resolveCommentContext: h.resolveCommentContext,
  };
});

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

// Write chain: `.set().where().returning()` / `.values().onConflictDoNothing()`
// and plain awaiting all resolve.
function writeChain(record: (...args: unknown[]) => void) {
  return (...args: unknown[]) => {
    record(...args);
    const chain: Record<string, unknown> = {};
    for (const m of ["set", "values", "where", "onConflictDoNothing"]) {
      chain[m] = (...a: unknown[]) => {
        record(m, ...a);
        return chain;
      };
    }
    chain.returning = () => Promise.resolve(h.updateRows);
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve);
    return chain;
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(selectChain),
    update: vi.fn((...a: unknown[]) => writeChain(h.update)(...a)),
    insert: vi.fn((...a: unknown[]) => writeChain(h.insert)(...a)),
    delete: vi.fn((...a: unknown[]) => writeChain(h.del)(...a)),
    transaction: h.transaction,
  },
}));

import { createComment, deleteComment } from "@/app/actions/comment";
import {
  bulkMoveTasks,
  getTaskDetail,
  moveTask,
  updateTask,
  updateTaskStatus,
} from "@/app/actions/task";
import { addAssignee, addWatcher } from "@/app/actions/task-assignee";
import { deleteTimeEntry, startTimer } from "@/app/actions/time-tracking";

const ctxB = (over: Record<string, unknown> = {}) => ({
  taskId: "t1",
  workspaceId: "ws-1",
  spaceId: "space-B",
  listId: "list-B",
  statusId: "s-old",
  title: "Task in B",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.perms = {};
  h.blockedUsers = [];
  h.updateRows = [{ id: "t1" }];
  h.getSession.mockResolvedValue({
    user: { id: "u1", name: "U", email: "u@x.io" },
  });
  h.resolveTaskContext.mockResolvedValue(ctxB());
  h.resolveCommentContext.mockResolvedValue(null);
});

describe("permissions follow the task's real space, not the caller's", () => {
  it("updateTaskStatus: access to project A does not allow a task in B", async () => {
    h.perms = { "space-A": "full_access" };

    const res = await updateTaskStatus(
      "ws-1",
      "space-A",
      "list-A",
      "t1",
      "s-new"
    );

    expect(res).toEqual({ error: "Forbidden" });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.writeActivityLog).not.toHaveBeenCalled();
  });

  it("getTaskDetail: access to project A does not open a task in B", async () => {
    h.perms = { "space-A": "full_access" };

    expect(await getTaskDetail("ws-1", "space-A", "t1")).toEqual({
      error: "Task not found",
    });
  });

  it("updateTask: access to project A does not allow editing a task in B", async () => {
    h.perms = { "space-A": "full_access" };

    expect(
      await updateTask("ws-1", "space-A", "list-A", "t1", { title: "x" })
    ).toEqual({ error: "Forbidden" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("addAssignee: refused across projects, nothing written", async () => {
    h.perms = { "space-A": "full_access" };

    expect(await addAssignee("ws-1", "space-A", "list-A", "t1", "u2")).toEqual({
      error: "Forbidden",
    });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("startTimer: refused across projects, no time entry created", async () => {
    h.perms = { "space-A": "full_access" };

    expect(await startTimer("ws-1", "space-A", "list-A", "t1")).toEqual({
      error: "Forbidden",
    });
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("returns 'Task not found' when the task cannot be resolved", async () => {
    h.resolveTaskContext.mockResolvedValue(null);
    h.perms = { "space-A": "full_access" };

    expect(
      await updateTaskStatus("ws-1", "space-A", "list-A", "t1", "s-new")
    ).toEqual({ error: "Task not found" });
    expect(await addAssignee("ws-1", "space-A", "list-A", "t1", "u2")).toEqual({
      error: "Task not found",
    });
  });
});

describe("updateTaskStatus", () => {
  const status = { id: "s-new", name: "Done", type: "CLOSED" };

  it("refuses a view-only member", async () => {
    h.perms = { "space-B": "view" };

    const res = await updateTaskStatus(
      "ws-1",
      "space-B",
      "list-B",
      "t1",
      "s-new"
    );

    expect(res).toEqual({ error: "Forbidden" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("refuses a status that is not in the task's space", async () => {
    h.perms = { "space-B": "edit" };
    h.selectQueue.push([]); // status lookup (scoped to the space) finds nothing

    const res = await updateTaskStatus(
      "ws-1",
      "space-B",
      "list-B",
      "t1",
      "foreign-status"
    );

    expect(res).toEqual({ error: "Status not found" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("accepts a status from another list of the same space (Sprint board)", async () => {
    h.perms = { "space-B": "edit" };
    // The lookup only requires the status's list to be in the task's space,
    // so a status of a sibling list is found.
    h.selectQueue.push([status], [{ name: "Open" }], []);

    const res = await updateTaskStatus(
      "ws-1",
      "space-B",
      "list-B",
      "t1",
      "s-new"
    );

    expect(res).toEqual({ ok: true });
    expect(h.writeActivityLog).toHaveBeenCalledWith(
      "t1",
      "u1",
      "status_changed",
      {
        from: "s-old",
        to: "s-new",
        from_status_name: "Open",
        to_status_name: "Done",
      }
    );
  });

  it("ignores a stale caller listId and refreshes the task's real list", async () => {
    h.perms = { "space-B": "edit" };
    h.selectQueue.push([status], [{ name: "Open" }], []);

    const res = await updateTaskStatus(
      "ws-1",
      "space-B",
      "stale-list",
      "t1",
      "s-new"
    );

    expect(res).toEqual({ ok: true });
    expect(h.refreshWorkspace).toHaveBeenCalledWith(
      "ws-1",
      ["/ws-1/space-B/list/list-B"],
      { taskId: "t1" }
    );
  });

  it("works for a task that has no list", async () => {
    h.perms = { "space-B": "edit" };
    h.resolveTaskContext.mockResolvedValue(
      ctxB({ listId: null, statusId: null })
    );
    h.selectQueue.push([status]);

    const res = await updateTaskStatus("ws-1", "space-B", null, "t1", "s-new");

    expect(res).toEqual({ ok: true });
    expect(h.refreshWorkspace).toHaveBeenCalledWith(
      "ws-1",
      ["/ws-1/space-B", "/ws-1"],
      { taskId: "t1" }
    );
  });

  it("does not log or notify when no row was updated", async () => {
    h.perms = { "space-B": "edit" };
    h.updateRows = [];
    h.selectQueue.push([status]);

    const res = await updateTaskStatus(
      "ws-1",
      "space-B",
      "list-B",
      "t1",
      "s-new"
    );

    expect(res).toEqual({ error: "Task not found" });
    expect(h.writeActivityLog).not.toHaveBeenCalled();
    expect(h.createNotifications).not.toHaveBeenCalled();
  });

  it("does not log when the status did not change", async () => {
    h.perms = { "space-B": "edit" };
    h.selectQueue.push([{ id: "s-old", name: "Open", type: "OPEN" }]);

    const res = await updateTaskStatus(
      "ws-1",
      "space-B",
      "list-B",
      "t1",
      "s-old"
    );

    expect(res).toEqual({ ok: true });
    expect(h.writeActivityLog).not.toHaveBeenCalled();
  });
});

describe("createComment", () => {
  it("refuses a parentCommentId that belongs to another task", async () => {
    h.perms = { "space-B": "view" };
    h.selectQueue.push([]); // parent lookup scoped to this task finds nothing

    const res = await createComment(
      "ws-1",
      "space-B",
      "list-B",
      "t1",
      { type: "doc", content: [] },
      "comment-on-other-task"
    );

    expect(res).toEqual({ error: "Parent comment not found" });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("is refused across projects", async () => {
    h.perms = { "space-A": "full_access" };

    const res = await createComment("ws-1", "space-A", "list-A", "t1", {
      type: "doc",
      content: [],
    });

    expect(res).toEqual({ error: "Unauthorized" });
    expect(h.insert).not.toHaveBeenCalled();
  });
});

describe("comment- and entry-keyed actions", () => {
  it("deleteComment: full access in project A cannot delete a comment in B", async () => {
    h.perms = { "space-A": "full_access" };
    h.resolveCommentContext.mockResolvedValue({
      ...ctxB(),
      commentId: "c1",
      authorId: "someone-else",
      parentCommentId: null,
      isDeleted: false,
    });

    const res = await deleteComment("ws-1", "space-A", "list-A", "t1", "c1");

    expect(res).toEqual({ error: "Forbidden" });
    expect(h.del).not.toHaveBeenCalled();
  });

  it("deleteComment: reports 'Comment not found' when the comment is gone", async () => {
    h.perms = { "space-A": "full_access" };

    expect(
      await deleteComment("ws-1", "space-A", "list-A", "t1", "c1")
    ).toEqual({ error: "Comment not found" });
  });

  it("deleteTimeEntry: the entry's task decides the space", async () => {
    h.perms = { "space-A": "full_access" };
    h.selectQueue.push([{ userId: "u1", taskId: "t1" }]);

    const res = await deleteTimeEntry(
      "ws-1",
      "space-A",
      "list-A",
      "t1",
      "entry-1"
    );

    expect(res).toEqual({ error: "Forbidden" });
    expect(h.del).not.toHaveBeenCalled();
  });
});

describe("moveTask / bulkMoveTasks validate the target list", () => {
  const target = (over: Record<string, unknown> = {}) => ({
    spaceId: "space-C",
    listArchived: false,
    spaceArchived: false,
    spaceWorkspaceId: "ws-1",
    ...over,
  });
  const setCalls = () =>
    h.update.mock.calls.filter((c) => c[0] === "set").map((c) => c[1]);

  it("refuses a target list in another workspace", async () => {
    h.perms = { "space-B": "edit", "space-C": "edit" };
    h.selectQueue.push([target({ spaceWorkspaceId: "ws-2" })]);

    expect(await moveTask("ws-1", "space-B", "t1", "foreign-list")).toEqual({
      error: "List not found",
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("refuses an unknown target list", async () => {
    h.perms = { "space-B": "edit" };
    h.selectQueue.push([]);

    expect(await moveTask("ws-1", "space-B", "t1", "nope")).toEqual({
      error: "List not found",
    });
  });

  it("refuses a target space where the user cannot edit", async () => {
    h.perms = { "space-B": "edit", "space-C": "view" };
    h.selectQueue.push([target()]);

    expect(await moveTask("ws-1", "space-B", "t1", "list-C")).toEqual({
      error: "Forbidden",
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it.each([
    ["list", { listArchived: true }],
    ["project", { spaceArchived: true }],
  ])("refuses an archived target %s", async (_n, over) => {
    h.perms = { "space-B": "edit", "space-C": "edit" };
    h.selectQueue.push([target(over)]);

    expect(await moveTask("ws-1", "space-B", "t1", "list-C")).toEqual({
      error: "List not found",
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("moves across projects when the user can edit both, and sets spaceId", async () => {
    h.perms = { "space-B": "edit", "space-C": "edit" };
    // target, current status name, matching status in target, assignees, watchers
    h.selectQueue.push([target()], [{ name: "Open" }], [{ id: "s-c" }], [], []);

    expect(await moveTask("ws-1", "space-B", "t1", "list-C")).toEqual({
      ok: true,
    });
    expect(setCalls()[0]).toMatchObject({
      listId: "list-C",
      spaceId: "space-C",
      statusId: "s-c",
    });
  });

  it("bulkMoveTasks refuses a target list in another workspace", async () => {
    h.perms = { "space-B": "edit" };
    h.selectQueue.push([target({ spaceWorkspaceId: "ws-2" })]);

    expect(
      await bulkMoveTasks("ws-1", "space-B", ["t1"], "foreign-list")
    ).toEqual({ error: "List not found" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("bulkMoveTasks refuses a target space without edit", async () => {
    h.perms = { "space-B": "edit", "space-C": "view" };
    h.selectQueue.push([target()]);

    expect(await bulkMoveTasks("ws-1", "space-B", ["t1"], "list-C")).toEqual({
      error: "Forbidden",
    });
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe("watchers", () => {
  it("lets a view-only member watch the task themselves", async () => {
    h.perms = { "space-B": "view" };

    expect(await addWatcher("ws-1", "space-B", "list-B", "t1")).toEqual({
      ok: true,
    });
    expect(h.insert).toHaveBeenCalled();
  });

  it("refuses adding someone else with only View", async () => {
    h.perms = { "space-B": "view" };

    expect(await addWatcher("ws-1", "space-B", "list-B", "t1", "u2")).toEqual({
      error: "Forbidden",
    });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("refuses adding a user who cannot access the task", async () => {
    h.perms = { "space-B": "edit" };
    h.blockedUsers = ["outsider"];

    expect(
      await addWatcher("ws-1", "space-B", "list-B", "t1", "outsider")
    ).toEqual({ error: "User cannot access this task" });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("adds another user who has access when the caller can edit", async () => {
    h.perms = { "space-B": "edit" };

    expect(await addWatcher("ws-1", "space-B", "list-B", "t1", "u2")).toEqual({
      ok: true,
    });
    expect(h.insert).toHaveBeenCalled();
  });
});
