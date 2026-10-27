import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/services/actor";

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listMyTasks: vi.fn(),
  searchTasks: vi.fn(),
  getTask: vi.fn(),
  listTaskStatuses: vi.fn(),
  setTaskStatus: vi.fn(),
  completeTask: vi.fn(),
  assignTask: vi.fn(),
  createComment: vi.fn(),
  checkUploadAccess: vi.fn(),
  storeUploadedBytes: vi.fn(),
  deleteStoredFiles: vi.fn(),
  uploadAttachment: vi.fn(),
  readAttachment: vi.fn(),
  resolveTaskContext: vi.fn(),
  consumeRateLimits: vi.fn(),
  createTask: vi.fn(),
  createSubtask: vi.fn(),
  updateTask: vi.fn(),
  getTaskCard: vi.fn(),
  resolveProjectUsers: vi.fn(),
  resolveTaskMentionTargets: vi.fn(),
  listDescriptionAttachments: vi.fn(),
  listProjects: vi.fn(),
  listLists: vi.fn(),
  listMembers: vi.fn(),
  getCurrentSprint: vi.fn(),
  getListLocation: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.example.com" } }));
vi.mock("@/lib/storage", () => ({ MAX_FILE_SIZE: 10 * 1024 * 1024 }));
vi.mock("@/lib/rate-limit-db", () => ({
  consumeRateLimits: mocks.consumeRateLimits,
}));
vi.mock("@/lib/services/notification-service", () => ({
  listNotifications: mocks.listNotifications,
  markNotificationsRead: mocks.markNotificationsRead,
}));
vi.mock("@/lib/services/project-service", () => ({
  listProjects: mocks.listProjects,
  listLists: mocks.listLists,
  listMembers: mocks.listMembers,
  getCurrentSprint: mocks.getCurrentSprint,
  getListLocation: mocks.getListLocation,
}));
vi.mock("@/lib/services/task-context", () => ({
  resolveTaskContext: mocks.resolveTaskContext,
}));
vi.mock("@/lib/services/task-service", () => ({
  listWorkspaces: mocks.listWorkspaces,
  listMyTasks: mocks.listMyTasks,
  searchTasks: mocks.searchTasks,
  getTask: mocks.getTask,
  listTaskStatuses: mocks.listTaskStatuses,
  setTaskStatus: mocks.setTaskStatus,
  completeTask: mocks.completeTask,
  assignTask: mocks.assignTask,
  createTask: mocks.createTask,
  createSubtask: mocks.createSubtask,
  updateTask: mocks.updateTask,
  getTaskCard: mocks.getTaskCard,
  resolveProjectUsers: mocks.resolveProjectUsers,
  resolveTaskMentionTargets: mocks.resolveTaskMentionTargets,
  listDescriptionAttachments: mocks.listDescriptionAttachments,
}));
vi.mock("@/lib/services/comment-service", () => ({
  createComment: mocks.createComment,
}));
vi.mock("@/lib/services/attachment-service", () => ({
  checkUploadAccess: mocks.checkUploadAccess,
  storeUploadedBytes: mocks.storeUploadedBytes,
  deleteStoredFiles: mocks.deleteStoredFiles,
  uploadAttachment: mocks.uploadAttachment,
  readAttachment: mocks.readAttachment,
  safeStorageName: (name: string) => {
    const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    return /^\.*$/.test(cleaned) ? "file" : cleaned;
  },
}));

import { createMcpServer } from "@/lib/mcp/server";

const writeActor: Actor = {
  userId: "u1",
  name: "Dana",
  email: "dana@example.com",
  source: "mcp",
  tokenId: "tok1",
  scope: "write",
  workspaceId: null,
};
const readActor: Actor = { ...writeActor, scope: "read" };

async function connect(actor: Actor) {
  const server = createMcpServer(actor);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

type Block = { type: string; text?: string; data?: string; mimeType?: string };
async function call(actor: Actor, name: string, args: Record<string, unknown>) {
  const client = await connect(actor);
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Block[];
  return {
    isError: result.isError === true,
    content,
    text: content.find((c) => c.type === "text")?.text ?? "",
  };
}

const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
const SVG = Array.from(
  new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'
  )
);

beforeEach(() => {
  vi.restoreAllMocks();
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  // Every counter is under its limit unless a test says otherwise.
  mocks.consumeRateLimits.mockImplementation(
    async (checks: { key: string }[]) =>
      checks.map((c) => ({ key: c.key, ok: true, retryAfter: 0 }))
  );
  mocks.resolveProjectUsers.mockResolvedValue(new Map());
  mocks.resolveTaskMentionTargets.mockResolvedValue(new Map());
  mocks.listDescriptionAttachments.mockResolvedValue(new Map());
  mocks.resolveTaskContext.mockResolvedValue({
    workspaceId: "w1",
    spaceId: "s1",
  });
  mocks.checkUploadAccess.mockResolvedValue({
    ok: true,
    ctx: { workspaceId: "w1", spaceId: "s1", taskId: "t1", title: "T" },
  });
  mocks.deleteStoredFiles.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("tool list", () => {
  it("registers the twenty tools with the right annotations", async () => {
    const client = await connect(writeActor);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_comment",
        "assign_task",
        "complete_task",
        "create_subtask",
        "create_task",
        "get_attachment",
        "get_current_sprint",
        "get_task",
        "list_lists",
        "list_members",
        "list_my_tasks",
        "list_notifications",
        "list_projects",
        "list_task_statuses",
        "list_workspaces",
        "mark_notifications_read",
        "search_tasks",
        "set_task_status",
        "update_task",
        "upload_attachment",
      ].sort()
    );
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of [
      "list_workspaces",
      "list_my_tasks",
      "search_tasks",
      "get_task",
      "get_attachment",
      "list_task_statuses",
      "list_projects",
      "list_lists",
      "list_members",
      "list_notifications",
      "get_current_sprint",
    ]) {
      expect(byName.get(name)?.annotations?.readOnlyHint).toBe(true);
    }
    for (const name of [
      "set_task_status",
      "complete_task",
      "assign_task",
      "update_task",
      "mark_notifications_read",
    ]) {
      expect(byName.get(name)?.annotations).toMatchObject({
        destructiveHint: false,
        idempotentHint: true,
      });
    }
    for (const name of [
      "add_comment",
      "upload_attachment",
      "create_task",
      "create_subtask",
    ]) {
      expect(byName.get(name)?.annotations?.destructiveHint).toBe(false);
      expect(byName.get(name)?.annotations?.readOnlyHint).toBe(false);
    }
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
    }
  });
});

describe("read-only tokens", () => {
  const writes: [string, Record<string, unknown>][] = [
    ["set_task_status", { taskId: "t1", statusId: "st1" }],
    ["complete_task", { taskId: "t1" }],
    ["assign_task", { taskId: "t1" }],
    ["add_comment", { taskId: "t1", text: "hello" }],
    [
      "upload_attachment",
      { taskId: "t1", fileName: "a.txt", dataBase64: "YQ==" },
    ],
    ["create_task", { listId: "l1", title: "T" }],
    ["create_subtask", { parentTaskId: "t1", title: "T" }],
    ["update_task", { taskId: "t1", title: "New" }],
    ["mark_notifications_read", { all: true }],
  ];

  it.each(writes)("refuses %s", async (name, args) => {
    const res = await call(readActor, name, args);
    expect(res.isError).toBe(true);
    expect(res.text).toBe("This token is read-only.");
    for (const mock of [
      mocks.setTaskStatus,
      mocks.completeTask,
      mocks.assignTask,
      mocks.createComment,
      mocks.uploadAttachment,
      mocks.storeUploadedBytes,
      mocks.createTask,
      mocks.createSubtask,
      mocks.updateTask,
      mocks.markNotificationsRead,
    ]) {
      expect(mock).not.toHaveBeenCalled();
    }
    // A refused write is not counted against the write limit either.
    expect(mocks.consumeRateLimits).not.toHaveBeenCalled();
  });

  it("still allows reads", async () => {
    mocks.listWorkspaces.mockResolvedValue({
      ok: true,
      workspaces: [{ id: "w1", name: "Acme" }],
    });
    const res = await call(readActor, "list_workspaces", {});
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.text)).toEqual([{ id: "w1", name: "Acme" }]);
  });
});

describe("errors", () => {
  it("maps a missing task to a fixed message", async () => {
    mocks.getTask.mockResolvedValue({ error: "Task not found" });
    const res = await call(writeActor, "get_task", { taskId: "nope" });
    expect(res).toMatchObject({ isError: true, text: "Task not found" });
  });

  it("maps the comment service's Unauthorized to Task not found", async () => {
    mocks.createComment.mockResolvedValue({ error: "Unauthorized" });
    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "hi",
    });
    expect(res).toMatchObject({ isError: true, text: "Task not found" });
  });

  it("never passes an unknown or internal error to the model", async () => {
    mocks.completeTask.mockResolvedValue({
      error: 'relation "task" does not exist at pg:42',
    });
    const res = await call(writeActor, "complete_task", { taskId: "t1" });
    expect(res.isError).toBe(true);
    expect(res.text).not.toContain("relation");
    expect(res.text).toBe("Something went wrong. Try again later.");
  });

  it("turns a thrown error into the generic message", async () => {
    mocks.listMyTasks.mockRejectedValue(
      new Error("connection refused 10.0.0.5")
    );
    const res = await call(writeActor, "list_my_tasks", {});
    expect(res.isError).toBe(true);
    expect(res.text).not.toContain("10.0.0.5");
  });

  it("asks for taskId or workspaceId plus number", async () => {
    const res = await call(writeActor, "get_task", { workspaceId: "w1" });
    expect(res.isError).toBe(true);
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it("logs one line per call without the arguments", async () => {
    mocks.completeTask.mockResolvedValue({
      ok: true,
      status: { id: "c", name: "Done", type: "CLOSED" },
      changed: true,
    });
    await call(writeActor, "complete_task", { taskId: "secret-task-id" });
    const info = vi.mocked(console.info);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toContain("tool=complete_task");
    expect(line).toContain("token=tok1");
    expect(line).toContain("user=u1");
    expect(line).toContain("result=ok");
    expect(line).not.toContain("secret-task-id");
  });
});

describe("reads", () => {
  it("get_task returns Markdown in labelled fields", async () => {
    mocks.getTask.mockResolvedValue({
      ok: true,
      task: {
        id: "t1",
        seqNumber: 123,
        workspaceId: "w1",
        spaceId: "s1",
        listId: "l1",
        statusId: "st1",
        isArchived: false,
        title: "Fix login",
        description: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Broken", marks: [{ type: "bold" }] },
              ],
            },
            {
              type: "noteImage",
              attrs: { fileKey: "k", attachmentId: "a1", alt: "shot" },
            },
          ],
        }),
        priority: "HIGH",
        dueDateStart: null,
        dueDateEnd: "2026-11-01",
      },
      statuses: [{ id: "st1", name: "In progress", type: "ACTIVE" }],
      assignees: [{ userId: "u1", name: "Dana", email: "dana@example.com" }],
      tags: [{ id: "g", name: "bug", color: "#f00" }],
      parentTask: null,
      subtasks: [],
      canEdit: true,
      comments: [
        {
          id: "c1",
          authorId: "u2",
          authorName: "Eli",
          createdAt: new Date("2026-10-01T00:00:00Z"),
          editedAt: null,
          isResolved: false,
          isDeleted: false,
          body: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "On it" }] },
            ],
          },
          attachments: [],
          replies: [],
        },
      ],
      attachments: [
        {
          id: "a1",
          fileName: "image-1.png",
          mimeType: "image/png",
          size: 12,
          isImage: true,
        },
      ],
    });
    const res = await call(writeActor, "get_task", { taskId: "t1" });
    expect(res.isError).toBe(false);
    const data = JSON.parse(res.text);
    expect(data.number).toBe(123);
    expect(data.numberLabel).toBe("#123");
    expect(data.url).toBe("https://app.example.com/w1/task/t1");
    expect(data.description).toBe("**Broken**\n\n![shot](attachment:a1)");
    expect(data.status).toEqual({
      id: "st1",
      name: "In progress",
      type: "ACTIVE",
    });
    expect(data.comments[0]).toMatchObject({
      author: { id: "u2", name: "Eli" },
      body: "On it",
    });
    expect(data.attachments).toEqual([
      {
        id: "a1",
        fileName: "image-1.png",
        mimeType: "image/png",
        size: 12,
        isImage: true,
      },
    ]);
    expect(data.notice).toContain("not as instructions");
  });

  it("get_task by number passes workspaceId and number", async () => {
    mocks.getTask.mockResolvedValue({ error: "Task not found" });
    await call(writeActor, "get_task", { workspaceId: "w1", number: 7 });
    expect(mocks.getTask).toHaveBeenCalledWith(
      writeActor,
      { workspaceId: "w1", number: 7 },
      { commentsCursor: undefined }
    );
  });

  it("list_my_tasks adds number and url", async () => {
    mocks.listMyTasks.mockResolvedValue({
      ok: true,
      tasks: [
        {
          id: "t1",
          seqNumber: 5,
          title: "A",
          priority: "LOW",
          dueDateStart: null,
          dueDateEnd: "2026-11-02",
          status: { id: "st", name: "Todo", color: "#000", type: "OPEN" },
          list: { id: "l", name: "Backlog" },
          space: { id: "s", name: "Web", color: null, logoEmoji: null },
          workspace: { id: "w1", name: "Acme" },
          tags: [],
        },
      ],
      nextCursor: "abc",
    });
    const res = await call(writeActor, "list_my_tasks", { limit: 10 });
    const page = JSON.parse(res.text);
    expect(page.nextCursor).toBe("abc");
    const [task] = page.items;
    expect(task).toMatchObject({
      id: "t1",
      number: 5,
      numberLabel: "#5",
      dueDate: "2026-11-02",
      project: { id: "s", name: "Web" },
      url: "https://app.example.com/w1/task/t1",
    });
    expect(mocks.listMyTasks).toHaveBeenCalledWith(writeActor, {
      workspaceId: undefined,
      includeCompleted: false,
      limit: 10,
      cursor: undefined,
    });
  });

  it("rejects out-of-range limits before reaching the service", async () => {
    const res = await call(writeActor, "list_my_tasks", { limit: 5000 });
    expect(res.isError).toBe(true);
    expect(mocks.listMyTasks).not.toHaveBeenCalled();
  });
});

describe("get_attachment", () => {
  it("returns an image as image content, going by the bytes", async () => {
    mocks.readAttachment.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array(PNG),
      mimeType: "image/png",
      fileName: "shot.png",
      size: PNG.length,
    });
    const res = await call(writeActor, "get_attachment", {
      attachmentId: "a1",
    });
    expect(res.isError).toBe(false);
    const image = res.content.find((c) => c.type === "image");
    expect(image).toEqual({
      type: "image",
      data: b64(PNG),
      mimeType: "image/png",
    });
    expect(mocks.readAttachment).toHaveBeenCalledWith(writeActor, "a1", {
      maxBytes: 10 * 1024 * 1024,
      maxNonImageBytes: 5 * 1024 * 1024,
    });
  });

  it("returns other files as a resource blob", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 hello");
    mocks.readAttachment.mockResolvedValue({
      ok: true,
      bytes,
      mimeType: "application/pdf",
      fileName: "spec.pdf",
      size: bytes.length,
    });
    const res = await call(writeActor, "get_attachment", {
      attachmentId: "a2",
    });
    const resource = res.content.find(
      (c) => c.type === "resource"
    ) as unknown as {
      resource: { uri: string; mimeType: string; blob: string };
    };
    expect(resource.resource.mimeType).toBe("application/pdf");
    expect(resource.resource.blob).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("does not return an SVG as an image", async () => {
    mocks.readAttachment.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array(SVG),
      mimeType: "image/svg+xml",
      fileName: "x.svg",
      size: SVG.length,
    });
    const res = await call(writeActor, "get_attachment", {
      attachmentId: "a3",
    });
    expect(res.content.some((c) => c.type === "image")).toBe(false);
    expect(res.content.some((c) => c.type === "resource")).toBe(true);
  });

  it("names the file and size when it is too large", async () => {
    mocks.readAttachment.mockResolvedValue({
      error: "File is too large to return.",
      fileName: "video.mp4",
      size: 8 * 1024 * 1024,
    });
    const res = await call(writeActor, "get_attachment", {
      attachmentId: "a4",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("video.mp4");
    expect(res.text).toContain("8.0 MB");
  });

  it("reports a missing attachment", async () => {
    mocks.readAttachment.mockResolvedValue({ error: "Attachment not found" });
    const res = await call(writeActor, "get_attachment", { attachmentId: "x" });
    expect(res).toMatchObject({ isError: true, text: "Attachment not found" });
  });
});

describe("writes", () => {
  it("complete_task passes through", async () => {
    mocks.completeTask.mockResolvedValue({
      ok: true,
      status: { id: "c", name: "Done", type: "CLOSED" },
      changed: true,
    });
    const res = await call(writeActor, "complete_task", { taskId: "t1" });
    expect(res.isError).toBe(false);
    expect(mocks.completeTask).toHaveBeenCalledWith(writeActor, "t1");
    expect(JSON.parse(res.text)).toEqual({
      status: { id: "c", name: "Done", type: "CLOSED" },
      changed: true,
    });
  });

  it("set_task_status only accepts a status of the task's own list", async () => {
    mocks.setTaskStatus.mockResolvedValue({
      ok: true,
      status: { id: "st2", name: "Review", type: "ACTIVE" },
      changed: false,
    });
    await call(writeActor, "set_task_status", {
      taskId: "t1",
      statusId: "st2",
    });
    expect(mocks.setTaskStatus).toHaveBeenCalledWith(writeActor, "t1", "st2", {
      sameListOnly: true,
    });
  });

  it("assign_task defaults to me and returns the assignees", async () => {
    mocks.assignTask.mockResolvedValue({
      ok: true,
      assignees: [{ userId: "u1", name: "Dana", email: "dana@example.com" }],
    });
    const res = await call(writeActor, "assign_task", { taskId: "t1" });
    expect(mocks.assignTask).toHaveBeenCalledWith(writeActor, "t1", {
      userId: undefined,
      unassign: false,
    });
    expect(JSON.parse(res.text).assignees).toHaveLength(1);
  });

  it("maps a refused status change", async () => {
    mocks.setTaskStatus.mockResolvedValue({ error: "Forbidden" });
    const res = await call(writeActor, "set_task_status", {
      taskId: "t1",
      statusId: "st",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("permission");
  });
});

describe("add_comment", () => {
  it("posts Markdown text without images", async () => {
    mocks.createComment.mockResolvedValue({ ok: true, commentId: "c1" });
    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "Done, see **notes**",
      parentCommentId: "p1",
    });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.text)).toEqual({
      commentId: "c1",
      url: "https://app.example.com/w1/task/t1",
    });
    const [, , input] = mocks.createComment.mock.calls[0];
    expect(input.parentCommentId).toBe("p1");
    expect(input.inlineImages).toBeUndefined();
    expect(input.body.content[0].type).toBe("paragraph");
    expect(mocks.checkUploadAccess).not.toHaveBeenCalled();
  });

  it("refuses empty text", async () => {
    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "  ",
    });
    expect(res.isError).toBe(true);
    expect(mocks.createComment).not.toHaveBeenCalled();
  });

  it("refuses an SVG and stores nothing", async () => {
    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "look",
      images: [{ dataBase64: b64(SVG) }],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("PNG, JPEG, GIF or WebP");
    expect(mocks.storeUploadedBytes).not.toHaveBeenCalled();
    expect(mocks.createComment).not.toHaveBeenCalled();
  });

  it("refuses bad base64 and oversized images", async () => {
    const bad = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "x",
      images: [{ dataBase64: "not base64!!" }],
    });
    expect(bad.isError).toBe(true);
    const big = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "x",
      images: [{ dataBase64: "A".repeat(13_981_032) }],
    });
    expect(big.isError).toBe(true);
    expect(big.text).toContain("10 MB");
    expect(mocks.storeUploadedBytes).not.toHaveBeenCalled();
  });

  it("refuses more than five images", async () => {
    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "x",
      images: Array.from({ length: 6 }, () => ({ dataBase64: b64(PNG) })),
    });
    expect(res.isError).toBe(true);
    expect(mocks.storeUploadedBytes).not.toHaveBeenCalled();
  });

  it("checks the upload rule before decoding", async () => {
    mocks.checkUploadAccess.mockResolvedValue({
      error: "Forbidden",
      code: "forbidden",
    });
    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "x",
      images: [{ dataBase64: b64(PNG) }],
    });
    expect(res.isError).toBe(true);
    expect(mocks.storeUploadedBytes).not.toHaveBeenCalled();
  });

  it("stores two PNGs and posts one comment with two noteImage nodes", async () => {
    let n = 0;
    mocks.storeUploadedBytes.mockImplementation(async (args) => {
      n += 1;
      return {
        ok: true,
        attachmentId: `att${n}`,
        storageKey: `attachments/w1/t1/att${n}/${args.fileName}`,
        size: args.bytes.byteLength,
      };
    });
    mocks.createComment.mockResolvedValue({ ok: true, commentId: "c9" });

    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "Two screenshots",
      images: [
        { dataBase64: b64(PNG), alt: "before" },
        { dataBase64: b64(PNG) },
      ],
    });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.text).commentId).toBe("c9");

    expect(mocks.storeUploadedBytes).toHaveBeenCalledTimes(2);
    expect(mocks.storeUploadedBytes.mock.calls[0][0]).toMatchObject({
      workspaceId: "w1",
      taskId: "t1",
      fileName: "image-1.png",
      mimeType: "image/png",
    });
    expect(mocks.storeUploadedBytes.mock.calls[1][0].fileName).toBe(
      "image-2.png"
    );

    const [, taskId, input] = mocks.createComment.mock.calls[0];
    expect(taskId).toBe("t1");
    expect(input.inlineImages).toHaveLength(2);
    expect(input.inlineImages[0]).toMatchObject({
      attachmentId: "att1",
      storageKey: "attachments/w1/t1/att1/image-1.png",
      fileName: "image-1.png",
      mimeType: "image/png",
      alt: "before",
    });
    const images = input.body.content.filter(
      (node: { type: string }) => node.type === "noteImage"
    );
    expect(images).toHaveLength(2);
    expect(images[0].attrs).toEqual({
      fileKey: "attachments/w1/t1/att1/image-1.png",
      attachmentId: "att1",
      alt: "before",
    });
    // The images come after the text, at the top level.
    expect(input.body.content[0].type).toBe("paragraph");
    expect(input.body.content.at(-1).type).toBe("noteImage");
    expect(mocks.deleteStoredFiles).not.toHaveBeenCalled();
  });

  it("names the file from the sniffed type, not from anything the client sent", async () => {
    mocks.storeUploadedBytes.mockResolvedValue({
      ok: true,
      attachmentId: "a",
      storageKey: "attachments/w1/t1/a/image-1.jpg",
      size: 6,
    });
    mocks.createComment.mockResolvedValue({ ok: true, commentId: "c" });
    await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "x",
      images: [{ dataBase64: b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]) }],
    });
    expect(mocks.storeUploadedBytes.mock.calls[0][0]).toMatchObject({
      fileName: "image-1.jpg",
      mimeType: "image/jpeg",
    });
  });

  it("deletes the files already stored when a later upload fails", async () => {
    mocks.storeUploadedBytes
      .mockResolvedValueOnce({
        ok: true,
        attachmentId: "att1",
        storageKey: "attachments/w1/t1/att1/image-1.png",
        size: 12,
      })
      .mockResolvedValueOnce({
        error: "Could not store the file.",
        code: "storage",
      });
    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "x",
      images: [{ dataBase64: b64(PNG) }, { dataBase64: b64(PNG) }],
    });
    expect(res.isError).toBe(true);
    expect(mocks.deleteStoredFiles).toHaveBeenCalledWith([
      "attachments/w1/t1/att1/image-1.png",
    ]);
    expect(mocks.createComment).not.toHaveBeenCalled();
  });

  it("leaves cleanup to createComment when it fails", async () => {
    mocks.storeUploadedBytes.mockResolvedValue({
      ok: true,
      attachmentId: "att1",
      storageKey: "attachments/w1/t1/att1/image-1.png",
      size: 12,
    });
    mocks.createComment.mockResolvedValue({
      error: "Could not post the comment.",
    });
    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "x",
      images: [{ dataBase64: b64(PNG) }],
    });
    expect(res).toMatchObject({
      isError: true,
      text: "Could not post the comment.",
    });
  });

  it("deletes stored files if something throws before createComment", async () => {
    mocks.storeUploadedBytes.mockResolvedValue({
      ok: true,
      attachmentId: "att1",
      storageKey: "attachments/w1/t1/att1/image-1.png",
      size: 12,
    });
    mocks.createComment.mockRejectedValue(new Error("boom"));
    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "x",
      images: [{ dataBase64: b64(PNG) }],
    });
    expect(res.isError).toBe(true);
    expect(mocks.deleteStoredFiles).toHaveBeenCalledWith([
      "attachments/w1/t1/att1/image-1.png",
    ]);
  });

  it("counts every image against the upload limit", async () => {
    mocks.storeUploadedBytes.mockResolvedValue({
      ok: true,
      attachmentId: "a",
      storageKey: "attachments/w1/t1/a/image-1.png",
      size: 12,
    });
    mocks.createComment.mockResolvedValue({ ok: true, commentId: "c" });
    await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "x",
      images: [{ dataBase64: b64(PNG) }, { dataBase64: b64(PNG) }],
    });
    // Two images cost two uploads, in the shared per-user upload bucket.
    expect(mocks.consumeRateLimits).toHaveBeenCalledWith([
      { key: "task-attachment:u1", limit: 60, windowMs: 60_000, cost: 2 },
    ]);
  });

  it("stops when the upload limit is reached", async () => {
    mocks.consumeRateLimits.mockImplementation(
      async (checks: { key: string }[]) =>
        checks.map((c) => ({
          key: c.key,
          ok: !c.key.startsWith("task-attachment:"),
          retryAfter: 30,
        }))
    );
    const res = await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "x",
      images: [{ dataBase64: b64(PNG) }],
    });
    expect(res.isError).toBe(true);
    expect(mocks.storeUploadedBytes).not.toHaveBeenCalled();
  });
});

describe("upload_attachment", () => {
  it("sanitises the name and stores a non-inline file", async () => {
    mocks.uploadAttachment.mockResolvedValue({
      ok: true,
      attachment: { id: "a1", fileName: "my_report_.txt", fileSize: 5 },
    });
    const res = await call(writeActor, "upload_attachment", {
      taskId: "t1",
      fileName: "my report?.txt",
      dataBase64: Buffer.from("hello").toString("base64"),
    });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.text)).toEqual({
      attachmentId: "a1",
      fileName: "my_report_.txt",
      size: 5,
    });
    const [, taskId, input] = mocks.uploadAttachment.mock.calls[0];
    expect(taskId).toBe("t1");
    expect(input.inline).toBe(false);
    expect(input.fileName).toBe("my_report_.txt");
    expect(input.mimeType).toBe("text/plain");
    expect(mocks.consumeRateLimits).toHaveBeenCalledWith([
      { key: "task-attachment:u1", limit: 60, windowMs: 60_000, cost: 1 },
    ]);
  });

  it("replaces a dots-only name with file", async () => {
    mocks.uploadAttachment.mockResolvedValue({
      ok: true,
      attachment: { id: "a1", fileName: "file", fileSize: 1 },
    });
    await call(writeActor, "upload_attachment", {
      taskId: "t1",
      fileName: "..",
      dataBase64: "YQ==",
    });
    expect(mocks.uploadAttachment.mock.calls[0][2].fileName).toBe("file");
  });

  it("never labels active content types", async () => {
    mocks.uploadAttachment.mockResolvedValue({
      ok: true,
      attachment: { id: "a1", fileName: "x.svg", fileSize: 1 },
    });
    await call(writeActor, "upload_attachment", {
      taskId: "t1",
      fileName: "x.svg",
      dataBase64: b64(SVG),
    });
    expect(mocks.uploadAttachment.mock.calls[0][2].mimeType).toBe(
      "application/octet-stream"
    );
  });

  it("refuses bad base64 and oversized files", async () => {
    const bad = await call(writeActor, "upload_attachment", {
      taskId: "t1",
      fileName: "a.bin",
      dataBase64: "###",
    });
    expect(bad.isError).toBe(true);
    const big = await call(writeActor, "upload_attachment", {
      taskId: "t1",
      fileName: "a.bin",
      dataBase64: "A".repeat(13_981_032),
    });
    expect(big.isError).toBe(true);
    expect(mocks.uploadAttachment).not.toHaveBeenCalled();
  });
});

// ─── Phase 5 ──────────────────────────────────────────────────────────────────

const card = {
  id: "nt1",
  seqNumber: 42,
  title: "New task",
  priority: "HIGH",
  dueDateStart: null,
  dueDateEnd: "2026-11-05",
  status: { id: "st1", name: "To do", type: "OPEN" },
  list: { id: "l1", name: "Backlog" },
  project: { id: "s1", name: "Web" },
  workspace: { id: "w1", name: "Acme" },
};

type Doc = {
  content: { type: string; content?: { type: string; attrs?: unknown }[] }[];
};

describe("paging shape", () => {
  it("list_my_tasks and search_tasks return { items, nextCursor }", async () => {
    mocks.listMyTasks.mockResolvedValue({
      ok: true,
      tasks: [],
      nextCursor: null,
    });
    const mine = JSON.parse((await call(writeActor, "list_my_tasks", {})).text);
    expect(mine).toEqual({ items: [], nextCursor: null });

    mocks.searchTasks.mockResolvedValue({
      ok: true,
      tasks: [],
      nextCursor: "next-page",
    });
    const res = await call(writeActor, "search_tasks", {
      workspaceId: "w1",
      query: "bug",
      cursor: "prev",
    });
    expect(JSON.parse(res.text)).toEqual({
      items: [],
      nextCursor: "next-page",
    });
    expect(mocks.searchTasks).toHaveBeenCalledWith(
      writeActor,
      expect.objectContaining({ cursor: "prev", limit: 25 })
    );
  });

  it("every new list tool returns { items, nextCursor }", async () => {
    mocks.listProjects.mockResolvedValue({
      ok: true,
      items: [{ id: "s1" }],
      nextCursor: "p2",
    });
    mocks.listLists.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    });
    mocks.listMembers.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: "m2",
    });
    mocks.listNotifications.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    });

    expect(
      JSON.parse((await call(readActor, "list_projects", { cursor: "c" })).text)
    ).toEqual({
      items: [{ id: "s1" }],
      nextCursor: "p2",
    });
    expect(mocks.listProjects).toHaveBeenCalledWith(readActor, {
      workspaceId: undefined,
      includeArchived: false,
      cursor: "c",
      limit: undefined,
    });
    expect(
      JSON.parse(
        (await call(readActor, "list_lists", { projectId: "s1" })).text
      )
    ).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(
      JSON.parse(
        (
          await call(readActor, "list_members", {
            workspaceId: "w1",
            query: "da",
          })
        ).text
      )
    ).toEqual({ items: [], nextCursor: "m2" });
    expect(
      JSON.parse((await call(readActor, "list_notifications", {})).text)
    ).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(mocks.listNotifications).toHaveBeenCalledWith(
      readActor,
      expect.objectContaining({ unreadOnly: true })
    );
  });

  it("list_notifications adds the task number and url", async () => {
    mocks.listNotifications.mockResolvedValue({
      ok: true,
      nextCursor: null,
      items: [
        {
          id: "n1",
          triggerType: "task_assigned",
          title: "Dana assigned you",
          body: null,
          isRead: false,
          createdAt: new Date("2026-10-01T00:00:00Z"),
          workspaceId: "w1",
          task: { id: "t1", seqNumber: 9 },
        },
        {
          id: "n2",
          triggerType: "role_changed",
          title: "Role",
          body: null,
          isRead: false,
          createdAt: new Date("2026-10-01T00:00:00Z"),
          workspaceId: "w1",
          task: null,
        },
      ],
    });
    const data = JSON.parse(
      (await call(readActor, "list_notifications", {})).text
    );
    expect(data.items[0]).toMatchObject({
      id: "n1",
      type: "task_assigned",
      task: { id: "t1", number: 9, url: "https://app.example.com/w1/task/t1" },
    });
    expect(data.items[1].task).toBeNull();
  });

  it("get_current_sprint nests the task page", async () => {
    mocks.getCurrentSprint.mockResolvedValue({
      ok: true,
      workspaceId: "w1",
      sprint: {
        id: "sp1",
        name: "Sprint 1",
        goal: null,
        startDate: null,
        endDate: null,
        status: "ACTIVE",
      },
      upcoming: null,
      tasks: {
        items: [
          {
            id: "t1",
            seqNumber: 3,
            title: "A",
            priority: "LOW",
            statusId: "st",
            statusName: "Todo",
            statusType: "OPEN",
            listId: "l1",
            dueDateStart: null,
            dueDateEnd: null,
            storyPoints: 5,
            assignees: [],
          },
        ],
        nextCursor: "t2",
      },
    });
    const data = JSON.parse(
      (await call(readActor, "get_current_sprint", { projectId: "s1" })).text
    );
    expect(data.sprint.name).toBe("Sprint 1");
    expect(data.tasks.nextCursor).toBe("t2");
    expect(data.tasks.items[0]).toMatchObject({
      number: 3,
      storyPoints: 5,
      url: "https://app.example.com/w1/task/t1",
    });
  });

  it("get_task passes commentsCursor and returns commentsNextCursor", async () => {
    mocks.getTask.mockResolvedValue({
      task: {
        id: "t1",
        seqNumber: 1,
        workspaceId: "w1",
        spaceId: "s1",
        listId: "l1",
        isArchived: false,
        title: "T",
        description: null,
        statusId: null,
        priority: "NONE",
        dueDateStart: null,
        dueDateEnd: null,
      },
      statuses: [],
      canEdit: true,
      assignees: [],
      tags: [],
      parentTask: null,
      subtasks: [],
      comments: [],
      commentsNextCursor: "older",
      attachments: [],
    });
    const res = await call(readActor, "get_task", {
      taskId: "t1",
      commentsCursor: "c1",
    });
    expect(JSON.parse(res.text).commentsNextCursor).toBe("older");
    expect(mocks.getTask).toHaveBeenCalledWith(
      readActor,
      { taskId: "t1" },
      { commentsCursor: "c1" }
    );
  });

  it("maps an invalid cursor to a fixed message", async () => {
    mocks.listMembers.mockResolvedValue({ error: "Invalid cursor" });
    const res = await call(readActor, "list_members", {
      workspaceId: "w1",
      cursor: "bad",
    });
    expect(res).toMatchObject({ isError: true, text: "Invalid cursor" });
  });

  it("rejects an oversized limit before reaching the service", async () => {
    const res = await call(readActor, "list_projects", { limit: 500 });
    expect(res.isError).toBe(true);
    expect(mocks.listProjects).not.toHaveBeenCalled();
  });
});

describe("write rate limits", () => {
  beforeEach(() => {
    mocks.completeTask.mockResolvedValue({
      ok: true,
      status: { id: "c", name: "Done", type: "CLOSED" },
      changed: true,
    });
    mocks.getListLocation.mockResolvedValue({
      listId: "l1",
      workspaceId: "w1",
      spaceId: "s1",
    });
    mocks.createTask.mockResolvedValue({ taskId: "nt1" });
    mocks.getTaskCard.mockResolvedValue({ ok: true, card });
  });

  it("counts a write once against mcp:write:<userId> (60 a minute)", async () => {
    await call(writeActor, "complete_task", { taskId: "t1" });
    expect(mocks.consumeRateLimits).toHaveBeenCalledWith([
      { key: "mcp:write:u1", limit: 60, windowMs: 60_000 },
    ]);
  });

  it("counts creates against mcp:create:<userId> too (30 a minute)", async () => {
    await call(writeActor, "create_task", { listId: "l1", title: "T" });
    expect(mocks.consumeRateLimits).toHaveBeenCalledWith([
      { key: "mcp:write:u1", limit: 60, windowMs: 60_000 },
      { key: "mcp:create:u1", limit: 30, windowMs: 60_000 },
    ]);
  });

  it("does not count reads", async () => {
    mocks.listProjects.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    });
    await call(writeActor, "list_projects", {});
    expect(mocks.consumeRateLimits).not.toHaveBeenCalled();
  });

  it("refuses with the seconds to wait and does nothing", async () => {
    mocks.consumeRateLimits.mockResolvedValue([
      { key: "mcp:write:u1", ok: true, retryAfter: 0 },
      { key: "mcp:create:u1", ok: false, retryAfter: 12 },
    ]);
    const res = await call(writeActor, "create_task", {
      listId: "l1",
      title: "T",
    });
    expect(res).toMatchObject({
      isError: true,
      text: "Rate limit reached, try again in 12 seconds",
    });
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("fails closed for writes when the limiter errors, but reads still work", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.consumeRateLimits.mockRejectedValue(new Error("db down"));
    const write = await call(writeActor, "complete_task", { taskId: "t1" });
    expect(write.isError).toBe(true);
    expect(write.text).toContain("rate limiter is unavailable");
    expect(mocks.completeTask).not.toHaveBeenCalled();

    mocks.listProjects.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    });
    const read = await call(writeActor, "list_projects", {});
    expect(read.isError).toBe(false);
  });
});

describe("create_task", () => {
  beforeEach(() => {
    mocks.getListLocation.mockResolvedValue({
      listId: "l1",
      workspaceId: "w1",
      spaceId: "s1",
    });
    mocks.createTask.mockResolvedValue({ taskId: "nt1" });
    mocks.getTaskCard.mockResolvedValue({ ok: true, card });
  });

  it("creates in the list's project and returns the task card", async () => {
    const res = await call(writeActor, "create_task", {
      listId: "l1",
      title: "New task",
      description: "Some **text**\n\n- [ ] one\n- [x] two",
      priority: "HIGH",
      startDate: "2026-11-01",
      dueDate: "2026-11-05",
      assigneeIds: ["u2"],
    });
    expect(res.isError).toBe(false);
    const data = JSON.parse(res.text);
    expect(data).toMatchObject({
      id: "nt1",
      number: 42,
      numberLabel: "#42",
      url: "https://app.example.com/w1/task/nt1",
      project: { id: "s1" },
    });
    const [, input] = mocks.createTask.mock.calls[0];
    expect(input).toMatchObject({
      workspaceId: "w1",
      spaceId: "s1",
      listId: "l1",
      title: "New task",
      priority: "HIGH",
      dueDateStart: "2026-11-01",
      dueDateEnd: "2026-11-05",
      assigneeIds: ["u2"],
    });
    // The description is a description-mode document with a task list.
    expect((input.description as Doc).content.map((n) => n.type)).toEqual([
      "paragraph",
      "taskList",
    ]);
  });

  it("turns <@id> into a mention only for users the service allows", async () => {
    mocks.resolveProjectUsers.mockResolvedValue(
      new Map([["inside", { id: "inside", name: "Ina" }]])
    );
    await call(writeActor, "create_task", {
      listId: "l1",
      title: "T",
      description: "cc <@inside> and <@outsider|Olga>",
    });
    expect(mocks.resolveProjectUsers).toHaveBeenCalledWith("w1", "s1", [
      "inside",
      "outsider",
    ]);
    const doc = mocks.createTask.mock.calls[0][1].description as {
      content: {
        content: { type: string; attrs?: { id: string }; text?: string }[];
      }[];
    };
    const inline = doc.content[0].content;
    expect(inline.filter((n) => n.type === "mention")).toEqual([
      {
        type: "mention",
        attrs: { id: "inside", label: "Ina", mentionSuggestionChar: "@" },
      },
    ]);
    expect(inline.map((n) => n.text ?? "").join("")).toContain("@Olga");
  });

  it("reports an unknown or archived list", async () => {
    mocks.getListLocation.mockResolvedValue(null);
    const res = await call(writeActor, "create_task", {
      listId: "nope",
      title: "T",
    });
    expect(res.isError).toBe(true);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("passes the task-limit error through with its fixed message", async () => {
    const message =
      "Workspace task limit reached (10). Ask a workspace admin to raise the limit, or delete tasks to free up space. Archived tasks still count.";
    mocks.createTask.mockResolvedValue({
      error: message,
      code: "TASK_LIMIT_REACHED",
    });
    const res = await call(writeActor, "create_task", {
      listId: "l1",
      title: "T",
    });
    expect(res).toMatchObject({ isError: true, text: message });
  });

  it("does not pass an unknown error that merely carries the code", async () => {
    mocks.createTask.mockResolvedValue({
      error: 'relation "task" does not exist',
      code: "TASK_LIMIT_REACHED",
    });
    const res = await call(writeActor, "create_task", {
      listId: "l1",
      title: "T",
    });
    expect(res.text).toBe("Something went wrong. Try again later.");
  });

  it("maps validation errors to fixed messages", async () => {
    mocks.createTask.mockResolvedValue({ error: "Invalid due date" });
    const res = await call(writeActor, "create_task", {
      listId: "l1",
      title: "T",
    });
    expect(res.text).toContain("YYYY-MM-DD");
  });

  it("rejects bad dates and a blank title before the service", async () => {
    const date = await call(writeActor, "create_task", {
      listId: "l1",
      title: "T",
      dueDate: "11/05/2026",
    });
    expect(date.isError).toBe(true);
    const title = await call(writeActor, "create_task", {
      listId: "l1",
      title: "   ",
    });
    expect(title.isError).toBe(true);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});

describe("create_subtask", () => {
  it("creates under the parent and looks mentions up in the parent's project", async () => {
    mocks.resolveTaskContext.mockResolvedValue({
      workspaceId: "w1",
      spaceId: "s1",
    });
    mocks.createSubtask.mockResolvedValue({ taskId: "sub1" });
    mocks.getTaskCard.mockResolvedValue({
      ok: true,
      card: { ...card, id: "sub1" },
    });
    const res = await call(writeActor, "create_subtask", {
      parentTaskId: "t1",
      title: "Sub",
      description: "see <@u2>",
    });
    expect(res.isError).toBe(false);
    expect(mocks.resolveProjectUsers).toHaveBeenCalledWith("w1", "s1", ["u2"]);
    expect(mocks.createSubtask.mock.calls[0][1]).toMatchObject({
      parentTaskId: "t1",
      title: "Sub",
    });
  });

  it("says when the parent cannot be used", async () => {
    mocks.resolveTaskContext.mockResolvedValue(null);
    const res = await call(writeActor, "create_subtask", {
      parentTaskId: "t1",
      title: "Sub",
    });
    expect(res).toMatchObject({ isError: true, text: "Parent task not found" });
    expect(mocks.createSubtask).not.toHaveBeenCalled();
  });
});

describe("update_task", () => {
  beforeEach(() => {
    mocks.resolveTaskContext.mockResolvedValue({
      workspaceId: "w1",
      spaceId: "s1",
    });
    mocks.updateTask.mockResolvedValue({ ok: true });
    mocks.getTaskCard.mockResolvedValue({ ok: true, card });
  });

  it("needs at least one field", async () => {
    const res = await call(writeActor, "update_task", { taskId: "t1" });
    expect(res.isError).toBe(true);
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });

  it("sends only the given fields; null clears a date", async () => {
    await call(writeActor, "update_task", {
      taskId: "t1",
      dueDate: null,
      priority: "LOW",
    });
    expect(mocks.updateTask).toHaveBeenCalledWith(writeActor, "t1", {
      title: undefined,
      description: undefined,
      priority: "LOW",
      dueDateStart: undefined,
      dueDateEnd: null,
    });
  });

  it("keeps attachments of the same task and drops unknown ids to text", async () => {
    mocks.listDescriptionAttachments.mockResolvedValue(
      new Map([
        [
          "att1",
          {
            id: "att1",
            fileKey: "attachments/w1/t1/att1/shot.png",
            fileName: "shot.png",
            mimeType: "image/png",
            size: 10,
          },
        ],
      ])
    );
    await call(writeActor, "update_task", {
      taskId: "t1",
      description: "![shot](attachment:att1)\n\n![gone](attachment:other)",
    });
    expect(mocks.listDescriptionAttachments).toHaveBeenCalledWith(
      writeActor,
      "t1",
      ["att1", "other"]
    );
    const doc = mocks.updateTask.mock.calls[0][2].description as Doc;
    expect(doc.content[0]).toEqual({
      type: "noteImage",
      attrs: {
        fileKey: "attachments/w1/t1/att1/shot.png",
        attachmentId: "att1",
        alt: "shot",
      },
    });
    expect(JSON.stringify(doc)).not.toContain('"other"');
  });

  it("an empty description clears it with an empty document", async () => {
    await call(writeActor, "update_task", { taskId: "t1", description: "" });
    expect(mocks.updateTask.mock.calls[0][2].description).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("maps errors to fixed messages", async () => {
    mocks.updateTask.mockResolvedValue({ error: "Forbidden" });
    const res = await call(writeActor, "update_task", {
      taskId: "t1",
      title: "x",
    });
    expect(res.text).toBe(
      "Task not found, or you do not have permission to do this."
    );
  });
});

describe("add_comment mentions", () => {
  it("mentions only users the service allows for this task", async () => {
    mocks.resolveTaskMentionTargets.mockResolvedValue(
      new Map([["u2", { id: "u2", name: "Eli" }]])
    );
    mocks.createComment.mockResolvedValue({ ok: true, commentId: "c1" });
    await call(writeActor, "add_comment", {
      taskId: "t1",
      text: "hi <@u2> and <@u3>",
    });
    expect(mocks.resolveTaskMentionTargets).toHaveBeenCalledWith(
      writeActor,
      "t1",
      ["u2", "u3"]
    );
    const body = mocks.createComment.mock.calls[0][2].body as {
      content: { content: { type: string; attrs?: { id: string } }[] }[];
    };
    expect(
      body.content[0].content
        .filter((n) => n.type === "mention")
        .map((n) => n.attrs?.id)
    ).toEqual(["u2"]);
  });

  it("a bare @name stays plain text and triggers no lookup", async () => {
    mocks.createComment.mockResolvedValue({ ok: true, commentId: "c1" });
    await call(writeActor, "add_comment", { taskId: "t1", text: "hi @Eli" });
    expect(mocks.resolveTaskMentionTargets).not.toHaveBeenCalled();
    expect(
      JSON.stringify(mocks.createComment.mock.calls[0][2].body)
    ).not.toContain("mention");
  });
});

describe("mark_notifications_read", () => {
  it("passes ids and returns the count", async () => {
    mocks.markNotificationsRead.mockResolvedValue({ ok: true, marked: 2 });
    const res = await call(writeActor, "mark_notifications_read", {
      ids: ["n1", "n2"],
    });
    expect(JSON.parse(res.text)).toEqual({ marked: 2 });
    expect(mocks.markNotificationsRead).toHaveBeenCalledWith(writeActor, {
      ids: ["n1", "n2"],
      all: undefined,
      workspaceId: undefined,
    });
  });

  it("maps the missing-argument error", async () => {
    mocks.markNotificationsRead.mockResolvedValue({
      error: "Provide ids, or all: true.",
    });
    const res = await call(writeActor, "mark_notifications_read", {});
    expect(res).toMatchObject({
      isError: true,
      text: "Provide ids, or all: true.",
    });
  });
});
