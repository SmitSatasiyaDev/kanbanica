"use client";

import {
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  ListChecksIcon,
} from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getChecklistDays } from "@/app/actions/daily-checklist";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { computeProgress } from "@/lib/daily-checklist/progress";
import type { DayDetail, HistoryRow } from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { DetailItem } from "./admin/history-report";
import { DetailGridFrame } from "./detail-grid";
import { ExpandBlock, ExpandRow } from "./expand-panel";
import { DayStatusBadge, EmptyState, formatShortDate } from "./shared";
import { SummaryCardGrid } from "./summary-cards";
import { CountUnit } from "./today-checklists";
import { useAutoExpand } from "./use-auto-expand";

type MemberFilter = "COMPLETE" | "IN_PROGRESS" | "NOT_STARTED";

/** "2 / 3" + a thin bar + percent — same numbers the row already carries. */
function DayProgress({ r, className }: { className?: string; r: HistoryRow }) {
  const { percent } = computeProgress({
    completed: r.completed,
    total: r.total,
  });
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="whitespace-nowrap font-medium tabular-nums">
        {r.completed} / {r.total}
      </span>
      <Progress
        aria-label={`${percent}% complete`}
        className="h-1.5 min-w-10 flex-1"
        value={percent}
      />
      <span className="w-9 text-right text-base-content/60 text-xs tabular-nums">
        {percent}%
      </span>
    </div>
  );
}

const dateLabel = (d: string) => `${formatShortDate(d)}, ${d.slice(0, 4)}`;

/**
 * Member History (Personal + Assigned): the admin History's look — summary cards, table, status
 * badges, inline-expanding details — over the SAME rows/pagination the member history already
 * loads. Every day (Team and Personal) expands inline, read-only, via `getChecklistDays` — a past
 * day can never be edited from History (editing happens only on Today).
 */
export function MemberHistoryTable({
  rows: allRows,
  workspaceId,
}: {
  rows: HistoryRow[];
  workspaceId: string;
}) {
  // Cards count every loaded day and double as filters (client-side, no new request).
  const summary = useMemo(
    () => ({
      complete: allRows.filter((r) => r.status === "COMPLETE").length,
      inProgress: allRows.filter((r) => r.status === "IN_PROGRESS").length,
      notStarted: allRows.filter((r) => r.status === "NOT_STARTED").length,
      doneItems: allRows.reduce((n, r) => n + r.completed, 0),
      totalItems: allRows.reduce((n, r) => n + r.total, 0),
    }),
    [allRows]
  );
  const [filter, setFilter] = useState<MemberFilter | null>(null);
  // Open by default the first time; afterwards the user's last expand/collapse decides whether
  // days that arrive (first load, "Load more", date filter) open or stay closed.
  const [auto, setAuto] = useAutoExpand("history-member");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const commit = (next: Set<string>) => {
    setOpenIds(next);
    setAuto(next.size > 0);
  };
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const fresh = allRows.filter((r) => !seen.current.has(r.dayId));
    if (fresh.length === 0) {
      return;
    }
    for (const r of fresh) {
      seen.current.add(r.dayId);
    }
    if (auto) {
      setOpenIds((c) => new Set([...c, ...fresh.map((r) => r.dayId)]));
    }
  }, [allRows, auto]);
  const rows = filter ? allRows.filter((r) => r.status === filter) : allRows;
  // A card filter opens the days it shows (unless the user last collapsed).
  const pick = (f: MemberFilter | null) => {
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
  const [details, setDetails] = useState<Record<string, DayDetail>>({});
  const [error, setError] = useState<string | null>(null);

  // ONE batched request for every open day not loaded yet.
  useEffect(() => {
    const missing = [...openIds].filter((id) => !details[id]).slice(0, 200);
    if (missing.length === 0) {
      return;
    }
    let live = true;
    getChecklistDays(workspaceId, missing).then((res) => {
      if (!live) {
        return;
      }
      if ("error" in res && typeof res.error === "string") {
        setError(res.error);
        return;
      }
      setError(null);
      const got = res as Record<string, DayDetail>;
      const gone: DayDetail = {
        date: "",
        editable: false,
        items: [],
        progress: { completed: 0, percent: 0, total: 0 },
        templateName: null,
        type: "TEAM",
        userName: null,
      };
      // Ids the server didn't return get an empty day so loading always ends.
      setDetails((d) => ({
        ...d,
        ...Object.fromEntries(missing.map((id) => [id, got[id] ?? gone])),
      }));
    });
    return () => {
      live = false;
    };
  }, [openIds, details, workspaceId]);

  const view = (r: HistoryRow, className?: string) => {
    const open = openIds.has(r.dayId);
    const label = r.templateName ?? "Checklist";
    return (
      <Button
        aria-controls={`mh-${r.dayId}`}
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "View"} ${label}, ${dateLabel(r.date)}`}
        className={className}
        onClick={() => {
          const n = new Set(openIds);
          if (!n.delete(r.dayId)) {
            n.add(r.dayId);
          }
          commit(n);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {open ? "Hide" : "View"}
        <CaretDownIcon
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-180")}
        />
      </Button>
    );
  };
  const detail = (r: HistoryRow) => (
    <div className="space-y-1.5 px-3 py-2.5 sm:px-4" id={`mh-${r.dayId}`}>
      {error && !details[r.dayId] ? (
        <p className="text-error text-sm" role="alert">
          {error}
        </p>
      ) : details[r.dayId] ? (
        details[r.dayId].items.length === 0 ? (
          <p className="text-base-content/60 text-sm">
            This checklist has no items.
          </p>
        ) : (
          <DetailGridFrame>
            {details[r.dayId].items.map((it) => (
              <DetailItem it={it} key={it.id} />
            ))}
          </DetailGridFrame>
        )
      ) : (
        <Skeleton className="h-24 w-full rounded-xl" />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <SummaryCardGrid
        cards={[
          {
            label: "Completed",
            value: summary.complete,
            Icon: CheckCircleIcon,
            tone: "bg-success/15 text-success",
            active: filter === "COMPLETE",
            onClick: () => pick("COMPLETE"),
            title: "Show only: Total Completed",
          },
          {
            label: "In Progress",
            value: summary.inProgress,
            Icon: CircleHalfIcon,
            tone: "bg-info/15 text-info",
            active: filter === "IN_PROGRESS",
            onClick: () => pick("IN_PROGRESS"),
            title: "Show only: In Progress",
          },
          {
            label: "Not Started",
            value: summary.notStarted,
            Icon: CircleDashedIcon,
            tone: "bg-base-200 text-base-content/70",
            active: filter === "NOT_STARTED",
            onClick: () => pick("NOT_STARTED"),
            title: "Show only: Not Started",
          },
          {
            label: "Checklists",
            hint:
              summary.totalItems > 0
                ? `${summary.doneItems}/${summary.totalItems} tasks · ${
                    computeProgress({
                      completed: summary.doneItems,
                      total: summary.totalItems,
                    }).percent
                  }%`
                : undefined,
            value: <CountUnit n={allRows.length} one="day" other="days" />,
            Icon: ListChecksIcon,
            tone: "bg-primary/15 text-primary",
            onClick: () => pick(null),
            title: "Show all checklists",
          },
        ]}
        compact
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

      {rows.length === 0 ? (
        <EmptyState
          description="Try another card or clear the filter."
          title="No checklists match this filter."
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
          <div
            className="hidden overflow-hidden rounded-xl border border-base-300 md:block"
            data-testid="history-table"
          >
            <Table className="table-fixed">
              <caption className="sr-only">Checklist history</caption>
              <colgroup>
                <col className="w-[14%]" />
                <col />
                <col className="w-[26%]" />
                <col className="w-[14%]" />
                <col className="w-[11%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  {["Date", "Template", "Completed", "Status"].map((h) => (
                    <TableHead className="h-9 font-semibold text-xs" key={h}>
                      {h}
                    </TableHead>
                  ))}
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
                    >
                      <TableCell className="whitespace-nowrap py-2 text-base-content/80">
                        {dateLabel(r.date)}
                      </TableCell>
                      <TableCell>
                        <span
                          className="block truncate font-medium"
                          title={r.templateName ?? ""}
                        >
                          {r.templateName ?? "Checklist"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DayProgress r={r} />
                      </TableCell>
                      <TableCell>
                        <DayStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-right">{view(r)}</TableCell>
                    </TableRow>
                    <ExpandRow colSpan={5} open={openIds.has(r.dayId)}>
                      {detail(r)}
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
                key={r.dayId}
              >
                <div>
                  <p className="break-words font-medium text-sm">
                    {r.templateName ?? "Checklist"}
                  </p>
                  <p className="text-base-content/60 text-xs">
                    {dateLabel(r.date)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <DayStatusBadge status={r.status} />
                </div>
                <DayProgress className="text-sm" r={r} />
                {view(r, "w-full")}
                <ExpandBlock open={openIds.has(r.dayId)}>
                  {detail(r)}
                </ExpandBlock>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
