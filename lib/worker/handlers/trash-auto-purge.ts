import type { Job } from "pg-boss";
import { findExpiredTrashedTaskIds, purgeTrashedTask } from "@/lib/trash";
import { trashRetentionCutoff } from "@/lib/trash-retention";

export interface TrashAutoPurgeStats {
  batches: number;
  failed: number;
  purged: number;
  skipped: number;
  /** True when the time budget ran out; the next run (or startup catch-up) continues. */
  timedOut: boolean;
}

// Permanently deletes tasks that have been in the Trash for 30+ days
// (`deletedAt <= now - 30d`). Stateless: every run re-queries by deletedAt, so a
// missed schedule slot / worker downtime is caught up by the next run — it never
// depends on pg-boss backfilling. Overlapping runs and concurrent restore /
// manual "Delete forever" are safe: purgeTrashedTask locks + re-checks each row.
export async function runTrashAutoPurge(
  opts: { batchSize?: number; budgetMs?: number; now?: Date } = {}
): Promise<TrashAutoPurgeStats> {
  const { batchSize = 100, budgetMs = 10 * 60 * 1000, now = new Date() } = opts;
  const cutoff = trashRetentionCutoff(now);
  const startedAt = Date.now();
  const stats: TrashAutoPurgeStats = {
    batches: 0,
    purged: 0,
    failed: 0,
    skipped: 0,
    timedOut: false,
  };

  let afterId: string | undefined;
  for (;;) {
    if (Date.now() - startedAt > budgetMs) {
      stats.timedOut = true;
      break;
    }
    const ids = await findExpiredTrashedTaskIds({
      cutoff,
      afterId,
      limit: batchSize,
    });
    if (ids.length === 0) {
      break;
    }
    stats.batches += 1;
    afterId = ids[ids.length - 1];

    for (const id of ids) {
      const outcome = await purgeTrashedTask(id, {
        reason: "retention",
        cutoff,
      });
      if (outcome.status === "purged") {
        stats.purged += outcome.ids.length;
      } else if (outcome.status === "failed") {
        stats.failed += 1;
      } else {
        stats.skipped += 1;
      }
    }
  }
  return stats;
}

export async function handleTrashAutoPurge(
  _jobs: Job<Record<string, never>>[]
) {
  const stats = await runTrashAutoPurge();
  console.log("[trash-auto-purge] done", stats);
}
