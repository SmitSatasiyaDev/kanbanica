"use client";

import {
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  ListChecksIcon,
} from "@phosphor-icons/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ChecklistStatus } from "@/lib/daily-checklist/constants";
import type { MemberFilter } from "@/lib/daily-checklist/team-aggregate";
import {
  groupMyChecklists,
  summarizeToday,
  type TodayChecklist,
} from "@/lib/daily-checklist/today-view";
import type { TeamItemRow } from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { DetailGridFrame, DetailGridRow } from "./detail-grid";
import { ExpandBlock, ExpandRow } from "./expand-panel";
import {
  DayStatusBadge,
  EmptyState,
  formatShortDate,
  formatTimeIn,
} from "./shared";
import { SummaryCardGrid } from "./summary-cards";
import {
  DetailsButton,
  DueLabel,
  NoteButton,
  RowCheckbox,
} from "./team-row-parts";
import { useAutoExpand } from "./use-auto-expand";

type CardFilter = "IN_PROGRESS" | "PENDING" | "COMPLETE";

interface Handlers {
  onDetails: (id: string) => void;
  onNote: (id: string) => void;
  onStatus: (row: TeamItemRow, s: ChecklistStatus) => void;
}

/**
 * Member "Today" (Assigned): the same summary cards / table / inline-expand language as the
 * admin History, but ACTIVE — every checkbox, note and details control is the existing,
 * permission-checked one (`RowCheckbox` / `NoteButton` / `DetailsButton`).
 */
export function TodayChecklists({
  allRows,
  visibleRows,
  filter,
  onFilterChange,
  onDetails,
  onNote,
  onStatus,
}: Handlers & {
  /** The viewer's own items, unfiltered (progress + cards never depend on the filter). */
  allRows: TeamItemRow[];
  /** The same items after the Status / Pending / Done filter. */
  visibleRows: TeamItemRow[];
  /** The member's Status / Pending / Done filter (drives auto-expand). */
  filter: MemberFilter;
  /** Lets a card drive the same Status / Pending / Done filter. */
  onFilterChange: (f: MemberFilter) => void;
}) {
  const summary = summarizeToday(allRows);
  // In progress / Pending / Complete cards narrow the tab filter further (local, no request).
  const [cardFilter, setCardFilter] = useState<CardFilter | null>(null);
  const allChecklists = groupMyChecklists(allRows);
  const completeKeys = new Set(
    allChecklists.filter((g) => g.status === "COMPLETE").map((g) => g.key)
  );
  const matchesCard = (r: TeamItemRow, c: CardFilter | null) =>
    c === null ||
    (c === "COMPLETE" ? completeKeys.has(r.dayId) : r.status === c);
  const visibleIds = new Set(
    visibleRows.filter((r) => matchesCard(r, cardFilter)).map((r) => r.id)
  );
  const checklists = allChecklists.filter((g) =>
    g.items.some((i) => visibleIds.has(i.id))
  );
  // Expanded checklists. They start open the first time; afterwards the user's last
  // expand/collapse decides (see useAutoExpand), including across tab / card changes and refreshes.
  const [auto, setAuto] = useAutoExpand("today-member");
  const [openKeys, setOpenKeys] = useState<Set<string> | undefined>(undefined);
  const commit = (next: Set<string>) => {
    setOpenKeys(next);
    setAuto(next.size > 0);
  };
  // Open-by-default for whatever a filter / tab brings in, unless the user last collapsed.
  const settle = (keys: string[]) => {
    setOpenKeys(new Set(auto ? keys : []));
  };
  const skipReset = useRef(false);
  const pickCard = (c: CardFilter) => {
    const next = cardFilter === c ? null : c;
    setCardFilter(next);
    if (filter !== "mine") {
      skipReset.current = true; // the tab change below is ours; keep this card + expansion
      onFilterChange("mine");
    }
    const keys = next
      ? allChecklists
          .filter((g) => g.items.some((i) => matchesCard(i, next)))
          .map((g) => g.key)
      : checklists.map((g) => g.key);
    settle(keys);
  };
  const openSet = openKeys ?? new Set(auto ? checklists.map((g) => g.key) : []);
  const isOpen = (k: string) => openSet.has(k);
  const toggle = (k: string) => {
    const n = new Set(openSet);
    if (!n.delete(k)) {
      n.add(k);
    }
    commit(n);
  };
  const allOpen =
    checklists.length > 0 && checklists.every((g) => openSet.has(g.key));
  // Changing the Status / Pending / Done tab expands every checklist it shows.
  const firstRender = useRef(true);
  // Keys of the checklists the TAB filter alone shows (a card filter is being reset here).
  const tabIds = new Set(visibleRows.map((r) => r.id));
  const visibleKeys = allChecklists
    .filter((g) => g.items.some((i) => tabIds.has(i.id)))
    .map((g) => g.key)
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on filter change only
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (skipReset.current) {
      skipReset.current = false;
      return;
    }
    settle(visibleKeys.split("|").filter(Boolean));
    setCardFilter(null);
  }, [filter]);
  const handlers = { onDetails, onNote, onStatus };
  const itemsOf = (g: TodayChecklist) =>
    g.items.filter((i) => visibleIds.has(i.id));

  return (
    <div className="space-y-5">
      <SummaryCardGrid
        cards={[
          {
            label: "Tasks done",
            value: `${summary.tasksDone} / ${summary.tasksTotal}`,
            Icon: CheckCircleIcon,
            tone: "bg-success/15 text-success",
            active: filter === "done",
            onClick: () => onFilterChange(filter === "done" ? "mine" : "done"),
            title: "Show only: done items",
          },
          {
            label: "In progress",
            value: summary.inProgress,
            Icon: CircleHalfIcon,
            tone: "bg-info/15 text-info",
            active: cardFilter === "IN_PROGRESS",
            onClick: () => pickCard("IN_PROGRESS"),
            title: "Show only: in progress",
          },
          {
            label: "Pending",
            value: summary.pending,
            Icon: CircleDashedIcon,
            tone: "bg-base-200 text-base-content/70",
            active: cardFilter === "PENDING",
            onClick: () => pickCard("PENDING"),
            title: "Show only: pending",
          },
          {
            label: "Complete",
            value: (
              <CountUnit
                n={summary.checklistsComplete}
                one="checklist"
                other="checklists"
              />
            ),
            Icon: ListChecksIcon,
            tone: "bg-primary/15 text-primary",
            active: cardFilter === "COMPLETE",
            onClick: () => pickCard("COMPLETE"),
            title: "Show only: complete checklists",
          },
        ]}
      />

      {checklists.length === 0 && (
        <EmptyState
          description="Try another card or clear the filter."
          title="Nothing matches this filter."
        >
          <Button
            onClick={() => {
              setCardFilter(null);
              if (filter !== "mine") {
                onFilterChange("mine");
              }
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Clear filters
          </Button>
        </EmptyState>
      )}
      {checklists.length > 0 && (
        <div className="flex justify-end">
          <Button
            aria-label={
              allOpen ? "Collapse all checklists" : "Expand all checklists"
            }
            onClick={() =>
              commit(
                allOpen ? new Set() : new Set(checklists.map((g) => g.key))
              )
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

      <div className="hidden overflow-hidden rounded-xl border border-base-300 md:block">
        <Table className="table-fixed">
          <caption className="sr-only">Today's checklists</caption>
          <colgroup>
            <col className="w-[16%]" />
            <col />
            <col className="w-[14%]" />
            <col className="w-[18%]" />
            <col className="w-[12%]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              {["Date", "Checklist", "Completed", "Status"].map((h) => (
                <TableHead className="font-semibold text-xs" key={h}>
                  {h}
                </TableHead>
              ))}
              <TableHead className="text-right font-semibold text-xs">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checklists.map((g) => (
              <Fragment key={g.key}>
                <TableRow
                  className={cn(isOpen(g.key) && "border-b-0 bg-base-200/40")}
                >
                  <TableCell className="whitespace-nowrap">
                    {formatShortDate(g.date)}, {g.date.slice(0, 4)}
                  </TableCell>
                  <TableCell>
                    <span className="block truncate font-medium" title={g.name}>
                      {g.name}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {g.completed} / {g.total}
                  </TableCell>
                  <TableCell>
                    <DayStatusBadge status={g.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <OpenToggle g={g} onToggle={toggle} open={isOpen(g.key)} />
                  </TableCell>
                </TableRow>
                <ExpandRow
                  colSpan={5}
                  id={`today-${g.key}`}
                  open={isOpen(g.key)}
                >
                  <ItemList items={itemsOf(g)} {...handlers} />
                </ExpandRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-2 md:hidden">
        {checklists.map((g) => (
          <li
            className="space-y-2 rounded-xl border border-base-300 p-3"
            key={g.key}
          >
            <div>
              <p className="break-words font-medium text-sm">{g.name}</p>
              <p className="text-base-content/60 text-xs">
                {formatShortDate(g.date)}, {g.date.slice(0, 4)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium tabular-nums">
                {g.completed} / {g.total}
              </span>
              <DayStatusBadge status={g.status} />
            </div>
            <OpenToggle
              className="w-full"
              g={g}
              onToggle={toggle}
              open={isOpen(g.key)}
            />
            <ExpandBlock id={`today-${g.key}`} open={isOpen(g.key)}>
              <ItemList items={itemsOf(g)} {...handlers} />
            </ExpandBlock>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "1 checklist": the number stays big, the unit small so it never wraps in a narrow card. */
export function CountUnit({
  n,
  one,
  other,
}: {
  n: number;
  one: string;
  other: string;
}) {
  return (
    <>
      {n}{" "}
      <span className="font-normal text-base-content/60 text-sm">
        {n === 1 ? one : other}
      </span>
    </>
  );
}

function OpenToggle({
  g,
  open,
  onToggle,
  className,
}: {
  className?: string;
  g: TodayChecklist;
  onToggle: (key: string) => void;
  open: boolean;
}) {
  return (
    <Button
      aria-controls={`today-${g.key}`}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Open"} ${g.name}`}
      className={className}
      onClick={() => onToggle(g.key)}
      size="sm"
      type="button"
      variant="secondary"
    >
      {open ? "Hide" : "Open"}
    </Button>
  );
}

function ItemList({
  items,
  onDetails,
  onNote,
  onStatus,
}: Handlers & { items: TeamItemRow[] }) {
  return (
    <div className="space-y-1.5 px-3 py-2.5 sm:px-4">
      <DetailGridFrame>
        {items.map((r) => {
          const done = r.status === "DONE";
          const at = done
            ? formatTimeIn(r.completedAt, r.assigneeTimezone)
            : null;
          return (
            <DetailGridRow
              actions={
                <>
                  <DetailsButton onOpen={() => onDetails(r.id)} row={r} />
                  <NoteButton onOpen={() => onNote(r.id)} row={r} />
                </>
              }
              checkbox={
                <RowCheckbox
                  className="mt-0 size-4 shrink-0"
                  onChange={(st) => onStatus(r, st)}
                  row={r}
                />
              }
              done={done}
              due={
                r.dueTime ? (
                  <DueLabel dueTime={r.dueTime} prefix="Due " rows={[r]} />
                ) : null
              }
              fields={r.fields}
              key={r.id}
              note={r.notes?.trim() ? r.notes : null}
              priority={r.priority}
              status={
                done
                  ? `Completed${at ? ` · ${at}` : ""}`
                  : r.status === "IN_PROGRESS"
                    ? "In Progress"
                    : "Pending"
              }
              title={r.title}
            />
          );
        })}
      </DetailGridFrame>
    </div>
  );
}
