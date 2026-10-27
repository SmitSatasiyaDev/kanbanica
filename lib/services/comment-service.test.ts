import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/services/actor";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  limits: [] as number[],
  inserts: [] as unknown[],
  updateSets: [] as unknown[],
  txInserts: [] as unknown[][],
  txFails: false,
  canAccess: true,
  membership: { role: "MEMBER", status: "ACTIVE" } as {
    role: string;
    status: string;
  } | null,
  resolveTaskContext: vi.fn(),
  writeActivityLog: vi.fn(),
  refreshWorkspace: vi.fn(),
  createNotifications: vi.fn(),
  storageDelete: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/activity-log", () => ({ writeActivityLog: h.writeActivityLog }));
vi.mock("@/lib/realtime/refresh", () => ({
  refreshWorkspace: h.refreshWorkspace,
}));
vi.mock("@/lib/notifications/create-notification", () => ({
  createNotifications: h.createNotifications,
}));
vi.mock("@/lib/storage", () => ({
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  storage: {
    url: vi.fn(async (k: string) => `/f/${k}`),
    delete: h.storageDelete,
    upload: vi.fn(),
    download: vi.fn(),
  },
}));
vi.mock("@/lib/permissions", () => ({
  canAccessSpace: vi.fn(async () => h.canAccess),
  getWorkspaceMembership: vi.fn(async () => h.membership),
  requireViewAccess: vi.fn(async () => null),
}));
vi.mock("@/lib/services/task-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/task-context")>();
  return { ...actual, resolveTaskContext: h.resolveTaskContext };
});

function selectChain() {
  const rows = h.selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "leftJoin", "innerJoin", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = (n: number) => {
    h.limits.push(n);
    return Promise.resolve(rows);
  };
  // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

function writeChain(inserts: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.set = (v: unknown) => {
    h.updateSets.push(v);
    return chain;
  };
  chain.values = (v: unknown) => {
    inserts.push(v);
    return chain;
  };
  chain.where = () => chain;
  // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(undefined).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(selectChain),
    insert: vi.fn(() => writeChain(h.inserts)),
    update: vi.fn(() => writeChain([])),
    transaction: h.transaction,
  },
}));

import { createComment, listComments } from "@/lib/services/comment-service";

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
const webUser = () => actor({ source: "web", tokenId: undefined });

const ctx = {
  taskId: "t1",
  workspaceId: "ws-1",
  spaceId: "sp-1",
  listId: "l1",
  statusId: "s",
  title: "Task",
};

const image = (n: number) => ({
  attachmentId: `att-${n}`,
  storageKey: `attachments/ws-1/t1/att-${n}/image-${n}.png`,
  fileName: `image-${n}.png`,
  mimeType: "image/png",
  size: 100 + n,
  alt: "shot",
});
const body = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "hi" }] },
    { type: "noteImage", attrs: { attachmentId: "att-1", fileKey: "k" } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.limits.length = 0;
  h.inserts.length = 0;
  h.updateSets.length = 0;
  h.txInserts.length = 0;
  h.txFails = false;
  h.canAccess = true;
  h.membership = { role: "MEMBER", status: "ACTIVE" };
  h.resolveTaskContext.mockResolvedValue(ctx);
  h.transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<void>) => {
      const rows: unknown[] = [];
      h.txInserts.push(rows);
      const tx = { insert: vi.fn(() => writeChain(rows)) };
      await fn(tx);
      if (h.txFails) {
        throw new Error("boom");
      }
    }
  );
});

describe("createComment", () => {
  it("refuses a read-only token", async () => {
    expect(
      await createComment(actor({ scope: "read" }), "t1", { body })
    ).toEqual({ error: "This token is read-only." });
    expect(h.resolveTaskContext).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(0);
  });

  it("uses the actor-aware context and says 'Task not found' without one", async () => {
    h.resolveTaskContext.mockResolvedValue(null);
    const a = actor({ workspaceId: "ws-other" });
    expect(await createComment(a, "t1", { body })).toEqual({
      error: "Task not found",
    });
    expect(h.resolveTaskContext).toHaveBeenCalledWith("t1", a);
  });

  it("refuses someone without View access", async () => {
    h.canAccess = false;
    expect(await createComment(actor(), "t1", { body })).toEqual({
      error: "Unauthorized",
    });
    expect(h.inserts).toHaveLength(0);
  });

  it("web flow: inserts the comment, then links inline images in a second write", async () => {
    const res = await createComment(webUser(), "t1", { body });

    expect(res).toMatchObject({ ok: true });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(1);
    expect(h.updateSets).toEqual([
      { commentId: (res as { commentId: string }).commentId },
    ]);
    // Web activity meta stays as it was; no source key.
    expect(h.writeActivityLog.mock.calls[0][3]).not.toHaveProperty("source");
  });

  it("with inlineImages: one transaction with the comment and pre-linked rows", async () => {
    const res = await createComment(actor(), "t1", {
      body,
      inlineImages: [image(1), image(2)],
    });

    expect(res).toMatchObject({ ok: true });
    const commentId = (res as { commentId: string }).commentId;
    expect(h.transaction).toHaveBeenCalledTimes(1);
    // Nothing is written outside the transaction, and no later link UPDATE.
    expect(h.inserts).toHaveLength(0);
    expect(h.updateSets).toHaveLength(0);

    const [commentRow, attachmentRows] = h.txInserts[0] as [
      Record<string, unknown>,
      Record<string, unknown>[],
    ];
    expect(commentRow).toMatchObject({ id: commentId, taskId: "t1", body });
    expect(attachmentRows).toHaveLength(2);
    expect(attachmentRows[0]).toMatchObject({
      id: "att-1",
      taskId: "t1",
      commentId,
      uploadedBy: "u1",
      fileUrl: "attachments/ws-1/t1/att-1/image-1.png",
      fileSize: 101,
      mimeType: "image/png",
      isInline: true,
    });
    expect(attachmentRows[1]).toMatchObject({
      id: "att-2",
      commentId,
      isInline: true,
    });

    // Activity and notifications run after commit, with source for MCP.
    expect(h.writeActivityLog).toHaveBeenCalledWith(
      "t1",
      "u1",
      "comment_added",
      {
        comment_id: commentId,
        source: "mcp",
      }
    );
    expect(h.storageDelete).not.toHaveBeenCalled();
  });

  it("with inlineImages: a GUEST is refused and the stored files are removed", async () => {
    h.membership = { role: "GUEST", status: "ACTIVE" };
    const res = await createComment(webUser(), "t1", {
      body,
      inlineImages: [image(1)],
    });

    expect(res).toEqual({ error: "Forbidden" });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.storageDelete).toHaveBeenCalledWith(image(1).storageKey);
  });

  it("with inlineImages: a key outside this task's folder is refused", async () => {
    const res = await createComment(actor(), "t1", {
      body,
      inlineImages: [
        { ...image(1), storageKey: "attachments/ws-9/t9/a/x.png" },
      ],
    });
    expect(res).toEqual({ error: "Invalid image" });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.storageDelete).toHaveBeenCalledTimes(1);
  });

  it("with inlineImages: a failed transaction deletes the files and posts nothing", async () => {
    h.txFails = true;
    const res = await createComment(actor(), "t1", {
      body,
      inlineImages: [image(1), image(2)],
    });

    expect(res).toEqual({ error: "Could not post the comment." });
    expect(h.storageDelete).toHaveBeenCalledTimes(2);
    expect(h.writeActivityLog).not.toHaveBeenCalled();
    expect(h.createNotifications).not.toHaveBeenCalled();
  });

  it("refuses a parent comment from another task", async () => {
    h.selectQueue.push([]);
    expect(
      await createComment(actor(), "t1", { body, parentCommentId: "c-other" })
    ).toEqual({ error: "Parent comment not found" });
    expect(h.inserts).toHaveLength(0);
  });
});

describe("listComments", () => {
  const row = (id: string, parentCommentId: string | null = null) => ({
    id,
    taskId: "t1",
    parentCommentId,
    authorId: "u2",
    authorName: "Two",
    authorEmail: "two@x.io",
    authorImage: null,
    body: {},
    isDeleted: false,
    isResolved: false,
    resolvedBy: null,
    resolvedAt: null,
    editedAt: null,
    createdAt: new Date(),
  });

  it("is allowed for a read-only token and nests replies", async () => {
    h.selectQueue.push([row("c1"), row("c2", "c1")], [], []);
    const res = await listComments(actor({ scope: "read" }), "t1");
    expect(res).toMatchObject({
      ok: true,
      comments: [{ id: "c1", replies: [{ id: "c2" }] }],
    });
  });

  it("with a limit, keeps a reply whose parent is outside the window", async () => {
    // Newest-first rows from SQL; the parent c1 is not in them.
    h.selectQueue.push([row("c3", "c1"), row("c2")], [], []);
    const res = await listComments(actor(), "t1", { limit: 2 });
    expect(h.limits).toEqual([2]);
    expect(res).toMatchObject({
      ok: true,
      comments: [{ id: "c2" }, { id: "c3", parentCommentId: "c1" }],
    });
  });

  it("refuses someone without View access and passes the actor on", async () => {
    h.canAccess = false;
    const a = actor();
    expect(await listComments(a, "t1")).toEqual({ error: "Unauthorized" });
    expect(h.resolveTaskContext).toHaveBeenCalledWith("t1", a);
  });
});
