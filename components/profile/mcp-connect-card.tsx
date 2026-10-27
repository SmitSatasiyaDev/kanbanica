"use client";

import { CopyIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  appUrl: string;
}

/**
 * Permanent "how to connect" reference. Always shows placeholders, never a
 * real token (the one-time reveal dialog is the only place a token appears).
 */
export function McpConnectCard({ appUrl }: Props) {
  const serverUrl = `${appUrl}/api/mcp`;
  const claudeCodeCommand = `claude mcp add --transport http kanbanica ${serverUrl} --header "Authorization: Bearer kbn_YOUR_TOKEN"`;

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>How to connect</CardTitle>
        <CardDescription>
          Use your server URL and an API token to connect Claude to your tasks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label className="text-base-content/60 text-xs">Server URL</Label>
          <div className="flex gap-2">
            <Input
              aria-label="MCP server URL"
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              value={serverUrl}
            />
            <Button
              aria-label="Copy server URL"
              onClick={() => copy(serverUrl, "Server URL copied")}
              size="icon"
              variant="outline"
            >
              <CopyIcon className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-base-content/60 text-xs">Claude Code</Label>
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md border border-base-300 bg-base-200 px-3 py-2 font-mono text-xs">
              {claudeCodeCommand}
            </pre>
            <Button
              aria-label="Copy Claude Code command"
              onClick={() => copy(claudeCodeCommand, "Command copied")}
              size="icon"
              variant="outline"
            >
              <CopyIcon className="size-4" />
            </Button>
          </div>
          <p className="text-base-content/60 text-xs">
            Replace kbn_YOUR_TOKEN with your token.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-base-content/60 text-xs">
            Claude app (claude.ai, Claude Desktop, mobile)
          </Label>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Open Settings → Connectors → Add custom connector.</li>
            <li>Name: Kanbanica. URL: the server URL above.</li>
            <li>
              Add a header{" "}
              <span className="font-mono text-xs">Authorization</span> with
              value{" "}
              <span className="font-mono text-xs">Bearer kbn_YOUR_TOKEN</span>.
            </li>
            <li>Save, then enable it in a chat.</li>
          </ol>
          <p className="text-base-content/60 text-xs">
            Works on Pro and Max. On Team and Enterprise plans an owner adds
            connectors for everyone with one shared credential, so don't use a
            personal token there.
          </p>
          <p className="text-base-content/60 text-xs">
            Your Kanbanica address must be reachable from the internet for the
            Claude app; Claude Code also works on a private network.
          </p>
        </div>

        <p className="text-base-content/60 text-xs">
          Tokens are shown only once. Lost one? Revoke it below and create a new
          one.
        </p>
      </CardContent>
    </Card>
  );
}
