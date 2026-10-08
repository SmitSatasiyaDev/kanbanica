"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CHECKLIST_PRIORITIES,
  CHECKLIST_STATUSES,
  type ChecklistPriority,
  type ChecklistStatus,
  LIMITS,
  STATUS_LABEL,
} from "@/lib/daily-checklist/constants";
import type { ChecklistItemDTO } from "@/lib/daily-checklist/types";
import { PRIORITY_CONFIG } from "@/lib/priority-config";

export interface ItemEditValues {
  dueTime: string | null;
  notes: string | null;
  priority: ChecklistPriority;
  status: ChecklistStatus;
  title: string;
}

export function ItemEditDialog({
  item,
  onClose,
  onSave,
}: {
  item: ChecklistItemDTO | null;
  onClose: () => void;
  onSave: (id: string, values: ItemEditValues) => Promise<string | null>;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<ChecklistPriority>("NONE");
  const [status, setStatus] = useState<ChecklistStatus>("PENDING");
  const [dueTime, setDueTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setTitle(item.title);
      setNotes(item.notes ?? "");
      setPriority(item.priority);
      setStatus(item.status);
      setDueTime(item.dueTime ?? "");
      setError(null);
    }
  }, [item]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) {
      return;
    }
    setBusy(true);
    const err = await onSave(item.id, {
      title,
      notes: notes.trim() || null,
      priority,
      status,
      dueTime: dueTime || null,
    });
    setBusy(false);
    if (err) {
      setError(err);
    } else {
      onClose();
    }
  }

  return (
    <Dialog onOpenChange={(o) => !o && onClose()} open={item !== null}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Edit item</DialogTitle>
            <DialogDescription>
              Priority, due time and notes are optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cl-title">Title</Label>
            <Input
              id="cl-title"
              maxLength={LIMITS.title}
              onChange={(e) => setTitle(e.target.value)}
              required
              value={title}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                onValueChange={(v) => setStatus(v as ChecklistStatus)}
                value={status}
              >
                <SelectTrigger aria-label="Status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="p-1.5">
                  {CHECKLIST_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                onValueChange={(v) => setPriority(v as ChecklistPriority)}
                value={priority}
              >
                <SelectTrigger aria-label="Priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="p-1.5">
                  {CHECKLIST_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_CONFIG[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-due">Due time</Label>
            <Input
              id="cl-due"
              onChange={(e) => setDueTime(e.target.value)}
              type="time"
              value={dueTime}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-notes">Notes</Label>
            <Textarea
              id="cl-notes"
              maxLength={LIMITS.text}
              onChange={(e) => setNotes(e.target.value)}
              value={notes}
            />
          </div>
          {error && (
            <p className="text-error text-sm" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={busy || !title.trim()} type="submit">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
