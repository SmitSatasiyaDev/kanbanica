"use client";

import {
  ActivityIcon,
  ArchiveIcon,
  ArrowClockwiseIcon,
  ArrowsLeftRightIcon,
  CalendarBlankIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  type Icon,
  ListBulletsIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  PlusCircleIcon,
  TimerIcon,
  TrashIcon,
  UserMinusIcon,
  UserPlusIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import * as React from "react";
import {
  getSpaceActivity,
  type SpaceActivityCursor,
  type SpaceActivityEntry,
} from "@/app/actions/space-activity";
import { useTimezone, useToday } from "@/components/common/timezone-provider";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { describeEvent } from "@/lib/activity-descriptions";
import {
  daysBetween,
  formatDay,
  formatDayWithWeekday,
  todayInTz,
} from "@/lib/due-date";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_RANGES,
  type ActivityCategory,
  type ActivityRange,
  DEFAULT_ACTIVITY_RANGE,
} from "@/lib/space-activity-filters";
import { cn } from "@/lib/utils";

interface SpaceActivityFeedProps {
  spaceId: string;
  workspaceId: string;
}

// ─── Event visuals ───────────────────────────────────────────────────────────

interface EventVisual {
  className: string;
  icon: Icon;
}

const NEUTRAL = "bg-base-200 text-base-content/60";

function eventVisual(entry: SpaceActivityEntry): EventVisual {
  switch (entry.eventType) {
    case "task_created":
    case "task_duplicated":
    case "subtask_created":
      return { icon: PlusCircleIcon, className: "bg-primary/10 text-primary" };
    case "status_changed":
      return entry.toDashboardCategory === "COMPLETED"
        ? { icon: CheckCircleIcon, className: "bg-success/15 text-success" }
        : { icon: ArrowsLeftRightIcon, className: "bg-info/15 text-info" };
    case "subtask_completed":
      return { icon: CheckCircleIcon, className: "bg-success/15 text-success" };
    case "assignee_added":
      return { icon: UserPlusIcon, className: "bg-primary/10 text-primary" };
    case "assignee_removed":
      return { icon: UserMinusIcon, className: NEUTRAL };
    case "comment_added":
    case "comment_edited":
    case "comment_deleted":
    case "comment_resolved":
    case "comment_unresolved":
      return { icon: ChatCircleIcon, className: "bg-info/15 text-info" };
    case "due_date_set":
    case "due_date_changed":
    case "due_date_removed":
      return {
        icon: CalendarBlankIcon,
        className: "bg-warning/15 text-warning",
      };
    case "attachment_uploaded":
    case "attachment_deleted":
      return { icon: PaperclipIcon, className: NEUTRAL };
    case "time_logged":
    case "timer_started":
    case "timer_stopped":
      return { icon: TimerIcon, className: NEUTRAL };
    case "task_archived":
    case "task_unarchived":
      return { icon: ArchiveIcon, className: NEUTRAL };
    case "task_deleted":
      return { icon: TrashIcon, className: "bg-error/10 text-error" };
    default:
      return { icon: PencilSimpleIcon, className: NEUTRAL };
  }
}

/** Action text after the actor's name. Status changes get the two names highlighted. */
function EventDescription({ entry }: { entry: SpaceActivityEntry }) {
  const meta = (entry.meta ?? {}) as Record<string, unknown>;
  if (entry.eventType === "status_changed") {
    const from = meta.from_status_name;
    const to = meta.to_status_name;
    return (
      <span className="text-base-content/60">
        {typeof from === "string" && from ? (
          <>
            changed status from{" "}
            <span className="font-medium text-base-content/80">{from}</span> →{" "}
          </>
        ) : (
          "changed status to "
        )}
        <span className="font-medium text-base-content/80">
          {typeof to === "string" && to ? to : "—"}
        </span>
      </span>
    );
  }
  if (
    (entry.eventType === "assignee_added" ||
      entry.eventType === "assignee_removed") &&
    typeof meta.user_name === "string"
  ) {
    return (
      <span className="text-base-content/60">
        {entry.eventType === "assignee_added" ? "assigned" : "unassigned"}{" "}
        <span className="font-medium text-base-content/80">
          {meta.user_name}
        </span>
      </span>
    );
  }
  return (
    <span className="text-base-content/60">
      {describeEvent(entry.eventType, meta)}
    </span>
  );
}

// ─── Date grouping ───────────────────────────────────────────────────────────

interface DayGroup {
  day: string;
  entries: SpaceActivityEntry[];
}

// Groups by calendar day in the user's timezone (not the browser's), so
// "Today" matches the rest of the app. Entries arrive newest-first.
function groupByDay(entries: SpaceActivityEntry[], tz: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const day = todayInTz(tz, new Date(entry.createdAt));
    const last = groups.at(-1);
    if (last?.day === day) {
      last.entries.push(entry);
    } else {
      groups.push({ day, entries: [entry] });
    }
  }
  return groups;
}

function dayLabel(day: string, today: string): string {
  const diff = daysBetween(day, today);
  if (diff === 0) {
    return "Today";
  }
  if (diff === 1) {
    return "Yesterday";
  }
  return day.slice(0, 4) === today.slice(0, 4)
    ? formatDayWithWeekday(day)
    : formatDay(day, true);
}

function exactTimestamp(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function ActivityRow({
  entry,
  workspaceId,
  spaceId,
  timezone,
}: {
  entry: SpaceActivityEntry;
  workspaceId: string;
  spaceId: string;
  timezone: string;
}) {
  const visual = eventVisual(entry);
  const TypeIcon = visual.icon;
  const createdAt = new Date(entry.createdAt);
  const actor = entry.actorName ?? entry.actorEmail ?? "Deleted User";

  const time = (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          className="cursor-default whitespace-nowrap text-xs text-base-content/60"
          dateTime={createdAt.toISOString()}
        >
          {formatDistanceToNow(createdAt, { addSuffix: true })}
        </time>
      </TooltipTrigger>
      <TooltipContent side="top">
        {exactTimestamp(createdAt, timezone)}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <li className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-base-200/40 sm:px-5">
      <div className="relative mt-0.5 shrink-0">
        <UserAvatar
          email={entry.actorEmail}
          image={entry.actorImage}
          name={entry.actorName}
          size="md"
        />
        <span
          className={cn(
            "absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-2 ring-elevated",
            visual.className
          )}
        >
          <TypeIcon className="size-2.5" weight="bold" />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-sm leading-snug break-words">
            <span className="font-medium text-base-content">{actor}</span>{" "}
            <EventDescription entry={entry} />
          </p>
          <span className="hidden shrink-0 sm:block">{time}</span>
        </div>
        <Link
          className="mt-1 block text-sm font-medium leading-snug break-words text-base-content hover:text-primary hover:underline line-clamp-2"
          href={`/${workspaceId}/task/${entry.taskId}`}
          title={entry.taskTitle}
        >
          <span className="text-base-content/60">#{entry.taskSeq}</span>{" "}
          {entry.taskTitle}
        </Link>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-base-content/60">
          <Link
            className="inline-flex min-w-0 items-center gap-1 hover:text-base-content hover:underline"
            href={`/${workspaceId}/${spaceId}/list/${entry.listId}`}
          >
            <ListBulletsIcon className="size-3 shrink-0" />
            <span className="truncate">{entry.listName}</span>
          </Link>
          <span className="sm:hidden">·</span>
          <span className="shrink-0 sm:hidden">{time}</span>
        </div>
      </div>
    </li>
  );
}

// ─── Feed ────────────────────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 300;

export function SpaceActivityFeed({
  workspaceId,
  spaceId,
}: SpaceActivityFeedProps) {
  const timezone = useTimezone();
  const today = useToday();

  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [category, setCategory] = React.useState<ActivityCategory>("all");
  const [range, setRange] = React.useState<ActivityRange>(
    DEFAULT_ACTIVITY_RANGE
  );

  const [entries, setEntries] = React.useState<SpaceActivityEntry[]>([]);
  const [nextCursor, setNextCursor] =
    React.useState<SpaceActivityCursor | null>(null);
  const [loading, setLoading] = React.useState(true);
  // False until the first response lands — only then is the skeleton shown.
  // Later filter changes keep the current results on screen (dimmed) and
  // swap them in place, so selecting an option never flashes the feed.
  const [loaded, setLoaded] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState(false);
  // Ignores responses from superseded filter states (fast typing, quick toggles).
  const requestId = React.useRef(0);

  React.useEffect(() => {
    const t = setTimeout(
      () => setDebouncedSearch(search.trim()),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(t);
  }, [search]);

  const filters = React.useMemo(
    () => ({ search: debouncedSearch, category, range }),
    [debouncedSearch, category, range]
  );

  const loadFirstPage = React.useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadingMore(false);
    setError(false);
    const res = await getSpaceActivity(workspaceId, spaceId, filters).catch(
      () => ({ error: "failed" }) as const
    );
    if (id !== requestId.current) {
      return;
    }
    if ("error" in res) {
      setError(true);
      setEntries([]);
      setNextCursor(null);
    } else {
      setEntries(res.entries);
      setNextCursor(res.nextCursor);
    }
    setLoading(false);
    setLoaded(true);
  }, [workspaceId, spaceId, filters]);

  React.useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    if (!nextCursor) {
      return;
    }
    const id = requestId.current;
    setLoadingMore(true);
    const res = await getSpaceActivity(workspaceId, spaceId, {
      ...filters,
      cursor: nextCursor,
    }).catch(() => ({ error: "failed" }) as const);
    if (id !== requestId.current) {
      return;
    }
    if (!("error" in res)) {
      setEntries((prev) => [...prev, ...res.entries]);
      setNextCursor(res.nextCursor);
    }
    setLoadingMore(false);
  }

  const hasFilters =
    search.trim() !== "" ||
    category !== "all" ||
    range !== DEFAULT_ACTIVITY_RANGE;

  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setCategory("all");
    setRange(DEFAULT_ACTIVITY_RANGE);
  }

  const rangeLabel =
    ACTIVITY_RANGES.find((r) => r.value === range)?.label ?? "";
  const groups = React.useMemo(
    () => groupByDay(entries, timezone),
    [entries, timezone]
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <ActivityIcon className="size-5 text-primary" />
            <h1 className="text-lg font-semibold">Space Activity</h1>
            <span className="rounded-md bg-base-200 px-2 py-0.5 text-xs font-medium text-base-content/60">
              {rangeLabel}
            </span>
          </div>
          <p className="text-sm text-base-content/60">
            Track changes and updates across your workspace.
          </p>
        </header>

        {/* Toolbar */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <SearchInput
              aria-label="Search activity"
              className="h-9 text-sm"
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch("")}
              placeholder="Search by task, person, or activity…"
              value={search}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              onValueChange={(v) => setCategory(v as ActivityCategory)}
              value={category}
            >
              <SelectTrigger
                aria-label="Activity type"
                className="min-w-0 flex-1 cursor-pointer md:w-44 md:flex-none"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="p-1.5">
                <SelectItem className="cursor-pointer" value="all">
                  All activity
                </SelectItem>
                {ACTIVITY_CATEGORIES.map((c) => (
                  <SelectItem
                    className="cursor-pointer"
                    key={c.value}
                    value={c.value}
                  >
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(v) => setRange(v as ActivityRange)}
              value={range}
            >
              <SelectTrigger
                aria-label="Date range"
                className="min-w-0 flex-1 cursor-pointer md:w-40 md:flex-none"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="p-1.5">
                {ACTIVITY_RANGES.map((r) => (
                  <SelectItem
                    className="cursor-pointer"
                    key={r.value}
                    value={r.value}
                  >
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loading && loaded && (
              <Spinner className="size-3.5 text-base-content/60" />
            )}
            {hasFilters && (
              <Button onClick={clearFilters} size="xs" variant="ghost">
                <XIcon data-icon="inline-start" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Feed */}
        {loaded ? (
          error ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-base-300 bg-elevated py-16 text-center">
              <WarningCircleIcon className="size-10 text-error/60" />
              <p className="text-sm text-base-content/60">
                Couldn&apos;t load activity.
              </p>
              <Button
                onClick={() => void loadFirstPage()}
                size="xs"
                variant="outline"
              >
                <ArrowClockwiseIcon data-icon="inline-start" />
                Try again
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div
              aria-busy={loading}
              className={cn(
                "flex flex-col items-center gap-3 rounded-xl border border-base-300 bg-elevated px-6 py-16 text-center transition-opacity duration-200",
                loading && "pointer-events-none opacity-50"
              )}
            >
              <ActivityIcon className="size-10 text-base-content/20" />
              {hasFilters ? (
                <>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      No activity matches your filters
                    </p>
                    <p className="text-sm text-base-content/60">
                      Try a different search term, type, or date range.
                    </p>
                  </div>
                  <Button onClick={clearFilters} size="xs" variant="outline">
                    Clear filters
                  </Button>
                </>
              ) : (
                <p className="text-sm text-base-content/60">
                  No activity in the {rangeLabel.toLowerCase()}
                </p>
              )}
            </div>
          ) : (
            <div
              aria-busy={loading}
              className={cn(
                "space-y-6 transition-opacity duration-200",
                loading && "pointer-events-none opacity-50"
              )}
            >
              {groups.map((group) => (
                <section
                  aria-label={dayLabel(group.day, today)}
                  key={group.day}
                >
                  <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-base-content/60 uppercase">
                    {dayLabel(group.day, today)}
                  </h2>
                  <ul className="divide-y divide-base-300 overflow-hidden rounded-xl border border-base-300 bg-elevated">
                    {group.entries.map((entry) => (
                      <ActivityRow
                        entry={entry}
                        key={entry.id}
                        spaceId={spaceId}
                        timezone={timezone}
                        workspaceId={workspaceId}
                      />
                    ))}
                  </ul>
                </section>
              ))}

              {nextCursor && (
                <div className="flex justify-center">
                  <Button
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                    size="sm"
                    variant="outline"
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </div>
          )
        ) : (
          <div
            aria-busy="true"
            className="divide-y divide-base-300 overflow-hidden rounded-xl border border-base-300 bg-elevated"
          >
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div className="flex animate-pulse gap-3 px-5 py-4" key={i}>
                <div className="size-8 shrink-0 rounded-full bg-base-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded bg-base-200" />
                  <div className="h-3 w-2/3 rounded bg-base-200" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
