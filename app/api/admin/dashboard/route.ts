import { count, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auditLogs, supportTicket, task, user, workspace } from "@/db/schema";
import { getAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { notDeleted } from "@/lib/task-visibility";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const todayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const monthStartUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );

  const [
    [totalUsersRow],
    [totalWorkspacesRow],
    [totalTasksRow],
    [openTicketsRow],
    [newTodayRow],
    [newMonthRow],
    recentActivity,
  ] = await Promise.all([
    db.select({ count: count() }).from(user),
    db.select({ count: count() }).from(workspace),
    db.select({ count: count() }).from(task).where(notDeleted()),
    db
      .select({ count: count() })
      .from(supportTicket)
      .where(eq(supportTicket.status, "OPEN")),
    db
      .select({ count: count() })
      .from(user)
      .where(gte(user.createdAt, todayUTC)),
    db
      .select({ count: count() })
      .from(user)
      .where(gte(user.createdAt, monthStartUTC)),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorId: auditLogs.actorId,
        actorEmail: auditLogs.actorEmail,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        description: auditLogs.description,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(20),
  ]);

  return NextResponse.json({
    totalUsers: totalUsersRow.count,
    totalWorkspaces: totalWorkspacesRow.count,
    totalTasks: totalTasksRow.count,
    openTickets: openTicketsRow.count,
    newSignupsToday: newTodayRow.count,
    newSignupsThisMonth: newMonthRow.count,
    recentActivity,
  });
}
