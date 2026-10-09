"use client";

import { ProhibitIcon } from "@phosphor-icons/react";
import { format } from "date-fns";
import * as React from "react";
import type { ChecklistEntry } from "@/app/actions/daily-checklist";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dateStrToLocalDate } from "@/lib/daily-checklist";

interface ChecklistStopDialogProps {
  entry: ChecklistEntry | null;
  onConfirm: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

export function ChecklistStopDialog({
  entry,
  onOpenChange,
  onConfirm,
}: ChecklistStopDialogProps) {
  const [busy, setBusy] = React.useState(false);

  async function confirm() {
    if (busy) {
      return;
    }
    setBusy(true);
    await onConfirm();
    setBusy(false);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={entry !== null}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-base-200">
            <ProhibitIcon className="size-6 text-base-content/70" />
          </div>
          <DialogTitle>Stop recurring task?</DialogTitle>
          <DialogDescription>
            Future occurrences will stop, but previous checklist history will be
            preserved.
          </DialogDescription>
        </DialogHeader>
        {entry && (
          <p className="rounded-md bg-base-200 px-3 py-2 text-center text-sm">
            “{entry.title}” will stop repeating from{" "}
            <span className="font-medium">
              {format(dateStrToLocalDate(entry.date), "EEEE, MMM d, yyyy")}
            </span>
            .
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Cancel
          </Button>
          <Button className="flex-1" disabled={busy} onClick={confirm}>
            {busy ? "Stopping…" : "Stop recurring"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
