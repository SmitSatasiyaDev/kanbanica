import { describe, expect, it } from "vitest";
import { QUEUE_OPTIONS } from "@/lib/worker/ensure-queues";
import { JOB_NAMES, SPRINT_AUTO_CLOSE_CRON } from "@/lib/worker/job-types";

describe("sprint auto-close job registration", () => {
  it("has a queue defined for the job", () => {
    expect(QUEUE_OPTIONS[JOB_NAMES.SPRINT_AUTO_CLOSE]).toBeDefined();
    expect(JOB_NAMES.SPRINT_AUTO_CLOSE).toBe("sprint.auto-close");
  });

  it("runs at least hourly so a missed slot is recovered quickly", () => {
    const [minute, hour] = SPRINT_AUTO_CLOSE_CRON.split(" ");
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toBe("*");
  });
});
