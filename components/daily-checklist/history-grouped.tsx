"use client";

import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { groupHistory } from "@/lib/daily-checklist/history-group";
import { computeProgress } from "@/lib/daily-checklist/progress";
import type { HistoryRow } from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { DayStatusLabel, formatLongDate } from "./shared";

/**
 * One flat table: every saved checklist day is a row (date → checklist → member order, newest
 * first), so nothing needs expanding. Presentation only; each row is still its own saved day and
 * opens that day's detail.
 */
export function GroupedHistory({
  rows,
  onOpen,
  showUser,
}: {
  onOpen: (row: HistoryRow) => void;
  rows: HistoryRow[];
  showUser: boolean;
}) {
  const flat = useMemo(
    () =>
      groupHistory(rows).flatMap((d) =>
        d.templates.flatMap((t) =>
          t.members.map((r) => ({ r, firstOfDate: false }))
        )
      ),
    [rows]
  );
  // Mark the first row of each date (dates are contiguous after grouping).
  let prev: string | null = null;
  for (const x of flat) {
    x.firstOfDate = x.r.date !== prev;
    prev = x.r.date;
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-base-300"
      data-testid="history-table"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Checklist</TableHead>
            {showUser && (
              <TableHead className="hidden sm:table-cell">Member</TableHead>
            )}
            <TableHead className="text-right">Progress</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flat.map(({ r, firstOfDate }) => {
            const p = computeProgress({
              completed: r.completed,
              total: r.total,
            });
            return (
              <TableRow
                className={cn(
                  "cursor-pointer focus-visible:bg-base-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                  firstOfDate && "border-t border-t-base-300"
                )}
                key={r.dayId}
                onClick={() => onOpen(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(r);
                  }
                }}
                tabIndex={0}
              >
                <TableCell
                  className={cn(
                    "whitespace-nowrap",
                    firstOfDate ? "font-medium" : "text-base-content/50"
                  )}
                >
                  {formatLongDate(r.date)}
                </TableCell>
                <TableCell className="max-w-0 min-w-32 truncate">
                  {r.templateName ?? "Checklist"}
                  {showUser && r.userName && (
                    <span className="block truncate text-base-content/60 text-xs sm:hidden">
                      {r.userName}
                    </span>
                  )}
                </TableCell>
                {showUser && (
                  <TableCell className="hidden max-w-0 truncate sm:table-cell">
                    {r.userName ?? "—"}
                  </TableCell>
                )}
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {r.completed}/{r.total} · {p.percent}%
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <DayStatusLabel status={r.status} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
