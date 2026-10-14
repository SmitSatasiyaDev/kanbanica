import { and, eq, gte, inArray, not } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  listStatus,
  notification,
  task,
  taskAssignee,
  taskWatcher,
  user,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  addDays,
  resolveTimezone,
  startOfDayInTz,
  todayInTz,
} from "@/lib/due-date";
import { createNotifications } from "@/lib/notifications/create-notification";
import { notDeleted } from "@/lib/task-visibility";

type Trigger = "due_date_reminder_1day" | "due_date_today" | "task_overdue";

const TRIGGERS: Trigger[] = [
  "due_date_reminder_1day",
  "due_date_today",
  "task_overdue",
];

function titleFor(trigger: Trigger, taskTitle: string): string {
  switch (trigger) {
    case "due_date_reminder_1day":
      return `Task "${taskTitle}" is due tomorrow`;
    case "due_date_today":
      return `Task "${taskTitle}" is due today`;
    default:
      return `Task "${taskTitle}" is overdue`;
  }
}

/**
 * Due dates are calendar days, so "tomorrow / today / yesterday" depends on who
 * is being reminded. The job runs hourly for the whole platform; each run
 * groups users by their own timezone (`user.timezone`) and, per group, finds
 * the tasks whose due day is tomorrow / today / yesterday *in that zone*. A
 * reminder therefore goes out in the first hourly run after the recipient's
 * local midnight, once per recipient per local day (deduped against
 * notifications created since that midnight).
 */
export async function handleDueDateReminder(
  _jobs: Job<Record<string, never>>[]
) {
  const now = new Date();

  // Raw timezone strings in use, grouped by the zone they resolve to (an
  // invalid stored value resolves to UTC).
  const tzRows = await db.selectDistinct({ tz: user.timezone }).from(user);
  const rawByZone = new Map<string, string[]>();
  for (const { tz } of tzRows) {
    const zone = resolveTimezone(tz);
    rawByZone.set(zone, [...(rawByZone.get(zone) ?? []), tz]);
  }

  const counts = { dueTomorrow: 0, dueToday: 0, overdue: 0 };

  for (const [zone, rawZones] of rawByZone) {
    const today = todayInTz(zone, now);
    const tomorrow = addDays(today, 1);
    const yesterday = addDays(today, -1);
    const dayStart = startOfDayInTz(zone, now);

    const triggerForDay = (dueDay: string | null): Trigger | null => {
      if (dueDay === tomorrow) {
        return "due_date_reminder_1day";
      }
      if (dueDay === today) {
        return "due_date_today";
      }
      if (dueDay === yesterday) {
        return "task_overdue";
      }
      return null;
    };

    // Open, live tasks due in the window, with the people in this zone who
    // follow them (assignees and watchers).
    const taskFilter = and(
      inArray(task.dueDateEnd, [yesterday, today, tomorrow]),
      notDeleted(),
      eq(task.isArchived, false),
      not(eq(listStatus.type, "CLOSED"))
    );
    const followedTasks = (
      userId: typeof taskAssignee.userId | typeof taskWatcher.userId
    ) =>
      db
        .select({
          id: task.id,
          title: task.title,
          workspaceId: task.workspaceId,
          dueDateEnd: task.dueDateEnd,
          userId,
        })
        .from(task)
        .innerJoin(listStatus, eq(listStatus.id, task.statusId));

    const [assigneeRows, watcherRows] = await Promise.all([
      followedTasks(taskAssignee.userId)
        .innerJoin(taskAssignee, eq(taskAssignee.taskId, task.id))
        .innerJoin(user, eq(user.id, taskAssignee.userId))
        .where(and(taskFilter, inArray(user.timezone, rawZones))),
      followedTasks(taskWatcher.userId)
        .innerJoin(taskWatcher, eq(taskWatcher.taskId, task.id))
        .innerJoin(user, eq(user.id, taskWatcher.userId))
        .where(and(taskFilter, inArray(user.timezone, rawZones))),
    ]);

    // One entry per (task, trigger) with its de-duplicated recipients.
    const groups = new Map<
      string,
      {
        taskId: string;
        title: string;
        workspaceId: string;
        trigger: Trigger;
        recipients: Set<string>;
      }
    >();
    for (const r of [...assigneeRows, ...watcherRows]) {
      const trigger = triggerForDay(r.dueDateEnd);
      if (!trigger) {
        continue;
      }
      const key = `${r.id}:${trigger}`;
      const group = groups.get(key) ?? {
        taskId: r.id,
        title: r.title,
        workspaceId: r.workspaceId,
        trigger,
        recipients: new Set<string>(),
      };
      group.recipients.add(r.userId);
      groups.set(key, group);
    }
    if (groups.size === 0) {
      continue;
    }

    // Already reminded since this zone's local midnight? (per recipient)
    const sent = await db
      .select({
        entityId: notification.entityId,
        recipientId: notification.recipientId,
        triggerType: notification.triggerType,
      })
      .from(notification)
      .where(
        and(
          inArray(
            notification.entityId,
            [...groups.values()].map((g) => g.taskId)
          ),
          inArray(notification.triggerType, TRIGGERS),
          gte(notification.createdAt, dayStart)
        )
      );
    const alreadySent = new Set(
      sent.map((n) => `${n.entityId}:${n.triggerType}:${n.recipientId}`)
    );

    for (const g of groups.values()) {
      const recipientIds = [...g.recipients].filter(
        (id) => !alreadySent.has(`${g.taskId}:${g.trigger}:${id}`)
      );
      if (recipientIds.length === 0) {
        continue;
      }
      createNotifications({
        workspaceId: g.workspaceId,
        actorId: null,
        recipientIds,
        triggerType: g.trigger,
        entityType: "TASK",
        entityId: g.taskId,
        title: titleFor(g.trigger, g.title),
      });
      if (g.trigger === "due_date_reminder_1day") {
        counts.dueTomorrow++;
      } else if (g.trigger === "due_date_today") {
        counts.dueToday++;
      } else {
        counts.overdue++;
      }
    }
  }

  console.log("[due-date-reminder] processed", {
    dueTomorrow: counts.dueTomorrow,
    dueToday: counts.dueToday,
    overdue: counts.overdue,
  });
}
