"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { webActor } from "@/lib/services/actor";
import { listMyTasks, type MyTask } from "@/lib/services/task-service";

// Defined in the task service (shared with the MCP endpoint); re-exported so
// existing imports from this module keep working.
export type { MyTask } from "@/lib/services/task-service";

export type MyTasksGroupBy =
  | "due_date"
  | "workspace"
  | "space"
  | "list"
  | "priority"
  | "status";

/**
 * Personal task list — every task assigned to the current user across ALL their
 * workspaces (not just the one being viewed), respecting the space access model.
 */
export async function getMyTasks(options?: {
  showCompleted?: boolean;
}): Promise<{ tasks: MyTask[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // The web page has always loaded every task, so no limit here.
  const res = await listMyTasks(webActor(session), {
    includeCompleted: options?.showCompleted,
    limit: null,
  });
  if ("error" in res) {
    return { error: res.error };
  }
  return { tasks: res.tasks };
}
