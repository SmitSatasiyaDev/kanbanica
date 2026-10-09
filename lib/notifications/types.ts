export const NOTIFICATION_TRIGGERS = {
  TASK_CREATED: "task_created",
  TASK_ASSIGNED: "task_assigned",
  TASK_UNASSIGNED: "task_unassigned",
  TASK_STATUS_CHANGED: "task_status_changed",
  TASK_PRIORITY_CHANGED: "task_priority_changed",
  TASK_DUE_DATE_CHANGED: "task_due_date_changed",
  TASK_COMPLETED: "task_completed",
  TASK_MOVED: "task_moved",
  TASK_DELETED: "task_deleted",
  ATTACHMENT_ADDED: "attachment_added",
  COMMENT_ADDED: "comment_added",
  COMMENT_REPLY: "comment_reply",
  MENTION_COMMENT: "mention_comment",
  MENTION_DESCRIPTION: "mention_description",
  COMMENT_RESOLVED: "comment_resolved",
  DUE_DATE_REMINDER_1DAY: "due_date_reminder_1day",
  DUE_DATE_TODAY: "due_date_today",
  TASK_OVERDUE: "task_overdue",
  WORKSPACE_INVITED: "workspace_invited",
  INVITE_ACCEPTED: "invite_accepted",
  SPACE_ADDED: "space_added",
  SPACE_REMOVED: "space_removed",
  SPACE_ARCHIVED: "space_archived",
  SPACE_RESTORED: "space_restored",
  ROLE_CHANGED: "role_changed",
  SPACE_PERMISSION_CHANGED: "space_permission_changed",
  WORKSPACE_REMOVED: "workspace_removed",
  SPRINT_STARTED: "sprint_started",
  SPRINT_ENDING_SOON: "sprint_ending_soon",
  SPRINT_CLOSED: "sprint_closed",
  SPRINT_AUTO_CREATED: "sprint_auto_created",
} as const;

export type NotificationTriggerType =
  (typeof NOTIFICATION_TRIGGERS)[keyof typeof NOTIFICATION_TRIGGERS];

/**
 * Events that get an email by default: the ones that are *about you*.
 * Everything else defaults to email OFF, so enabling email delivery never
 * floods a workspace with mail for ambient activity (task created, status
 * changed, …). Users can still switch any trigger on from notification settings.
 *
 * SINGLE SOURCE OF TRUTH. Every place that needs an email default calls
 * `emailDefaultFor()` — the API fallback, the notification fan-out, the digest
 * filter, and the migration backfill. In-app and push defaults stay `true` and
 * are unrelated to this.
 */
export const EMAIL_DEFAULT_ENABLED_TRIGGERS = [
  "mention_comment",
  "mention_description",
  "task_assigned",
  "comment_reply",
  "comment_resolved",
  "due_date_today",
  "task_overdue",
] as const satisfies readonly NotificationTriggerType[];

const EMAIL_DEFAULT_ENABLED = new Set<string>(EMAIL_DEFAULT_ENABLED_TRIGGERS);

/** Whether `triggerType` should send email when the user has no stored preference. */
export function emailDefaultFor(triggerType: string): boolean {
  return EMAIL_DEFAULT_ENABLED.has(triggerType);
}

/**
 * Opt-in events: in-app AND push default OFF for a user who has never saved a
 * preference for the trigger. Everything else defaults ON. `task_created` is
 * ambient activity (it fans out to every project member), so it is quiet until
 * someone turns it on in notification settings — assignees are unaffected, they
 * get `task_assigned` instead. A saved preference row always wins, either way.
 *
 * SINGLE SOURCE OF TRUTH. Every place that needs an in-app/push default calls
 * `inAppDefaultFor()` / `pushDefaultFor()` — the API fallback and the
 * notification fan-out.
 */
export const OPT_IN_TRIGGERS = [
  "task_created",
] as const satisfies readonly NotificationTriggerType[];

const OPT_IN = new Set<string>(OPT_IN_TRIGGERS);

/** Whether `triggerType` creates an in-app notification when the user has no stored preference. */
export function inAppDefaultFor(triggerType: string): boolean {
  return !OPT_IN.has(triggerType);
}

/** Whether `triggerType` sends web push when the user has no stored preference. */
export function pushDefaultFor(triggerType: string): boolean {
  return !OPT_IN.has(triggerType);
}

/**
 * Events whose per-trigger "Sound" toggle defaults ON: the ones that are
 * about you (assignment, mention, reply, invite). Everything else defaults
 * to sound OFF, same rationale as `EMAIL_DEFAULT_ENABLED_TRIGGERS`. Users can
 * still switch any trigger's sound on/off from notification settings, and the
 * global "In-App Notification Sound" toggle (`userEmailPreference.soundEnabled`)
 * is a separate master switch checked in addition to this.
 *
 * SINGLE SOURCE OF TRUTH. Every place that needs a sound default calls
 * `soundDefaultFor()` — the API fallback and the notification fan-out.
 */
export const SOUND_DEFAULT_ENABLED_TRIGGERS = [
  "task_assigned",
  "mention_comment",
  "mention_description",
  "comment_reply",
  "workspace_invited",
  "invite_accepted",
] as const satisfies readonly NotificationTriggerType[];

const SOUND_DEFAULT_ENABLED = new Set<string>(SOUND_DEFAULT_ENABLED_TRIGGERS);

/** Whether `triggerType` should play a sound when the user has no stored preference. */
export function soundDefaultFor(triggerType: string): boolean {
  return SOUND_DEFAULT_ENABLED.has(triggerType);
}
