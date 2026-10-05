"use server";

import { subDays } from "date-fns";
import { and, desc, eq, gte } from "drizzle-orm";
import { headers } from "next/headers";
import { activityLog, list, task, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessSpace } from "@/lib/permissions";
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
}

export async function getSpaceActivity(
  workspaceId: string,
  spaceId: string,
  page = 1
): Promise<
  { entries: SpaceActivityEntry[]; total: number } | { error: string }
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

  const since = subDays(new Date(), 30);
  const PAGE_SIZE = 50;
  const offset = (page - 1) * PAGE_SIZE;

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
    .where(
      and(
        eq(list.spaceId, spaceId),
        eq(list.isArchived, false),
        notDeleted(),
        gte(activityLog.createdAt, since)
      )
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  return {
    entries: rows.map((r) => ({
      ...r,
      taskTitle: r.taskTitle,
      taskSeq: r.taskSeq,
    })),
    total: rows.length, // approximate — good enough for MVP pagination
  };
}
