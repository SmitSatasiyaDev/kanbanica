import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleNotificationDigestScan,
  localTime,
} from "@/lib/worker/handlers/notification-digest-scan";
import { JOB_NAMES } from "@/lib/worker/job-types";

const { selectMock, enqueueJobMock, emailsEnabledMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  enqueueJobMock: vi.fn(),
  emailsEnabledMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { select: selectMock } }));
vi.mock("@/lib/integration-settings", () => ({
  areNotificationEmailsEnabled: emailsEnabledMock,
}));
vi.mock("@/lib/worker/enqueue", () => ({ enqueueJob: enqueueJobMock }));

interface QueryChain extends PromiseLike<unknown[]> {
  from: () => QueryChain;
  where: () => QueryChain;
}

function createChain(result: unknown[]): QueryChain {
  const chain: QueryChain = {
    from: () => chain,
    where: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return chain;
}

function queueDigestUsers(result: unknown[]) {
  selectMock.mockReturnValue(createChain(result));
}

beforeEach(() => {
  selectMock.mockReset();
  enqueueJobMock.mockReset();
  emailsEnabledMock.mockReset();
  emailsEnabledMock.mockResolvedValue(true);
});

describe("localTime", () => {
  it("returns minutes-since-midnight and a YYYY-MM-DD date for a UTC instant in UTC", () => {
    const result = localTime(new Date("2024-06-01T08:15:00.000Z"), "UTC");
    expect(result).toEqual({ minutes: 8 * 60 + 15, date: "2024-06-01" });
  });

  it("normalizes midnight to minutes:0 rather than 1440 (the historical '24' hour bug)", () => {
    const result = localTime(new Date(Date.UTC(2024, 0, 1, 0, 0)), "UTC");
    expect(result.minutes).toBe(0);
    expect(result.date).toBe("2024-01-01");
  });

  it("falls back to UTC for an invalid IANA timezone", () => {
    const utc = localTime(new Date("2024-06-01T08:15:00.000Z"), "UTC");
    const invalid = localTime(
      new Date("2024-06-01T08:15:00.000Z"),
      "Not/A_Timezone"
    );
    expect(invalid).toEqual(utc);
  });

  it("always returns minutes within a single day's range", () => {
    const result = localTime(new Date("2024-06-01T23:59:00.000Z"), "UTC");
    expect(result.minutes).toBeGreaterThanOrEqual(0);
    expect(result.minutes).toBeLessThan(24 * 60);
  });
});

describe("handleNotificationDigestScan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T08:15:00.000Z")); // UTC minutes-of-day = 495
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues a digest for a user whose digest time falls within the current scan window", async () => {
    queueDigestUsers([
      { userId: "u1", digestTime: "08:00", digestTimezone: "UTC" },
    ]);
    await handleNotificationDigestScan([]);
    expect(enqueueJobMock).toHaveBeenCalledWith(
      JOB_NAMES.NOTIFICATION_DIGEST_SEND,
      expect.objectContaining({ userId: "u1" }),
      { singletonKey: "digest-u1-2024-06-01-08:00" }
    );
  });

  it("does not queue when the user's digest time hasn't arrived yet", async () => {
    queueDigestUsers([
      { userId: "u1", digestTime: "09:00", digestTimezone: "UTC" },
    ]);
    await handleNotificationDigestScan([]);
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("does not queue once the scan window has passed", async () => {
    queueDigestUsers([
      { userId: "u1", digestTime: "07:00", digestTimezone: "UTC" },
    ]);
    await handleNotificationDigestScan([]);
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("fires at the exact digest-time boundary (delta 0 is inclusive)", async () => {
    queueDigestUsers([
      { userId: "u1", digestTime: "08:15", digestTimezone: "UTC" },
    ]);
    await handleNotificationDigestScan([]);
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
  });

  it("skips a user with an unparseable digestTime without throwing", async () => {
    queueDigestUsers([
      { userId: "u1", digestTime: "not-a-time", digestTimezone: "UTC" },
    ]);
    await expect(handleNotificationDigestScan([])).resolves.toBeUndefined();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("queues jobs for multiple eligible users independently", async () => {
    queueDigestUsers([
      { userId: "u1", digestTime: "08:00", digestTimezone: "UTC" },
      { userId: "u2", digestTime: "08:10", digestTimezone: "UTC" },
    ]);
    await handleNotificationDigestScan([]);
    expect(enqueueJobMock).toHaveBeenCalledTimes(2);
  });

  it("does nothing when there are no digest users", async () => {
    queueDigestUsers([]);
    await handleNotificationDigestScan([]);
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("queues nothing and reads no digest users when the platform notification-email switch is off", async () => {
    emailsEnabledMock.mockResolvedValue(false);
    queueDigestUsers([
      { userId: "u1", digestTime: "08:00", digestTimezone: "UTC" },
    ]);
    await handleNotificationDigestScan([]);
    expect(selectMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});
