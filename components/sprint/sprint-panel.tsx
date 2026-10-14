"use client";

import {
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  LightningIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  addTaskToSprint,
  deleteSprint,
  getBacklogTasks,
  getDefaultListForSprint,
  getSprintSettings,
  getSprints,
  getSprintWithTasks,
  startSprint,
} from "@/app/actions/sprint";
import { createTask } from "@/app/actions/task";
import { useToday } from "@/components/common/timezone-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { daysBetween, formatDay } from "@/lib/due-date";
import { AddTasksToSprintModal } from "./add-tasks-to-sprint-modal";
import { CloseSprintModal } from "./close-sprint-modal";
import { CreateSprintModal } from "./create-sprint-modal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SprintRow {
  createdAt: Date;
  endDate: string | null;
  goal: string | null;
  id: string;
  name: string;
  startDate: string | null;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
}

interface SprintProgress {
  closed: number;
  total: number;
}

interface SprintPanelProps {
  listId?: string;
  onDataChanged?: () => void;
  spaceId: string;
  workspaceId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: string | null): string {
  return date ? formatDay(date) : "—";
}

// Sprint dates are calendar days; `today` is the viewer's (useToday()).
function getDaysRemaining(
  endDate: string | null,
  today: string
): number | null {
  return endDate ? daysBetween(today, endDate) : null;
}

// ─── Inline create task input ─────────────────────────────────────────────────

function QuickCreateSprintTask({
  workspaceId,
  spaceId,
  sprintId,
  onCreated,
}: {
  workspaceId: string;
  spaceId: string;
  sprintId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function show() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancel() {
    setOpen(false);
    setTitle("");
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      const listRes = await getDefaultListForSprint(
        workspaceId,
        spaceId,
        sprintId
      );
      const defaultListId = "error" in listRes ? null : listRes.listId;
      const res = await createTask(workspaceId, spaceId, defaultListId, {
        title: trimmed,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const sprintRes = await addTaskToSprint(
        workspaceId,
        spaceId,
        sprintId,
        res.taskId
      );
      if ("error" in sprintRes) {
        toast.error(sprintRes.error);
        return;
      }
      setTitle("");
      onCreated();
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      toast.error("Something went wrong creating the task.");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape") {
      cancel();
    }
  }

  if (!open) {
    return (
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-base-content/60 hover:text-base-content hover:bg-base-200/40 transition-colors"
        onClick={show}
        type="button"
      >
        <PlusIcon className="size-3.5 shrink-0" />
        Create task
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-base-100 px-2 py-1.5 ring-1 ring-primary/20">
      <input
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-base-content/50 disabled:opacity-50"
        disabled={saving}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Task title…"
        ref={inputRef}
        type="text"
        value={title}
      />
      <div className="flex items-center gap-1 shrink-0">
        <button
          className="rounded px-2 py-0.5 text-xs font-medium bg-primary text-primary-content hover:bg-primary/90 disabled:opacity-40 transition-colors"
          disabled={saving || !title.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {saving ? "…" : "Add"}
        </button>
        <button
          className="rounded px-1.5 py-0.5 text-xs text-base-content/60 hover:text-base-content transition-colors"
          disabled={saving}
          onClick={cancel}
          type="button"
        >
          Esc
        </button>
      </div>
    </div>
  );
}

// ─── Active Sprint Card ───────────────────────────────────────────────────────

function ActiveSprintCard({
  sprint,
  progress,
  workspaceId,
  spaceId,
  listId,
  onClose,
  onAddTasks,
  onRefresh,
}: {
  sprint: SprintRow;
  progress: SprintProgress | null;
  workspaceId: string;
  spaceId: string;
  listId: string;
  onClose: () => void;
  onAddTasks: () => void;
  onRefresh: () => void;
}) {
  const today = useToday();
  const daysRemaining = getDaysRemaining(sprint.endDate, today);
  const isOverdue = daysRemaining !== null && daysRemaining < 0;
  const percent =
    progress && progress.total > 0
      ? Math.round((progress.closed / progress.total) * 100)
      : 0;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <LightningIcon
            className="size-4 text-primary shrink-0 mt-0.5"
            weight="fill"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{sprint.name}</p>
            {sprint.goal && (
              <p className="text-xs text-base-content/60 line-clamp-1 mt-0.5">
                {sprint.goal}
              </p>
            )}
          </div>
        </div>
        <Badge
          className="shrink-0 border-primary/30 text-primary bg-primary/10 text-xs px-2 py-1 rounded"
          variant="outline"
        >
          Active
        </Badge>
      </div>

      {progress && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-base-content/60">
              {progress.closed}/{progress.total} tasks
            </span>
            <span className="font-medium">{percent}%</span>
          </div>
          <Progress className="h-1.5" value={percent} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          <CalendarBlankIcon className="size-3 text-base-content/60" />
          {daysRemaining === null ? null : isOverdue ? (
            <span className="text-error font-medium">
              Overdue by {Math.abs(daysRemaining)}{" "}
              {Math.abs(daysRemaining) === 1 ? "day" : "days"}
            </span>
          ) : (
            <span className="text-base-content/60">
              {daysRemaining === 0
                ? "Ends today"
                : `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {listId && (
            <Button
              className="h-7 text-xs"
              onClick={onAddTasks}
              size="sm"
              variant="ghost"
            >
              <PlusIcon className="size-3 mr-1" />
              Add tasks
            </Button>
          )}
          <Button
            className="h-7 text-xs"
            onClick={onClose}
            size="sm"
            variant="outline"
          >
            Close Sprint
          </Button>
        </div>
      </div>

      {/* Inline create task */}
      <QuickCreateSprintTask
        onCreated={onRefresh}
        spaceId={spaceId}
        sprintId={sprint.id}
        workspaceId={workspaceId}
      />
    </div>
  );
}

// ─── Planned Sprint Row ───────────────────────────────────────────────────────

function PlannedSprintRow({
  sprint,
  hasActiveSprint,
  workspaceId,
  spaceId,
  listId,
  onStart,
  onDelete,
  onAddTasks,
  onRefresh,
}: {
  sprint: SprintRow;
  hasActiveSprint: boolean;
  workspaceId: string;
  spaceId: string;
  listId: string;
  onStart: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddTasks: (id: string) => void;
  onRefresh: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await onDelete(sprint.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="rounded-md border bg-elevated group">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{sprint.name}</p>
            <p className="text-xs text-base-content/60">
              {sprint.startDate
                ? `Starts ${formatDate(sprint.startDate)}`
                : "No start date"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              className="hidden items-center gap-1 text-xs text-base-content/60 hover:text-base-content transition-colors opacity-0 group-hover:opacity-100 px-1 sm:flex"
              onClick={() => setExpanded((v) => !v)}
              type="button"
            >
              <PlusIcon className="size-3" />
              New task
            </button>
            {listId && (
              <button
                className="hidden items-center gap-1 text-xs text-base-content/60 hover:text-base-content transition-colors opacity-0 group-hover:opacity-100 px-1 sm:flex"
                onClick={() => onAddTasks(sprint.id)}
                type="button"
              >
                Add tasks
              </button>
            )}
            {!hasActiveSprint && (
              <Button
                className="h-7 text-xs"
                disabled={starting || deleting}
                onClick={async () => {
                  setStarting(true);
                  try {
                    await onStart(sprint.id);
                  } finally {
                    setStarting(false);
                  }
                }}
                size="sm"
                variant="outline"
              >
                {starting ? "Starting…" : "Start Sprint"}
              </Button>
            )}
            <button
              aria-label="Delete sprint"
              className="flex size-7 items-center justify-center rounded-md text-base-content/60 opacity-100 transition-all hover:bg-error/10 hover:text-error disabled:opacity-30 sm:opacity-0 sm:group-hover:opacity-100"
              disabled={deleting || starting}
              onClick={() => setConfirmDelete(true)}
              type="button"
            >
              <TrashIcon className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Inline create task — shown when "New task" is clicked */}
        {expanded && (
          <div className="px-3 pb-3">
            <QuickCreateSprintTask
              onCreated={() => {
                onRefresh();
              }}
              spaceId={spaceId}
              sprintId={sprint.id}
              workspaceId={workspaceId}
            />
          </div>
        )}
      </div>

      <AlertDialog onOpenChange={setConfirmDelete} open={confirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete sprint?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{sprint.name}</strong> will be permanently deleted. Tasks
              in this sprint will not be deleted — they will return to the
              backlog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-error text-error-content hover:bg-error/90"
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function SprintPanel({
  workspaceId,
  spaceId,
  listId,
  onDataChanged,
}: SprintPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [sprints, setSprints] = useState<SprintRow[]>([]);
  const [progressMap, setProgressMap] = useState<
    Record<string, SprintProgress>
  >({});
  const [backlogCount, setBacklogCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<SprintRow | null>(null);
  const [addTasksTarget, setAddTasksTarget] = useState<SprintRow | null>(null);
  const [closedExpanded, setClosedExpanded] = useState(false);

  function openSprintSettings() {
    router.push(`/${workspaceId}/${spaceId}/settings/sprints`);
  }

  async function handleCreateClick() {
    const settings = await getSprintSettings(workspaceId, spaceId);
    if ("error" in settings || settings.sprintStartDay === null) {
      openSprintSettings();
    } else {
      setCreateOpen(true);
    }
  }

  const activeSprints = sprints.filter((s) => s.status === "ACTIVE");
  const plannedSprints = sprints.filter((s) => s.status === "PLANNED");
  const closedSprints = sprints.filter((s) => s.status === "CLOSED");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sprintsResult = await getSprints(workspaceId, spaceId);
      const backlogResult = await getBacklogTasks(workspaceId, spaceId);

      if ("error" in sprintsResult) {
        throw new Error(sprintsResult.error);
      }
      if ("error" in backlogResult) {
        throw new Error(backlogResult.error);
      }

      const rows = sprintsResult.sprints ?? [];
      setSprints(rows);
      setBacklogCount(
        backlogResult.lists.reduce((sum, l) => sum + l.tasks.length, 0)
      );

      const activeRows = rows.filter((s) => s.status === "ACTIVE");
      if (activeRows.length > 0) {
        const progressResults = await Promise.all(
          activeRows.map((s) => getSprintWithTasks(workspaceId, spaceId, s.id))
        );
        const map: Record<string, SprintProgress> = {};
        for (let i = 0; i < activeRows.length; i++) {
          const res = progressResults[i];
          if ("tasks" in res) {
            const closed = res.tasks.filter(
              (t) => t.statusType === "CLOSED"
            ).length;
            map[activeRows[i].id] = { total: res.tasks.length, closed };
          }
        }
        setProgressMap(map);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sprints.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, spaceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function refresh() {
    void fetchData();
    onDataChanged?.();
  }

  async function handleStartSprint(sprintId: string) {
    const result = await startSprint(workspaceId, spaceId, sprintId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    refresh();
  }

  async function handleDeleteSprint(sprintId: string) {
    const result = await deleteSprint(workspaceId, spaceId, sprintId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // If we're currently viewing the sprint we just deleted, its page loader
    // would notFound() on refresh — navigate to the workspace home instead.
    if (pathname === `/${workspaceId}/${spaceId}/sprint/${sprintId}`) {
      router.push(`/${workspaceId}`);
      return;
    }
    refresh();
  }

  return (
    <>
      <CreateSprintModal
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
        onOpenChange={setCreateOpen}
        onOpenSettings={openSprintSettings}
        open={createOpen}
        spaceId={spaceId}
        workspaceId={workspaceId}
      />
      {addTasksTarget && listId && (
        <AddTasksToSprintModal
          listId={listId}
          onAdded={() => {
            setAddTasksTarget(null);
            refresh();
          }}
          onOpenChange={(open) => {
            if (!open) {
              setAddTasksTarget(null);
            }
          }}
          open={true}
          spaceId={spaceId}
          sprintId={addTasksTarget.id}
          sprintName={addTasksTarget.name}
          workspaceId={workspaceId}
        />
      )}
      {closeTarget && (
        <CloseSprintModal
          listId={listId ?? ""}
          onClosed={() => {
            setCloseTarget(null);
            refresh();
          }}
          onOpenChange={(open) => {
            if (!open) {
              setCloseTarget(null);
            }
          }}
          open={true}
          spaceId={spaceId}
          sprintId={closeTarget.id}
          sprintName={closeTarget.name}
          workspaceId={workspaceId}
        />
      )}

      <div className="rounded-lg border bg-elevated">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-lg hover:bg-base-200/50 transition-colors">
          <button
            className="flex flex-1 items-center gap-2 text-left min-w-0"
            onClick={() => setExpanded((v) => !v)}
            type="button"
          >
            {expanded ? (
              <CaretDownIcon className="size-3.5 text-base-content/60 shrink-0" />
            ) : (
              <CaretRightIcon className="size-3.5 text-base-content/60 shrink-0" />
            )}
            <TargetIcon className="size-4 text-base-content/60 shrink-0" />
            <span className="text-sm font-medium">Sprints</span>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            {activeSprints.length > 0 && (
              <Badge
                className="border-primary/30 text-primary bg-primary/10 text-xs px-2 py-1 rounded"
                variant="outline"
              >
                {activeSprints.length} Active
              </Badge>
            )}
            {plannedSprints.length > 0 && (
              <Badge
                className="border-base-300 text-base-content/60 bg-base-200 text-xs px-2 py-1 rounded"
                variant="outline"
              >
                {plannedSprints.length} Planned
              </Badge>
            )}
            <button
              className="flex items-center gap-1 text-xs text-base-content/60 hover:text-base-content transition-colors px-1"
              onClick={handleCreateClick}
              type="button"
            >
              <PlusIcon className="size-3.5" />
              Create Sprint
            </button>
          </div>
        </div>

        {expanded && (
          <div className="px-4 pb-4 space-y-3">
            {error && (
              <p className="rounded-md bg-error/10 px-3 py-2 text-xs text-error">
                {error}
              </p>
            )}

            {loading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div
                    className="h-12 rounded-md bg-base-200 animate-pulse"
                    key={i}
                  />
                ))}
              </div>
            ) : (
              <>
                {activeSprints.length > 0 && (
                  <div className="space-y-2">
                    {activeSprints.map((s) => (
                      <ActiveSprintCard
                        key={s.id}
                        listId={listId ?? ""}
                        onAddTasks={() => setAddTasksTarget(s)}
                        onClose={() => setCloseTarget(s)}
                        onRefresh={refresh}
                        progress={progressMap[s.id] ?? null}
                        spaceId={spaceId}
                        sprint={s}
                        workspaceId={workspaceId}
                      />
                    ))}
                  </div>
                )}

                {plannedSprints.length > 0 && (
                  <div className="space-y-1.5">
                    {activeSprints.length > 0 && (
                      <p className="text-xs font-medium text-base-content/60 px-1">
                        Planned
                      </p>
                    )}
                    {plannedSprints.map((s) => (
                      <PlannedSprintRow
                        hasActiveSprint={activeSprints.length > 0}
                        key={s.id}
                        listId={listId ?? ""}
                        onAddTasks={(id) =>
                          setAddTasksTarget(
                            sprints.find((sp) => sp.id === id) ?? null
                          )
                        }
                        onDelete={handleDeleteSprint}
                        onRefresh={refresh}
                        onStart={handleStartSprint}
                        spaceId={spaceId}
                        sprint={s}
                        workspaceId={workspaceId}
                      />
                    ))}
                  </div>
                )}

                {sprints.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <TargetIcon className="size-8 text-base-content/40" />
                    <p className="text-sm text-base-content/60">
                      No sprints yet
                    </p>
                    <p className="text-xs text-base-content/70">
                      Create a sprint to start organizing work into iterations
                    </p>
                  </div>
                )}

                {sprints.length > 0 && <div className="h-px bg-base-300" />}

                <div className="flex items-center gap-1.5 px-1 text-xs text-base-content/60">
                  <span className="font-medium">Backlog</span>
                  <Badge className="text-xs h-5 px-1.5" variant="secondary">
                    {backlogCount}
                  </Badge>
                </div>

                {closedSprints.length > 0 && (
                  <div className="space-y-1">
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-xs text-base-content/60 hover:text-base-content hover:bg-base-200/40 transition-colors"
                      onClick={() => setClosedExpanded((v) => !v)}
                      type="button"
                    >
                      {closedExpanded ? (
                        <CaretDownIcon className="size-3 shrink-0" />
                      ) : (
                        <CaretRightIcon className="size-3 shrink-0" />
                      )}
                      <ClockCounterClockwiseIcon className="size-3.5 shrink-0" />
                      <span className="font-medium">Past Sprints</span>
                      <Badge
                        className="text-xs h-4 px-1 ml-auto"
                        variant="secondary"
                      >
                        {closedSprints.length}
                      </Badge>
                    </button>

                    {closedExpanded && (
                      <div className="space-y-0.5 pl-1">
                        {closedSprints.map((s) => (
                          <button
                            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-base-200/50 transition-colors group/closed"
                            key={s.id}
                            onClick={() =>
                              router.push(
                                `/${workspaceId}/${spaceId}/sprint/${s.id}`
                              )
                            }
                            type="button"
                          >
                            <CheckCircleIcon
                              className="size-3.5 shrink-0 text-green-500"
                              weight="fill"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">
                                {s.name}
                              </p>
                              {(s.startDate || s.endDate) && (
                                <p className="text-[11px] text-base-content/70 truncate">
                                  {s.startDate ? formatDay(s.startDate) : "—"}
                                  {" → "}
                                  {s.endDate ? formatDay(s.endDate) : "—"}
                                </p>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
