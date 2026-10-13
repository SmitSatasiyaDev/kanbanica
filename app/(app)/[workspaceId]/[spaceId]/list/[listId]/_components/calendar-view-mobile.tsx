"use client";

import {
  ArchiveIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  DotsThreeIcon,
  FunnelIcon,
  KeyboardIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import {
  addDays,
  addMonths,
  format,
  isSameMonth,
  isWeekend,
  subMonths,
} from "date-fns";
import * as React from "react";
import { useToday } from "@/components/common/timezone-provider";
import { FacetOptionList } from "@/components/filters/facet-filter";
import { ExportMenuRow } from "@/components/import-export/export-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { PRIORITY_OPTIONS } from "@/lib/filters/options";
import { PRIORITY_CONFIG } from "@/lib/priority-config";
import { cn } from "@/lib/utils";
import {
  type CalendarTask,
  dayKey,
  type Member,
  type Status,
  TaskRow,
} from "./calendar-view";

const MAX_WEEK_PREVIEWS = 4;
const MAX_MONTH_PREVIEWS = 2;

// Plain touch tracking for swipe-to-navigate — the decision is made on
// touchend (never preventDefault on touchmove) so vertical page scroll is
// never hijacked. `consumeSwipe()` lets a day cell's onClick bail out when
// the tap that follows touchend was actually the tail of a swipe.
function useSwipeNav(onSwipeLeft: () => void, onSwipeRight: () => void) {
  const startRef = React.useRef<{ x: number; y: number } | null>(null);
  const swipedRef = React.useRef(false);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = startRef.current;
    startRef.current = null;
    if (!start) {
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swipedRef.current = true;
      if (dx < 0) {
        onSwipeLeft();
      } else {
        onSwipeRight();
      }
    }
  }

  function consumeSwipe(): boolean {
    const was = swipedRef.current;
    swipedRef.current = false;
    return was;
  }

  return { onTouchStart, onTouchEnd, consumeSwipe };
}

export function MobileCalendar({
  agendaDay,
  archivedLoading,
  archivedTasks,
  assigneeFilter,
  canEdit,
  gridDays,
  isPending,
  listId,
  members,
  mobileFilterCount,
  mobileFiltersOpen,
  mobileMode,
  onAgendaDayChange,
  onAssigneeFilterChange,
  onCreateDay,
  onMobileFiltersOpenChange,
  onModeChange,
  onNavigate,
  onOpenShortcuts,
  onOpenTask,
  onPriorityFilterChange,
  onResetFilters,
  onSearchChange,
  onSortByChange,
  onSortOrderChange,
  onStatusFilterChange,
  onToggleArchived,
  onUnarchiveTask,
  priorityFilter,
  searchQuery,
  showArchived,
  sortBy,
  statusById,
  statusFilter,
  statuses,
  tasksByDay,
  viewDate,
  weekDays,
}: {
  agendaDay: Date | null;
  archivedLoading?: boolean;
  archivedTasks?: { id: string; title: string; seqNumber: number }[];
  assigneeFilter: string[];
  canEdit: boolean;
  gridDays: Date[];
  isPending: boolean;
  listId: string;
  members: Member[];
  mobileFilterCount: number;
  mobileFiltersOpen: boolean;
  mobileMode: "week" | "month";
  onAgendaDayChange: (day: Date | null) => void;
  onAssigneeFilterChange: (v: string[]) => void;
  onCreateDay: (day: Date) => void;
  onMobileFiltersOpenChange: (open: boolean) => void;
  onModeChange: (mode: "week" | "month") => void;
  onNavigate: (next: Date) => void;
  onOpenShortcuts: () => void;
  onOpenTask: (taskId: string) => void;
  onPriorityFilterChange: (v: string[]) => void;
  onResetFilters: () => void;
  onSearchChange: (v: string) => void;
  onSortByChange: (v: "name" | "priority" | null) => void;
  onSortOrderChange: React.Dispatch<React.SetStateAction<"asc" | "desc">>;
  onStatusFilterChange: (v: string[]) => void;
  onToggleArchived?: () => void;
  onUnarchiveTask: (taskId: string) => Promise<void>;
  priorityFilter: string[];
  searchQuery: string;
  showArchived?: boolean;
  sortBy: "name" | "priority" | null;
  statusById: Map<string, Status>;
  statusFilter: string[];
  statuses: Status[];
  tasksByDay: Map<string, CalendarTask[]>;
  viewDate: Date;
  weekDays: Date[];
}) {
  const days = mobileMode === "week" ? weekDays : gridDays;

  function goPrev() {
    onNavigate(
      mobileMode === "week" ? addDays(viewDate, -7) : subMonths(viewDate, 1)
    );
  }
  function goNext() {
    onNavigate(
      mobileMode === "week" ? addDays(viewDate, 7) : addMonths(viewDate, 1)
    );
  }

  const swipe = useSwipeNav(goNext, goPrev);

  const periodLabel =
    mobileMode === "week"
      ? `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], "MMM d")}`
      : format(viewDate, "MMMM yyyy");

  const todayKey = useToday();
  const isCurrentPeriod =
    mobileMode === "week"
      ? weekDays.some((d) => dayKey(d) === todayKey)
      : isSameMonth(viewDate, new Date());

  const assigneeOptions = [
    { value: "unassigned", label: "Unassigned" },
    ...members.map((m) => ({
      value: m.userId,
      label: m.name || m.email || "Unknown",
    })),
  ];

  const agendaTasks = agendaDay
    ? (tasksByDay.get(dayKey(agendaDay)) ?? [])
    : [];

  // SearchInput's `className` lands on the inner <input>, not its own
  // "relative" wrapper div — without an explicitly sized wrapper, that div
  // shrinks to the input's intrinsic content size instead of filling the
  // row (same gotcha the desktop toolbar wraps around, in calendar-view.tsx).
  const searchEl = (
    <div className={mobileMode === "week" ? "w-full" : "min-w-0 flex-1"}>
      <SearchInput
        className="w-full"
        onChange={(e) => onSearchChange(e.target.value)}
        onClear={() => onSearchChange("")}
        placeholder="Search tasks…"
        value={searchQuery}
      />
    </div>
  );

  const modeToggleEl = (
    <div className="flex h-9 shrink-0 items-center rounded-lg border border-base-300 p-0.5 text-xs font-semibold">
      <button
        className={cn(
          "rounded-md px-2.5 py-1.5 transition-colors",
          mobileMode === "week"
            ? "bg-primary text-primary-content"
            : "text-base-content/60"
        )}
        onClick={() => onModeChange("week")}
        type="button"
      >
        Week
      </button>
      <button
        className={cn(
          "rounded-md px-2.5 py-1.5 transition-colors",
          mobileMode === "month"
            ? "bg-primary text-primary-content"
            : "text-base-content/60"
        )}
        onClick={() => onModeChange("month")}
        type="button"
      >
        Month
      </button>
    </div>
  );

  const filterEl = (
    <Sheet onOpenChange={onMobileFiltersOpenChange} open={mobileFiltersOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="Filters"
          className={cn(
            "flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
            mobileFilterCount > 0
              ? "border-primary bg-primary/10 text-primary"
              : "border-base-300 text-base-content/60 hover:bg-base-200 hover:text-base-content"
          )}
          type="button"
        >
          <FunnelIcon className="size-3.5" />
          {mobileFilterCount > 0 && <span>({mobileFilterCount})</span>}
        </button>
      </SheetTrigger>
      <SheetContent
        className="flex max-h-[85dvh] flex-col rounded-t-2xl"
        side="bottom"
      >
        <SheetHeader className="p-4 pb-2">
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div>
            <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
              Status
            </p>
            <FacetOptionList
              onChange={onStatusFilterChange}
              options={statuses.map((s) => ({
                value: s.id,
                label: s.name,
                color: s.color,
              }))}
              selected={statusFilter}
            />
          </div>

          <div>
            <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
              Priority
            </p>
            <FacetOptionList
              onChange={onPriorityFilterChange}
              options={PRIORITY_OPTIONS}
              selected={priorityFilter}
            />
          </div>

          {members.length > 0 && (
            <div>
              <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                Assignee
              </p>
              <FacetOptionList
                onChange={onAssigneeFilterChange}
                options={assigneeOptions}
                searchable
                searchPlaceholder="Search people…"
                selected={assigneeFilter}
              />
            </div>
          )}

          <div className="h-px bg-base-300" />

          <div>
            <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
              Sort
            </p>
            <div className="flex flex-col gap-0.5">
              <button
                className={cn(
                  "rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-base-200",
                  !sortBy && "bg-base-200 text-base-content"
                )}
                onClick={() => onSortByChange(null)}
                type="button"
              >
                None
              </button>
              <button
                className={cn(
                  "rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-base-200",
                  sortBy === "name" && "bg-base-200 text-base-content"
                )}
                onClick={() => {
                  onSortByChange("name");
                  onSortOrderChange((o) => (o === "asc" ? "desc" : "asc"));
                }}
                type="button"
              >
                Task Name
              </button>
              <button
                className={cn(
                  "rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-base-200",
                  sortBy === "priority" && "bg-base-200 text-base-content"
                )}
                onClick={() => {
                  onSortByChange("priority");
                  onSortOrderChange((o) => (o === "asc" ? "desc" : "asc"));
                }}
                type="button"
              >
                Priority
              </button>
            </div>
          </div>

          {onToggleArchived && (
            <>
              <div className="h-px bg-base-300" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Show archived</span>
                <Switch
                  checked={!!showArchived}
                  onCheckedChange={() => onToggleArchived()}
                />
              </div>
            </>
          )}
        </div>
        <SheetFooter className="flex-row gap-2 border-t border-base-300 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            className="h-11 flex-1 rounded-lg border border-base-300 text-sm font-semibold text-base-content/70 transition-colors hover:bg-base-200"
            onClick={onResetFilters}
            type="button"
          >
            Reset
          </button>
          <SheetClose asChild>
            <button
              className="h-11 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-content transition-all hover:bg-primary/95"
              type="button"
            >
              Apply
            </button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );

  // "More" — secondary actions (Export/Archived/Shortcuts), same pattern as
  // List/Board's mobile "More actions" popover. Import is excluded: it
  // targets a specific list/status context Calendar's date-based toolbar
  // doesn't provide.
  const moreEl = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="More actions"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-base-300 text-base-content/60 transition-colors hover:bg-base-200/30 hover:text-base-content"
          type="button"
        >
          <DotsThreeIcon className="size-4" weight="bold" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 rounded-xl p-1.5">
        <ExportMenuRow scope={{ kind: "list", listId }} />
        {onToggleArchived && (
          <button
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-base-200"
            onClick={() => onToggleArchived()}
            type="button"
          >
            <span className="flex items-center gap-2">
              <ArchiveIcon className="size-4 text-base-content/60" />
              Archived Tasks
            </span>
            {showArchived && <CheckIcon className="size-4 text-primary" />}
          </button>
        )}
        <div className="my-1 h-px bg-base-300" />
        <button
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-base-200"
          onClick={onOpenShortcuts}
          type="button"
        >
          <KeyboardIcon className="size-4 text-base-content/60" />
          Keyboard Shortcuts
        </button>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden md:hidden">
      {/* Compact header. Deliberately not `sticky` — a sticky nav row here
          gets laid out (by its siblings) at its natural, non-stuck position,
          but paints at its pinned position once stuck, and those two
          disagree by however tall the view-tabs bar above it (also sticky)
          turns out to be. The gap between them is a dead zone where sibling
          content and the stuck bar paint on top of each other. Plain, in-flow
          — it scrolls with the page like everything else here. */}
      <div className="z-10 shrink-0 space-y-1.5 border-b border-base-300 bg-app px-3 pb-2 pt-1.5">
        <div className="flex items-center gap-1">
          <button
            aria-label="Previous"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-base-content/60 transition-colors active:bg-base-200 hover:bg-base-200 hover:text-base-content"
            onClick={goPrev}
            type="button"
          >
            <CaretLeftIcon className="size-5" />
          </button>
          <div className="min-w-0 flex-1 truncate text-center text-sm font-semibold">
            {periodLabel}
          </div>
          <button
            aria-label="Next"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-base-content/60 transition-colors active:bg-base-200 hover:bg-base-200 hover:text-base-content"
            onClick={goNext}
            type="button"
          >
            <CaretRightIcon className="size-5" />
          </button>
          <button
            className="ml-0.5 h-8 shrink-0 rounded-md border border-base-300 px-2.5 text-xs font-semibold text-base-content transition-colors hover:bg-base-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            disabled={isCurrentPeriod}
            onClick={() => onNavigate(new Date())}
            type="button"
          >
            Today
          </button>
        </div>

        {mobileMode === "week" ? (
          <div className="space-y-2">
            {searchEl}
            <div className="flex items-center gap-2">
              {modeToggleEl}
              <div className="ml-auto flex items-center gap-2">
                {filterEl}
                {moreEl}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {searchEl}
            {modeToggleEl}
            {filterEl}
            {moreEl}
          </div>
        )}

        {mobileMode === "month" && (
          <div className="grid grid-cols-7 text-2xs font-semibold uppercase tracking-wider text-base-content/60">
            {days.slice(0, 7).map((d) => (
              <div className="text-center" key={dayKey(d)}>
                {format(d, "EEEEE")}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Archived tasks — same data/actions as the desktop panel, in a
          capped-height scrollable block so it can't push the grid off
          screen on a short phone viewport. */}
      {showArchived && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-base-300 bg-base-200/20">
          <div className="flex items-center gap-2 select-none bg-base-200/50 px-3 py-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
            <ArchiveIcon className="size-3.5" />
            Archived ({archivedTasks?.length ?? 0})
          </div>
          {(!archivedTasks || archivedTasks.length === 0) && (
            <div className="px-3 py-3 text-center text-xs italic text-base-content/60">
              {archivedLoading ? "Loading…" : "No archived tasks"}
            </div>
          )}
          <div className="divide-y divide-border">
            {archivedTasks?.map((t) => (
              // biome-ignore lint/a11y/useSemanticElements: wraps a nested interactive "Unarchive" button, so it can't literally be a <button>; kept keyboard-accessible via role+tabIndex+onKeyDown
              <div
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors active:bg-base-200/60"
                key={t.id}
                onClick={() => onOpenTask(t.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) {
                    return;
                  }
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenTask(t.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="shrink-0 select-none font-mono text-2xs text-base-content/60">
                  #{t.seqNumber}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-base-content/60 line-through">
                  {t.title}
                </span>
                <button
                  className="shrink-0 cursor-pointer rounded-md border border-base-300 bg-base-100 px-2 py-1 text-2xs font-semibold text-base-content/60"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onUnarchiveTask(t.id);
                  }}
                  type="button"
                >
                  Unarchive
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grid body — Month keeps the 7-column calendar grid. Week instead
          stacks days as full-width agenda rows: squeezing 7 columns into a
          narrow phone width left each column a sliver wide, so the only way
          to make room for tasks was an oversized per-column min-height —
          mostly blank space under whichever day actually had something due.
          A vertical list uses the full width per day instead. */}
      <div
        className={cn(
          "flex-1 overflow-x-hidden overflow-y-auto",
          mobileMode === "month"
            ? "grid auto-rows-fr grid-cols-7"
            : "flex flex-col divide-y divide-border"
        )}
        onTouchEnd={swipe.onTouchEnd}
        onTouchStart={swipe.onTouchStart}
      >
        {mobileMode === "week"
          ? days.map((day) => (
              <WeekDayRow
                day={day}
                isPending={isPending}
                key={dayKey(day)}
                maxPreviews={MAX_WEEK_PREVIEWS}
                onOpen={() => {
                  if (swipe.consumeSwipe()) {
                    return;
                  }
                  onAgendaDayChange(day);
                }}
                statusById={statusById}
                tasks={tasksByDay.get(dayKey(day)) ?? []}
              />
            ))
          : days.map((day) => (
              <MonthDayCell
                day={day}
                inMonth={isSameMonth(day, viewDate)}
                isPending={isPending}
                key={dayKey(day)}
                maxPreviews={MAX_MONTH_PREVIEWS}
                onOpen={() => {
                  if (swipe.consumeSwipe()) {
                    return;
                  }
                  onAgendaDayChange(day);
                }}
                statusById={statusById}
                tasks={tasksByDay.get(dayKey(day)) ?? []}
              />
            ))}
      </div>

      {/* Floating Action Button for mobile task creation */}
      {canEdit && (
        <button
          aria-label="Create task"
          className="fixed right-6 bottom-6 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-2xl transition-all active:scale-95 hover:scale-105"
          onClick={() => onCreateDay(new Date())}
          type="button"
        >
          <PlusIcon className="size-6" weight="bold" />
        </button>
      )}

      {/* Day agenda bottom sheet — tapping a day opens this instead of the
          desktop's inline create/drag affordances. */}
      <Sheet
        onOpenChange={(o) => {
          if (!o) {
            onAgendaDayChange(null);
          }
        }}
        open={!!agendaDay}
      >
        <SheetContent
          className="flex max-h-[85dvh] flex-col rounded-t-2xl"
          side="bottom"
        >
          <SheetHeader className="border-b border-base-300 p-4 pb-3">
            <SheetTitle className="tracking-normal normal-case">
              {agendaDay ? format(agendaDay, "EEEE, MMMM d") : ""}
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
            {agendaTasks.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-base-content/60">
                No tasks due this day.
              </p>
            )}
            {agendaTasks.map((t) => (
              <TaskRow
                className="py-2.5 text-sm"
                key={t.id}
                onOpenTask={onOpenTask}
                statusById={statusById}
                task={t}
              />
            ))}
          </div>
          {canEdit && agendaDay && (
            <SheetFooter className="border-t border-base-300 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-content transition-all hover:bg-primary/95"
                onClick={() => {
                  const day = agendaDay;
                  onAgendaDayChange(null);
                  onCreateDay(day);
                }}
                type="button"
              >
                <PlusIcon className="size-4" weight="bold" />
                Add task
              </button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Month grid cell — unchanged from the original mobile calendar. Kept
// separate from the Week agenda row below so improving Week can't drift
// Month's rendering.
function MonthDayCell({
  day,
  tasks,
  inMonth,
  isPending,
  maxPreviews,
  statusById,
  onOpen,
}: {
  day: Date;
  tasks: CalendarTask[];
  inMonth: boolean;
  isPending: boolean;
  maxPreviews: number;
  statusById: Map<string, Status>;
  onOpen: () => void;
}) {
  const todayKey = useToday();
  const today = dayKey(day) === todayKey;
  const weekend = isWeekend(day);
  const visible = tasks.slice(0, maxPreviews);
  const overflow = tasks.length - visible.length;

  return (
    <button
      className={cn(
        "flex min-h-16 flex-col items-stretch border-r border-b border-base-300 p-1.5 text-left transition-colors active:bg-base-200/60",
        weekend && "bg-base-200/30 dark:bg-base-200/10",
        !inMonth && "bg-base-200/20 text-base-content/60"
      )}
      onClick={onOpen}
      type="button"
    >
      <div className="mb-1 flex shrink-0 items-center gap-1">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs",
            today && "bg-primary font-semibold text-primary-content",
            !today && !inMonth && "text-base-content/60"
          )}
        >
          {format(day, "d")}
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {isPending ? (
          <div className="h-4 animate-pulse rounded bg-base-200" />
        ) : (
          <>
            {visible.map((t) => {
              const status = statusById.get(t.statusId ?? "");
              return (
                <div
                  className="flex min-w-0 items-center gap-1 text-2xs"
                  key={t.id}
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: status?.color ?? "#94a3b8" }}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      status?.type === "CLOSED" &&
                        "text-base-content/60 line-through"
                    )}
                  >
                    {t.title}
                  </span>
                </div>
              );
            })}
            {overflow > 0 && (
              <div className="text-2xs font-medium text-base-content/60">
                +{overflow} more
              </div>
            )}
          </>
        )}
      </div>
    </button>
  );
}

// Week agenda row — full-width per day, compact when empty and growing
// naturally with its own task cards (no shared fixed height across rows).
function WeekDayRow({
  day,
  tasks,
  isPending,
  maxPreviews,
  statusById,
  onOpen,
}: {
  day: Date;
  tasks: CalendarTask[];
  isPending: boolean;
  maxPreviews: number;
  statusById: Map<string, Status>;
  onOpen: () => void;
}) {
  const todayKey = useToday();
  const today = dayKey(day) === todayKey;
  const weekend = isWeekend(day);
  const visible = tasks.slice(0, maxPreviews);
  const overflow = tasks.length - visible.length;

  return (
    <button
      className={cn(
        "flex w-full flex-col gap-1.5 border-l-[3px] px-3 py-2.5 text-left transition-colors active:bg-base-200/60",
        today
          ? "border-primary bg-primary/5"
          : cn(
              "border-transparent",
              weekend && "bg-base-200/30 dark:bg-base-200/10"
            )
      )}
      onClick={onOpen}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={cn(
              "truncate text-sm font-semibold",
              today ? "text-primary" : "text-base-content"
            )}
          >
            {format(day, "EEEE")}
          </span>
          <span className="shrink-0 text-xs text-base-content/60">
            {format(day, "MMM d")}
          </span>
        </div>
        {today && (
          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-2xs font-semibold text-primary-content">
            Today
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {isPending ? (
          <div className="h-8 animate-pulse rounded-md bg-base-200" />
        ) : tasks.length === 0 ? (
          <p className="text-xs text-base-content/60">No tasks</p>
        ) : (
          <>
            {visible.map((t) => (
              <WeekTaskCard key={t.id} statusById={statusById} task={t} />
            ))}
            {overflow > 0 && (
              <p className="text-2xs font-medium text-base-content/60">
                +{overflow} more
              </p>
            )}
          </>
        )}
      </div>
    </button>
  );
}

// Compact task card for the Week agenda — status-colored dot, title,
// priority icon. Presentational only; the row above is what's tappable.
function WeekTaskCard({
  task,
  statusById,
}: {
  task: CalendarTask;
  statusById: Map<string, Status>;
}) {
  const status = statusById.get(task.statusId ?? "");
  const done = status?.type === "CLOSED";
  const priorityCfg = PRIORITY_CONFIG[task.priority];

  return (
    <div className="flex items-center gap-2 rounded-md bg-base-200/50 px-2.5 py-2 dark:bg-base-200/20">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: status?.color ?? "#94a3b8" }}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs font-medium",
          done && "text-base-content/60 line-through"
        )}
      >
        {task.title}
      </span>
      {task.priority !== "NONE" && (
        <span aria-hidden className="shrink-0 text-xs leading-none">
          {priorityCfg.icon}
        </span>
      )}
    </div>
  );
}
