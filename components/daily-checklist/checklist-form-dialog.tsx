"use client";

import { CalendarBlankIcon } from "@phosphor-icons/react";
import { format } from "date-fns";
import * as React from "react";
import type {
  ChecklistEntry,
  ChecklistInput,
  ChecklistScope,
} from "@/app/actions/daily-checklist";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addDays,
  CHECKLIST_REPEATS,
  type ChecklistRepeat,
  type ChecklistRepeatUnit,
  dateStrToLocalDate,
  MAX_END_AFTER,
  MAX_REPEAT_INTERVAL,
  REPEAT_LABELS,
  toDateStr,
} from "@/lib/daily-checklist";

const SCOPE_OPTIONS: { value: ChecklistScope; label: string }[] = [
  { value: "DAY", label: "This day only" },
  { value: "FUTURE", label: "This and future days" },
];

type EndsMode = "NEVER" | "DATE" | "AFTER";

interface ChecklistFormDialogProps {
  /** The day being viewed — a new task starts on it. */
  date: string;
  /** Entry being edited, or null to create a new task. */
  entry: ChecklistEntry | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    input: ChecklistInput,
    scope: ChecklistScope
  ) => Promise<string | null>;
  open: boolean;
}

export function ChecklistFormDialog({
  date,
  open,
  onOpenChange,
  entry,
  onSubmit,
}: ChecklistFormDialogProps) {
  const isEdit = entry !== null;
  const recurring = entry?.isRecurring ?? false;

  const [title, setTitle] = React.useState("");
  const [dueTime, setDueTime] = React.useState("");
  const [repeat, setRepeat] = React.useState<ChecklistRepeat>("NONE");
  const [interval, setIntervalValue] = React.useState("1");
  const [unit, setUnit] = React.useState<ChecklistRepeatUnit>("DAY");
  const [scope, setScope] = React.useState<ChecklistScope>("ALL");
  const [endsMode, setEndsMode] = React.useState<EndsMode>("NEVER");
  const [endDate, setEndDate] = React.useState("");
  const [endAfter, setEndAfter] = React.useState("10");
  const [endOpen, setEndOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Reset the form each time the dialog opens.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(entry?.title ?? "");
    setDueTime(entry?.dueTime ?? "");
    setRepeat(entry?.repeat ?? "NONE");
    setIntervalValue(String(entry?.repeatInterval ?? 1));
    setUnit(entry?.repeatUnit ?? "DAY");
    setScope(entry?.isRecurring ? "FUTURE" : "ALL");
    setEndsMode(entry?.endDate ? "DATE" : "NEVER");
    setEndDate(entry?.endDate ?? addDays(entry?.startDate ?? date, 30));
    setEndAfter("10");
    setEndOpen(false);
    setError("");
    setSaving(false);
  }, [open, entry, date]);

  // A single-day edit can only change the day's title / time.
  const dayOnly = isEdit && recurring && scope === "DAY";
  // Earliest valid end date: the day the (new or edited) series starts.
  const minEnd = entry
    ? scope === "FUTURE"
      ? entry.date
      : entry.startDate
    : date;
  // A stored end date before the new series start would be invalid.
  React.useEffect(() => {
    if (endDate && endDate < minEnd) {
      setEndDate(minEnd);
    }
  }, [endDate, minEnd]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Task name is required");
      return;
    }
    const n = Number(interval);
    if (
      repeat === "CUSTOM" &&
      (!Number.isInteger(n) || n < 1 || n > MAX_REPEAT_INTERVAL)
    ) {
      setError(`Repeat interval must be between 1 and ${MAX_REPEAT_INTERVAL}`);
      return;
    }
    const after = Number(endAfter);
    if (
      repeat !== "NONE" &&
      endsMode === "AFTER" &&
      (!Number.isInteger(after) || after < 1 || after > MAX_END_AFTER)
    ) {
      setError(`Occurrences must be between 1 and ${MAX_END_AFTER}`);
      return;
    }
    setSaving(true);
    setError("");
    const message = await onSubmit(
      {
        title,
        dueTime: dueTime || null,
        repeat,
        repeatInterval: repeat === "CUSTOM" ? n : 1,
        repeatUnit: repeat === "CUSTOM" ? unit : null,
        endDate: repeat !== "NONE" && endsMode === "DATE" ? endDate : null,
        endAfter: repeat !== "NONE" && endsMode === "AFTER" ? after : null,
      },
      scope
    );
    if (message) {
      setError(message);
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Task" : "Add Task"}</DialogTitle>
          {isEdit && recurring && (
            <DialogDescription>
              This task repeats. Changes apply from this day on by default;
              earlier days keep their original details.
            </DialogDescription>
          )}
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {isEdit && recurring && (
            <RadioGroup
              className="gap-2"
              onValueChange={(v) => setScope(v as ChecklistScope)}
              value={scope}
            >
              {SCOPE_OPTIONS.map((o) => (
                <label
                  className="flex cursor-pointer items-center gap-2.5 text-sm text-base-content"
                  htmlFor={`scope-${o.value}`}
                  key={o.value}
                >
                  <RadioGroupItem id={`scope-${o.value}`} value={o.value} />
                  {o.label}
                </label>
              ))}
            </RadioGroup>
          )}

          <div className="space-y-2">
            <label
              className="text-sm font-medium text-base-content"
              htmlFor="checklist-title"
            >
              Task name
            </label>
            <Input
              autoFocus
              id="checklist-title"
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Check emails"
              value={title}
            />
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium text-base-content"
              htmlFor="checklist-time"
            >
              Due time <span className="text-base-content/60">(optional)</span>
            </label>
            <Input
              id="checklist-time"
              onChange={(e) => setDueTime(e.target.value)}
              type="time"
              value={dueTime}
            />
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-base-content">
              Repeat
            </span>
            <Select
              disabled={dayOnly}
              onValueChange={(v) => setRepeat(v as ChecklistRepeat)}
              value={repeat}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="p-1.5">
                {CHECKLIST_REPEATS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {REPEAT_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {repeat === "CUSTOM" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-base-content/60">Every</span>
                <Input
                  aria-label="Repeat interval"
                  className="w-20"
                  disabled={dayOnly}
                  max={MAX_REPEAT_INTERVAL}
                  min={1}
                  onChange={(e) => setIntervalValue(e.target.value)}
                  type="number"
                  value={interval}
                />
                <Select
                  disabled={dayOnly}
                  onValueChange={(v) => setUnit(v as ChecklistRepeatUnit)}
                  value={unit}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="p-1.5">
                    <SelectItem value="DAY">day(s)</SelectItem>
                    <SelectItem value="WEEK">week(s)</SelectItem>
                    <SelectItem value="MONTH">month(s)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {dayOnly && (
              <p className="text-xs text-base-content/60">
                Repeat can&rsquo;t change for a single day.
              </p>
            )}
          </div>

          {repeat !== "NONE" && !dayOnly && (
            <div className="space-y-2">
              <span className="text-sm font-medium text-base-content">
                Ends
              </span>
              <div className="flex items-center gap-2">
                <Select
                  onValueChange={(v) => setEndsMode(v as EndsMode)}
                  value={endsMode}
                >
                  <SelectTrigger
                    className={endsMode === "NEVER" ? "w-full" : "w-40"}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="p-1.5">
                    <SelectItem value="NEVER">Never</SelectItem>
                    <SelectItem value="DATE">On a date</SelectItem>
                    <SelectItem value="AFTER">
                      After a number of times
                    </SelectItem>
                  </SelectContent>
                </Select>
                {endsMode === "DATE" && (
                  <Popover onOpenChange={setEndOpen} open={endOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        className="flex-1 justify-start"
                        type="button"
                        variant="outline"
                      >
                        <CalendarBlankIcon />
                        {format(dateStrToLocalDate(endDate), "MMM d, yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        disabled={{ before: dateStrToLocalDate(minEnd) }}
                        mode="single"
                        onSelect={(d) => {
                          if (d) {
                            setEndDate(toDateStr(d));
                            setEndOpen(false);
                          }
                        }}
                        selected={dateStrToLocalDate(endDate)}
                      />
                    </PopoverContent>
                  </Popover>
                )}
                {endsMode === "AFTER" && (
                  <>
                    <Input
                      aria-label="Number of occurrences"
                      className="w-20"
                      max={MAX_END_AFTER}
                      min={1}
                      onChange={(e) => setEndAfter(e.target.value)}
                      type="number"
                      value={endAfter}
                    />
                    <span className="text-sm text-base-content/60">
                      occurrences
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              disabled={saving}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={saving || !title.trim()} type="submit">
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
