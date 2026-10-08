"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateTeamChecklistItem } from "@/app/actions/daily-checklist";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/lib/daily-checklist/constants";

/** Optional note on a team checklist item — stored in `daily_checklist_item.notes`. */
export function ItemNoteDialog({
  workspaceId,
  itemId,
  title,
  notes,
  editable,
  onClose,
  onSaved,
}: {
  editable: boolean;
  itemId: string | null;
  notes: string | null;
  onClose: () => void;
  onSaved: () => void;
  title: string;
  workspaceId: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (itemId) {
      setValue(notes ?? "");
    }
  }, [itemId, notes]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId) {
      return;
    }
    setBusy(true);
    const res = await updateTeamChecklistItem(workspaceId, itemId, {
      notes: value,
    });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success("Note saved");
    onSaved();
    onClose();
  }

  return (
    <Dialog onOpenChange={(o) => !o && onClose()} open={itemId !== null}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <form className="space-y-4" onSubmit={save}>
          <DialogHeader>
            <DialogTitle className="break-words">{title}</DialogTitle>
            <DialogDescription>
              {editable ? "Add a note" : "Read-only."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Note"
            className="min-h-24"
            maxLength={LIMITS.text}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Waiting for customer response..."
            readOnly={!editable}
            value={value}
          />
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              {editable ? "Cancel" : "Close"}
            </Button>
            {editable && (
              <Button disabled={busy} type="submit">
                Save
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
