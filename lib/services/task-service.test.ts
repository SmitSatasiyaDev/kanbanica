import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/services/actor";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  // Arguments seen by the query builder, for checking the generated SQL.
  wheres: [] as unknown[],
  orderBys: [] as unknown[][],
  limits: [] as number[],
  updateSets: [] as unknown[],
  updateRows: [] as unknown[],
  inserts: [] as unknown[],
  deletes: [] as unknown[],
  perm: "edit" as "view" | "edit" | "full_access" | null,
  memberships: {} as Record<string, { role: string; status: string } | null>,
  accessibleSpaces: {} as Record<string, string[]>,
  resolveTaskContext: vi.fn(),
  writeActivityLog: vi.fn(),
  refreshWorkspace: vi.fn(),
  createNotifications: vi.fn(),
}));

vi.mock("@/lib/activity-log", () => ({ writeActivityLog: h.writeActivityLog }));
vi.mock("@/lib/realtime/refresh", () => ({
  refreshWorkspace: h.refreshWorkspace,
}));
vi.mock("@/lib/notifications/create-notification", () => ({
  createNotifications: h.createNotifications,
}));
vi.mock("@/lib/storage", () => ({
  storage: { url: vi.fn(async (k: string) => `/f/${k}`) },
}));

vi.mock("@/lib/permissions", () => {
  const order = { view: 0, edit: 1, full_access: 2 } as const;
  return {
    hasPermissionLevel: (p: keyof typeof order, min: keyof typeof order) =>
      order[p] >= order[min],
    getSpacePermission: vi.fn(async () => h.perm),
    requireViewAccess: vi.fn(async () =>
      h.perm === null ? { error: "Forbidden" } : null
    ),
    requireEditAccess: vi.fn(async () =>
      h.perm === null || order[h.perm] < order.edit
        ? { error: "Forbidden" }
        : null
    ),
    getWorkspaceMembership: vi.fn(
      async (_u: string, ws: string) => h.memberships[ws] ?? null
    ),
    getAccessibleSpaceIds: vi.fn(
      async (_u: string, ws: string) => h.accessibleSpaces[ws] ?? []
    ),
  };
});

vi.mock("@/lib/services/task-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/task-context")>();
  return { ...actual, resolveTaskContext: h.resolveTaskContext };
});

function selectChain() {
  const rows = h.selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "leftJoin", "innerJoin"]) {
    chain[m] = () => chain;
  }
  chain.where = (w: unknown) => {
    h.wheres.push(w);
    return chain;
  };
  chain.orderBy = (...o: unknown[]) => {
    h.orderBys.push(o);
    return chain;
  };
  chain.limit = (n: number) => {
    h.limits.push(n);
    return Promise.resolve(rows);
  };
  // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

function writeChain(record: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["where", "onConflictDoNothing"]) {
    chain[m] = () => chain;
  }
  chain.set = (v: unknown) => {
    h.updateSets.push(v);
    return chain;
  };
  chain.values = (v: unknown) => {
    record.push(v);
    return chain;
  };
  chain.returning = () => Promise.resolve(h.updateRows);
  // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(undefined).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(selectChain),
    update: vi.fn(() => writeChain([])),
    insert: vi.fn(() => writeChain(h.inserts)),
    delete: vi.fn(() => writeChain(h.deletes)),
  },
}));

import {
  assignTask,
  completeTask,
  getTask,
  listMyTasks,
  listTaskStatuses,
  listWorkspaces,
  searchTasks,
  setTaskStatus,
} from "@/lib/services/task-service";

const dialect = new PgDialect();
const render = (q: unknown) =>
  dialect.sqlToQuery(q as Parameters<PgDialect["sqlToQuery"]>[0]);

const actor = (over: Partial<Actor> = {}): Actor => ({
  userId: "u1",
  name: "U",
  email: "u@x.io",
  source: "mcp",
  tokenId: "tok",
  scope: "write",
  workspaceId: null,
  ...over,
});
const webUser = () =>
  actor({ source: "web", tokenId: undefined, workspaceId: null });
const readActor = () => actor({ scope: "read" });

const ctx = (over: Record<string, unknown> = {}) => ({
  taskId: "t1",
  workspaceId: "ws-1",
  spaceId: "sp-1",
  listId: "l1",
  statusId: "s-old",
  title: "Task",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.wheres.length = 0;
  h.orderBys.length = 0;
  h.limits.length = 0;
  h.updateSets.length = 0;
  h.inserts.length = 0;
  h.deletes.length = 0;
  h.updateRows = [{ id: "t1" }];
  h.perm = "edit";
  h.memberships = {};
  h.accessibleSpaces = {};
  h.resolveTaskContext.mockResolvedValue(ctx());
});

describe("read-only tokens are refused on every mutation", () => {
  it.each([
    [
      "setTaskStatus",
      () => setTaskStatus(readActor(), "t1", "s", { sameListOnly: true }),
    ],
    ["completeTask", () => completeTask(readActor(), "t1")],
    ["assignTask", () => assignTask(readActor(), "t1", {})],
  ])("%s", async (_name, run) => {
    expect(await run()).toEqual({ error: "This token is read-only." });
    expect(h.resolveTaskContext).not.toHaveBeenCalled();
    expect(h.updateSets).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
    expect(h.writeActivityLog).not.toHaveBeenCalled();
  });

  it("reads still work with a read-only token", async () => {
    h.selectQueue.push([
      { id: "s1", name: "Open", type: "OPEN", color: "#fff" },
    ]);
    const res = await listTaskStatuses(readActor(), "t1");
    expect(res).toMatchObject({ ok: true });
  });
});

describe("actor-aware context", () => {
  it("passes the actor to resolveTaskContext and reports 'Task not found'", async () => {
    h.resolveTaskContext.mockResolvedValue(null);
    const a = actor({ workspaceId: "ws-other" });

    expect(await setTaskStatus(a, "t1", "s", { sameListOnly: true })).toEqual({
      error: "Task not found",
    });
    expect(await assignTask(a, "t1", {})).toEqual({ error: "Task not found" });
    expect(await listTaskStatuses(a, "t1")).toEqual({
      error: "Task not found",
    });
    expect(await getTask(a, { taskId: "t1" })).toEqual({
      error: "Task not found",
    });
    expect(h.resolveTaskContext).toHaveBeenCalledWith("t1", a);
  });
});

describe("setTaskStatus", () => {
  const status = { id: "s-new", name: "Done", type: "CLOSED" };

  it("sameListOnly looks the status up in the task's own list", async () => {
    h.selectQueue.push([status], [{ name: "Open" }], []);
    const res = await setTaskStatus(actor(), "t1", "s-new", {
      sameListOnly: true,
    });
    expect(res).toMatchObject({ ok: true, changed: true });
    const q = render(h.wheres[0]);
    expect(q.sql).toContain('"list_status"."list_id" = $');
    expect(q.params).toContain("l1");
  });

  it("without sameListOnly it accepts any list of the same space", async () => {
    h.selectQueue.push([status], [{ name: "Open" }], []);
    await setTaskStatus(webUser(), "t1", "s-new", { sameListOnly: false });
    const q = render(h.wheres[0]);
    expect(q.sql).toContain('"list"."space_id" = $');
    expect(q.sql).not.toContain('"list_status"."list_id" = $');
    expect(q.params).toContain("sp-1");
  });

  it("refuses a status that is not in the task's own list", async () => {
    h.selectQueue.push([]);
    expect(
      await setTaskStatus(actor(), "t1", "other-list-status", {
        sameListOnly: true,
      })
    ).toEqual({ error: "Status not found" });
    expect(h.updateSets).toHaveLength(0);
  });

  it("sameListOnly on a listless task returns the no-statuses error", async () => {
    h.resolveTaskContext.mockResolvedValue(
      ctx({ listId: null, statusId: null })
    );
    expect(
      await setTaskStatus(actor(), "t1", "s-new", { sameListOnly: true })
    ).toEqual({ error: "This task is not in a list, so it has no statuses." });
  });

  it("a listless task still works on the web path", async () => {
    h.resolveTaskContext.mockResolvedValue(
      ctx({ listId: null, statusId: null })
    );
    h.selectQueue.push([status]);
    expect(
      await setTaskStatus(webUser(), "t1", "s-new", { sameListOnly: false })
    ).toMatchObject({ ok: true });
  });

  it("requires Edit", async () => {
    h.perm = "view";
    expect(
      await setTaskStatus(actor(), "t1", "s-new", { sameListOnly: true })
    ).toEqual({ error: "Forbidden" });
    expect(h.updateSets).toHaveLength(0);
  });

  it("adds source to the activity meta for MCP but not for web", async () => {
    h.selectQueue.push([status], [{ name: "Open" }], []);
    await setTaskStatus(actor(), "t1", "s-new", { sameListOnly: true });
    expect(h.writeActivityLog.mock.calls[0][3]).toMatchObject({
      source: "mcp",
      to_status_name: "Done",
    });

    h.writeActivityLog.mockClear();
    h.selectQueue.push([status], [{ name: "Open" }], []);
    await setTaskStatus(webUser(), "t1", "s-new", { sameListOnly: false });
    expect(h.writeActivityLog.mock.calls[0][3]).not.toHaveProperty("source");
  });
});

describe("completeTask", () => {
  it("moves the task to the first CLOSED status by orderIndex of its list", async () => {
    // first CLOSED lookup, then setTaskStatus: status lookup, old name, watchers
    h.selectQueue.push(
      [{ id: "s-done" }],
      [{ id: "s-done", name: "Done", type: "CLOSED" }],
      [{ name: "Open" }],
      []
    );
    const res = await completeTask(actor(), "t1");

    expect(res).toMatchObject({ ok: true, status: { id: "s-done" } });
    const closedWhere = render(h.wheres[0]);
    expect(closedWhere.sql).toContain('"list_status"."list_id" = $');
    expect(closedWhere.params).toEqual(
      expect.arrayContaining(["l1", "CLOSED"])
    );
    expect(
      dialect.sqlToQuery(
        h.orderBys[0][0] as Parameters<PgDialect["sqlToQuery"]>[0]
      ).sql
    ).toContain("order_index");
    // The update used the CLOSED status found above.
    expect(h.updateSets[0]).toMatchObject({ statusId: "s-done" });
    // And it was applied with the same-list rule.
    expect(render(h.wheres[1]).sql).toContain('"list_status"."list_id" = $');
  });

  it("returns the no-statuses error for a listless task", async () => {
    h.resolveTaskContext.mockResolvedValue(
      ctx({ listId: null, statusId: null })
    );
    expect(await completeTask(actor(), "t1")).toEqual({
      error: "This task is not in a list, so it has no statuses.",
    });
  });

  it("needs Edit", async () => {
    h.perm = "view";
    h.selectQueue.push(
      [{ id: "s-done" }],
      [{ id: "s-done", name: "Done", type: "CLOSED" }]
    );
    expect(await completeTask(actor(), "t1")).toEqual({ error: "Forbidden" });
    expect(h.updateSets).toHaveLength(0);
  });
});

describe("listTaskStatuses", () => {
  it("returns the task's list statuses ordered by orderIndex", async () => {
    h.selectQueue.push([
      { id: "s1", name: "Open", type: "OPEN", color: "#fff" },
    ]);
    const res = await listTaskStatuses(actor(), "t1");
    expect(res).toEqual({
      ok: true,
      statuses: [{ id: "s1", name: "Open", type: "OPEN", color: "#fff" }],
    });
    expect(
      dialect.sqlToQuery(
        h.orderBys[0][0] as Parameters<PgDialect["sqlToQuery"]>[0]
      ).sql
    ).toContain("order_index");
  });

  it("errors for a listless task", async () => {
    h.resolveTaskContext.mockResolvedValue(ctx({ listId: null }));
    expect(await listTaskStatuses(actor(), "t1")).toEqual({
      error: "This task is not in a list, so it has no statuses.",
    });
  });

  it("hides the task from someone without View access", async () => {
    h.perm = null;
    expect(await listTaskStatuses(actor(), "t1")).toEqual({
      error: "Task not found",
    });
  });
});

describe("getTask", () => {
  it("finds a task by its per-workspace number", async () => {
    h.resolveTaskContext.mockResolvedValue(
      ctx({ listId: null, statusId: null })
    );
    h.selectQueue.push(
      [{ id: "t1" }], // number lookup
      [{ id: "t1", listId: null, parentTaskId: null, title: "Task" }], // task row
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [], // 9 detail queries (listless: no statuses)
      [], // comments
      [{ id: "a1", fileName: "shot.png", mimeType: "image/png", size: 10 }]
    );

    const res = await getTask(actor(), { workspaceId: "ws-1", number: 42 });

    expect(res).toMatchObject({
      ok: true,
      task: { id: "t1" },
      comments: [],
      attachments: [
        {
          id: "a1",
          fileName: "shot.png",
          mimeType: "image/png",
          size: 10,
          isImage: true,
        },
      ],
    });
    const lookup = render(h.wheres[0]);
    expect(lookup.params).toEqual(expect.arrayContaining(["ws-1", 42]));
    expect(lookup.sql).toContain("seq_number");
    expect(lookup.sql).toContain("deleted_at");
    expect(h.resolveTaskContext).toHaveBeenCalledWith("t1", expect.anything());
  });

  it("returns 'Task not found' for an unknown number", async () => {
    h.selectQueue.push([]);
    expect(await getTask(actor(), { workspaceId: "ws-1", number: 9 })).toEqual({
      error: "Task not found",
    });
  });

  it("does not look up numbers outside the token's workspace", async () => {
    expect(
      await getTask(actor({ workspaceId: "ws-2" }), {
        workspaceId: "ws-1",
        number: 1,
      })
    ).toEqual({ error: "Task not found" });
    expect(h.selectQueue).toHaveLength(0);
    expect(h.wheres).toHaveLength(0);
  });

  it("returns 'Task not found' when the actor cannot view the project", async () => {
    h.perm = null;
    expect(await getTask(actor(), { taskId: "t1" })).toEqual({
      error: "Task not found",
    });
  });
});

describe("listWorkspaces", () => {
  const rows = [
    { id: "ws-1", name: "Alpha", role: "MEMBER" },
    { id: "ws-2", name: "Beta", role: "GUEST" },
    { id: "ws-3", name: "Gamma", role: "OWNER" },
  ];

  it("leaves out workspaces where an MCP actor is a guest", async () => {
    h.selectQueue.push(rows);
    expect(await listWorkspaces(actor())).toEqual({
      ok: true,
      workspaces: [
        { id: "ws-1", name: "Alpha" },
        { id: "ws-3", name: "Gamma" },
      ],
    });
  });

  it("applies the token's workspace restriction", async () => {
    h.selectQueue.push(rows);
    expect(await listWorkspaces(actor({ workspaceId: "ws-3" }))).toEqual({
      ok: true,
      workspaces: [{ id: "ws-3", name: "Gamma" }],
    });
  });

  it("keeps guest workspaces for a web user", async () => {
    h.selectQueue.push(rows);
    const res = await listWorkspaces(webUser());
    expect(res.workspaces.map((w) => w.id)).toEqual(["ws-1", "ws-2", "ws-3"]);
  });
});

describe("listMyTasks", () => {
  const memberOf = (...rows: [string, string][]) =>
    rows.map(([workspaceId, role]) => ({ workspaceId, role }));

  it("returns nothing when the token is restricted to another workspace", async () => {
    expect(
      await listMyTasks(actor({ workspaceId: "ws-1" }), { workspaceId: "ws-2" })
    ).toEqual({ ok: true, tasks: [] });
    expect(h.selectQueue).toHaveLength(0);
  });

  it("skips workspaces where an MCP actor is a guest", async () => {
    const { getAccessibleSpaceIds } = await import("@/lib/permissions");
    h.accessibleSpaces = { "ws-1": ["sp-1"], "ws-2": ["sp-2"] };
    h.selectQueue.push(memberOf(["ws-1", "MEMBER"], ["ws-2", "GUEST"]), []);

    await listMyTasks(actor(), {});

    expect(getAccessibleSpaceIds).toHaveBeenCalledTimes(1);
    expect(getAccessibleSpaceIds).toHaveBeenCalledWith("u1", "ws-1");
  });

  it("keeps guest workspaces for web users", async () => {
    const { getAccessibleSpaceIds } = await import("@/lib/permissions");
    h.accessibleSpaces = { "ws-1": ["sp-1"], "ws-2": ["sp-2"] };
    h.selectQueue.push(memberOf(["ws-1", "MEMBER"], ["ws-2", "GUEST"]), []);

    await listMyTasks(webUser(), {});

    expect(getAccessibleSpaceIds).toHaveBeenCalledTimes(2);
  });

  it("filters to one workspace, from the argument or the token", async () => {
    const { getAccessibleSpaceIds } = await import("@/lib/permissions");
    h.accessibleSpaces = { "ws-1": ["sp-1"], "ws-2": ["sp-2"] };
    h.selectQueue.push(memberOf(["ws-1", "MEMBER"], ["ws-2", "MEMBER"]), []);
    await listMyTasks(actor(), { workspaceId: "ws-2" });
    expect(getAccessibleSpaceIds).toHaveBeenCalledWith("u1", "ws-2");
    expect(getAccessibleSpaceIds).toHaveBeenCalledTimes(1);

    vi.mocked(getAccessibleSpaceIds).mockClear();
    h.selectQueue.push(memberOf(["ws-1", "MEMBER"], ["ws-2", "MEMBER"]), []);
    await listMyTasks(actor({ workspaceId: "ws-1" }), {});
    expect(getAccessibleSpaceIds).toHaveBeenCalledWith("u1", "ws-1");
    expect(getAccessibleSpaceIds).toHaveBeenCalledTimes(1);
  });

  const taskRow = (id: string) => ({
    id,
    title: id,
    seqNumber: 1,
    priority: "NONE",
    dueDateStart: null,
    dueDateEnd: null,
    statusId: "s",
    statusName: "Open",
    statusColor: "#fff",
    statusType: "OPEN",
    listId: "l1",
    listName: "L",
    spaceId: "sp-1",
    spaceName: "S",
    spaceColor: null,
    spaceLogoEmoji: null,
    workspaceId: "ws-1",
    workspaceName: "W",
  });

  function arrange() {
    h.accessibleSpaces = { "ws-1": ["sp-1"] };
    h.selectQueue.push(
      memberOf(["ws-1", "MEMBER"]),
      [{ taskId: "t1" }],
      [taskRow("t1")],
      []
    );
  }

  // The query asks for one row more than the page, to know if there is a next.
  it("applies a default limit of 50 and caps it at 200, in SQL", async () => {
    arrange();
    const res = await listMyTasks(actor(), {});
    expect(res).toMatchObject({
      ok: true,
      tasks: [{ id: "t1" }],
      nextCursor: null,
    });
    expect(h.limits).toEqual([51]);

    h.limits.length = 0;
    arrange();
    await listMyTasks(actor(), { limit: 999 });
    expect(h.limits).toEqual([201]);

    h.limits.length = 0;
    arrange();
    await listMyTasks(actor(), { limit: 10 });
    expect(h.limits).toEqual([11]);
  });

  it("limit null means no limit (web page)", async () => {
    arrange();
    await listMyTasks(webUser(), { limit: null });
    expect(h.limits).toEqual([]);
  });

  it("filters completed tasks in SQL unless includeCompleted", async () => {
    arrange();
    await listMyTasks(actor(), {});
    const withFilter = render(h.wheres[2]);
    expect(withFilter.sql).toContain("<>");
    expect(withFilter.params).toContain("CLOSED");

    h.wheres.length = 0;
    arrange();
    await listMyTasks(actor(), { includeCompleted: true });
    expect(render(h.wheres[2]).params).not.toContain("CLOSED");
  });
});

describe("searchTasks", () => {
  const found = {
    id: "t1",
    title: "Hello",
    seqNumber: 1,
    priority: "NONE",
    statusId: "s",
    statusName: "Open",
    statusColor: "#fff",
    statusType: "OPEN",
    listId: "l1",
    listName: "L",
    spaceId: "sp-1",
    spaceName: "S",
    dueDateEnd: null,
    isArchived: false,
  };

  it("needs at least 2 characters", async () => {
    expect(
      await searchTasks(actor(), { workspaceId: "ws-1", query: " a " })
    ).toEqual({ error: "Search text must be at least 2 characters." });
  });

  it("refuses a workspace outside the token restriction", async () => {
    expect(
      await searchTasks(actor({ workspaceId: "ws-2" }), {
        workspaceId: "ws-1",
        query: "hello",
      })
    ).toEqual({ error: "Workspace not found" });
  });

  it("refuses a guest over MCP", async () => {
    h.memberships = { "ws-1": { role: "GUEST", status: "ACTIVE" } };
    h.accessibleSpaces = { "ws-1": ["sp-1"] };
    expect(
      await searchTasks(actor(), { workspaceId: "ws-1", query: "hello" })
    ).toEqual({ error: "Workspace not found" });
  });

  it("lets a guest search on the web, limited to their projects", async () => {
    h.memberships = { "ws-1": { role: "GUEST", status: "ACTIVE" } };
    h.accessibleSpaces = { "ws-1": ["sp-1"] };
    h.selectQueue.push([found], []);
    const res = await searchTasks(webUser(), {
      workspaceId: "ws-1",
      query: "hello",
    });
    expect(res).toMatchObject({
      ok: true,
      tasks: [{ id: "t1", assignees: [] }],
    });
  });

  it("defaults: limit 25, archived tasks excluded; caps the limit at 100", async () => {
    h.memberships = { "ws-1": { role: "MEMBER", status: "ACTIVE" } };
    h.accessibleSpaces = { "ws-1": ["sp-1"] };
    h.selectQueue.push([]);
    await searchTasks(actor(), { workspaceId: "ws-1", query: "hello" });
    expect(h.limits).toEqual([26]);
    const q = render(h.wheres[0]);
    expect(q.sql).toContain('"task"."is_archived" = $');
    expect(q.params).toContain("%hello%");

    h.limits.length = 0;
    h.wheres.length = 0;
    h.selectQueue.push([]);
    await searchTasks(actor(), {
      workspaceId: "ws-1",
      query: "hello",
      limit: 500,
      includeArchived: true,
    });
    expect(h.limits).toEqual([101]);
    expect(render(h.wheres[0]).sql).not.toContain('"task"."is_archived" = $');
  });

  it("narrows to one project", async () => {
    h.memberships = { "ws-1": { role: "MEMBER", status: "ACTIVE" } };
    h.accessibleSpaces = { "ws-1": ["sp-1", "sp-2"] };
    h.selectQueue.push([]);
    await searchTasks(actor(), {
      workspaceId: "ws-1",
      query: "hello",
      projectId: "sp-2",
    });
    expect(render(h.wheres[0]).params).toEqual(
      expect.arrayContaining(["sp-1", "sp-2"])
    );
  });
});

describe("assignTask", () => {
  it("assigns the actor by default, auto-watches and logs with source", async () => {
    h.memberships = { "ws-1": { role: "MEMBER", status: "ACTIVE" } };
    // user name lookup, then the final assignee list
    h.selectQueue.push(
      [{ name: "U", email: "u@x.io" }],
      [{ userId: "u1", name: "U", email: "u@x.io" }]
    );
    const res = await assignTask(actor(), "t1", {});

    expect(res).toEqual({
      ok: true,
      assignees: [{ userId: "u1", name: "U", email: "u@x.io" }],
    });
    expect(h.inserts).toEqual([
      { taskId: "t1", userId: "u1" },
      { taskId: "t1", userId: "u1" },
    ]);
    expect(h.writeActivityLog).toHaveBeenCalledWith(
      "t1",
      "u1",
      "assignee_added",
      { userId: "u1", user_name: "U", source: "mcp" }
    );
    // Assigning yourself does not notify.
    expect(h.createNotifications).not.toHaveBeenCalled();
    expect(h.refreshWorkspace).toHaveBeenCalledWith(
      "ws-1",
      ["/ws-1/sp-1/list/l1"],
      { taskId: "t1" }
    );
  });

  it("notifies another user and refuses someone who is not an active member", async () => {
    expect(await assignTask(actor(), "t1", { userId: "u2" })).toEqual({
      error: "User is not an active workspace member",
    });
    expect(h.inserts).toHaveLength(0);

    h.memberships = { "ws-1": { role: "MEMBER", status: "ACTIVE" } };
    h.selectQueue.push([{ name: "Two", email: "t@x.io" }], []);
    await assignTask(actor(), "t1", { userId: "u2" });
    expect(h.createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ["u2"],
        triggerType: "task_assigned",
      })
    );
  });

  it("unassigns", async () => {
    h.selectQueue.push([{ name: "Two", email: "t@x.io" }], []);
    const res = await assignTask(actor(), "t1", {
      userId: "u2",
      unassign: true,
    });
    expect(res).toEqual({ ok: true, assignees: [] });
    expect(h.writeActivityLog).toHaveBeenCalledWith(
      "t1",
      "u1",
      "assignee_removed",
      { userId: "u2", user_name: "Two", source: "mcp" }
    );
    expect(h.createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: "task_unassigned" })
    );
  });

  it("requires Edit", async () => {
    h.perm = "view";
    expect(await assignTask(actor(), "t1", {})).toEqual({ error: "Forbidden" });
    expect(h.inserts).toHaveLength(0);
  });

  it("returnAssignees: false skips the list query (web)", async () => {
    h.memberships = { "ws-1": { role: "MEMBER", status: "ACTIVE" } };
    h.selectQueue.push([{ name: "U", email: "u@x.io" }]);
    const res = await assignTask(webUser(), "t1", {
      userId: "u1",
      returnAssignees: false,
    });
    expect(res).toMatchObject({ ok: true });
    expect(h.writeActivityLog.mock.calls[0][3]).not.toHaveProperty("source");
  });
});
