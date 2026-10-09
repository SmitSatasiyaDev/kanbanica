"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsInIcon,
  ArrowsOutIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  ColumnsIcon,
  DotsThreeIcon,
  ListChecksIcon,
  PencilSimpleIcon,
  PlusIcon,
  ProhibitIcon,
  StopCircleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import * as React from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import {
  type ChecklistDayTask,
  type ChecklistEntry,
  type ChecklistInput,
  type ChecklistScope,
  createChecklistItem,
  deleteChecklistTask,
  getChecklistForDate,
  getChecklistMonthSummary,
  setChecklistStatus,
  stopChecklistSeries,
  updateChecklistItem,
} from "@/app/actions/daily-checklist";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isOverlayOpen } from "@/components/ui/overlay-stack";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFocusMode } from "@/components/workspace/focus-mode-context";
import { useLocalToday } from "@/hooks/use-local-today";
import {
  addDays,
  type ChecklistStatus,
  dateStrToLocalDate,
  describeRepeat,
  FUTURE_COMPLETION_ERROR,
  formatDueTime,
  initialNavState,
  isViewMode,
  navReducer,
  shouldExitFocus,
  type ViewMode,
  withStatus,
} from "@/lib/daily-checklist";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";
import {
  ChecklistDeleteDialog,
  type DeleteScope,
} from "./checklist-delete-dialog";
import { ChecklistFocusCalendar } from "./checklist-focus-calendar";
import { ChecklistFormDialog } from "./checklist-form-dialog";
import { ChecklistMonthCalendar } from "./checklist-month-calendar";
import { ChecklistStopDialog } from "./checklist-stop-dialog";
import { TaskDetailSheet } from "./task-detail-sheet";

const VIEW_STORAGE_KEY = "kanbanica:daily-checklist:view";

const VIEW_OPTIONS: {
  value: ViewMode;
  label: string;
  Icon: typeof ListChecksIcon;
}[] = [
  { value: "split", label: "Split View", Icon: ColumnsIcon },
  { value: "task", label: "Task View", Icon: ListChecksIcon },
  { value: "calendar", label: "Calendar View", Icon: CalendarBlankIcon },
];

function unwrap<T extends object>(res: T | { error: string }): T {
  if ("error" in res) {
    throw new Error(res.error);
  }
  return res;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DailyChecklistView({ workspaceId }: { workspaceId: string }) {
  const { mutate } = useSWRConfig();
  // Browser-local today; follows midnight and tab re-focus on its own.
  const today = useLocalToday();
  const { focusMode, setFocusMode } = useFocusMode();
  const [nav, dispatch] = React.useReducer(navReducer, initialNavState);
  const { view, date, month, filter } = nav;
  const setDate = (d: string) => dispatch({ type: "selectDate", date: d });
  const setMonth = (m: string) => dispatch({ type: "setMonth", month: m });
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ChecklistEntry | null>(null);
  const [deleting, setDeleting] = React.useState<ChecklistEntry | null>(null);
  const [stopping, setStopping] = React.useState<ChecklistEntry | null>(null);
  const [skippedOpen, setSkippedOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  // Start on today once it is known. After that the selected date is the
  // user's choice: a new day (midnight / tab return) never moves it.
  React.useEffect(() => {
    if (today) {
      // Restore the last layout so a refresh stays in Task/Calendar Focus.
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      } catch {
        // storage unavailable (private mode): fall back to split
      }
      dispatch({
        type: "init",
        today,
        view: isViewMode(stored) ? stored : undefined,
      });
    }
  }, [today]);
  React.useEffect(() => {
    if (date) {
      try {
        window.localStorage.setItem(VIEW_STORAGE_KEY, view);
      } catch {
        // ignore
      }
    }
  }, [view, date]);
  // Focus Mode is shell layout state scoped to this page: leaving the page
  // (unmount) always restores the sidebar and header.
  React.useEffect(() => () => setFocusMode(false), [setFocusMode]);
  // Escape exits Focus Mode, but never while an overlay (dialog, popover,
  // menu, drawer) is open — that Escape belongs to the overlay.
  React.useEffect(() => {
    if (!focusMode) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (!shouldExitFocus(e.key, e.defaultPrevented, isOverlayOpen())) {
        return;
      }
      setFocusMode(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [focusMode, setFocusMode]);

  // FLIP for the Exit button: remember where the Focus Mode button was, and
  // once the Exit button is visible animate it from there to its final
  // top-right spot (transform + opacity only; interaction is never blocked).
  const focusBtnRef = React.useRef<HTMLButtonElement>(null);
  const exitRef = React.useRef<HTMLButtonElement>(null);
  const originRect = React.useRef<DOMRect | null>(null);
  function enterFocus() {
    originRect.current = focusBtnRef.current?.getBoundingClientRect() ?? null;
    setFocusMode(true);
  }
  React.useLayoutEffect(() => {
    const el = exitRef.current;
    const from = originRect.current;
    originRect.current = null;
    if (
      !(focusMode && el && from) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const to = el.getBoundingClientRect();
    el.animate(
      [
        {
          opacity: 0,
          transform: `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px)`,
        },
        { opacity: 1, transform: "none" },
      ],
      { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  }, [focusMode]);

  // Previous/Next Day, Today and calendar clicks all go through `date` (the
  // reducer moves the month with it); the open drawer closes on change.
  // A task opened from the calendar on another date waits here until that
  // date is selected, then its drawer opens (the entry loads with the day).
  const pendingDetail = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (date) {
      setDetailId(pendingDetail.current);
      pendingDetail.current = null;
    }
  }, [date]);

  const dayKey = date
    ? (["daily-checklist", workspaceId, date] as const)
    : null;
  const monthKey = month
    ? (["daily-checklist-month", workspaceId, month] as const)
    : null;

  const { data: entries, isLoading } = useSWR(
    dayKey,
    async () =>
      unwrap(await getChecklistForDate(workspaceId, date as string)).entries,
    { keepPreviousData: false, revalidateOnFocus: true }
  );
  const { data: monthDays } = useSWR(
    monthKey,
    async () =>
      unwrap(await getChecklistMonthSummary(workspaceId, month as string)).days,
    { keepPreviousData: true }
  );
  const refreshAll = React.useCallback(
    () =>
      mutate(
        (key) =>
          Array.isArray(key) &&
          (key[0] === "daily-checklist" ||
            key[0] === "daily-checklist-month") &&
          key[1] === workspaceId
      ),
    [mutate, workspaceId]
  );

  const all = entries ?? [];
  // Skipped tasks leave the active checklist and its progress; they stay one
  // click away under "Skipped" so they can be restored.
  const list = all.filter((e) => e.status !== "SKIPPED");
  const skippedList = all.filter((e) => e.status === "SKIPPED");
  const counted = list;
  const completedCount = counted.filter((e) => e.status === "COMPLETED").length;
  const percent =
    counted.length === 0
      ? 0
      : Math.round((completedCount / counted.length) * 100);
  const visible = list.filter((e) =>
    filter === "all"
      ? true
      : filter === "pending"
        ? e.status === "INCOMPLETE"
        : e.status === "COMPLETED"
  );
  const detailEntry = all.find((e) => e.itemId === detailId) ?? null;

  async function changeStatus(entry: ChecklistEntry, status: ChecklistStatus) {
    if (!dayKey) {
      return;
    }
    // Optimistic: only this date's row flips.
    await mutate(
      dayKey,
      (cur?: ChecklistEntry[]) => withStatus(cur, entry.itemId, status),
      { revalidate: false }
    );
    const res = await setChecklistStatus(
      workspaceId,
      entry.itemId,
      entry.date,
      status,
      today as string
    );
    if ("error" in res) {
      toast.error(res.error);
    }
    await refreshAll();
  }

  function openTaskFromCalendar(d: string, itemId: string) {
    if (d === date) {
      setDetailId(itemId);
    } else {
      pendingDetail.current = itemId;
      setDate(d);
    }
  }

  // Calendar checkboxes only exist for today (see canCompleteOnDate); the
  // server enforces the same rule.
  async function toggleFromCalendar(
    d: string,
    task: ChecklistDayTask,
    done: boolean
  ) {
    const res = await setChecklistStatus(
      workspaceId,
      task.itemId,
      d,
      done ? "COMPLETED" : "INCOMPLETE",
      today as string
    );
    if ("error" in res) {
      toast.error(res.error);
    }
    await refreshAll();
  }

  async function handleSubmit(
    input: ChecklistInput,
    scope: ChecklistScope
  ): Promise<string | null> {
    if (!date) {
      return null;
    }
    const res = editing
      ? await updateChecklistItem(
          workspaceId,
          editing.itemId,
          editing.date,
          scope,
          input,
          today as string
        )
      : await createChecklistItem(workspaceId, date, input, today as string);
    if ("error" in res) {
      return res.error;
    }
    setFormOpen(false);
    await refreshAll();
    return null;
  }

  async function skipDay(entry: ChecklistEntry) {
    await changeStatus(entry, "SKIPPED");
    toastWithUndo(
      `Skipped “${entry.title}” for ${format(dateStrToLocalDate(entry.date), "MMM d")}`,
      () => changeStatus(entry, "INCOMPLETE")
    );
  }

  // Close and resync after any stop/delete: on error the task is usually
  // already gone or changed (stale tab / repeated click).
  async function finish(
    res: { success: true } | { error: string },
    ok: string
  ) {
    setStopping(null);
    setDeleting(null);
    await refreshAll();
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(ok);
  }

  async function handleStop() {
    if (!stopping) {
      return;
    }
    const res = await stopChecklistSeries(
      workspaceId,
      stopping.itemId,
      stopping.date,
      today as string
    );
    await finish(
      res,
      `Recurring task stopped from ${format(dateStrToLocalDate(stopping.date), "MMM d")} — earlier history is kept`
    );
  }

  async function handleDelete(scope: DeleteScope) {
    if (!deleting) {
      return;
    }
    const res = await deleteChecklistTask(
      workspaceId,
      deleting.itemId,
      deleting.date,
      scope,
      today as string
    );
    await finish(
      res,
      deleting.isRecurring
        ? scope === "ALL"
          ? "Recurring series deleted"
          : `Removed from ${format(dateStrToLocalDate(deleting.date), "MMM d")} onward`
        : "Task deleted"
    );
  }

  function openEdit(entry: ChecklistEntry) {
    setDetailId(null);
    setEditing(entry);
    setFormOpen(true);
  }

  if (!(date && today)) {
    return (
      <div className="p-6 space-y-5">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const isToday = date === today;
  // Upcoming days can be viewed (and skipped) but not completed ahead of time.
  const isFuture = date > today;
  // Past days are view-only (enforced server-side too).
  const readOnly = date < today;

  const checklistCard = (
    <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-base-300 bg-elevated">
      {/* Daily summary */}
      <div className="shrink-0 space-y-3 border-b border-base-300 px-6 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-base font-semibold">
              {format(dateStrToLocalDate(date), "EEEE, MMMM d, yyyy")}
            </h2>
            <span className="text-sm text-base-content/60 tabular-nums">
              · {completedCount} / {counted.length} completed
            </span>
            {readOnly && (
              <span className="self-center rounded-full bg-base-200 px-2 py-0.5 text-xs font-medium text-base-content/60">
                Read-only
              </span>
            )}
          </div>
          <span className="text-lg font-semibold tabular-nums">{percent}%</span>
        </div>
        <Progress className="h-2" value={percent} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        {/* Toolbar: filters left, Add task right; stays above the scrolling list. */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          {list.length > 0 ? (
            <Tabs
              className="shrink-0"
              onValueChange={(v) =>
                dispatch({ type: "setFilter", filter: v as typeof filter })
              }
              value={filter}
            >
              <TabsList>
                <TabsTrigger value="all">All {list.length}</TabsTrigger>
                <TabsTrigger value="pending">
                  Pending {list.filter((e) => e.status === "INCOMPLETE").length}
                </TabsTrigger>
                <TabsTrigger value="completed">
                  Completed {completedCount}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : (
            <span />
          )}
          {!readOnly && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              size="sm"
            >
              <PlusIcon />
              Add task
            </Button>
          )}
        </div>

        {/* Only this region scrolls (lg+); header and filters stay put. */}
        <div className="min-h-0 flex-1 space-y-4 [--scrollbar-thumb-hover:color-mix(in_oklab,currentColor_28%,transparent)] [--scrollbar-thumb:color-mix(in_oklab,currentColor_12%,transparent)] lg:overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ListChecksIcon className="size-8 text-base-content/30" />
              <p className="text-sm font-medium">No tasks for this day</p>
              {!readOnly && (
                <p className="text-sm text-base-content/60">
                  Add a task to start your daily checklist.
                </p>
              )}
            </div>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-base-content/60">
              No {filter} tasks.
            </p>
          ) : (
            <ul className="divide-y divide-base-300/60">
              {visible.map((entry) => (
                <EntryRow
                  entry={entry}
                  futureLocked={isFuture}
                  key={entry.itemId}
                  onDelete={() => setDeleting(entry)}
                  onEdit={() => openEdit(entry)}
                  onOpen={() => setDetailId(entry.itemId)}
                  onSkip={() => skipDay(entry)}
                  onStatus={(s) => changeStatus(entry, s)}
                  onStop={() => setStopping(entry)}
                  readOnly={readOnly}
                />
              ))}
            </ul>
          )}

          {skippedList.length > 0 && (
            <div className="space-y-1">
              <button
                aria-expanded={skippedOpen}
                className="flex items-center gap-1 text-xs font-medium text-base-content/60 hover:text-base-content"
                onClick={() => setSkippedOpen((o) => !o)}
                type="button"
              >
                {skippedOpen ? (
                  <CaretDownIcon className="size-3" />
                ) : (
                  <CaretRightIcon className="size-3" />
                )}
                Skipped ({skippedList.length})
              </button>
              {skippedOpen && (
                <ul className="divide-y divide-base-300/60">
                  {skippedList.map((entry) => (
                    <EntryRow
                      entry={entry}
                      futureLocked={isFuture}
                      key={entry.itemId}
                      onDelete={() => setDeleting(entry)}
                      onEdit={() => openEdit(entry)}
                      onOpen={() => setDetailId(entry.itemId)}
                      onSkip={() => skipDay(entry)}
                      onStatus={(s) => changeStatus(entry, s)}
                      onStop={() => setStopping(entry)}
                      readOnly={readOnly}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );

  const calendarCard = (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col rounded-xl border border-base-300 bg-elevated p-4 sm:p-5 lg:overflow-y-auto",
        view === "calendar" && "lg:min-h-0"
      )}
    >
      {view === "calendar" ? (
        <ChecklistFocusCalendar
          days={monthDays ?? {}}
          month={month ?? date.slice(0, 7)}
          onMonthChange={setMonth}
          onOpenTask={openTaskFromCalendar}
          onSelectDate={setDate}
          onToggleTask={toggleFromCalendar}
          selectedDate={date}
          today={today}
        />
      ) : (
        <ChecklistMonthCalendar
          days={monthDays ?? {}}
          month={month ?? date.slice(0, 7)}
          onMonthChange={setMonth}
          onSelectDate={setDate}
          selectedDate={date}
          today={today}
        />
      )}
      <div
        className={cn(
          "mt-3 grid shrink-0 grid-cols-2 gap-x-4 gap-y-1.5 border-t border-base-300 pt-3 text-xs text-base-content/60",
          view === "calendar" && "sm:grid-cols-4"
        )}
      >
        <Legend className="bg-success" label="All done" />
        <Legend className="bg-warning" label="Some done" />
        <Legend className="bg-base-content/20" label="None / pending" />
        <Legend className="bg-error" label="Overdue" />
      </div>
    </section>
  );

  return (
    // lg+: fill the area under the app header (main is a bounded flex child) and
    // clip, so the page never grows with the task count — only the task list
    // scrolls. Below lg everything flows and the page scrolls naturally.
    <div
      className={cn(
        "relative flex flex-col gap-5 p-6 transition-[padding] duration-200 ease-out motion-reduce:transition-none lg:h-full lg:min-h-[34rem] lg:overflow-hidden",
        // Room for the exit icon only; no title/nav rows above the content.
        focusMode && "px-4 pt-10 pb-4"
      )}
    >
      {/* The one Exit control, fixed to the viewport's top-right. On entering
          it flies in from where the Focus Mode button was (FLIP, see
          `enterFocus`); it stays mounted so exit can fade it out. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-hidden={!focusMode}
            aria-label="Exit focus mode"
            className={cn(
              "fixed top-0.5 right-1.5 z-50 size-9 transition-opacity duration-200 ease-out motion-reduce:transition-none",
              !focusMode && "pointer-events-none invisible opacity-0"
            )}
            onClick={() => setFocusMode(false)}
            ref={exitRef}
            size="icon"
            tabIndex={focusMode ? 0 : -1}
            variant="ghost"
          >
            <ArrowsInIcon className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent align="end" side="bottom">
          Exit focus mode
        </TooltipContent>
      </Tooltip>

      {/* Title, view switcher and date navigation collapse away in Focus
          Mode; -mb-5 cancels the flex gap they leave behind. */}
      <div
        aria-hidden={focusMode}
        className={cn(
          "grid shrink-0 transition-[grid-template-rows,opacity,visibility,margin] duration-200 ease-out motion-reduce:transition-none",
          focusMode
            ? "invisible -mb-5 grid-rows-[0fr] opacity-0"
            : "grid-rows-[1fr]"
        )}
      >
        <div className="-mx-1 -my-1 flex min-h-0 flex-col gap-5 overflow-hidden px-1 py-1">
          {/* Header */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ListChecksIcon className="size-5 text-primary" weight="fill" />
              <h1 className="text-lg font-semibold">Daily Checklist</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <fieldset
                aria-label="Layout"
                className="m-0 flex min-w-0 items-center gap-1 rounded-lg border-0 bg-base-200 p-1"
              >
                {VIEW_OPTIONS.map(({ value, label, Icon }) => (
                  <Button
                    aria-pressed={view === value}
                    className={cn(
                      view === value
                        ? "bg-elevated text-base-content shadow-sm"
                        : "text-base-content/60"
                    )}
                    key={value}
                    onClick={() => dispatch({ type: "setView", view: value })}
                    size="sm"
                    variant="ghost"
                  >
                    <Icon weight={view === value ? "fill" : "regular"} />
                    <span className="hidden sm:inline">{label}</span>
                  </Button>
                ))}
              </fieldset>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={enterFocus}
                    ref={focusBtnRef}
                    size="sm"
                    variant="outline"
                  >
                    <ArrowsOutIcon />
                    <span className="hidden sm:inline">Focus Mode</span>
                    <span className="sr-only sm:hidden">Focus Mode</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Hide navigation and focus on your checklist
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Date navigation */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              onClick={() => setDate(addDays(date, -1))}
              size="sm"
              variant="outline"
            >
              <ArrowLeftIcon />
              Previous Day
            </Button>
            <Button
              disabled={isToday}
              onClick={() => setDate(today)}
              size="sm"
              variant="outline"
            >
              Today
            </Button>
            <Button
              onClick={() => setDate(addDays(date, 1))}
              size="sm"
              variant="outline"
            >
              Next Day
              <ArrowRightIcon />
            </Button>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-6 lg:min-h-0 lg:flex-1",
          view === "split" &&
            "lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_30rem] 2xl:grid-cols-[minmax(0,1fr)_34rem]",
          view === "task" && "lg:grid-cols-1 lg:grid-rows-1",
          view === "calendar" && "lg:grid-cols-1 lg:grid-rows-[minmax(0,1fr)]"
        )}
      >
        {view === "calendar" ? (
          calendarCard
        ) : (
          <>
            {checklistCard}
            {view === "split" && calendarCard}
          </>
        )}
      </div>

      <TaskDetailSheet
        entry={detailEntry}
        futureLocked={isFuture}
        onClose={() => setDetailId(null)}
        onEdit={() => detailEntry && openEdit(detailEntry)}
        onStatus={(s) => detailEntry && changeStatus(detailEntry, s)}
        readOnly={readOnly}
      />
      <ChecklistFormDialog
        date={date}
        entry={editing}
        onOpenChange={setFormOpen}
        onSubmit={handleSubmit}
        open={formOpen}
      />
      <ChecklistStopDialog
        entry={stopping}
        key={`stop-${stopping?.itemId ?? "none"}`}
        onConfirm={handleStop}
        onOpenChange={(o) => !o && setStopping(null)}
      />
      <ChecklistDeleteDialog
        entry={deleting}
        key={`del-${deleting?.itemId ?? "none"}`}
        onConfirm={handleDelete}
        onOpenChange={(o) => !o && setDeleting(null)}
      />
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}

function EntryRow({
  entry,
  onStatus,
  onOpen,
  onEdit,
  onDelete,
  onSkip,
  onStop,
  futureLocked,
  readOnly,
}: {
  entry: ChecklistEntry;
  onStatus: (status: ChecklistStatus) => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStop: () => void;
  onSkip: () => void;
  futureLocked: boolean;
  readOnly: boolean;
}) {
  const completed = entry.status === "COMPLETED";
  const skipped = entry.status === "SKIPPED";

  return (
    <li className="flex items-center gap-3 py-2.5">
      {skipped ? (
        <button
          aria-label="Skipped — click to restore"
          className="flex size-4.5 shrink-0 items-center justify-center rounded-none text-base-content/60 hover:text-base-content disabled:pointer-events-none"
          disabled={readOnly}
          onClick={() => onStatus("INCOMPLETE")}
          type="button"
        >
          <ProhibitIcon className="size-4.5" />
        </button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* span: a disabled checkbox gets no pointer events of its own */}
            <span className="flex">
              <Checkbox
                aria-label={`Mark "${entry.title}" ${completed ? "pending" : "complete"}`}
                checked={completed}
                disabled={readOnly || futureLocked}
                onCheckedChange={(c) =>
                  onStatus(c ? "COMPLETED" : "INCOMPLETE")
                }
              />
            </span>
          </TooltipTrigger>
          {futureLocked && !readOnly && (
            <TooltipContent side="right">
              {FUTURE_COMPLETION_ERROR}
            </TooltipContent>
          )}
        </Tooltip>
      )}

      {/* Clicking the row (not the checkbox / menu) opens the detail drawer.
          On sm+ the metadata sits in fixed-width slots so every row lines up;
          on mobile it wraps under the title. */}
      <button
        className={cn(
          "flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
          (completed || skipped) && "text-base-content/60"
        )}
        onClick={onOpen}
        type="button"
      >
        <span
          className={cn(
            "min-w-0 flex-1 basis-40 truncate text-sm font-medium",
            (completed || skipped) && "line-through"
          )}
        >
          {entry.title}
        </span>
        <span className="flex items-center gap-x-4 text-xs text-base-content/60">
          <span className="sm:w-16">
            {entry.dueTime ? formatDueTime(entry.dueTime) : ""}
          </span>
          <span className="truncate sm:w-24">
            {entry.isRecurring
              ? describeRepeat(
                  entry.repeat,
                  entry.repeatInterval,
                  entry.repeatUnit
                )
              : ""}
            {skipped && !entry.isRecurring && "Skipped"}
          </span>
        </span>
      </button>

      {readOnly ? (
        <span className="size-7 shrink-0" />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Task actions"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
              type="button"
            >
              <DotsThreeIcon className="size-4" weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {!entry.isDeleted && (
              <DropdownMenuItem onClick={onEdit}>
                <PencilSimpleIcon className="size-3.5" />
                Edit task
              </DropdownMenuItem>
            )}
            {skipped ? (
              <DropdownMenuItem onClick={() => onStatus("INCOMPLETE")}>
                <ProhibitIcon className="size-3.5" />
                Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onSkip}>
                <ProhibitIcon className="size-3.5" />
                Skip this day
              </DropdownMenuItem>
            )}
            {!entry.isDeleted && (
              <>
                <DropdownMenuSeparator />
                {entry.isRecurring && (
                  <DropdownMenuItem onClick={onStop}>
                    <StopCircleIcon className="size-3.5" />
                    Stop recurring task
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-error" onClick={onDelete}>
                  <TrashIcon className="size-3.5" />
                  Delete task
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
