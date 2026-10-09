"use client";

import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckSquareIcon,
  SquareIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import * as React from "react";
import type {
  ChecklistDaySummary,
  ChecklistDayTask,
} from "@/app/actions/daily-checklist";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildMonthGrid,
  canCompleteOnDate,
  type DayStatusKind,
  dateStrToLocalDate,
  dayStatus,
  describeRepeat,
  formatDueTime,
  splitCellTasks,
} from "@/lib/daily-checklist";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DOT_CLASS: Record<DayStatusKind, string> = {
  none: "bg-base-content/20",
  all: "bg-success",
  some: "bg-warning",
  missed: "bg-error",
  pending: "bg-base-content/20",
};

/** Rows reserved for the date line inside a cell, and the height of a task row. */
const CELL_HEAD_PX = 30;
const TASK_ROW_PX = 22;
/** Below this cell width task titles can't be read: show counts instead. */
const MIN_LABEL_CELL_PX = 88;

interface Props {
  days: Record<string, ChecklistDaySummary>;
  month: string;
  onMonthChange: (month: string) => void;
  onOpenTask: (date: string, itemId: string) => void;
  onSelectDate: (date: string) => void;
  onToggleTask: (date: string, task: ChecklistDayTask, done: boolean) => void;
  selectedDate: string;
  today: string;
}

export function ChecklistFocusCalendar({
  month,
  selectedDate,
  today,
  days,
  onMonthChange,
  onSelectDate,
  onOpenTask,
  onToggleTask,
}: Props) {
  const weeks = React.useMemo(() => buildMonthGrid(month), [month]);

  // Cell size drives how many task rows fit (and whether titles show at all).
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [cell, setCell] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = gridRef.current;
    if (!el) {
      return;
    }
    const measure = () =>
      setCell({
        w: el.clientWidth / 7,
        h: el.clientHeight / weeks.length,
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);
  const compact = cell.w < MIN_LABEL_CELL_PX;
  const capacity = compact
    ? 0
    : Math.max(0, Math.floor((cell.h - CELL_HEAD_PX) / TASK_ROW_PX));

  function shiftMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    onMonthChange(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <Button
          aria-label="Previous month"
          onClick={() => shiftMonth(-1)}
          size="icon-sm"
          variant="ghost"
        >
          <CaretLeftIcon />
        </Button>
        <h3 className="text-base font-semibold">
          {format(dateStrToLocalDate(`${month}-01`), "MMMM yyyy")}
        </h3>
        <Button
          aria-label="Next month"
          onClick={() => shiftMonth(1)}
          size="icon-sm"
          variant="ghost"
        >
          <CaretRightIcon />
        </Button>
      </div>

      <div className="grid shrink-0 grid-cols-7 pb-1.5 text-center text-xs font-medium text-base-content/60">
        {WEEKDAYS.map((w) => (
          <div key={w}>
            <span className="sm:hidden">{w[0]}</span>
            <span className="hidden sm:inline">{w}</span>
          </div>
        ))}
      </div>

      {/* Fills the card; the week rows share its height equally. Below lg the
          card has no fixed height, so rows get a floor and the page scrolls. */}
      <div
        className="min-h-[calc(var(--weeks)*4.25rem)] flex-1 overflow-hidden rounded-lg border border-base-300 sm:min-h-[calc(var(--weeks)*6.5rem)] lg:min-h-[calc(var(--weeks)*4.5rem)]"
        style={{ "--weeks": weeks.length } as React.CSSProperties}
      >
        <div
          className="grid h-full grid-cols-7 gap-px bg-base-300"
          ref={gridRef}
          style={{
            gridTemplateRows: "repeat(var(--weeks), minmax(0, 1fr))",
          }}
        >
          {weeks.flat().map((date) => (
            <FocusCell
              capacity={capacity}
              compact={compact}
              date={date}
              inMonth={date.slice(0, 7) === month}
              key={date}
              onOpenTask={onOpenTask}
              onSelectDate={onSelectDate}
              onToggleTask={onToggleTask}
              selected={date === selectedDate}
              summary={days[date]}
              today={today}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FocusCell({
  date,
  inMonth,
  summary,
  today,
  selected,
  capacity,
  compact,
  onSelectDate,
  onOpenTask,
  onToggleTask,
}: {
  date: string;
  inMonth: boolean;
  summary: ChecklistDaySummary | undefined;
  today: string;
  selected: boolean;
  capacity: number;
  compact: boolean;
  onSelectDate: (date: string) => void;
  onOpenTask: (date: string, itemId: string) => void;
  onToggleTask: (date: string, task: ChecklistDayTask, done: boolean) => void;
}) {
  const isToday = date === today;
  // Only the displayed month has summary data; adjacent days stay muted.
  const data = inMonth ? summary : undefined;
  const tasks = data?.tasks ?? [];
  const { kind, overdue } = dayStatus(data, date, today);
  const { visible, hidden } = splitCellTasks(tasks, capacity);
  const label = format(dateStrToLocalDate(date), "EEEE, MMMM d");
  const aria =
    data && data.total > 0
      ? `${label}, ${data.completed} of ${data.total} completed`
      : label;

  return (
    <div
      className={cn(
        "relative min-h-0 min-w-0 overflow-hidden bg-elevated transition-colors",
        !inMonth && "bg-base-200/50",
        selected && "z-10 bg-primary/5 ring-2 ring-primary ring-inset"
      )}
    >
      {/* Whole-cell hit area: clicking any empty part selects the date. */}
      <button
        aria-current={isToday ? "date" : undefined}
        aria-label={aria}
        aria-pressed={selected}
        className="absolute inset-0 outline-none transition-colors hover:bg-base-200/60 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
        onClick={() => onSelectDate(date)}
        type="button"
      />
      <div className="pointer-events-none relative flex h-full min-h-0 flex-col gap-0.5 p-1 sm:p-1.5">
        <div className="flex shrink-0 items-center justify-between gap-1">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums sm:text-sm",
              !inMonth && "text-base-content/40",
              overdue && !isToday && "text-error",
              isToday && "bg-primary font-semibold text-primary-content"
            )}
          >
            {Number(date.slice(8))}
          </span>
          {inMonth && data && data.total > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-base-content/60 tabular-nums">
              {compact && (
                <span>
                  {data.completed}/{data.total}
                </span>
              )}
              <span
                aria-hidden
                className={cn("size-1.5 rounded-full", DOT_CLASS[kind])}
              />
            </span>
          )}
        </div>

        {!compact && (
          <ul className="flex min-h-0 flex-col gap-0.5">
            {visible.map((t) => (
              <li className="pointer-events-auto" key={t.itemId}>
                <TaskLine
                  date={date}
                  onOpen={onOpenTask}
                  onToggle={onToggleTask}
                  task={t}
                  today={today}
                />
              </li>
            ))}
            {hidden.length > 0 && (
              <li className="pointer-events-auto">
                <MoreTasks
                  date={date}
                  hidden={hidden}
                  onOpen={onOpenTask}
                  onToggle={onToggleTask}
                  today={today}
                />
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function TaskLine({
  task,
  date,
  today,
  onOpen,
  onToggle,
  roomy,
}: {
  task: ChecklistDayTask;
  date: string;
  today: string;
  onOpen: (date: string, itemId: string) => void;
  onToggle: (date: string, task: ChecklistDayTask, done: boolean) => void;
  roomy?: boolean;
}) {
  const done = task.status === "COMPLETED";
  const past = date < today;
  const overdue = past && !done;
  const canToggle = canCompleteOnDate(date, today);

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1 rounded px-1 text-[11px] leading-5 hover:bg-base-200",
        roomy && "gap-2 py-0.5 text-sm"
      )}
    >
      {canToggle ? (
        <Checkbox
          aria-label={`Mark "${task.title}" ${done ? "pending" : "complete"}`}
          checked={done}
          className="size-3.5 [&>span>svg]:size-2.5"
          onCheckedChange={(c) => onToggle(date, task, Boolean(c))}
        />
      ) : done ? (
        <CheckSquareIcon
          aria-label="Completed"
          className="size-3.5 shrink-0 text-success"
          weight="fill"
        />
      ) : (
        <SquareIcon
          aria-label={overdue ? "Overdue" : "Pending"}
          className={cn(
            "size-3.5 shrink-0",
            overdue ? "text-error" : "text-base-content/40"
          )}
        />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 text-left outline-none focus-visible:underline",
              done && "text-base-content/50 line-through",
              !done && overdue && "text-error/90"
            )}
            onClick={() => onOpen(date, task.itemId)}
            type="button"
          >
            {task.dueTime && (
              <span className="shrink-0 text-base-content/50 tabular-nums">
                {formatDueTime(task.dueTime)}
              </span>
            )}
            <span className="min-w-0 truncate">{task.title}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          <p className="font-medium break-words">{task.title}</p>
          <p className="opacity-80">
            {done ? "Completed" : overdue ? "Overdue" : "Pending"}
            {task.dueTime && ` · Due ${formatDueTime(task.dueTime)}`}
          </p>
          {task.repeat !== "NONE" && (
            <p className="opacity-80">
              {describeRepeat(
                task.repeat,
                task.repeatInterval,
                task.repeatUnit
              )}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function MoreTasks({
  hidden,
  date,
  today,
  onOpen,
  onToggle,
}: {
  hidden: ChecklistDayTask[];
  date: string;
  today: string;
  onOpen: (date: string, itemId: string) => void;
  onToggle: (date: string, task: ChecklistDayTask, done: boolean) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="w-full rounded px-1 text-left text-[11px] leading-5 font-medium text-base-content/60 hover:bg-base-200 hover:text-base-content"
          type="button"
        >
          +{hidden.length} more
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-1 p-2">
        <p className="px-1 pb-1 text-xs font-semibold">
          {format(dateStrToLocalDate(date), "EEEE, MMMM d")}
        </p>
        <ul>
          {hidden.map((t) => (
            <li key={t.itemId}>
              <TaskLine
                date={date}
                onOpen={onOpen}
                onToggle={onToggle}
                roomy
                task={t}
                today={today}
              />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
