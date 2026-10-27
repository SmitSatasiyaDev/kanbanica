import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/services/actor";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  inserts: [] as unknown[],
  perm: true,
  membership: { role: "MEMBER", status: "ACTIVE" } as {
    role: string;
    status: string;
  } | null,
  resolveTaskContext: vi.fn(),
  writeActivityLog: vi.fn(),
  refreshWorkspace: vi.fn(),
  createNotifications: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  del: vi.fn(),
  insertFails: false,
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
  storage: { upload: h.upload, download: h.download, delete: h.del },
}));
vi.mock("@/lib/permissions", () => ({
  canAccessSpace: vi.fn(async () => h.perm),
  requireViewAccess: vi.fn(async () =>
    h.perm ? null : { error: "Forbidden" }
  ),
  getWorkspaceMembership: vi.fn(async () => h.membership),
}));
vi.mock("@/lib/services/task-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/task-context")>();
  return { ...actual, resolveTaskContext: h.resolveTaskContext };
});

function selectChain() {
  const rows = h.selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "leftJoin", "innerJoin", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(selectChain),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        if (h.insertFails) {
          return Promise.reject(new Error("boom"));
        }
        h.inserts.push(v);
        return Promise.resolve();
      },
    })),
  },
}));

import {
  readAttachment,
  safeStorageName,
  storeUploadedBytes,
  uploadAttachment,
} from "@/lib/services/attachment-service";

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

const ctx = {
  taskId: "t1",
  workspaceId: "ws-1",
  spaceId: "sp-1",
  listId: "l1",
  statusId: "s",
  title: "Task",
};

const input = (over: Record<string, unknown> = {}) => ({
  bytes: new Uint8Array([1, 2, 3]),
  fileName: "my file (1).png",
  mimeType: "image/png",
  inline: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.inserts.length = 0;
  h.perm = true;
  h.insertFails = false;
  h.membership = { role: "MEMBER", status: "ACTIVE" };
  h.resolveTaskContext.mockResolvedValue(ctx);
});

describe("safeStorageName", () => {
  it("keeps [a-zA-Z0-9._-] and replaces the rest", () => {
    expect(safeStorageName("my file (1).png")).toBe("my_file__1_.png");
  });
  it("replaces names made only of dots (or empty) with 'file'", () => {
    expect(safeStorageName("..")).toBe("file");
    expect(safeStorageName("")).toBe("file");
  });
});

describe("uploadAttachment", () => {
  it("refuses a GUEST and stores nothing", async () => {
    h.membership = { role: "GUEST", status: "ACTIVE" };
    const res = await uploadAttachment(
      actor({ source: "web", tokenId: undefined }),
      "t1",
      input()
    );
    expect(res).toEqual({ error: "Forbidden", code: "forbidden" });
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses a non-member and someone without View access", async () => {
    h.membership = null;
    expect(await uploadAttachment(actor(), "t1", input())).toMatchObject({
      code: "forbidden",
    });
    h.membership = { role: "MEMBER", status: "ACTIVE" };
    h.perm = false;
    expect(await uploadAttachment(actor(), "t1", input())).toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses a read-only token", async () => {
    expect(
      await uploadAttachment(actor({ scope: "read" }), "t1", input())
    ).toEqual({ error: "This token is read-only.", code: "read_only" });
    expect(h.resolveTaskContext).not.toHaveBeenCalled();
  });

  it("uses the actor-aware context", async () => {
    h.resolveTaskContext.mockResolvedValue(null);
    const a = actor({ workspaceId: "ws-other" });
    expect(await uploadAttachment(a, "t1", input())).toEqual({
      error: "Task not found",
      code: "not_found",
    });
    expect(h.resolveTaskContext).toHaveBeenCalledWith("t1", a);
  });

  it("refuses a file over 10 MB", async () => {
    const res = await uploadAttachment(
      actor(),
      "t1",
      input({ bytes: new Uint8Array(10 * 1024 * 1024 + 1) })
    );
    expect(res).toMatchObject({ code: "too_large" });
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("stores a regular file: key format, row, activity with source, notification", async () => {
    h.selectQueue.push([{ userId: "u1" }, { userId: "u2" }]);
    const res = await uploadAttachment(actor(), "t1", input());

    expect(res).toMatchObject({ ok: true });
    const att = (res as { attachment: { id: string; key: string } }).attachment;
    expect(att.key).toBe(`attachments/ws-1/t1/${att.id}/my_file__1_.png`);
    expect(h.upload).toHaveBeenCalledWith(att.key, expect.any(Uint8Array), {
      contentType: "image/png",
    });
    expect(h.inserts[0]).toMatchObject({
      id: att.id,
      taskId: "t1",
      commentId: null,
      uploadedBy: "u1",
      fileName: "my file (1).png",
      fileUrl: att.key,
      fileSize: 3,
      isInline: false,
    });
    expect(h.writeActivityLog).toHaveBeenCalledWith(
      "t1",
      "u1",
      "attachment_uploaded",
      { file_name: "my file (1).png", file_size: 3, source: "mcp" }
    );
    expect(h.createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ["u2"],
        triggerType: "attachment_added",
      })
    );
    expect(h.refreshWorkspace).toHaveBeenCalledWith("ws-1", undefined, {
      taskId: "t1",
    });
  });

  it("inline files make no activity, notification or refresh", async () => {
    const res = await uploadAttachment(
      actor({ source: "web", tokenId: undefined }),
      "t1",
      input({ inline: true, commentId: "c1" })
    );
    expect(res).toMatchObject({
      ok: true,
      attachment: { isInline: true, commentId: "c1" },
    });
    expect(h.writeActivityLog).not.toHaveBeenCalled();
    expect(h.createNotifications).not.toHaveBeenCalled();
    expect(h.refreshWorkspace).not.toHaveBeenCalled();
  });

  it("removes the stored file when the row cannot be written", async () => {
    h.insertFails = true;
    const res = await uploadAttachment(actor(), "t1", input());
    expect(res).toMatchObject({ code: "storage" });
    expect(h.del).toHaveBeenCalledTimes(1);
  });
});

describe("storeUploadedBytes", () => {
  it("only uploads and returns the generated id and key", async () => {
    const res = await storeUploadedBytes({
      workspaceId: "ws-1",
      taskId: "t1",
      bytes: new Uint8Array([1]),
      fileName: "image-1.png",
      mimeType: "image/png",
    });
    expect(res).toMatchObject({ ok: true, size: 1 });
    const r = res as { attachmentId: string; storageKey: string };
    expect(r.storageKey).toBe(
      `attachments/ws-1/t1/${r.attachmentId}/image-1.png`
    );
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.inserts).toHaveLength(0);
  });

  it("reports a storage failure instead of throwing", async () => {
    h.upload.mockRejectedValueOnce(new Error("down"));
    expect(
      await storeUploadedBytes({
        workspaceId: "ws-1",
        taskId: "t1",
        bytes: new Uint8Array([1]),
        fileName: "a.png",
        mimeType: "image/png",
      })
    ).toMatchObject({ code: "storage" });
  });
});

describe("readAttachment", () => {
  const row = {
    taskId: "t1",
    fileUrl: "attachments/ws-1/t1/a1/x.png",
    fileName: "x.png",
    mimeType: "image/png",
    fileSize: 3,
  };

  it("returns the bytes after a View check, also for a read-only token", async () => {
    h.selectQueue.push([row]);
    h.download.mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const a = actor({ scope: "read" });
    const res = await readAttachment(a, "a1");

    expect(res).toMatchObject({
      ok: true,
      mimeType: "image/png",
      fileName: "x.png",
      size: 3,
    });
    expect((res as { bytes: Uint8Array }).bytes).toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(h.resolveTaskContext).toHaveBeenCalledWith("t1", a);
  });

  it("says 'Attachment not found' for a missing row, no task access or no View", async () => {
    expect(await readAttachment(actor(), "nope")).toEqual({
      error: "Attachment not found",
    });

    h.selectQueue.push([row]);
    h.resolveTaskContext.mockResolvedValue(null);
    expect(await readAttachment(actor(), "a1")).toEqual({
      error: "Attachment not found",
    });

    h.selectQueue.push([row]);
    h.resolveTaskContext.mockResolvedValue(ctx);
    h.perm = false;
    expect(await readAttachment(actor(), "a1")).toEqual({
      error: "Attachment not found",
    });
    expect(h.download).not.toHaveBeenCalled();
  });

  it("refuses a file over maxBytes before downloading it", async () => {
    h.selectQueue.push([{ ...row, fileSize: 6_000_000 }]);
    expect(
      await readAttachment(actor(), "a1", { maxBytes: 5_000_000 })
    ).toEqual({
      error: "File is too large to return.",
      fileName: "x.png",
      size: 6_000_000,
    });
    expect(h.download).not.toHaveBeenCalled();
  });

  it("applies maxNonImageBytes to files that are not images only", async () => {
    h.selectQueue.push([
      {
        ...row,
        mimeType: "application/pdf",
        fileName: "a.pdf",
        fileSize: 6_000_000,
      },
    ]);
    expect(
      await readAttachment(actor(), "a1", {
        maxBytes: 10_000_000,
        maxNonImageBytes: 5_000_000,
      })
    ).toEqual({
      error: "File is too large to return.",
      fileName: "a.pdf",
      size: 6_000_000,
    });
    expect(h.download).not.toHaveBeenCalled();

    // An image of the same size is within maxBytes, so it is downloaded.
    h.selectQueue.push([{ ...row, fileSize: 6_000_000 }]);
    h.download.mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    expect(
      await readAttachment(actor(), "a1", {
        maxBytes: 10_000_000,
        maxNonImageBytes: 5_000_000,
      })
    ).toMatchObject({ ok: true });
  });
});
