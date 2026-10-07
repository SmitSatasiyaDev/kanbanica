import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectDistinctMock, transactionMock, ensureTeamDaysMock } = vi.hoisted(
  () => ({
    selectDistinctMock: vi.fn(),
    transactionMock: vi.fn(),
    ensureTeamDaysMock: vi.fn(),
  })
);

vi.mock("@/lib/db", () => ({
  db: { selectDistinct: selectDistinctMock, transaction: transactionMock },
}));
vi.mock("@/lib/daily-checklist/ensure", () => ({
  ensureTeamDays: ensureTeamDaysMock,
}));

import { runDailyChecklistGenerate } from "./daily-checklist-generate";

type Row = {
  userId: string;
  workspaceId?: string;
  userTimezone: string | null;
  workspaceTimezone?: string | null;
};

function assignees(input: Row[]) {
  const rows = input.map((r) => ({
    workspaceId: "ws",
    workspaceTimezone: null,
    ...r,
  }));
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: thenable query-builder stub
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve),
    where: () => chain,
  };
  selectDistinctMock.mockReturnValue(chain);
}

describe("runDailyChecklistGenerate", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    selectDistinctMock.mockReset();
    ensureTeamDaysMock.mockReset();
    transactionMock.mockReset();
    transactionMock.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn("tx")
    );
    ensureTeamDaysMock.mockResolvedValue([]);
  });

  it("generates each assignee's day for their own local date", async () => {
    assignees([
      { userId: "utc-user", userTimezone: null },
      { userId: "nz-user", userTimezone: "Pacific/Auckland" },
    ]);
    await runDailyChecklistGenerate({ now: new Date("2026-10-07T20:00:00Z") });
    expect(ensureTeamDaysMock).toHaveBeenCalledWith(
      "tx",
      "utc-user",
      "2026-10-07",
      "ws"
    );
    expect(ensureTeamDaysMock).toHaveBeenCalledWith(
      "tx",
      "nz-user",
      "2026-10-08",
      "ws"
    );
  });

  it("uses user timezone → workspace timezone → UTC (same helper as on-demand)", async () => {
    assignees([
      {
        userId: "kolkata",
        userTimezone: "Asia/Kolkata",
        workspaceTimezone: "America/New_York",
      },
      {
        userId: "ws-fallback",
        userTimezone: null,
        workspaceTimezone: "America/New_York",
      },
      { userId: "utc", userTimezone: null, workspaceTimezone: null },
    ]);
    // 2026-10-07T23:30Z → Kolkata Oct 8, New York (EDT) Oct 7, UTC Oct 7
    await runDailyChecklistGenerate({ now: new Date("2026-10-07T23:30:00Z") });
    expect(ensureTeamDaysMock).toHaveBeenCalledWith(
      "tx",
      "kolkata",
      "2026-10-08",
      "ws"
    );
    expect(ensureTeamDaysMock).toHaveBeenCalledWith(
      "tx",
      "ws-fallback",
      "2026-10-07",
      "ws"
    );
    expect(ensureTeamDaysMock).toHaveBeenCalledWith(
      "tx",
      "utc",
      "2026-10-07",
      "ws"
    );
  });

  it("resolves per workspace for a user assigned in two workspaces", async () => {
    assignees([
      { userId: "u", workspaceId: "w1", userTimezone: null, workspaceTimezone: "Asia/Kolkata" },
      { userId: "u", workspaceId: "w2", userTimezone: null, workspaceTimezone: "America/New_York" },
    ]);
    await runDailyChecklistGenerate({ now: new Date("2026-10-07T23:30:00Z") });
    expect(ensureTeamDaysMock).toHaveBeenCalledWith("tx", "u", "2026-10-08", "w1");
    expect(ensureTeamDaysMock).toHaveBeenCalledWith("tx", "u", "2026-10-07", "w2");
  });

  it("does nothing when no active template has assignees", async () => {
    assignees([]);
    const stats = await runDailyChecklistGenerate();
    expect(stats).toEqual({ users: 0, created: 0, failed: 0 });
    expect(ensureTeamDaysMock).not.toHaveBeenCalled();
  });

  it("counts created days and keeps going when one user fails", async () => {
    assignees([
      { userId: "a", userTimezone: "UTC" },
      { userId: "b", userTimezone: "UTC" },
      { userId: "c", userTimezone: "UTC" },
    ]);
    ensureTeamDaysMock
      .mockResolvedValueOnce(["d1", "d2"])
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(["d3"]);
    const stats = await runDailyChecklistGenerate();
    expect(stats).toEqual({ users: 3, created: 3, failed: 1 });
  });

  it("is safe to run repeatedly (ensureTeamDays returns [] for existing days)", async () => {
    assignees([{ userId: "a", userTimezone: "UTC" }]);
    const first = await runDailyChecklistGenerate();
    const second = await runDailyChecklistGenerate();
    expect(first.created + second.created).toBe(0);
  });
});
