"use client";

import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckSquareIcon,
  SquareIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import * as React from "react";
import type { ChecklistDaySummary } from "@/app/actions/daily-checklist";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  buildMonthGrid,
  type DayStatusKind,
  dateStrToLocalDate,
  dayStatus,
} from "@/lib/daily-checklist";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// Status dot: green = all done · orange = some done · red = past day with
// nothing done · gray = no tasks, or tasks still pending (today / upcoming).
// (A past day with anything still pending also gets a red date number.)
const DOT_CLASS: Record<DayStatusKind, string> = {
  none: "bg-base-content/20",
  all: "bg-success",
  some: "bg-warning",
  missed: "bg-error",
  pending: "bg-base-content/20",
};

interface ChecklistMonthCalendarProps {
  /** Month-summary data (one query for the whole month). */
  days: Record<string, ChecklistDaySummary>;
  /** "YYYY-MM" being displayed. */
  month: string;
  onMonthChange: (month: string) => void;
  onSelectDate: (date: string) => void;
  selectedDate: string;
  today: string;
}

export function ChecklistMonthCalendar({
  month,
  selectedDate,
  today,
  days,
  onMonthChange,
  onSelectDate,
}: ChecklistMonthCalendarProps) {
  const weeks = React.useMemo(() => buildMonthGrid(month), [month]);

  // One hover preview at a time. Leaving the cell or the preview starts a short
  // close timer that entering either one cancels, so crossing the gap between
  // them doesn't flicker.
  const [previewDate, setPreviewDate] = React.useState<string | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const cancelClose = React.useCallback(
    () => clearTimeout(closeTimer.current),
    []
  );
  const scheduleClose = React.useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPreviewDate(null), 150);
  }, []);
  React.useEffect(() => () => clearTimeout(closeTimer.current), []);
  const showPreview = React.useCallback(
    (d: string) => {
      cancelClose();
      setPreviewDate(d);
    },
    [cancelClose]
  );

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
        <h3 className="text-sm font-semibold">
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

      {/* Square cells. The wrapper is a size container, so the cell side `--s`
          is the largest square that fits BOTH the width (7 columns) and — on lg+,
          where the card has a definite height — the height (header row + N week
          rows), never below 1.75rem (then the card scrolls instead of
          squashing). Below lg only the width matters, so the page just grows. */}
      <div className="min-h-0 flex-1 [container-type:inline-size] lg:[container-type:size]">
        <div
          className="grid justify-center gap-1.5 [--s:var(--s-w)] lg:[--s:max(1.75rem,min(var(--s-w),var(--s-h)))]"
          style={
            {
              "--weeks": weeks.length,
              // 7 columns, 6 gaps of 0.375rem
              "--s-w": "calc((100cqw - 2.25rem) / 7)",
              // minus the 1.75rem weekday row and the gaps between week rows
              "--s-h":
                "calc((100cqh - 1.75rem - var(--weeks) * 0.375rem) / var(--weeks))",
              gridTemplateColumns: "repeat(7, var(--s))",
              gridTemplateRows: "1.75rem repeat(var(--weeks), var(--s))",
            } as React.CSSProperties
          }
        >
          {WEEKDAYS.map((w) => (
            <div
              className="flex items-center justify-center text-xs text-base-content/60"
              key={w}
            >
              {w}
            </div>
          ))}
          {weeks.flat().map((date) => (
            <DayCell
              date={date}
              inMonth={date.slice(0, 7) === month}
              key={date}
              onCancelClose={cancelClose}
              onClosePreview={() => setPreviewDate(null)}
              onScheduleClose={scheduleClose}
              onSelectDate={onSelectDate}
              onShowPreview={showPreview}
              previewOpen={previewDate === date}
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

function DayCell({
  date,
  inMonth,
  summary,
  today,
  selected,
  previewOpen,
  onSelectDate,
  onShowPreview,
  onScheduleClose,
  onCancelClose,
  onClosePreview,
}: {
  date: string;
  inMonth: boolean;
  summary: ChecklistDaySummary | undefined;
  today: string;
  selected: boolean;
  previewOpen: boolean;
  onSelectDate: (date: string) => void;
  onShowPreview: (date: string) => void;
  onScheduleClose: () => void;
  onCancelClose: () => void;
  onClosePreview: () => void;
}) {
  const isToday = date === today;
  // Only days of the displayed month have summary data.
  const data = inMonth ? summary : undefined;
  const { kind, overdue } = dayStatus(data, date, today);
  const label = format(dateStrToLocalDate(date), "EEEE, MMMM d");
  const aria =
    data && data.total > 0
      ? `${label}, ${data.completed} of ${data.total} completed`
      : label;
  const pointerType = React.useRef<string>("mouse");

  const cell = (
    <button
      aria-current={isToday ? "date" : undefined}
      aria-label={aria}
      aria-pressed={selected}
      className={cn(
        "flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-md text-sm tabular-nums outline-none transition-colors hover:bg-base-200 focus-visible:ring-2 focus-visible:ring-ring/40",
        !inMonth && "text-base-content/40",
        overdue && !isToday && "text-error",
        isToday && "font-semibold text-primary",
        selected && "bg-primary/10 font-semibold ring-2 ring-primary"
      )}
      onBlur={() => inMonth && onScheduleClose()}
      onClick={() => {
        onSelectDate(date);
        // Touch has no hover: a tap selects the date and shows its preview.
        if (inMonth && pointerType.current !== "mouse") {
          onShowPreview(date);
        }
      }}
      onFocus={(e) => {
        // Keyboard focus only (a mouse click also focuses the button).
        if (inMonth && e.currentTarget.matches(":focus-visible")) {
          onShowPreview(date);
        }
      }}
      onPointerDown={(e) => {
        pointerType.current = e.pointerType;
      }}
      onPointerEnter={(e) => {
        pointerType.current = e.pointerType;
        if (inMonth && e.pointerType === "mouse") {
          onShowPreview(date);
        }
      }}
      onPointerLeave={(e) => {
        if (inMonth && e.pointerType === "mouse") {
          onScheduleClose();
        }
      }}
      type="button"
    >
      <span className="leading-none">{Number(date.slice(8))}</span>
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          inMonth ? DOT_CLASS[kind] : "bg-transparent"
        )}
      />
    </button>
  );

  if (!inMonth) {
    return cell;
  }

  return (
    <Popover
      onOpenChange={(open) => !open && onClosePreview()}
      open={previewOpen}
    >
      <PopoverAnchor asChild>{cell}</PopoverAnchor>
      <PopoverContent
        align="center"
        className="w-60 p-3"
        collisionPadding={12}
        // A hover preview must not steal focus from the calendar.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={onCancelClose}
        onPointerLeave={onScheduleClose}
        side="bottom"
        sideOffset={6}
      >
        <DayPreview data={data} date={date} today={today} />
      </PopoverContent>
    </Popover>
  );
}

function DayPreview({
  date,
  data,
  today,
}: {
  date: string;
  data: ChecklistDaySummary | undefined;
  today: string;
}) {
  const total = data?.total ?? 0;
  const completed = data?.completed ?? 0;
  const pending = total - completed;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const more = total - (data?.preview.length ?? 0);
  const past = date < today;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold">
          {format(dateStrToLocalDate(date), "EEEE, MMMM d")}
        </p>
        <p className="text-xs text-base-content/60 tabular-nums">
          {total === 0
            ? "No tasks"
            : `${total} ${total === 1 ? "task" : "tasks"} · ${percent}% completed`}
        </p>
        {total > 0 && (
          <p className="text-xs text-base-content/60 tabular-nums">
            {completed} completed · {pending} pending
          </p>
        )}
      </div>
      {data && data.preview.length > 0 && (
        <ul className="space-y-1">
          {data.preview.map((t) => {
            const done = t.status === "COMPLETED";
            return (
              <li className="flex items-center gap-1.5 text-xs" key={t.itemId}>
                {done ? (
                  <CheckSquareIcon
                    className="size-3.5 shrink-0 text-success"
                    weight="fill"
                  />
                ) : (
                  <SquareIcon
                    className={cn(
                      "size-3.5 shrink-0",
                      past ? "text-error" : "text-base-content/50"
                    )}
                  />
                )}
                <span
                  className={cn(
                    "min-w-0 truncate",
                    done && "text-base-content/50 line-through"
                  )}
                >
                  {t.title}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {more > 0 && (
        <p className="text-xs text-base-content/60">
          +{more} more {more === 1 ? "task" : "tasks"}
        </p>
      )}
    </div>
  );
}
