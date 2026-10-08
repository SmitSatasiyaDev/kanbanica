"use client";

import { useParams } from "next/navigation";
import * as React from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { useSetTopbar } from "@/lib/topbar-context";

// Half-hour slots for the daily-digest send time. A Select rather than
// a native <input type="time"> — the app never uses native form controls.
const DIGEST_TIMES = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? "00" : "30";
  const value = `${String(hour).padStart(2, "0")}:${minute}`;
  const suffix = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return { value, label: `${displayHour}:${minute} ${suffix}` };
});

// Triggers whose notifications are never emitted by any code path yet, so a
// toggle for them would do nothing. Hidden from the UI only — the trigger
// definitions, DB rows and API fields are untouched, so showing them again is
// a one-line change once the sprint notifications are implemented.
const HIDDEN_TRIGGERS = new Set([
  "sprint_started",
  "sprint_ending_soon",
  "sprint_closed",
  "sprint_auto_created",
]);

const TRIGGER_LABELS: Record<string, string> = {
  task_created: "Task created",
  task_assigned: "Task assigned to me",
  task_unassigned: "Task unassigned from me",
  task_status_changed: "Task status changed",
  task_priority_changed: "Task priority changed",
  task_due_date_changed: "Task due date changed",
  task_completed: "Task marked complete",
  task_moved: "Task moved",
  task_deleted: "Task deleted",
  attachment_added: "Attachment added",
  comment_added: "New comment",
  comment_reply: "Reply to my comment",
  mention_comment: "Mentioned in comment",
  mention_description: "Mentioned in description",
  comment_resolved: "Comment resolved",
  due_date_reminder_1day: "Due date reminder (1 day)",
  due_date_today: "Due today",
  task_overdue: "Task overdue",
  workspace_invited: "Invited to workspace",
  invite_accepted: "Invite accepted",
  space_added: "Added to project",
  space_removed: "Removed from project",
  space_archived: "Project archived",
  space_restored: "Project restored",
  role_changed: "Role changed",
  space_permission_changed: "Project permission changed",
  workspace_removed: "Removed from workspace",
  sprint_started: "Sprint started",
  sprint_ending_soon: "Sprint ending soon",
  sprint_closed: "Sprint closed",
  sprint_auto_created: "Sprint auto-created",
  checklist_assigned: "Checklist assigned",
  checklist_unassigned: "Checklist unassigned",
  checklist_disabled: "Checklist disabled",
  checklist_completed: "Checklist completed",
};

interface NotifPref {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  triggerType: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function NotificationSettingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  // Page header renders in the topbar, not in the content body.
  useSetTopbar({
    breadcrumbs: [{ label: "Inbox", href: `/${workspaceId}/notifications` }],
    title: "Notification Settings",
  });

  const { data: notifPrefData, mutate: mutateNotif } = useSWR(
    "/api/me/notification-preferences",
    fetcher
  );

  // Email is only shown when the deployment can actually deliver it. No
  // disabled controls, no "coming soon" — the email UI simply appears once
  // SMTP is configured.
  const emailAvailable: boolean = notifPrefData?.smtpConfigured ?? false;
  // Platform admin master switch (Orbit → Integrations). When off, no
  // notification email is sent whatever the user picks, so the email controls
  // are shown disabled — saved values are left untouched.
  const emailBlockedByAdmin: boolean =
    notifPrefData?.notificationEmailsEnabled === false;

  // This row also holds the in-app notification sound toggle, which has no
  // dependency on SMTP, so — unlike the email-specific fields below — it's
  // fetched unconditionally.
  const { data: emailPrefData, mutate: mutateEmail } = useSWR(
    "/api/me/email-preferences",
    fetcher
  );

  const [prefs, setPrefs] = React.useState<NotifPref[]>([]);
  const [deliveryMode, setDeliveryMode] = React.useState<string>("instant");
  const [digestTime, setDigestTime] = React.useState<string>("08:00");
  const [soundEnabled, setSoundEnabled] = React.useState<boolean>(true);
  const [saving, setSaving] = React.useState(false);
  const [pushEnabling, setPushEnabling] = React.useState(false);
  const {
    supported: pushSupported,
    permission,
    subscribed,
    enable: enablePush,
    disable: disablePush,
  } = usePushSubscription();

  React.useEffect(() => {
    if (notifPrefData?.preferences) {
      setPrefs(notifPrefData.preferences);
    }
  }, [notifPrefData]);

  React.useEffect(() => {
    if (emailPrefData?.preference) {
      setDeliveryMode(emailPrefData.preference.deliveryMode ?? "instant");
      setDigestTime(emailPrefData.preference.digestTime ?? "08:00");
      setSoundEnabled(emailPrefData.preference.soundEnabled ?? true);
    }
  }, [emailPrefData]);

  async function saveEmailPrefs() {
    setSaving(true);
    try {
      await fetch("/api/me/email-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryMode, digestTime }),
      });
      await mutateEmail();
    } finally {
      setSaving(false);
    }
  }

  async function saveSoundPref(value: boolean) {
    setSoundEnabled(value);
    await fetch("/api/me/email-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ soundEnabled: value }),
    });
    await mutateEmail();
  }

  // A previously-stored time may not fall on a half-hour slot (the old control
  // was a free-form time input) — keep it selectable so it isn't silently lost.
  const digestTimeOptions = React.useMemo(() => {
    if (DIGEST_TIMES.some((t) => t.value === digestTime)) {
      return DIGEST_TIMES;
    }
    return [{ value: digestTime, label: digestTime }, ...DIGEST_TIMES];
  }, [digestTime]);

  // `prefs` keeps every trigger (and its emailEnabled value) so PATCH payloads
  // stay unchanged; only the rendered rows are filtered.
  const visiblePrefs = React.useMemo(
    () => prefs.filter((p) => !HIDDEN_TRIGGERS.has(p.triggerType)),
    [prefs]
  );

  async function saveNotifPref(
    triggerType: string,
    field: keyof Omit<NotifPref, "triggerType">,
    value: boolean
  ) {
    const updated = prefs.map((p) =>
      p.triggerType === triggerType ? { ...p, [field]: value } : p
    );
    setPrefs(updated);

    await fetch("/api/me/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferences: [
          {
            triggerType,
            ...updated.find((p) => p.triggerType === triggerType),
          },
        ],
      }),
    });
    await mutateNotif();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <p className="text-sm text-base-content/60">
        Control how and when you receive notifications.
      </p>

      {/* Browser push notifications */}
      {pushSupported && (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-medium">Browser Notifications</h3>
              <p className="mt-0.5 text-sm text-base-content/60">
                {permission === "denied"
                  ? "Notifications are blocked. Enable them in your browser settings."
                  : subscribed
                    ? "Push notifications are enabled for this browser."
                    : "Get notified in real time, even when the app is in the background."}
              </p>
            </div>
            {permission !== "denied" && (
              <Button
                disabled={pushEnabling}
                onClick={async () => {
                  setPushEnabling(true);
                  if (subscribed) {
                    await disablePush();
                  } else {
                    await enablePush();
                  }
                  setPushEnabling(false);
                }}
                size="sm"
                variant={subscribed ? "outline" : "default"}
              >
                {pushEnabling ? "…" : subscribed ? "Disable" : "Enable"}
              </Button>
            )}
          </div>
          {subscribed && (
            <p className="text-xs text-base-content/60">
              Per-event push toggles are controlled in the table below.
            </p>
          )}
        </div>
      )}

      {/* Email delivery — only when SMTP can actually deliver it. */}
      {emailAvailable && (
        <div className="space-y-4 rounded-xl border p-4">
          <h3 className="font-medium">Email Delivery</h3>
          {emailBlockedByAdmin && (
            <p className="rounded-md bg-base-200/40 px-3 py-2 text-xs text-base-content/60">
              Email notifications are turned off by the platform administrator.
              Your preferences are saved and will apply again when they're
              turned back on.
            </p>
          )}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
            <Label className="sm:w-32 sm:shrink-0" htmlFor="delivery-mode">
              Delivery mode
            </Label>
            <Select
              disabled={emailBlockedByAdmin}
              onValueChange={setDeliveryMode}
              value={deliveryMode}
            >
              <SelectTrigger className="w-full sm:w-40" id="delivery-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="p-1.5">
                <SelectItem value="instant">Instant</SelectItem>
                <SelectItem value="digest">Daily Digest</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {deliveryMode === "digest" && (
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
              <Label className="sm:w-32 sm:shrink-0" htmlFor="digest-time">
                Digest time
              </Label>
              <Select
                disabled={emailBlockedByAdmin}
                onValueChange={setDigestTime}
                value={digestTime}
              >
                <SelectTrigger className="w-full sm:w-40" id="digest-time">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="p-1.5">
                  {digestTimeOptions.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            disabled={saving || emailBlockedByAdmin}
            onClick={saveEmailPrefs}
            size="sm"
          >
            {saving ? "Saving..." : "Save email preferences"}
          </Button>
        </div>
      )}

      {/* In-app notification sound */}
      <div className="space-y-3 rounded-xl border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-medium">In-App Notification Sound</h3>
            <p className="mt-0.5 text-sm text-base-content/60">
              Master switch for notification sounds. When on, the Sound column
              below controls which event types actually play one while you're
              actively using Kanbanica.
            </p>
          </div>
          <Switch
            checked={soundEnabled}
            onCheckedChange={(v) => void saveSoundPref(v)}
          />
        </div>
      </div>

      {/* Per-trigger toggles */}
      <div className="space-y-4">
        <h3 className="font-medium">Notification Preferences</h3>
        <div className="overflow-hidden rounded-xl border">
          {/* Horizontal scroll on narrow viewports — four switch columns plus
              event labels don't fit under ~480px; the min-width keeps every
              column legible and lets the row scroll instead of squeezing. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b bg-base-200/50">
                  <th className="px-4 py-2 text-left font-medium">Event</th>
                  <th className="px-4 py-2 text-center font-medium">In-App</th>
                  {emailAvailable && (
                    <th className="px-4 py-2 text-center font-medium">Email</th>
                  )}
                  <th className="px-4 py-2 text-center font-medium">Push</th>
                  <th className="px-4 py-2 text-center font-medium">Sound</th>
                </tr>
              </thead>
              <tbody>
                {visiblePrefs.map((pref) => (
                  <tr className="border-b last:border-0" key={pref.triggerType}>
                    <td className="px-4 py-2.5 text-sm">
                      {TRIGGER_LABELS[pref.triggerType] ?? pref.triggerType}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Switch
                        checked={pref.inAppEnabled}
                        onCheckedChange={(v) =>
                          void saveNotifPref(
                            pref.triggerType,
                            "inAppEnabled",
                            v
                          )
                        }
                      />
                    </td>
                    {emailAvailable && (
                      <td className="px-4 py-2.5 text-center">
                        <Switch
                          checked={pref.emailEnabled}
                          disabled={emailBlockedByAdmin}
                          onCheckedChange={(v) =>
                            void saveNotifPref(
                              pref.triggerType,
                              "emailEnabled",
                              v
                            )
                          }
                        />
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-center">
                      <Switch
                        checked={pref.pushEnabled}
                        onCheckedChange={(v) =>
                          void saveNotifPref(pref.triggerType, "pushEnabled", v)
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Switch
                        checked={pref.soundEnabled}
                        onCheckedChange={(v) =>
                          void saveNotifPref(
                            pref.triggerType,
                            "soundEnabled",
                            v
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
                {prefs.length === 0 && (
                  <tr>
                    <td
                      className="px-4 py-8 text-center text-sm text-base-content/60"
                      colSpan={emailAvailable ? 5 : 4}
                    >
                      Loading preferences...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
