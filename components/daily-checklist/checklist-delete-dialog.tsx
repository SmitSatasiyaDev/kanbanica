"use client";

import { TrashIcon } from "@phosphor-icons/react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { dateStrToLocalDate } from "@/lib/daily-checklist";

export type DeleteScope = "FUTURE" | "ALL";

interface ChecklistDeleteDialogProps {
  entry: ChecklistEntry | null;
  onConfirm: (scope: DeleteScope) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

export function ChecklistDeleteDialog({
  entry,
  onOpenChange,
  onConfirm,
}: ChecklistDeleteDialogProps) {
  const [scope, setScope] = React.useState<DeleteScope>("FUTURE");
  const [busy, setBusy] = React.useState(false);

  const recurring = entry?.isRecurring ?? false;
  const dayLabel = entry
    ? format(dateStrToLocalDate(entry.date), "MMM d, yyyy")
    : "";

  async function confirm() {
    if (busy) {
      return;
    }
    setBusy(true);
    await onConfirm(recurring ? scope : "ALL");
    setBusy(false);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={entry !== null}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-error/10">
            <TrashIcon className="size-6 text-error" />
          </div>
          <DialogTitle>Delete task?</DialogTitle>
          <DialogDescription>
            {recurring
              ? "This task repeats. Choose what to delete. Nothing is erased from your history."
              : `“${entry?.title}” will be removed from your checklist. Its records are kept, not erased.`}
          </DialogDescription>
        </DialogHeader>

        {recurring && (
          <RadioGroup
            className="gap-3"
            onValueChange={(v) => setScope(v as DeleteScope)}
            value={scope}
          >
            <label
              className="flex cursor-pointer items-start gap-2.5 text-sm text-base-content"
              htmlFor="delete-scope-future"
            >
              <RadioGroupItem id="delete-scope-future" value="FUTURE" />
              <span>
                This and future days
                <span className="block text-xs text-base-content/60">
                  Removes {dayLabel} and every later day. Earlier days and their
                  history stay as they are.
                </span>
              </span>
            </label>
            <label
              className="flex cursor-pointer items-start gap-2.5 text-sm text-base-content"
              htmlFor="delete-scope-all"
            >
              <RadioGroupItem id="delete-scope-all" value="ALL" />
              <span>
                Entire recurring series
                <span className="block text-xs text-base-content/60">
                  Stops the series and removes it from every day, including past
                  days. Its records are kept, not erased.
                </span>
              </span>
            </label>
          </RadioGroup>
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
          <Button
            className="flex-1"
            disabled={busy}
            onClick={confirm}
            variant="destructive"
          >
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
