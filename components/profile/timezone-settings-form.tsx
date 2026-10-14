"use client";

import { CheckIcon, GlobeIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { updateTimezone } from "@/app/actions/profile";
import { TZ_AUTODETECT_KEY } from "@/components/common/timezone-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@/components/ui/combobox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { detectBrowserTimezone, todayInTz } from "@/lib/due-date";

function allTimezones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return ["UTC"];
  }
}

// Personal — decides what "today" means for your due dates (overdue / due
// today). Auto-detected from the browser on first visit.
export function TimezoneSettingsForm({ timezone }: { timezone: string }) {
  const router = useRouter();
  const zones = React.useMemo(allTimezones, []);
  const [saved, setSaved] = React.useState(timezone);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [detected, setDetected] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDetected(detectBrowserTimezone());
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase().replace(/ /g, "_");
    return q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones;
  }, [zones, query]);

  async function save(next: string) {
    if (next === saved) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const res = await updateTimezone(next);
    setSaving(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    try {
      localStorage.setItem(TZ_AUTODETECT_KEY, "1");
    } catch {
      // ignore
    }
    setSaved(next);
    setOpen(false);
    toast.success("Timezone updated");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timezone</CardTitle>
        <CardDescription>
          Decides when a day starts for you, so a task due today isn&apos;t
          marked overdue until your day is over. Personal to your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            <Button
              className="w-full justify-start gap-2 sm:w-80"
              disabled={saving}
              type="button"
              variant="outline"
            >
              <GlobeIcon className="size-4" />
              {saved.replace(/_/g, " ")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0">
            <Combobox<string | null>
              immediate
              onChange={(zone) => {
                if (zone) {
                  save(zone);
                }
              }}
              value={saved}
            >
              <ComboboxInput
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search timezones…"
                value={query}
              />
              <ComboboxOptions static>
                {filtered.length === 0 && (
                  <ComboboxEmpty>No matching timezone.</ComboboxEmpty>
                )}
                {filtered.map((zone) => (
                  <ComboboxOption key={zone} value={zone}>
                    <span className="truncate">{zone.replace(/_/g, " ")}</span>
                    {zone === saved && (
                      <CheckIcon className="ml-auto size-3.5 text-primary" />
                    )}
                  </ComboboxOption>
                ))}
              </ComboboxOptions>
            </Combobox>
          </PopoverContent>
        </Popover>
        <p className="text-xs text-base-content/60">
          It&apos;s currently {todayInTz(saved)} in {saved.replace(/_/g, " ")}.
        </p>
        {detected && detected !== saved && (
          <p className="text-xs text-base-content/60">
            Your browser reports {detected.replace(/_/g, " ")}.{" "}
            <button
              className="cursor-pointer text-primary underline"
              disabled={saving}
              onClick={() => save(detected)}
              type="button"
            >
              Use it
            </button>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
