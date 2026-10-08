"use client";

import {
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  ListChecksIcon,
} from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { getChecklistHistoryItems } from "@/app/actions/daily-checklist-history";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DayStatus } from "@/lib/daily-checklist/progress";
import { summarizeAdminToday } from "@/lib/daily-checklist/today-view";
import type {
  HistoryItemsResult,
  TodayInstanceRow,
} from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { ExpandBlock, ExpandRow } from "../expand-panel";
import { DayStatusBadge, EmptyState, formatShortDate } from "../shared";
import { SummaryCardGrid } from "../summary-cards";
import { CountUnit } from "../today-checklists";
import { useAutoExpand } from "../use-auto-expand";
import { InlineDetail } from "./history-report";

/**
 * Admin → Today's Checklists: the same cards / table / inline-expand language as History, for
 * today's saved days (read-only; the items of an opened row load in one request).
 */
type TodayFilter = Extract<
  DayStatus,
  "IN_PROGRESS" | "NOT_STARTED" | "COMPLETE"
>;

const FILTER_EMPTY: Record<TodayFilter, string> = {
  IN_PROGRESS: "in progress",
  NOT_STARTED: "not started",
  COMPLETE: "completed",
};

export function TodayGroups({
  rows: allRows,
  date,
  workspaceId,
}: {
  date: string;
  rows: TodayInstanceRow[];
  workspaceId: string;
}) {
  // Cards are filters over the already-loaded rows (counts always cover the whole day).
  // Open by default the first time; afterwards the user's last expand/collapse decides.
  const [auto, setAuto] = useAutoExpand("today-admin");
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(auto ? allRows.map((r) => r.dayId) : [])
  );
  const commit = (next: Set<string>) => {
    setOpenIds(next);
    setAuto(next.size > 0);
  };
  const [filter, setFilter] = useState<TodayFilter | null>(null);
  const summary = useMemo(() => summarizeAdminToday(allRows), [allRows]);
  const rows = filter ? allRows.filter((r) => r.status === filter) : allRows;
  // A card filter opens the checklists it shows (unless the user last collapsed).
  const pick = (f: TodayFilter | null) => {
    const next = f === null || filter === f ? null : f;
    setFilter(next);
    setOpenIds(
      new Set(
        auto
          ? allRows
              .filter((r) => !next || r.status === next)
              .map((r) => r.dayId)
          : []
      )
    );
  };
  const allOpen = rows.length > 0 && rows.every((r) => openIds.has(r.dayId));
  const [details, setDetails] = useState<Record<string, HistoryItemsResult>>(
    {}
  );
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => {
    const n = new Set(openIds);
    if (!n.delete(id)) {
      n.add(id);
    }
    commit(n);
  };
  const dateLabel = `${formatShortDate(date)}, ${date.slice(0, 4)}`;

  // ONE batched request for every open row not loaded yet (saved days don't change).
  useEffect(() => {
    // The action takes ≤50 days per call; the effect re-runs until every open row is loaded.
    const missing = [...openIds].filter((id) => !details[id]).slice(0, 50);
    if (missing.length === 0) {
      return;
    }
    let live = true;
    getChecklistHistoryItems(workspaceId, missing).then((res) => {
      if (!live) {
        return;
      }
      if ("error" in res && typeof res.error === "string") {
        setError(res.error);
      } else {
        setError(null);
        const got = res as Record<string, HistoryItemsResult>;
        const empty = (id: string): HistoryItemsResult => ({
          dayId: id,
          items: [],
          timezone: "UTC",
        });
        // Ids the server didn't return are filled with an empty day so the loop always ends.
        setDetails((d) => ({
          ...d,
          ...Object.fromEntries(
            missing.map((id) => [id, got[id] ?? empty(id)])
          ),
        }));
      }
    });
    return () => {
      live = false;
    };
  }, [openIds, details, workspaceId]);

  const toggleBtn = (r: TodayInstanceRow, className?: string) => (
    <Button
      aria-controls={`today-${r.dayId}`}
      aria-expanded={openIds.has(r.dayId)}
      aria-label={`${openIds.has(r.dayId) ? "Hide" : "View"} ${r.userName}, ${r.templateName ?? "Checklist"}`}
      className={className}
      onClick={() => toggle(r.dayId)}
      size="sm"
      type="button"
      variant="secondary"
    >
      {openIds.has(r.dayId) ? "Hide" : "View"}
    </Button>
  );

  return (
    <div className="space-y-5">
      <SummaryCardGrid
        cards={[
          {
            label: "Tasks done",
            value: `${summary.tasksDone} / ${summary.tasksTotal}`,
            Icon: CheckCircleIcon,
            tone: "bg-success/15 text-success",
            onClick: () => pick(null),
            title: "Show all checklists",
          },
          {
            label: "In progress",
            value: summary.inProgress,
            Icon: CircleHalfIcon,
            tone: "bg-info/15 text-info",
            active: filter === "IN_PROGRESS",
            onClick: () => pick("IN_PROGRESS"),
            title: "Show only: In progress",
          },
          {
            label: "Not started",
            value: summary.notStarted,
            Icon: CircleDashedIcon,
            tone: "bg-base-200 text-base-content/70",
            active: filter === "NOT_STARTED",
            onClick: () => pick("NOT_STARTED"),
            title: "Show only: Not started",
          },
          {
            label: "Complete",
            value: (
              <CountUnit
                n={summary.complete}
                one="checklist"
                other="checklists"
              />
            ),
            Icon: ListChecksIcon,
            tone: "bg-primary/15 text-primary",
            active: filter === "COMPLETE",
            onClick: () => pick("COMPLETE"),
            title: "Show only: Complete",
          },
        ]}
      />

      {rows.length > 0 && (
        <div className="flex justify-end">
          <Button
            aria-label={
              allOpen ? "Collapse all checklists" : "Expand all checklists"
            }
            onClick={() =>
              commit(allOpen ? new Set() : new Set(rows.map((r) => r.dayId)))
            }
            size="sm"
            type="button"
            variant="outline"
          >
            {allOpen ? (
              <ArrowsInLineVerticalIcon className="size-4" />
            ) : (
              <ArrowsOutLineVerticalIcon className="size-4" />
            )}
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>
      )}
      {rows.length === 0 && filter ? (
        <EmptyState
          description="Try another card or clear the filter."
          title={`No ${FILTER_EMPTY[filter]} checklists today.`}
        >
          <Button
            onClick={() => pick(null)}
            size="sm"
            type="button"
            variant="outline"
          >
            Clear filters
          </Button>
        </EmptyState>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-base-300 md:block">
            <Table className="table-fixed">
              <caption className="sr-only">Today's checklists</caption>
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[24%]" />
                <col className="w-[24%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[10%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  {["Date", "User", "Template", "Completed", "Status"].map(
                    (h) => (
                      <TableHead className="font-semibold text-xs" key={h}>
                        {h}
                      </TableHead>
                    )
                  )}
                  <TableHead className="text-right font-semibold text-xs">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <Fragment key={r.dayId}>
                    <TableRow
                      className={cn(
                        openIds.has(r.dayId) && "border-b-0 bg-base-200/40"
                      )}
                      data-testid="today-group"
                    >
                      <TableCell className="whitespace-nowrap">
                        {dateLabel}
                      </TableCell>
                      <TableCell>
                        <span className="flex min-w-0 items-center gap-2">
                          <UserAvatar
                            className="shrink-0"
                            image={r.userImage}
                            name={r.userName}
                            size="md"
                          />
                          <span
                            className="truncate font-medium"
                            title={r.userName}
                          >
                            {r.userName}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className="block truncate"
                          title={r.templateName ?? ""}
                        >
                          {r.templateName ?? "Checklist"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {r.completed} / {r.total}
                      </TableCell>
                      <TableCell>
                        <DayStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {toggleBtn(r)}
                      </TableCell>
                    </TableRow>
                    <ExpandRow
                      colSpan={6}
                      id={`today-${r.dayId}`}
                      open={openIds.has(r.dayId)}
                    >
                      <InlineDetail data={details[r.dayId]} error={error} />
                    </ExpandRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-2 md:hidden">
            {rows.map((r) => (
              <li
                className="space-y-2 rounded-xl border border-base-300 p-3"
                data-testid="today-group"
                key={r.dayId}
              >
                <div className="flex items-start gap-2">
                  <UserAvatar image={r.userImage} name={r.userName} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium text-sm">
                      {r.userName}
                    </p>
                    <p className="break-words text-base-content/60 text-xs">
                      {r.templateName ?? "Checklist"}
                    </p>
                    <p className="text-base-content/60 text-xs">{dateLabel}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium tabular-nums">
                    {r.completed} / {r.total}
                  </span>
                  <DayStatusBadge status={r.status} />
                </div>
                {toggleBtn(r, "w-full")}
                <ExpandBlock
                  id={`today-${r.dayId}`}
                  open={openIds.has(r.dayId)}
                >
                  <InlineDetail data={details[r.dayId]} error={error} />
                </ExpandBlock>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
