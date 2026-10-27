import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ selectQueue: [] as unknown[][] }));

// Thenable select chain fed from a queue (one entry per db.select() call).
function selectChain() {
  const rows = h.selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin", "innerJoin"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(selectChain) } }));

import { type Actor, webActor } from "@/lib/services/actor";
import {
  resolveCommentContext,
  resolveTaskContext,
  taskRevalidatePaths,
} from "@/lib/services/task-context";

const row = (over: Record<string, unknown> = {}) => ({
  taskId: "t1",
  workspaceId: "ws-1",
  taskSpaceId: "sp-task",
  listSpaceId: "sp-list",
  listId: "l1",
  statusId: "s1",
  title: "Title",
  parentTaskId: null,
  workspaceStatus: "ACTIVE",
  ...over,
});

beforeEach(() => {
  h.selectQueue.length = 0;
});

describe("resolveTaskContext", () => {
  it("uses the list's space for a task that has a list", async () => {
    h.selectQueue.push([row()]);
    expect(await resolveTaskContext("t1")).toEqual({
      taskId: "t1",
      workspaceId: "ws-1",
      spaceId: "sp-list",
      listId: "l1",
      statusId: "s1",
      title: "Title",
    });
  });

  it("falls back to task.spaceId for a listless task", async () => {
    h.selectQueue.push([
      row({ listId: null, listSpaceId: null, statusId: null }),
    ]);
    expect(await resolveTaskContext("t1")).toMatchObject({
      spaceId: "sp-task",
      listId: null,
      statusId: null,
    });
  });

  it("returns null when the task has no space at all", async () => {
    h.selectQueue.push([
      row({ listId: null, listSpaceId: null, taskSpaceId: null }),
    ]);
    expect(await resolveTaskContext("t1")).toBeNull();
  });

  it("takes the parent's space for a legacy subtask with no space", async () => {
    h.selectQueue.push(
      [
        row({
          listId: null,
          listSpaceId: null,
          taskSpaceId: null,
          parentTaskId: "p1",
        }),
      ],
      [{ taskSpaceId: "sp-parent", listSpaceId: null }]
    );
    expect(await resolveTaskContext("t1")).toMatchObject({
      spaceId: "sp-parent",
    });
  });

  it("returns null when the workspace is being deleted", async () => {
    h.selectQueue.push([row({ workspaceStatus: "DELETING" })]);
    expect(await resolveTaskContext("t1")).toBeNull();
  });

  it("returns null when the task is not found (missing or trashed)", async () => {
    h.selectQueue.push([]);
    expect(await resolveTaskContext("nope")).toBeNull();
  });
});

describe("resolveCommentContext", () => {
  const commentRow = {
    commentId: "c1",
    taskId: "t1",
    authorId: "u9",
    parentCommentId: "c0",
    isDeleted: false,
  };

  it("adds the comment fields to the task context", async () => {
    h.selectQueue.push([commentRow], [row()]);
    expect(await resolveCommentContext("c1")).toEqual({
      taskId: "t1",
      workspaceId: "ws-1",
      spaceId: "sp-list",
      listId: "l1",
      statusId: "s1",
      title: "Title",
      commentId: "c1",
      authorId: "u9",
      parentCommentId: "c0",
      isDeleted: false,
    });
  });

  it("returns null when the comment does not exist", async () => {
    h.selectQueue.push([]);
    expect(await resolveCommentContext("nope")).toBeNull();
  });

  it("returns null when the comment's task cannot be resolved", async () => {
    h.selectQueue.push([commentRow], []);
    expect(await resolveCommentContext("c1")).toBeNull();
  });
});

describe("taskRevalidatePaths", () => {
  it("targets the list page when the task has a list", () => {
    expect(
      taskRevalidatePaths({ workspaceId: "w", spaceId: "s", listId: "l" })
    ).toEqual(["/w/s/list/l"]);
  });

  it("targets the project and workspace home for a listless task", () => {
    expect(
      taskRevalidatePaths({ workspaceId: "w", spaceId: "s", listId: null })
    ).toEqual(["/w/s", "/w"]);
  });
});

const mcpActor = (over: Partial<Actor> = {}): Actor => ({
  userId: "u1",
  name: "U",
  email: "u@x.io",
  source: "mcp",
  tokenId: "tok",
  scope: "write",
  workspaceId: null,
  ...over,
});

describe("resolveTaskContext with an actor", () => {
  it("web actor: no membership lookup, guests are not blocked here", async () => {
    h.selectQueue.push([row()]);
    const actor = webActor({ user: { id: "u1", name: "U", email: "u@x.io" } });
    expect(await resolveTaskContext("t1", actor)).toMatchObject({
      taskId: "t1",
    });
    // Only the task query ran: a membership query would have used the queue.
    expect(h.selectQueue).toHaveLength(0);
  });

  it("returns null when the token is restricted to another workspace", async () => {
    h.selectQueue.push([row()]);
    expect(
      await resolveTaskContext("t1", mcpActor({ workspaceId: "ws-other" }))
    ).toBeNull();
  });

  it("allows a token restricted to the task's workspace", async () => {
    h.selectQueue.push([row()], [{ role: "MEMBER", status: "ACTIVE" }]);
    expect(
      await resolveTaskContext("t1", mcpActor({ workspaceId: "ws-1" }))
    ).toMatchObject({ taskId: "t1" });
  });

  it("MCP: returns null for a GUEST of the workspace", async () => {
    h.selectQueue.push([row()], [{ role: "GUEST", status: "ACTIVE" }]);
    expect(await resolveTaskContext("t1", mcpActor())).toBeNull();
  });

  it("MCP: returns null when the user is not an active member", async () => {
    h.selectQueue.push([row()], []);
    expect(await resolveTaskContext("t1", mcpActor())).toBeNull();
  });

  it("MCP: allows an active non-guest member", async () => {
    h.selectQueue.push([row()], [{ role: "ADMIN", status: "ACTIVE" }]);
    expect(await resolveTaskContext("t1", mcpActor())).toMatchObject({
      workspaceId: "ws-1",
    });
  });

  it("resolveCommentContext passes the actor on to the task lookup", async () => {
    h.selectQueue.push(
      [
        {
          commentId: "c1",
          taskId: "t1",
          authorId: "u9",
          parentCommentId: null,
          isDeleted: false,
        },
      ],
      [row()],
      [{ role: "GUEST", status: "ACTIVE" }]
    );
    expect(await resolveCommentContext("c1", mcpActor())).toBeNull();
  });
});

describe("webActor", () => {
  it("builds a write actor that is not restricted to a workspace", () => {
    expect(
      webActor({ user: { id: "u1", name: "U", email: "u@x.io" } })
    ).toEqual({
      userId: "u1",
      name: "U",
      email: "u@x.io",
      source: "web",
      scope: "write",
      workspaceId: null,
    });
  });
});
