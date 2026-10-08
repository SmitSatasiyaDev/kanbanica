// Shared notification click-target resolution, used by both the Inbox
// (`app/(app)/[workspaceId]/notifications/page.tsx`) and the bell dropdown
// (`components/notifications/notification-panel.tsx`) so clicking any
// notification resolves to the same destination — and, because every `href`
// is built from the notification's OWN `workspaceId`, navigating switches the
// user to the correct workspace automatically.

export type NotificationTarget =
  | { type: "task" }
  | { type: "route"; href: string }
  | { type: "info"; message: string };

// The minimal notification shape needed to resolve a target.
export interface NotificationTargetInput {
  entityId: string;
  entityType: string;
  triggerType: string;
  workspaceId: string;
}

// Historical events with no valid destination — clicking informs instead of navigating.
const INFO_MESSAGES: Record<string, string> = {
  space_archived: "This project has been archived.",
  space_removed: "You no longer have access to this project.",
  workspace_removed: "You no longer have access to this workspace.",
  task_deleted: "This task no longer exists.",
};

/**
 * Where a notification should take the user. `task` opens the task (inline panel
 * in the Inbox when same-workspace, otherwise a navigation); `route` navigates
 * to a page; `info` shows a toast explaining why there's nowhere to go.
 */
export function getNotificationTarget(
  n: NotificationTargetInput
): NotificationTarget {
  const info = INFO_MESSAGES[n.triggerType];
  if (info) {
    return { type: "info", message: info };
  }

  // Membership events point at workspace pages regardless of entity mapping.
  if (n.triggerType === "invite_accepted" || n.triggerType === "role_changed") {
    return { type: "route", href: `/${n.entityId}/settings/members` };
  }
  if (n.triggerType === "workspace_invited") {
    // entityId is the invite token — open the accept/decline page (not the
    // workspace home, which 404s until the invite is accepted).
    return { type: "route", href: `/invite/${n.entityId}` };
  }

  // Checklist events (stored as WORKSPACE notifications): open the checklist pages.
  if (
    n.triggerType === "checklist_assigned" ||
    n.triggerType === "checklist_unassigned" ||
    n.triggerType === "checklist_disabled"
  ) {
    return {
      type: "route",
      href: `/${n.workspaceId}/daily-checklist?scope=assigned`,
    };
  }
  if (n.triggerType === "checklist_completed") {
    return {
      type: "route",
      href: `/${n.workspaceId}/daily-checklist/admin?tab=today`,
    };
  }

  switch (n.entityType) {
    case "TASK":
      return { type: "task" };
    case "SPACE":
      return { type: "route", href: `/${n.workspaceId}/${n.entityId}` };
    case "WORKSPACE":
      return { type: "route", href: `/${n.entityId}` };
    case "COMMENT":
      // Channel messages aren't linkable from here.
      return {
        type: "info",
        message: "Open the channel to view this mention.",
      };
    default:
      return { type: "info", message: "This notification has no linked page." };
  }
}
