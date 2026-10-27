import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/services/actor";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  wheres: [] as unknown[],
  orderBys: [] as unknown[][],
  limits: [] as number[],
  updateSets: [] as unknown[],
  updateWheres: [] as unknown[],
  updateRows: [] as unknown[],
  // Per workspace: the roles the user has.
  memberships: [] as { workspaceId: string; role: string }[],
  accessible: {} as Record<string, string[]>,
  archivedAccessible: {} as Record<string, string[]>,
}));

vi.mock("@/lib/permissions", () => ({
  getAccessibleSpaceIds: vi.fn(
    async (_u: string, ws: string, archivedOnly = false) =>
      (archivedOnly ? h.archivedAccessible[ws] : h.accessible[ws]) ?? []
  ),
  getWorkspaceMembership: vi.fn(),
  canAccessSpace: vi.fn(),
}));

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

vi.mock("@/lib/storage", () => ({ storage: { url: vi.fn(async () => "u") } }));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(selectChain),
    update: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.set = (v: unknown) => {
        h.updateSets.push(v);
        return chain;
      };
      chain.where = (w: unknown) => {
        h.updateWheres.push(w);
        return chain;
      };
      chain.returning = () => Promise.resolve(h.updateRows);
      return chain;
    }),
  },
}));

import { loadCommentsPage } from "@/lib/services/comment-service";
import { encodeCursor } from "@/lib/services/cursor";
import {
  listNotifications,
  markNotificationsRead,
} from "@/lib/services/notification-service";
import {
  getCurrentSprint,
  getListLocation,
  listLists,
  listMembers,
  listProjects,
} from "@/lib/services/project-service";
import { getTask } from "@/lib/services/task-service";

const dialect = new PgDialect();
const render = (q: unknown) =>
  dialect.sqlToQuery(q as Parameters<PgDialect["sqlToQuery"]>[0]);
const decode = (cursor: string | null | undefined) =>
  JSON.parse(Buffer.from(cursor ?? "", "base64url").toString());

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
const readActor = () => actor({ scope: "read" });

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.wheres.length = 0;
  h.orderBys.length = 0;
  h.limits.length = 0;
  h.updateSets.length = 0;
  h.updateWheres.length = 0;
  h.updateRows = [];
  h.memberships = [
    { workspaceId: "ws-1", role: "MEMBER" },
    { workspaceId: "ws-2", role: "GUEST" },
  ];
  h.accessible = { "ws-1": ["sp-1", "sp-2"], "ws-2": ["sp-9"] };
  h.archivedAccessible = { "ws-1": ["sp-old"] };
});

// allowedWorkspaces reads the memberships first.
const queueMemberships = () => h.selectQueue.push(h.memberships);

describe("listProjects", () => {
  const row = (id: string, order: number) => ({
    id,
    name: id,
    workspaceId: "ws-1",
    orderIndex: order,
    isPrivate: false,
    isArchived: false,
  });

  it("pages by workspace, order index and id, and strips the sort key from items", async () => {
    queueMemberships();
    h.selectQueue.push([row("a", 1), row("b", 2), row("c", 3)]);
    const res = await listProjects(actor(), { limit: 2 });
    if (!("items" in res)) {
      throw new Error("expected items");
    }
    expect(res.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(res.items[0]).not.toHaveProperty("orderIndex");
    expect(h.limits).toEqual([3]);
    expect(decode(res.nextCursor)).toEqual({
      k: "projects",
      w: "ws-1",
      o: 2,
      i: "b",
    });
  });

  it("has no cursor on the last page", async () => {
    queueMemberships();
    h.selectQueue.push([row("a", 1)]);
    expect(await listProjects(actor(), {})).toMatchObject({
      nextCursor: null,
    });
  });

  it("continues after a cursor with a row comparison", async () => {
    queueMemberships();
    h.selectQueue.push([]);
    const cursor = encodeCursor("projects", { w: "ws-1", o: 2, i: "b" });
    await listProjects(actor(), { cursor });
    const q = render(h.wheres[1]);
    expect(q.sql).toMatch(/\) > \(\$\d+, \$\d+, \$\d+\)/);
    expect(q.params).toEqual(expect.arrayContaining(["ws-1", 2, "b"]));
  });

  it("leaves out guest workspaces and anything outside the token restriction", async () => {
    queueMemberships();
    h.selectQueue.push([]);
    await listProjects(actor(), {});
    const params = render(h.wheres[1]).params;
    expect(params).toEqual(expect.arrayContaining(["sp-1", "sp-2"]));
    expect(params).not.toContain("sp-9");

    h.selectQueue.length = 0;
    queueMemberships();
    expect(
      await listProjects(actor({ workspaceId: "ws-1" }), {
        workspaceId: "ws-2",
      })
    ).toEqual({ ok: true, items: [], nextCursor: null });
  });

  it("adds archived projects only on request", async () => {
    queueMemberships();
    h.selectQueue.push([]);
    await listProjects(actor(), { includeArchived: true });
    expect(render(h.wheres[1]).params).toContain("sp-old");

    h.wheres.length = 0;
    queueMemberships();
    h.selectQueue.push([]);
    await listProjects(actor(), {});
    expect(render(h.wheres[1]).params).not.toContain("sp-old");
  });

  it("caps the limit at 200 and rejects a bad cursor", async () => {
    queueMemberships();
    h.selectQueue.push([]);
    await listProjects(actor(), { limit: 9999 });
    expect(h.limits).toEqual([201]);
    expect(await listProjects(actor(), { cursor: "nope!" })).toEqual({
      error: "Invalid cursor",
    });
  });

  it("a guest on the web keeps their guest workspace", async () => {
    queueMemberships();
    h.selectQueue.push([]);
    await listProjects(actor({ source: "web" }), {});
    expect(render(h.wheres[1]).params).toContain("sp-9");
  });
});

describe("listLists", () => {
  const project = { id: "sp-1", workspaceId: "ws-1", isArchived: false };

  it("hides a project the actor cannot see", async () => {
    h.selectQueue.push([{ ...project, id: "sp-x" }]);
    queueMemberships();
    expect(await listLists(actor(), { projectId: "sp-x" })).toEqual({
      error: "Project not found",
    });
  });

  it("hides a project in a guest workspace over MCP", async () => {
    h.selectQueue.push([
      { id: "sp-9", workspaceId: "ws-2", isArchived: false },
    ]);
    queueMemberships();
    expect(await listLists(actor(), { projectId: "sp-9" })).toEqual({
      error: "Project not found",
    });
  });

  it("pages by order index and id, archived lists only on request", async () => {
    h.selectQueue.push([project]);
    queueMemberships();
    h.selectQueue.push([
      {
        id: "l1",
        name: "A",
        projectId: "sp-1",
        orderIndex: 1,
        isArchived: false,
      },
      {
        id: "l2",
        name: "B",
        projectId: "sp-1",
        orderIndex: 2,
        isArchived: false,
      },
    ]);
    const res = await listLists(actor(), { projectId: "sp-1", limit: 1 });
    if (!("items" in res)) {
      throw new Error("expected items");
    }
    expect(res.items).toEqual([
      { id: "l1", name: "A", projectId: "sp-1", isArchived: false },
    ]);
    expect(decode(res.nextCursor)).toEqual({ k: "lists", o: 1, i: "l1" });
    expect(render(h.wheres[2]).sql).toContain('"list"."is_archived" = $');
  });

  it("includeArchived drops the archived filter", async () => {
    h.selectQueue.push([project]);
    queueMemberships();
    h.selectQueue.push([]);
    await listLists(actor(), { projectId: "sp-1", includeArchived: true });
    expect(render(h.wheres[2]).sql).not.toContain('"list"."is_archived"');
  });
});

describe("getListLocation", () => {
  it("returns the list's project, but not in a guest workspace over MCP", async () => {
    h.selectQueue.push([
      { listId: "l1", spaceId: "sp-1", workspaceId: "ws-1" },
    ]);
    queueMemberships();
    expect(await getListLocation(actor(), "l1")).toEqual({
      listId: "l1",
      spaceId: "sp-1",
      workspaceId: "ws-1",
    });

    h.selectQueue.push([
      { listId: "l9", spaceId: "sp-9", workspaceId: "ws-2" },
    ]);
    queueMemberships();
    expect(await getListLocation(actor(), "l9")).toBeNull();

    h.selectQueue.push([]);
    expect(await getListLocation(actor(), "none")).toBeNull();
  });
});

describe("listMembers", () => {
  it("needs a non-guest workspace inside the token restriction", async () => {
    queueMemberships();
    expect(await listMembers(actor(), { workspaceId: "ws-2" })).toEqual({
      error: "Workspace not found",
    });
    h.selectQueue.length = 0;
    queueMemberships();
    expect(
      await listMembers(actor({ workspaceId: "ws-1" }), { workspaceId: "ws-3" })
    ).toEqual({ error: "Workspace not found" });
  });

  it("pages by name and user id; the query escapes LIKE wildcards", async () => {
    queueMemberships();
    h.selectQueue.push([
      { userId: "u2", name: "Ana", email: "a@x.io", role: "MEMBER" },
      { userId: "u3", name: "Bo", email: "b@x.io", role: "ADMIN" },
    ]);
    const res = await listMembers(actor(), {
      workspaceId: "ws-1",
      query: "50%_off",
      limit: 1,
    });
    if (!("items" in res)) {
      throw new Error("expected items");
    }
    expect(res.items).toEqual([
      { userId: "u2", name: "Ana", email: "a@x.io", role: "MEMBER" },
    ]);
    expect(decode(res.nextCursor)).toEqual({ k: "members", n: "Ana", i: "u2" });
    const q = render(h.wheres[1]);
    expect(q.params).toContain("%50\\%\\_off%");
    expect(q.sql).toContain('"workspace_member"."status" = $');
  });

  it("continues after a cursor", async () => {
    queueMemberships();
    h.selectQueue.push([]);
    const cursor = encodeCursor("members", { n: "Ana", i: "u2" });
    await listMembers(actor(), { workspaceId: "ws-1", cursor });
    expect(render(h.wheres[1]).params).toEqual(
      expect.arrayContaining(["Ana", "u2"])
    );
  });
});

describe("getCurrentSprint", () => {
  const project = { id: "sp-1", workspaceId: "ws-1", isArchived: false };
  const sprintRow = {
    id: "spr1",
    name: "Sprint 1",
    goal: null,
    startDate: "2026-10-26",
    endDate: "2026-11-08",
    status: "ACTIVE",
  };

  it("hides a project the actor cannot see", async () => {
    h.selectQueue.push([{ ...project, id: "sp-x" }]);
    queueMemberships();
    expect(await getCurrentSprint(actor(), { projectId: "sp-x" })).toEqual({
      error: "Project not found",
    });
  });

  it("without an active sprint returns the next planned one", async () => {
    h.selectQueue.push([project]);
    queueMemberships();
    h.selectQueue.push([], [{ ...sprintRow, status: "PLANNED" }]);
    const res = await getCurrentSprint(actor(), { projectId: "sp-1" });
    expect(res).toMatchObject({
      ok: true,
      sprint: null,
      upcoming: { id: "spr1", status: "PLANNED" },
      tasks: { items: [], nextCursor: null },
    });
  });

  it("returns the active sprint's tasks, paged by order index and id", async () => {
    h.selectQueue.push([project]);
    queueMemberships();
    const t = (id: string, order: number) => ({
      id,
      seqNumber: order,
      title: id,
      priority: "LOW",
      statusId: "s",
      statusName: "Todo",
      statusType: "OPEN",
      listId: "l1",
      dueDateStart: null,
      dueDateEnd: null,
      orderIndex: order,
      storyPoints: 3,
    });
    h.selectQueue.push(
      [sprintRow],
      [t("a", 1), t("b", 2)],
      [{ taskId: "a", userId: "u2", name: "Eli" }]
    );
    const res = await getCurrentSprint(actor(), {
      projectId: "sp-1",
      limit: 1,
    });
    if (!("tasks" in res)) {
      throw new Error("expected tasks");
    }
    expect(res.workspaceId).toBe("ws-1");
    expect(res.sprint?.id).toBe("spr1");
    expect(res.tasks.items).toHaveLength(1);
    expect(res.tasks.items[0]).toMatchObject({
      id: "a",
      storyPoints: 3,
      assignees: [{ userId: "u2", name: "Eli" }],
    });
    expect(res.tasks.items[0]).not.toHaveProperty("orderIndex");
    expect(decode(res.tasks.nextCursor)).toEqual({
      k: "sprint_tasks",
      o: 1,
      i: "a",
    });
    // Trashed and archived tasks are left out.
    const where = render(h.wheres[3]);
    expect(where.sql).toContain('"deleted_at" is null');
    expect(where.sql).toContain('"is_archived" = $');
  });
});

describe("listNotifications", () => {
  const row = (id: string, key: string) => ({
    id,
    triggerType: "task_assigned",
    title: "Assigned",
    body: null,
    isRead: false,
    createdAt: new Date("2026-10-27T10:00:00Z"),
    createdKey: key,
    workspaceId: "ws-1",
    entityType: "TASK",
    taskId: "t1",
    taskSeq: 7,
  });

  it("only ever reads the actor's own notifications", async () => {
    queueMemberships();
    h.selectQueue.push([]);
    await listNotifications(actor({ userId: "me" }), {});
    const q = render(h.wheres[1]);
    expect(q.sql).toContain('"notification"."recipient_id" = $');
    expect(q.params).toContain("me");
  });

  it("is limited to allowed workspaces and the projects the actor can see", async () => {
    queueMemberships();
    h.selectQueue.push([]);
    await listNotifications(actor(), {});
    const q = render(h.wheres[1]);
    // ws-2 is a guest workspace: not allowed over MCP.
    expect(q.params).toContain("ws-1");
    expect(q.params).not.toContain("ws-2");
    expect(q.params).not.toContain("sp-9");
    expect(q.params).toEqual(expect.arrayContaining(["sp-1", "sp-2"]));
    // Trashed tasks are hidden; channel messages are not offered.
    expect(q.sql).toContain('"deleted_at" is null');
    expect(q.params).not.toContain("COMMENT");
  });

  it("respects the token's workspace restriction", async () => {
    queueMemberships();
    expect(
      await listNotifications(actor({ workspaceId: "ws-1" }), {
        workspaceId: "ws-2",
      })
    ).toEqual({ ok: true, items: [], nextCursor: null });
  });

  it("returns unread only by default and everything when asked", async () => {
    queueMemberships();
    h.selectQueue.push([]);
    await listNotifications(actor(), {});
    expect(render(h.wheres[1]).sql).toContain('"is_read" = $');

    h.wheres.length = 0;
    queueMemberships();
    h.selectQueue.push([]);
    await listNotifications(actor(), { unreadOnly: false });
    expect(render(h.wheres[1]).sql).not.toContain('"is_read" = $');
  });

  it("pages newest first by time then id, keeping the full timestamp precision", async () => {
    queueMemberships();
    h.selectQueue.push([
      row("n3", "2026-10-27 10:00:00.333333+00"),
      row("n2", "2026-10-27 10:00:00.222222+00"),
    ]);
    const res = await listNotifications(actor(), { limit: 1 });
    if (!("items" in res)) {
      throw new Error("expected items");
    }
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: "n3",
      task: { id: "t1", seqNumber: 7 },
    });
    expect(decode(res.nextCursor)).toEqual({
      k: "notifications",
      c: "2026-10-27 10:00:00.333333+00",
      i: "n3",
    });

    queueMemberships();
    h.selectQueue.push([]);
    const cursor = encodeCursor("notifications", {
      c: "2026-10-27 10:00:00.333333+00",
      i: "n3",
    });
    h.wheres.length = 0;
    await listNotifications(actor(), { cursor });
    const q = render(h.wheres[1]);
    expect(q.sql).toContain("::timestamptz");
    expect(q.params).toContain("2026-10-27 10:00:00.333333+00");
  });

  it("rejects a bad cursor", async () => {
    expect(await listNotifications(actor(), { cursor: "xx$" })).toEqual({
      error: "Invalid cursor",
    });
  });
});

describe("markNotificationsRead", () => {
  it("is refused for a read-only token", async () => {
    expect(await markNotificationsRead(readActor(), { all: true })).toEqual({
      error: "This token is read-only.",
    });
    expect(h.updateSets).toHaveLength(0);
  });

  it("needs ids or all", async () => {
    expect(await markNotificationsRead(actor(), {})).toEqual({
      error: "Provide ids, or all: true.",
    });
    const many = Array.from({ length: 201 }, (_, i) => `n${i}`);
    expect(await markNotificationsRead(actor(), { ids: many })).toEqual({
      error: "Pass at most 200 ids at a time.",
    });
  });

  it("only touches the actor's own unread notifications in allowed workspaces", async () => {
    queueMemberships();
    h.updateRows = [{ id: "n1" }, { id: "n2" }];
    const res = await markNotificationsRead(actor({ userId: "me" }), {
      ids: ["n1", "n2", "n3"],
    });
    expect(res).toEqual({ ok: true, marked: 2 });
    expect(h.updateSets[0]).toMatchObject({ isRead: true });
    const q = render(h.updateWheres[0]);
    expect(q.sql).toContain('"recipient_id" = $');
    expect(q.params).toEqual(
      expect.arrayContaining(["me", "n1", "n2", "n3", "ws-1"])
    );
    expect(q.params).not.toContain("ws-2");
  });

  it("all: true is still scoped to the actor and the workspace restriction", async () => {
    queueMemberships();
    h.updateRows = [];
    await markNotificationsRead(actor({ userId: "me", workspaceId: "ws-1" }), {
      all: true,
    });
    const q = render(h.updateWheres[0]);
    expect(q.params).toEqual(expect.arrayContaining(["me", "ws-1"]));
    expect(q.sql).not.toContain('"notification"."id" in');
  });

  it("marks nothing when no workspace is allowed", async () => {
    queueMemberships();
    expect(
      await markNotificationsRead(actor({ workspaceId: "ws-1" }), {
        all: true,
        workspaceId: "ws-2",
      })
    ).toEqual({ ok: true, marked: 0 });
    expect(h.updateSets).toHaveLength(0);
  });
});

describe("comment paging", () => {
  const comment = (id: string, key: string) => ({
    id,
    taskId: "t1",
    parentCommentId: null,
    authorId: "u2",
    authorName: "Eli",
    authorEmail: "e@x.io",
    authorImage: null,
    body: { type: "doc", content: [] },
    isDeleted: false,
    isResolved: false,
    resolvedBy: null,
    resolvedAt: null,
    editedAt: null,
    createdAt: new Date("2026-10-27T10:00:00Z"),
    createdKey: key,
  });

  it("returns the newest window oldest-first and a key for older comments", async () => {
    // Newest first from the database: c3, c2, c1 (one more than the page).
    h.selectQueue.push(
      [
        comment("c3", "2026-10-27 10:00:03+00"),
        comment("c2", "2026-10-27 10:00:02+00"),
        comment("c1", "2026-10-27 10:00:01+00"),
      ],
      [],
      []
    );
    const page = await loadCommentsPage("t1", { limit: 2 });
    expect(h.limits[0]).toBe(3);
    expect(page.comments.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(page.nextKey).toEqual({
      createdAt: "2026-10-27 10:00:02+00",
      id: "c2",
    });
  });

  it("has no key when nothing older exists, and continues before a key", async () => {
    h.selectQueue.push([comment("c1", "2026-10-27 10:00:01+00")], [], []);
    const page = await loadCommentsPage("t1", {
      limit: 2,
      before: { createdAt: "2026-10-27 10:00:02+00", id: "c2" },
    });
    expect(page.nextKey).toBeNull();
    const q = render(h.wheres[0]);
    expect(q.sql).toContain("::timestamptz");
    expect(q.params).toEqual(
      expect.arrayContaining(["2026-10-27 10:00:02+00", "c2"])
    );
  });

  it("get_task rejects a bad comments cursor before reading anything", async () => {
    expect(
      await getTask(actor(), { taskId: "t1" }, { commentsCursor: "nope!" })
    ).toEqual({ error: "Invalid cursor" });
    expect(h.selectQueue).toHaveLength(0);
  });
});
