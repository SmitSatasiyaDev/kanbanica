import { and, eq, inArray } from "drizzle-orm";
import { dailyChecklistTemplateAssignment, workspaceMember } from "@/db/schema";
import { db } from "@/lib/db";
import { createNotifications } from "./create-notification";

/**
 * Checklist notifications (assignment, removal, disabled/deleted, day completed). Thin wrappers
 * over the single fire-and-forget `createNotifications()` entry. There is no checklist entity
 * type (the enum is closed), so these use `WORKSPACE` + the workspace id; the inbox click target
 * is resolved from the trigger type (`lib/notifications/target.ts`).
 */

function send(
  workspaceId: string,
  actorId: string,
  recipientIds: string[],
  triggerType:
    | "checklist_assigned"
    | "checklist_unassigned"
    | "checklist_disabled"
    | "checklist_completed",
  title: string,
  body?: string
) {
  const ids = [...new Set(recipientIds)].filter((id) => id !== actorId);
  if (ids.length === 0) {
    return;
  }
  createNotifications({
    workspaceId,
    actorId,
    recipientIds: ids,
    triggerType,
    entityType: "WORKSPACE",
    entityId: workspaceId,
    title,
    body,
  });
}

const who = (name: string) => name.trim() || "Someone";

export function notifyChecklistAssigned(p: {
  actorId: string;
  actorName: string;
  templateName: string;
  userIds: string[];
  workspaceId: string;
}) {
  send(
    p.workspaceId,
    p.actorId,
    p.userIds,
    "checklist_assigned",
    `${who(p.actorName)} assigned you to ${p.templateName}`
  );
}

export function notifyChecklistUnassigned(p: {
  actorId: string;
  actorName: string;
  templateName: string;
  userIds: string[];
  workspaceId: string;
}) {
  send(
    p.workspaceId,
    p.actorId,
    p.userIds,
    "checklist_unassigned",
    `${who(p.actorName)} removed you from ${p.templateName}`,
    "You will no longer receive new checklists from this template. Your past checklists stay in History."
  );
}

/** Tells the template's current assignees it was disabled or deleted (call BEFORE assignments change). */
export async function notifyChecklistDisabled(p: {
  actorId: string;
  actorName: string;
  deleted: boolean;
  templateId: string;
  templateName: string;
  workspaceId: string;
}) {
  const rows = await db
    .select({ userId: dailyChecklistTemplateAssignment.userId })
    .from(dailyChecklistTemplateAssignment)
    .innerJoin(
      workspaceMember,
      and(
        eq(workspaceMember.userId, dailyChecklistTemplateAssignment.userId),
        eq(workspaceMember.workspaceId, p.workspaceId),
        eq(workspaceMember.status, "ACTIVE")
      )
    )
    .where(eq(dailyChecklistTemplateAssignment.templateId, p.templateId));
  send(
    p.workspaceId,
    p.actorId,
    rows.map((r) => r.userId),
    "checklist_disabled",
    `${who(p.actorName)} ${p.deleted ? "deleted" : "disabled"} ${p.templateName}`,
    "No new checklists will be created from it. Past checklists stay in History."
  );
}

/** Tells the workspace's Owners/Admins that an assignee finished every item of a day. */
export async function notifyChecklistCompleted(p: {
  completed: number;
  total: number;
  userId: string;
  userName: string;
  templateName: string | null;
  workspaceId: string;
}) {
  const admins = await db
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, p.workspaceId),
        eq(workspaceMember.status, "ACTIVE"),
        inArray(workspaceMember.role, ["OWNER", "ADMIN"])
      )
    );
  send(
    p.workspaceId,
    p.userId,
    admins.flatMap((a) => (a.userId ? [a.userId] : [])),
    "checklist_completed",
    `${who(p.userName)} completed ${p.templateName ?? "a checklist"} (${p.completed}/${p.total})`
  );
}
