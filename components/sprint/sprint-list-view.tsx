"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArchiveIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  DotsThreeIcon,
  FunnelIcon,
  LightningIcon,
  PencilSimpleIcon,
  PlusIcon,
  RowsIcon,
  SquaresFourIcon,
  TrashIcon,
  TrayIcon,
  XIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import {
  createListStatus,
  getWorkspaceLists,
  updateListStatus,
} from "@/app/actions/list";
import {
  addTaskToSprint,
  bulkMoveTasksToSprint,
  bulkRemoveTasksFromSprint,
  getActiveSprintView,
  getArchivedTasksForSprint,
  getSprints,
} from "@/app/actions/sprint";
import {
  archiveTask,
  bulkArchiveTasks,
  bulkDeleteTasks,
  bulkMoveTasks,
  bulkUpdateStatus,
  createTask,
  reorderTasksById,
  unarchiveTask,
  updateTaskStatus,
} from "@/app/actions/task";
import { SpaceIcon } from "@/components/common/space-icon";
import {
  useRealtimePause,
  useRealtimeRefetch,
} from "@/components/realtime/realtime-provider";
import { CreateTaskModal } from "@/components/task/create-task-modal";
import {
  TaskListRow,
  type TaskListRowProps,
} from "@/components/task/task-list-row";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateTaskShortcut } from "@/hooks/use-create-task-shortcut";
import {
  avatarSrc,
  PRIORITY_CONFIG,
  userInitials,
} from "@/lib/priority-config";
import { STATUS_PRESET_COLORS } from "@/lib/status-colors";
import { setTaskNavContext } from "@/lib/task-nav-context";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Status {
  color: string;
  id: string;
  name: string;
  orderIndex: number;
  type: "OPEN" | "ACTIVE" | "CLOSED";
}

interface SprintTask {
  assignees: { userId: string; name: string; image: string | null }[];
  dueDateEnd: Date | null;
  dueDateStart: Date | null;
  id: string;
  listId: string | null;
  orderIndex: number;
  priority: string | null;
  seqNumber: number;
  statusColor: string | null;
  statusId: string | null;
  statusName: string | null;
  statusType: "OPEN" | "ACTIVE" | "CLOSED" | null;
  tags: { id: string; name: string; color: string }[];
  title: string;
}

interface SprintInfo {
  endDate: Date | null;
  goal: string | null;
  id: string;
  name: string;
  startDate: Date | null;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
}

interface SprintListViewProps {
  canEdit?: boolean;
  isAdmin?: boolean;
  listId?: string;
  members?: { userId: string; name: string | null; email: string | null }[];
  refreshKey?: number;
  spaceId: string;
  statuses?: Status[];
  tags?: { id: string; name: string; color: string }[];
  workspaceId: string;
}

type SprintOption = {
  id: string;
  name: string;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
};
type ListSpaceOption = {
  id: string;
  name: string;
  color: string | null;
  logoEmoji: string | null;
  lists: { id: string; name: string; color: string | null }[];
};

function formatDateRange(start: Date | null, end: Date | null): string {
  const fmt = (d: Date | null) => (d ? format(new Date(d), "M/d") : "—");
  return `${fmt(start)} - ${fmt(end)}`;
}

// ─── Quick create row ─────────────────────────────────────────────────────────

function QuickCreateRow({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  sprintId,
  statusId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  spaceId: string;
  listId?: string;
  sprintId: string;
  statusId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Close the quick-create row when the user clicks anywhere outside of it.
  // This also closes it when another group's "Add Task" is clicked, so only
  // one quick-create row is ever open at a time. An in-flight save is left
  // untouched so the submit isn't interrupted.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(e: PointerEvent) {
      if (saving) {
        return;
      }
      if (wrapperRef.current?.contains(e.target as Node)) {
        return;
      }
      onOpenChange(false);
      setTitle("");
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, saving, onOpenChange]);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const res = await createTask(workspaceId, spaceId, listId || null, {
        title: trimmed,
        statusId,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      await addTaskToSprint(workspaceId, spaceId, sprintId, res.taskId);
      setTitle("");
      onCreated();
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        className="flex w-full items-center gap-2 border-b border-base-300 pl-10 pr-4 py-2 text-sm text-base-content/60 hover:text-base-content hover:bg-base-200/20 transition-colors"
        onClick={() => onOpenChange(true)}
        type="button"
      >
        <PlusIcon className="size-3.5 shrink-0" />
        Add Task
      </button>
    );
  }

  return (
    <div
      className="border-b border-base-300 py-1.5 pl-10 pr-4"
      ref={wrapperRef}
    >
      <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-base-100 px-2 py-1.5 ring-1 ring-primary/20">
        <input
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-base-content/50"
          disabled={saving}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
            if (e.key === "Escape") {
              onOpenChange(false);
              setTitle("");
            }
          }}
          placeholder="Task title…"
          ref={inputRef}
          type="text"
          value={title}
        />
        <button
          className="rounded px-2 py-0.5 text-xs font-medium bg-primary text-primary-content hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
          disabled={saving || !title.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {saving ? "…" : "Add"}
        </button>
        <button
          className="text-xs text-base-content/60 hover:text-base-content shrink-0"
          onClick={() => {
            onOpenChange(false);
            setTitle("");
          }}
          type="button"
        >
          Esc
        </button>
      </div>
    </div>
  );
}

// ─── Sortable row wrapper (list view) ─────────────────────────────────────────

function SortableSprintListRow(
  props: Omit<
    TaskListRowProps,
    "dragRef" | "dragStyle" | "dragProps" | "isDragging"
  >
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.task.id,
    data: { type: "sprint-task", statusId: props.task.statusId },
  });
  return (
    <TaskListRow
      {...props}
      dragProps={{ ...attributes, ...listeners }}
      dragRef={setNodeRef}
      dragStyle={{ transform: CSS.Transform.toString(transform), transition }}
      isDragging={isDragging}
    />
  );
}

// ─── Status group ─────────────────────────────────────────────────────────────

function StatusGroup({
  status,
  tasks,
  workspaceId,
  spaceId,
  listId,
  sprintId,
  statuses,
  isAdmin,
  canEdit,
  selectedIds,
  onSelect,
  onRefresh,
  taskNavIds,
}: {
  status: Status;
  tasks: SprintTask[];
  workspaceId: string;
  spaceId: string;
  listId?: string;
  sprintId: string;
  statuses: Status[];
  isAdmin?: boolean;
  canEdit?: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  onRefresh: () => void;
  taskNavIds: string[];
}) {
  const router = useRouter();
  // Droppable zone so tasks can be dragged into this status group (including
  // when it is empty). Reorder + cross-status persistence is handled by the
  // single parent DndContext, mirroring the project List view.
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: status.id });
  const [collapsed, setCollapsed] = React.useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [newStatusOpen, setNewStatusOpen] = React.useState(false);
  const [renameName, setRenameName] = React.useState(status.name);
  const [newStatusName, setNewStatusName] = React.useState("");
  const [newStatusColor, setNewStatusColor] = React.useState("#6B7280");
  const [saving, setSaving] = React.useState(false);

  async function handleRename() {
    const trimmed = renameName.trim();
    if (!trimmed || trimmed === status.name) {
      setRenameOpen(false);
      return;
    }
    setSaving(true);
    const res = await updateListStatus(
      workspaceId,
      spaceId,
      listId ?? "",
      status.id,
      { name: trimmed }
    );
    setSaving(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setRenameOpen(false);
    onRefresh();
  }

  async function handleCreateStatus() {
    if (!newStatusName.trim()) {
      return;
    }
    setSaving(true);
    const res = await createListStatus(workspaceId, spaceId, listId ?? "", {
      name: newStatusName.trim(),
      color: newStatusColor,
      type: "OPEN",
    });
    setSaving(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setNewStatusName("");
    setNewStatusColor("#6B7280");
    setNewStatusOpen(false);
    onRefresh();
  }

  const allSelected =
    tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id));
  const someSelected = tasks.some((t) => selectedIds.has(t.id));

  function toggleAll() {
    if (allSelected) {
      for (const t of tasks) {
        onSelect(t.id, false);
      }
    } else {
      for (const t of tasks) {
        onSelect(t.id, true);
      }
    }
  }

  return (
    <>
      <div>
        {/* Group header */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: wraps nested interactive controls (menu popover, add-task button) that would double up if this whole row became a button/role=button */}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: see above */}
        <div
          className="group/header flex flex-wrap items-center gap-2.5 py-1.5 px-3 hover:bg-base-200/40 transition-colors cursor-pointer select-none border-b border-base-300"
          onClick={() => setCollapsed((v) => !v)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) {
              return;
            }
            if (e.key === "Enter") {
              setCollapsed((v) => !v);
            }
          }}
        >
          <div className="flex size-5 items-center justify-center rounded hover:bg-base-200 transition-colors shrink-0 text-base-content/60 group-hover/header:text-base-content/70">
            {collapsed ? (
              <CaretRightIcon className="size-3" weight="fill" />
            ) : (
              <CaretDownIcon className="size-3" weight="fill" />
            )}
          </div>

          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider border transition-all"
            style={{
              backgroundColor: `${status.color}12`,
              color: status.color,
              borderColor: `${status.color}25`,
            }}
          >
            <span
              className="size-1.5 rounded-full shrink-0"
              style={{ backgroundColor: status.color }}
            />
            {status.name}
          </span>

          <span className="text-xs text-base-content/60 font-semibold tabular-nums">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>

          {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops the click from bubbling to the header's collapse toggle; nested buttons remain independently keyboard-accessible */}
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: see above */}
          <div
            className="ml-2 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/header:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) {
                return;
              }
              if (e.key === "Enter") {
                e.stopPropagation();
              }
            }}
          >
            <Popover onOpenChange={setMenuOpen} open={menuOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex size-6 items-center justify-center rounded hover:bg-base-200 transition-colors"
                  type="button"
                >
                  <DotsThreeIcon
                    className="size-4.5 text-base-content/60"
                    weight="bold"
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-48 p-1 mt-1"
                side="bottom"
              >
                <p className="px-2 py-1 text-xs font-semibold text-base-content/60">
                  Group options
                </p>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                  onClick={() => {
                    setMenuOpen(false);
                    setRenameName(status.name);
                    setRenameOpen(true);
                  }}
                  type="button"
                >
                  <PencilSimpleIcon className="size-3.5 text-base-content/60 shrink-0" />
                  Rename
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                  onClick={() => {
                    setMenuOpen(false);
                    setNewStatusOpen(true);
                  }}
                  type="button"
                >
                  <PlusIcon className="size-3.5 text-base-content/60 shrink-0" />
                  New status
                </button>
                <div className="h-px bg-base-300 my-1" />
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                  onClick={() => {
                    setCollapsed((v) => !v);
                    setMenuOpen(false);
                  }}
                  type="button"
                >
                  {collapsed ? (
                    <CaretRightIcon className="size-3.5 text-base-content/60 shrink-0" />
                  ) : (
                    <CaretDownIcon className="size-3.5 text-base-content/60 shrink-0" />
                  )}
                  {collapsed ? "Expand group" : "Collapse group"}
                </button>
              </PopoverContent>
            </Popover>
            <button
              className="flex size-6 items-center justify-center rounded hover:bg-base-200 transition-colors"
              onClick={() => {
                setCollapsed(false);
                setQuickCreateOpen(true);
              }}
              type="button"
            >
              <PlusIcon className="size-3.5 text-base-content/60" />
            </button>
          </div>
        </div>

        {/* Expanded: column headers + tasks */}
        {!collapsed && (
          <div className="overflow-x-auto">
            <div className="min-w-160">
              {/* Column headers with select-all */}
              <div className="flex items-center">
                <div className="w-0.75 self-stretch shrink-0" />
                <button
                  className="flex w-14 shrink-0 items-center justify-center py-2 pl-2 cursor-pointer"
                  onClick={toggleAll}
                  type="button"
                >
                  <div
                    className={cn(
                      "flex size-4 items-center justify-center rounded border transition-colors",
                      allSelected
                        ? "border-primary bg-primary text-primary-content"
                        : someSelected
                          ? "border-primary bg-primary/20"
                          : "border-base-300 hover:border-primary/50"
                    )}
                  >
                    {allSelected && (
                      <CheckIcon className="size-2.5" weight="bold" />
                    )}
                    {someSelected && !allSelected && (
                      <div className="size-1.5 rounded-sm bg-primary" />
                    )}
                  </div>
                </button>
                <div className="flex-1 py-2 pr-4 pl-1 text-2xs font-bold text-gray-400 uppercase tracking-wider">
                  Name
                </div>
                <div className="w-36 shrink-0 py-2 px-4 text-2xs font-bold text-gray-400 uppercase tracking-wider text-center">
                  Assignee
                </div>
                <div className="w-28 shrink-0 py-2 px-4 text-2xs font-bold text-gray-400 uppercase tracking-wider">
                  Due date
                </div>
                <div className="w-32 shrink-0 py-2 px-4 text-2xs font-bold text-gray-400 uppercase tracking-wider">
                  Priority
                </div>
                <div className="w-48 shrink-0" />
              </div>

              <SortableContext
                items={tasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  className={cn(
                    "flex flex-col transition-colors min-h-1",
                    isOver && "bg-base-200/20"
                  )}
                  ref={setDropRef}
                >
                  {tasks.map((task) => (
                    <SortableSprintListRow
                      canEdit={canEdit}
                      excludeSprintId={sprintId}
                      isAdmin={isAdmin}
                      key={task.id}
                      onAfterDuplicate={async (newTaskId) => {
                        await addTaskToSprint(
                          workspaceId,
                          spaceId,
                          sprintId,
                          newTaskId
                        );
                      }}
                      onMoveToBacklog={async () => {
                        const res = await bulkRemoveTasksFromSprint(
                          workspaceId,
                          spaceId,
                          sprintId,
                          [task.id]
                        );
                        if ("error" in res) {
                          toast.error(res.error);
                          return;
                        }
                        onRefresh();
                      }}
                      onOpen={() => {
                        setTaskNavContext({ taskIds: taskNavIds });
                        router.push(
                          `/${workspaceId}/task/${task.id}?from=sprint&sid=${sprintId}`
                        );
                      }}
                      onRefresh={onRefresh}
                      onSelect={onSelect}
                      selected={selectedIds.has(task.id)}
                      spaceId={spaceId}
                      statusColor={status.color}
                      statuses={statuses}
                      task={task}
                      workspaceId={workspaceId}
                    />
                  ))}
                </div>
              </SortableContext>

              <QuickCreateRow
                listId={listId}
                onCreated={onRefresh}
                onOpenChange={setQuickCreateOpen}
                open={quickCreateOpen}
                spaceId={spaceId}
                sprintId={sprintId}
                statusId={status.id}
                workspaceId={workspaceId}
              />
            </div>
          </div>
        )}
      </div>

      {/* Rename status dialog */}
      <Dialog onOpenChange={setRenameOpen} open={renameOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Rename status</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleRename();
              }
            }}
            value={renameName}
          />
          <DialogFooter>
            <Button onClick={() => setRenameOpen(false)} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={saving || !renameName.trim()}
              onClick={() => void handleRename()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New status dialog */}
      <Dialog onOpenChange={setNewStatusOpen} open={newStatusOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>New status</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              autoFocus
              onChange={(e) => setNewStatusName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleCreateStatus();
                }
              }}
              placeholder="Status name"
              value={newStatusName}
            />
            <div className="flex flex-wrap gap-2">
              {STATUS_PRESET_COLORS.map((color) => (
                <button
                  className={cn(
                    "size-6 rounded-full border-2 transition-transform",
                    newStatusColor === color
                      ? "border-base-content scale-110"
                      : "border-transparent"
                  )}
                  key={color}
                  onClick={() => setNewStatusColor(color)}
                  style={{ backgroundColor: color }}
                  type="button"
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewStatusOpen(false)} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={saving || !newStatusName.trim()}
              onClick={() => void handleCreateStatus()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────

function BulkActionBar({
  count,
  selectedIds,
  statuses,
  workspaceId,
  spaceId,
  listId,
  currentSprintId,
  isAdmin,
  onClear,
  onRefresh,
}: {
  count: number;
  selectedIds: Set<string>;
  statuses: Status[];
  workspaceId: string;
  spaceId: string;
  listId?: string;
  currentSprintId: string;
  isAdmin?: boolean;
  onClear: () => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [sprints, setSprints] = React.useState<SprintOption[] | null>(null);
  const [loadingSprints, setLoadingSprints] = React.useState(false);
  const [listSpaces, setListSpaces] = React.useState<ListSpaceOption[] | null>(
    null
  );
  const [loadingLists, setLoadingLists] = React.useState(false);

  async function loadSprints() {
    if (sprints !== null) {
      return;
    }
    setLoadingSprints(true);
    const res = await getSprints(workspaceId, spaceId);
    setLoadingSprints(false);
    if ("error" in res) {
      return;
    }
    setSprints(
      res.sprints.filter(
        (s) => s.status !== "CLOSED" && s.id !== currentSprintId
      )
    );
  }

  async function loadLists() {
    if (listSpaces !== null) {
      return;
    }
    setLoadingLists(true);
    const res = await getWorkspaceLists(workspaceId, listId ?? "");
    setLoadingLists(false);
    if ("error" in res) {
      return;
    }
    setListSpaces(res.spaces);
  }

  async function handleMoveToList(
    targetListId: string,
    targetListName: string
  ) {
    setBusy(true);
    const res = await bulkMoveTasks(
      workspaceId,
      spaceId,
      [...selectedIds],
      targetListId
    );
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(
      `Moved ${res.moved} task${res.moved === 1 ? "" : "s"} to ${targetListName}`
    );
    onClear();
    onRefresh();
  }

  async function handleBulkStatus(statusId: string) {
    setBusy(true);
    const res = await bulkUpdateStatus(
      workspaceId,
      spaceId,
      listId ?? "",
      [...selectedIds],
      statusId
    );
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Updated ${count} task${count > 1 ? "s" : ""}`);
    onClear();
    onRefresh();
  }

  async function handleMoveToSprint(sprintId: string, sprintName: string) {
    setBusy(true);
    const res = await bulkMoveTasksToSprint(
      workspaceId,
      spaceId,
      listId ?? null,
      [...selectedIds],
      sprintId
    );
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(
      `Moved ${res.moved} task${res.moved === 1 ? "" : "s"} to ${sprintName}`
    );
    onClear();
    onRefresh();
  }

  async function handleMoveToBacklog() {
    setBusy(true);
    const res = await bulkRemoveTasksFromSprint(
      workspaceId,
      spaceId,
      currentSprintId,
      [...selectedIds]
    );
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Moved ${count} task${count > 1 ? "s" : ""} to backlog`);
    onClear();
    onRefresh();
  }

  async function handleBulkArchive() {
    setBusy(true);
    const res = await bulkArchiveTasks(workspaceId, spaceId, listId ?? "", [
      ...selectedIds,
    ]);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Archived ${count} task${count > 1 ? "s" : ""}`);
    onClear();
    onRefresh();
  }

  async function confirmBulkDelete() {
    setDeleteOpen(false);
    setBusy(true);
    const res = await bulkDeleteTasks(workspaceId, spaceId, listId ?? "", [
      ...selectedIds,
    ]);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Deleted ${count} task${count > 1 ? "s" : ""}`);
    onClear();
    onRefresh();
  }

  return (
    <>
      <Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <DialogContent className="sm:max-w-xs text-center">
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-error/10">
              <TrashIcon className="size-6 text-error" weight="fill" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Delete {count} Task{count > 1 ? "s" : ""}
              </DialogTitle>
              <p className="text-sm text-base-content/60 mt-1">
                The tasks move to Trash. A workspace admin can restore them.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => setDeleteOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={confirmBulkDelete}
              variant="destructive"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <div className="fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white shadow-2xl">
        <span className="font-semibold text-white pr-2 border-r border-white/20 mr-2 shrink-0">
          {count} task{count > 1 ? "s" : ""} selected
        </span>
        <button
          className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-white/10 transition-colors mr-2"
          onClick={onClear}
          type="button"
        >
          <XIcon className="size-3.5 text-white/70" />
        </button>

        {/* Status */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
              disabled={busy}
              type="button"
            >
              <span className="size-2 rounded-full bg-white/60" />
              Status
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-48 p-1 mb-1" side="top">
            {statuses.map((s) => (
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                key={s.id}
                onClick={() => handleBulkStatus(s.id)}
                type="button"
              >
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                {s.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Move (Sprint + List) */}
        <Popover
          onOpenChange={(open) => {
            if (open) {
              void loadSprints();
              void loadLists();
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
              disabled={busy}
              type="button"
            >
              <CaretDownIcon className="size-3.5" />
              Move
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            className="w-56 p-1 mb-1 max-h-72 overflow-y-auto"
            side="top"
          >
            {/* Sprint section */}
            <p className="px-2 py-1 text-xs font-semibold text-base-content/60 uppercase tracking-wide">
              Sprint
            </p>
            {loadingSprints && (
              <p className="px-2 py-1.5 text-xs text-base-content/60">
                Loading…
              </p>
            )}
            {!loadingSprints && sprints?.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-base-content/60">
                No other sprints available
              </p>
            )}
            {!loadingSprints &&
              sprints?.map((s) => (
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                  key={s.id}
                  onClick={() => handleMoveToSprint(s.id, s.name)}
                  type="button"
                >
                  <LightningIcon
                    className={cn(
                      "size-3.5 shrink-0",
                      s.status === "ACTIVE"
                        ? "text-primary"
                        : "text-base-content/60"
                    )}
                    weight="fill"
                  />
                  <span className="flex-1 text-left truncate">{s.name}</span>
                  <span
                    className={cn(
                      "text-2xs font-medium px-1.5 py-0.5 rounded-full shrink-0",
                      s.status === "ACTIVE"
                        ? "bg-primary/10 text-primary"
                        : "bg-base-200 text-base-content/60"
                    )}
                  >
                    {s.status === "ACTIVE" ? "Active" : "Planned"}
                  </span>
                </button>
              ))}

            {/* Divider */}
            <div className="h-px bg-base-300 my-1" />

            {/* List section */}
            <p className="px-2 py-1 text-xs font-semibold text-base-content/60 uppercase tracking-wide">
              List
            </p>
            {loadingLists && (
              <p className="px-2 py-1.5 text-xs text-base-content/60">
                Loading…
              </p>
            )}
            {!loadingLists && listSpaces?.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-base-content/60">
                No other lists available
              </p>
            )}
            {!loadingLists &&
              listSpaces?.map((sp) => (
                <div key={sp.id}>
                  <p className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-base-content/60">
                    <SpaceIcon
                      color={sp.color ?? "#6B7280"}
                      emoji={sp.logoEmoji}
                    />
                    {sp.name}
                  </p>
                  {sp.lists.map((l) => (
                    <button
                      className="flex w-full items-center gap-2 rounded pl-5 pr-2 py-1.5 text-sm hover:bg-base-200"
                      key={l.id}
                      onClick={() => handleMoveToList(l.id, l.name)}
                      type="button"
                    >
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: l.color ?? "#6B7280" }}
                      />
                      <span className="flex-1 text-left truncate">
                        {l.name}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
          </PopoverContent>
        </Popover>

        {/* Move to Backlog */}
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
          disabled={busy}
          onClick={handleMoveToBacklog}
          type="button"
        >
          <TrayIcon className="size-3.5" />
          Backlog
        </button>

        <div className="h-4 w-px shrink-0 bg-white/20 mx-1" />

        {/* Archive */}
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
          disabled={busy}
          onClick={handleBulkArchive}
          type="button"
        >
          <ArchiveIcon className="size-3.5" />
          Archive
        </button>

        {isAdmin && (
          <button
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
            disabled={busy}
            onClick={() => setDeleteOpen(true)}
            type="button"
          >
            <TrashIcon className="size-3.5" />
            Delete
          </button>
        )}
      </div>
    </>
  );
}

// ─── Board sub-components ─────────────────────────────────────────────────────

function SprintBoardCardContent({
  task,
  workspaceId,
  sprintId,
  overlay = false,
  isDragging = false,
  dragListeners,
  taskNavIds = [],
}: {
  task: SprintTask;
  workspaceId: string;
  sprintId: string;
  overlay?: boolean;
  isDragging?: boolean;
  dragListeners?: React.HTMLAttributes<HTMLDivElement>;
  taskNavIds?: string[];
}) {
  const router = useRouter();
  const priority =
    PRIORITY_CONFIG[
      (task.priority ?? "NONE") as keyof typeof PRIORITY_CONFIG
    ] ?? PRIORITY_CONFIG.NONE;

  function handleOpen() {
    if (isDragging || overlay) {
      return;
    }
    setTaskNavContext({ taskIds: taskNavIds });
    router.push(`/${workspaceId}/task/${task.id}?from=sprint&sid=${sprintId}`);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: content includes block-level children (tags, avatars) that aren't valid inside a native <button>; role="button" emulates it instead
    <div
      className={cn(
        "rounded-lg border bg-elevated p-3 shadow-sm",
        isDragging && "opacity-40 shadow-none border-dashed",
        overlay && "shadow-xl rotate-1 cursor-grabbing",
        !isDragging &&
          !overlay &&
          "hover:shadow-md transition-shadow cursor-pointer"
      )}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div
        {...dragListeners}
        className={cn(!overlay && "cursor-grab active:cursor-grabbing")}
      >
        <p className="text-[13px] font-medium text-base-content leading-snug select-none line-clamp-2">
          {task.title}
        </p>
        {task.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {task.tags.map((tag) => (
              <span
                className="rounded-full px-1.5 py-0.5 text-2xs font-medium"
                key={tag.id}
                style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="font-mono text-2xs text-base-content/60 shrink-0">
            #{task.seqNumber}
          </span>
          <div className="flex items-center gap-2 min-w-0">
            {task.priority && task.priority !== "NONE" && (
              <span
                className={cn(
                  "flex items-center gap-1 text-xs font-bold shrink-0",
                  priority.color
                )}
              >
                <span>{priority.icon}</span>
                {priority.label}
              </span>
            )}
            {task.assignees.length > 0 && (
              <div className="flex -space-x-1.5 ml-auto">
                {task.assignees.slice(0, 3).map((a) => (
                  <Avatar
                    className="size-7 border-2 border-base-100"
                    key={a.userId}
                    title={a.name}
                  >
                    {a.image && (
                      <AvatarImage alt={a.name} src={avatarSrc(a.image)} />
                    )}
                    <AvatarFallback className="text-xs font-semibold bg-primary text-primary-content">
                      {userInitials(a.name)}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {task.assignees.length > 3 && (
                  <div className="flex size-7 items-center justify-center rounded-full border-2 border-base-100 bg-base-200 text-xs font-medium text-base-content/60">
                    +{task.assignees.length - 3}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SprintBoardCard({
  task,
  workspaceId,
  sprintId,
  taskNavIds,
}: {
  task: SprintTask;
  workspaceId: string;
  sprintId: string;
  taskNavIds: string[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "task", statusId: task.statusId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <SprintBoardCardContent
        dragListeners={listeners}
        isDragging={isDragging}
        sprintId={sprintId}
        task={task}
        taskNavIds={taskNavIds}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function SprintBoardStaticCard({
  task,
  workspaceId,
  sprintId,
  taskNavIds,
}: {
  task: SprintTask;
  workspaceId: string;
  sprintId: string;
  taskNavIds: string[];
}) {
  return (
    <div className="opacity-80">
      <SprintBoardCardContent
        sprintId={sprintId}
        task={task}
        taskNavIds={taskNavIds}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function SprintBoardColumn({
  status,
  tasks,
  workspaceId,
  sprintId,
  taskNavIds,
}: {
  status: { id: string; name: string; color: string };
  tasks: SprintTask[];
  workspaceId: string;
  sprintId: string;
  taskNavIds: string[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  return (
    <div
      className="flex w-72 shrink-0 flex-col rounded-xl p-2 gap-2 max-h-[calc(100vh-16rem)]"
      style={{ backgroundColor: `${status.color}14` }}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-1 py-1">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: status.color }}
        />
        <span className="flex-1 font-semibold text-sm uppercase tracking-wide text-base-content/80">
          {status.name}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ backgroundColor: `${status.color}22`, color: status.color }}
        >
          {tasks.length}
        </span>
      </div>

      {/* Droppable task list */}
      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          className={cn(
            "flex flex-col gap-2 rounded-lg p-1 transition-all flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-base-300",
            tasks.length === 0 && "min-h-8"
          )}
          ref={setNodeRef}
          style={
            isOver
              ? { boxShadow: `inset 0 0 0 2px ${status.color}` }
              : undefined
          }
        >
          {tasks.map((t) => (
            <SprintBoardCard
              key={t.id}
              sprintId={sprintId}
              task={t}
              taskNavIds={taskNavIds}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function NoStatusColumn({
  tasks,
  workspaceId,
  sprintId,
  taskNavIds,
}: {
  tasks: SprintTask[];
  workspaceId: string;
  sprintId: string;
  taskNavIds: string[];
}) {
  return (
    <div
      className="flex w-72 shrink-0 flex-col rounded-xl p-2 gap-2 max-h-[calc(100vh-16rem)]"
      style={{ backgroundColor: "#94a3b814" }}
    >
      <div className="flex items-center gap-2 px-1 py-1">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-base-content/40 shrink-0" />
        <span className="flex-1 font-semibold text-sm uppercase tracking-wide text-base-content/80">
          No Status
        </span>
        <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-base-200 text-base-content/60">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 rounded-lg p-1 flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-base-300">
        {tasks.map((t) => (
          <SprintBoardStaticCard
            key={t.id}
            sprintId={sprintId}
            task={t}
            taskNavIds={taskNavIds}
            workspaceId={workspaceId}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function SprintListView({
  workspaceId,
  spaceId,
  listId = "",
  statuses = [],
  isAdmin,
  canEdit,
  members = [],
  refreshKey: _refreshKey,
}: SprintListViewProps) {
  const router = useRouter();
  const [sprintInfo, setSprintInfo] = React.useState<SprintInfo | null>(null);
  const [tasks, setTasks] = React.useState<SprintTask[]>([]);
  const [fetchedStatuses, setFetchedStatuses] = React.useState<Status[]>([]);
  // List that new tasks created from the sprint view belong to (so they get a
  // real list + default status instead of landing in "No Status").
  const [createListId, setCreateListId] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const initialLoadedRef = React.useRef(false);
  const [sprintCollapsed, setSprintCollapsed] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  // ── View toggle ───────────────────────────────────────────────────────────
  const [view, setView] = React.useState<"list" | "board">("list");
  const [boardTasks, setBoardTasks] = React.useState<SprintTask[]>([]);
  const [activeDragTask, setActiveDragTask] = React.useState<SprintTask | null>(
    null
  );

  // ── Toolbar state ─────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = React.useState(false);
  // "C" opens the Create Task popup (same as the toolbar button).
  useCreateTaskShortcut(() => setCreateOpen(true), canEdit || isAdmin);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = React.useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = React.useState<string[]>([]);

  const hasActiveFilters =
    statusFilter.length > 0 ||
    priorityFilter.length > 0 ||
    assigneeFilter.length > 0;

  // ── Archived tasks ────────────────────────────────────────────────────────
  const [showArchived, setShowArchived] = React.useState(false);
  const [archivedTasks, setArchivedTasks] = React.useState<
    { id: string; title: string; seqNumber: number; listId: string | null }[]
  >([]);
  const [archivedLoading, setArchivedLoading] = React.useState(false);

  const refreshArchived = React.useCallback(async () => {
    const result = await getArchivedTasksForSprint(workspaceId, spaceId);
    if (!("error" in result)) {
      setArchivedTasks(result.tasks);
    }
  }, [workspaceId, spaceId]);

  async function handleToggleArchived() {
    if (!showArchived && archivedTasks.length === 0) {
      setArchivedLoading(true);
      await refreshArchived();
      setArchivedLoading(false);
    }
    setShowArchived((v) => !v);
  }

  function handleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  const fetchData = React.useCallback(async () => {
    if (!initialLoadedRef.current) {
      setLoading(true);
    }
    try {
      const res = await getActiveSprintView(workspaceId, spaceId);
      if ("error" in res) {
        return;
      }
      setSprintInfo(res.sprint);
      setTasks(res.tasks as SprintTask[]);
      setFetchedStatuses((res.statuses ?? []) as Status[]);
      setCreateListId(res.defaultListId ?? "");
    } finally {
      if (!initialLoadedRef.current) {
        initialLoadedRef.current = true;
        setLoading(false);
      }
    }
  }, [workspaceId, spaceId]);

  React.useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Sync boardTasks when server tasks change
  React.useEffect(() => {
    setBoardTasks(tasks);
  }, [tasks]);

  // ── DnD sensors + handlers ────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Live-sync: re-pull the sprint when another member changes something, and
  // pause auto-refresh while this user is dragging so it can't clobber the drag.
  useRealtimeRefetch(fetchData);
  const pauseRealtime = useRealtimePause();
  const dragResumeRef = React.useRef<null | (() => void)>(null);
  const endDrag = React.useCallback(() => {
    dragResumeRef.current?.();
    dragResumeRef.current = null;
  }, []);

  function onDragStart({ active }: DragStartEvent) {
    endDrag();
    dragResumeRef.current = pauseRealtime();
    setActiveDragTask(boardTasks.find((t) => t.id === active.id) ?? null);
  }

  function onDragCancel() {
    setActiveDragTask(null);
    endDrag();
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) {
      return;
    }
    const activeId = active.id as string;
    const overId = over.id as string;
    if (activeId === overId) {
      return;
    }
    const activeTask = boardTasks.find((t) => t.id === activeId);
    if (!activeTask) {
      return;
    }
    const overStatus =
      effectiveStatuses.find((s) => s.id === overId)?.id ??
      boardTasks.find((t) => t.id === overId)?.statusId;
    if (!overStatus) {
      return;
    }

    if (overStatus === activeTask.statusId) {
      // Same column — reorder positions optimistically
      setBoardTasks((prev) => {
        const oldIndex = prev.findIndex((t) => t.id === activeId);
        const newIndex = prev.findIndex((t) => t.id === overId);
        if (oldIndex === -1 || newIndex === -1) {
          return prev;
        }
        return arrayMove(prev, oldIndex, newIndex);
      });
    } else {
      // Cross-column — move task to new column
      setBoardTasks((prev) =>
        prev.map((t) =>
          t.id === activeId ? { ...t, statusId: overStatus } : t
        )
      );
    }
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setActiveDragTask(null);
    endDrag();
    if (!over) {
      return;
    }
    const activeId = active.id as string;
    const activeTask = boardTasks.find((t) => t.id === activeId);
    if (!activeTask) {
      return;
    }
    const finalStatus = activeTask.statusId;
    const originalStatus = tasks.find((t) => t.id === activeId)?.statusId;

    if (finalStatus === originalStatus) {
      // Same column — persist new card order
      const columnTaskIds = boardTasks
        .filter((t) => t.statusId === finalStatus)
        .map((t) => t.id);
      const originalIds = tasks
        .filter((t) => t.statusId === originalStatus)
        .map((t) => t.id);
      if (columnTaskIds.join(",") === originalIds.join(",")) {
        return;
      }
      const res = await reorderTasksById(workspaceId, spaceId, columnTaskIds);
      if ("error" in res) {
        setBoardTasks(tasks);
        toast.error("Failed to reorder tasks");
      }
    } else {
      // Cross-column — update status
      const res = await updateTaskStatus(
        workspaceId,
        spaceId,
        activeTask.listId,
        activeId,
        finalStatus!
      );
      if ("error" in res) {
        setBoardTasks(tasks);
        toast.error("Failed to update status");
      } else {
        void fetchData();
      }
    }
  }

  // ── Filtered tasks ────────────────────────────────────────────────────────
  // Shared search/filter predicate, applied to both the list grouping and the
  // board grouping (the board uses its own `boardTasks` state for drag-and-drop).
  const matchesFilters = React.useCallback(
    (t: SprintTask) => {
      if (
        searchQuery.trim() &&
        !t.title.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      if (statusFilter.length && !statusFilter.includes(t.statusId ?? "")) {
        return false;
      }
      if (
        priorityFilter.length &&
        !priorityFilter.includes(t.priority ?? "NONE")
      ) {
        return false;
      }
      if (assigneeFilter.length) {
        const hasUnassigned = assigneeFilter.includes("unassigned");
        const userIds = assigneeFilter.filter((a) => a !== "unassigned");
        const assigneeIds = t.assignees.map((a) => a.userId);
        const matchUnassigned = hasUnassigned && assigneeIds.length === 0;
        const matchUser =
          userIds.length > 0 && assigneeIds.some((id) => userIds.includes(id));
        if (!matchUnassigned && !matchUser) {
          return false;
        }
      }
      return true;
    },
    [searchQuery, statusFilter, priorityFilter, assigneeFilter]
  );

  const filteredTasks = React.useMemo(
    () => tasks.filter(matchesFilters),
    [tasks, matchesFilters]
  );

  const effectiveStatuses = React.useMemo(() => {
    if (statuses.length > 0) {
      return statuses;
    }
    if (fetchedStatuses.length > 0) {
      return fetchedStatuses;
    }
    const seen = new Set<string>();
    const derived: Status[] = [];
    for (const t of tasks) {
      if (t.statusId && !seen.has(t.statusId)) {
        seen.add(t.statusId);
        derived.push({
          id: t.statusId,
          name: t.statusName ?? t.statusId,
          color: t.statusColor ?? "#94a3b8",
          type: (t.statusType ?? "OPEN") as "OPEN" | "ACTIVE" | "CLOSED",
          orderIndex: derived.length,
        });
      }
    }
    return derived;
  }, [statuses, fetchedStatuses, tasks]);

  const noStatusListTasks = React.useMemo(() => {
    const knownIds = new Set(effectiveStatuses.map((s) => s.id));
    return filteredTasks.filter(
      (t) => !t.statusId || !knownIds.has(t.statusId)
    );
  }, [effectiveStatuses, filteredTasks]);

  // ── Board grouping ────────────────────────────────────────────────────────
  const boardTasksByStatus = React.useMemo(() => {
    const map = new Map<string, SprintTask[]>();
    for (const s of effectiveStatuses) {
      map.set(s.id, []);
    }
    for (const t of boardTasks) {
      if (!matchesFilters(t)) {
        continue;
      }
      if (t.statusId && map.has(t.statusId)) {
        map.get(t.statusId)!.push(t);
      }
    }
    return map;
  }, [boardTasks, effectiveStatuses, matchesFilters]);

  const noStatusBoardTasks = React.useMemo(
    () => boardTasks.filter((t) => !t.statusId && matchesFilters(t)),
    [boardTasks, matchesFilters]
  );

  // Previous/Next Task nav context: status groups/columns in order, then the
  // "No Status" bucket for whichever mode (list/board) is active — handed to
  // Task Detail so Prev/Next walks it without a DB query.
  const visibleOrderedTaskIds = React.useMemo(() => {
    const grouped = effectiveStatuses.flatMap((s) =>
      (boardTasksByStatus.get(s.id) ?? []).map((t) => t.id)
    );
    const noStatus = (
      view === "list" ? noStatusListTasks : noStatusBoardTasks
    ).map((t) => t.id);
    return [...grouped, ...noStatus];
  }, [
    effectiveStatuses,
    boardTasksByStatus,
    view,
    noStatusListTasks,
    noStatusBoardTasks,
  ]);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-xl border bg-elevated overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-base-200/20">
          <Skeleton className="size-3.5 rounded" />
          <Skeleton className="size-3.5 rounded" />
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-3.5 w-20 rounded" />
          <Skeleton className="ml-auto h-6 w-16 rounded" />
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-base-200/20">
          <Skeleton className="size-3 rounded" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <div className="flex items-center gap-4 border-b border-base-300/60 bg-base-200/40 pl-10 pr-4 py-2">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="ml-auto h-3 w-16 rounded" />
          <Skeleton className="h-3 w-14 rounded" />
          <Skeleton className="h-3 w-14 rounded" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            className="flex items-center gap-3 border-b border-base-300/40 py-2.5 pl-10 pr-3"
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder list, fixed length, never reordered, no data identity
            key={i}
          >
            <Skeleton className="h-4 w-6 rounded" />
            <Skeleton className="h-4 max-w-65 flex-1 rounded" />
            <div className="ml-auto flex items-center gap-6">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-3.5 w-12 rounded" />
              <Skeleton className="h-3.5 w-14 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── No active sprint ──────────────────────────────────────────────────────
  if (!sprintInfo) {
    return (
      <div className="rounded-xl border bg-elevated flex flex-col items-center gap-2 py-16 text-center text-base-content/60">
        <LightningIcon className="size-8 opacity-30" />
        <p className="text-sm font-medium">No active sprint</p>
        <p className="text-xs opacity-70">
          Start a sprint from the Sprints panel above
        </p>
      </div>
    );
  }

  // ── Sprint card ───────────────────────────────────────────────────────────
  return (
    <>
      <CreateTaskModal
        canManage={canEdit || isAdmin}
        listId={createListId || listId || ""}
        onCreated={async (taskId) => {
          if (sprintInfo?.id) {
            await addTaskToSprint(workspaceId, spaceId, sprintInfo.id, taskId);
          }
          void fetchData();
        }}
        onOpenChange={setCreateOpen}
        open={createOpen}
        spaceId={spaceId}
        statuses={effectiveStatuses}
        workspaceId={workspaceId}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-base-300 overflow-hidden">
            {(["list", "board"] as const).map((v) => (
              <button
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer select-none",
                  view === v
                    ? "bg-primary text-primary-content"
                    : "text-base-content/70 hover:bg-base-200/50"
                )}
                key={v}
                onClick={() => setView(v)}
                type="button"
              >
                {v === "list" ? (
                  <RowsIcon className="size-3.5" />
                ) : (
                  <SquaresFourIcon className="size-3.5" />
                )}
                {v === "list" ? "List" : "Board"}
              </button>
            ))}
          </div>

          {/* Search */}
          <SearchInput
            className="w-44 focus:w-56"
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
            placeholder="Search tasks…"
            value={searchQuery}
          />

          {/* Filter Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1.5 h-8 rounded-lg border border-base-300 px-3 text-xs font-semibold text-base-content/70 hover:bg-base-200/50 transition-colors cursor-pointer select-none"
                type="button"
              >
                <FunnelIcon className="size-3.5 text-base-content/60" />
                Filters
                {hasActiveFilters && (
                  <span className="ml-1 size-2 rounded-full bg-primary" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3 space-y-4">
              {/* Status filter */}
              <div>
                <p className="mb-1.5 text-2xs font-bold text-base-content/60 uppercase tracking-wide">
                  Status
                </p>
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                  {effectiveStatuses.map((s) => (
                    <div
                      className="flex items-center gap-2 py-0.5 hover:bg-base-200/50 rounded"
                      key={s.id}
                    >
                      <Checkbox
                        checked={statusFilter.includes(s.id)}
                        id={`status-filter-${s.id}`}
                        onCheckedChange={(checked) => {
                          setStatusFilter((prev) =>
                            checked
                              ? [...prev, s.id]
                              : prev.filter((id) => id !== s.id)
                          );
                        }}
                      />
                      <Label
                        className="truncate text-xs text-base-content/80 cursor-pointer"
                        htmlFor={`status-filter-${s.id}`}
                      >
                        {s.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Priority filter */}
              <div>
                <p className="mb-1.5 text-2xs font-bold text-base-content/60 uppercase tracking-wide">
                  Priority
                </p>
                <div className="flex flex-col gap-1">
                  {["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map((p) => (
                    <div
                      className="flex items-center gap-2 py-0.5 hover:bg-base-200/50 rounded"
                      key={p}
                    >
                      <Checkbox
                        checked={priorityFilter.includes(p)}
                        id={`priority-filter-${p}`}
                        onCheckedChange={(checked) => {
                          setPriorityFilter((prev) =>
                            checked ? [...prev, p] : prev.filter((v) => v !== p)
                          );
                        }}
                      />
                      <Label
                        className="text-xs text-base-content/80 cursor-pointer"
                        htmlFor={`priority-filter-${p}`}
                      >
                        {p === "NONE"
                          ? "No Priority"
                          : p.charAt(0) + p.slice(1).toLowerCase()}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Assignee filter */}
              {members.length > 0 && (
                <div>
                  <p className="mb-1.5 text-2xs font-bold text-base-content/60 uppercase tracking-wide">
                    Assignee
                  </p>
                  <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                    <div className="flex items-center gap-2 py-0.5 hover:bg-base-200/50 rounded">
                      <Checkbox
                        checked={assigneeFilter.includes("unassigned")}
                        id="assignee-filter-unassigned"
                        onCheckedChange={(checked) => {
                          setAssigneeFilter((prev) =>
                            checked
                              ? [...prev, "unassigned"]
                              : prev.filter((v) => v !== "unassigned")
                          );
                        }}
                      />
                      <Label
                        className="text-xs text-base-content/80 cursor-pointer"
                        htmlFor="assignee-filter-unassigned"
                      >
                        Unassigned
                      </Label>
                    </div>
                    {members.map((m) => (
                      <div
                        className="flex items-center gap-2 py-0.5 hover:bg-base-200/50 rounded"
                        key={m.userId}
                      >
                        <Checkbox
                          checked={assigneeFilter.includes(m.userId)}
                          id={`assignee-filter-${m.userId}`}
                          onCheckedChange={(checked) => {
                            setAssigneeFilter((prev) =>
                              checked
                                ? [...prev, m.userId]
                                : prev.filter((id) => id !== m.userId)
                            );
                          }}
                        />
                        <Label
                          className="truncate text-xs text-base-content/80 cursor-pointer"
                          htmlFor={`assignee-filter-${m.userId}`}
                        >
                          {m.name || m.email}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Archived tasks */}
              <div className="border-t border-base-300 pt-3">
                <div className="flex items-center gap-2 py-0.5 hover:bg-base-200/30 rounded">
                  <Checkbox
                    checked={showArchived}
                    id="show-archived-filter"
                    onCheckedChange={() => void handleToggleArchived()}
                  />
                  <Label
                    className="text-xs text-base-content cursor-pointer"
                    htmlFor="show-archived-filter"
                  >
                    Show archived tasks
                  </Label>
                </div>
              </div>

              {/* Clear all */}
              <button
                className="w-full py-1 text-center text-red-500 hover:bg-red-50 rounded text-xs font-semibold transition-colors cursor-pointer"
                onClick={() => {
                  setPriorityFilter([]);
                  setAssigneeFilter([]);
                  setStatusFilter([]);
                }}
                type="button"
              >
                Clear Filters
              </button>
            </PopoverContent>
          </Popover>
        </div>

        {/* Create Task button */}
        <button
          className="flex items-center gap-1.5 h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-content hover:bg-primary/95 transition-all shadow-sm shrink-0 cursor-pointer select-none"
          onClick={() => setCreateOpen(true)}
          type="button"
        >
          <PlusIcon className="size-3.5" weight="bold" />
          Create Task
        </button>
      </div>

      {view === "list" ? (
        <div className="rounded-xl border bg-elevated overflow-hidden">
          {/* Sprint header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b bg-base-200/20">
            <button
              className="flex items-center gap-2 flex-1 text-left min-w-0"
              onClick={() => setSprintCollapsed((v) => !v)}
              type="button"
            >
              {sprintCollapsed ? (
                <CaretRightIcon className="size-3.5 text-base-content/60 shrink-0" />
              ) : (
                <CaretDownIcon className="size-3.5 text-base-content/60 shrink-0" />
              )}
              <LightningIcon
                className="size-3.5 text-primary shrink-0"
                weight="fill"
              />
              <span className="min-w-0 truncate text-sm font-semibold">
                {sprintInfo.name}
              </span>
              <span className="text-xs text-base-content/60 shrink-0">
                ({formatDateRange(sprintInfo.startDate, sprintInfo.endDate)})
              </span>
            </button>
            <Badge
              className={cn(
                "shrink-0 text-xs px-2 py-1 rounded uppercase tracking-wide",
                sprintInfo.status === "ACTIVE" &&
                  "border-primary/30 text-primary bg-primary/10",
                sprintInfo.status === "PLANNED" &&
                  "border-base-300 text-base-content/60 bg-base-200",
                sprintInfo.status === "CLOSED" &&
                  "border-base-300 text-base-content/60 bg-base-200"
              )}
              variant="outline"
            >
              {sprintInfo.status}
            </Badge>
          </div>

          {/* Status groups */}
          {!sprintCollapsed && (
            <div>
              <DndContext
                collisionDetection={closestCenter}
                id="sprint-list-dnd"
                onDragCancel={onDragCancel}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDragStart={onDragStart}
                sensors={sensors}
              >
                {effectiveStatuses.map((status, i) => (
                  <React.Fragment key={status.id}>
                    {i > 0 && <div className="h-2" />}
                    <StatusGroup
                      canEdit={canEdit}
                      isAdmin={isAdmin}
                      listId={listId}
                      onRefresh={fetchData}
                      onSelect={handleSelect}
                      selectedIds={selectedIds}
                      spaceId={spaceId}
                      sprintId={sprintInfo.id}
                      status={status}
                      statuses={effectiveStatuses}
                      taskNavIds={visibleOrderedTaskIds}
                      tasks={boardTasksByStatus.get(status.id) ?? []}
                      workspaceId={workspaceId}
                    />
                  </React.Fragment>
                ))}
              </DndContext>
              {noStatusListTasks.length > 0 && (
                <div>
                  {effectiveStatuses.length > 0 && <div className="h-2" />}
                  <div className="border-b border-base-300 px-3 py-1.5 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider border bg-base-200 text-base-content/60 border-base-300">
                      <span className="size-1.5 rounded-full bg-base-content/40 shrink-0" />
                      No Status
                    </span>
                    <span className="text-xs text-base-content/60 font-semibold tabular-nums">
                      {noStatusListTasks.length}{" "}
                      {noStatusListTasks.length === 1 ? "task" : "tasks"}
                    </span>
                  </div>
                  {noStatusListTasks.map((t) => (
                    <TaskListRow
                      canEdit={canEdit}
                      excludeSprintId={sprintInfo.id}
                      isAdmin={isAdmin}
                      key={t.id}
                      onAfterDuplicate={async (newTaskId) => {
                        await addTaskToSprint(
                          workspaceId,
                          spaceId,
                          sprintInfo.id,
                          newTaskId
                        );
                      }}
                      onMoveToBacklog={async () => {
                        const res = await bulkRemoveTasksFromSprint(
                          workspaceId,
                          spaceId,
                          sprintInfo.id,
                          [t.id]
                        );
                        if ("error" in res) {
                          toast.error(res.error);
                          return;
                        }
                        fetchData();
                      }}
                      onOpen={() => {
                        setTaskNavContext({ taskIds: visibleOrderedTaskIds });
                        router.push(
                          `/${workspaceId}/task/${t.id}?from=sprint&sid=${sprintInfo.id}`
                        );
                      }}
                      onRefresh={fetchData}
                      onSelect={handleSelect}
                      selected={selectedIds.has(t.id)}
                      spaceId={spaceId}
                      statusColor="#94a3b8"
                      statuses={effectiveStatuses}
                      task={t}
                      workspaceId={workspaceId}
                    />
                  ))}
                </div>
              )}

              {/* Archived tasks section */}
              {showArchived && (
                <div className="mt-6 border border-base-300 rounded-xl overflow-hidden bg-base-200/20">
                  <div className="flex items-center gap-2 px-4 py-2 bg-base-200/50 text-xs font-bold text-base-content/60 uppercase tracking-wide border-b border-base-300 select-none">
                    <ArchiveIcon className="size-4" />
                    Archived ({archivedTasks.length})
                  </div>
                  {archivedTasks.length === 0 && (
                    <div className="px-4 py-6 text-center text-xs text-base-content/60 italic">
                      {archivedLoading
                        ? "Loading archived tasks…"
                        : "No archived tasks"}
                    </div>
                  )}
                  <div className="divide-y divide-border">
                    {archivedTasks.map((t) => (
                      <div
                        className="group flex items-center gap-3 px-4 py-2 hover:bg-base-200/30 transition-colors"
                        key={t.id}
                      >
                        <span className="text-2xs text-base-content/60 font-mono shrink-0 select-none">
                          #{t.seqNumber}
                        </span>
                        <span className="flex-1 text-[13px] text-base-content/60 font-medium line-through truncate">
                          {t.title}
                        </span>
                        {canEdit && (
                          <button
                            className="flex items-center gap-1.5 rounded-lg border border-base-300 bg-base-100 px-2.5 py-1 text-2xs font-semibold text-base-content/60 hover:text-base-content transition-colors cursor-pointer select-none sm:hidden sm:group-hover:flex"
                            onClick={async () => {
                              await unarchiveTask(
                                workspaceId,
                                spaceId,
                                t.listId,
                                t.id
                              );
                              await Promise.all([
                                refreshArchived(),
                                fetchData(),
                              ]);
                              toastWithUndo("Task unarchived", async () => {
                                await archiveTask(
                                  workspaceId,
                                  spaceId,
                                  t.listId,
                                  t.id
                                );
                                await Promise.all([
                                  refreshArchived(),
                                  fetchData(),
                                ]);
                              });
                            }}
                            type="button"
                          >
                            <ArchiveIcon className="size-3.5 text-base-content/60" />
                            Unarchive
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <DndContext
          collisionDetection={closestCenter}
          id="sprint-board-dnd"
          onDragCancel={onDragCancel}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDragStart={onDragStart}
          sensors={sensors}
        >
          {/* Sprint header row */}
          <div className="flex items-center gap-2 mb-3 px-1">
            <LightningIcon
              className="size-3.5 shrink-0 text-primary"
              weight="fill"
            />
            <span className="min-w-0 truncate text-sm font-semibold">
              {sprintInfo.name}
            </span>
            <span className="shrink-0 text-xs text-base-content/60">
              ({formatDateRange(sprintInfo.startDate, sprintInfo.endDate)})
            </span>
            <Badge
              className={cn(
                "shrink-0 text-xs px-2 py-1 rounded uppercase tracking-wide",
                sprintInfo.status === "ACTIVE" &&
                  "border-primary/30 text-primary bg-primary/10"
              )}
              variant="outline"
            >
              {sprintInfo.status}
            </Badge>
          </div>

          {/* Columns */}
          <div className="flex gap-3 overflow-x-auto pb-4 items-start">
            {effectiveStatuses.map((status) => (
              <SprintBoardColumn
                key={status.id}
                sprintId={sprintInfo.id}
                status={status}
                taskNavIds={visibleOrderedTaskIds}
                tasks={boardTasksByStatus.get(status.id) ?? []}
                workspaceId={workspaceId}
              />
            ))}
            {noStatusBoardTasks.length > 0 && (
              <NoStatusColumn
                sprintId={sprintInfo.id}
                taskNavIds={visibleOrderedTaskIds}
                tasks={noStatusBoardTasks}
                workspaceId={workspaceId}
              />
            )}
          </div>

          <DragOverlay>
            {activeDragTask && (
              <SprintBoardCardContent
                overlay
                sprintId={sprintInfo.id}
                task={activeDragTask}
                workspaceId={workspaceId}
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          currentSprintId={sprintInfo.id}
          isAdmin={isAdmin}
          listId={listId}
          onClear={() => setSelectedIds(new Set())}
          onRefresh={fetchData}
          selectedIds={selectedIds}
          spaceId={spaceId}
          statuses={effectiveStatuses}
          workspaceId={workspaceId}
        />
      )}
    </>
  );
}
