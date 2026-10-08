"use client";

import {
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  DownloadSimpleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { format, parse } from "date-fns";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import {
  exportChecklistHistoryCsv,
  getChecklistHistoryItems,
  getChecklistHistoryReport,
} from "@/app/actions/daily-checklist-history";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  pageWindow,
  parseHistoryStatus,
} from "@/lib/daily-checklist/history-report";
import type {
  ChecklistItemDTO,
  HistoryItemsResult,
  HistoryReportFilters,
  HistoryReportResult,
  HistoryReportRow,
  HistoryReportStatus,
} from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { DetailGridFrame, DetailGridRow } from "../detail-grid";
import { ExpandBlock, ExpandRow } from "../expand-panel";
import { DayStatusBadge, EmptyState, formatTimeIn } from "../shared";
import { SummaryCardGrid } from "../summary-cards";
import { useAutoExpand } from "../use-auto-expand";
import { useChecklistData } from "../use-checklist-data";

const ISO = "yyyy-MM-dd";
const toDate = (s: string) => parse(s, ISO, new Date());
const fmtDate = (s: string) => format(toDate(s), "MMM d, yyyy");
const ALL = "all";
const EMPTY_LABEL: Record<HistoryReportStatus, string> = {
  COMPLETED: "completed",
  IN_PROGRESS: "in progress",
  NOT_STARTED: "not started",
};

export const STATUS_OPTIONS: { label: string; value: HistoryReportStatus }[] = [
  { value: "COMPLETED", label: "Completed" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "NOT_STARTED", label: "Not Started" },
];

/** Query-string keys (kept in the URL so refresh / sharing restore the filters). */
const KEYS = ["from", "to", "user", "template", "status", "page"] as const;

type Filters = {
  from: string | null;
  page: number;
  status: HistoryReportStatus | null;
  template: string | null;
  to: string | null;
  user: string | null;
};

/**
 * Admin → Checklist → History: a read-only reporting page. Filters, summary and paging are
 * resolved server-side (`getChecklistHistoryReport`); only per-day summaries are listed, and a
 * day's items load when "View" opens it.
 */
export function HistoryReport({
  workspaceId,
  initialDate = null,
}: {
  initialDate?: string | null;
  workspaceId: string;
}) {
  const params = useSearchParams();
  const [f, setF] = useState<Filters>(() => ({
    // Old `?date=` links keep working: that single date as the range.
    from: params.get("from") ?? initialDate,
    to: params.get("to") ?? initialDate,
    user: params.get("user"),
    template: params.get("template"),
    status: parseHistoryStatus(params.get("status")) ?? null,
    page: Math.max(Number(params.get("page")) || 1, 1),
  }));
  const [exporting, setExporting] = useState(false);
  // Expanded rows (dayIds). Open by default the first time; afterwards the user's last
  // expand/collapse decides whether new results (filters, paging) arrive open or closed.
  const [auto, setAuto] = useAutoExpand("history-admin");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const commit = (next: Set<string>) => {
    setOpenIds(next);
    setAuto(next.size > 0);
  };
  // The result object at the time a filter changed; settle once a NEWER result arrives.
  // `null` = the very first load.
  const [staleData, setStaleData] = useState<
    HistoryReportResult | null | undefined
  >(null);
  const dataRef = useRef<HistoryReportResult | null>(null);
  const [details, setDetails] = useState<Record<string, HistoryItemsResult>>(
    {}
  );
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("date");
    url.searchParams.delete("view");
    const vals: Record<(typeof KEYS)[number], string | null> = {
      from: f.from,
      to: f.to,
      user: f.user,
      template: f.template,
      status: f.status,
      page: f.page > 1 ? String(f.page) : null,
    };
    for (const k of KEYS) {
      if (vals[k]) {
        url.searchParams.set(k, vals[k] as string);
      } else {
        url.searchParams.delete(k);
      }
    }
    // New filter states are history entries (back/forward walk them); no-ops and the initial
    // sync never add one.
    if (url.search !== window.location.search) {
      window.history.pushState(window.history.state, "", url);
    }
  }, [f]);

  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(window.location.search);
      setF({
        from: q.get("from"),
        to: q.get("to"),
        user: q.get("user"),
        template: q.get("template"),
        status: parseHistoryStatus(q.get("status")) ?? null,
        page: Math.max(Number(q.get("page")) || 1, 1),
      });
      setStaleData(dataRef.current);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const input = useMemo<HistoryReportFilters>(
    () => ({
      from: f.from ?? undefined,
      to: f.to ?? undefined,
      userId: f.user ?? undefined,
      templateId: f.template ?? undefined,
      status: f.status ?? undefined,
      page: f.page,
    }),
    [f]
  );
  const { data, error, loading } = useChecklistData<HistoryReportResult>(
    () => getChecklistHistoryReport(workspaceId, input),
    [workspaceId, f.from, f.to, f.user, f.template, f.status, String(f.page)]
  );
  dataRef.current = data;

  // The server clamps an out-of-range page; mirror it so the URL / pager stay truthful.
  useEffect(() => {
    if (data && data.page !== f.page) {
      setF((p) => ({ ...p, page: data.page }));
    }
  }, [data, f.page]);

  const change = (patch: Partial<Filters>) => {
    setF((p) => ({ ...p, ...patch, page: 1 }));
    setStaleData(data);
  };

  // Once the filtered rows arrive, expand them all.
  useEffect(() => {
    if (staleData !== undefined && data && data !== staleData && !loading) {
      setOpenIds(new Set(auto ? data.rows.map((r) => r.dayId) : []));
      setStaleData(undefined);
    }
  }, [staleData, data, loading, auto]);

  // ONE batched request for every open row not loaded yet (saved days never change).
  useEffect(() => {
    const missing = [...openIds].filter((id) => !details[id]);
    if (missing.length === 0) {
      return;
    }
    let live = true;
    getChecklistHistoryItems(workspaceId, missing).then((res) => {
      if (!live) {
        return;
      }
      if ("error" in res && typeof res.error === "string") {
        setDetailError(res.error);
      } else {
        setDetailError(null);
        setDetails((d) => ({
          ...d,
          ...(res as Record<string, HistoryItemsResult>),
        }));
      }
    });
    return () => {
      live = false;
    };
  }, [openIds, details, workspaceId]);
  const allOpen =
    !!data &&
    data.rows.length > 0 &&
    data.rows.every((r) => openIds.has(r.dayId));
  const filtered =
    f.user !== null ||
    f.template !== null ||
    f.status !== null ||
    f.from !== null ||
    f.to !== null;
  const clear = () =>
    setF({
      from: null,
      to: null,
      user: null,
      template: null,
      status: null,
      page: 1,
    });

  async function exportCsv() {
    setExporting(true);
    const res = await exportChecklistHistoryCsv(workspaceId, {
      ...input,
      page: undefined,
    });
    setExporting(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([res.csv], { type: "text/csv;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    a.click();
    URL.revokeObjectURL(url);
    if (res.truncated) {
      toast.info("Export limited to the first 5,000 rows. Narrow the filters.");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-xl">Checklist History</h2>
        <p className="text-base-content/60 text-sm">
          View completed checklists and track team activity
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <RangePicker
          from={data?.filters.from ?? f.from}
          onChange={(from, to) => change({ from, to })}
          to={data?.filters.to ?? f.to}
          today={data?.today ?? null}
        />
        <FilterSelect
          allLabel="All Users"
          label="Filter by user"
          onChange={(v) => change({ user: v })}
          options={(data?.members ?? []).map((m) => ({
            value: m.id,
            label: m.name,
          }))}
          searchable
          value={f.user}
        />
        <FilterSelect
          allLabel="All Templates"
          label="Filter by template"
          onChange={(v) => change({ template: v })}
          options={(data?.templates ?? []).map((t) => ({
            value: t.id,
            label: t.name,
          }))}
          searchable
          value={f.template}
        />
        <FilterSelect
          allLabel="All Status"
          label="Filter by status"
          onChange={(v) => change({ status: parseHistoryStatus(v) ?? null })}
          options={STATUS_OPTIONS}
          value={f.status}
        />
        <Button
          className="ml-auto"
          disabled={exporting || !data || data.total === 0}
          onClick={exportCsv}
          type="button"
        >
          <DownloadSimpleIcon className="size-4" /> Export
        </Button>
      </div>

      {error && !data ? (
        <p className="text-error text-sm" role="alert">
          {error}
        </p>
      ) : (
        <>
          <SummaryCards
            data={data}
            onPick={(status) => {
              // Same state as the dropdown, so the two can never disagree; clicking the active card clears it.
              change({ status: status === f.status ? null : status });
            }}
            status={f.status}
          />
          {loading && !data ? (
            <Skeleton className="h-72 w-full rounded-xl" />
          ) : data && data.total === 0 ? (
            <EmptyState
              description="Try changing the date range or filters."
              title={
                f.status
                  ? `No ${EMPTY_LABEL[f.status]} checklists found.`
                  : "No checklist history found"
              }
            >
              {filtered && (
                <Button
                  onClick={clear}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Clear filters
                </Button>
              )}
            </EmptyState>
          ) : (
            data && (
              <div
                aria-busy={loading}
                className={cn(loading && "opacity-60 transition-opacity")}
              >
                <div className="mb-2 flex justify-end">
                  <Button
                    aria-label={
                      allOpen
                        ? "Collapse all checklists on this page"
                        : "Expand all checklists on this page"
                    }
                    onClick={() =>
                      commit(
                        allOpen
                          ? new Set()
                          : new Set(data.rows.map((r) => r.dayId))
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
                <HistoryTable
                  detailError={detailError}
                  details={details}
                  onToggle={(id) => {
                    const n = new Set(openIds);
                    if (!n.delete(id)) {
                      n.add(id);
                    }
                    commit(n);
                  }}
                  openIds={openIds}
                  rows={data.rows}
                />
                <Pager
                  onPage={(page) => {
                    setF((p) => ({ ...p, page }));
                    setStaleData(data);
                  }}
                  page={data.page}
                  pageCount={data.pageCount}
                  pageSize={data.pageSize}
                  total={data.total}
                />
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── toolbar ─────────────────────────────

export function RangePicker({
  from,
  to,
  today,
  onChange,
}: {
  from: string | null;
  onChange: (from: string, to: string) => void;
  to: string | null;
  today: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const label =
    from && to ? `${fmtDate(from)} - ${fmtDate(to)}` : "Select date range";
  return (
    <Popover
      onOpenChange={(o) => {
        setOpen(o);
        setDraft(undefined);
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={`Date range: ${label}`}
          className="max-w-full justify-start"
          type="button"
          variant="outline"
        >
          <CalendarBlankIcon className="size-4" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          defaultMonth={from ? toDate(from) : undefined}
          disabled={today ? { after: toDate(today) } : undefined}
          mode="range"
          numberOfMonths={1}
          onSelect={(r, picked) => {
            // A completed range starts over on the next click; the first click only anchors.
            if (draft?.from && !draft.to && r?.from) {
              const [a, b] = [draft.from, picked].sort(
                (x, y) => x.getTime() - y.getTime()
              );
              onChange(format(a, ISO), format(b, ISO));
              setOpen(false);
              setDraft(undefined);
            } else {
              setDraft({ from: picked, to: undefined });
            }
          }}
          selected={
            draft ??
            (from && to ? { from: toDate(from), to: toDate(to) } : undefined)
          }
        />
      </PopoverContent>
    </Popover>
  );
}

export function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
  label,
  searchable = false,
}: {
  allLabel: string;
  label: string;
  /** Adds a search box (long lists: users, templates). */
  searchable?: boolean;
  onChange: (v: string | null) => void;
  options: { label: string; value: string }[];
  value: string | null;
}) {
  if (searchable) {
    return (
      <SearchableFilter
        allLabel={allLabel}
        label={label}
        onChange={onChange}
        options={options}
        value={value}
      />
    );
  }
  return (
    <Select
      onValueChange={(v) => onChange(v === ALL ? null : v)}
      value={value ?? ALL}
    >
      <SelectTrigger aria-label={label} className="w-44 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Popover + search box + filtered list (same look as the Select it replaces). */
function SearchableFilter({
  value,
  onChange,
  options,
  allLabel,
  label,
}: {
  allLabel: string;
  label: string;
  onChange: (v: string | null) => void;
  options: { label: string; value: string }[];
  value: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The popover mounts a frame after `open` flips, so focus the search box once it exists.
  useEffect(() => {
    if (!open) {
      return;
    }
    let tries = 0;
    let raf = 0;
    const focus = () => {
      const el = document.querySelector<HTMLInputElement>(
        '[data-slot="combobox-input"]'
      );
      if (el) {
        el.focus();
      } else if (tries++ < 20) {
        raf = requestAnimationFrame(focus);
      }
    };
    focus();
    return () => cancelAnimationFrame(raf);
  }, [open]);
  const q = query.trim().toLowerCase();
  const matches = q
    ? options.filter((o) => o.label.toLowerCase().includes(q))
    : options;
  const showAll = !q || allLabel.toLowerCase().includes(q);
  const current = options.find((o) => o.value === value)?.label ?? allLabel;
  return (
    <Popover
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQuery("");
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={label}
          className="select flex h-10 w-44 max-w-full justify-between rounded-md border border-base-300 bg-none bg-transparent px-3 py-2 text-sm outline-none transition-[color,border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
          role="combobox"
          type="button"
        >
          <span className="truncate">{current}</span>
          <CaretDownIcon
            aria-hidden
            className="pointer-events-none size-3.5 shrink-0 text-base-content/60"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 max-w-[calc(100vw-2rem)] rounded-xl p-0"
      >
        <Combobox<string | null>
          className="rounded-xl border-0"
          immediate
          onChange={(v) => {
            onChange(v);
            setOpen(false);
          }}
          value={value}
        >
          <ComboboxInput
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.replace(/^Filter by /, "")}...`}
            value={query}
          />
          <ComboboxOptions className="p-1" static>
            {showAll && (
              <ComboboxOption value={null}>
                <span className="flex-1 truncate">{allLabel}</span>
                {value === null && <CheckIcon className="size-3.5" />}
              </ComboboxOption>
            )}
            {matches.map((o) => (
              <ComboboxOption key={o.value} value={o.value}>
                <span className="flex-1 truncate" title={o.label}>
                  {o.label}
                </span>
                {value === o.value && <CheckIcon className="size-3.5" />}
              </ComboboxOption>
            ))}
            {matches.length === 0 && !showAll && (
              <ComboboxEmpty>No results found</ComboboxEmpty>
            )}
          </ComboboxOptions>
        </Combobox>
      </PopoverContent>
    </Popover>
  );
}

// ───────────────────────────── summary ─────────────────────────────

function SummaryCards({
  data,
  status,
  onPick,
}: {
  data: HistoryReportResult | null;
  onPick: (status: HistoryReportStatus | null) => void;
  status: HistoryReportStatus | null;
}) {
  const s = data?.summary;
  const cards: {
    Icon: typeof CheckCircleIcon;
    filter: HistoryReportStatus | null;
    label: string;
    tone: string;
    value: number | undefined;
  }[] = [
    {
      label: "Total Completed",
      value: s?.completed,
      Icon: CheckCircleIcon,
      tone: "bg-success/15 text-success",
      filter: "COMPLETED",
    },
    {
      label: "In Progress",
      value: s?.inProgress,
      Icon: CircleHalfIcon,
      tone: "bg-info/15 text-info",
      filter: "IN_PROGRESS",
    },
    {
      label: "Not Started",
      value: s?.notStarted,
      Icon: CircleDashedIcon,
      tone: "bg-base-200 text-base-content/70",
      filter: "NOT_STARTED",
    },
    {
      // Resets the card/status filter: every matching person again.
      label: "Team Members",
      value: s?.members,
      Icon: UsersThreeIcon,
      tone: "bg-primary/15 text-primary",
      filter: null,
    },
  ];
  return (
    <SummaryCardGrid
      cards={cards.map((c) => {
        const active = c.filter !== null && c.filter === status;
        return {
          label: c.label,
          Icon: c.Icon,
          tone: c.tone,
          value: c.value ?? "–",
          active: c.filter === null ? undefined : active,
          onClick: () => onPick(c.filter),
          title:
            c.filter === null
              ? "Show all statuses"
              : active
                ? "Click to clear this filter"
                : `Show only: ${c.label}`,
        };
      })}
    />
  );
}

// ───────────────────────────── table ─────────────────────────────

function StatusBadge({ row }: { row: HistoryReportRow }) {
  return <DayStatusBadge overdue={row.overdue} status={row.status} />;
}

const NOTE = ({ note }: { note: string | null }) =>
  note ? (
    <span className="block truncate" title={note}>
      {note}
    </span>
  ) : (
    <span className="text-base-content/40">
      —<span className="sr-only"> No note</span>
    </span>
  );

function HistoryTable({
  rows,
  openIds,
  onToggle,
  details,
  detailError,
}: {
  detailError: string | null;
  details: Record<string, HistoryItemsResult>;
  onToggle: (dayId: string) => void;
  openIds: Set<string>;
  rows: HistoryReportRow[];
}) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-base-300 md:block">
        <Table className="table-fixed">
          <caption className="sr-only">Checklist history</caption>
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[20%]" />
            <col className="w-[19%]" />
            <col className="w-[10%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col className="w-[8%]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              {["Date", "User", "Template", "Completed", "Status", "Notes"].map(
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
                >
                  <TableCell className="whitespace-nowrap">
                    {fmtDate(r.date)}
                  </TableCell>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-2">
                      <UserAvatar
                        image={r.userImage}
                        name={r.userName}
                        size="md"
                      />
                      <span
                        className="truncate font-medium"
                        title={r.userName ?? ""}
                      >
                        {r.userName ?? "Deleted User"}
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
                    <StatusBadge row={r} />
                  </TableCell>
                  <TableCell>
                    <NOTE note={r.note} />
                  </TableCell>
                  <TableCell className="text-right">
                    <ViewToggle
                      onToggle={onToggle}
                      open={openIds.has(r.dayId)}
                      row={r}
                    />
                  </TableCell>
                </TableRow>
                <ExpandRow
                  colSpan={7}
                  id={`hist-${r.dayId}`}
                  open={openIds.has(r.dayId)}
                >
                  <InlineDetail data={details[r.dayId]} error={detailError} />
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
            <div className="flex items-start gap-2">
              <UserAvatar image={r.userImage} name={r.userName} size="md" />
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium text-sm">
                  {r.userName ?? "Deleted User"}
                </p>
                <p className="break-words text-base-content/60 text-xs">
                  {r.templateName ?? "Checklist"}
                </p>
                <p className="text-base-content/60 text-xs">
                  {fmtDate(r.date)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium tabular-nums">
                {r.completed} / {r.total}
              </span>
              <StatusBadge row={r} />
            </div>
            {r.note && (
              <p className="line-clamp-2 break-words text-base-content/70 text-sm">
                {r.note}
              </p>
            )}
            <ViewToggle
              className="w-full"
              onToggle={onToggle}
              open={openIds.has(r.dayId)}
              row={r}
            />
            <ExpandBlock id={`hist-${r.dayId}`} open={openIds.has(r.dayId)}>
              <InlineDetail data={details[r.dayId]} error={detailError} />
            </ExpandBlock>
          </li>
        ))}
      </ul>
    </>
  );
}

function Pager({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
}: {
  onPage: (p: number) => void;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}) {
  if (pageCount <= 1) {
    return (
      <p className="mt-3 text-base-content/60 text-xs">
        {total} {total === 1 ? "checklist" : "checklists"}
      </p>
    );
  }
  const pages = pageWindow(page, pageCount);
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label="History pages"
      className="mt-3 flex flex-wrap items-center justify-between gap-2"
    >
      <p className="text-base-content/60 text-xs tabular-nums">
        {first}–{last} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          <CaretLeftIcon className="size-4" /> Previous
        </Button>
        {pages.map((p, i) =>
          p === null ? (
            <span
              aria-hidden
              className="px-1 text-base-content/50"
              key={`gap-after-${pages[i - 1]}`}
            >
              …
            </span>
          ) : (
            <Button
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p}`}
              key={p}
              onClick={() => onPage(p)}
              size="sm"
              type="button"
              variant={p === page ? "default" : "ghost"}
            >
              {p}
            </Button>
          )
        )}
        <Button
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          Next <CaretRightIcon className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

// ───────────────────────────── inline detail ─────────────────────────────

function ViewToggle({
  row,
  open,
  onToggle,
  className,
}: {
  className?: string;
  onToggle: (dayId: string) => void;
  open: boolean;
  row: HistoryReportRow;
}) {
  return (
    <Button
      aria-controls={`hist-${row.dayId}`}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "View"} ${row.userName ?? "checklist"}, ${row.templateName ?? "Checklist"}, ${fmtDate(row.date)}`}
      className={className}
      onClick={() => onToggle(row.dayId)}
      size="sm"
      type="button"
      variant="secondary"
    >
      {open ? "Hide" : "View"}
    </Button>
  );
}

/** Read-only saved items of one day (loaded by the parent's batched request). */
export function InlineDetail({
  data,
  error,
}: {
  data: HistoryItemsResult | undefined;
  error: string | null;
}) {
  return (
    <div className="space-y-2 px-4 py-3 sm:px-6">
      {error && !data ? (
        <p className="text-error text-sm" role="alert">
          {error}
        </p>
      ) : data ? (
        data.items.length === 0 ? (
          <p className="text-base-content/60 text-sm">
            This checklist has no items.
          </p>
        ) : (
          <DetailGridFrame>
            {data.items.map((it) => (
              <DetailItem it={it} key={it.id} tz={data.timezone} />
            ))}
          </DetailGridFrame>
        )
      ) : (
        <Skeleton className="h-24 w-full rounded-xl" />
      )}
    </div>
  );
}

export function DetailItem({ it, tz }: { it: ChecklistItemDTO; tz?: string }) {
  const note = it.notes?.trim() ? it.notes : null;
  const done = it.status === "DONE";
  const at = done ? formatTimeIn(it.completedAt, tz) : null;
  return (
    <DetailGridRow
      checkbox={
        /* Read-only indicator: disabled, no handler, full opacity. */
        <Checkbox
          aria-label={`${it.title}: ${done ? "completed" : "not completed"}`}
          aria-readonly="true"
          checked={done}
          className="size-4 shrink-0 disabled:cursor-default disabled:opacity-100"
          disabled
          tabIndex={-1}
        />
      }
      done={done}
      due={it.dueTime ? `Due ${it.dueTime}` : null}
      fields={it.fields}
      note={note}
      priority={it.priority}
      status={
        done
          ? `Completed${at ? ` · ${at}` : ""}`
          : it.status === "IN_PROGRESS"
            ? "In Progress"
            : "Pending"
      }
      title={it.title}
    />
  );
}
