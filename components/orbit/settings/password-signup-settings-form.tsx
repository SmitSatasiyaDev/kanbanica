"use client";

import { UserPlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { saveIntegrationSettingsAction } from "@/app/actions/integrations";
import { Switch } from "@/components/ui/switch";
import type { IntegrationSettingsSummary } from "@/lib/integration-settings";

type Auth = IntegrationSettingsSummary["auth"];

interface Props {
  initial: Auth;
}

/** Platform-wide switch for email + password registration. Saves
 * immediately on toggle (no Save button) and applies with no restart — sign-in
 * (and magic link / Google) is never affected. */
export function PasswordSignupSettingsForm({ initial }: Props) {
  const [enabled, setEnabled] = useState(initial.passwordSignupEnabled);
  const [saving, setSaving] = useState(false);

  async function handleChange(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      const result = await saveIntegrationSettingsAction({
        auth: { passwordSignupEnabled: next },
      });
      if ("error" in result) {
        setEnabled(previous);
        toast.error(result.error);
        return;
      }
      toast.success(
        next ? "Email + password turned on." : "Email + password turned off."
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
          <UserPlusIcon className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-base-content">
              Email + password
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
            Lets people register and sign in with an email and password. People
            who already have a password can always sign in, and magic link and
            Google are unaffected.
          </p>
        </div>
        <Switch
          aria-label="Email and password"
          checked={enabled}
          disabled={saving}
          onCheckedChange={handleChange}
        />
      </div>
      {!enabled && (
        <p className="border-t border-base-300 bg-warning/10 px-5 py-3 text-xs text-base-content/80 sm:px-6">
          Registration is <strong>closed</strong>: the instance is invite-only.
        </p>
      )}
    </div>
  );
}
