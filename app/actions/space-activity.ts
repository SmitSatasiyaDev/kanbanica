"use server";

import { subDays } from "date-fns";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { headers } from "next/headers";
import { activityLog, list, listStatus, task, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { DashboardCategory } from "@/lib/dashboard-category";
import { db } from "@/lib/db";
import { canAccessSpace } from "@/lib/permissions";
import {
  categoryEventTypes,
  DEFAULT_ACTIVITY_RANGE,
  rangeDays,
} from "@/lib/space-activity-filters";
import { notDeleted } from "@/lib/task-visibility";

export interface SpaceActivityEntry {
  actorEmail: string | null;
  actorImage: string | null;
  actorName: string | null;
  createdAt: Date;
  eventType: string;
  id: string;
  listId: string;
  listName: string;
  meta: unknown;
  taskId: string;
  taskSeq: number;
  taskTitle: string;
  /** Only set for `status_changed` — the target status's dashboard category, so the feed can mark completions. */
  toDashboardCategory: DashboardCategory | null;
}

/** Keyset cursor: the last row of the previous page. */
export interface SpaceActivityCursor {
  createdAt: string;
  id: string;
}

export interface SpaceActivityQuery {
  category?: string;
  cursor?: SpaceActivityCursor | null;
  range?: string;
  search?: string;
}

const PAGE_SIZE = 50;

// JS Dates carry milliseconds, `timestamptz` carries microseconds — compare
// and order on the millisecond-truncated value so a cursor built from a JS
// Date never skips rows that share its millisecond.
const createdAtMs = sql`date_trunc('milliseconds', ${activityLog.createdAt})`;

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function getSpaceActivity(
  workspaceId: string,
  spaceId: string,
  query: SpaceActivityQuery = {}
): Promise<
  | { entries: SpaceActivityEntry[]; nextCursor: SpaceActivityCursor | null }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessible = await canAccessSpace(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!accessible) {
    return { error: "Unauthorized" };
  }

  const since = subDays(
    new Date(),
    rangeDays(query.range ?? DEFAULT_ACTIVITY_RANGE)
  );

  const conditions: SQL[] = [
    eq(list.spaceId, spaceId),
    eq(list.isArchived, false),
    notDeleted(),
    gte(activityLog.createdAt, since),
  ];

  const category = query.category ?? "all";
  const eventTypes = categoryEventTypes(category);
  if (category === "completed") {
    const completedStatusIds = db
      .select({ id: listStatus.id })
      .from(listStatus)
      .where(eq(listStatus.dashboardCategory, "COMPLETED"));
    conditions.push(
      or(
        eq(activityLog.eventType, "subtask_completed"),
        and(
          eq(activityLog.eventType, "status_changed"),
          inArray(sql`(${activityLog.meta}->>'to')`, completedStatusIds)
        )
      ) as SQL
    );
  } else if (eventTypes) {
    conditions.push(inArray(activityLog.eventType, eventTypes));
  }

  const search = query.search?.trim().slice(0, 200);
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    const seqMatch = search.match(/^#?(\d{1,9})$/);
    conditions.push(
      or(
        ilike(task.title, pattern),
        ilike(user.name, pattern),
        ilike(user.email, pattern),
        ilike(list.name, pattern),
        // Variable parts of the description (status names, assignee names,
        // tags, file names, …) live in meta; the verb is the event type.
        sql`${activityLog.meta}::text ILIKE ${pattern}`,
        sql`replace(${activityLog.eventType}, '_', ' ') ILIKE ${pattern}`,
        ...(seqMatch ? [eq(task.seqNumber, Number(seqMatch[1]))] : [])
      ) as SQL
    );
  }

  if (query.cursor) {
    const cursorDate = new Date(query.cursor.createdAt);
    if (!Number.isNaN(cursorDate.getTime())) {
      conditions.push(
        sql`(${createdAtMs}, ${activityLog.id}) < (${cursorDate.toISOString()}::timestamptz, ${query.cursor.id})`
      );
    }
  }

  const rows = await db
    .select({
      id: activityLog.id,
      taskId: activityLog.taskId,
      taskTitle: task.title,
      taskSeq: task.seqNumber,
      listId: list.id,
      listName: list.name,
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
    .leftJoin(user, eq(activityLog.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(createdAtMs), desc(activityLog.id))
    // One extra row tells us whether another page exists.
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Resolve the target status's category for this page's `status_changed`
  // rows (same lookup as Workspace Overview's Recent Activity).
  const toStatusIds = [
    ...new Set(
      page
        .filter((r) => r.eventType === "status_changed")
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
  const categoryById = new Map(
    toStatusRows.map((s) => [s.id, s.dashboardCategory])
  );

  const entries = page.map((r) => ({
    ...r,
    toDashboardCategory:
      r.eventType === "status_changed"
        ? (categoryById.get(
            (r.meta as Record<string, unknown> | null)?.to as string
          ) ?? null)
        : null,
  }));

  const last = entries.at(-1);
  return {
    entries,
    nextCursor:
      hasMore && last
        ? { createdAt: new Date(last.createdAt).toISOString(), id: last.id }
        : null,
  };
}
