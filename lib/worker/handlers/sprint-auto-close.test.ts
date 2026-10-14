import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSprintAutoClose } from "@/lib/worker/handlers/sprint-auto-close";

const { selectMock, closeSprintAndRolloverMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  closeSprintAndRolloverMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { select: selectMock } }));
vi.mock("@/lib/sprint/rollover", () => ({
  closeSprintAndRollover: closeSprintAndRolloverMock,
}));

interface QueryChain extends PromiseLike<unknown[]> {
  from: () => QueryChain;
  innerJoin: () => QueryChain;
  where: (condition: unknown) => QueryChain;
}

let capturedWhere: unknown;

function createChain(result: unknown[]): QueryChain {
  const chain: QueryChain = {
    from: () => chain,
    where: (condition) => {
      capturedWhere = condition;
      return chain;
    },
    innerJoin: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return chain;
}

function queueEligibleSprints(result: unknown[]) {
  selectMock.mockReturnValue(createChain(result));
}

beforeEach(() => {
  capturedWhere = undefined;
  selectMock.mockReset();
  closeSprintAndRolloverMock.mockReset();
  closeSprintAndRolloverMock.mockResolvedValue({ nextSprintId: null });
});

describe("handleSprintAutoClose", () => {
  it("does nothing when there are no eligible sprints", async () => {
    queueEligibleSprints([]);
    await handleSprintAutoClose([]);
    expect(closeSprintAndRolloverMock).not.toHaveBeenCalled();
  });

  it("closes an eligible sprint with move_to_next_sprint when moveIncomplete is true", async () => {
    queueEligibleSprints([
      {
        id: "s1",
        name: "Sprint 1",
        spaceId: "sp1",
        createdBy: "u1",
        autoCreateNext: true,
        moveIncomplete: true,
      },
    ]);
    await handleSprintAutoClose([]);
    expect(closeSprintAndRolloverMock).toHaveBeenCalledWith({
      spaceId: "sp1",
      sprintId: "s1",
      actorId: "u1",
      autoCreateNext: true,
      incompleteStrategy: "move_to_next_sprint",
    });
  });

  it("uses move_to_backlog when moveIncomplete is false", async () => {
    queueEligibleSprints([
      {
        id: "s1",
        name: "Sprint 1",
        spaceId: "sp1",
        createdBy: "u1",
        autoCreateNext: false,
        moveIncomplete: false,
      },
    ]);
    await handleSprintAutoClose([]);
    expect(closeSprintAndRolloverMock).toHaveBeenCalledWith(
      expect.objectContaining({ incompleteStrategy: "move_to_backlog" })
    );
  });

  it("continues processing remaining sprints when one fails", async () => {
    queueEligibleSprints([
      {
        id: "s1",
        name: "A",
        spaceId: "sp1",
        createdBy: "u1",
        autoCreateNext: false,
        moveIncomplete: false,
      },
      {
        id: "s2",
        name: "B",
        spaceId: "sp2",
        createdBy: "u2",
        autoCreateNext: false,
        moveIncomplete: false,
      },
    ]);
    closeSprintAndRolloverMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ nextSprintId: null });
    await expect(handleSprintAutoClose([])).resolves.toBeUndefined();
    expect(closeSprintAndRolloverMock).toHaveBeenCalledTimes(2);
  });

  it("processes multiple eligible sprints with their own independent settings", async () => {
    queueEligibleSprints([
      {
        id: "s1",
        name: "A",
        spaceId: "sp1",
        createdBy: "u1",
        autoCreateNext: true,
        moveIncomplete: true,
      },
      {
        id: "s2",
        name: "B",
        spaceId: "sp2",
        createdBy: "u2",
        autoCreateNext: false,
        moveIncomplete: false,
      },
    ]);
    await handleSprintAutoClose([]);
    expect(closeSprintAndRolloverMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sprintId: "s1",
        incompleteStrategy: "move_to_next_sprint",
      })
    );
    expect(closeSprintAndRolloverMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sprintId: "s2",
        incompleteStrategy: "move_to_backlog",
      })
    );
  });
});

describe("handleSprintAutoClose eligibility query", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function renderWhere() {
    queueEligibleSprints([]);
    await handleSprintAutoClose([]);
    return new PgDialect().sqlToQuery(capturedWhere as never);
  }

  it("only selects ACTIVE sprints in spaces with auto-mark-done enabled", async () => {
    const { sql, params } = await renderWhere();
    expect(sql).toContain('"sprint"."status" = $1');
    expect(params[0]).toBe("ACTIVE");
    expect(sql).toContain('"space"."sprint_auto_mark_done" = $2');
    expect(params[1]).toBe(true);
  });

  it("does not use the other automation settings as the eligibility gate", async () => {
    const { sql } = await renderWhere();
    expect(sql).not.toContain("sprint_auto_create_next");
    expect(sql).not.toContain("sprint_auto_move_incomplete");
    expect(sql).not.toContain("sprint_auto_archive_after_n");
  });

  it("compares end_date strictly before the calendar day in UTC-12 (NULL end dates never match)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T14:30:00Z")); // 02:30 on Oct 5 in UTC-12
    const { sql, params } = await renderWhere();
    expect(sql).toContain('"sprint"."end_date" < $3');
    expect(params[2]).toBe("2026-10-05");
  });

  it("waits until the end day is over everywhere before closing", async () => {
    // 10:00Z Oct 5 is still Oct 4 in UTC-12, so a sprint ending Oct 4 is not
    // yet overdue for everyone; one ending Oct 3 is.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
    const { params } = await renderWhere();
    const cutoff = params[2] as string;
    expect(cutoff).toBe("2026-10-04");
    expect(cutoff > "2026-10-04").toBe(false);
    expect(cutoff > "2026-10-03").toBe(true);
  });
});
