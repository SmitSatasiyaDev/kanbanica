"use client";

import { CalendarBlankIcon, LightningIcon } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { createSprint, getCreateSprintDefaults } from "@/app/actions/sprint";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { dateStrToLocalDate, dateToDay } from "@/lib/due-date";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateSprintModalProps {
  onCreated: () => void;
  onOpenChange: (open: boolean) => void;
  onOpenSettings?: () => void;
  open: boolean;
  spaceId: string;
  workspaceId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateSprintModal({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  onCreated,
  onOpenSettings,
}: CreateSprintModalProps) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [durationWeeks, setDurationWeeks] = useState(2);
  const [sprintStartDay, setSprintStartDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endDate = startDate ? addWeeks(startDate, durationWeeks) : null;

  // Load smart defaults when opened
  useEffect(() => {
    if (!open) {
      return;
    }
    setName("");
    setGoal("");
    setStartDate(null);
    setDurationWeeks(2);
    setSprintStartDay(null);
    setError(null);

    getCreateSprintDefaults(workspaceId, spaceId).then((result) => {
      if ("error" in result) {
        return;
      }
      setName(result.suggestedName);
      if (result.suggestedStartDate) {
        setStartDate(dateStrToLocalDate(result.suggestedStartDate));
      }
      setDurationWeeks(Math.min(4, Math.max(1, result.durationWeeks)));
      setSprintStartDay(result.sprintStartDay);
    });
  }, [open, workspaceId, spaceId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      setError("Sprint name is required.");
      return;
    }
    if (!startDate) {
      setError("Start date is required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await createSprint(workspaceId, spaceId, {
        name: name.trim(),
        goal: goal.trim() || undefined,
        startDate: dateToDay(startDate),
        durationWeeks,
      });

      if ("error" in result) {
        setError(result.error);
        return;
      }

      onCreated();
      onOpenChange(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const DAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LightningIcon className="size-4 text-primary" weight="fill" />
            Create Sprint
          </DialogTitle>
        </DialogHeader>

        <form className="space-y-5 py-1" onSubmit={handleSubmit}>
          {/* Sprint Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sprint-name">
              Sprint Name <span className="text-error">*</span>
            </Label>
            <Input
              autoFocus
              id="sprint-name"
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sprint 1, Q3 Week 2"
              value={name}
            />
          </div>

          {/* Goal */}
          <div className="space-y-1.5">
            <Label htmlFor="sprint-goal">
              Goal{" "}
              <span className="text-xs font-normal text-base-content/60">
                (optional)
              </span>
            </Label>
            <Textarea
              className="resize-none"
              id="sprint-goal"
              maxLength={200}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What does this sprint aim to achieve?"
              rows={2}
              value={goal}
            />
            <p className="text-xs text-base-content/60 text-right">
              {goal.length}/200
            </p>
          </div>

          {/* Start Date + End Date */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                Start Date <span className="text-error">*</span>
              </Label>
              <Popover onOpenChange={setStartDateOpen} open={startDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="flex h-10 w-full items-center gap-2 rounded-md border border-base-300 px-3 text-sm transition-colors hover:bg-base-200"
                    type="button"
                  >
                    <CalendarBlankIcon className="size-3.5 text-base-content/60 shrink-0" />
                    <span
                      className={
                        startDate ? "text-base-content" : "text-base-content/60"
                      }
                    >
                      {startDate
                        ? format(startDate, "MMM d, yyyy")
                        : "Pick a date"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    disabled={
                      sprintStartDay === null
                        ? undefined
                        : (d) => d.getDay() !== sprintStartDay
                    }
                    mode="single"
                    onSelect={(date) => {
                      setStartDate(date ?? null);
                      setStartDateOpen(false);
                    }}
                    selected={startDate ?? undefined}
                  />
                </PopoverContent>
              </Popover>
              {sprintStartDay !== null && (
                <p className="text-xs text-base-content/60">
                  Starts on {DAY_NAMES[sprintStartDay]}s
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>End Date</Label>
              <div className="flex h-10 w-full items-center gap-2 rounded-md border border-base-300 bg-base-200/40 px-3 text-sm">
                <CalendarBlankIcon className="size-3.5 text-base-content/60 shrink-0" />
                <span
                  className={
                    endDate ? "text-base-content" : "text-base-content/60"
                  }
                >
                  {endDate
                    ? format(endDate, "MMM d, yyyy")
                    : `${durationWeeks}w from start`}
                </span>
              </div>
              <p className="text-xs text-base-content/60">
                {durationWeeks} {durationWeeks === 1 ? "week" : "weeks"}{" "}
                duration
              </p>
            </div>
          </div>

          {/* Settings hint */}
          <p className="text-xs text-base-content/60">
            Duration and start day are set in{" "}
            {onOpenSettings ? (
              <button
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
                onClick={() => {
                  onOpenChange(false);
                  onOpenSettings();
                }}
                type="button"
              >
                Sprint Settings
              </button>
            ) : (
              <span className="text-base-content font-medium">
                Sprint Settings
              </span>
            )}
            .
          </p>

          {/* Error */}
          {error && (
            <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              disabled={loading}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={loading} type="submit">
              {loading ? "Creating…" : "Create Sprint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
