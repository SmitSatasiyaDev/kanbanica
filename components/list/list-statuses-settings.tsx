"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  restrictToVerticalAxis,
  restrictToWindowEdges,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DotsSixVerticalIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import {
  createListStatus,
  deleteListStatus,
  getListStatuses,
  reorderListStatuses,
  updateListStatus,
} from "@/app/actions/list";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DASHBOARD_CATEGORY_OPTIONS,
  type DashboardCategory,
} from "@/lib/dashboard-category";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR_OPTIONS = [
  "#6B7280",
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#14B8A6",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F43F5E",
];

const DEFAULT_COLORS: Record<StatusType, string> = {
  OPEN: "#6B7280",
  ACTIVE: "#3B82F6",
  CLOSED: "#22C55E",
};

type StatusType = "OPEN" | "ACTIVE" | "CLOSED";

const GROUPS: { type: StatusType; label: string; accent: string }[] = [
  { type: "OPEN", label: "Not started", accent: "text-base-content/60" },
  { type: "ACTIVE", label: "Active", accent: "text-blue-500" },
  { type: "CLOSED", label: "Closed", accent: "text-green-600" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Status {
  color: string;
  dashboardCategory: DashboardCategory;
  id: string;
  name: string;
  orderIndex: number;
  type: StatusType;
}

interface ListStatusesSettingsProps {
  initialStatuses: Status[];
  listId: string;
  onStatusesChange?: (statuses: Status[]) => void;
  spaceId: string;
  workspaceId: string;
}

// ─── Add Row ──────────────────────────────────────────────────────────────────

function AddRow({
  type,
  workspaceId,
  spaceId,
  listId,
  onDone,
}: {
  type: StatusType;
  workspaceId: string;
  spaceId: string;
  listId: string;
  onDone: () => void;
}) {
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(DEFAULT_COLORS[type]);
  const [dashboardCategory, setDashboardCategory] =
    React.useState<DashboardCategory>("OPEN");
  const [colorOpen, setColorOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function save() {
    if (!name.trim()) {
      setError("Name required");
      return;
    }
    setLoading(true);
    const res = await createListStatus(workspaceId, spaceId, listId, {
      name: name.trim(),
      color,
      type,
      dashboardCategory,
    });
    setLoading(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onDone();
  }

  return (
    <div className="rounded-md border border-dashed bg-base-200/20 px-3 py-2.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <Popover onOpenChange={setColorOpen} open={colorOpen}>
          <PopoverTrigger asChild>
            <button
              className="size-5 rounded-full shrink-0 ring-2 ring-offset-1 ring-transparent hover:ring-border transition-all"
              style={{ backgroundColor: color }}
              type="button"
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-1">
            <ColorPicker
              onChange={setColor}
              onCommit={() => setColorOpen(false)}
              presets={COLOR_OPTIONS}
              value={color}
            />
          </PopoverContent>
        </Popover>
        <Input
          autoFocus
          className="h-7 text-sm flex-1"
          disabled={loading}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              onDone();
            }
          }}
          placeholder="Status name"
          value={name}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <span className="text-xs text-base-content/60 shrink-0">
          Dashboard category
        </span>
        <Select
          disabled={loading}
          onValueChange={(v) => setDashboardCategory(v as DashboardCategory)}
          value={dashboardCategory}
        >
          <SelectTrigger className="h-7 w-32 text-xs shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="p-1.5">
            {DASHBOARD_CATEGORY_OPTIONS.map((opt) => (
              <SelectItem className="text-xs" key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex gap-2">
        <Button
          className="h-7 text-xs"
          disabled={loading || !name.trim()}
          onClick={save}
          size="sm"
        >
          {loading ? "Adding…" : "Add"}
        </Button>
        <Button
          className="h-7 text-xs"
          disabled={loading}
          onClick={onDone}
          size="sm"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Edit Row ─────────────────────────────────────────────────────────────────

function EditRow({
  status,
  workspaceId,
  spaceId,
  listId,
  onDone,
}: {
  status: Status;
  workspaceId: string;
  spaceId: string;
  listId: string;
  onDone: () => void;
}) {
  const [name, setName] = React.useState(status.name);
  const [color, setColor] = React.useState(status.color);
  const [type, setType] = React.useState<StatusType>(status.type);
  const [dashboardCategory, setDashboardCategory] =
    React.useState<DashboardCategory>(status.dashboardCategory);
  const [colorOpen, setColorOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function save() {
    if (!name.trim()) {
      setError("Name required");
      return;
    }
    setLoading(true);
    const res = await updateListStatus(
      workspaceId,
      spaceId,
      listId,
      status.id,
      { name: name.trim(), color, type, dashboardCategory }
    );
    setLoading(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onDone();
  }

  return (
    <div className="rounded-md border bg-base-200/20 px-3 py-2.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <Popover onOpenChange={setColorOpen} open={colorOpen}>
          <PopoverTrigger asChild>
            <button
              className="size-5 rounded-full shrink-0 ring-2 ring-offset-1 ring-transparent hover:ring-border transition-all"
              style={{ backgroundColor: color }}
              type="button"
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-1">
            <ColorPicker
              onChange={setColor}
              onCommit={() => setColorOpen(false)}
              presets={COLOR_OPTIONS}
              value={color}
            />
          </PopoverContent>
        </Popover>
        <Input
          autoFocus
          className="h-7 text-sm flex-1"
          disabled={loading}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              onDone();
            }
          }}
          value={name}
        />
        <Select
          disabled={loading}
          onValueChange={(v) => setType(v as StatusType)}
          value={type}
        >
          <SelectTrigger className="h-7 w-32 text-xs shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="p-1.5">
            <SelectItem className="text-xs" value="OPEN">
              Not started
            </SelectItem>
            <SelectItem className="text-xs" value="ACTIVE">
              Active
            </SelectItem>
            <SelectItem className="text-xs" value="CLOSED">
              Closed
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <span className="text-xs text-base-content/60 shrink-0">
          Dashboard category
        </span>
        <Select
          disabled={loading}
          onValueChange={(v) => setDashboardCategory(v as DashboardCategory)}
          value={dashboardCategory}
        >
          <SelectTrigger className="h-7 w-32 text-xs shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="p-1.5">
            {DASHBOARD_CATEGORY_OPTIONS.map((opt) => (
              <SelectItem className="text-xs" key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex gap-2">
        <Button
          className="h-7 text-xs"
          disabled={loading || !name.trim()}
          onClick={save}
          size="sm"
        >
          {loading ? "Saving…" : "Save"}
        </Button>
        <Button
          className="h-7 text-xs"
          disabled={loading}
          onClick={onDone}
          size="sm"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ListStatusesSettings({
  workspaceId,
  spaceId,
  listId,
  initialStatuses,
  onStatusesChange,
}: ListStatusesSettingsProps) {
  const [statuses, setStatuses] = React.useState(initialStatuses);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [addingType, setAddingType] = React.useState<StatusType | null>(null);
  async function refresh() {
    const res = await getListStatuses(workspaceId, spaceId, listId);
    if (!("error" in res)) {
      setStatuses(res);
      onStatusesChange?.(res);
    }
  }

  async function handleDelete(statusId: string) {
    const res = await deleteListStatus(workspaceId, spaceId, listId, statusId);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    await refresh();
  }

  // Persist a within-group reorder. `next` is the full list in grouped order.
  async function persistOrder(next: Status[]) {
    setStatuses(next);
    const res = await reorderListStatuses(
      workspaceId,
      spaceId,
      listId,
      next.map((s) => s.id)
    );
    if (res && "error" in res) {
      toast.error(res.error);
      await refresh();
      return;
    }
    onStatusesChange?.(next);
  }

  // Reorder a single status within its own type group, then rebuild the full
  // list (grouped order) so reorderListStatuses receives a clean sequence.
  function reorderWithinGroup(type: StatusType, group: Status[]) {
    return GROUPS.flatMap((g) =>
      g.type === type ? group : statuses.filter((s) => s.type === g.type)
    );
  }

  async function handleMove(statusId: string, direction: -1 | 1) {
    const status = statuses.find((s) => s.id === statusId);
    if (!status) {
      return;
    }
    const group = statuses.filter((s) => s.type === status.type);
    const idx = group.findIndex((s) => s.id === statusId);
    const target = idx + direction;
    if (target < 0 || target >= group.length) {
      return;
    }
    const newGroup = [...group];
    [newGroup[idx], newGroup[target]] = [newGroup[target], newGroup[idx]];
    await persistOrder(reorderWithinGroup(status.type, newGroup));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const activeStatus = statuses.find((s) => s.id === active.id);
    const overStatus = statuses.find((s) => s.id === over.id);
    // Only allow reordering within the same type group (cross-group would
    // change the status type, which isn't supported here).
    if (!activeStatus || !overStatus || activeStatus.type !== overStatus.type) {
      return;
    }
    const group = statuses.filter((s) => s.type === activeStatus.type);
    const oldIndex = group.findIndex((s) => s.id === active.id);
    const newIndex = group.findIndex((s) => s.id === over.id);
    void persistOrder(
      reorderWithinGroup(
        activeStatus.type,
        arrayMove(group, oldIndex, newIndex)
      )
    );
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      id="list-statuses-dnd"
      modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
      onDragEnd={handleDragEnd}
      sensors={sensors}
    >
      <div className="space-y-8 max-w-lg">
        {GROUPS.map(({ type, label, accent }) => {
          const group = statuses.filter((s) => s.type === type);
          const isAddingHere = addingType === type;

          return (
            <div className="space-y-2" key={type}>
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-xs font-semibold uppercase tracking-wider",
                    accent
                  )}
                >
                  {label}
                </span>
                <button
                  className="flex size-9 items-center justify-center rounded hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors sm:size-5"
                  onClick={() => {
                    setEditingId(null);
                    setAddingType(type);
                  }}
                  title={`Add ${label} status`}
                  type="button"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </div>

              <div className="space-y-1.5">
                <SortableContext
                  items={group.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {group.map((status) =>
                    editingId === status.id ? (
                      <EditRow
                        key={status.id}
                        listId={listId}
                        onDone={() => {
                          setEditingId(null);
                          refresh();
                        }}
                        spaceId={spaceId}
                        status={status}
                        workspaceId={workspaceId}
                      />
                    ) : (
                      <SortableStatusRow
                        key={status.id}
                        onDelete={() => handleDelete(status.id)}
                        onEdit={() => {
                          setAddingType(null);
                          setEditingId(status.id);
                        }}
                        onMoveDown={() => handleMove(status.id, 1)}
                        onMoveUp={() => handleMove(status.id, -1)}
                        status={status}
                      />
                    )
                  )}
                </SortableContext>

                {isAddingHere ? (
                  <AddRow
                    listId={listId}
                    onDone={() => {
                      setAddingType(null);
                      refresh();
                    }}
                    spaceId={spaceId}
                    type={type}
                    workspaceId={workspaceId}
                  />
                ) : (
                  <button
                    className="flex w-full items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs text-base-content/60 hover:border-base-300 hover:bg-base-200 hover:text-base-content transition-colors"
                    onClick={() => {
                      setEditingId(null);
                      setAddingType(type);
                    }}
                    type="button"
                  >
                    <PlusIcon className="size-3.5" /> Add status
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}

// ─── Sortable status row ──────────────────────────────────────────────────────

function SortableStatusRow({
  status,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  status: Status;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: status.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md border bg-base-100 px-2 py-2 hover:bg-base-200/30 transition-colors",
        isDragging && "opacity-50"
      )}
      ref={setNodeRef}
      style={style}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center text-base-content/40 group-hover:text-base-content/60 transition-colors active:cursor-grabbing sm:size-4"
      >
        <DotsSixVerticalIcon className="size-4" />
      </button>
      <span
        className="size-3.5 shrink-0 rounded-full"
        style={{ backgroundColor: status.color }}
      />
      <span className="flex-1 min-w-0 text-sm font-medium truncate">
        {status.name}
      </span>
      <div className="flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="flex size-9 items-center justify-center rounded hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors sm:size-6"
              type="button"
            >
              <DotsThreeIcon className="size-4" weight="bold" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-36 p-1">
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
              onClick={onEdit}
              type="button"
            >
              <PencilSimpleIcon className="size-3.5" /> Edit
            </button>
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200 text-base-content/60"
              onClick={onMoveUp}
              type="button"
            >
              Move up
            </button>
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200 text-base-content/60"
              onClick={onMoveDown}
              type="button"
            >
              Move down
            </button>
            <div className="h-px bg-base-300 my-1" />
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-error hover:bg-error/10"
              onClick={onDelete}
              type="button"
            >
              <TrashIcon className="size-3.5" /> Delete
            </button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
