"use client";

import { PlugsConnectedIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { saveIntegrationSettingsAction } from "@/app/actions/integrations";
import { Switch } from "@/components/ui/switch";
import type { IntegrationSettingsSummary } from "@/lib/integration-settings";

type Mcp = IntegrationSettingsSummary["mcp"];

interface Props {
  initial: Mcp;
}

/** Platform-wide switch for MCP / personal API token access. Saves immediately
 * on toggle (no Save button). */
export function McpSettingsForm({ initial }: Props) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [saving, setSaving] = useState(false);

  async function handleChange(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      const result = await saveIntegrationSettingsAction({
        mcp: { enabled: next },
      });
      if ("error" in result) {
        setEnabled(previous);
        toast.error(result.error);
        return;
      }
      toast.success(next ? "API access turned on." : "API access turned off.");
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
          <PlugsConnectedIcon className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-base-content">
              API access (MCP)
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
            Lets users create personal API tokens on their Profile page and
            connect tools through the MCP endpoint. Guests can never create
            tokens.
          </p>
        </div>
        <Switch
          aria-label="API access (MCP)"
          checked={enabled}
          disabled={saving}
          onCheckedChange={handleChange}
        />
      </div>
      {!enabled && (
        <p className="border-t border-base-300 bg-warning/10 px-5 py-3 text-xs text-base-content/80 sm:px-6">
          API access is <strong>off for everyone</strong>. The API tokens card
          is hidden and the MCP endpoint rejects requests. Existing tokens are
          kept and work again when this is turned back on.
        </p>
      )}
    </div>
  );
}
