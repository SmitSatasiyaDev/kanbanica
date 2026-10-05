"use client";

import { ArrowCounterClockwiseIcon, TrashIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type DeletedTaskRow,
  emptyTrash,
  permanentlyDeleteTasks,
  restoreDeletedTasks,
} from "@/app/actions/trash";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TrashListProps {
  tasks: DeletedTaskRow[];
  workspaceId: string;
}

type Confirm = { kind: "purge" } | { kind: "empty" } | null;

export function TrashList({ workspaceId, tasks }: TrashListProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm>(null);

  const allSelected = tasks.length > 0 && selected.size === tasks.length;
  const ids = [...selected];

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function run(
    fn: () => Promise<{ error: string } | { ok: true; failed?: number }>,
    success: string
  ) {
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      if ("failed" in res && res.failed) {
        toast.warning(
          `${res.failed} task${res.failed === 1 ? "" : "s"} couldn't be deleted (file cleanup failed) and stay in Trash.`
        );
      } else {
        toast.success(success);
      }
      setSelected(new Set());
      setConfirm(null);
      router.refresh();
    });
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-base-300 bg-elevated p-10 text-center">
        <TrashIcon className="size-8 text-base-content/40" />
        <p className="font-medium text-sm">Trash is empty</p>
        <p className="text-base-content/60 text-sm">
          Tasks you delete will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base-content/60 text-sm">
          {selected.size > 0
            ? `${selected.size} selected`
            : `${tasks.length} deleted task${tasks.length === 1 ? "" : "s"}`}
        </p>
        <div className="flex gap-2">
          <Button
            disabled={pending || selected.size === 0}
            onClick={() =>
              run(() => restoreDeletedTasks(workspaceId, ids), "Restored")
            }
            size="sm"
            variant="outline"
          >
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
            Restore
          </Button>
          <Button
            disabled={pending || selected.size === 0}
            onClick={() => setConfirm({ kind: "purge" })}
            size="sm"
            variant="destructive"
          >
            Delete forever
          </Button>
          <Button
            disabled={pending}
            onClick={() => setConfirm({ kind: "empty" })}
            size="sm"
            variant="ghost"
          >
            Empty trash
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-base-300 bg-elevated">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all"
                  checked={allSelected}
                  onCheckedChange={(v) =>
                    setSelected(
                      v === true ? new Set(tasks.map((t) => t.id)) : new Set()
                    )
                  }
                />
              </TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Deleted</TableHead>
              <TableHead>Purges in</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${t.title}`}
                    checked={selected.has(t.id)}
                    onCheckedChange={() => toggle(t.id)}
                  />
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <p className="truncate font-medium">{t.title}</p>
                  <p className="text-base-content/60 text-xs">
                    #{t.seqNumber}
                    {t.subtaskCount > 0
                      ? ` · ${t.subtaskCount} subtask${t.subtaskCount === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </TableCell>
                <TableCell className="text-base-content/60">
                  {[t.spaceName, t.listName].filter(Boolean).join(" / ") || "—"}
                </TableCell>
                <TableCell className="text-base-content/60">
                  <p>{new Date(t.deletedAt).toLocaleDateString()}</p>
                  {t.deletedByName ? (
                    <p className="text-xs">by {t.deletedByName}</p>
                  ) : null}
                </TableCell>
                <TableCell className="text-base-content/60">
                  {t.daysRemaining > 0
                    ? `${t.daysRemaining}d`
                    : "Pending purge"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => restoreDeletedTasks(workspaceId, [t.id]),
                        "Restored"
                      )
                    }
                    size="xs"
                    variant="outline"
                  >
                    Restore
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
          }
        }}
        open={confirm !== null}
      >
        <DialogContent className="sm:max-w-xs text-center">
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-error/10">
              <TrashIcon className="size-6 text-error" weight="fill" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                {confirm?.kind === "empty"
                  ? "Empty trash?"
                  : `Delete ${selected.size} task${selected.size === 1 ? "" : "s"} forever?`}
              </DialogTitle>
              <p className="mt-1 text-base-content/60 text-sm">
                This permanently removes the task
                {confirm?.kind === "purge" && selected.size === 1 ? "" : "s"},
                comments, files and history. This cannot be undone.
              </p>
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() => setConfirm(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() =>
                confirm?.kind === "empty"
                  ? run(() => emptyTrash(workspaceId), "Trash emptied")
                  : run(
                      () => permanentlyDeleteTasks(workspaceId, ids),
                      "Deleted permanently"
                    )
              }
              variant="destructive"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
