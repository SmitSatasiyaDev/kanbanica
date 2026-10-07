"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatUtcOffset, groupedTimeZones, normalizeTimeZone } from "@/lib/timezone";

const UNSET = "__unset__";

/**
 * IANA timezone picker over every zone the runtime supports, grouped by region.
 * `value` null = "not set"; pass `unsetLabel` to offer that as a choice.
 */
export function TimezoneSelect({
  value,
  onChange,
  unsetLabel,
  id,
  disabled,
}: {
  disabled?: boolean;
  id?: string;
  onChange: (tz: string | null) => void;
  unsetLabel?: string;
  value: string | null;
}) {
  // Zone list comes from the runtime; compute after mount to avoid SSR/client drift.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const groups = useMemo(() => (mounted ? groupedTimeZones() : []), [mounted]);

  const shown = value ? normalizeTimeZone(value) : null;
  const known = groups.some((g) => g.zones.some((z) => z.value === shown));
  return (
    <Select
      disabled={disabled}
      onValueChange={(v) => onChange(v === UNSET ? null : v)}
      value={shown ?? UNSET}
    >
      <SelectTrigger aria-label="Timezone" className="w-full" id={id}>
        <SelectValue placeholder="Select timezone…" />
      </SelectTrigger>
      <SelectContent className="max-h-80 p-1.5">
        {unsetLabel && <SelectItem value={UNSET}>{unsetLabel}</SelectItem>}
        {shown && !known && mounted && (
          <SelectItem value={shown}>
            {shown} ({formatUtcOffset(shown)})
          </SelectItem>
        )}
        {groups.map((g) => (
          <SelectGroup key={g.region}>
            <SelectLabel>{g.region}</SelectLabel>
            {g.zones.map((z) => (
              <SelectItem key={z.value} value={z.value}>
                {g.region}/{z.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
