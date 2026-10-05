"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { task, timeEntry } from "@/db/schema";
import { writeActivityLog } from "@/lib/activity-log";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getSpacePermission,
  hasPermissionLevel,
  requireEditAccess,
} from "@/lib/permissions";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { notDeleted } from "@/lib/task-visibility";

// Scoped refresh: revalidate the list page (card badges) and hint the open task
// detail so only THAT task's view refetches.
function revalidateList(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string
) {
  void refreshWorkspace(
    workspaceId,
    [`/${workspaceId}/${spaceId}/list/${listId}`],
    { taskId }
  );
}

const secondsBetween = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

// ─── Start / stop the live timer ──────────────────────────────────────────────

// Start a timer on `taskId`. At most one timer runs per user, so if the caller
// already has a running timer (on any task) it is auto-stopped first. Returns
// the started task's title plus, when one was auto-stopped, the stopped task's
// title (for a two-line toast).
export async function startTimer(
  workspaceId: string,
  spaceId: string,
  _listId: string,
  taskId: string
): Promise<
  { startedTitle: string; stopped?: { title: string } } | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const userId = session.user.id;
  const now = new Date();

  type StoppedInfo = {
    title: string;
    workspaceId: string;
    taskId: string;
    seconds: number;
  };

  const { startedTitle, stopped: stoppedInfo } = await db.transaction(
    async (tx) => {
      const [startedTask] = await tx
        .select({ title: task.title })
        .from(task)
        .where(and(eq(task.id, taskId), notDeleted()))
        .limit(1);

      // Auto-stop the caller's current running timer, if any.
      const [running] = await tx
        .select({
          id: timeEntry.id,
          taskId: timeEntry.taskId,
          workspaceId: timeEntry.workspaceId,
          startTime: timeEntry.startTime,
        })
        .from(timeEntry)
        .where(and(eq(timeEntry.userId, userId), isNull(timeEntry.endTime)))
        .limit(1);

      let stopped: StoppedInfo | null = null;
      if (running) {
        const seconds = secondsBetween(running.startTime, now);
        await tx
          .update(timeEntry)
          .set({ endTime: now, durationSeconds: seconds, updatedAt: now })
          .where(eq(timeEntry.id, running.id));

        const [prevTask] = await tx
          .select({ title: task.title })
          .from(task)
          .where(and(eq(task.id, running.taskId), notDeleted()))
          .limit(1);
        stopped = {
          title: prevTask?.title ?? "task",
          workspaceId: running.workspaceId,
          taskId: running.taskId,
          seconds,
        };
      }

      await tx.insert(timeEntry).values({
        id: createId(),
        taskId,
        workspaceId,
        userId,
        startTime: now,
        endTime: null,
        durationSeconds: null,
      });

      return { startedTitle: startedTask?.title ?? "task", stopped };
    }
  );

  if (stoppedInfo) {
    await writeActivityLog(stoppedInfo.taskId, userId, "timer_stopped", {
      seconds: stoppedInfo.seconds,
    });
  }
  await writeActivityLog(taskId, userId, "timer_started");

  // Generic refresh — updates card badges and any open task view. Two tasks may
  // be involved (started + auto-stopped), so refresh both workspaces.
  await refreshWorkspace(workspaceId);
  if (stoppedInfo && stoppedInfo.workspaceId !== workspaceId) {
    await refreshWorkspace(stoppedInfo.workspaceId);
  }

  return stoppedInfo
    ? { startedTitle, stopped: { title: stoppedInfo.title } }
    : { startedTitle };
}

// Stop the caller's running timer on `taskId`. Returns the stopped entry's id
// so the UI can attach an optional note to it right after (see
// `setTimeEntryNote`) — the note is collected *after* the stop on purpose, so
// the time spent typing it never lands inside the tracked duration.
export async function stopTimer(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string
): Promise<{ ok: true; entryId: string; seconds: number } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const now = new Date();
  const [running] = await db
    .select({ id: timeEntry.id, startTime: timeEntry.startTime })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.taskId, taskId),
        eq(timeEntry.userId, session.user.id),
        isNull(timeEntry.endTime)
      )
    )
    .limit(1);

  if (!running) {
    return { error: "No running timer" };
  }

  const seconds = secondsBetween(running.startTime, now);
  await db
    .update(timeEntry)
    .set({ endTime: now, durationSeconds: seconds, updatedAt: now })
    .where(eq(timeEntry.id, running.id));

  await writeActivityLog(taskId, session.user.id, "timer_stopped", { seconds });
  revalidateList(workspaceId, spaceId, listId, taskId);
  return { ok: true, entryId: running.id, seconds };
}

// ─── Note on an entry ─────────────────────────────────────────────────────────

// Set (or clear) the note on a completed time entry. Same permission rule as
// deleting one: its author, or a user with full access. An empty note is valid
// and clears the field. No activity log — the entry's own history row shows it.
export async function setTimeEntryNote(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  entryId: string,
  note: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [entry] = await db
    .select({ userId: timeEntry.userId })
    .from(timeEntry)
    .where(and(eq(timeEntry.id, entryId), eq(timeEntry.taskId, taskId)))
    .limit(1);

  if (!entry) {
    return { error: "Time entry not found" };
  }

  if (entry.userId !== session.user.id) {
    const permission = await getSpacePermission(
      session.user.id,
      workspaceId,
      spaceId
    );
    if (!permission || !hasPermissionLevel(permission, "full_access")) {
      return { error: "You can only edit your own time entries" };
    }
  }

  await db
    .update(timeEntry)
    .set({ description: note.trim() || null, updatedAt: new Date() })
    .where(and(eq(timeEntry.id, entryId), eq(timeEntry.taskId, taskId)));

  revalidateList(workspaceId, spaceId, listId, taskId);
  return { ok: true };
}

// ─── Manual logging ───────────────────────────────────────────────────────────

// Log a completed block of time. `date` is an ISO date string; the entry's
// start and end are both set to it (it is not a real interval).
export async function logTime(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  input: { hours: number; minutes: number; date: string; description?: string }
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const hours = Math.max(0, Math.floor(input.hours || 0));
  const minutes = Math.max(0, Math.floor(input.minutes || 0));
  const durationSeconds = hours * 3600 + minutes * 60;
  if (durationSeconds <= 0) {
    return { error: "Duration must be positive" };
  }

  const when = new Date(input.date);
  if (Number.isNaN(when.getTime())) {
    return { error: "Invalid date" };
  }

  const description = input.description?.trim() || null;

  await db.insert(timeEntry).values({
    id: createId(),
    taskId,
    workspaceId,
    userId: session.user.id,
    startTime: when,
    endTime: when,
    durationSeconds,
    description,
  });

  await writeActivityLog(taskId, session.user.id, "time_logged", {
    seconds: durationSeconds,
    note: description,
  });
  revalidateList(workspaceId, spaceId, listId, taskId);
  return { ok: true };
}

// ─── Delete an entry ──────────────────────────────────────────────────────────

// Delete a time entry. Allowed for its author, or a user with full access
// (owner/admin/space full-access). No activity log — keeps the feed quiet.
export async function deleteTimeEntry(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  entryId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) {
    return err;
  }

  const [entry] = await db
    .select({ userId: timeEntry.userId })
    .from(timeEntry)
    .where(and(eq(timeEntry.id, entryId), eq(timeEntry.taskId, taskId)))
    .limit(1);

  if (!entry) {
    return { error: "Time entry not found" };
  }

  if (entry.userId !== session.user.id) {
    const permission = await getSpacePermission(
      session.user.id,
      workspaceId,
      spaceId
    );
    if (!permission || !hasPermissionLevel(permission, "full_access")) {
      return { error: "You can only delete your own time entries" };
    }
  }

  await db
    .delete(timeEntry)
    .where(and(eq(timeEntry.id, entryId), eq(timeEntry.taskId, taskId)));
  revalidateList(workspaceId, spaceId, listId, taskId);
  return { ok: true };
}
