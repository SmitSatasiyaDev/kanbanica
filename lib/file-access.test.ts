import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, membershipMock, accessibleMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  membershipMock: vi.fn(),
  accessibleMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { select: selectMock } }));
vi.mock("@/lib/permissions", () => ({
  getWorkspaceMembership: membershipMock,
  getAccessibleSpaceIds: accessibleMock,
}));

import { canReadStoredFile } from "@/lib/file-access";

// Makes db.select() return a chain that resolves to `rows` at .limit().
function queueRows(...results: unknown[][]) {
  for (const rows of results) {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "leftJoin", "where"]) {
      chain[m] = () => chain;
    }
    chain.limit = () => Promise.resolve(rows);
    selectMock.mockReturnValueOnce(chain);
  }
}

const ATT_KEY = "attachments/w1/t1/a1/file.png";

function attachmentRow(over: Record<string, unknown> = {}) {
  return {
    workspaceId: "w1",
    taskSpaceId: "s-task",
    listSpaceId: "s1",
    deletedAt: null,
    workspaceStatus: "ACTIVE",
    ...over,
  };
}

// accessibleMock(userId, workspaceId, archivedOnly?)
function spacesVisible(active: string[], archived: string[] = []) {
  accessibleMock.mockImplementation(
    async (_u: string, _w: string, archivedOnly?: boolean) =>
      archivedOnly ? archived : active
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("canReadStoredFile: key shape", () => {
  it("allows avatars for any signed-in user", async () => {
    expect(await canReadStoredFile("u1", "avatars/u2/abc.webp")).toBe(true);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it.each([
    "avatars/../attachments/w1/t1/a1/f.png",
    "attachments/w1/../w2/t/a/f.png",
    "/attachments/w1/t1/a1/f.png",
    "attachments\\w1\\t1\\a1\\f.png",
    "attachments//w1/t1/a1/f.png",
    "attachments/w1/t1/a1/",
    "",
  ])("refuses odd key %j", async (key) => {
    expect(await canReadStoredFile("u1", key)).toBe(false);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("does not treat dots inside a file name as traversal", async () => {
    // "report..final.pdf" and the sanitised "../../x" upload name are normal
    // file names, so the key goes on to the attachment lookup.
    for (const key of [
      "attachments/w1/t1/a1/report..final.pdf",
      "attachments/w1/t1/a1/.._.._report.html",
    ]) {
      selectMock.mockClear();
      queueRows([]);
      expect(await canReadStoredFile("u1", key)).toBe(false);
      expect(selectMock).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses a lone '.' segment", async () => {
    expect(await canReadStoredFile("u1", "attachments/w1/./t1/a1/f.png")).toBe(
      false
    );
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown prefix", async () => {
    expect(await canReadStoredFile("u1", "secrets/w1/file.png")).toBe(false);
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("canReadStoredFile: task attachments", () => {
  it("refuses when there is no attachment row", async () => {
    queueRows([]);
    expect(await canReadStoredFile("u1", ATT_KEY)).toBe(false);
  });

  it("refuses when the user cannot access the space", async () => {
    queueRows([attachmentRow()]);
    spacesVisible(["other"], ["other-archived"]);
    expect(await canReadStoredFile("u1", ATT_KEY)).toBe(false);
  });

  it("allows when the space is accessible", async () => {
    queueRows([attachmentRow()]);
    spacesVisible(["s1"]);
    expect(await canReadStoredFile("u1", ATT_KEY)).toBe(true);
  });

  it("allows an archived space the user can access", async () => {
    queueRows([attachmentRow()]);
    spacesVisible([], ["s1"]);
    expect(await canReadStoredFile("u1", ATT_KEY)).toBe(true);
  });

  it("uses the task's own space for a listless task", async () => {
    queueRows([attachmentRow({ listSpaceId: null, taskSpaceId: "s-task" })]);
    spacesVisible(["s-task"]);
    expect(await canReadStoredFile("u1", ATT_KEY)).toBe(true);
  });

  it("refuses when no space can be resolved", async () => {
    queueRows([attachmentRow({ listSpaceId: null, taskSpaceId: null })]);
    spacesVisible(["s1"]);
    expect(await canReadStoredFile("u1", ATT_KEY)).toBe(false);
  });

  it("refuses when the workspace is not active", async () => {
    queueRows([attachmentRow({ workspaceStatus: "DELETING" })]);
    spacesVisible(["s1"]);
    expect(await canReadStoredFile("u1", ATT_KEY)).toBe(false);
  });

  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["MEMBER", false],
    ["GUEST", false],
  ])("trashed task: %s -> %s", async (role, expected) => {
    queueRows([attachmentRow({ deletedAt: new Date() })]);
    spacesVisible(["s1"]);
    membershipMock.mockResolvedValue({ role });
    expect(await canReadStoredFile("u1", ATT_KEY)).toBe(expected);
  });

  it("trashed task: refuses a non-member", async () => {
    queueRows([attachmentRow({ deletedAt: new Date() })]);
    membershipMock.mockResolvedValue(null);
    expect(await canReadStoredFile("u1", ATT_KEY)).toBe(false);
  });
});

describe("canReadStoredFile: channel files", () => {
  const KEY = "channels/w1/abc.png";

  it("allows an active member", async () => {
    queueRows([{ id: "ca1" }], [{ status: "ACTIVE" }]);
    membershipMock.mockResolvedValue({ role: "MEMBER" });
    expect(await canReadStoredFile("u1", KEY)).toBe(true);
    expect(membershipMock).toHaveBeenCalledWith("u1", "w1");
  });

  it("refuses a non-member", async () => {
    queueRows([{ id: "ca1" }], [{ status: "ACTIVE" }]);
    membershipMock.mockResolvedValue(null);
    expect(await canReadStoredFile("u1", KEY)).toBe(false);
  });

  it("refuses when no attachment row exists", async () => {
    queueRows([]);
    membershipMock.mockResolvedValue({ role: "OWNER" });
    expect(await canReadStoredFile("u1", KEY)).toBe(false);
  });

  it("refuses when the workspace is not active", async () => {
    queueRows([{ id: "ca1" }], [{ status: "DELETING" }]);
    membershipMock.mockResolvedValue({ role: "OWNER" });
    expect(await canReadStoredFile("u1", KEY)).toBe(false);
  });
});
