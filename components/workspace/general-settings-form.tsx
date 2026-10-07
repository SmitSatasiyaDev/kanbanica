"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateWorkspace } from "@/app/actions/workspace";
import { TimezoneSelect } from "@/components/common/timezone-select";
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
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const LOGO_EMOJIS = ["🚀", "🏢", "⭐", "🎯", "💼", "🔥", "🛠️", "📈", "🎨", "🌱"];

interface GeneralSettingsFormProps {
  workspace: {
    id: string;
    name: string;
    slug: string;
    logoEmoji: string | null;
    timezone: string | null;
  };
}

export function GeneralSettingsForm({ workspace }: GeneralSettingsFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [logoEmoji, setLogoEmoji] = useState(workspace.logoEmoji);
  const [timezone, setTimezone] = useState(workspace.timezone);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateWorkspace({
        workspaceId: workspace.id,
        name: name.trim(),
        slug: slug.trim(),
        logoEmoji,
        timezone,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Workspace updated");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="normal-case tracking-normal text-base font-semibold">
          General
        </CardTitle>
        <CardDescription>Workspace name, logo, URL slug and timezone.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5 max-w-md" onSubmit={handleSave}>
          <div className="space-y-2">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input
              id="ws-name"
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              required
              value={name}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-slug">URL slug</Label>
            <Input
              id="ws-slug"
              maxLength={48}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              required
              value={slug}
            />
            <p className="text-xs text-base-content/60">
              Vanity alias only — changing it never breaks existing links.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Logo</Label>
            <div className="flex flex-wrap gap-1.5">
              {LOGO_EMOJIS.map((emoji) => (
                <button
                  aria-pressed={logoEmoji === emoji}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors hover:bg-base-200",
                    logoEmoji === emoji && "border-primary bg-primary/10"
                  )}
                  key={emoji}
                  onClick={() =>
                    setLogoEmoji(logoEmoji === emoji ? null : emoji)
                  }
                  type="button"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <p className="text-xs text-base-content/60">
              Image upload arrives with the avatar system.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-timezone">Workspace timezone</Label>
            <TimezoneSelect
              id="ws-timezone"
              onChange={setTimezone}
              unsetLabel="Not set (UTC)"
              value={timezone}
            />
            <p className="text-xs text-base-content/60">
              Default for Daily Checklist dates for members who haven't set
              their own timezone in Profile Settings.
            </p>
          </div>

          <Button
            className="gap-2"
            disabled={pending || !name.trim() || !slug.trim()}
            type="submit"
          >
            {pending && <Spinner className="size-4" />}
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
