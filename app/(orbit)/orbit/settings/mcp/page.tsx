import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { OrbitPageHeader } from "@/components/admin/orbit-page-header";
import { McpSettingsForm } from "@/components/orbit/settings/mcp-settings-form";
import { getIntegrationSettingsSummary } from "@/lib/integration-settings";

export const metadata = {
  title: "API access (MCP)",
};

// Settings queried here must be per-request, not build-time.
export const dynamic = "force-dynamic";

export default async function OrbitMcpSettingsPage() {
  const settings = await getIntegrationSettingsSummary();

  return (
    <div>
      <Link
        className="-ml-3 mb-4 inline-flex items-center gap-3 rounded-md px-3 py-2 text-sm text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
        href="/orbit/settings"
      >
        <ArrowLeftIcon className="size-4 shrink-0" />
        Back to Settings
      </Link>
      <OrbitPageHeader
        description="Let users connect tools such as Claude Code with personal API tokens. Changes apply immediately."
        eyebrow="Settings"
        title="API access (MCP)"
      />
      <div className="max-w-5xl">
        <McpSettingsForm initial={settings.mcp} />
      </div>
    </div>
  );
}
