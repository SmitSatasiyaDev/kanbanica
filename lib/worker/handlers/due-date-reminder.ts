import { and, eq, gte, lt, not } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  listStatus,
  notification,
  task,
  taskAssignee,
  taskWatcher,
} from "@/db/schema";
import { db } from "@/lib/db";
import { createNotifications } from "@/lib/notifications/create-notification";
import { notDeleted } from "@/lib/task-visibility";

export async function handleDueDateReminder(
  _jobs: Job<Record<string, never>>[]
) {
  const now = new Date();

  // Start of today (UTC)
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStart = todayEnd;
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

  // Tasks due tomorrow (1-day reminder)
  const dueTomorrow = await db
    .select({ id: task.id, title: task.title, workspaceId: task.workspaceId })
    .from(task)
    .innerJoin(listStatus, eq(listStatus.id, task.statusId))
    .where(
      and(
        gte(task.dueDateEnd, tomorrowStart),
        lt(task.dueDateEnd, tomorrowEnd),
        notDeleted(),
        eq(task.isArchived, false),
        not(eq(listStatus.type, "CLOSED"))
      )
    );

  // Tasks due today
  const dueToday = await db
    .select({ id: task.id, title: task.title, workspaceId: task.workspaceId })
    .from(task)
    .innerJoin(listStatus, eq(listStatus.id, task.statusId))
    .where(
      and(
        gte(task.dueDateEnd, todayStart),
        lt(task.dueDateEnd, todayEnd),
        notDeleted(),
        eq(task.isArchived, false),
        not(eq(listStatus.type, "CLOSED"))
      )
    );

  // Overdue tasks (due yesterday, not closed)
  const overdueTasks = await db
    .select({ id: task.id, title: task.title, workspaceId: task.workspaceId })
    .from(task)
    .innerJoin(listStatus, eq(listStatus.id, task.statusId))
    .where(
      and(
        gte(task.dueDateEnd, yesterdayStart),
        lt(task.dueDateEnd, todayStart),
        notDeleted(),
        eq(task.isArchived, false),
        not(eq(listStatus.type, "CLOSED"))
      )
    );

  async function getTaskRecipients(taskId: string): Promise<string[]> {
    const [assignees, watchers] = await Promise.all([
      db
        .select({ userId: taskAssignee.userId })
        .from(taskAssignee)
        .where(eq(taskAssignee.taskId, taskId)),
      db
        .select({ userId: taskWatcher.userId })
        .from(taskWatcher)
        .where(eq(taskWatcher.taskId, taskId)),
    ]);
    return [
      ...new Set([
        ...assignees.map((a) => a.userId),
        ...watchers.map((w) => w.userId),
      ]),
    ];
  }

  async function alreadyNotified(
    taskId: string,
    triggerType: string
  ): Promise<boolean> {
    const todayNotifs = await db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.entityId, taskId),
          eq(notification.triggerType, triggerType),
          gte(notification.createdAt, todayStart)
        )
      )
      .limit(1);
    return todayNotifs.length > 0;
  }

  for (const t of dueTomorrow) {
    if (await alreadyNotified(t.id, "due_date_reminder_1day")) {
      continue;
    }
    const recipients = await getTaskRecipients(t.id);
    if (recipients.length === 0) {
      continue;
    }
    createNotifications({
      workspaceId: t.workspaceId,
      actorId: null,
      recipientIds: recipients,
      triggerType: "due_date_reminder_1day",
      entityType: "TASK",
      entityId: t.id,
      title: `Task "${t.title}" is due tomorrow`,
    });
  }

  for (const t of dueToday) {
    if (await alreadyNotified(t.id, "due_date_today")) {
      continue;
    }
    const recipients = await getTaskRecipients(t.id);
    if (recipients.length === 0) {
      continue;
    }
    createNotifications({
      workspaceId: t.workspaceId,
      actorId: null,
      recipientIds: recipients,
      triggerType: "due_date_today",
      entityType: "TASK",
      entityId: t.id,
      title: `Task "${t.title}" is due today`,
    });
  }

  for (const t of overdueTasks) {
    if (await alreadyNotified(t.id, "task_overdue")) {
      continue;
    }
    const recipients = await getTaskRecipients(t.id);
    if (recipients.length === 0) {
      continue;
    }
    createNotifications({
      workspaceId: t.workspaceId,
      actorId: null,
      recipientIds: recipients,
      triggerType: "task_overdue",
      entityType: "TASK",
      entityId: t.id,
      title: `Task "${t.title}" is overdue`,
    });
  }

  console.log("[due-date-reminder] processed", {
    dueTomorrow: dueTomorrow.length,
    dueToday: dueToday.length,
    overdue: overdueTasks.length,
  });
}
