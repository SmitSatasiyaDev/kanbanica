import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  account,
  channelMember,
  checklistTask,
  commentReaction,
  mutedEntity,
  notification,
  pushSubscription,
  savedFilter,
  session as sessionTable,
  spaceMember,
  taskAssignee,
  taskWatcher,
  timeEntry,
  user,
  userEmailPreference,
  userNotificationPreference,
  userOnboardingProgress,
  userSearchHistory,
  workspaceMember,
} from "@/db/schema";
import { purgeUser, soleOwnedWorkspaces } from "@/lib/user-deletion";

const { selectMock, transactionMock, storageDeleteMock, deleteCallOrder } =
  vi.hoisted(() => ({
    selectMock: vi.fn(),
    transactionMock: vi.fn(),
    storageDeleteMock: vi.fn(),
    deleteCallOrder: [] as unknown[],
  }));

vi.mock("@/lib/db", () => ({
  db: { select: selectMock, transaction: transactionMock },
}));
vi.mock("@/lib/storage", () => ({ storage: { delete: storageDeleteMock } }));

interface QueryChain extends PromiseLike<unknown[]> {
  from: () => QueryChain;
  groupBy: () => QueryChain;
  where: () => QueryChain;
}

function createChain(result: unknown[]): QueryChain {
  const chain: QueryChain = {
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return chain;
}

function queueSelectResults(...batches: unknown[][]) {
  let index = 0;
  selectMock.mockImplementation(() => {
    const result = batches[index] ?? [];
    index += 1;
    return createChain(result);
  });
}

function stubTransaction() {
  transactionMock.mockImplementation(
    async (callback: (tx: unknown) => Promise<void>) => {
      const tx = {
        delete: (table: unknown) => {
          deleteCallOrder.push(table);
          return { where: () => Promise.resolve(undefined) };
        },
      };
      await callback(tx);
    }
  );
}

beforeEach(() => {
  selectMock.mockReset();
  transactionMock.mockReset();
  storageDeleteMock.mockReset();
  deleteCallOrder.length = 0;
});

describe("soleOwnedWorkspaces", () => {
  it("returns an empty array and makes only one query when the user owns nothing", async () => {
    queueSelectResults([]);
    const result = await soleOwnedWorkspaces("u1");
    expect(result).toEqual([]);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns a workspace where the user is the sole active owner", async () => {
    queueSelectResults(
      [{ workspaceId: "w1" }],
      [{ workspaceId: "w1", ownerCount: 1 }]
    );
    const result = await soleOwnedWorkspaces("u1");
    expect(result).toEqual(["w1"]);
  });

  it("excludes a workspace that has more than one active owner", async () => {
    queueSelectResults(
      [{ workspaceId: "w1" }],
      [{ workspaceId: "w1", ownerCount: 2 }]
    );
    const result = await soleOwnedWorkspaces("u1");
    expect(result).toEqual([]);
  });

  it("returns only the sole-owned workspaces among several owned ones", async () => {
    queueSelectResults(
      [{ workspaceId: "w1" }, { workspaceId: "w2" }],
      [
        { workspaceId: "w1", ownerCount: 1 },
        { workspaceId: "w2", ownerCount: 2 },
      ]
    );
    const result = await soleOwnedWorkspaces("u1");
    expect(result).toEqual(["w1"]);
  });
});

describe("purgeUser", () => {
  it("deletes in the exact FK-safe order documented in docs/settings.md", async () => {
    stubTransaction();
    await purgeUser("u1", null);
    expect(deleteCallOrder).toEqual([
      notification,
      userNotificationPreference,
      userEmailPreference,
      mutedEntity,
      pushSubscription,
      userSearchHistory,
      savedFilter,
      userOnboardingProgress,
      taskAssignee,
      taskWatcher,
      timeEntry,
      commentReaction,
      checklistTask,
      spaceMember,
      workspaceMember,
      channelMember,
      sessionTable,
      account,
      user,
    ]);
  });

  it("deletes the avatar from storage before the transaction when an imageKey is given", async () => {
    stubTransaction();
    storageDeleteMock.mockResolvedValue(undefined);
    await purgeUser("u1", "avatars/u1/pic.webp");
    expect(storageDeleteMock).toHaveBeenCalledWith("avatars/u1/pic.webp");
    expect(transactionMock).toHaveBeenCalled();
  });

  it("does not touch storage when imageKey is null", async () => {
    stubTransaction();
    await purgeUser("u1", null);
    expect(storageDeleteMock).not.toHaveBeenCalled();
  });

  it("proceeds with deletion even when storage cleanup fails", async () => {
    stubTransaction();
    storageDeleteMock.mockRejectedValue(new Error("storage down"));
    await expect(
      purgeUser("u1", "avatars/u1/pic.webp")
    ).resolves.toBeUndefined();
    expect(transactionMock).toHaveBeenCalled();
  });
});
