"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateUserTimezone } from "@/app/actions/profile";
import { TimezoneSelect } from "@/components/common/timezone-select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { detectBrowserTimezone } from "@/lib/timezone";

// Personal: decides which calendar day your Daily Checklist is on. Falls back to
// the workspace timezone, then UTC, when not set.
export function TimezoneCard({
  timezone,
  workspaceTimezone,
}: {
  timezone: string | null;
  workspaceTimezone: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(timezone);
  const dirty = value !== timezone;

  function save(next: string | null) {
    startTransition(async () => {
      const res = await updateUserTimezone(next);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Timezone updated");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timezone</CardTitle>
        <CardDescription>
          Sets which day your Daily Checklist is on. Changing it never alters
          past checklist days.
        </CardDescription>
      </CardHeader>
      <CardContent className="max-w-md space-y-3">
        <Label htmlFor="user-timezone">Timezone</Label>
        <TimezoneSelect
          id="user-timezone"
          onChange={setValue}
          unsetLabel={`Use workspace default (${workspaceTimezone ?? "UTC"})`}
          value={value}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            className="gap-2"
            disabled={pending || !dirty}
            onClick={() => save(value)}
            size="sm"
          >
            {pending && <Spinner className="size-4" />}
            Save
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              const tz = detectBrowserTimezone();
              if (tz) {
                setValue(tz);
              } else {
                toast.error("Couldn't detect your browser timezone");
              }
            }}
            size="sm"
            variant="secondary"
          >
            Detect from browser
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
