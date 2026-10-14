import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDueDateReminder } from "@/lib/worker/handlers/due-date-reminder";

const { selectMock, selectDistinctMock, createNotificationsMock } = vi.hoisted(
  () => ({
    selectMock: vi.fn(),
    selectDistinctMock: vi.fn(),
    createNotificationsMock: vi.fn(),
  })
);

vi.mock("@/lib/db", () => ({
  db: { select: selectMock, selectDistinct: selectDistinctMock },
}));
vi.mock("@/lib/notifications/create-notification", () => ({
  createNotifications: createNotificationsMock,
}));

interface QueryChain extends PromiseLike<unknown[]> {
  from: () => QueryChain;
  innerJoin: () => QueryChain;
  where: () => QueryChain;
}

function createChain(result: unknown[]): QueryChain {
  const chain: QueryChain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return chain;
}

/** Per timezone group the handler runs: assignee rows, watcher rows, then (if any task matched) already-sent notifications. */
function queueSelectResults(...batches: unknown[][]) {
  let index = 0;
  selectMock.mockImplementation(() => {
    const result = batches[index] ?? [];
    index += 1;
    return createChain(result);
  });
}

function queueZones(...zones: string[]) {
  selectDistinctMock.mockReturnValue(createChain(zones.map((tz) => ({ tz }))));
}

function row(
  dueDateEnd: string,
  userId = "u1",
  extra: Partial<{ id: string; title: string }> = {}
) {
  return {
    id: extra.id ?? "t1",
    title: extra.title ?? "Task 1",
    workspaceId: "w1",
    dueDateEnd,
    userId,
  };
}

// 2026-10-12 12:00 UTC: Oct 12 in UTC, Oct 12 evening in IST, Oct 12 early morning in New York.
const NOON_UTC = new Date("2026-10-12T12:00:00Z");

beforeEach(() => {
  selectMock.mockReset();
  selectDistinctMock.mockReset();
  createNotificationsMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOON_UTC);
  queueZones("UTC");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleDueDateReminder", () => {
  it("sends a 1-day reminder for a task due tomorrow", async () => {
    queueSelectResults([row("2026-10-13")], [], []);
    await handleDueDateReminder([]);
    expect(createNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: "due_date_reminder_1day",
        entityId: "t1",
        recipientIds: ["u1"],
      })
    );
  });

  it("sends a due-today reminder for a task due today", async () => {
    queueSelectResults([row("2026-10-12", "u1", { id: "t2" })], [], []);
    await handleDueDateReminder([]);
    expect(createNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: "due_date_today", entityId: "t2" })
    );
  });

  it("sends an overdue reminder for a task due yesterday", async () => {
    queueSelectResults([row("2026-10-11", "u1", { id: "t3" })], [], []);
    await handleDueDateReminder([]);
    expect(createNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: "task_overdue", entityId: "t3" })
    );
  });

  it("ignores days outside yesterday/today/tomorrow", async () => {
    queueSelectResults([row("2026-10-20")], [], []);
    await handleDueDateReminder([]);
    expect(createNotificationsMock).not.toHaveBeenCalled();
  });

  it("skips a recipient who was already notified since their local midnight", async () => {
    queueSelectResults(
      [row("2026-10-13")],
      [],
      [
        {
          entityId: "t1",
          recipientId: "u1",
          triggerType: "due_date_reminder_1day",
        },
      ]
    );
    await handleDueDateReminder([]);
    expect(createNotificationsMock).not.toHaveBeenCalled();
  });

  it("still notifies other recipients of the same task", async () => {
    queueSelectResults(
      [row("2026-10-13", "u1"), row("2026-10-13", "u2")],
      [],
      [
        {
          entityId: "t1",
          recipientId: "u1",
          triggerType: "due_date_reminder_1day",
        },
      ]
    );
    await handleDueDateReminder([]);
    expect(createNotificationsMock).toHaveBeenCalledTimes(1);
    expect(createNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: ["u2"] })
    );
  });

  it("does nothing, and skips the dedupe query, when no task matches", async () => {
    queueSelectResults([], []);
    await handleDueDateReminder([]);
    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(createNotificationsMock).not.toHaveBeenCalled();
  });

  it("deduplicates a user who is both assignee and watcher", async () => {
    queueSelectResults(
      [row("2026-10-13", "u1")],
      [row("2026-10-13", "u1")],
      []
    );
    await handleDueDateReminder([]);
    expect(createNotificationsMock).toHaveBeenCalledTimes(1);
    expect(createNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: ["u1"] })
    );
  });

  it("includes the task title in the notification message", async () => {
    queueSelectResults(
      [row("2026-10-13", "u1", { title: "Ship the release" })],
      [],
      []
    );
    await handleDueDateReminder([]);
    expect(createNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Ship the release"),
      })
    );
  });
});

describe("handleDueDateReminder timezones", () => {
  it("uses each recipient's own day: the same due day is 'tomorrow' in UTC but 'today' in a zone that is already on the next day", async () => {
    // 2026-10-11 20:00 UTC is still Oct 11 in UTC but already Oct 12 in Kolkata.
    vi.setSystemTime(new Date("2026-10-11T20:00:00Z"));

    queueZones("UTC");
    queueSelectResults([row("2026-10-12")], [], []);
    await handleDueDateReminder([]);
    expect(createNotificationsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ triggerType: "due_date_reminder_1day" })
    );

    createNotificationsMock.mockReset();
    selectMock.mockReset();
    queueZones("Asia/Kolkata");
    queueSelectResults([row("2026-10-12")], [], []);
    await handleDueDateReminder([]);
    expect(createNotificationsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ triggerType: "due_date_today" })
    );
  });

  it("processes every timezone group separately", async () => {
    queueZones("UTC", "Asia/Kolkata");
    queueSelectResults(
      [row("2026-10-13", "u-utc", { id: "tu" })],
      [],
      [], // UTC group: dedupe
      [row("2026-10-12", "u-ist", { id: "ti" })],
      [],
      [] // Kolkata group: dedupe
    );
    await handleDueDateReminder([]);
    expect(createNotificationsMock).toHaveBeenCalledTimes(2);
    expect(createNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "tu",
        triggerType: "due_date_reminder_1day",
        recipientIds: ["u-utc"],
      })
    );
    expect(createNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "ti",
        triggerType: "due_date_today",
        recipientIds: ["u-ist"],
      })
    );
  });

  it("treats an invalid stored timezone as UTC", async () => {
    queueZones("Not/AZone");
    queueSelectResults([row("2026-10-12")], [], []);
    await handleDueDateReminder([]);
    expect(createNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: "due_date_today" })
    );
  });
});
