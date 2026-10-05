import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUEUE_OPTIONS } from "@/lib/worker/ensure-queues";
import {
  JOB_NAMES,
  SPRINT_AUTO_CLOSE_CRON,
  TRASH_AUTO_PURGE_CRON,
} from "@/lib/worker/job-types";

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

describe("trash auto-purge job registration", () => {
  it("has a queue and the agreed name", () => {
    expect(JOB_NAMES.TRASH_AUTO_PURGE).toBe("trash.auto-purge");
    expect(QUEUE_OPTIONS[JOB_NAMES.TRASH_AUTO_PURGE]).toBeDefined();
  });

  it("is scheduled daily", () => {
    const [minute, hour, dom, month, dow] = TRASH_AUTO_PURGE_CRON.split(" ");
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect([dom, month, dow]).toEqual(["*", "*", "*"]);
  });

  it("startWorker registers the handler, the schedule and a boot-time catch-up run", () => {
    const src = readFileSync(join(import.meta.dirname, "boss.ts"), "utf8");
    expect(src).toContain(
      "work(JOB_NAMES.TRASH_AUTO_PURGE, handleTrashAutoPurge)"
    );
    expect(src).toContain(
      "boss.schedule(JOB_NAMES.TRASH_AUTO_PURGE, TRASH_AUTO_PURGE_CRON"
    );
    expect(src).toContain("boss.send(JOB_NAMES.TRASH_AUTO_PURGE");
  });
});
