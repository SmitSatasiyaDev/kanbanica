"use client";

import { ChatCircleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ChecklistStatus } from "@/lib/daily-checklist/constants";
import { summarizeFieldValues } from "@/lib/daily-checklist/field-summary";
import { isRowOverdue } from "@/lib/daily-checklist/overdue";
import { hasNote } from "@/lib/daily-checklist/team-aggregate";
import type { TeamItemRow } from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { useNow } from "./use-now";

const MAX_SUMMARY = 4;

/** Saved custom-field values under the title: secondary text, wraps (stacked on mobile), never widens the page. */
export function FieldSummary({ row }: { row: TeamItemRow }) {
  const entries = summarizeFieldValues(row.fields);
  if (entries.length === 0) {
    return null;
  }
  const shown = entries.slice(0, MAX_SUMMARY);
  const more = entries.length - shown.length;
  return (
    <ul
      className="flex min-w-0 flex-col text-base-content/60 text-xs sm:flex-row sm:flex-wrap"
      data-testid="field-summary"
    >
      {shown.map((e) => (
        <li
          className="max-w-full break-words sm:not-last:after:mx-1.5 sm:not-last:after:content-['·']"
          key={e.id}
        >
          <span>{e.label}:</span>{" "}
          <span className="text-base-content/80">{e.text}</span>
        </li>
      ))}
      {more > 0 && <li>+{more} more in Details</li>}
    </ul>
  );
}

export function DetailsButton({
  row,
  onOpen,
}: {
  onOpen: () => void;
  row: TeamItemRow;
}) {
  const n = row.fields?.length ?? 0;
  // Details only holds the item's custom fields — nothing to open when it has none.
  if (row.fields && n === 0) {
    return null;
  }
  return (
    <Button
      aria-label={`Open details: ${row.title}`}
      className="-ml-3 h-7 px-3 text-primary"
      onClick={onOpen}
      size="xs"
      type="button"
      variant="ghost"
    >
      {n > 0 ? `Details (${n} ${n === 1 ? "field" : "fields"})` : "Details"}
    </Button>
  );
}

/** Checklist checkbox: Done = checked; Pending and In progress = unchecked (status is kept as-is until toggled). */
export function RowCheckbox({
  row,
  onChange,
  className,
}: {
  className?: string;
  onChange: (s: ChecklistStatus) => void;
  row: TeamItemRow;
}) {
  const done = row.status === "DONE";
  return (
    <Checkbox
      aria-label={`${done ? "Mark pending" : "Mark done"}: ${row.title}`}
      checked={done}
      className={cn("mt-0.5 size-5", className)}
      disabled={!row.editable}
      onCheckedChange={(c) => onChange(c === true ? "DONE" : "PENDING")}
      title={row.status === "IN_PROGRESS" ? "In progress" : undefined}
    />
  );
}

/** Note action: icon plus a count only when a note is actually saved. Read-only viewers only see it if a note exists. */
export function NoteButton({
  row,
  onOpen,
}: {
  onOpen: () => void;
  row: TeamItemRow;
}) {
  const has = hasNote(row);
  if (!(has || row.editable)) {
    return null;
  }
  return (
    <Button
      aria-label={
        has ? `Note for ${row.title} (1)` : `Add note for ${row.title}`
      }
      className="h-8 min-w-8 gap-1 px-2 text-base-content/70"
      onClick={onOpen}
      size="xs"
      type="button"
      variant="ghost"
    >
      <ChatCircleIcon
        aria-hidden
        className="size-4"
        weight={has ? "fill" : "regular"}
      />
      {has && <span className="text-xs">1</span>}
    </Button>
  );
}

/**
 * Collapsed parent summary: how many members have a saved note. It never opens a note —
 * it toggles the member list, where each member's own note icon identifies whose note it is.
 */
export function AggregateNoteButton({
  count,
  title,
  open,
  onToggle,
}: {
  count: number;
  onToggle: () => void;
  open: boolean;
  title: string;
}) {
  return (
    <Button
      aria-expanded={open}
      aria-label={
        count > 0
          ? `${count} ${count === 1 ? "member has" : "members have"} a note: ${title}. ${open ? "Hide" : "Show"} members`
          : `No notes yet: ${title}. ${open ? "Hide" : "Show"} members`
      }
      className="h-8 min-w-8 gap-1 px-2 text-base-content/70"
      data-testid="aggregate-note"
      onClick={onToggle}
      size="xs"
      type="button"
      variant="ghost"
    >
      <ChatCircleIcon
        aria-hidden
        className="size-4"
        weight={count > 0 ? "fill" : "regular"}
      />
      {count > 0 && <span className="text-xs">{count}</span>}
    </Button>
  );
}

/**
 * Due time of a row (or of a group's members). Shows "Overdue · HH:MM" in the danger color
 * once today's due time has passed for any not-yet-done assignee; otherwise the plain time.
 * Display-only — never blocks completion, never applied to past or future days.
 */
export function DueLabel({
  dueTime,
  rows,
  prefix = "",
}: {
  dueTime: string | null;
  prefix?: string;
  rows: TeamItemRow[];
}) {
  const now = useNow();
  if (!dueTime) {
    return <>—</>;
  }
  if (rows.some((r) => isRowOverdue(r, now))) {
    return (
      <span
        className="font-medium text-error"
        title={`Overdue. Due at ${dueTime}.`}
      >
        <span className="sr-only">{`Overdue. Due at ${dueTime}.`}</span>
        <span aria-hidden="true">Overdue · {dueTime}</span>
      </span>
    );
  }
  return (
    <>
      {prefix}
      {dueTime}
    </>
  );
}
