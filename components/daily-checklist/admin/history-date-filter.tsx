"use client";

import { CalendarBlankIcon } from "@phosphor-icons/react";
import { format, parse } from "date-fns";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const ISO = "yyyy-MM-dd";
const toDate = (s: string) => parse(s, ISO, new Date());

/**
 * Jump-to-date filter for Admin History. Dates are plain checklist dates (YYYY-MM-DD, no
 * timezone math); future days (after the admin's own "today") can't be picked.
 */
export function HistoryDateFilter({
  value,
  today,
  onChange,
}: {
  onChange: (date: string | null) => void;
  today: string;
  value: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-label="Select history date"
            size="sm"
            type="button"
            variant="outline"
          >
            <CalendarBlankIcon className="size-4" />
            {value ? format(toDate(value), "MMM d, yyyy") : "Select date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            defaultMonth={toDate(value ?? today)}
            disabled={{ after: toDate(today) }}
            mode="single"
            onSelect={(d) => {
              if (d) {
                onChange(format(d, ISO));
                setOpen(false);
              }
            }}
            selected={value ? toDate(value) : undefined}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          onClick={() => onChange(null)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Clear
        </Button>
      )}
    </div>
  );
}
