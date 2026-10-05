"use client";

import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { saveIntegrationSettingsAction } from "@/app/actions/integrations";
import { Switch } from "@/components/ui/switch";
import type { IntegrationSettingsSummary } from "@/lib/integration-settings";

type Notifications = IntegrationSettingsSummary["notifications"];

interface Props {
  initial: Notifications;
}

/** Platform-wide master switch for notification email. Saves immediately on
 * toggle (no Save button) — sign-in/invite email is never affected. */
export function NotificationEmailSettingsForm({ initial }: Props) {
  const [enabled, setEnabled] = useState(initial.emailsEnabled);
  const [saving, setSaving] = useState(false);

  async function handleChange(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      const result = await saveIntegrationSettingsAction({
        notifications: { emailsEnabled: next },
      });
      if ("error" in result) {
        setEnabled(previous);
        toast.error(result.error);
        return;
      }
      toast.success(
        next
          ? "Notification emails turned on."
          : "Notification emails turned off."
      );
    } catch {
      setEnabled(previous);
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-base-300 bg-elevated">
      <div className="flex items-center gap-3.5 px-5 py-4 sm:px-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-base-200 text-base-content">
          <EnvelopeSimpleIcon className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-base-content">
              Notification emails
            </h3>
            <span
              className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
                enabled
                  ? "bg-success/15 text-success"
                  : "bg-warning/15 text-warning"
              }`}
            >
              {enabled ? "On" : "Off"}
            </span>
          </div>
          <p className="mt-0.5 text-xs font-normal text-base-content/60">
            Master switch for mention, assignment, reminder and digest emails
            for every user. Sign-in, invite and password-reset emails are never
            affected.
          </p>
        </div>
        <Switch
          aria-label="Notification emails"
          checked={enabled}
          disabled={saving}
          onCheckedChange={handleChange}
        />
      </div>
      {!enabled && (
        <p className="border-t border-base-300 bg-warning/10 px-5 py-3 text-xs text-base-content/80 sm:px-6">
          Notification emails are <strong>off for all users</strong>. In-app and
          push notifications still work, and users' own email preferences are
          kept and apply again when this is turned back on.
        </p>
      )}
    </div>
  );
}
