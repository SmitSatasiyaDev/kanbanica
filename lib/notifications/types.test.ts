import { describe, expect, it } from "vitest";
import {
  EMAIL_DEFAULT_ENABLED_TRIGGERS,
  emailDefaultFor,
  inAppDefaultFor,
  NOTIFICATION_TRIGGERS,
  OPT_IN_TRIGGERS,
  pushDefaultFor,
} from "@/lib/notifications/types";

describe("emailDefaultFor", () => {
  const allTriggers = Object.values(NOTIFICATION_TRIGGERS);
  const enabledSet = new Set<string>(EMAIL_DEFAULT_ENABLED_TRIGGERS);

  it.each(allTriggers)(
    "matches EMAIL_DEFAULT_ENABLED_TRIGGERS membership for trigger '%s'",
    (trigger) => {
      expect(emailDefaultFor(trigger)).toBe(enabledSet.has(trigger));
    }
  );

  it("enables email by default for exactly the 7 documented 'about you' triggers", () => {
    const enabled = allTriggers.filter((trigger) => emailDefaultFor(trigger));
    expect(enabled.sort()).toEqual([...EMAIL_DEFAULT_ENABLED_TRIGGERS].sort());
  });

  it("defaults ambient/activity triggers (not about the recipient) to email off", () => {
    expect(emailDefaultFor(NOTIFICATION_TRIGGERS.TASK_CREATED)).toBe(false);
    expect(emailDefaultFor(NOTIFICATION_TRIGGERS.TASK_STATUS_CHANGED)).toBe(
      false
    );
    expect(emailDefaultFor(NOTIFICATION_TRIGGERS.SPRINT_STARTED)).toBe(false);
  });

  it("returns false for a trigger string that isn't in NOTIFICATION_TRIGGERS at all", () => {
    expect(emailDefaultFor("not_a_real_trigger")).toBe(false);
  });
});

describe("in-app / push defaults", () => {
  const allTriggers = Object.values(NOTIFICATION_TRIGGERS);

  it("only the opt-in triggers default off; every other trigger stays on", () => {
    const off = allTriggers.filter((t) => !inAppDefaultFor(t));
    expect(off).toEqual([...OPT_IN_TRIGGERS]);
    expect(allTriggers.filter((t) => !pushDefaultFor(t))).toEqual([
      ...OPT_IN_TRIGGERS,
    ]);
  });

  it("task_created is opt-in, task_assigned is not", () => {
    expect(inAppDefaultFor(NOTIFICATION_TRIGGERS.TASK_CREATED)).toBe(false);
    expect(pushDefaultFor(NOTIFICATION_TRIGGERS.TASK_CREATED)).toBe(false);
    expect(inAppDefaultFor(NOTIFICATION_TRIGGERS.TASK_ASSIGNED)).toBe(true);
    expect(pushDefaultFor(NOTIFICATION_TRIGGERS.TASK_ASSIGNED)).toBe(true);
  });
});
