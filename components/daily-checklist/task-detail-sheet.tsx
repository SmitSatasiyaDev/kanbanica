"use client";

import { format } from "date-fns";
import type { ChecklistEntry } from "@/app/actions/daily-checklist";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type ChecklistStatus,
  dateStrToLocalDate,
  describeRepeat,
  formatDueTime,
} from "@/lib/daily-checklist";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<ChecklistStatus, { label: string; cls: string }> = {
  COMPLETED: { label: "Completed", cls: "bg-success/10 text-success" },
  INCOMPLETE: { label: "Pending", cls: "bg-warning/10 text-warning" },
  SKIPPED: { label: "Skipped", cls: "bg-base-200 text-base-content/60" },
};

interface TaskDetailSheetProps {
  entry: ChecklistEntry | null;
  /** Upcoming day: viewable, but not completable yet. */
  futureLocked?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onStatus: (status: ChecklistStatus) => void;
  readOnly: boolean;
}

export function TaskDetailSheet({
  entry,
  onClose,
  onStatus,
  onEdit,
  readOnly,
  futureLocked = false,
}: TaskDetailSheetProps) {
  return (
    <Sheet onOpenChange={(o) => !o && onClose()} open={entry !== null}>
      <SheetContent
        className="flex w-full flex-col p-0 sm:max-w-md"
        side="right"
      >
        {entry && (
          <>
            <SheetHeader className="space-y-2 border-b border-base-300 p-6 pr-14">
              <SheetTitle
                className={cn(
                  "text-lg",
                  entry.status !== "INCOMPLETE" && "line-through opacity-70"
                )}
              >
                {entry.title}
              </SheetTitle>
              <span
                className={cn(
                  "w-fit rounded-full px-2 py-0.5 text-xs font-medium",
                  STATUS_STYLE[entry.status].cls
                )}
              >
                {STATUS_STYLE[entry.status].label}
              </span>
            </SheetHeader>

            <dl className="flex-1 space-y-4 overflow-y-auto p-6 text-sm">
              <Field label="Due date">
                {format(dateStrToLocalDate(entry.date), "EEEE, MMMM d, yyyy")}
                {entry.dueTime && ` · ${formatDueTime(entry.dueTime)}`}
              </Field>
              <Field label="Recurrence">
                {describeRepeat(
                  entry.repeat,
                  entry.repeatInterval,
                  entry.repeatUnit
                )}
              </Field>
              {entry.completedAt && (
                <Field label="Completed">
                  {format(
                    new Date(entry.completedAt),
                    "MMM d, yyyy 'at' h:mm a"
                  )}
                </Field>
              )}
            </dl>

            <SheetFooter className="border-t border-base-300 p-6">
              {readOnly && (
                <p className="text-xs text-base-content/60">
                  Past days are read-only.
                </p>
              )}
              {futureLocked && !readOnly && (
                <p className="text-xs text-base-content/60">
                  This task can be completed on its scheduled date.
                </p>
              )}
              <div className="flex gap-2">
                {!(readOnly || entry.isDeleted) && (
                  <Button onClick={onEdit} variant="outline">
                    Edit
                  </Button>
                )}
                <Button
                  className="flex-1"
                  disabled={readOnly || futureLocked}
                  onClick={() =>
                    onStatus(
                      entry.status === "COMPLETED" ? "INCOMPLETE" : "COMPLETED"
                    )
                  }
                >
                  {entry.status === "COMPLETED"
                    ? "Mark Pending"
                    : "Mark Complete"}
                </Button>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-3">
      <dt className="text-base-content/60">{label}</dt>
      <dd className="min-w-0 font-medium text-base-content">{children}</dd>
    </div>
  );
}
