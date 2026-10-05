import { isNull } from "drizzle-orm";
import { task } from "@/db/schema";

// Single source of truth for "this task is not in the Trash". Every read of the
// `task` table (except the Trash itself) must AND this in — a trashed task is
// invisible everywhere until restored or permanently purged.
export function notDeleted() {
  return isNull(task.deletedAt);
}
