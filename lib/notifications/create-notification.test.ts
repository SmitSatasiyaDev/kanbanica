import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CreateNotificationParams,
  createNotifications,
} from "@/lib/notifications/create-notification";

const {
  selectMock,
  insertMock,
  insertValuesSpy,
  pushToUserMock,
  sendPushToUserMock,
  enqueueEmailMock,
  notificationTemplateMock,
  isSmtpConfiguredMock,
  emailsEnabledMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  insertMock: vi.fn(),
  insertValuesSpy: vi.fn(),
  pushToUserMock: vi.fn(),
  sendPushToUserMock: vi.fn(),
  enqueueEmailMock: vi.fn(),
  notificationTemplateMock: vi.fn(),
  isSmtpConfiguredMock: vi.fn(),
  emailsEnabledMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { select: selectMock, insert: insertMock } }));
vi.mock("@/lib/sse-clients", () => ({ pushToUser: pushToUserMock }));
vi.mock("@/lib/notifications/push", () => ({
  sendPushToUser: sendPushToUserMock,
}));
vi.mock("@/lib/email", () => ({ enqueueEmail: enqueueEmailMock }));
vi.mock("@/lib/email/templates/notification", () => ({
  notificationTemplate: notificationTemplateMock,
}));
vi.mock("@/lib/integration-settings", () => ({
  areNotificationEmailsEnabled: emailsEnabledMock,
}));
vi.mock("@/lib/smtp/client", () => ({
  isSmtpConfigured: isSmtpConfiguredMock,
}));

interface QueryChain extends PromiseLike<unknown[]> {
  from: () => QueryChain;
  leftJoin: () => QueryChain;
  limit: () => QueryChain;
  where: () => QueryChain;
}

function createChain(result: unknown[]): QueryChain {
  const chain: QueryChain = {
    from: () => chain,
    where: () => chain,
    leftJoin: () => chain,
    limit: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's own thenable query builder
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return chain;
}

function queueSelectResults(...batches: unknown[][]) {
  // `_create()`'s first select is the workspace-name lookup — give it a stub row
  // so the caller's batches still line up in order with muted / prefs / email.
  const queue: unknown[][] = [[{ name: "Workspace" }], ...batches];
  let index = 0;
  selectMock.mockImplementation(() => {
    const result = queue[index] ?? [];
    index += 1;
    return createChain(result);
  });
}

function stubInsert() {
  insertMock.mockImplementation(() => ({
    values: (rows: unknown) => {
      insertValuesSpy(rows);
      return Promise.resolve(undefined);
    },
  }));
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function baseParams(
  overrides: Partial<CreateNotificationParams> = {}
): CreateNotificationParams {
  return {
    workspaceId: "w1",
    actorId: null,
    recipientIds: ["u1"],
    triggerType: "task_created",
    entityType: "TASK",
    entityId: "t1",
    title: "Title",
    ...overrides,
  };
}

beforeEach(() => {
  selectMock.mockReset();
  insertMock.mockReset();
  insertValuesSpy.mockReset();
  pushToUserMock.mockReset();
  sendPushToUserMock.mockReset();
  enqueueEmailMock.mockReset();
  notificationTemplateMock.mockReset();
  isSmtpConfiguredMock.mockReset();
  emailsEnabledMock.mockReset();
  emailsEnabledMock.mockResolvedValue(true);
  stubInsert();
  isSmtpConfiguredMock.mockReturnValue(false);
  notificationTemplateMock.mockResolvedValue({
    html: "<p>body</p>",
    text: "body",
  });
  sendPushToUserMock.mockResolvedValue(undefined);
});

describe("createNotifications", () => {
  it("excludes the actor from recipients (no self-notification)", async () => {
    queueSelectResults([], []);
    createNotifications(
      baseParams({ actorId: "u1", recipientIds: ["u1", "u2"] })
    );
    await flush();
    expect(insertValuesSpy).toHaveBeenCalledTimes(1);
    const rows = insertValuesSpy.mock.calls[0][0] as Array<{
      recipientId: string;
    }>;
    expect(rows.map((r) => r.recipientId)).toEqual(["u2"]);
  });

  it("returns without any DB calls when every recipient is the actor", async () => {
    createNotifications(
      baseParams({ actorId: "u1", recipientIds: ["u1", "u1"] })
    );
    await flush();
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("deduplicates recipient ids", async () => {
    queueSelectResults([], []);
    createNotifications(baseParams({ recipientIds: ["u1", "u1", "u1"] }));
    await flush();
    const rows = insertValuesSpy.mock.calls[0][0] as Array<{
      recipientId: string;
    }>;
    expect(rows).toHaveLength(1);
  });

  it("excludes recipients who muted the entity and skips the second query when everyone is muted", async () => {
    queueSelectResults([{ userId: "u1" }]);
    createNotifications(baseParams({ recipientIds: ["u1"] }));
    await flush();
    // workspace-name lookup + muted check; prefs query is skipped (all muted).
    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("defaults in-app notifications to enabled when no preference row exists", async () => {
    queueSelectResults([], []);
    createNotifications(baseParams());
    await flush();
    expect(insertValuesSpy).toHaveBeenCalledTimes(1);
    expect(pushToUserMock).toHaveBeenCalledTimes(1);
  });

  it("respects an explicit inAppEnabled:false preference (no insert, no SSE toast)", async () => {
    queueSelectResults(
      [],
      [
        {
          userId: "u1",
          inAppEnabled: false,
          emailEnabled: false,
          pushEnabled: true,
        },
      ]
    );
    createNotifications(baseParams());
    await flush();
    expect(insertMock).not.toHaveBeenCalled();
    expect(pushToUserMock).not.toHaveBeenCalled();
  });

  it("filters web-push recipients independently of in-app recipients", async () => {
    queueSelectResults(
      [],
      [
        {
          userId: "u1",
          inAppEnabled: false,
          emailEnabled: false,
          pushEnabled: true,
        },
      ]
    );
    createNotifications(baseParams());
    await flush();
    expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
  });

  it("uses the default notifications URL for the SSE toast unless pushUrl is provided", async () => {
    queueSelectResults([], []);
    createNotifications(baseParams({ workspaceId: "w9" }));
    await flush();
    expect(pushToUserMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ url: "/w9/notifications" })
    );
  });

  it("uses a custom pushUrl for the SSE toast when provided", async () => {
    queueSelectResults([], []);
    createNotifications(baseParams({ pushUrl: "/w1/task/t1" }));
    await flush();
    expect(pushToUserMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ url: "/w1/task/t1" })
    );
  });

  it("sends an instant email when the trigger defaults email on and SMTP is configured", async () => {
    isSmtpConfiguredMock.mockReturnValue(true);
    queueSelectResults(
      [],
      [],
      [{ id: "u1", email: "u1@example.com", deliveryMode: null }]
    );
    createNotifications(baseParams({ triggerType: "task_assigned" }));
    await flush();
    expect(enqueueEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "u1@example.com", subject: "Title" })
    );
  });

  it("sends no email when the platform notification-email switch is off, but still creates the in-app notification", async () => {
    isSmtpConfiguredMock.mockReturnValue(true);
    emailsEnabledMock.mockResolvedValue(false);
    queueSelectResults(
      [],
      [],
      [{ id: "u1", email: "u1@example.com", deliveryMode: null }]
    );
    createNotifications(baseParams({ triggerType: "task_assigned" }));
    await flush();
    expect(insertValuesSpy).toHaveBeenCalledTimes(1);
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });

  it("does not attempt email for a non-high-signal trigger with no explicit preference", async () => {
    isSmtpConfiguredMock.mockReturnValue(true);
    queueSelectResults([], []);
    createNotifications(baseParams({ triggerType: "task_created" }));
    await flush();
    // workspace-name + muted + prefs; no email-recipients query (default off).
    expect(selectMock).toHaveBeenCalledTimes(3);
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });

  it("respects an explicit emailEnabled:false preference over a high-signal trigger default", async () => {
    isSmtpConfiguredMock.mockReturnValue(true);
    queueSelectResults(
      [],
      [
        {
          userId: "u1",
          inAppEnabled: true,
          emailEnabled: false,
          pushEnabled: true,
        },
      ]
    );
    createNotifications(baseParams({ triggerType: "task_assigned" }));
    await flush();
    // workspace-name + muted + prefs; email suppressed by explicit preference.
    expect(selectMock).toHaveBeenCalledTimes(3);
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });

  it("skips email entirely when SMTP is not configured, even for an email-eligible recipient", async () => {
    isSmtpConfiguredMock.mockReturnValue(false);
    queueSelectResults([], []);
    createNotifications(baseParams({ triggerType: "task_assigned" }));
    await flush();
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });

  it("skips a recipient whose delivery mode is not instant", async () => {
    isSmtpConfiguredMock.mockReturnValue(true);
    queueSelectResults(
      [],
      [],
      [{ id: "u1", email: "u1@example.com", deliveryMode: "digest" }]
    );
    createNotifications(baseParams({ triggerType: "task_assigned" }));
    await flush();
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });
});
