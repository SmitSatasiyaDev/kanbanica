import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { task } from "@/db/schema";
import {
  findExpiredTrashedTaskIds,
  purgeTasks,
  purgeTrashedTask,
  softDeleteTasks,
} from "@/lib/trash";

const { selectMock, transactionMock, storageDeleteMock, auditMock, events } =
  vi.hoisted(() => ({
    auditMock: vi.fn(),
    selectMock: vi.fn(),
    transactionMock: vi.fn(),
    storageDeleteMock: vi.fn(),
    events: [] as string[],
  }));

vi.mock("@/lib/db", () => ({
  db: { select: selectMock, transaction: transactionMock },
}));
vi.mock("@/lib/storage", () => ({ storage: { delete: storageDeleteMock } }));
vi.mock("@/lib/audit", () => ({ audit: auditMock }));

interface Chain extends PromiseLike<unknown[]> {
  for: (mode: string, cfg?: unknown) => Chain;
  from: () => Chain;
  limit: () => Chain;
  orderBy: () => Chain;
  where: (cond?: unknown) => Chain;
}

// Thenable stand-in for a Drizzle query builder. `onWhere` / `onFor` let a test
// inspect the condition and lock mode a query was built with.
function chain(
  result: unknown[],
  hooks: {
    onFor?: (m: string, c?: unknown) => void;
    onWhere?: (c: unknown) => void;
  } = {}
): Chain {
  const c: Chain = {
    from: () => c,
    where: (cond) => {
      hooks.onWhere?.(cond);
      return c;
    },
    orderBy: () => c,
    limit: () => c,
    for: (mode, cfg) => {
      hooks.onFor?.(mode, cfg);
      return c;
    },
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's thenable query builder
    then: (ok, err) => Promise.resolve(result).then(ok, err),
  };
  return c;
}

beforeEach(() => {
  selectMock.mockReset();
  transactionMock.mockReset();
  storageDeleteMock.mockReset();
  auditMock.mockReset();
  events.length = 0;
});

describe("softDeleteTasks", () => {
  it("does nothing for an empty id list", async () => {
    expect(await softDeleteTasks([], "u1")).toEqual({
      parentIds: [],
      subtaskIds: [],
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("flags the task and tags its subtasks with the parent id, never hard-deleting", async () => {
    const sets: Record<string, unknown>[] = [];
    transactionMock.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          update: (table: unknown) => {
            expect(table).toBe(task);
            return {
              set: (values: Record<string, unknown>) => {
                sets.push(values);
                return {
                  where: () => ({
                    returning: () => Promise.resolve([{ id: "p1" }]),
                    // biome-ignore lint/suspicious/noThenProperty: thenable for awaiting without returning()
                    then: (ok: (v: unknown) => unknown) =>
                      Promise.resolve(undefined).then(ok),
                  }),
                };
              },
            };
          },
          select: () => chain([{ id: "s1", parentTaskId: "p1" }]),
          delete: () => {
            throw new Error("soft delete must never hard-delete");
          },
        };
        return await cb(tx);
      }
    );

    const res = await softDeleteTasks(["p1"], "admin1");

    expect(res).toEqual({ parentIds: ["p1"], subtaskIds: ["s1"] });
    expect(sets[0]).toMatchObject({
      deletedBy: "admin1",
      isPinnedToList: false,
    });
    expect(sets[0].deletedAt).toBeInstanceOf(Date);
    expect(sets[1]).toMatchObject({
      deletedBy: "admin1",
      deletedWithParentId: "p1",
    });
  });
});

// ─── Permanent delete ────────────────────────────────────────────────────────

interface TxScript {
  children?: { id: string }[];
  files?: { fileUrl: string }[];
  root: Record<string, unknown> | null;
}

// Runs the purge transaction callback against a scripted tx. Selects are served
// in order: (1) root row, (2) trashed subtasks, (3) attachments. Rolls back (drops
// recorded deletes) if the callback throws, like a real transaction.
function scriptTx(script: TxScript) {
  const deletedIds: string[][] = [];
  const forModes: { cfg: unknown; mode: string }[] = [];
  const wheres: unknown[] = [];
  transactionMock.mockImplementationOnce(
    async (cb: (tx: unknown) => Promise<unknown>) => {
      const batches: unknown[][] = [
        script.root ? [script.root] : [],
        script.children ?? [],
        script.files ?? [],
      ];
      let i = 0;
      const pending: string[][] = [];
      const tx = {
        select: () =>
          chain(batches[i++] ?? [], {
            onFor: (mode, cfg) => forModes.push({ mode, cfg }),
            onWhere: (c) => wheres.push(c),
          }),
        delete: (table: unknown) => {
          expect(table).toBe(task);
          return {
            where: () => {
              events.push("rows");
              pending.push(["deleted"]);
              return Promise.resolve(undefined);
            },
          };
        },
      };
      const out = await cb(tx);
      deletedIds.push(...pending);
      return out;
    }
  );
  return { deletedIds, forModes, wheres };
}

const ROOT = {
  id: "p1",
  title: "Old task",
  workspaceId: "w1",
  deletedAt: new Date("2026-08-01T00:00:00Z"),
  deletedBy: "u9",
};

describe("purgeTrashedTask", () => {
  it("skips (and touches nothing) when the task is no longer in the Trash — e.g. it was restored", async () => {
    const t = scriptTx({ root: null });
    const out = await purgeTrashedTask("p1", {
      reason: "retention",
      cutoff: new Date(),
    });
    expect(out).toEqual({ rootId: "p1", status: "skipped" });
    expect(storageDeleteMock).not.toHaveBeenCalled();
    expect(t.deletedIds).toEqual([]);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("is idempotent: a second purge of the same task is a no-op", async () => {
    scriptTx({ root: ROOT });
    expect((await purgeTrashedTask("p1", { reason: "manual" })).status).toBe(
      "purged"
    );
    scriptTx({ root: null }); // row is gone now
    expect((await purgeTrashedTask("p1", { reason: "manual" })).status).toBe(
      "skipped"
    );
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("locks rows FOR UPDATE SKIP LOCKED so concurrent restore / manual purge never double-process", async () => {
    const t = scriptTx({ root: ROOT, children: [{ id: "s1" }] });
    await purgeTrashedTask("p1", { reason: "retention", cutoff: new Date() });
    expect(t.forModes).toHaveLength(2); // root + subtasks
    for (const f of t.forModes) {
      expect(f).toEqual({ mode: "update", cfg: { skipLocked: true } });
    }
  });

  it("deletes storage files for the task AND its trashed subtasks BEFORE the rows, and purges subtasks with it", async () => {
    scriptTx({
      root: ROOT,
      children: [{ id: "s1" }],
      files: [{ fileUrl: "attachments/a" }, { fileUrl: "attachments/sub-b" }],
    });
    storageDeleteMock.mockImplementation(async (key: string) => {
      events.push(`file:${key}`);
    });

    const out = await purgeTrashedTask("p1", {
      reason: "retention",
      cutoff: new Date(),
    });

    expect(out).toEqual({ rootId: "p1", status: "purged", ids: ["p1", "s1"] });
    expect(events.at(-1)).toBe("rows");
    expect(events.slice(0, 2).sort()).toEqual([
      "file:attachments/a",
      "file:attachments/sub-b",
    ]);
  });

  it("keeps the task in the Trash when a storage delete fails (nothing removed, no audit)", async () => {
    const t = scriptTx({ root: ROOT, files: [{ fileUrl: "attachments/a" }] });
    storageDeleteMock.mockRejectedValue(new Error("S3 down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const out = await purgeTrashedTask("p1", {
      reason: "retention",
      cutoff: new Date(),
    });

    expect(out.status).toBe("failed");
    expect(events).not.toContain("rows");
    expect(t.deletedIds).toEqual([]);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("treats an already-missing file (NotFound) as cleaned up and still purges", async () => {
    scriptTx({ root: ROOT, files: [{ fileUrl: "attachments/gone" }] });
    storageDeleteMock.mockRejectedValue(
      Object.assign(new Error("nf"), { code: "NotFound" })
    );
    expect(
      (
        await purgeTrashedTask("p1", {
          reason: "retention",
          cutoff: new Date(),
        })
      ).status
    ).toBe("purged");
    expect(events).toContain("rows");
  });

  it("writes a trash.auto_purged audit entry for the retention purge", async () => {
    scriptTx({
      root: ROOT,
      children: [{ id: "s1" }],
      files: [{ fileUrl: "a" }],
    });
    await purgeTrashedTask("p1", { reason: "retention", cutoff: new Date() });
    expect(auditMock).toHaveBeenCalledTimes(1);
    const arg = auditMock.mock.calls[0][0];
    expect(arg).toMatchObject({
      action: "trash.auto_purged",
      entityType: "TASK",
      entityId: "p1",
      actorId: null,
    });
    expect(arg.description).toContain("Old task");
    expect(arg.metadata).toMatchObject({
      workspaceId: "w1",
      taskId: "p1",
      title: "Old task",
      reason: "retention_30_days",
      deletedAt: "2026-08-01T00:00:00.000Z",
      subtaskIds: ["s1"],
      attachmentsDeleted: 1,
    });
    expect(typeof arg.metadata.purgedAt).toBe("string");
  });

  it("writes a trash.purged audit entry attributed to the admin for a manual Delete forever", async () => {
    scriptTx({ root: ROOT });
    await purgeTrashedTask("p1", {
      reason: "manual",
      actor: { id: "admin1", email: "a@b.c" },
    });
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: "trash.purged",
      actorId: "admin1",
      actorEmail: "a@b.c",
    });
    expect(auditMock.mock.calls[0][0].metadata.reason).toBe("manual");
  });
});

describe("purgeTasks", () => {
  it("one failed task does not stop the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    scriptTx({ root: { ...ROOT, id: "a" }, files: [{ fileUrl: "fa" }] });
    scriptTx({ root: { ...ROOT, id: "b" } });
    scriptTx({ root: { ...ROOT, id: "c" } });
    storageDeleteMock.mockImplementation(async (key: string) => {
      if (key === "fa") {
        throw new Error("boom");
      }
    });

    const res = await purgeTasks(["a", "b", "c"], { reason: "manual" });

    expect(res.failed).toEqual(["a"]);
    expect(res.purged.sort()).toEqual(["b", "c"]);
  });

  it("counts skipped tasks (already gone / restored / locked by another worker)", async () => {
    scriptTx({ root: null });
    const res = await purgeTasks(["x"], { reason: "manual" });
    expect(res).toEqual({ purged: [], failed: [], skipped: 1 });
  });
});

describe("findExpiredTrashedTaskIds (retention selection)", () => {
  it("filters on deleted_at <= cutoff (never created/updated/archived)", async () => {
    let where: unknown;
    selectMock.mockImplementation(() =>
      chain([{ id: "t1" }], { onWhere: (c) => (where = c) })
    );
    const cutoff = new Date("2026-09-05T00:00:00Z");

    const ids = await findExpiredTrashedTaskIds({ cutoff, limit: 50 });

    expect(ids).toEqual(["t1"]);
    const { sql, params } = new PgDialect().sqlToQuery(where as never);
    expect(sql).toContain('"task"."deleted_at" is not null');
    expect(sql).toContain('"task"."deleted_at" <=');
    expect(sql).not.toMatch(/created_at|updated_at|archived_at/);
    expect(
      params.map((p) => (p instanceof Date ? p.toISOString() : p))
    ).toContain(cutoff.toISOString());
  });

  it("keyset-paginates by id after the previous batch", async () => {
    let where: unknown;
    selectMock.mockImplementation(() =>
      chain([], { onWhere: (c) => (where = c) })
    );
    await findExpiredTrashedTaskIds({
      cutoff: new Date(),
      afterId: "t9",
      limit: 10,
    });
    const { sql, params } = new PgDialect().sqlToQuery(where as never);
    expect(sql).toContain('"task"."id" >');
    expect(params).toContain("t9");
  });
});
