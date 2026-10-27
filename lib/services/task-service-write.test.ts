import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/services/actor";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  wheres: [] as unknown[],
  limits: [] as number[],
  txInserts: [] as { table: unknown; values: unknown }[],
  inserts: [] as unknown[],
  deletes: [] as unknown[],
  order: [] as string[],
  // Users who can see the project (everyone else cannot).
  canSee: new Set<string>(),
  memberships: {} as Record<string, { role: string; status: string } | null>,
  requireEditAccess: vi.fn(),
  requireTaskCapacity: vi.fn(),
  resolveTaskContext: vi.fn(),
  writeActivityLog: vi.fn(),
  refreshWorkspace: vi.fn(),
  createNotifications: vi.fn(),
  storageDelete: vi.fn(),
  spaceRecipients: vi.fn(),
}));

vi.mock("@/lib/activity-log", () => ({ writeActivityLog: h.writeActivityLog }));
vi.mock("@/lib/realtime/refresh", () => ({
  refreshWorkspace: h.refreshWorkspace,
}));
vi.mock("@/lib/notifications/create-notification", () => ({
  createNotifications: h.createNotifications,
}));
vi.mock("@/lib/storage", () => ({
  storage: { url: vi.fn(), delete: h.storageDelete },
}));
vi.mock("@/lib/workspace-limits", () => ({
  requireTaskCapacity: h.requireTaskCapacity,
}));
vi.mock("@/app/actions/space", () => ({
  spaceRecipientUserIds: h.spaceRecipients,
}));
vi.mock("@/lib/permissions", () => ({
  hasPermissionLevel: vi.fn(),
  getSpacePermission: vi.fn(),
  requireViewAccess: vi.fn(),
  requireEditAccess: h.requireEditAccess,
  canAccessSpace: vi.fn(async (userId: string) => h.canSee.has(userId)),
  getWorkspaceMembership: vi.fn(
    async (_u: string, ws: string) => h.memberships[ws] ?? null
  ),
  getAccessibleSpaceIds: vi.fn(async () => []),
}));
vi.mock("@/lib/services/task-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/task-context")>();
  return { ...actual, resolveTaskContext: h.resolveTaskContext };
});

function selectChain() {
  const rows = h.selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "leftJoin", "innerJoin", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.where = (w: unknown) => {
    h.wheres.push(w);
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

// Any write chain: records `.values()` and resolves when awaited.
function writeChain(record: unknown[], table?: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of [
    "where",
    "onConflictDoNothing",
    "onConflictDoUpdate",
    "set",
    "returning",
  ]) {
    chain[m] = () => chain;
  }
  chain.values = (v: unknown) => {
    record.push(table === undefined ? v : { table, values: v });
    h.order.push("insert");
    return chain;
  };
  // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve([]).then(resolve);
  return chain;
}

const tx = {
  insert: vi.fn((table: unknown) => writeChain(h.txInserts, table)),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(selectChain),
    insert: vi.fn(() => writeChain(h.inserts)),
    update: vi.fn(() => writeChain([])),
    delete: vi.fn(() => {
      const chain = writeChain(h.deletes);
      return chain;
    }),
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  },
}));

import { encodeCursor } from "@/lib/services/cursor";
import {
  createSubtask,
  createTask,
  listDescriptionAttachments,
  listMyTasks,
  resolveProjectUsers,
  resolveTaskMentionTargets,
  searchTasks,
  updateTask,
} from "@/lib/services/task-service";

const dialect = new PgDialect();
const render = (q: unknown) =>
  dialect.sqlToQuery(q as Parameters<PgDialect["sqlToQuery"]>[0]);

const actor = (over: Partial<Actor> = {}): Actor => ({
  userId: "u1",
  name: "Dana",
  email: "dana@x.io",
  source: "mcp",
  tokenId: "tok",
  scope: "write",
  workspaceId: null,
  ...over,
});
const web = () => actor({ source: "web", tokenId: undefined });

const LIMIT_ERROR = {
  error: "Workspace task limit reached (10).",
  code: "TASK_LIMIT_REACHED",
};

const base = {
  workspaceId: "ws-1",
  spaceId: "sp-1",
  listId: null,
  title: "  New task  ",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.wheres.length = 0;
  h.limits.length = 0;
  h.txInserts.length = 0;
  h.inserts.length = 0;
  h.deletes.length = 0;
  h.order.length = 0;
  h.canSee = new Set(["u1", "u2", "u3"]);
  h.memberships = { "ws-1": { role: "MEMBER", status: "ACTIVE" } };
  h.requireEditAccess.mockResolvedValue(null);
  h.requireTaskCapacity.mockImplementation(async () => {
    h.order.push("capacity");
    return { seqBase: 41 };
  });
  h.resolveTaskContext.mockResolvedValue({
    taskId: "t1",
    workspaceId: "ws-1",
    spaceId: "sp-1",
    listId: "l1",
    statusId: "s1",
    title: "Task",
  });
  h.spaceRecipients.mockResolvedValue(["u1", "u2", "u9"]);
});

describe("createTask", () => {
  it("checks the task limit first inside the transaction and passes its error through", async () => {
    h.requireTaskCapacity.mockResolvedValue(LIMIT_ERROR);
    const res = await createTask(actor(), base);
    expect(res).toEqual(LIMIT_ERROR);
    expect(h.requireTaskCapacity).toHaveBeenCalledWith(tx, "ws-1", 1);
    expect(h.txInserts).toHaveLength(0);
    expect(h.writeActivityLog).not.toHaveBeenCalled();
    expect(h.createNotifications).not.toHaveBeenCalled();
  });

  it("uses the reserved task number and records the source in the activity", async () => {
    const res = await createTask(actor(), base);
    expect(res).toHaveProperty("taskId");
    expect(h.order.slice(0, 2)).toEqual(["capacity", "insert"]);
    expect(h.txInserts[0].values).toMatchObject({
      seqNumber: 42,
      orderIndex: 42_000,
      title: "New task",
      reporterId: "u1",
    });
    expect(h.writeActivityLog).toHaveBeenCalledWith(
      expect.any(String),
      "u1",
      "task_created",
      { title: "New task", source: "mcp" }
    );
  });

  it("keeps the web activity meta exactly as before", async () => {
    await createTask(web(), base);
    expect(h.writeActivityLog.mock.calls[0][3]).toEqual({ title: "New task" });
  });

  it("is refused for a read-only token before anything is checked", async () => {
    expect(await createTask(actor({ scope: "read" }), base)).toEqual({
      error: "This token is read-only.",
    });
    expect(h.requireEditAccess).not.toHaveBeenCalled();
    expect(h.requireTaskCapacity).not.toHaveBeenCalled();
  });

  it("refuses a workspace outside the token's restriction and a guest over MCP", async () => {
    expect(await createTask(actor({ workspaceId: "ws-2" }), base)).toEqual({
      error: "Workspace not found",
    });
    h.memberships = { "ws-1": { role: "GUEST", status: "ACTIVE" } };
    expect(await createTask(actor(), base)).toEqual({
      error: "Workspace not found",
    });
    expect(h.requireTaskCapacity).not.toHaveBeenCalled();
  });

  it("needs Edit access", async () => {
    h.requireEditAccess.mockResolvedValue({ error: "Forbidden" });
    expect(await createTask(actor(), base)).toEqual({ error: "Forbidden" });
    expect(h.requireTaskCapacity).not.toHaveBeenCalled();
  });

  it("validates title and days like the web", async () => {
    expect(await createTask(actor(), { ...base, title: "   " })).toEqual({
      error: "Task title is required",
    });
    expect(
      await createTask(actor(), { ...base, dueDateEnd: "2026-02-30" })
    ).toEqual({ error: "Invalid due date" });
  });

  it.each([
    ["MCP", () => actor()],
    ["web", () => web()],
  ])(
    "refuses assignees who are not active members who can see the project (%s)",
    async (_name, who) => {
      // u2 is a member who can see the project; u8 is not a member at all.
      h.selectQueue.push([{ userId: "u2", name: "Eli", email: "e@x.io" }]);
      const res = await createTask(who(), {
        ...base,
        assigneeIds: ["u2", "u8"],
      });
      expect(res).toEqual({ error: "User cannot access this task" });
      expect(h.requireTaskCapacity).not.toHaveBeenCalled();
      expect(h.txInserts).toHaveLength(0);
      expect(h.createNotifications).not.toHaveBeenCalled();

      // A member who cannot see the project is refused too.
      h.canSee = new Set(["u1"]);
      h.selectQueue.push([{ userId: "u2", name: "Eli", email: "e@x.io" }]);
      expect(await createTask(who(), { ...base, assigneeIds: ["u2"] })).toEqual(
        { error: "User cannot access this task" }
      );
      expect(h.requireTaskCapacity).not.toHaveBeenCalled();
    }
  );

  it("the web accepts valid assignees", async () => {
    h.selectQueue.push([{ userId: "u2", name: "Eli", email: "e@x.io" }]);
    const res = await createTask(web(), { ...base, assigneeIds: ["u2"] });
    expect(res).toHaveProperty("taskId");
    expect(h.createNotifications.mock.calls[0][0].triggerType).toBe(
      "task_assigned"
    );
  });

  it("notifies assignees, the project (minus assignees) and new mentions", async () => {
    h.selectQueue.push([{ userId: "u2", name: "Eli", email: "e@x.io" }]);
    const description = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "u3", label: "Mo" } }],
        },
      ],
    };
    await createTask(actor(), { ...base, assigneeIds: ["u2"], description });
    const byTrigger = Object.fromEntries(
      h.createNotifications.mock.calls.map(([c]) => [c.triggerType, c])
    );
    expect(byTrigger.task_assigned.recipientIds).toEqual(["u2"]);
    // u2 is an assignee so is left out of task_created.
    expect(byTrigger.task_created.recipientIds).toEqual(["u1", "u9"]);
    expect(byTrigger.mention_description.recipientIds).toEqual(["u3"]);
    expect(byTrigger.task_assigned.title).toBe(
      'Dana assigned you to "New task"'
    );
  });

  it("MCP: a status must belong to the target list", async () => {
    h.selectQueue.push([]);
    expect(
      await createTask(actor(), { ...base, listId: "l1", statusId: "other" })
    ).toEqual({ error: "Status not found" });
    expect(h.requireTaskCapacity).not.toHaveBeenCalled();
    const q = render(h.wheres[0]);
    expect(q.sql).toContain('"list_status"."list_id" = $');
    expect(q.params).toContain("l1");
  });

  it("web: a status from another project is refused, one from the same project is accepted", async () => {
    h.selectQueue.push([]);
    expect(
      await createTask(web(), { ...base, listId: "l1", statusId: "foreign" })
    ).toEqual({ error: "Status not found" });
    expect(h.txInserts).toHaveLength(0);
    // Checked against the project, not the list (Sprint view mixes lists).
    const q = render(h.wheres[0]);
    expect(q.sql).toContain('"list"."space_id" = $');
    expect(q.params).toEqual(expect.arrayContaining(["foreign", "sp-1"]));

    h.selectQueue.push([{ id: "s-b" }], [{ id: "l1" }]);
    const ok = await createTask(web(), {
      ...base,
      listId: "l1",
      statusId: "s-b",
    });
    expect(ok).toHaveProperty("taskId");
    expect(h.txInserts[0].values).toMatchObject({ statusId: "s-b" });
  });

  it("web: a listless task (Sprint view) still checks the status against the project", async () => {
    h.selectQueue.push([]);
    expect(await createTask(web(), { ...base, statusId: "foreign" })).toEqual({
      error: "Status not found",
    });
    h.selectQueue.push([{ id: "s-b" }]);
    expect(
      await createTask(web(), { ...base, statusId: "s-b" })
    ).toHaveProperty("taskId");
  });

  it("defaults the status to the list's first open status", async () => {
    h.selectQueue.push([{ id: "l1" }], [{ id: "open1" }]);
    await createTask(actor(), { ...base, listId: "l1" });
    expect(h.txInserts[0].values).toMatchObject({
      listId: "l1",
      statusId: "open1",
    });
    expect(h.refreshWorkspace).toHaveBeenCalledWith(
      "ws-1",
      ["/ws-1/sp-1/list/l1"],
      { taskId: expect.any(String) }
    );
  });
});

describe("createSubtask", () => {
  const parent = (over: Record<string, unknown> = {}) => [
    {
      id: "p1",
      listId: null,
      spaceId: "sp-1",
      workspaceId: "ws-1",
      parentTaskId: null,
      ...over,
    },
  ];

  it("checks the limit first and passes its error through", async () => {
    h.selectQueue.push(parent());
    h.requireTaskCapacity.mockResolvedValue(LIMIT_ERROR);
    expect(
      await createSubtask(web(), { parentTaskId: "p1", title: "Sub" })
    ).toEqual(LIMIT_ERROR);
    expect(h.txInserts).toHaveLength(0);
  });

  it("applies the token's restriction through the task context (MCP)", async () => {
    h.selectQueue.push(parent());
    h.resolveTaskContext.mockResolvedValue(null);
    expect(
      await createSubtask(actor(), { parentTaskId: "p1", title: "Sub" })
    ).toEqual({ error: "Parent task not found" });
    expect(h.resolveTaskContext).toHaveBeenCalledWith("p1", expect.anything());
    expect(h.requireTaskCapacity).not.toHaveBeenCalled();
  });

  it("refuses a parent in another workspace than the caller claims", async () => {
    h.selectQueue.push(parent({ workspaceId: "ws-9" }));
    expect(
      await createSubtask(web(), {
        parentTaskId: "p1",
        workspaceId: "ws-1",
        title: "Sub",
      })
    ).toEqual({ error: "Parent task not found" });
  });

  it("refuses a subtask of a subtask", async () => {
    h.selectQueue.push(parent({ parentTaskId: "root" }));
    expect(
      await createSubtask(web(), { parentTaskId: "p1", title: "Sub" })
    ).toEqual({ error: "Cannot nest subtasks more than one level" });
  });

  it("stores description, priority, dates and assignees, and notifies", async () => {
    h.selectQueue.push(parent(), [
      { userId: "u2", name: "Eli", email: "e@x.io" },
    ]);
    const description = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "u3", label: "Mo" } }],
        },
      ],
    };
    const res = await createSubtask(actor(), {
      parentTaskId: "p1",
      title: "Sub",
      description,
      priority: "HIGH",
      dueDateEnd: "2026-11-05",
      assigneeIds: ["u2"],
    });
    expect(res).toHaveProperty("taskId");
    expect(h.txInserts[0].values).toMatchObject({
      parentTaskId: "p1",
      priority: "HIGH",
      dueDateEnd: "2026-11-05",
      description,
    });
    expect(h.txInserts.length).toBeGreaterThan(1);
    expect(h.writeActivityLog).toHaveBeenCalledWith(
      expect.any(String),
      "u1",
      "subtask_created",
      { title: "Sub", parentTaskId: "p1", source: "mcp" }
    );
    const triggers = h.createNotifications.mock.calls.map(
      ([c]) => c.triggerType
    );
    expect(triggers).toEqual(["task_assigned", "mention_description"]);
  });

  it("refuses an assignee who cannot see the parent's project, on the web too", async () => {
    h.selectQueue.push(parent(), []);
    expect(
      await createSubtask(web(), {
        parentTaskId: "p1",
        title: "Sub",
        assigneeIds: ["u8"],
      })
    ).toEqual({ error: "User cannot access this task" });
    expect(h.requireTaskCapacity).not.toHaveBeenCalled();
    expect(h.createNotifications).not.toHaveBeenCalled();
  });

  it("the web call keeps its old insert: no description, priority NONE", async () => {
    h.selectQueue.push(parent());
    await createSubtask(web(), { parentTaskId: "p1", title: "Sub" });
    const values = h.txInserts[0].values as Record<string, unknown>;
    expect(values).not.toHaveProperty("description");
    expect(values.priority).toBe("NONE");
    expect(h.createNotifications).not.toHaveBeenCalled();
    expect(h.writeActivityLog.mock.calls[0][3]).toEqual({
      title: "Sub",
      parentTaskId: "p1",
    });
  });
});

describe("updateTask", () => {
  const existing = (over: Record<string, unknown> = {}) => [
    {
      title: "Old",
      priority: "NONE",
      description: null,
      dueDateEnd: null,
      ...over,
    },
  ];
  const doc = (...ids: string[]) => ({
    type: "doc",
    content: ids.map((id) => ({
      type: "paragraph",
      content: [{ type: "mention", attrs: { id, label: id } }],
    })),
  });

  it("is refused for a read-only token", async () => {
    expect(
      await updateTask(actor({ scope: "read" }), "t1", { title: "x" })
    ).toEqual({
      error: "This token is read-only.",
    });
    expect(h.resolveTaskContext).not.toHaveBeenCalled();
  });

  it("resolves the task for the actor and needs Edit", async () => {
    const a = actor({ workspaceId: "ws-2" });
    h.resolveTaskContext.mockResolvedValue(null);
    expect(await updateTask(a, "t1", { title: "x" })).toEqual({
      error: "Task not found",
    });
    expect(h.resolveTaskContext).toHaveBeenCalledWith("t1", a);

    h.resolveTaskContext.mockResolvedValue({
      taskId: "t1",
      workspaceId: "ws-1",
      spaceId: "sp-1",
      listId: "l1",
      statusId: null,
      title: "T",
    });
    h.requireEditAccess.mockResolvedValue({ error: "Forbidden" });
    expect(await updateTask(actor(), "t1", { title: "x" })).toEqual({
      error: "Forbidden",
    });
  });

  it("rejects invalid days", async () => {
    expect(await updateTask(actor(), "t1", { dueDateEnd: "tomorrow" })).toEqual(
      {
        error: "Invalid due date",
      }
    );
  });

  it("notifies only NEWLY mentioned users", async () => {
    h.selectQueue.push(existing({ description: doc("u2") }), []);
    await updateTask(actor(), "t1", { description: doc("u2", "u3") });
    const mention = h.createNotifications.mock.calls
      .map(([c]) => c)
      .find((c) => c.triggerType === "mention_description");
    expect(mention.recipientIds).toEqual(["u3"]);
  });

  it("deletes inline images the new description no longer links, files first", async () => {
    h.selectQueue.push(existing(), [
      { id: "gone", fileUrl: "attachments/ws-1/t1/gone/a.png" },
    ]);
    const kept = {
      type: "doc",
      content: [
        { type: "noteImage", attrs: { attachmentId: "kept", fileKey: "k" } },
      ],
    };
    await updateTask(actor(), "t1", { description: kept });
    expect(h.storageDelete).toHaveBeenCalledWith(
      "attachments/ws-1/t1/gone/a.png"
    );
    const { db } = await import("@/lib/db");
    expect(db.delete).toHaveBeenCalledTimes(1);
    // The sweep only looks at inline, comment-less rows other than the kept ids.
    const where = render(h.wheres[1]);
    expect(where.sql).toContain('"is_inline"');
    expect(where.sql).toContain('"comment_id" is null');
    expect(where.sql).toContain("not in");
    expect(where.params).toContain("kept");
  });

  it("logs the activity with the source for MCP only", async () => {
    h.selectQueue.push(existing());
    await updateTask(actor(), "t1", { title: "New", priority: "HIGH" });
    const calls = h.writeActivityLog.mock.calls;
    expect(calls.map((c) => [c[2], c[3]])).toEqual([
      ["title_changed", { from: "Old", to: "New", source: "mcp" }],
      ["priority_changed", { from: "NONE", to: "HIGH", source: "mcp" }],
    ]);

    h.writeActivityLog.mockClear();
    h.selectQueue.push(existing());
    await updateTask(web(), "t1", { title: "New" });
    expect(h.writeActivityLog.mock.calls[0][3]).toEqual({
      from: "Old",
      to: "New",
    });
  });

  it("notifies watchers of a changed due date", async () => {
    h.selectQueue.push(existing(), [{ userId: "u2" }]);
    await updateTask(actor(), "t1", { dueDateEnd: "2026-11-05" });
    const sent = h.createNotifications.mock.calls[0][0];
    expect(sent.triggerType).toBe("task_due_date_changed");
    expect(sent.recipientIds).toEqual(["u2"]);
  });
});

describe("mention and attachment lookups", () => {
  it("only active members who can see the project are returned", async () => {
    // Three ids asked for; the database knows two active members.
    h.selectQueue.push([
      { userId: "u2", name: "Eli", email: "e@x.io" },
      { userId: "u5", name: "Outsider", email: "o@x.io" },
    ]);
    h.canSee = new Set(["u2"]);
    const found = await resolveProjectUsers("ws-1", "sp-1", ["u2", "u5", "u8"]);
    expect([...found.keys()]).toEqual(["u2"]);
    expect(found.get("u2")).toEqual({ id: "u2", name: "Eli" });
  });

  it("falls back to the email when a member has no name", async () => {
    h.selectQueue.push([{ userId: "u2", name: "", email: "e@x.io" }]);
    const found = await resolveProjectUsers("ws-1", "sp-1", ["u2"]);
    expect(found.get("u2")?.name).toBe("e@x.io");
  });

  it("asks for nothing when there is nothing to look up", async () => {
    expect((await resolveProjectUsers("ws-1", "sp-1", [])).size).toBe(0);
    expect(h.selectQueue).toHaveLength(0);
  });

  it("task mention targets use the task's real project and the actor", async () => {
    h.selectQueue.push([{ userId: "u2", name: "Eli", email: "e@x.io" }]);
    const a = actor();
    const found = await resolveTaskMentionTargets(a, "t1", ["u2"]);
    expect(h.resolveTaskContext).toHaveBeenCalledWith("t1", a);
    expect([...found.keys()]).toEqual(["u2"]);

    h.resolveTaskContext.mockResolvedValue(null);
    expect((await resolveTaskMentionTargets(a, "t1", ["u2"])).size).toBe(0);
  });

  it("description attachments are limited to inline, comment-less rows of that task", async () => {
    h.selectQueue.push([
      {
        id: "a1",
        fileKey: "attachments/ws-1/t1/a1/x.png",
        fileName: "x.png",
        mimeType: "image/png",
        size: 5,
      },
    ]);
    const found = await listDescriptionAttachments(actor(), "t1", ["a1", "zz"]);
    expect([...found.keys()]).toEqual(["a1"]);
    const where = render(h.wheres[0]);
    expect(where.sql).toContain('"task_attachment"."task_id" = $');
    expect(where.sql).toContain('"is_inline" = $');
    expect(where.sql).toContain('"comment_id" is null');
    expect(where.params).toEqual(expect.arrayContaining(["t1", "a1", "zz"]));
  });

  it("returns nothing when the task cannot be used", async () => {
    h.resolveTaskContext.mockResolvedValue(null);
    expect((await listDescriptionAttachments(actor(), "t1", ["a1"])).size).toBe(
      0
    );
    expect(h.selectQueue).toHaveLength(0);
  });
});

describe("paging", () => {
  const taskRow = (id: string, due: string | null) => ({
    id,
    title: id,
    seqNumber: 1,
    priority: "NONE",
    dueDateStart: null,
    dueDateEnd: due,
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

  async function arrangeMyTasks(rows: unknown[]) {
    const { getAccessibleSpaceIds } = await import("@/lib/permissions");
    vi.mocked(getAccessibleSpaceIds).mockResolvedValue(["sp-1"]);
    h.selectQueue.push(
      [{ workspaceId: "ws-1", role: "MEMBER" }],
      [{ taskId: "t1" }],
      rows,
      []
    );
  }

  it("list_my_tasks: a full page gives a cursor for the last task", async () => {
    await arrangeMyTasks([
      taskRow("a", "2026-11-01"),
      taskRow("b", "2026-11-02"),
      taskRow("c", "2026-11-03"),
    ]);
    const res = await listMyTasks(actor(), { limit: 2 });
    if (!("tasks" in res)) {
      throw new Error("expected tasks");
    }
    expect(res.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(h.limits).toEqual([3]);
    expect(
      JSON.parse(Buffer.from(res.nextCursor ?? "", "base64url").toString())
    ).toEqual({ k: "my_tasks", e: "2026-11-02", s: null, id: "b" });
  });

  it("list_my_tasks: the last page has no cursor", async () => {
    await arrangeMyTasks([taskRow("a", null)]);
    const res = await listMyTasks(actor(), { limit: 2 });
    expect(res).toMatchObject({ ok: true, nextCursor: null });
  });

  it("list_my_tasks: a cursor becomes a keyset condition, never an offset", async () => {
    await arrangeMyTasks([]);
    const cursor = encodeCursor("my_tasks", {
      e: "2026-11-02",
      s: null,
      id: "b",
    });
    await listMyTasks(actor(), { cursor });
    const where = render(h.wheres[2]);
    expect(where.sql).toContain("9999-12-31");
    expect(where.sql).toMatch(/\) > \(\$\d+::date, \$\d+::date, \$\d+\)/);
    expect(where.params).toEqual(
      expect.arrayContaining(["2026-11-02", "9999-12-31", "b"])
    );
  });

  it("refuses tampered and foreign cursors with the same message", async () => {
    expect(await listMyTasks(actor(), { cursor: "garbage!" })).toEqual({
      error: "Invalid cursor",
    });
    const foreign = encodeCursor("lists", { o: 1, i: "x" });
    expect(await listMyTasks(actor(), { cursor: foreign })).toEqual({
      error: "Invalid cursor",
    });
    expect(
      await searchTasks(actor(), {
        workspaceId: "ws-1",
        query: "hello",
        cursor: foreign,
      })
    ).toEqual({ error: "Invalid cursor" });
    expect(h.selectQueue).toHaveLength(0);
  });

  it("search_tasks: pages by last update then id", async () => {
    const { getAccessibleSpaceIds } = await import("@/lib/permissions");
    vi.mocked(getAccessibleSpaceIds).mockResolvedValue(["sp-1"]);
    const hit = (id: string, key: string) => ({
      id,
      title: id,
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
      sortKey: key,
    });
    h.selectQueue.push(
      [
        hit("a", "2026-10-27 10:00:00.123456+00"),
        hit("b", "2026-10-27 09:00:00+00"),
      ],
      []
    );
    const cursor = encodeCursor("search", {
      u: "2026-10-27 11:00:00.5+00",
      id: "z",
    });
    const res = await searchTasks(actor(), {
      workspaceId: "ws-1",
      query: "hello",
      limit: 1,
      cursor,
    });
    if (!("tasks" in res)) {
      throw new Error("expected tasks");
    }
    expect(res.tasks.map((t) => t.id)).toEqual(["a"]);
    expect(
      JSON.parse(Buffer.from(res.nextCursor ?? "", "base64url").toString())
    ).toEqual({ k: "search", u: "2026-10-27 10:00:00.123456+00", id: "a" });
    const where = render(h.wheres[0]);
    expect(where.sql).toContain("::timestamptz");
    expect(where.params).toEqual(
      expect.arrayContaining(["2026-10-27 11:00:00.5+00", "z"])
    );
  });
});
