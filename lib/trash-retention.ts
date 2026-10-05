// Pure/client-safe Trash retention rules. The clock starts at `task.deletedAt`
// (when the task was moved to the Trash) — never createdAt/updatedAt/archivedAt.

export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A trashed task is purge-eligible when `deletedAt <= trashRetentionCutoff(now)`. */
export function trashRetentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS);
}

export function isTrashPurgeEligible(
  deletedAt: Date,
  now: Date = new Date()
): boolean {
  return deletedAt.getTime() <= trashRetentionCutoff(now).getTime();
}

/** Whole days left before the automatic purge; 0 = eligible (pending purge). Never negative. */
export function trashDaysRemaining(
  deletedAt: Date,
  now: Date = new Date()
): number {
  const msLeft =
    deletedAt.getTime() + TRASH_RETENTION_DAYS * DAY_MS - now.getTime();
  return msLeft <= 0 ? 0 : Math.ceil(msLeft / DAY_MS);
}
