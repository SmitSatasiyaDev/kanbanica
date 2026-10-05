"use server";

import { createId } from "@paralleldrive/cuid2";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  startOfDay,
  subDays,
} from "date-fns";
import { and, asc, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
import {
  activityLog,
  list,
  listStatus,
  space,
  sprint,
  task,
  taskAssignee,
  taskSprint,
  user,
  workspaceMember,
  workspaceOverviewSnapshot,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import type { DashboardCategory } from "@/lib/dashboard-category";
import { db } from "@/lib/db";
import { getAccessibleSpaceIds } from "@/lib/permissions";
import type { Priority } from "@/lib/priority-config";
import { workspaceOverviewCacheTag } from "@/lib/realtime/cache-tags";
import { notDeleted } from "@/lib/task-visibility";

// Analytics-only classification, independent of `listStatus.type` (which
// drives Board/List column grouping) and independent of status *name* — set
// per-status via `listStatus.dashboardCategory`. Every widget below buckets
// on this instead of hardcoded status names, so custom workflows (QA,
// Blocked, Ready for Release, ...) analyze correctly. Shared definition in
// lib/dashboard-category.ts so status-creation UIs use the same options.
export type { DashboardCategory } from "@/lib/dashboard-category";

export type MyFocusKind = "overdue" | "dueToday" | "review" | "assigned";

export interface WorkspaceOverviewTaskRef {
  dueDate: Date | null;
  id: string;
  listId: string;
  listName: string;
  priority: Priority;
  seqNumber: number;
  spaceId: string;
  spaceName: string;
  title: string;
}

export interface WorkspaceOverviewData {
  activeSprints: {
    id: string;
    name: string;
    spaceId: string;
    spaceName: string;
    startDate: Date | null;
    endDate: Date | null;
    totalTasks: number;
    completedTasks: number;
    completionPercent: number;
    daysRemaining: number | null;
  }[];
  assigneeWorkload: {
    userId: string;
    name: string;
    email: string;
    image: string | null;
    assignedCount: number;
    completedCount: number;
    activeCount: number;
    completionPercent: number;
    overdueCount: number;
    averageAgeDays: number | null;
  }[];
  myFocus: {
    overdueCount: number;
    dueTodayCount: number;
    reviewCount: number;
    assignedCount: number;
  };
  priorityBreakdown: { priority: Priority; count: number }[];
  projects: {
    id: string;
    name: string;
    color: string | null;
    logoEmoji: string | null;
    taskCount: number;
    completedCount: number;
    completedPercent: number;
    openCount: number;
    overdueCount: number;
  }[];
  recentActivity: {
    id: string;
    taskId: string;
    taskSeq: number;
    taskTitle: string;
    spaceId: string;
    spaceName: string;
    eventType: string;
    meta: unknown;
    /** Only set for `status_changed` — the target status's analytics category, so the UI can show ✅ for a completion instead of the generic status-change icon. */
    toDashboardCategory: DashboardCategory | null;
    createdAt: Date;
    actorName: string | null;
    actorEmail: string | null;
    actorImage: string | null;
  }[];
  statusBreakdown: { type: DashboardCategory; label: string; count: number }[];
  summary: {
    totalTasks: number;
    completedTasks: number;
    completedThisWeek: number;
    inProgressTasks: number;
    startedThisWeek: number;
    overdueTasks: number;
    /** overdueTasks minus yesterday's snapshot; null if no snapshot exists yet (e.g. first day). */
    overdueDeltaFromYesterday: number | null;
    dueToday: number;
    activeProjects: number;
    activeSprints: number;
    completionPercent: number;
  };
  upcomingDeadlines: {
    overdue: WorkspaceOverviewDeadlineBucket;
    dueToday: WorkspaceOverviewDeadlineBucket;
    dueTomorrow: WorkspaceOverviewDeadlineBucket;
    next7Days: WorkspaceOverviewDeadlineBucket;
  };
}

export interface WorkspaceOverviewDeadlineBucket {
  /** Top 3, sorted by urgency — just enough for the dashboard preview. */
  tasks: WorkspaceOverviewTaskRef[];
  /** True count in the bucket, so the UI can render "+N more" accurately. */
  total: number;
}

export type DeadlineBucket =
  | "overdue"
  | "dueToday"
  | "dueTomorrow"
  | "next7Days"
  | "all";

const STATUS_LABELS: Record<DashboardCategory, string> = {
  OPEN: "Todo",
  WORKING: "Working",
  REVIEW: "Review",
  COMPLETED: "Completed",
};

const PRIORITY_ORDER: Priority[] = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];
const PRIORITY_RANK: Record<Priority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
};

// Due date ascending (oldest-overdue / soonest-due first), then higher priority first.
function sortByUrgency(
  a: WorkspaceOverviewTaskRef,
  b: WorkspaceOverviewTaskRef
): number {
  const dueDiff = (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0);
  if (dueDiff !== 0) {
    return dueDiff;
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

const DEADLINE_PREVIEW_CAP = 3;
const ACTIVITY_LIMIT = 20;

function emptyOverview(): WorkspaceOverviewData {
  return {
    summary: {
      totalTasks: 0,
      completedTasks: 0,
      completedThisWeek: 0,
      inProgressTasks: 0,
      startedThisWeek: 0,
      overdueTasks: 0,
      overdueDeltaFromYesterday: null,
      dueToday: 0,
      activeProjects: 0,
      activeSprints: 0,
      completionPercent: 0,
    },
    statusBreakdown: (
      ["OPEN", "WORKING", "REVIEW", "COMPLETED"] as DashboardCategory[]
    ).map((type) => ({
      type,
      label: STATUS_LABELS[type],
      count: 0,
    })),
    myFocus: {
      overdueCount: 0,
      dueTodayCount: 0,
      reviewCount: 0,
      assignedCount: 0,
    },
    priorityBreakdown: PRIORITY_ORDER.map((priority) => ({
      priority,
      count: 0,
    })),
    projects: [],
    assigneeWorkload: [],
    activeSprints: [],
    recentActivity: [],
    upcomingDeadlines: {
      overdue: { tasks: [], total: 0 },
      dueToday: { tasks: [], total: 0 },
      dueTomorrow: { tasks: [], total: 0 },
      next7Days: { tasks: [], total: 0 },
    },
  };
}

export async function getWorkspaceOverview(
  workspaceId: string
): Promise<WorkspaceOverviewData | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const load = unstable_cache(
    () => buildWorkspaceOverview(workspaceId, session.user.id),
    ["workspace-overview", workspaceId, session.user.id],
    { tags: [workspaceOverviewCacheTag(workspaceId)], revalidate: 60 }
  );
  return load();
}

async function buildWorkspaceOverview(
  workspaceId: string,
  userId: string
): Promise<WorkspaceOverviewData> {
  const accessibleSpaceIds = await getAccessibleSpaceIds(userId, workspaceId);
  if (accessibleSpaceIds.length === 0) {
    return emptyOverview();
  }

  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const next7End = addDays(today, 7);

  const [taskRows, spaceRows, sprintRows] = await Promise.all([
    db
      .select({
        id: task.id,
        seqNumber: task.seqNumber,
        title: task.title,
        priority: task.priority,
        createdAt: task.createdAt,
        dueDateStart: task.dueDateStart,
        dueDateEnd: task.dueDateEnd,
        listId: list.id,
        listName: list.name,
        spaceId: space.id,
        spaceName: space.name,
        dashboardCategory: listStatus.dashboardCategory,
      })
      .from(task)
      .innerJoin(list, eq(task.listId, list.id))
      .innerJoin(space, eq(list.spaceId, space.id))
      .innerJoin(listStatus, eq(task.statusId, listStatus.id))
      .where(
        and(
          inArray(space.id, accessibleSpaceIds),
          notDeleted(),
          eq(task.isArchived, false),
          eq(list.isArchived, false),
          isNull(task.parentTaskId)
        )
      ),
    db
      .select({
        id: space.id,
        name: space.name,
        color: space.color,
        logoEmoji: space.logoEmoji,
      })
      .from(space)
      .where(inArray(space.id, accessibleSpaceIds)),
    db
      .select({
        id: sprint.id,
        name: sprint.name,
        spaceId: sprint.spaceId,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
      })
      .from(sprint)
      .where(
        and(
          inArray(sprint.spaceId, accessibleSpaceIds),
          eq(sprint.status, "ACTIVE")
        )
      ),
  ]);

  const spaceNameById = new Map(spaceRows.map((s) => [s.id, s.name]));
  const effectiveDue = (r: {
    dueDateStart: Date | null;
    dueDateEnd: Date | null;
  }) => r.dueDateEnd ?? r.dueDateStart;

  const toRef = (r: (typeof taskRows)[number]): WorkspaceOverviewTaskRef => ({
    id: r.id,
    seqNumber: r.seqNumber,
    title: r.title,
    priority: r.priority as Priority,
    dueDate: effectiveDue(r),
    spaceId: r.spaceId,
    spaceName: r.spaceName,
    listId: r.listId,
    listName: r.listName,
  });

  // ─── Summary + status/priority breakdown + deadline buckets (derived in JS from one task query) ───
  let completedTasks = 0;
  let inProgressTasks = 0;
  const statusCounts: Record<DashboardCategory, number> = {
    OPEN: 0,
    WORKING: 0,
    REVIEW: 0,
    COMPLETED: 0,
  };
  const priorityCounts: Record<Priority, number> = {
    NONE: 0,
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    URGENT: 0,
  };
  const overdueRefs: WorkspaceOverviewTaskRef[] = [];
  const dueTodayRefs: WorkspaceOverviewTaskRef[] = [];
  const dueTomorrowRefs: WorkspaceOverviewTaskRef[] = [];
  const next7Refs: WorkspaceOverviewTaskRef[] = [];

  for (const r of taskRows) {
    statusCounts[r.dashboardCategory]++;
    priorityCounts[r.priority as Priority]++;
    if (r.dashboardCategory === "COMPLETED") {
      completedTasks++;
    }
    if (r.dashboardCategory === "WORKING") {
      inProgressTasks++;
    }

    if (r.dashboardCategory === "COMPLETED") {
      continue;
    }
    const due = effectiveDue(r);
    if (!due) {
      continue;
    }
    if (due < today) {
      overdueRefs.push(toRef(r));
    } else if (isSameDay(due, today)) {
      dueTodayRefs.push(toRef(r));
    } else if (isSameDay(due, tomorrow)) {
      dueTomorrowRefs.push(toRef(r));
    } else if (due > tomorrow && due <= next7End) {
      next7Refs.push(toRef(r));
    }
  }

  overdueRefs.sort(sortByUrgency);
  dueTodayRefs.sort(sortByUrgency);
  dueTomorrowRefs.sort(sortByUrgency);
  next7Refs.sort(sortByUrgency);

  // ─── Completed this week (activityLog status_changed → COMPLETED category, still that category today) ───
  const since7 = subDays(new Date(), 7);
  const statusChangeRows = await db
    .select({ taskId: activityLog.taskId, meta: activityLog.meta })
    .from(activityLog)
    .innerJoin(task, eq(activityLog.taskId, task.id))
    .innerJoin(list, eq(task.listId, list.id))
    .where(
      and(
        eq(activityLog.eventType, "status_changed"),
        gte(activityLog.createdAt, since7),
        inArray(list.spaceId, accessibleSpaceIds),
        notDeleted()
      )
    );
  const completedTaskIds = new Set(
    taskRows.filter((r) => r.dashboardCategory === "COMPLETED").map((r) => r.id)
  );
  const workingTaskIds = new Set(
    taskRows.filter((r) => r.dashboardCategory === "WORKING").map((r) => r.id)
  );
  const toStatusIds = [
    ...new Set(
      statusChangeRows
        .map((r) => (r.meta as Record<string, unknown> | null)?.to)
        .filter((v): v is string => typeof v === "string")
    ),
  ];
  const toStatusRows = toStatusIds.length
    ? await db
        .select({
          id: listStatus.id,
          dashboardCategory: listStatus.dashboardCategory,
        })
        .from(listStatus)
        .where(inArray(listStatus.id, toStatusIds))
    : [];
  const statusCategoryById = new Map(
    toStatusRows.map((s) => [s.id, s.dashboardCategory])
  );
  // Both counters intersect with the task's CURRENT category — a task that
  // moved Working → Completed this week counts only toward "completed", not
  // "started".
  const completedThisWeek = new Set(
    statusChangeRows
      .filter(
        (r) =>
          statusCategoryById.get(
            (r.meta as Record<string, unknown> | null)?.to as string
          ) === "COMPLETED"
      )
      .map((r) => r.taskId)
      .filter((id) => completedTaskIds.has(id))
  ).size;
  const startedThisWeek = new Set(
    statusChangeRows
      .filter(
        (r) =>
          statusCategoryById.get(
            (r.meta as Record<string, unknown> | null)?.to as string
          ) === "WORKING"
      )
      .map((r) => r.taskId)
      .filter((id) => workingTaskIds.has(id))
  ).size;

  // ─── Projects ───
  const projectAgg = new Map<
    string,
    {
      taskCount: number;
      completedCount: number;
      openCount: number;
      overdueCount: number;
    }
  >();
  for (const r of taskRows) {
    const agg = projectAgg.get(r.spaceId) ?? {
      taskCount: 0,
      completedCount: 0,
      openCount: 0,
      overdueCount: 0,
    };
    agg.taskCount++;
    if (r.dashboardCategory === "COMPLETED") {
      agg.completedCount++;
    } else {
      agg.openCount++;
      const due = effectiveDue(r);
      if (due && due < today) {
        agg.overdueCount++;
      }
    }
    projectAgg.set(r.spaceId, agg);
  }
  const projects = spaceRows.map((s) => {
    const agg = projectAgg.get(s.id) ?? {
      taskCount: 0,
      completedCount: 0,
      openCount: 0,
      overdueCount: 0,
    };
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      logoEmoji: s.logoEmoji,
      taskCount: agg.taskCount,
      completedCount: agg.completedCount,
      completedPercent: agg.taskCount
        ? Math.round((agg.completedCount / agg.taskCount) * 100)
        : 0,
      openCount: agg.openCount,
      overdueCount: agg.overdueCount,
    };
  });

  // ─── Assignee workload ───
  const taskById = new Map(taskRows.map((r) => [r.id, r]));
  const assigneeRows = taskRows.length
    ? await db
        .select({ taskId: taskAssignee.taskId, userId: taskAssignee.userId })
        .from(taskAssignee)
        .where(
          inArray(
            taskAssignee.taskId,
            taskRows.map((r) => r.id)
          )
        )
    : [];

  // ─── My Focus Today (current user only) ───
  const myFocus = {
    overdueCount: 0,
    dueTodayCount: 0,
    reviewCount: 0,
    assignedCount: 0,
  };
  for (const a of assigneeRows) {
    if (a.userId !== userId) {
      continue;
    }
    const t = taskById.get(a.taskId);
    if (!t) {
      continue;
    }
    myFocus.assignedCount++;
    if (t.dashboardCategory === "REVIEW") {
      myFocus.reviewCount++;
    }
    if (t.dashboardCategory === "COMPLETED") {
      continue;
    }
    const due = effectiveDue(t);
    if (!due) {
      continue;
    }
    if (due < today) {
      myFocus.overdueCount++;
    } else if (isSameDay(due, today)) {
      myFocus.dueTodayCount++;
    }
  }

  const workloadAgg = new Map<
    string,
    {
      assignedCount: number;
      completedCount: number;
      overdueCount: number;
      openAgeDaysSum: number;
      openCount: number;
    }
  >();
  for (const a of assigneeRows) {
    const t = taskById.get(a.taskId);
    if (!t) {
      continue;
    }
    const agg = workloadAgg.get(a.userId) ?? {
      assignedCount: 0,
      completedCount: 0,
      overdueCount: 0,
      openAgeDaysSum: 0,
      openCount: 0,
    };
    agg.assignedCount++;
    if (t.dashboardCategory === "COMPLETED") {
      agg.completedCount++;
    } else {
      const due = effectiveDue(t);
      if (due && due < today) {
        agg.overdueCount++;
      }
      agg.openAgeDaysSum += differenceInCalendarDays(today, t.createdAt);
      agg.openCount++;
    }
    workloadAgg.set(a.userId, agg);
  }
  const memberRows = await db
    .select({
      userId: workspaceMember.userId,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(workspaceMember.userId, user.id))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.status, "ACTIVE")
      )
    );
  const assigneeWorkload = memberRows
    .map((m) => {
      const agg = workloadAgg.get(m.userId as string) ?? {
        assignedCount: 0,
        completedCount: 0,
        overdueCount: 0,
        openAgeDaysSum: 0,
        openCount: 0,
      };
      return {
        userId: m.userId as string,
        name: m.name,
        email: m.email,
        image: m.image,
        assignedCount: agg.assignedCount,
        completedCount: agg.completedCount,
        activeCount: agg.assignedCount - agg.completedCount,
        completionPercent: agg.assignedCount
          ? Math.round((agg.completedCount / agg.assignedCount) * 100)
          : 0,
        overdueCount: agg.overdueCount,
        averageAgeDays: agg.openCount
          ? Math.round(agg.openAgeDaysSum / agg.openCount)
          : null,
      };
    })
    .sort((a, b) => b.assignedCount - a.assignedCount);

  // ─── Active sprints ───
  let activeSprints: WorkspaceOverviewData["activeSprints"] = [];
  if (sprintRows.length > 0) {
    const sprintTaskRows = await db
      .select({
        sprintId: taskSprint.sprintId,
        dashboardCategory: listStatus.dashboardCategory,
      })
      .from(taskSprint)
      .innerJoin(task, eq(taskSprint.taskId, task.id))
      .innerJoin(listStatus, eq(task.statusId, listStatus.id))
      .where(
        and(
          inArray(
            taskSprint.sprintId,
            sprintRows.map((s) => s.id)
          ),
          notDeleted(),
          eq(task.isArchived, false)
        )
      );
    const sprintAgg = new Map<string, { total: number; completed: number }>();
    for (const r of sprintTaskRows) {
      const agg = sprintAgg.get(r.sprintId) ?? { total: 0, completed: 0 };
      agg.total++;
      if (r.dashboardCategory === "COMPLETED") {
        agg.completed++;
      }
      sprintAgg.set(r.sprintId, agg);
    }
    activeSprints = sprintRows.map((s) => {
      const agg = sprintAgg.get(s.id) ?? { total: 0, completed: 0 };
      return {
        id: s.id,
        name: s.name,
        spaceId: s.spaceId,
        spaceName: spaceNameById.get(s.spaceId) ?? "",
        startDate: s.startDate,
        endDate: s.endDate,
        totalTasks: agg.total,
        completedTasks: agg.completed,
        completionPercent: agg.total
          ? Math.round((agg.completed / agg.total) * 100)
          : 0,
        daysRemaining: s.endDate
          ? Math.max(0, differenceInCalendarDays(s.endDate, today))
          : null,
      };
    });
  }

  // ─── Recent activity ───
  const activityRows = await db
    .select({
      id: activityLog.id,
      taskId: activityLog.taskId,
      taskSeq: task.seqNumber,
      taskTitle: task.title,
      spaceId: space.id,
      spaceName: space.name,
      eventType: activityLog.eventType,
      meta: activityLog.meta,
      createdAt: activityLog.createdAt,
      actorName: user.name,
      actorEmail: user.email,
      actorImage: user.image,
    })
    .from(activityLog)
    .innerJoin(task, eq(activityLog.taskId, task.id))
    .innerJoin(list, eq(task.listId, list.id))
    .innerJoin(space, eq(list.spaceId, space.id))
    .leftJoin(user, eq(activityLog.userId, user.id))
    .where(
      and(
        inArray(space.id, accessibleSpaceIds),
        eq(list.isArchived, false),
        notDeleted(),
        gte(activityLog.createdAt, subDays(new Date(), 30))
      )
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(ACTIVITY_LIMIT);

  // Resolve the target status's dashboard category for `status_changed` rows
  // in this same batch, so the feed can show ✅ for a completion instead of
  // the generic status-change icon — same lookup shape as the "Completed
  // this week" resolution above, just scoped to these 20 rows.
  const activityToStatusIds = [
    ...new Set(
      activityRows
        .filter((r) => r.eventType === "status_changed")
        .map((r) => (r.meta as Record<string, unknown> | null)?.to)
        .filter((v): v is string => typeof v === "string")
    ),
  ];
  const activityToStatusRows = activityToStatusIds.length
    ? await db
        .select({
          id: listStatus.id,
          dashboardCategory: listStatus.dashboardCategory,
        })
        .from(listStatus)
        .where(inArray(listStatus.id, activityToStatusIds))
    : [];
  const activityToCategoryById = new Map(
    activityToStatusRows.map((s) => [s.id, s.dashboardCategory])
  );
  const recentActivity = activityRows.map((r) => ({
    ...r,
    toDashboardCategory:
      r.eventType === "status_changed"
        ? (activityToCategoryById.get(
            (r.meta as Record<string, unknown> | null)?.to as string
          ) ?? null)
        : null,
  }));

  const totalTasks = taskRows.length;

  // ─── Overdue trend vs yesterday (needs a persisted snapshot — "overdue" is a
  // derived state, not a logged event, so there's nothing else to diff against) ───
  const todayStr = format(today, "yyyy-MM-dd");
  const yesterdayStr = format(subDays(today, 1), "yyyy-MM-dd");
  const [yesterdaySnapshot] = await db
    .select({ overdueTasks: workspaceOverviewSnapshot.overdueTasks })
    .from(workspaceOverviewSnapshot)
    .where(
      and(
        eq(workspaceOverviewSnapshot.workspaceId, workspaceId),
        eq(workspaceOverviewSnapshot.userId, userId),
        eq(workspaceOverviewSnapshot.snapshotDate, yesterdayStr)
      )
    )
    .limit(1);
  const overdueDeltaFromYesterday = yesterdaySnapshot
    ? overdueRefs.length - yesterdaySnapshot.overdueTasks
    : null;

  // Opportunistic write, first load of the day per (workspace, user) wins —
  // this is tomorrow's "yesterday" baseline, not read back today.
  await db
    .insert(workspaceOverviewSnapshot)
    .values({
      id: createId(),
      workspaceId,
      userId,
      snapshotDate: todayStr,
      totalTasks,
      completedTasks,
      inProgressTasks,
      overdueTasks: overdueRefs.length,
    })
    .onConflictDoNothing();

  return {
    summary: {
      totalTasks,
      completedTasks,
      completedThisWeek,
      inProgressTasks,
      startedThisWeek,
      overdueTasks: overdueRefs.length,
      overdueDeltaFromYesterday,
      dueToday: dueTodayRefs.length,
      activeProjects: accessibleSpaceIds.length,
      activeSprints: sprintRows.length,
      completionPercent: totalTasks
        ? Math.round((completedTasks / totalTasks) * 100)
        : 0,
    },
    statusBreakdown: (
      ["OPEN", "WORKING", "REVIEW", "COMPLETED"] as DashboardCategory[]
    ).map((type) => ({
      type,
      label: STATUS_LABELS[type],
      count: statusCounts[type],
    })),
    myFocus,
    priorityBreakdown: PRIORITY_ORDER.map((priority) => ({
      priority,
      count: priorityCounts[priority],
    })),
    projects,
    assigneeWorkload,
    activeSprints,
    recentActivity,
    upcomingDeadlines: {
      overdue: {
        tasks: overdueRefs.slice(0, DEADLINE_PREVIEW_CAP),
        total: overdueRefs.length,
      },
      dueToday: {
        tasks: dueTodayRefs.slice(0, DEADLINE_PREVIEW_CAP),
        total: dueTodayRefs.length,
      },
      dueTomorrow: {
        tasks: dueTomorrowRefs.slice(0, DEADLINE_PREVIEW_CAP),
        total: dueTomorrowRefs.length,
      },
      next7Days: {
        tasks: next7Refs.slice(0, DEADLINE_PREVIEW_CAP),
        total: next7Refs.length,
      },
    },
  };
}

const DRILLDOWN_LIMIT = 300;

/**
 * Drill-down behind the Status Breakdown chart — every task in one status
 * bucket, workspace-wide. Not part of the cached aggregate above: it's an
 * on-demand fetch triggered by a click, so it always reads fresh.
 */
export async function getWorkspaceTasksByStatus(
  workspaceId: string,
  category: DashboardCategory
): Promise<{ tasks: WorkspaceOverviewTaskRef[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessibleSpaceIds = await getAccessibleSpaceIds(
    session.user.id,
    workspaceId
  );
  if (accessibleSpaceIds.length === 0) {
    return { tasks: [] };
  }

  const rows = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      priority: task.priority,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      listId: list.id,
      listName: list.name,
      spaceId: space.id,
      spaceName: space.name,
    })
    .from(task)
    .innerJoin(list, eq(task.listId, list.id))
    .innerJoin(space, eq(list.spaceId, space.id))
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(
      and(
        inArray(space.id, accessibleSpaceIds),
        notDeleted(),
        eq(task.isArchived, false),
        eq(list.isArchived, false),
        isNull(task.parentTaskId),
        eq(listStatus.dashboardCategory, category)
      )
    )
    .orderBy(asc(task.dueDateEnd), asc(task.dueDateStart))
    .limit(DRILLDOWN_LIMIT);

  return {
    tasks: rows.map((r) => ({
      id: r.id,
      seqNumber: r.seqNumber,
      title: r.title,
      priority: r.priority as Priority,
      dueDate: r.dueDateEnd ?? r.dueDateStart,
      spaceId: r.spaceId,
      spaceName: r.spaceName,
      listId: r.listId,
      listName: r.listName,
    })),
  };
}

/**
 * Drill-down behind the Priority Breakdown chart — every task at one
 * priority level, workspace-wide. Not part of the cached aggregate above:
 * it's an on-demand fetch triggered by a click, so it always reads fresh.
 */
export async function getWorkspaceTasksByPriority(
  workspaceId: string,
  priority: Priority
): Promise<{ tasks: WorkspaceOverviewTaskRef[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessibleSpaceIds = await getAccessibleSpaceIds(
    session.user.id,
    workspaceId
  );
  if (accessibleSpaceIds.length === 0) {
    return { tasks: [] };
  }

  const rows = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      priority: task.priority,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      listId: list.id,
      listName: list.name,
      spaceId: space.id,
      spaceName: space.name,
    })
    .from(task)
    .innerJoin(list, eq(task.listId, list.id))
    .innerJoin(space, eq(list.spaceId, space.id))
    .where(
      and(
        inArray(space.id, accessibleSpaceIds),
        notDeleted(),
        eq(task.isArchived, false),
        eq(list.isArchived, false),
        isNull(task.parentTaskId),
        eq(task.priority, priority)
      )
    )
    .orderBy(asc(task.dueDateEnd), asc(task.dueDateStart))
    .limit(DRILLDOWN_LIMIT);

  return {
    tasks: rows.map((r) => ({
      id: r.id,
      seqNumber: r.seqNumber,
      title: r.title,
      priority: r.priority as Priority,
      dueDate: r.dueDateEnd ?? r.dueDateStart,
      spaceId: r.spaceId,
      spaceName: r.spaceName,
      listId: r.listId,
      listName: r.listName,
    })),
  };
}

/**
 * Drill-down behind the Upcoming Deadlines widget — every task in one
 * deadline bucket (or `"all"` for the union, behind the card's "View All"),
 * workspace-wide, sorted the same way the widget's preview is. Also an
 * on-demand fetch, not part of the cached aggregate.
 */
export async function getWorkspaceTasksByDeadline(
  workspaceId: string,
  bucket: DeadlineBucket
): Promise<{ tasks: WorkspaceOverviewTaskRef[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessibleSpaceIds = await getAccessibleSpaceIds(
    session.user.id,
    workspaceId
  );
  if (accessibleSpaceIds.length === 0) {
    return { tasks: [] };
  }

  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const next7End = addDays(today, 7);

  const rows = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      priority: task.priority,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      listId: list.id,
      listName: list.name,
      spaceId: space.id,
      spaceName: space.name,
    })
    .from(task)
    .innerJoin(list, eq(task.listId, list.id))
    .innerJoin(space, eq(list.spaceId, space.id))
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(
      and(
        inArray(space.id, accessibleSpaceIds),
        notDeleted(),
        eq(task.isArchived, false),
        eq(list.isArchived, false),
        isNull(task.parentTaskId),
        ne(listStatus.dashboardCategory, "COMPLETED")
      )
    );

  const effectiveDue = (r: {
    dueDateStart: Date | null;
    dueDateEnd: Date | null;
  }) => r.dueDateEnd ?? r.dueDateStart;
  const toRef = (r: (typeof rows)[number]): WorkspaceOverviewTaskRef => ({
    id: r.id,
    seqNumber: r.seqNumber,
    title: r.title,
    priority: r.priority as Priority,
    dueDate: effectiveDue(r),
    spaceId: r.spaceId,
    spaceName: r.spaceName,
    listId: r.listId,
    listName: r.listName,
  });

  const tasks: WorkspaceOverviewTaskRef[] = [];
  for (const r of rows) {
    const due = effectiveDue(r);
    if (!due) {
      continue;
    }

    const isOverdue = due < today;
    const isToday = isSameDay(due, today);
    const isTomorrow = isSameDay(due, tomorrow);
    const isNext7 = due > tomorrow && due <= next7End;

    const matches =
      bucket === "all"
        ? isOverdue || isToday || isTomorrow || isNext7
        : bucket === "overdue"
          ? isOverdue
          : bucket === "dueToday"
            ? isToday
            : bucket === "dueTomorrow"
              ? isTomorrow
              : isNext7;

    if (matches) {
      tasks.push(toRef(r));
    }
  }

  tasks.sort(sortByUrgency);
  return { tasks: tasks.slice(0, DRILLDOWN_LIMIT) };
}

/**
 * Drill-down behind the Team Workload widget — every task (any status)
 * assigned to one member, workspace-wide. Also an on-demand fetch, not part
 * of the cached aggregate.
 */
export async function getWorkspaceTasksByAssignee(
  workspaceId: string,
  userId: string
): Promise<{ tasks: WorkspaceOverviewTaskRef[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessibleSpaceIds = await getAccessibleSpaceIds(
    session.user.id,
    workspaceId
  );
  if (accessibleSpaceIds.length === 0) {
    return { tasks: [] };
  }

  const rows = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      priority: task.priority,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      listId: list.id,
      listName: list.name,
      spaceId: space.id,
      spaceName: space.name,
    })
    .from(task)
    .innerJoin(taskAssignee, eq(taskAssignee.taskId, task.id))
    .innerJoin(list, eq(task.listId, list.id))
    .innerJoin(space, eq(list.spaceId, space.id))
    .where(
      and(
        eq(taskAssignee.userId, userId),
        inArray(space.id, accessibleSpaceIds),
        notDeleted(),
        eq(task.isArchived, false),
        eq(list.isArchived, false),
        isNull(task.parentTaskId)
      )
    )
    .limit(DRILLDOWN_LIMIT);

  const tasks = rows.map(
    (r): WorkspaceOverviewTaskRef => ({
      id: r.id,
      seqNumber: r.seqNumber,
      title: r.title,
      priority: r.priority as Priority,
      dueDate: r.dueDateEnd ?? r.dueDateStart,
      spaceId: r.spaceId,
      spaceName: r.spaceName,
      listId: r.listId,
      listName: r.listName,
    })
  );
  tasks.sort(sortByUrgency);
  return { tasks };
}

/**
 * Drill-down behind the My Focus Today widget — the current user's tasks,
 * workspace-wide, narrowed to one focus bucket. Combines assignee +
 * due-date/status, unlike the assignee/deadline drill-downs; fetched
 * on-demand, not part of the cached aggregate.
 */
export async function getWorkspaceMyFocusTasks(
  workspaceId: string,
  kind: MyFocusKind
): Promise<{ tasks: WorkspaceOverviewTaskRef[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessibleSpaceIds = await getAccessibleSpaceIds(
    session.user.id,
    workspaceId
  );
  if (accessibleSpaceIds.length === 0) {
    return { tasks: [] };
  }

  const today = startOfDay(new Date());

  const rows = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      priority: task.priority,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      listId: list.id,
      listName: list.name,
      spaceId: space.id,
      spaceName: space.name,
      dashboardCategory: listStatus.dashboardCategory,
    })
    .from(task)
    .innerJoin(taskAssignee, eq(taskAssignee.taskId, task.id))
    .innerJoin(list, eq(task.listId, list.id))
    .innerJoin(space, eq(list.spaceId, space.id))
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(
      and(
        eq(taskAssignee.userId, session.user.id),
        inArray(space.id, accessibleSpaceIds),
        notDeleted(),
        eq(task.isArchived, false),
        eq(list.isArchived, false),
        isNull(task.parentTaskId)
      )
    );

  const effectiveDue = (r: {
    dueDateStart: Date | null;
    dueDateEnd: Date | null;
  }) => r.dueDateEnd ?? r.dueDateStart;
  const toRef = (r: (typeof rows)[number]): WorkspaceOverviewTaskRef => ({
    id: r.id,
    seqNumber: r.seqNumber,
    title: r.title,
    priority: r.priority as Priority,
    dueDate: effectiveDue(r),
    spaceId: r.spaceId,
    spaceName: r.spaceName,
    listId: r.listId,
    listName: r.listName,
  });

  const tasks: WorkspaceOverviewTaskRef[] = [];
  for (const r of rows) {
    if (kind === "assigned") {
      tasks.push(toRef(r));
      continue;
    }
    if (kind === "review") {
      if (r.dashboardCategory === "REVIEW") {
        tasks.push(toRef(r));
      }
      continue;
    }
    // "overdue" / "dueToday" — non-completed tasks only, matching the summary tiles.
    if (r.dashboardCategory === "COMPLETED") {
      continue;
    }
    const due = effectiveDue(r);
    if (!due) {
      continue;
    }
    const matches = kind === "overdue" ? due < today : isSameDay(due, today);
    if (matches) {
      tasks.push(toRef(r));
    }
  }

  tasks.sort(sortByUrgency);
  return { tasks: tasks.slice(0, DRILLDOWN_LIMIT) };
}
