"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretLeftIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  createChecklistItem,
  deleteChecklistItem,
  getMyChecklist,
  getMyChecklistHistory,
  reorderChecklistItems,
  toggleChecklistItem,
  updateChecklistItem,
} from "@/app/actions/daily-checklist";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LIMITS } from "@/lib/daily-checklist/constants";
import type { ChecklistItemDTO } from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { HistoryWithDateFilter } from "./history-with-date-filter";
import { ItemEditDialog, type ItemEditValues } from "./item-edit-dialog";
import {
  EmptyState,
  formatLongDate,
  PriorityTag,
  ProgressSummary,
  StatusLabel,
} from "./shared";
import { setUrlParams } from "./url-state";
import { useChecklistData } from "./use-checklist-data";

export function MyChecklistPanel({
  workspaceId,
  today,
  initialView,
}: {
  initialView: "today" | "history";
  today: string;
  workspaceId: string;
}) {
  const [sub, setSub] = useState<"today" | "history">(initialView);
  // null = today. A past date opens read-only straight from the saved day.
  const [viewDate, setViewDate] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <Tabs
        onValueChange={(v) => {
          setSub(v as "today" | "history");
          setUrlParams({ view: v });
          setViewDate(null);
        }}
        value={sub}
      >
        <TabsList aria-label="My checklist views">
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
      </Tabs>

      {sub === "today" || viewDate ? (
        <DayView
          onBack={viewDate ? () => setViewDate(null) : undefined}
          viewDate={viewDate}
          workspaceId={workspaceId}
        />
      ) : (
        <HistoryWithDateFilter
          emptyText="No history yet. Past days appear here."
          fetch={(o) => getMyChecklistHistory(workspaceId, o)}
          onOpen={(r) => setViewDate(r.date)}
          today={today}
        />
      )}
    </div>
  );
}

function DayView({
  workspaceId,
  viewDate,
  onBack,
}: {
  onBack?: () => void;
  viewDate: string | null;
  workspaceId: string;
}) {
  const { data, error, loading, reload } = useChecklistData(
    () => getMyChecklist(workspaceId, viewDate ?? undefined),
    [workspaceId, viewDate]
  );
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ChecklistItemDTO | null>(null);
  const [deleting, setDeleting] = useState<ChecklistItemDTO | null>(null);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-error text-sm">
        {error ?? "Could not load checklist"}
      </p>
    );
  }

  const { items, editable } = data;

  async function run(
    p: Promise<{ error: string } | object>,
    fail = "Something went wrong"
  ) {
    const res = await p;
    if ("error" in res) {
      toast.error((res as { error: string }).error || fail);
    }
    await reload(true);
    return res;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) {
      return;
    }
    setAdding(true);
    const res = await createChecklistItem(workspaceId, { title });
    setAdding(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setDraft("");
    await reload(true);
  }

  async function move(index: number, dir: -1 | 1) {
    const ids = items.map((i) => i.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) {
      return;
    }
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await run(reorderChecklistItems(workspaceId, ids));
  }

  async function save(id: string, v: ItemEditValues): Promise<string | null> {
    const res = await updateChecklistItem(workspaceId, id, v);
    if ("error" in res) {
      return res.error;
    }
    await reload(true);
    return null;
  }

  return (
    <section aria-labelledby="cl-day-heading" className="space-y-4">
      {onBack && (
        <Button onClick={onBack} size="sm" variant="ghost">
          <CaretLeftIcon className="size-4" /> Back to history
        </Button>
      )}
      <div>
        <h2 className="font-bold text-xl" id="cl-day-heading">
          {formatLongDate(data.date)}
        </h2>
        {!editable && (
          <p className="text-base-content/60 text-xs">Read-only history</p>
        )}
      </div>
      <ProgressSummary {...data.progress} />

      {editable && (
        <form className="flex gap-2" onSubmit={add}>
          <Input
            aria-label="New checklist item"
            disabled={adding}
            maxLength={LIMITS.title}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add an item and press Enter"
            value={draft}
          />
          <Button disabled={adding || !draft.trim()} type="submit">
            <PlusIcon className="size-4" /> Add item
          </Button>
        </form>
      )}

      {items.length === 0 ? (
        editable ? (
          <EmptyState
            description="Add your first checklist item to get started."
            title="No items for today."
          />
        ) : (
          <EmptyState
            title={
              data.exists
                ? "No items were saved for this day."
                : "No checklist was saved for this day."
            }
          />
        )
      ) : (
        <ul
          className="divide-y divide-base-300 overflow-hidden rounded-xl border border-base-300"
          data-testid="checklist-items"
        >
          {items.map((it, i) => (
            <li className="flex items-start gap-3 px-4 py-3" key={it.id}>
              <Checkbox
                aria-label={`${it.status === "DONE" ? "Mark incomplete" : "Mark complete"}: ${it.title}`}
                checked={it.status === "DONE"}
                className="mt-0.5"
                disabled={!editable}
                onCheckedChange={() =>
                  run(toggleChecklistItem(workspaceId, it.id))
                }
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p
                  className={cn(
                    "break-words text-sm",
                    it.status === "DONE" && "text-base-content/60 line-through"
                  )}
                >
                  {it.title}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base-content/60 text-xs">
                  {it.status === "IN_PROGRESS" && (
                    <StatusLabel status={it.status} />
                  )}
                  <PriorityTag priority={it.priority} />
                  {it.dueTime && <span>Due {it.dueTime}</span>}
                </div>
                {it.notes && (
                  <p className="break-words text-base-content/70 text-xs">
                    {it.notes}
                  </p>
                )}
              </div>
              {editable && (
                <div className="flex shrink-0 items-center">
                  <Button
                    aria-label={`Move up: ${it.title}`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    aria-label={`Move down: ${it.title}`}
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    aria-label={`Edit: ${it.title}`}
                    onClick={() => setEditing(it)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <PencilSimpleIcon />
                  </Button>
                  <Button
                    aria-label={`Delete: ${it.title}`}
                    onClick={() => setDeleting(it)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <TrashIcon />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ItemEditDialog
        item={editing}
        onClose={() => setEditing(null)}
        onSave={save}
      />

      <Dialog
        onOpenChange={(o) => !o && setDeleting(null)}
        open={deleting !== null}
      >
        <DialogContent className="rounded-xl sm:max-w-sm">
          <DialogHeader className="items-center text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-error/10">
              <TrashIcon className="size-6 text-error" />
            </div>
            <DialogTitle>Delete item?</DialogTitle>
            <DialogDescription>
              “{deleting?.title}” will be removed from today's checklist.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => setDeleting(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={async () => {
                if (deleting) {
                  await run(deleteChecklistItem(workspaceId, deleting.id));
                }
                setDeleting(null);
              }}
              variant="destructive"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
