import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMock, purgeMock } = vi.hoisted(() => ({
  findMock: vi.fn(),
  purgeMock: vi.fn(),
}));

vi.mock("@/lib/trash", () => ({
  findExpiredTrashedTaskIds: findMock,
  purgeTrashedTask: purgeMock,
}));

import {
  handleTrashAutoPurge,
  runTrashAutoPurge,
} from "@/lib/worker/handlers/trash-auto-purge";

const NOW = new Date("2026-10-05T12:00:00Z");

beforeEach(() => {
  findMock.mockReset();
  purgeMock.mockReset();
});

describe("runTrashAutoPurge", () => {
  it("queries by deletedAt cutoff (now − 30d) and purges with reason=retention", async () => {
    findMock.mockResolvedValueOnce(["a"]).mockResolvedValueOnce([]);
    purgeMock.mockResolvedValue({ status: "purged", rootId: "a", ids: ["a"] });

    await runTrashAutoPurge({ now: NOW });

    const cutoff = new Date("2026-09-05T12:00:00Z");
    expect(findMock.mock.calls[0][0].cutoff).toEqual(cutoff);
    expect(purgeMock).toHaveBeenCalledWith("a", {
      reason: "retention",
      cutoff,
    });
  });

  it("processes in batches until the eligible set is exhausted (keyset cursor)", async () => {
    findMock
      .mockResolvedValueOnce(["a", "b"])
      .mockResolvedValueOnce(["c"])
      .mockResolvedValueOnce([]);
    purgeMock.mockImplementation(async (id: string) => ({
      status: "purged",
      rootId: id,
      ids: [id],
    }));

    const stats = await runTrashAutoPurge({ batchSize: 2, now: NOW });

    expect(findMock.mock.calls.map((c) => c[0].afterId)).toEqual([
      undefined,
      "b",
      "c",
    ]);
    expect(findMock.mock.calls[0][0].limit).toBe(2);
    expect(stats).toMatchObject({ batches: 2, purged: 3, failed: 0 });
  });

  it("a failing task does not stop the remaining ones, and is counted", async () => {
    findMock.mockResolvedValueOnce(["a", "b", "c"]).mockResolvedValueOnce([]);
    purgeMock.mockImplementation(async (id: string) =>
      id === "a"
        ? { status: "failed", rootId: id, error: "storage down" }
        : { status: "purged", rootId: id, ids: [id, `${id}-sub`] }
    );

    const stats = await runTrashAutoPurge({ now: NOW });

    expect(purgeMock).toHaveBeenCalledTimes(3);
    expect(stats).toMatchObject({ purged: 4, failed: 1, skipped: 0 });
  });

  it("counts tasks skipped because they were restored / locked / already purged", async () => {
    findMock.mockResolvedValueOnce(["a"]).mockResolvedValueOnce([]);
    purgeMock.mockResolvedValue({ status: "skipped", rootId: "a" });
    expect(await runTrashAutoPurge({ now: NOW })).toMatchObject({
      purged: 0,
      skipped: 1,
    });
  });

  it("does nothing (no purge calls) when nothing has expired", async () => {
    findMock.mockResolvedValueOnce([]);
    const stats = await runTrashAutoPurge({ now: NOW });
    expect(purgeMock).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ batches: 0, purged: 0, timedOut: false });
  });

  it("stops when the time budget is exhausted; the next run catches up from deletedAt", async () => {
    findMock.mockResolvedValue(["a"]);
    const stats = await runTrashAutoPurge({ budgetMs: -1, now: NOW });
    expect(stats.timedOut).toBe(true);
    expect(findMock).not.toHaveBeenCalled();
  });

  it("is stateless: a later run after downtime simply re-queries (worker restart catch-up)", async () => {
    findMock.mockResolvedValueOnce(["old1", "old2"]).mockResolvedValueOnce([]);
    purgeMock.mockImplementation(async (id: string) => ({
      status: "purged",
      rootId: id,
      ids: [id],
    }));
    const later = new Date("2026-12-01T00:00:00Z"); // worker was offline for weeks
    const stats = await runTrashAutoPurge({ now: later });
    expect(stats.purged).toBe(2);
    expect(findMock.mock.calls[0][0].cutoff).toEqual(
      new Date("2026-11-01T00:00:00Z")
    );
  });
});

describe("handleTrashAutoPurge", () => {
  it("can be invoked directly (as pg-boss does)", async () => {
    findMock.mockResolvedValueOnce([]);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(handleTrashAutoPurge([])).resolves.toBeUndefined();
  });
});
