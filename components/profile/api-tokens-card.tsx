"use client";

import { CopyIcon, KeyIcon, TrashIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { createMyApiToken, revokeMyApiToken } from "@/app/actions/api-token";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

export interface ApiTokenRow {
  expiresAt: string | null;
  id: string;
  lastUsedAt: string | null;
  name: string;
  scope: string;
  tokenPrefix: string;
  workspaceId: string | null;
  workspaceName: string | null;
}

export interface TokenWorkspaceOption {
  id: string;
  name: string;
}

const ALL_WORKSPACES = "all";
const NEVER = "never";
const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" },
  { value: NEVER, label: "Never" },
];

interface Props {
  appUrl: string;
  /** Workspaces where the user is a non-guest member; empty = not eligible. */
  eligibleWorkspaces: TokenWorkspaceOption[];
  tokens: ApiTokenRow[];
}

export function ApiTokensCard({ appUrl, eligibleWorkspaces, tokens }: Props) {
  const router = useRouter();
  const eligible = eligibleWorkspaces.length > 0;

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [workspaceId, setWorkspaceId] = useState(ALL_WORKSPACES);
  const [expiry, setExpiry] = useState("90");
  const [creating, setCreating] = useState(false);
  // The plain token lives only here and is dropped when the dialog closes.
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<ApiTokenRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  function resetCreateForm() {
    setName("");
    setScope("read");
    setWorkspaceId(ALL_WORKSPACES);
    setExpiry("90");
  }

  function openCreate() {
    resetCreateForm();
    setRevealedToken(null);
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    setRevealedToken(null);
    resetCreateForm();
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Give the token a name.");
      return;
    }
    setCreating(true);
    try {
      const result = await createMyApiToken({
        name: name.trim(),
        scope,
        workspaceId: workspaceId === ALL_WORKSPACES ? null : workspaceId,
        expiresInDays: expiry === NEVER ? null : Number(expiry),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setRevealedToken(result.token);
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) {
      return;
    }
    setRevoking(true);
    try {
      const result = await revokeMyApiToken(revokeTarget.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Token revoked");
      setRevokeTarget(null);
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setRevoking(false);
    }
  }

  const setupCommand = revealedToken
    ? `claude mcp add --transport http kanbanica ${appUrl}/api/mcp --header "Authorization: Bearer ${revealedToken}"`
    : "";

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>API tokens</CardTitle>
          <CardDescription>
            Personal tokens let tools such as Claude Code read and update your
            tasks over MCP. A token can never do more than you can.
          </CardDescription>
        </div>
        {eligible && (
          <Button onClick={openCreate} size="sm" variant="secondary">
            <KeyIcon className="size-4" />
            Create token
          </Button>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {eligible ? (
          tokens.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => {
                  const expired =
                    token.expiresAt !== null &&
                    new Date(token.expiresAt).getTime() <= Date.now();
                  return (
                    <TableRow key={token.id}>
                      <TableCell className="font-semibold">
                        {token.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        kbn_{token.tokenPrefix}…
                      </TableCell>
                      <TableCell>
                        {token.scope === "write" ? "Read & write" : "Read only"}
                      </TableCell>
                      <TableCell>
                        {token.workspaceId
                          ? (token.workspaceName ?? "Unavailable workspace")
                          : "All workspaces"}
                      </TableCell>
                      <TableCell>{formatDateTime(token.lastUsedAt)}</TableCell>
                      <TableCell>
                        {expired ? (
                          <Badge className="text-warning">Expired</Badge>
                        ) : token.expiresAt ? (
                          formatDateTime(token.expiresAt)
                        ) : (
                          "Never"
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          onClick={() => setRevokeTarget(token)}
                          size="sm"
                          variant="secondary"
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="px-6 pb-6 text-sm text-base-content/60">
              No tokens yet. Create one to connect an MCP client.
            </p>
          )
        ) : (
          <p className="px-6 pb-6 text-sm text-base-content/60">
            API tokens are only available to workspace members. You are a guest
            in every workspace you belong to, so you can't create one here.
          </p>
        )}
      </CardContent>

      {/* Create + one-time reveal. While the token is shown, only the explicit
          button closes the dialog: Escape, the overlay and the X are ignored. */}
      <Dialog
        onOpenChange={(next) => {
          if (next) {
            return;
          }
          if (revealedToken) {
            return;
          }
          closeCreate();
        }}
        open={createOpen}
      >
        <DialogContent
          className="sm:max-w-lg"
          onEscapeKeyDown={(event) => {
            if (revealedToken) {
              event.preventDefault();
            }
          }}
          showCloseButton={!revealedToken}
        >
          {revealedToken ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your token</DialogTitle>
                <DialogDescription>
                  This is the only time the token is shown. Store it somewhere
                  safe before closing.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    aria-label="API token"
                    className="font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                    readOnly
                    value={revealedToken}
                  />
                  <Button
                    aria-label="Copy token"
                    onClick={() => handleCopy(revealedToken)}
                    size="icon"
                    variant="outline"
                  >
                    <CopyIcon className="size-4" />
                  </Button>
                </div>
                <p className="rounded-md bg-warning/10 px-3 py-2 text-base-content/80 text-xs">
                  Treat this like a password. Anyone with it can act as you
                  within the scope you chose. You won't be able to see it again;
                  if you lose it, revoke it and create a new one.
                </p>
                <div className="space-y-2">
                  <Label className="text-base-content/60 text-xs">
                    Connect Claude Code
                  </Label>
                  <div className="flex items-start gap-2">
                    <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md border border-base-300 bg-base-200 px-3 py-2 font-mono text-xs">
                      {setupCommand}
                    </pre>
                    <Button
                      aria-label="Copy setup command"
                      onClick={() => handleCopy(setupCommand)}
                      size="icon"
                      variant="outline"
                    >
                      <CopyIcon className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeCreate}>I've copied it</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create API token</DialogTitle>
                <DialogDescription>
                  The token is shown once after you create it.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-token-name">Name</Label>
                  <Input
                    id="api-token-name"
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Claude Code on laptop"
                    value={name}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Access</Label>
                  <Select
                    onValueChange={(value) =>
                      setScope(value === "write" ? "write" : "read")
                    }
                    value={scope}
                  >
                    <SelectTrigger aria-label="Token scope" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="p-1.5">
                      <SelectItem value="read">Read only</SelectItem>
                      <SelectItem value="write">Read & write</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Workspace</Label>
                  <Select onValueChange={setWorkspaceId} value={workspaceId}>
                    <SelectTrigger
                      aria-label="Token workspace"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="p-1.5">
                      <SelectItem value={ALL_WORKSPACES}>
                        All my workspaces
                      </SelectItem>
                      {eligibleWorkspaces.map((workspace) => (
                        <SelectItem key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Expires</Label>
                  <Select onValueChange={setExpiry} value={expiry}>
                    <SelectTrigger aria-label="Token expiry" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="p-1.5">
                      {EXPIRY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={creating}
                  onClick={closeCreate}
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button disabled={creating} onClick={handleCreate}>
                  {creating && <Spinner className="size-4" />}
                  Create token
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <Dialog
        onOpenChange={(next) => {
          if (!(next || revoking)) {
            setRevokeTarget(null);
          }
        }}
        open={revokeTarget !== null}
      >
        <DialogContent className="sm:max-w-xs text-center">
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-error/10">
              <TrashIcon className="size-6 text-error" weight="fill" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Revoke this token?
              </DialogTitle>
              <p className="mt-1 text-base-content/60 text-sm">
                {revokeTarget
                  ? `"${revokeTarget.name}" stops working immediately. Tools using it will lose access.`
                  : ""}
              </p>
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              className="flex-1"
              disabled={revoking}
              onClick={() => setRevokeTarget(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={revoking}
              onClick={confirmRevoke}
              variant="destructive"
            >
              {revoking && <Spinner className="size-4" />}
              Revoke
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
