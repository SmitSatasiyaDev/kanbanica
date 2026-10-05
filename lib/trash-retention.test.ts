import { describe, expect, it } from "vitest";
import {
  isTrashPurgeEligible,
  TRASH_RETENTION_DAYS,
  trashDaysRemaining,
  trashRetentionCutoff,
} from "@/lib/trash-retention";

const NOW = new Date("2026-10-05T12:00:00Z");
const daysAgo = (d: number, extraMs = 0) =>
  new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000 - extraMs);

describe("trash retention", () => {
  it("is 30 days", () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
    expect(trashRetentionCutoff(NOW).toISOString()).toBe(
      "2026-09-05T12:00:00.000Z"
    );
  });

  it.each([
    [5, false],
    [29, false],
    [30, true],
    [31, true],
  ])("deleted %i days ago → eligible=%s", (days, eligible) => {
    expect(isTrashPurgeEligible(daysAgo(days), NOW)).toBe(eligible);
  });

  it("is not eligible 1ms before the 30-day mark", () => {
    expect(isTrashPurgeEligible(daysAgo(30, -1), NOW)).toBe(false);
  });

  it.each([
    [0, 30],
    [15, 15],
    [29, 1],
  ])("deleted %i days ago → %id remaining", (days, left) => {
    expect(trashDaysRemaining(daysAgo(days), NOW)).toBe(left);
  });

  it("never goes negative: eligible tasks show 0 (pending purge)", () => {
    expect(trashDaysRemaining(daysAgo(30), NOW)).toBe(0);
    expect(trashDaysRemaining(daysAgo(90), NOW)).toBe(0);
  });
});
