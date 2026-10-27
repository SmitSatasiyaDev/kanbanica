import { notFound } from "next/navigation";
import { ApiTokensCard } from "@/components/profile/api-tokens-card";
import { McpConnectCard } from "@/components/profile/mcp-connect-card";
import { PageHeader } from "@/components/scaffold/page-header";
import { listApiTokens, tokenEligibleWorkspaces } from "@/lib/api-token";
import { requireSession } from "@/lib/authz";
import { env } from "@/lib/env";
import { isMcpEnabled } from "@/lib/integration-settings";

export const metadata = {
  title: "API tokens & MCP",
};

export default async function ApiTokensPage() {
  const current = await requireSession();
  if (!(await isMcpEnabled())) {
    notFound();
  }

  const [apiTokens, tokenWorkspaces] = await Promise.all([
    listApiTokens(current.user.id),
    tokenEligibleWorkspaces(current.user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        description="Connect Claude and other MCP tools to your tasks with a personal API token."
        eyebrow="Preferences"
        title="API tokens & MCP"
      />

      <div className="space-y-6">
        <McpConnectCard appUrl={env.APP_URL} />

        <ApiTokensCard
          appUrl={env.APP_URL}
          eligibleWorkspaces={tokenWorkspaces}
          tokens={apiTokens.map((t) => ({
            expiresAt: t.expiresAt?.toISOString() ?? null,
            id: t.id,
            lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
            name: t.name,
            scope: t.scope,
            tokenPrefix: t.tokenPrefix,
            workspaceId: t.workspaceId,
            workspaceName: t.workspaceName,
          }))}
        />
      </div>
    </div>
  );
}
