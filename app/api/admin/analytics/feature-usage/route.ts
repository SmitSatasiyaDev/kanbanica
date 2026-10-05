import { and, count, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { comment, space, task } from "@/db/schema";
import { getAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { notDeleted } from "@/lib/task-visibility";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [tasksPerDay, commentsPerDay, spacesPerDay, totals] = await Promise.all(
    [
      db
        .select({
          date: sql<string>`date_trunc('day', ${task.createdAt})::date`,
          count: count(),
        })
        .from(task)
        .where(and(gte(task.createdAt, thirtyDaysAgo), notDeleted()))
        .groupBy(sql`date_trunc('day', ${task.createdAt})::date`)
        .orderBy(sql`date_trunc('day', ${task.createdAt})::date`),
      db
        .select({
          date: sql<string>`date_trunc('day', ${comment.createdAt})::date`,
          count: count(),
        })
        .from(comment)
        .where(gte(comment.createdAt, thirtyDaysAgo))
        .groupBy(sql`date_trunc('day', ${comment.createdAt})::date`)
        .orderBy(sql`date_trunc('day', ${comment.createdAt})::date`),
      db
        .select({
          date: sql<string>`date_trunc('day', ${space.createdAt})::date`,
          count: count(),
        })
        .from(space)
        .where(gte(space.createdAt, thirtyDaysAgo))
        .groupBy(sql`date_trunc('day', ${space.createdAt})::date`)
        .orderBy(sql`date_trunc('day', ${space.createdAt})::date`),
      Promise.all([
        db
          .select({ count: count() })
          .from(task)
          .where(notDeleted())
          .then((r) => r[0].count),
        db
          .select({ count: count() })
          .from(comment)
          .then((r) => r[0].count),
        db
          .select({ count: count() })
          .from(space)
          .then((r) => r[0].count),
      ]),
    ]
  );

  return NextResponse.json({
    tasksPerDay,
    commentsPerDay,
    spacesPerDay,
    totals: {
      tasks: totals[0],
      comments: totals[1],
      spaces: totals[2],
    },
  });
}
