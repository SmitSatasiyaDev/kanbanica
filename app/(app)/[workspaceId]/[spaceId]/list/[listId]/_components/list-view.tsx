"use client";

// drag and drop
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
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
  ArrowsDownUpIcon,
  CalendarBlankIcon,
  CaretCircleDownIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretUpIcon,
  CheckIcon,
  CheckSquareIcon,
  ColumnsIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FunnelIcon,
  GearIcon,
  HashIcon,
  KeyboardIcon,
  LightningIcon,
  ListChecksIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
  PushPinIcon,
  PushPinSlashIcon,
  TextAaIcon,
  TrashIcon,
  UploadSimpleIcon,
  UserIcon,
  UserPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import type {
  CustomFieldRow,
  CustomFieldType,
} from "@/app/actions/custom-field";
import {
  createListStatus,
  getWorkspaceLists,
  updateListStatus,
} from "@/app/actions/list";
import {
  addTaskToSprint,
  bulkMoveTasksToSprint,
  getSprints,
} from "@/app/actions/sprint";
import {
  archiveTask,
  bulkArchiveTasks,
  bulkDeleteTasks,
  bulkMoveTasks,
  bulkUpdateStatus,
  createTask,
  reorderTasksInStatus,
  unarchiveTask,
  updateTask,
  updateTaskStatus,
} from "@/app/actions/task";
import {
  addAssignee,
  bulkAssignTasks,
  removeAssignee,
} from "@/app/actions/task-assignee";
import { ManageFieldsIcon } from "@/components/common/manage-fields-icon";
import { SpaceIcon } from "@/components/common/space-icon";
import { UserAvatar } from "@/components/common/user-avatar";
import { CustomFieldFilterControl } from "@/components/filters/custom-field-filter";
import {
  CombinedFacetFilter,
  FacetFilter,
  FacetOptionList,
} from "@/components/filters/facet-filter";
import { FilterBuilder } from "@/components/filters/filter-builder";
import { FilterChip } from "@/components/filters/filter-chip";
import {
  ExportMenuRow,
  ExportSelectedButton,
  triggerExportDownload,
} from "@/components/import-export/export-button";
import {
  ImportMenuRow,
  ImportWizardDialog,
} from "@/components/import-export/import-wizard";
import { useRealtimePause } from "@/components/realtime/realtime-provider";
import { CreateTaskModal } from "@/components/task/create-task-modal";
import { KeyboardShortcutsDialog } from "@/components/task/keyboard-shortcuts-dialog";
import {
  EMPTY_QUICK_META,
  QuickTaskMeta,
  type QuickTaskMetaValue,
  quickMetaCreateFields,
} from "@/components/task/quick-task-meta";
import type { TaskDependencyIndicator } from "@/components/task/task-dependency-badge";
import {
  TaskListRow,
  type TaskListRowProps,
} from "@/components/task/task-list-row";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { isOverlayOpen } from "@/components/ui/overlay-stack";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useListColumnPreferences } from "@/hooks/use-list-column-preferences";
import {
  CUSTOM_FIELD_COLUMN_WIDTH_CLASS,
  toTitleCase,
} from "@/lib/custom-fields/column-display";
import {
  type CustomFieldFilters,
  isCustomFieldFilterActive,
} from "@/lib/custom-fields/filters";
import {
  DASHBOARD_CATEGORY_OPTIONS,
  type DashboardCategory,
} from "@/lib/dashboard-category";
import { PRIORITY_OPTIONS } from "@/lib/filters/options";
import { filterTasks } from "@/lib/filters/task-filter";
import { STATUS_PRESET_COLORS } from "@/lib/status-colors";
import { setTaskNavContext } from "@/lib/task-nav-context";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";

// Small, muted, purely decorative — one icon per custom field type for the
// column header (optional per spec, kept subtle).
const CUSTOM_FIELD_TYPE_ICON: Record<CustomFieldType, React.ReactNode> = {
  TEXT: <TextAaIcon className="size-3 text-gray-400" />,
  NUMBER: <HashIcon className="size-3 text-gray-400" />,
  CHECKBOX: <CheckSquareIcon className="size-3 text-gray-400" />,
  SINGLE_SELECT: <CaretCircleDownIcon className="size-3 text-gray-400" />,
  MULTI_SELECT: <ListChecksIcon className="size-3 text-gray-400" />,
  DATE: <CalendarBlankIcon className="size-3 text-gray-400" />,
  PERSON: <UserIcon className="size-3 text-gray-400" />,
};

interface Status {
  color: string;
  id: string;
  name: string;
  orderIndex: number;
  type: "OPEN" | "ACTIVE" | "CLOSED";
}

type WorkspaceMemberOption = {
  userId: string;
  name: string | null;
  email: string | null;
  image?: string | null;
};

interface Task {
  assignees: { userId: string; name: string; image: string | null }[];
  customFieldValues?: Record<string, unknown>;
  dependencyInfo?: TaskDependencyIndicator;
  dueDateEnd: Date | null;
  dueDateStart: Date | null;
  id: string;
  isPinnedToList: boolean;
  orderIndex: number;
  pinnedToListOrder: number | null;
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  seqNumber: number;
  statusId: string | null;
  tags: { id: string; name: string; color: string }[];
  title: string;
  trackedSeconds?: number;
}

interface ListViewProps {
  archivedLoading?: boolean;
  archivedTasks?: { id: string; title: string; seqNumber: number }[];
  canEdit?: boolean;
  canManage?: boolean;
  canPinToList?: boolean;
  currentUserId?: string;
  customFields?: CustomFieldRow[];
  isAdmin?: boolean;
  listId: string;
  members?: {
    userId: string;
    name: string | null;
    email: string | null;
    image?: string | null;
  }[];
  onArchivedChanged?: () => Promise<void>;
  onToggleArchived?: () => void;
  personallyPinnedIds?: Set<string>;
  pinnedTasks?: Task[];
  showArchived?: boolean;
  spaceId: string;
  statuses: Status[];
  tags?: { id: string; name: string; color: string }[];
  tasks: Task[];
  workspaceId: string;
}

// Informational-only in the Columns menu today — no show/hide mechanism
// exists yet for built-in columns (see the Columns menu comment below).
const BUILT_IN_COLUMN_LABELS = ["Assignee", "Due Date", "Priority"];

type SprintOption = {
  id: string;
  name: string;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
};

// --- Sortable wrapper (DnD) -------------------------------------------------

function SortableTaskRow(
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
    data: { type: "task", statusId: props.task.statusId },
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

// ─── Pinned section ───────────────────────────────────────────────────────────

function PinnedSection({
  tasks,
  workspaceId,
  spaceId,
  listId,
  statuses,
  canPinToList,
  isAdmin,
  canEdit,
  personallyPinnedIds,
  selectedIds,
  onSelect,
  visibleCustomFields,
  workspaceMembers,
  taskNavIds,
}: {
  tasks: Task[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  statuses: Status[];
  canPinToList?: boolean;
  isAdmin?: boolean;
  canEdit?: boolean;
  personallyPinnedIds?: Set<string>;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  visibleCustomFields: CustomFieldRow[];
  workspaceMembers: WorkspaceMemberOption[];
  taskNavIds: string[];
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);

  // Same select-all semantics as a status group header — pinned tasks live in
  // their own section and are excluded from every status group, so without this
  // there is no way to select them as a set for a bulk action.
  const selectedCount = tasks.reduce(
    (n, t) => n + (selectedIds.has(t.id) ? 1 : 0),
    0
  );
  const allSelected = tasks.length > 0 && selectedCount === tasks.length;
  const someSelected = selectedCount > 0 && !allSelected;

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col border border-primary/20 rounded-xl overflow-hidden bg-primary/2 mb-2">
      {/* Header */}
      {/* biome-ignore lint/a11y/useSemanticElements: wraps a nested interactive "select all" button, so it can't literally be a <button>; kept keyboard-accessible via role+tabIndex+onKeyDown */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-primary/5 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) {
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed((v) => !v);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="flex size-5 items-center justify-center rounded text-primary/70">
          {collapsed ? (
            <CaretRightIcon className="size-3" weight="fill" />
          ) : (
            <CaretDownIcon className="size-3" weight="fill" />
          )}
        </div>
        <button
          aria-label={
            allSelected
              ? "Deselect all pinned tasks"
              : "Select all pinned tasks"
          }
          className={cn(
            "flex size-4 items-center justify-center rounded border transition-colors cursor-pointer",
            allSelected || someSelected
              ? "border-primary bg-primary text-primary-content"
              : "border-primary/30 hover:border-primary/60 bg-base-100"
          )}
          onClick={(e) => {
            e.stopPropagation();
            const target = !allSelected;
            for (const t of tasks) {
              onSelect(t.id, target);
            }
          }}
          title={allSelected ? "Deselect all" : "Select all"}
          type="button"
        >
          {allSelected ? (
            <CheckIcon className="size-2.5" weight="bold" />
          ) : someSelected ? (
            <MinusIcon className="size-2.5" weight="bold" />
          ) : null}
        </button>
        <PushPinIcon className="size-3.5 text-primary" weight="fill" />
        <span className="text-2xs font-bold uppercase tracking-wider text-primary">
          Pinned
        </span>
        <span className="text-xs text-primary/60 font-semibold tabular-nums">
          {tasks.length}
        </span>
      </div>

      {!collapsed && (
        <div className="flex flex-col overflow-x-auto border-t border-primary/15">
          {tasks.map((t) => {
            const statusColor =
              statuses.find((s) => s.id === t.statusId)?.color ?? "#6B7280";
            return (
              <TaskListRow
                canEdit={canEdit}
                canPinToList={canPinToList}
                customFields={visibleCustomFields}
                isAdmin={isAdmin}
                isPersonallyPinned={personallyPinnedIds?.has(t.id)}
                key={t.id}
                listId={listId}
                onOpen={() => {
                  setTaskNavContext({ taskIds: taskNavIds });
                  router.push(`/${workspaceId}/task/${t.id}?from=list`);
                }}
                onRefresh={() => router.refresh()}
                onSelect={onSelect}
                selected={selectedIds.has(t.id)}
                spaceId={spaceId}
                statusColor={statusColor}
                statuses={statuses}
                task={t}
                workspaceId={workspaceId}
                workspaceMembers={workspaceMembers}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sortable column header ───────────────────────────────────────────────────

type SortKey = "name" | "due" | "priority";
type SortOrder = "asc" | "desc";

// Sortable columns, in the order the header row renders them. The toolbar's
// Sort dropdown reads from the same list so the two controls can never drift.
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Task Name" },
  { key: "due", label: "Due Date" },
  { key: "priority", label: "Priority" },
];

const SORT_OPTION_LABEL: Record<SortKey, string> = {
  name: "Task Name",
  due: "Due Date",
  priority: "Priority",
};

type SortControl = {
  sortBy: SortKey | null;
  sortOrder: SortOrder;
  /** Cycles the given column: inactive → asc → desc → off */
  onSort: (key: SortKey) => void;
};

/**
 * A clickable table header that both reflects and controls the sort. The
 * arrow is the point: the toolbar's Sort dropdown showed which column was
 * sorted but never which direction, so the same label meant two opposite
 * orderings.
 */
function SortableColumnHeader({
  sortKey,
  label,
  className,
  control,
}: {
  sortKey: SortKey;
  label: string;
  className?: string;
  control: SortControl;
}) {
  const active = control.sortBy === sortKey;
  const ascending = active && control.sortOrder === "asc";
  // The header row is a flex layout, not a real <table>, so there is no
  // columnheader to hang `aria-sort` on — the state goes in the button's own
  // accessible name instead.
  const state = active
    ? ascending
      ? "sorted ascending"
      : "sorted descending"
    : "not sorted";
  return (
    <button
      aria-label={`${label}, ${state}`}
      className={cn(
        "group/sort flex items-center gap-1 py-2 px-4 text-left uppercase tracking-wider transition-colors cursor-pointer hover:text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50",
        active && "text-base-content",
        className
      )}
      onClick={() => control.onSort(sortKey)}
      title={
        active
          ? ascending
            ? `Sorted by ${label}, ascending — click for descending`
            : `Sorted by ${label}, descending — click to clear`
          : `Sort by ${label}`
      }
      type="button"
    >
      <span className="truncate">{label}</span>
      {active ? (
        ascending ? (
          <CaretUpIcon className="size-3 shrink-0 text-primary" weight="bold" />
        ) : (
          <CaretDownIcon
            className="size-3 shrink-0 text-primary"
            weight="bold"
          />
        )
      ) : (
        <ArrowsDownUpIcon className="size-3 shrink-0 opacity-0 transition-opacity group-hover/sort:opacity-60" />
      )}
    </button>
  );
}

// ─── Status group ─────────────────────────────────────────────────────────────

// Fields a quick-created task should inherit from its group. Under Group By =
// Status this is just the status; under Priority / Assignee it carries the
// group's priority/assignee plus a sensible default OPEN status (never a
// closed/done status).
type QuickCreateDefaults = {
  statusId?: string;
  priority?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  assigneeIds?: string[];
};

function QuickCreateRow({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  createDefaults,
  statuses,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  spaceId: string;
  listId: string;
  createDefaults: QuickCreateDefaults;
  statuses: Status[];
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [meta, setMeta] = React.useState<QuickTaskMetaValue>(EMPTY_QUICK_META);
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  function cancel() {
    onOpenChange(false);
    setTitle("");
    setMeta(EMPTY_QUICK_META);
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      const res = await createTask(workspaceId, spaceId, listId, {
        title: trimmed,
        ...createDefaults,
        ...quickMetaCreateFields(meta),
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      // Sprint isn't a createTask field — assign it right after.
      if (meta.sprintId) {
        await addTaskToSprint(workspaceId, spaceId, meta.sprintId, res.taskId);
      }
      setTitle("");
      setMeta(EMPTY_QUICK_META);
      onOpenChange(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        className="flex w-full items-center gap-1.5 pl-16 pr-4 py-2 text-xs font-semibold text-base-content/60 hover:text-primary hover:bg-base-200/30 transition-colors border-b border-base-300 bg-elevated cursor-pointer select-none text-left"
        onClick={() => onOpenChange(true)}
        type="button"
      >
        <PlusIcon className="size-3.5 shrink-0" />
        Add Task
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 pl-16 pr-4 py-2 border-b border-base-300 bg-elevated">
      <div className="flex items-center gap-2">
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
              cancel();
            }
          }}
          placeholder="Task name"
          ref={inputRef}
          type="text"
          value={title}
        />
        <button
          className="text-xs font-semibold text-primary hover:text-primary/80 disabled:opacity-40 shrink-0"
          disabled={saving || !title.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {saving ? "…" : "Save"}
        </button>
        <button
          className="text-xs text-base-content/60 hover:text-base-content shrink-0"
          onClick={cancel}
          type="button"
        >
          Cancel
        </button>
      </div>
      <QuickTaskMeta
        onChange={setMeta}
        spaceId={spaceId}
        statuses={statuses}
        value={meta}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function StatusGroup({
  status,
  tasks,
  workspaceId,
  spaceId,
  listId,
  isAdmin,
  canEdit,
  canPinToList,
  personallyPinnedIds,
  selectedIds,
  onSelect,
  statuses,
  addOpen,
  onAddOpenChange,
  collapsed,
  onCollapsedChange,
  createDefaults,
  sortControl,
  visibleCustomFields,
  workspaceMembers,
  taskNavIds,
}: {
  status: Status;
  tasks: Task[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  canEdit?: boolean;
  canPinToList?: boolean;
  personallyPinnedIds?: Set<string>;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  statuses: Status[];
  addOpen: boolean;
  onAddOpenChange: (v: boolean) => void;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  createDefaults: QuickCreateDefaults;
  sortControl: SortControl;
  visibleCustomFields: CustomFieldRow[];
  workspaceMembers: WorkspaceMemberOption[];
  taskNavIds: string[];
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [newStatusOpen, setNewStatusOpen] = React.useState(false);
  const [renameName, setRenameName] = React.useState(status.name);
  const [newStatusName, setNewStatusName] = React.useState("");
  const [newStatusColor, setNewStatusColor] = React.useState("#6B7280");
  const [newStatusCategory, setNewStatusCategory] =
    React.useState<DashboardCategory>("OPEN");
  const [saving, setSaving] = React.useState(false);

  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  // Select-all for this group's tasks (header checkbox → bulk delete/handle).
  const groupSelectedCount = tasks.reduce(
    (n, t) => n + (selectedIds.has(t.id) ? 1 : 0),
    0
  );
  const groupAllSelected =
    tasks.length > 0 && groupSelectedCount === tasks.length;
  const groupSomeSelected = groupSelectedCount > 0 && !groupAllSelected;
  function toggleGroupSelection() {
    const target = !groupAllSelected;
    for (const t of tasks) {
      onSelect(t.id, target);
    }
  }

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
      listId,
      status.id,
      { name: trimmed }
    );
    setSaving(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setRenameOpen(false);
    router.refresh();
  }

  async function handleCreateStatus() {
    if (!newStatusName.trim()) {
      return;
    }
    setSaving(true);
    const res = await createListStatus(workspaceId, spaceId, listId, {
      name: newStatusName.trim(),
      color: newStatusColor,
      type: "OPEN",
      dashboardCategory: newStatusCategory,
    });
    setSaving(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setNewStatusName("");
    setNewStatusColor("#6B7280");
    setNewStatusCategory("OPEN");
    setNewStatusOpen(false);
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-col">
        {/* Status Group Header */}
        {/* biome-ignore lint/a11y/useSemanticElements: wraps nested interactive controls (settings menu button), so it can't literally be a <button>; kept keyboard-accessible via role+tabIndex+onKeyDown */}
        <div
          className="group/header flex items-center gap-2.5 py-1.5 px-3 hover:bg-base-200/30 transition-colors cursor-pointer select-none border-b border-base-300"
          onClick={() => onCollapsedChange(!collapsed)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) {
              return;
            }
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onCollapsedChange(!collapsed);
            }
          }}
          role="button"
          tabIndex={0}
        >
          {/* Arrow */}
          <div className="flex size-5 items-center justify-center rounded hover:bg-base-200 transition-colors shrink-0 text-base-content/60 group-hover/header:text-base-content">
            {collapsed ? (
              <CaretRightIcon className="size-3" weight="fill" />
            ) : (
              <CaretDownIcon className="size-3" weight="fill" />
            )}
          </div>

          {/* Pill Badge */}
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

          {/* Task count */}
          <span className="text-xs text-gray-400 font-semibold tabular-nums">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>

          {/* Settings Menu Icon */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops clicks from bubbling to the header's onClick; nested buttons remain independently keyboard-accessible */}
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: same as above */}
          <div
            className="ml-2 flex items-center gap-1 opacity-0 group-hover/header:opacity-100 transition-opacity"
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
                  className="flex size-6 items-center justify-center rounded hover:bg-base-200 transition-colors cursor-pointer"
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
                <p className="px-2 py-1 text-2xs font-bold text-base-content/60 uppercase tracking-wide">
                  Group Options
                </p>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 cursor-pointer text-left"
                  onClick={() => {
                    setMenuOpen(false);
                    setRenameName(status.name);
                    setRenameOpen(true);
                  }}
                  type="button"
                >
                  <PencilSimpleIcon className="size-3.5 text-base-content/60 shrink-0" />
                  Rename Status
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 cursor-pointer text-left"
                  onClick={() => {
                    setMenuOpen(false);
                    setNewStatusOpen(true);
                  }}
                  type="button"
                >
                  <PlusIcon className="size-3.5 text-base-content/60 shrink-0" />
                  New Status
                </button>
                <div className="h-px bg-base-300 my-1" />
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 cursor-pointer text-left"
                  onClick={() => {
                    onCollapsedChange(!collapsed);
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
              className="flex size-6 items-center justify-center rounded hover:bg-base-200 transition-colors cursor-pointer"
              onClick={() => {
                onCollapsedChange(false);
                onAddOpenChange(true);
              }}
              type="button"
            >
              <PlusIcon className="size-3.5 text-base-content/60" />
            </button>
          </div>
        </div>

        {/* Tasks Container */}
        {!collapsed && (
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {/* Column Header (Desktop Only) */}
            <div className="hidden md:flex items-center border-b border-base-300 text-2xs font-bold text-gray-400 select-none uppercase tracking-wider bg-elevated">
              <div className="w-0.75 self-stretch shrink-0 bg-transparent" />
              <div className="flex items-center pl-2 shrink-0 w-14">
                <button
                  aria-label={
                    groupAllSelected
                      ? "Deselect all tasks in this group"
                      : "Select all tasks in this group"
                  }
                  className={cn(
                    "flex size-4 items-center justify-center rounded border transition-colors cursor-pointer",
                    groupAllSelected || groupSomeSelected
                      ? "border-primary bg-primary text-primary-content"
                      : "border-base-300 hover:border-primary/40 bg-base-100"
                  )}
                  onClick={toggleGroupSelection}
                  title={groupAllSelected ? "Deselect all" : "Select all"}
                  type="button"
                >
                  {groupAllSelected ? (
                    <CheckIcon className="size-2.5" weight="bold" />
                  ) : groupSomeSelected ? (
                    <MinusIcon className="size-2.5" weight="bold" />
                  ) : null}
                </button>
              </div>
              <SortableColumnHeader
                className="flex-1 min-w-0 pr-4 pl-1"
                control={sortControl}
                label="Name"
                sortKey="name"
              />
              {/* Assignee has no sort key — sorting people by name across
                  multi-assignee tasks isn't a single well-defined order, so it
                  stays a plain label rather than a header that does nothing. */}
              <div className="w-36 shrink-0 py-2 px-4 text-center">
                Assignee
              </div>
              <SortableColumnHeader
                className="w-28 shrink-0"
                control={sortControl}
                label="Due Date"
                sortKey="due"
              />
              <SortableColumnHeader
                className="w-32 shrink-0"
                control={sortControl}
                label="Priority"
                sortKey="priority"
              />
              {visibleCustomFields.map((f) => (
                <div
                  className={cn(
                    "flex items-center gap-1 truncate py-2 px-4",
                    CUSTOM_FIELD_COLUMN_WIDTH_CLASS[f.type]
                  )}
                  key={f.id}
                >
                  {CUSTOM_FIELD_TYPE_ICON[f.type]}
                  <span className="truncate">{toTitleCase(f.name)}</span>
                </div>
              ))}
              <div className="w-48 shrink-0 text-right pr-4">Actions</div>
            </div>
            <div
              className={cn(
                "flex flex-col overflow-x-auto transition-all min-h-1",
                isOver &&
                  "bg-base-200/20 border-y border-dashed border-base-300"
              )}
              ref={setNodeRef}
            >
              {tasks.map((task) => (
                <SortableTaskRow
                  canEdit={canEdit}
                  canPinToList={canPinToList}
                  customFields={visibleCustomFields}
                  isAdmin={isAdmin}
                  isPersonallyPinned={personallyPinnedIds?.has(task.id)}
                  key={task.id}
                  listId={listId}
                  onOpen={() => {
                    setTaskNavContext({ taskIds: taskNavIds });
                    router.push(`/${workspaceId}/task/${task.id}?from=list`);
                  }}
                  onRefresh={() => router.refresh()}
                  onSelect={onSelect}
                  selected={selectedIds.has(task.id)}
                  spaceId={spaceId}
                  statusColor={status.color}
                  statuses={statuses}
                  task={task}
                  workspaceId={workspaceId}
                  workspaceMembers={workspaceMembers}
                />
              ))}

              <QuickCreateRow
                createDefaults={createDefaults}
                listId={listId}
                onOpenChange={onAddOpenChange}
                open={addOpen}
                spaceId={spaceId}
                statuses={statuses}
                workspaceId={workspaceId}
              />
            </div>
          </SortableContext>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog onOpenChange={setRenameOpen} open={renameOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-base-content">
              Rename Status
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            className="h-9 text-xs"
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleRename();
              }
            }}
            value={renameName}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              className="h-8 text-xs font-semibold"
              onClick={() => setRenameOpen(false)}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              className="h-8 text-xs font-bold"
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
            <DialogTitle className="text-sm font-bold text-base-content">
              New Status
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              autoFocus
              className="h-9 text-xs"
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
                    "size-6 rounded-full transition-transform cursor-pointer",
                    newStatusColor === color
                      ? "scale-110 ring-2 ring-base-content ring-offset-2 ring-offset-popover"
                      : ""
                  )}
                  key={color}
                  onClick={() => setNewStatusColor(color)}
                  style={{ backgroundColor: color }}
                  type="button"
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-base-content/60 shrink-0">
                Dashboard category
              </span>
              <Select
                onValueChange={(v) =>
                  setNewStatusCategory(v as DashboardCategory)
                }
                value={newStatusCategory}
              >
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="p-1.5">
                  {DASHBOARD_CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem
                      className="text-xs"
                      key={opt.value}
                      value={opt.value}
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              className="h-8 text-xs font-semibold"
              onClick={() => setNewStatusOpen(false)}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              className="h-8 text-xs font-bold"
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

// Pin/unpin a batch of tasks against the shared list-pin route (`POST`/`DELETE
// /api/tasks/:id/pin-to-list`) — the route's own contract is untouched; this
// just drives it once per task. Sequential on purpose: pinning enforces a
// 5-per-list cap with a read-then-write inside its transaction, so firing the
// requests in parallel could let a batch slip past the limit.
async function setListPinBatch(taskIds: string[], pinned: boolean) {
  const failures: string[] = [];
  const succeeded: string[] = [];
  for (const id of taskIds) {
    try {
      const res = await fetch(`/api/tasks/${id}/pin-to-list`, {
        method: pinned ? "POST" : "DELETE",
      });
      if (res.ok) {
        succeeded.push(id);
      } else {
        const data = await res.json().catch(() => ({}));
        failures.push(data.error ?? "Request failed");
      }
    } catch {
      failures.push("Request failed");
    }
  }
  return { succeeded, failures };
}

function BulkActionBar({
  count,
  selectedIds,
  pinnedSelectedIds,
  unpinnedSelectedIds,
  statuses,
  members,
  workspaceId,
  spaceId,
  listId,
  isAdmin,
  canEdit,
  canPinToList,
  onClear,
  onRefresh,
}: {
  count: number;
  selectedIds: Set<string>;
  /** Selected tasks that are currently pinned to the top of the list */
  pinnedSelectedIds: string[];
  /** Selected tasks that are not pinned to the top of the list */
  unpinnedSelectedIds: string[];
  statuses: Status[];
  members: {
    userId: string;
    name: string | null;
    email: string | null;
    image?: string | null;
  }[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  canEdit?: boolean;
  canPinToList?: boolean;
  onClear: () => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignSelected, setAssignSelected] = React.useState<string[]>([]);
  const [assignMode, setAssignMode] = React.useState<"replace" | "add">(
    "replace"
  );
  const [sprints, setSprints] = React.useState<SprintOption[] | null>(null);
  const [loadingSprints, setLoadingSprints] = React.useState(false);
  const [listSpaces, setListSpaces] = React.useState<
    | {
        id: string;
        name: string;
        color: string | null;
        logoEmoji: string | null;
        lists: { id: string; name: string; color: string | null }[];
      }[]
    | null
  >(null);
  const [loadingLists, setLoadingLists] = React.useState(false);

  // Pressing Delete / Backspace with tasks selected opens the delete confirm —
  // same as the "Delete" button (admin-only). Ignored while typing in a field or
  // an editable element so it can't fire mid-edit. This bar only mounts when
  // there is a selection, so the listener is naturally scoped to that.
  React.useEffect(() => {
    if (!isAdmin) {
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable ||
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT")
      ) {
        return;
      }
      if (busy || deleteOpen) {
        return;
      }
      e.preventDefault();
      setDeleteOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAdmin, busy, deleteOpen]);

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
    setSprints(res.sprints.filter((s) => s.status !== "CLOSED"));
  }

  async function loadLists() {
    if (listSpaces !== null) {
      return;
    }
    setLoadingLists(true);
    const res = await getWorkspaceLists(workspaceId, listId);
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
  }

  function closeAssignDialog(open: boolean) {
    setAssignOpen(open);
    if (!open) {
      setAssignSelected([]);
      setAssignMode("replace");
    }
  }

  async function handleBulkAssign() {
    if (assignSelected.length === 0) {
      return;
    }
    setBusy(true);
    const res = await bulkAssignTasks(
      workspaceId,
      spaceId,
      listId,
      [...selectedIds],
      assignSelected,
      assignMode
    );
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(
      `Assigned ${res.updated} task${res.updated === 1 ? "" : "s"}`
    );
    closeAssignDialog(false);
    onClear();
  }

  async function handleBulkStatus(statusId: string) {
    setBusy(true);
    const res = await bulkUpdateStatus(
      workspaceId,
      spaceId,
      listId,
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
  }

  async function handleMoveToSprint(sprintId: string, sprintName: string) {
    setBusy(true);
    const res = await bulkMoveTasksToSprint(
      workspaceId,
      spaceId,
      listId,
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
  }

  // Pin and unpin are separate actions over separate subsets of the selection —
  // a single "toggle pin" button can't express "unpin these 3" when the
  // selection also holds unpinned tasks, which is exactly why bulk unpin
  // appeared to do nothing before.
  async function handleBulkListPin(pinned: boolean) {
    const ids = pinned ? unpinnedSelectedIds : pinnedSelectedIds;
    if (ids.length === 0) {
      return;
    }
    setBusy(true);
    const { succeeded, failures } = await setListPinBatch(ids, pinned);
    setBusy(false);
    // The route calls refreshWorkspace() per task; the current page still needs
    // to re-render against the revalidated data.
    onRefresh();
    if (succeeded.length === 0) {
      toast.error(failures[0] ?? "Failed to update pins");
      return;
    }
    if (failures.length > 0) {
      toast.error(failures[0]);
    }
    onClear();
    const noun = `${succeeded.length} task${succeeded.length === 1 ? "" : "s"}`;
    toastWithUndo(
      pinned ? `Pinned ${noun} to top` : `Unpinned ${noun}`,
      async () => {
        const undo = await setListPinBatch(succeeded, !pinned);
        onRefresh();
        if (undo.failures.length > 0) {
          toast.error(undo.failures[0]);
        }
      }
    );
  }

  async function handleBulkArchive() {
    setBusy(true);
    const res = await bulkArchiveTasks(workspaceId, spaceId, listId, [
      ...selectedIds,
    ]);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Archived ${count} task${count > 1 ? "s" : ""}`);
    onClear();
  }

  async function confirmBulkDelete() {
    setDeleteOpen(false);
    setBusy(true);
    const res = await bulkDeleteTasks(workspaceId, spaceId, listId, [
      ...selectedIds,
    ]);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Deleted ${count} task${count > 1 ? "s" : ""}`);
    onClear();
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
      <Dialog onOpenChange={closeAssignDialog} open={assignOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Bulk Assign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-base-content/60 uppercase tracking-wide">
                Members
              </p>
              <FacetOptionList
                emptyText="No members"
                onChange={setAssignSelected}
                options={members.map((m) => ({
                  value: m.userId,
                  label: m.name || m.email || "Unknown",
                  icon: (
                    <UserAvatar
                      email={m.email}
                      image={m.image}
                      name={m.name || m.email}
                      size="xs"
                    />
                  ),
                }))}
                searchable
                selected={assignSelected}
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-base-content/60 uppercase tracking-wide">
                Assignment Mode
              </p>
              <RadioGroup
                onValueChange={(v) => setAssignMode(v as "replace" | "add")}
                value={assignMode}
              >
                <label
                  className="flex items-center gap-2 text-sm cursor-pointer"
                  htmlFor="bulk-assign-mode-replace"
                >
                  <RadioGroupItem
                    id="bulk-assign-mode-replace"
                    value="replace"
                  />
                  Replace existing assignees
                </label>
                <label
                  className="flex items-center gap-2 text-sm cursor-pointer"
                  htmlFor="bulk-assign-mode-add"
                >
                  <RadioGroupItem id="bulk-assign-mode-add" value="add" />
                  Add to existing assignees
                </label>
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => closeAssignDialog(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy || assignSelected.length === 0}
              onClick={handleBulkAssign}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 shadow-2xl text-white text-sm md:max-w-none md:overflow-visible">
        {/* Count + clear */}
        <span className="font-semibold text-white pr-2 border-r border-white/20 mr-2 select-none">
          {count} task{count > 1 ? "s" : ""} selected
        </span>
        <button
          className="flex size-6 items-center justify-center rounded hover:bg-white/10 transition-colors mr-2 cursor-pointer"
          onClick={onClear}
          type="button"
        >
          <XIcon className="size-3.5 text-white/70" />
        </button>

        {/* Assign */}
        <button
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
          disabled={busy}
          onClick={() => setAssignOpen(true)}
          type="button"
        >
          <UserPlusIcon className="size-3.5" />
          Assign
        </button>

        {/* Status */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
              disabled={busy}
              type="button"
            >
              <span className="size-2 rounded-full bg-white/60" />
              Status
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            className="w-48 p-1 mb-1 bg-neutral-800 border border-neutral-700 text-white"
            side="top"
          >
            {statuses.map((s) => (
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-white/10 text-white text-left cursor-pointer"
                key={s.id}
                onClick={() => handleBulkStatus(s.id)}
                type="button"
              >
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="truncate">{s.name}</span>
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
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
              disabled={busy}
              type="button"
            >
              <CaretDownIcon className="size-3.5" />
              Move
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            className="w-56 p-1 mb-1 max-h-72 overflow-y-auto bg-neutral-800 border border-neutral-700 text-white"
            side="top"
          >
            {/* Sprint section */}
            <p className="px-2 py-1 text-2xs font-bold text-gray-400 uppercase tracking-wide">
              Sprint
            </p>
            {loadingSprints && (
              <p className="px-2 py-1.5 text-xs text-gray-400">Loading…</p>
            )}
            {!loadingSprints && sprints?.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-gray-400">
                No active sprints
              </p>
            )}
            {!loadingSprints &&
              sprints?.map((s) => (
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-white/10 text-white text-left cursor-pointer"
                  key={s.id}
                  onClick={() => handleMoveToSprint(s.id, s.name)}
                  type="button"
                >
                  <LightningIcon
                    className={cn(
                      "size-3.5 shrink-0",
                      s.status === "ACTIVE" ? "text-primary" : "text-gray-400"
                    )}
                    weight="fill"
                  />
                  <span className="flex-1 text-left truncate">{s.name}</span>
                  <span
                    className={cn(
                      "text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0",
                      s.status === "ACTIVE"
                        ? "bg-primary/20 text-primary-content"
                        : "bg-neutral-700 text-gray-300"
                    )}
                  >
                    {s.status === "ACTIVE" ? "Active" : "Planned"}
                  </span>
                </button>
              ))}

            {/* Divider */}
            <div className="h-px bg-neutral-700 my-1" />

            {/* List section */}
            <p className="px-2 py-1 text-2xs font-bold text-gray-400 uppercase tracking-wide">
              List
            </p>
            {loadingLists && (
              <p className="px-2 py-1.5 text-xs text-gray-400">Loading…</p>
            )}
            {!loadingLists && listSpaces?.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-gray-400">
                No other lists available
              </p>
            )}
            {!loadingLists &&
              listSpaces?.map((sp) => (
                <div key={sp.id}>
                  <p className="flex items-center gap-1.5 px-2 py-1 text-2xs font-bold text-gray-400 uppercase">
                    <SpaceIcon
                      color={sp.color ?? "#6B7280"}
                      emoji={sp.logoEmoji}
                    />
                    {sp.name}
                  </p>
                  {sp.lists.map((l) => (
                    <button
                      className="flex w-full items-center gap-2 rounded pl-5 pr-2 py-1.5 text-xs font-semibold hover:bg-white/10 text-white text-left cursor-pointer"
                      key={l.id}
                      onClick={() => handleMoveToList(l.id, l.name)}
                      type="button"
                    >
                      <span
                        className="size-1.5 rounded-full shrink-0"
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

        {/* Pin / Unpin to the top of the list. Both are shown whenever the
            selection contains tasks in that state, so a mixed selection can be
            pinned and unpinned in either direction. */}
        {canPinToList &&
          (unpinnedSelectedIds.length > 0 || pinnedSelectedIds.length > 0) && (
            <>
              <div className="h-4 w-px bg-white/20 mx-1" />
              {unpinnedSelectedIds.length > 0 && (
                <button
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
                  disabled={busy}
                  onClick={() => void handleBulkListPin(true)}
                  type="button"
                >
                  <PushPinIcon className="size-3.5" />
                  Pin ({unpinnedSelectedIds.length})
                </button>
              )}
              {pinnedSelectedIds.length > 0 && (
                <button
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
                  disabled={busy}
                  onClick={() => void handleBulkListPin(false)}
                  type="button"
                >
                  <PushPinSlashIcon className="size-3.5" />
                  Unpin ({pinnedSelectedIds.length})
                </button>
              )}
            </>
          )}

        <div className="h-4 w-px bg-white/20 mx-1" />

        {/* Export selected tasks to CSV */}
        <ExportSelectedButton
          scope={{ kind: "list", listId }}
          taskIds={[...selectedIds]}
        />

        <div className="h-4 w-px bg-white/20 mx-1" />

        {/* Archive — requires edit permission */}
        {canEdit && (
          <button
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
            disabled={busy}
            onClick={handleBulkArchive}
            type="button"
          >
            <ArchiveIcon className="size-3.5" />
            Archive
          </button>
        )}

        {/* Delete — admin only */}
        {isAdmin && (
          <button
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50 cursor-pointer"
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

// ─── View persistence ────────────────────────────────────────────────────────
// Remember Group By / Sort / Filters per list across reloads (per-browser). Not
// URL/backend — a full named-views system is out of scope.
type ListViewPrefs = {
  sortBy: "name" | "due" | "priority" | null;
  sortOrder: "asc" | "desc";
  groupBy: "status" | "priority" | "assignee";
  priorityFilter: string[];
  assigneeFilter: string[];
  statusFilter: string[];
  customFieldFilters: CustomFieldFilters;
  collapsedGroupIds: string[];
};

function listViewPrefsKey(listId: string) {
  return `kanbanica:list-view:${listId}`;
}

function loadListViewPrefs(listId: string): Partial<ListViewPrefs> | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(listViewPrefsKey(listId));
    return raw ? (JSON.parse(raw) as Partial<ListViewPrefs>) : null;
  } catch {
    return null;
  }
}

// ─── Main ListView Component ──────────────────────────────────────────────────

export function ListView({
  workspaceId,
  spaceId,
  listId,
  statuses,
  tasks,
  pinnedTasks = [],
  isAdmin,
  canEdit,
  canManage,
  canPinToList,
  currentUserId: _currentUserId,
  personallyPinnedIds,
  members = [],
  tags: _tags = [],
  customFields = [],
  archivedTasks,
  onArchivedChanged,
  showArchived,
  onToggleArchived,
  archivedLoading,
}: ListViewProps) {
  const router = useRouter();
  const columnOptions = React.useMemo(
    () => customFields.map((f) => ({ id: f.id, label: f.name })),
    [customFields]
  );
  // Display order only (alphabetical) — the hook above only needs the set of
  // valid ids, not the order, so it keeps using the unsorted `columnOptions`.
  const sortedColumnOptions = React.useMemo(
    () => [...columnOptions].sort((a, b) => a.label.localeCompare(b.label)),
    [columnOptions]
  );
  const { visibleIds: visibleColumnIds, setVisibleIds: setVisibleColumnIds } =
    useListColumnPreferences(listId, columnOptions);
  const visibleCustomFields = React.useMemo(
    () => customFields.filter((f) => visibleColumnIds.includes(f.id)),
    [customFields, visibleColumnIds]
  );
  const [createForStatusId, setCreateForStatusId] = React.useState<
    string | null
  >(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  // Local state for Search, Sort, Filter, and Group By inside the Workspace Container.
  // Start from defaults so the server and first client render match (localStorage
  // isn't available on the server); persisted prefs are applied after mount below.
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sortBy, setSortBy] = React.useState<SortKey | null>(null);
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("asc");

  // Single source of truth for sort, driven from two places: the column headers
  // (primary, desktop) and the toolbar dropdown (which is the only sort control
  // on mobile, where the header row is hidden). Clicking a column cycles
  // inactive → asc → desc → off; picking a *different* column always restarts
  // at ascending rather than inheriting the previous column's direction.
  const cycleSort = React.useCallback(
    (key: SortKey) => {
      if (sortBy !== key) {
        setSortBy(key);
        setSortOrder("asc");
        return;
      }
      if (sortOrder === "asc") {
        setSortOrder("desc");
        return;
      }
      setSortBy(null);
      setSortOrder("asc");
    },
    [sortBy, sortOrder]
  );
  const sortControl = React.useMemo<SortControl>(
    () => ({ sortBy, sortOrder, onSort: cycleSort }),
    [sortBy, sortOrder, cycleSort]
  );
  const [groupBy, setGroupBy] = React.useState<
    "status" | "priority" | "assignee"
  >("status");
  // Sort/Group By are single-select menus — picking an option closes the
  // popover immediately, same as FacetFilter's `single` mode.
  const [sortMenuOpen, setSortMenuOpen] = React.useState(false);
  const [groupByMenuOpen, setGroupByMenuOpen] = React.useState(false);
  // Only one group's inline "Add Task" row may be open at a time.
  const [openAddGroupId, setOpenAddGroupId] = React.useState<string | null>(
    null
  );
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  // Desktop "More" menu's Import dialog — mobile opens the same dialog via
  // ImportMenuRow's own internal state instead (see the mobile toolbar block).
  const [importOpen, setImportOpen] = React.useState(false);
  // Mobile-only "Filters" bottom sheet (see the mobile toolbar block below) —
  // desktop keeps every filter inline, so this only matters under `md:`.
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);

  const [priorityFilter, setPriorityFilter] = React.useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [customFieldFilters, setCustomFieldFilters] =
    React.useState<CustomFieldFilters>({});
  // Persisted alongside the other view prefs so collapsing a status group
  // survives navigating into a task and back (the group's own local state
  // would otherwise reset on remount).
  const [collapsedGroupIds, setCollapsedGroupIds] = React.useState<Set<string>>(
    new Set()
  );

  // Apply persisted view prefs after mount (avoids SSR/client hydration mismatch).
  // `prefsHydrated` gates the persist effect so we never overwrite saved prefs
  // with the defaults before they're loaded.
  const [prefsHydrated, setPrefsHydrated] = React.useState(false);
  React.useEffect(() => {
    const p = loadListViewPrefs(listId);
    if (p) {
      if (p.sortBy !== undefined) {
        setSortBy(p.sortBy);
      }
      if (p.sortOrder) {
        setSortOrder(p.sortOrder);
      }
      if (p.groupBy) {
        setGroupBy(p.groupBy);
      }
      if (p.priorityFilter) {
        setPriorityFilter(p.priorityFilter);
      }
      if (p.assigneeFilter) {
        setAssigneeFilter(p.assigneeFilter);
      }
      if (p.statusFilter) {
        setStatusFilter(p.statusFilter);
      }
      if (p.customFieldFilters) {
        setCustomFieldFilters(p.customFieldFilters);
      }
      if (p.collapsedGroupIds) {
        setCollapsedGroupIds(new Set(p.collapsedGroupIds));
      }
    }
    setPrefsHydrated(true);
  }, [listId]);

  // Persist view prefs whenever they change (only after hydration).
  React.useEffect(() => {
    if (!prefsHydrated) {
      return;
    }
    try {
      window.localStorage.setItem(
        listViewPrefsKey(listId),
        JSON.stringify({
          sortBy,
          sortOrder,
          groupBy,
          priorityFilter,
          assigneeFilter,
          statusFilter,
          customFieldFilters,
          collapsedGroupIds: [...collapsedGroupIds],
        })
      );
    } catch {
      // ignore quota / disabled storage
    }
  }, [
    prefsHydrated,
    listId,
    sortBy,
    sortOrder,
    groupBy,
    priorityFilter,
    assigneeFilter,
    statusFilter,
    customFieldFilters,
    collapsedGroupIds,
  ]);

  function setGroupCollapsed(groupId: string, next: boolean) {
    setCollapsedGroupIds((prev) => {
      const nextSet = new Set(prev);
      if (next) {
        nextSet.add(groupId);
      } else {
        nextSet.delete(groupId);
      }
      return nextSet;
    });
  }

  // ─── Filters (built-in + custom fields) ────────────────────────────────────
  // Option lists shared between the standalone toolbar buttons above and the
  // Filters builder below, so there's exactly one place that builds them.
  const statusOptions = React.useMemo(
    () => statuses.map((s) => ({ value: s.id, label: s.name, color: s.color })),
    [statuses]
  );
  const assigneeOptions = React.useMemo(
    () => [
      { value: "unassigned", label: "Unassigned" },
      ...members.map((m) => ({
        value: m.userId,
        label: m.name || m.email || "Unknown",
      })),
    ],
    [members]
  );
  // Status/Priority/Assignee already have their own dedicated toolbar
  // buttons directly above — the Filters builder is only for fields that
  // don't, so it stays the "custom + future advanced fields" picker rather
  // than duplicating what's already one click away.
  const filterFields = React.useMemo(
    () => customFields.map((field) => ({ key: field.id, label: field.name })),
    [customFields]
  );

  function isFilterFieldActive(key: string) {
    return isCustomFieldFilterActive(customFieldFilters[key]);
  }

  function clearFilterField(key: string) {
    setCustomFieldFilters((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function renderFilterControl(key: string) {
    const field = customFields.find((f) => f.id === key);
    if (!field) {
      return null;
    }
    return (
      <CustomFieldFilterControl
        field={field}
        members={members}
        onChange={(next) =>
          setCustomFieldFilters((prev) => ({ ...prev, [field.id]: next }))
        }
        value={customFieldFilters[field.id]}
      />
    );
  }

  // Optimistic DND tasks
  const [localTasks, setLocalTasks] = React.useState<Task[]>(tasks);

  React.useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleSelect = React.useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  // ─── Local Filtering & Sorting ─────────────────────────────────────────────
  const processedTasks = React.useMemo(() => {
    const list = filterTasks(
      localTasks,
      {
        searchQuery,
        statusFilter,
        priorityFilter,
        assigneeFilter,
        customFieldFilters,
      },
      customFields,
      members
    );

    // Sort
    if (sortBy) {
      list.sort((a, b) => {
        let cmp = 0;
        if (sortBy === "name") {
          cmp = a.title.localeCompare(b.title);
        } else if (sortBy === "due") {
          // Sort on the same field the Due Date column shows (`dueDateEnd`).
          // Undated tasks always sink to the bottom in BOTH directions —
          // reversing them into first place makes "sort by due date descending"
          // look like it hid every dated task behind a wall of blanks.
          const tA = a.dueDateEnd ? new Date(a.dueDateEnd).getTime() : null;
          const tB = b.dueDateEnd ? new Date(b.dueDateEnd).getTime() : null;
          if (tA === null || tB === null) {
            if (tA === tB) {
              return 0;
            }
            // Pre-negated so the `sortOrder` flip below leaves it unchanged.
            const undatedLast = tA === null ? 1 : -1;
            return sortOrder === "asc" ? undatedLast : -undatedLast;
          }
          cmp = tA - tB;
        } else if (sortBy === "priority") {
          const weight = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 };
          cmp = weight[a.priority] - weight[b.priority];
        }
        return sortOrder === "asc" ? cmp : -cmp;
      });
    }

    return list;
  }, [
    localTasks,
    searchQuery,
    priorityFilter,
    assigneeFilter,
    statusFilter,
    customFieldFilters,
    customFields,
    members,
    sortBy,
    sortOrder,
  ]);

  // Whether any filter narrows down the task set. When true, status/priority/
  // assignee groups that end up with zero matching tasks are hidden from
  // rendering (below) instead of showing as empty headers — otherwise a
  // filter like "Status: Done" still renders every other (now-empty) status
  // group above it, so the matching tasks appear buried at the bottom.
  const hasActiveFilter =
    statusFilter.length > 0 ||
    priorityFilter.length > 0 ||
    assigneeFilter.length > 0 ||
    searchQuery.trim().length > 0 ||
    Object.keys(customFieldFilters).length > 0;

  // Count shown on the mobile "Filters" button/chip row — search has its own
  // always-visible input on mobile, so it's deliberately excluded here (same
  // as `hasActiveFilter` above tracks one more thing: search).
  const mobileFilterCount =
    statusFilter.length +
    priorityFilter.length +
    assigneeFilter.length +
    Object.keys(customFieldFilters).length;

  function resetMobileFilters() {
    setStatusFilter([]);
    setPriorityFilter([]);
    setAssigneeFilter([]);
    setCustomFieldFilters({});
  }

  // ─── Group By logic ────────────────────────────────────────────────────────
  const groupedGroups = React.useMemo(() => {
    if (groupBy === "status") {
      return statuses.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        tasks: processedTasks.filter((t) => t.statusId === s.id),
      }));
    }
    if (groupBy === "priority") {
      const priorities: Task["priority"][] = [
        "URGENT",
        "HIGH",
        "MEDIUM",
        "LOW",
        "NONE",
      ];
      const priorityColors = {
        URGENT: "#EF4444",
        HIGH: "#F97316",
        MEDIUM: "#F59E0B",
        LOW: "#9CA3AF",
        NONE: "#6B7280",
      };
      return priorities.map((p) => ({
        id: p,
        name: p === "NONE" ? "NO PRIORITY" : p,
        color: priorityColors[p],
        tasks: processedTasks.filter((t) => t.priority === p),
      }));
    }
    if (groupBy === "assignee") {
      const resolvedMembers =
        members.length > 0
          ? members
          : (() => {
              const unique = new Map<
                string,
                { userId: string; name: string; image: string | null }
              >();
              for (const t of tasks) {
                for (const a of t.assignees) {
                  unique.set(a.userId, a);
                }
              }
              return Array.from(unique.values()).map((a) => ({
                userId: a.userId,
                name: a.name,
                email: null,
              }));
            })();

      const groups = resolvedMembers.map((m) => ({
        id: m.userId,
        name: m.name || m.email || "Unknown Member",
        color: "#8B5CF6",
        tasks: processedTasks.filter((t) =>
          t.assignees.some((a) => a.userId === m.userId)
        ),
      }));

      // Add unassigned group
      groups.push({
        id: "unassigned",
        name: "UNASSIGNED",
        color: "#6B7280",
        tasks: processedTasks.filter((t) => t.assignees.length === 0),
      });

      return groups;
    }
    return [];
  }, [processedTasks, groupBy, statuses, members, tasks]);

  // Previous/Next Task nav context: the exact order tasks currently appear on
  // screen top-to-bottom (Archived section when toggled on, then Pinned, then
  // each group) — handed to Task Detail so Prev/Next walks this same order
  // without a DB query. Recomputes whenever search/filter/sort/group/archived
  // changes, so it always reflects what's actually visible.
  const visibleOrderedTaskIds = React.useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const push = (id: string) => {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    };
    if (showArchived && archivedTasks) {
      for (const t of archivedTasks) {
        push(t.id);
      }
    }
    for (const t of pinnedTasks) {
      push(t.id);
    }
    for (const g of groupedGroups) {
      for (const t of g.tasks) {
        push(t.id);
      }
    }
    return ids;
  }, [showArchived, archivedTasks, pinnedTasks, groupedGroups]);

  // First OPEN workflow status — the sensible default for tasks created outside
  // a status group (e.g. quick-add under a Priority / Assignee group). Never a
  // closed/done status just because it happens to be first in the array.
  const defaultOpenStatusId =
    statuses.find((s) => s.type === "OPEN")?.id ??
    statuses.find((s) => s.type !== "CLOSED")?.id ??
    statuses[0]?.id;

  // Correct create-payload for a group's "Add Task", based on the active Group By.
  function quickCreateDefaultsFor(groupId: string): QuickCreateDefaults {
    if (groupBy === "status") {
      return { statusId: groupId };
    }
    if (groupBy === "priority") {
      return {
        priority: groupId as QuickCreateDefaults["priority"],
        statusId: defaultOpenStatusId,
      };
    }
    // assignee
    return {
      assigneeIds: groupId === "unassigned" ? [] : [groupId],
      statusId: defaultOpenStatusId,
    };
  }

  // Split the selection by list-pin state so the bulk bar can offer Pin and
  // Unpin independently. Pinned tasks are served in their own `pinnedTasks`
  // array and filtered out of `tasks` upstream, so both arrays must be
  // consulted — reading only `localTasks` would report every selection as
  // unpinned and leave bulk unpin with nothing to act on.
  const { pinnedSelectedIds, unpinnedSelectedIds } = React.useMemo(() => {
    const pinned: string[] = [];
    const unpinned: string[] = [];
    for (const t of [...pinnedTasks, ...localTasks]) {
      if (!selectedIds.has(t.id)) {
        continue;
      }
      (t.isPinnedToList ? pinned : unpinned).push(t.id);
    }
    return { pinnedSelectedIds: pinned, unpinnedSelectedIds: unpinned };
  }, [pinnedTasks, localTasks, selectedIds]);

  // Global Checkbox toggles
  const allSelected =
    processedTasks.length > 0 &&
    processedTasks.every((t) => selectedIds.has(t.id));
  const _someSelected = processedTasks.some((t) => selectedIds.has(t.id));

  function _toggleAll() {
    if (allSelected) {
      for (const t of processedTasks) {
        handleSelect(t.id, false);
      }
    } else {
      for (const t of processedTasks) {
        handleSelect(t.id, true);
      }
    }
  }

  // ─── Keyboard navigation ───────────────────────────────────────────────────
  // Focus lives in the DOM (rows carry `data-task-row`/`data-task-id` + tabIndex)
  // so arrow/j-k navigation never re-renders rows. Document order already
  // reflects grouping/sort/filter/collapse. Existing shortcuts are untouched.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.isContentEditable ||
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT");

      // Ctrl/Cmd/Alt combos are never ours (Shift is allowed — it forms "?").
      if (typing || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      // Don't hijack keys while an overlay (dialog / popover / dropdown / select)
      // is open — let it own the keyboard.
      if (isOverlayOpen()) {
        return;
      }

      // "/" focuses the search box (suppress the browser Quick Find).
      if (e.key === "/") {
        const el = document.getElementById(
          "list-view-search"
        ) as HTMLInputElement | null;
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
        return;
      }

      const rows = Array.from(
        document.querySelectorAll<HTMLElement>("[data-task-row]")
      );
      const active = document.activeElement as HTMLElement | null;
      const idx = active?.matches?.("[data-task-row]")
        ? rows.indexOf(active)
        : -1;
      const focusAt = (i: number) => {
        const el = rows[Math.max(0, Math.min(rows.length - 1, i))];
        if (el) {
          el.focus();
          el.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: "smooth",
          });
        }
      };

      switch (e.key) {
        case "ArrowDown":
        case "j": {
          if (rows.length === 0) {
            return;
          }
          e.preventDefault();
          focusAt(idx < 0 ? 0 : idx + 1);
          break;
        }
        case "ArrowUp":
        case "k": {
          if (rows.length === 0) {
            return;
          }
          e.preventDefault();
          focusAt(idx < 0 ? 0 : idx - 1);
          break;
        }
        case "Enter": {
          if (idx < 0) {
            return;
          }
          const id = rows[idx].getAttribute("data-task-id");
          if (id) {
            e.preventDefault();
            router.push(`/${workspaceId}/task/${id}?from=list`);
          }
          break;
        }
        case "x": {
          if (idx < 0) {
            return;
          }
          const id = rows[idx].getAttribute("data-task-id");
          if (id) {
            e.preventDefault();
            handleSelect(id, !selectedIds.has(id));
          }
          break;
        }
        case "c": {
          e.preventDefault();
          // Open the full Create Task popup (same as the "Create Task" button),
          // not the inline add-row composer.
          setCreateForStatusId(statuses[0]?.id || "");
          break;
        }
        case "Escape": {
          if (selectedIds.size > 0) {
            e.preventDefault();
            setSelectedIds(new Set());
          }
          active?.blur?.();
          break;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, workspaceId, selectedIds, statuses, handleSelect]);

  // ─── Drag & Drop Event Handlers ────────────────────────────────────────────
  function findGroupForTask(taskId: string) {
    const t = localTasks.find((tk) => tk.id === taskId);
    if (!t) {
      return null;
    }
    if (groupBy === "status") {
      return t.statusId;
    }
    if (groupBy === "priority") {
      return t.priority;
    }
    if (groupBy === "assignee") {
      return t.assignees[0]?.userId || "unassigned";
    }
    return null;
  }

  // Pause live auto-refresh while dragging so it can't clobber the drag.
  const pauseRealtime = useRealtimePause();
  const dragResumeRef = React.useRef<null | (() => void)>(null);
  const endDrag = React.useCallback(() => {
    dragResumeRef.current?.();
    dragResumeRef.current = null;
  }, []);
  function onDragStart() {
    endDrag();
    dragResumeRef.current = pauseRealtime();
  }
  function onDragCancel() {
    endDrag();
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeGroup = findGroupForTask(activeId);

    // over could be a status/group ID or a task ID
    let overGroup = overId;
    const isGroup =
      statuses.some((s) => s.id === overId) ||
      ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE", "NO PRIORITY"].includes(
        overId
      ) ||
      members.some((m) => m.userId === overId) ||
      overId === "unassigned";

    if (!isGroup) {
      overGroup = findGroupForTask(overId) || "";
    }

    if (!activeGroup || !overGroup || activeGroup === overGroup) {
      return;
    }

    // Optimistically update
    setLocalTasks((prev) =>
      prev.map((t) => {
        if (t.id === activeId) {
          if (groupBy === "status") {
            return { ...t, statusId: overGroup };
          }
          if (groupBy === "priority") {
            const cleanPriority =
              overGroup === "NO PRIORITY"
                ? "NONE"
                : (overGroup as Task["priority"]);
            return { ...t, priority: cleanPriority };
          }
          if (groupBy === "assignee") {
            if (overGroup === "unassigned") {
              return { ...t, assignees: [] };
            }
            const matchingMember = members.find((m) => m.userId === overGroup);
            if (matchingMember) {
              return {
                ...t,
                assignees: [
                  {
                    userId: matchingMember.userId,
                    name: matchingMember.name || "Member",
                    image: null,
                  },
                ],
              };
            }
          }
        }
        return t;
      })
    );
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    endDrag();
    if (!over) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    let newGroup = overId;
    const isGroup =
      statuses.some((s) => s.id === overId) ||
      ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE", "NO PRIORITY"].includes(
        overId
      ) ||
      members.some((m) => m.userId === overId) ||
      overId === "unassigned";

    if (!isGroup) {
      newGroup = findGroupForTask(overId) || "";
    }

    const origTask = tasks.find((t) => t.id === activeId);
    if (!origTask) {
      return;
    }

    if (groupBy === "status") {
      if (newGroup === origTask.statusId) {
        // Within-group reorder
        const groupTasks = localTasks.filter(
          (t) => t.statusId === origTask.statusId
        );
        const oldIndex = groupTasks.findIndex((t) => t.id === activeId);
        const newIndex = groupTasks.findIndex((t) => t.id === overId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
          return;
        }
        const reordered = arrayMove(groupTasks, oldIndex, newIndex);
        setLocalTasks((prev) => [
          ...prev.filter((t) => t.statusId !== origTask.statusId),
          ...reordered,
        ]);
        const res = await reorderTasksInStatus(
          workspaceId,
          spaceId,
          listId,
          reordered.map((t) => t.id)
        );
        if ("error" in res) {
          setLocalTasks(tasks);
          toast.error(res.error);
        }
        return;
      }
      const res = await updateTaskStatus(
        workspaceId,
        spaceId,
        listId,
        activeId,
        newGroup
      );
      if ("error" in res) {
        setLocalTasks(tasks);
      }
    } else if (groupBy === "priority") {
      const cleanPriority =
        newGroup === "NO PRIORITY" ? "NONE" : (newGroup as Task["priority"]);
      if (cleanPriority === origTask.priority) {
        return;
      }
      const res = await updateTask(workspaceId, spaceId, listId, activeId, {
        priority: cleanPriority,
      });
      if ("error" in res) {
        setLocalTasks(tasks);
      }
    } else if (groupBy === "assignee") {
      const prevAssigneeIds = origTask.assignees.map((a) => a.userId);
      const isUnassigned = newGroup === "unassigned";

      if (
        !isUnassigned &&
        prevAssigneeIds.length === 1 &&
        prevAssigneeIds[0] === newGroup
      ) {
        return;
      }

      for (const oldId of prevAssigneeIds) {
        await removeAssignee(workspaceId, spaceId, listId, activeId, oldId);
      }
      if (!isUnassigned) {
        await addAssignee(workspaceId, spaceId, listId, activeId, newGroup);
      }
      router.refresh();
    }
  }

  return (
    <>
      <CreateTaskModal
        canManage={canEdit || isAdmin}
        defaultStatusId={createForStatusId ?? undefined}
        listId={listId}
        onOpenChange={(open) => {
          if (!open) {
            setCreateForStatusId(null);
          }
        }}
        open={createForStatusId !== null}
        spaceId={spaceId}
        statuses={statuses}
        workspaceId={workspaceId}
      />

      <DndContext
        collisionDetection={closestCenter}
        id="list-dnd"
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
        sensors={sensors}
      >
        {/* ClickUp-style unified workspace container */}
        {/* `overflow-clip` (not `overflow-hidden`) still clips the rounded
            corners but is NOT a scroll container, so the sticky toolbar inside
            can pin to `<main>` instead of scrolling away with this card. */}
        <div className="w-full bg-elevated border border-base-300 rounded-2xl px-5 pb-5 pt-3 shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] overflow-clip flex flex-col gap-4">
          {/* Sticky Toolbar + Table Header Section. `top-14` clears the sticky
              List/Board/Calendar tabs above; `pt-3` (bg-elevated) keeps a bit of
              breathing room between the tabs and the pinned toolbar. z-10 keeps
              it above the scrolling rows but BELOW the mobile sidebar drawer +
              backdrop (z-20/z-30). */}
          <div className="sticky top-14 z-10 bg-elevated pt-5 pb-3 border-b border-base-300 flex flex-col gap-3">
            {/* Action Bar / Toolbar — desktop/tablet only; mobile gets its
                own compact toolbar below (same state/handlers, different
                presentation). */}
            <div className="hidden md:grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
              {/* Left column: primary controls, then a secondary block. A
                  plain flex-wrap row can't prioritize which group wraps
                  first — the browser sizes each flex item to its own
                  unwrapped content width before deciding what fits, so
                  Create Task (as a flex sibling) could get bumped to its
                  own line even while there's room to spare once the
                  secondary block reflows. Using CSS grid for the outer row
                  instead — a `minmax(0,1fr)` column for this div, `auto` for
                  Create Task — forces this column to actually shrink to its
                  allotted width, which is what makes its own flex-wrap
                  content (Secondary, then Primary) reflow internally rather
                  than pushing Create Task down. Primary (Search /
                  Status+Priority+Assignee / Filters / Sort / Group By /
                  Columns) is given priority to stay together; Secondary
                  (Manage Custom Fields / Archived / Keyboard shortcuts) is
                  its own non-wrapping unit so it moves to a second row as a
                  whole instead of peeling off one control at a time. */}
              <div className="flex items-center gap-4 flex-wrap min-w-0">
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Search */}
                  <SearchInput
                    className="min-w-0 flex-1 md:w-64 md:flex-none md:focus:w-80"
                    id="list-view-search"
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onClear={() => setSearchQuery("")}
                    placeholder="Search tasks…"
                    value={searchQuery}
                  />

                  {/* Filters — shared facet controls (same state + filter
                    logic). Kept exactly as standalone toolbar buttons — the
                    Filters builder is an additional entry point onto this
                    same state, not a replacement for these. Below 1300px
                    they'd wrap onto a second row one at a time, so under
                    that width they collapse into one CombinedFacetFilter
                    button instead — same state, same options, just grouped
                    under one popover. Only one of the two ever renders. */}
                  <div className="hidden min-[1300px]:flex items-center gap-2 flex-wrap">
                    <FacetFilter
                      label="Status"
                      onChange={setStatusFilter}
                      options={statusOptions}
                      selected={statusFilter}
                    />
                    <FacetFilter
                      label="Priority"
                      onChange={setPriorityFilter}
                      options={PRIORITY_OPTIONS}
                      selected={priorityFilter}
                    />
                    {members.length > 0 && (
                      <FacetFilter
                        label="Assignee"
                        onChange={setAssigneeFilter}
                        options={assigneeOptions}
                        searchable
                        selected={assigneeFilter}
                      />
                    )}
                  </div>
                  <CombinedFacetFilter
                    className="min-[1300px]:hidden"
                    groups={[
                      {
                        key: "status",
                        label: "Status",
                        options: statusOptions,
                        selected: statusFilter,
                        onChange: setStatusFilter,
                      },
                      {
                        key: "priority",
                        label: "Priority",
                        options: PRIORITY_OPTIONS,
                        selected: priorityFilter,
                        onChange: setPriorityFilter,
                      },
                      ...(members.length > 0
                        ? [
                            {
                              key: "assignee",
                              label: "Assignee",
                              options: assigneeOptions,
                              selected: assigneeFilter,
                              onChange: setAssigneeFilter,
                              searchable: true,
                            },
                          ]
                        : []),
                    ]}
                  />

                  {/* One compact "Filters" entry for custom fields only —
                    Status/Priority/Assignee already have dedicated buttons
                    above, so they're deliberately excluded here to avoid
                    duplicating them. Custom fields are picked dynamically
                    instead of getting their own always-visible toolbar
                    button, so the toolbar stays the same width no matter how
                    many custom fields a list has. Hidden entirely when there
                    are none — it would otherwise open onto an empty "No
                    filters yet" picker with nothing to add. */}
                  {filterFields.length > 0 && (
                    <FilterBuilder
                      fields={filterFields}
                      isActive={isFilterFieldActive}
                      onClear={clearFilterField}
                      renderControl={renderFilterControl}
                    />
                  )}

                  <div className="mx-1 h-5 w-px shrink-0 bg-base-300" />

                  {/* Sort — kept alongside the clickable column headers because
                    the header row is desktop-only (`hidden md:flex`); on mobile
                    this dropdown is the only way to sort. It drives the same
                    `cycleSort` the headers do, and now shows the direction so
                    the two controls can never disagree or read ambiguously. */}
                  <Popover onOpenChange={setSortMenuOpen} open={sortMenuOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className="flex items-center gap-1.5 h-8 rounded-lg border border-base-300 px-3 text-xs font-semibold text-base-content/70 hover:bg-base-200/30 transition-colors cursor-pointer select-none"
                        type="button"
                      >
                        <ArrowsDownUpIcon className="size-3.5 text-gray-500" />
                        Sort: {sortBy ? SORT_OPTION_LABEL[sortBy] : "None"}
                        {sortBy &&
                          (sortOrder === "asc" ? (
                            <CaretUpIcon
                              className="size-3 text-primary"
                              weight="bold"
                            />
                          ) : (
                            <CaretDownIcon
                              className="size-3 text-primary"
                              weight="bold"
                            />
                          ))}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-48 p-1 flex flex-col gap-0.5"
                    >
                      <button
                        className={cn(
                          "px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-base-200/30 cursor-pointer",
                          !sortBy && "bg-base-200 text-base-content"
                        )}
                        onClick={() => {
                          setSortBy(null);
                          setSortOrder("asc");
                          setSortMenuOpen(false);
                        }}
                        type="button"
                      >
                        None
                      </button>
                      {SORT_OPTIONS.map(({ key, label }) => {
                        const active = sortBy === key;
                        return (
                          <button
                            className={cn(
                              "flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-base-200/30 cursor-pointer",
                              active && "bg-base-200 text-base-content"
                            )}
                            key={key}
                            onClick={() => {
                              cycleSort(key);
                              setSortMenuOpen(false);
                            }}
                            type="button"
                          >
                            <span>{label}</span>
                            {active && (
                              <span className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wide text-primary">
                                {sortOrder === "asc" ? (
                                  <>
                                    <CaretUpIcon
                                      className="size-3"
                                      weight="bold"
                                    />
                                    Asc
                                  </>
                                ) : (
                                  <>
                                    <CaretDownIcon
                                      className="size-3"
                                      weight="bold"
                                    />
                                    Desc
                                  </>
                                )}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </PopoverContent>
                  </Popover>

                  {/* Group By */}
                  <Popover
                    onOpenChange={setGroupByMenuOpen}
                    open={groupByMenuOpen}
                  >
                    <PopoverTrigger asChild>
                      <button
                        className="flex items-center gap-1.5 h-8 rounded-lg border border-base-300 px-3 text-xs font-semibold text-base-content/70 hover:bg-base-200/30 transition-colors cursor-pointer select-none"
                        type="button"
                      >
                        <GearIcon className="size-3.5 text-gray-500" />
                        Group By:{" "}
                        {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-44 p-1 flex flex-col gap-0.5"
                    >
                      <button
                        className={cn(
                          "px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-base-200/30 cursor-pointer",
                          groupBy === "status" &&
                            "bg-base-200 text-base-content"
                        )}
                        onClick={() => {
                          setGroupBy("status");
                          setGroupByMenuOpen(false);
                        }}
                        type="button"
                      >
                        Status
                      </button>
                      <button
                        className={cn(
                          "px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-base-200/30 cursor-pointer",
                          groupBy === "priority" &&
                            "bg-base-200 text-base-content"
                        )}
                        onClick={() => {
                          setGroupBy("priority");
                          setGroupByMenuOpen(false);
                        }}
                        type="button"
                      >
                        Priority
                      </button>
                      <button
                        className={cn(
                          "px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-base-200/30 cursor-pointer",
                          groupBy === "assignee" &&
                            "bg-base-200 text-base-content"
                        )}
                        onClick={() => {
                          setGroupBy("assignee");
                          setGroupByMenuOpen(false);
                        }}
                        type="button"
                      >
                        Assignee
                      </button>
                    </PopoverContent>
                  </Popover>

                  {/* Columns — sectioned show/hide menu. Built-in columns are
                    listed for context but aren't toggleable yet (no
                    show/hide support exists for them today); custom fields
                    are the only interactive section, via the same generic
                    {id,label}[] the hook/FacetOptionList already take — a
                    future PR can make the Built-in section interactive
                    without restructuring this menu. */}
                  {columnOptions.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "flex h-8 shrink-0 select-none items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors",
                            visibleColumnIds.length > 0
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-base-300 text-base-content/60 hover:bg-base-200 hover:text-base-content"
                          )}
                          type="button"
                        >
                          <ColumnsIcon className="size-3.5 text-gray-500" />
                          Columns
                          {visibleColumnIds.length > 0 && (
                            <span className="font-bold">
                              ({visibleColumnIds.length})
                            </span>
                          )}
                          <CaretDownIcon className="size-3 opacity-60" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-56 rounded-xl p-1.5"
                      >
                        <p className="px-2 py-1 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                          Built-in
                        </p>
                        {/* Read-only for now — no show/hide mechanism exists for
                          built-in columns yet, so these are plain, non-
                          interactive rows rather than fake checkboxes. */}
                        <div className="mb-1.5 space-y-0.5">
                          {BUILT_IN_COLUMN_LABELS.map((label) => (
                            <div
                              className="px-2 py-1.5 text-xs text-base-content/70"
                              key={label}
                            >
                              {label}
                            </div>
                          ))}
                        </div>
                        <div className="my-1 h-px bg-base-300" />
                        <p className="px-2 py-1 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                          Custom Fields
                        </p>
                        <FacetOptionList
                          clearLabel="Clear Selection"
                          emptyText="No custom fields"
                          maxListHeight="220px"
                          onChange={setVisibleColumnIds}
                          options={sortedColumnOptions.map((c) => ({
                            value: c.id,
                            label: c.label,
                          }))}
                          searchable
                          searchPlaceholder="Search columns…"
                          selected={visibleColumnIds}
                          showClearDivider
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                {/* Secondary: Manage Custom Fields / More actions. `shrink-0`
                    and no `flex-wrap` keep this block non-breaking — it
                    either sits on the primary row or wraps to a new row
                    entirely, never split mid-group. Export/Import/Archived/
                    Keyboard Shortcuts live inside "More" (below) instead of
                    as separate icons, so this row stays compact. */}
                <div className="flex items-center gap-4 shrink-0">
                  <div className="h-5 w-px shrink-0 bg-base-300" />

                  {/* Manage Custom Fields — a discoverability shortcut straight
                      to Project Settings → Custom Fields, not a general
                      Settings button. Only shown to full-access members (same
                      permission requireFieldAdmin enforces for a space-scoped
                      field), and independent of whether any custom fields
                      exist yet — that's the whole point: it's how you'd go
                      create the first one when the Filters button is hidden. */}
                  {canManage && (
                    <button
                      className="flex items-center justify-center size-8 rounded-lg border border-base-300 text-base-content/60 hover:bg-base-200/30 hover:text-base-content transition-colors cursor-pointer"
                      onClick={() =>
                        router.push(
                          `/${workspaceId}/${spaceId}/settings/custom-fields`
                        )
                      }
                      title="Manage Custom Fields"
                      type="button"
                    >
                      <ManageFieldsIcon className="size-4" />
                    </button>
                  )}

                  {/* More actions — Export, Import, Archived, Keyboard
                      Shortcuts. Keeps the main toolbar row compact instead of
                      stacking a separate icon per secondary action. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label="More actions"
                        className="flex items-center justify-center size-8 rounded-lg border border-base-300 text-base-content/60 hover:bg-base-200/30 hover:text-base-content transition-colors cursor-pointer"
                        title="More actions"
                        type="button"
                      >
                        <DotsThreeIcon className="size-4" weight="bold" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        onClick={() =>
                          triggerExportDownload({ kind: "list", listId })
                        }
                      >
                        <DownloadSimpleIcon className="size-3.5" />
                        Export Tasks (CSV)
                      </DropdownMenuItem>
                      {canManage && (
                        <DropdownMenuItem onClick={() => setImportOpen(true)}>
                          <UploadSimpleIcon className="size-3.5" />
                          Import Tasks (CSV)
                        </DropdownMenuItem>
                      )}
                      {onToggleArchived && (
                        <DropdownMenuCheckboxItem
                          checked={showArchived}
                          onCheckedChange={() => onToggleArchived()}
                        >
                          <ArchiveIcon className="size-3.5" />
                          Archived Tasks
                        </DropdownMenuCheckboxItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
                        <KeyboardIcon className="size-3.5" />
                        Keyboard Shortcuts
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Right actions: Create Task button */}
              <button
                className="flex items-center gap-1.5 h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-content hover:bg-primary/95 transition-all shadow-sm shrink-0 cursor-pointer select-none"
                onClick={() => setCreateForStatusId(statuses[0]?.id || "")}
                type="button"
              >
                <PlusIcon className="size-3.5" weight="bold" />
                Create Task
              </button>
            </div>

            {/* ── Mobile toolbar (below md:) ────────────────────────────────
                Same state/handlers as the desktop toolbar above — this is a
                presentation-only split, not a second filtering
                implementation. Search + a compact Create button up top, a
                single "Filters" entry point (Status/Priority/Assignee/Sort/
                Group By/Archived/custom fields all live in a bottom sheet)
                instead of every control inline, an overflow menu for the
                desktop-only utility controls (Manage Custom Fields/Columns/
                Keyboard shortcuts), and active-filter chips below. */}
            <div className="flex flex-col gap-2 md:hidden">
              <div className="flex items-center gap-2">
                <SearchInput
                  className="min-w-0 flex-1"
                  id="list-view-search-mobile"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onClear={() => setSearchQuery("")}
                  placeholder="Search tasks…"
                  value={searchQuery}
                />
                <button
                  aria-label="Create task"
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-content shadow-sm transition-all hover:bg-primary/95"
                  onClick={() => setCreateForStatusId(statuses[0]?.id || "")}
                  type="button"
                >
                  <PlusIcon className="size-4.5" weight="bold" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <Sheet
                  onOpenChange={setMobileFiltersOpen}
                  open={mobileFiltersOpen}
                >
                  <SheetTrigger asChild>
                    <button
                      className={cn(
                        "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold transition-colors",
                        mobileFilterCount > 0
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-base-300 text-base-content/60 hover:bg-base-200 hover:text-base-content"
                      )}
                      type="button"
                    >
                      <FunnelIcon className="size-4" />
                      Filters
                      {mobileFilterCount > 0 && (
                        <span className="font-bold">({mobileFilterCount})</span>
                      )}
                    </button>
                  </SheetTrigger>
                  <SheetContent
                    className="flex max-h-[85dvh] flex-col rounded-t-2xl"
                    side="bottom"
                  >
                    <SheetHeader className="p-4 pb-2">
                      <SheetTitle>Filters</SheetTitle>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
                      <div>
                        <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                          Status
                        </p>
                        <FacetOptionList
                          onChange={setStatusFilter}
                          options={statusOptions}
                          selected={statusFilter}
                        />
                      </div>

                      <div>
                        <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                          Priority
                        </p>
                        <FacetOptionList
                          onChange={setPriorityFilter}
                          options={PRIORITY_OPTIONS}
                          selected={priorityFilter}
                        />
                      </div>

                      {members.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                            Assignee
                          </p>
                          <FacetOptionList
                            onChange={setAssigneeFilter}
                            options={assigneeOptions}
                            searchable
                            searchPlaceholder="Search people…"
                            selected={assigneeFilter}
                          />
                        </div>
                      )}

                      <div className="h-px bg-base-300" />

                      <div>
                        <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                          Sort
                        </p>
                        <div className="flex flex-col gap-0.5">
                          <button
                            className={cn(
                              "rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-base-200",
                              !sortBy && "bg-base-200 text-base-content"
                            )}
                            onClick={() => {
                              setSortBy(null);
                              setSortOrder("asc");
                            }}
                            type="button"
                          >
                            None
                          </button>
                          {SORT_OPTIONS.map(({ key, label }) => {
                            const active = sortBy === key;
                            return (
                              <button
                                className={cn(
                                  "flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-base-200",
                                  active && "bg-base-200 text-base-content"
                                )}
                                key={key}
                                onClick={() => cycleSort(key)}
                                type="button"
                              >
                                <span>{label}</span>
                                {active && (
                                  <span className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wide text-primary">
                                    {sortOrder === "asc" ? (
                                      <>
                                        <CaretUpIcon
                                          className="size-3"
                                          weight="bold"
                                        />
                                        Asc
                                      </>
                                    ) : (
                                      <>
                                        <CaretDownIcon
                                          className="size-3"
                                          weight="bold"
                                        />
                                        Desc
                                      </>
                                    )}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                          Group By
                        </p>
                        <div className="flex flex-col gap-0.5">
                          {(["status", "priority", "assignee"] as const).map(
                            (g) => (
                              <button
                                className={cn(
                                  "rounded-md px-2.5 py-2 text-left text-sm font-medium capitalize hover:bg-base-200",
                                  groupBy === g &&
                                    "bg-base-200 text-base-content"
                                )}
                                key={g}
                                onClick={() => setGroupBy(g)}
                                type="button"
                              >
                                {g}
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      {onToggleArchived && (
                        <>
                          <div className="h-px bg-base-300" />
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                              Show archived
                            </span>
                            <Switch
                              checked={!!showArchived}
                              onCheckedChange={() => onToggleArchived()}
                            />
                          </div>
                        </>
                      )}

                      {filterFields.length > 0 && (
                        <>
                          <div className="h-px bg-base-300" />
                          <div>
                            <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                              More filters
                            </p>
                            <FilterBuilder
                              fields={filterFields}
                              isActive={isFilterFieldActive}
                              onClear={clearFilterField}
                              renderControl={renderFilterControl}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <SheetFooter className="flex-row gap-2 border-t border-base-300 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                      <button
                        className="h-11 flex-1 rounded-lg border border-base-300 text-sm font-semibold text-base-content/70 transition-colors hover:bg-base-200"
                        onClick={resetMobileFilters}
                        type="button"
                      >
                        Reset
                      </button>
                      <SheetClose asChild>
                        <button
                          className="h-11 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-content transition-all hover:bg-primary/95"
                          type="button"
                        >
                          Apply
                        </button>
                      </SheetClose>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>

                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      aria-label="More actions"
                      className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-base-300 text-base-content/60 transition-colors hover:bg-base-200/30 hover:text-base-content"
                      type="button"
                    >
                      <DotsThreeIcon className="size-5" weight="bold" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 rounded-xl p-1.5">
                    {canManage && (
                      <button
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-base-200"
                        onClick={() =>
                          router.push(
                            `/${workspaceId}/${spaceId}/settings/custom-fields`
                          )
                        }
                        type="button"
                      >
                        <ManageFieldsIcon className="size-4 text-base-content/60" />
                        Manage Custom Fields
                      </button>
                    )}
                    <ExportMenuRow scope={{ kind: "list", listId }} />
                    {canManage && (
                      <ImportMenuRow
                        listId={listId}
                        spaceId={spaceId}
                        workspaceId={workspaceId}
                      />
                    )}
                    {columnOptions.length > 0 && (
                      <div className="px-1 py-1.5">
                        <p className="px-1.5 pb-1 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                          Columns
                        </p>
                        <FacetOptionList
                          emptyText="No custom fields"
                          onChange={setVisibleColumnIds}
                          options={sortedColumnOptions.map((c) => ({
                            value: c.id,
                            label: c.label,
                          }))}
                          searchable
                          searchPlaceholder="Search columns…"
                          selected={visibleColumnIds}
                        />
                      </div>
                    )}
                    <div className="my-1 h-px bg-base-300" />
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-base-200"
                      onClick={() => setShortcutsOpen(true)}
                      type="button"
                    >
                      <KeyboardIcon className="size-4 text-base-content/60" />
                      Keyboard Shortcuts
                    </button>
                  </PopoverContent>
                </Popover>
              </div>

              {mobileFilterCount > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {statusFilter.map((sId) => {
                    const s = statuses.find((st) => st.id === sId);
                    if (!s) {
                      return null;
                    }
                    return (
                      <FilterChip
                        key={sId}
                        label={s.name}
                        onRemove={() =>
                          setStatusFilter(
                            statusFilter.filter((id) => id !== sId)
                          )
                        }
                      />
                    );
                  })}
                  {priorityFilter.map((p) => (
                    <FilterChip
                      key={p}
                      label={p.charAt(0) + p.slice(1).toLowerCase()}
                      onRemove={() =>
                        setPriorityFilter(priorityFilter.filter((v) => v !== p))
                      }
                    />
                  ))}
                  {assigneeFilter.map((aId) => {
                    const m = assigneeOptions.find((o) => o.value === aId);
                    return (
                      <FilterChip
                        key={aId}
                        label={m?.label ?? aId}
                        onRemove={() =>
                          setAssigneeFilter(
                            assigneeFilter.filter((id) => id !== aId)
                          )
                        }
                      />
                    );
                  })}
                  {filterFields
                    .filter((f) => isFilterFieldActive(f.key))
                    .map((f) => (
                      <FilterChip
                        key={f.key}
                        label={f.label}
                        onRemove={() => clearFilterField(f.key)}
                      />
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Archived tasks section — shown at the top (above pinned/status
              groups) so toggling "Archived" on doesn't require scrolling
              past the whole active list to find it. Rows navigate to the
              task like any other row; the Unarchive button stops
              propagation so it doesn't also trigger that navigation. */}
          {showArchived && (
            <div className="mb-6 border border-base-300 rounded-xl overflow-hidden bg-base-200/20">
              <div className="flex items-center gap-2 px-4 py-2 bg-base-200/50 text-xs font-bold text-base-content/60 uppercase tracking-wide border-b border-base-300 select-none">
                <ArchiveIcon className="size-4" />
                Archived ({archivedTasks?.length ?? 0})
              </div>
              {(!archivedTasks || archivedTasks.length === 0) && (
                <div className="px-4 py-6 text-center text-xs text-base-content/60 italic">
                  {archivedLoading
                    ? "Loading archived tasks…"
                    : "No archived tasks"}
                </div>
              )}
              <div className="divide-y divide-border">
                {archivedTasks?.map((t) => (
                  // biome-ignore lint/a11y/useSemanticElements: wraps a nested interactive "Unarchive" button, so it can't literally be a <button>; kept keyboard-accessible via role+tabIndex+onKeyDown
                  <div
                    className="group flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-base-200/30"
                    key={t.id}
                    onClick={() => {
                      setTaskNavContext({ taskIds: visibleOrderedTaskIds });
                      router.push(`/${workspaceId}/task/${t.id}?from=list`);
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) {
                        return;
                      }
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setTaskNavContext({ taskIds: visibleOrderedTaskIds });
                        router.push(`/${workspaceId}/task/${t.id}?from=list`);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="text-2xs text-base-content/60 font-mono shrink-0 select-none">
                      #{t.seqNumber}
                    </span>
                    <span className="flex-1 text-[13px] text-base-content/60 font-medium line-through truncate">
                      {t.title}
                    </span>
                    <button
                      className="invisible flex shrink-0 items-center gap-1.5 rounded-lg border border-base-300 bg-base-100 px-2.5 py-1 text-2xs font-semibold text-base-content/60 transition-colors group-hover:visible hover:text-base-content cursor-pointer select-none"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await unarchiveTask(workspaceId, spaceId, listId, t.id);
                        await onArchivedChanged?.();
                        toastWithUndo("Task unarchived", async () => {
                          await archiveTask(workspaceId, spaceId, listId, t.id);
                          await onArchivedChanged?.();
                        });
                      }}
                      type="button"
                    >
                      <ArchiveIcon className="size-3.5 text-base-content/60" />
                      Unarchive
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pinned tasks sticky section */}
          {pinnedTasks.length > 0 && (
            <PinnedSection
              canEdit={canEdit}
              canPinToList={canPinToList}
              isAdmin={isAdmin}
              listId={listId}
              onSelect={handleSelect}
              personallyPinnedIds={personallyPinnedIds}
              selectedIds={selectedIds}
              spaceId={spaceId}
              statuses={statuses}
              taskNavIds={visibleOrderedTaskIds}
              tasks={pinnedTasks}
              visibleCustomFields={visibleCustomFields}
              workspaceId={workspaceId}
              workspaceMembers={members}
            />
          )}

          {/* Group Content Container */}
          <div className="flex flex-col gap-6">
            {(hasActiveFilter
              ? groupedGroups.filter((group) => group.tasks.length > 0)
              : groupedGroups
            ).map((group) => (
              <StatusGroup
                addOpen={openAddGroupId === group.id}
                canEdit={canEdit}
                canPinToList={canPinToList}
                collapsed={collapsedGroupIds.has(group.id)}
                createDefaults={quickCreateDefaultsFor(group.id)}
                isAdmin={isAdmin}
                key={group.id}
                listId={listId}
                onAddOpenChange={(v) => setOpenAddGroupId(v ? group.id : null)}
                onCollapsedChange={(v) => setGroupCollapsed(group.id, v)}
                onSelect={handleSelect}
                personallyPinnedIds={personallyPinnedIds}
                selectedIds={selectedIds}
                sortControl={sortControl}
                spaceId={spaceId}
                status={{
                  id: group.id,
                  name: group.name,
                  color: group.color,
                  type: "OPEN",
                  orderIndex: 0,
                }}
                statuses={statuses}
                taskNavIds={visibleOrderedTaskIds}
                tasks={group.tasks}
                visibleCustomFields={visibleCustomFields}
                workspaceId={workspaceId}
                workspaceMembers={members}
              />
            ))}
          </div>
        </div>
      </DndContext>

      {/* Floating Action Button (FAB) for mobile task creation */}
      <button
        className="md:hidden fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer"
        onClick={() => setCreateForStatusId(statuses[0]?.id || "")}
        title="Create Task"
        type="button"
      >
        <PlusIcon className="size-6 font-bold" />
      </button>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          canEdit={canEdit}
          canPinToList={canPinToList}
          count={selectedIds.size}
          isAdmin={isAdmin}
          listId={listId}
          members={members}
          onClear={() => setSelectedIds(new Set())}
          onRefresh={() => router.refresh()}
          pinnedSelectedIds={pinnedSelectedIds}
          selectedIds={selectedIds}
          spaceId={spaceId}
          statuses={statuses}
          unpinnedSelectedIds={unpinnedSelectedIds}
          workspaceId={workspaceId}
        />
      )}

      <KeyboardShortcutsDialog
        onOpenChange={setShortcutsOpen}
        open={shortcutsOpen}
      />

      {/* Opened from the desktop "More" menu above; mobile opens the same
          dialog via ImportMenuRow's own internal state instead. */}
      <ImportWizardDialog
        listId={listId}
        onOpenChange={setImportOpen}
        open={importOpen}
        spaceId={spaceId}
        workspaceId={workspaceId}
      />
    </>
  );
}
