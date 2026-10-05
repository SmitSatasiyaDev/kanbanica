"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
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
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowsDownUpIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CheckSquareIcon,
  CircleIcon,
  CopyIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FlagIcon,
  FunnelIcon,
  HashIcon,
  KeyboardIcon,
  LinkIcon,
  ListPlusIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TextAaIcon,
  TrashIcon,
  UploadSimpleIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import type { CustomFieldRow } from "@/app/actions/custom-field";
import { createListStatus } from "@/app/actions/list";
import {
  archiveTask,
  createSubtask,
  deleteTask,
  duplicateTask,
  getSubtasks,
  reorderTasksInStatus,
  unarchiveTask,
  updateTask,
  updateTaskStatus,
} from "@/app/actions/task";
import { addAssignee, removeAssignee } from "@/app/actions/task-assignee";
import { ManageFieldsIcon } from "@/components/common/manage-fields-icon";
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
  TaskDependencyBadge,
  type TaskDependencyIndicator,
} from "@/components/task/task-dependency-badge";
import { TrackedTimeBadge } from "@/components/task/tracked-time-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCreateTaskShortcut } from "@/hooks/use-create-task-shortcut";
import { useListColumnPreferences } from "@/hooks/use-list-column-preferences";
import { taskUrl } from "@/lib/app-url";
import { describeCustomFieldValue } from "@/lib/custom-fields/column-display";
import {
  type CustomFieldFilters,
  isCustomFieldFilterActive,
} from "@/lib/custom-fields/filters";
import {
  DASHBOARD_CATEGORY_OPTIONS,
  type DashboardCategory,
} from "@/lib/dashboard-category";
import {
  flashDuplicatedTask,
  useIsDuplicateHighlighted,
} from "@/lib/duplicate-highlight";
import { PRIORITY_OPTIONS } from "@/lib/filters/options";
import { filterTasks } from "@/lib/filters/task-filter";
import { formatDueDate } from "@/lib/priority-config";
import { STATUS_PRESET_COLORS } from "@/lib/status-colors";
import { setTaskNavContext } from "@/lib/task-nav-context";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";
import { QuickCreateTask } from "./quick-create-task";

type BoardMember = {
  userId: string;
  name: string | null;
  email: string | null;
  image?: string | null;
};

function userInitials(name: string) {
  if (!name) {
    return "?";
  }
  const clean = name.includes("@") ? name.split("@")[0] : name;
  return (
    clean
      .split(/[\s._-]+/)
      .map((n) => n[0])
      .filter(Boolean)
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

function avatarSrc(key: string | null | undefined): string | undefined {
  return key ? `/api/files/${key}` : undefined;
}

interface Status {
  color: string;
  id: string;
  name: string;
  orderIndex: number;
  type: "OPEN" | "ACTIVE" | "CLOSED";
}

interface Task {
  assignees: { userId: string; name: string; image: string | null }[];
  customFieldValues?: Record<string, unknown>;
  dependencyInfo?: TaskDependencyIndicator;
  dueDateEnd: Date | null;
  dueDateStart: Date | null;
  id: string;
  orderIndex: number;
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  seqNumber: number;
  statusId: string | null;
  subtaskCount: number;
  tags: { id: string; name: string; color: string }[];
  title: string;
  trackedSeconds?: number;
}

interface SubtaskRow {
  id: string;
  orderIndex: number;
  priority: string;
  seqNumber: number;
  statusColor: string | null;
  statusId: string | null;
  statusName: string | null;
  statusType: "OPEN" | "ACTIVE" | "CLOSED" | null;
  title: string;
}

interface BoardViewProps {
  archivedLoading?: boolean;
  archivedTasks?: { id: string; title: string; seqNumber: number }[];
  canEdit?: boolean;
  canManage?: boolean;
  customFields?: CustomFieldRow[];
  headerless?: boolean;
  isAdmin?: boolean;
  list: {
    id: string;
    name: string;
    color?: string | null;
    description?: string | null;
  };
  members?: BoardMember[];
  onArchivedChanged?: () => Promise<void>;
  onToggleArchived?: () => void;
  showArchived?: boolean;
  space: {
    id: string;
    name: string;
    color: string | null;
    logoEmoji: string | null;
  };
  statuses: Status[];
  tags?: { id: string; name: string; color: string }[];
  tasks: Task[];
  workspaceId: string;
}

// ─── Custom field card display (read-only) ──────────────────────────────────
// Board cards never edit custom fields (Task Detail / drawer own that) — this
// only turns a value into a compact, presentational node. Returns null for an
// empty value so the caller can skip rendering the field entirely (cards hide
// empty fields rather than showing a placeholder, unlike the row/detail
// editors in custom-field-editors.tsx).
function renderCardCustomField(
  field: CustomFieldRow,
  value: unknown,
  members: BoardMember[]
): React.ReactNode | null {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return null;
  }

  if (field.type === "CHECKBOX") {
    if (!value) {
      return null;
    }
    return (
      <Tooltip key={field.id}>
        <TooltipTrigger asChild>
          <span className="flex items-center text-primary">
            <CheckSquareIcon className="size-3.5" weight="fill" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{field.name}</TooltipContent>
      </Tooltip>
    );
  }

  if (field.type === "PERSON") {
    const person = members.find((m) => m.userId === value);
    if (!person) {
      return null;
    }
    return (
      <Tooltip key={field.id}>
        <TooltipTrigger asChild>
          <Avatar className="size-6 shrink-0 border-2 border-base-100">
            {person.image && (
              <AvatarImage
                alt={person.name ?? undefined}
                src={avatarSrc(person.image)}
              />
            )}
            <AvatarFallback className="text-2xs font-semibold bg-primary text-primary-content">
              {userInitials(person.name || person.email || "?")}
            </AvatarFallback>
          </Avatar>
        </TooltipTrigger>
        <TooltipContent side="top">
          {field.name}: {describeCustomFieldValue(field, value, members)}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (field.type === "SINGLE_SELECT") {
    const option = field.config.options?.find((o) => o.id === value);
    if (!option) {
      return null;
    }
    return (
      <span
        className="shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-medium"
        key={field.id}
        style={{
          backgroundColor: `${option.color ?? "#9CA3AF"}20`,
          color: option.color ?? "#6B7280",
        }}
        title={`${field.name}: ${option.label}`}
      >
        {option.label}
      </span>
    );
  }

  if (field.type === "MULTI_SELECT") {
    const ids = Array.isArray(value) ? (value as string[]) : [];
    const options = field.config.options ?? [];
    const selected = ids
      .map((id) => options.find((o) => o.id === id))
      .filter((o): o is NonNullable<typeof o> => !!o);
    if (selected.length === 0) {
      return null;
    }
    const shown = selected.slice(0, 2);
    const extra = selected.length - shown.length;
    return (
      <span className="flex shrink-0 items-center gap-1" key={field.id}>
        {shown.map((o) => (
          <span
            className="rounded-full px-1.5 py-0.5 text-2xs font-medium"
            key={o.id}
            style={{
              backgroundColor: `${o.color ?? "#9CA3AF"}20`,
              color: o.color ?? "#6B7280",
            }}
            title={`${field.name}: ${o.label}`}
          >
            {o.label}
          </span>
        ))}
        {extra > 0 && (
          <span
            className="text-2xs font-medium text-base-content/60"
            title={`${field.name}: ${selected.map((o) => o.label).join(", ")}`}
          >
            +{extra}
          </span>
        )}
      </span>
    );
  }

  // TEXT / NUMBER / DATE — plain truncated text, formatted by the same helper
  // the List View column cells use.
  const text = describeCustomFieldValue(field, value, members);
  if (!text) {
    return null;
  }
  return (
    <span
      className="max-w-[110px] truncate text-2xs font-medium text-base-content/60"
      key={field.id}
      title={`${field.name}: ${text}`}
    >
      {field.type === "DATE" && (
        <CalendarBlankIcon className="-mt-0.5 mr-0.5 inline size-3" />
      )}
      {text}
    </span>
  );
}

// Caps how many custom-field chips a single card shows, regardless of how
// many fields are enabled in the "Fields" menu — keeps card height compact
// even when a list has many custom fields turned on. Extras collapse into a
// single "+N more" chip rather than growing the card.
const MAX_CARD_CUSTOM_FIELDS = 4;

const PRIORITY_ORDER: Record<Task["priority"], number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
};

const PRIORITY_CONFIG: Record<
  Task["priority"],
  { label: string; color: string; icon: string }
> = {
  NONE: { label: "No Priority", color: "text-base-content/60", icon: "😴" },
  LOW: { label: "Low", color: "text-base-content/60", icon: "🦥" },
  MEDIUM: { label: "Medium", color: "text-yellow-600", icon: "🚶" },
  HIGH: { label: "High", color: "text-orange-500", icon: "🏃" },
  URGENT: { label: "Urgent", color: "text-red-500", icon: "🚨" },
};

// ─── Card visual (no dnd hooks) ──────────────────────────────────────────────

function CardContent({
  task,
  overlay = false,
  isDragging = false,
  dragListeners,
  workspaceId,
  spaceId,
  listId,
  statuses,
  canEdit,
  isAdmin,
  onRefresh,
  customFields = [],
  members = [],
}: {
  task: Task;
  overlay?: boolean;
  isDragging?: boolean;
  dragListeners?: React.HTMLAttributes<HTMLDivElement>;
  workspaceId?: string;
  spaceId?: string;
  listId?: string;
  statuses?: Status[];
  canEdit?: boolean;
  isAdmin?: boolean;
  onRefresh?: () => void;
  customFields?: CustomFieldRow[];
  members?: BoardMember[];
}) {
  const router = useRouter();

  // The hover quick-actions render only on real (non-overlay) cards that were
  // handed the workspace/list context. The drag overlay stays purely visual.
  const interactive =
    !overlay && !!workspaceId && !!spaceId && !!listId && !!onRefresh;
  const highlighted = useIsDuplicateHighlighted(task.id);

  // Only fields with a real, non-empty value render — cards hide empty
  // custom fields entirely rather than showing a placeholder (unlike the
  // List View / Task Detail editors). Beyond MAX_CARD_CUSTOM_FIELDS, the rest
  // collapse into a single "+N more" chip so an enthusiastically-configured
  // Fields menu can't blow up card height.
  const resolvedCustomFieldNodes = customFields
    .map((field) =>
      renderCardCustomField(field, task.customFieldValues?.[field.id], members)
    )
    .filter((node) => node !== null);
  const customFieldNodes = resolvedCustomFieldNodes.slice(
    0,
    MAX_CARD_CUSTOM_FIELDS
  );
  const hiddenCustomFieldCount =
    resolvedCustomFieldNodes.length - customFieldNodes.length;

  // Inline rename — mirrors the list-row flow (updateTask({ title })).
  const [localTitle, setLocalTitle] = React.useState(task.title);
  const [renaming, setRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(task.title);
  React.useEffect(() => {
    setLocalTitle(task.title);
  }, [task.title]);

  // Show a tooltip with the full title only when it's actually clipped by the
  // 2-line clamp (vertical) or an unbreakable word (horizontal).
  const titleRef = React.useRef<HTMLParagraphElement>(null);
  const [titleTruncated, setTitleTruncated] = React.useState(false);
  React.useEffect(() => {
    const el = titleRef.current;
    setTitleTruncated(
      el
        ? el.scrollHeight > el.clientHeight + 1 ||
            el.scrollWidth > el.clientWidth + 1
        : false
    );
  }, []);

  // Add-subtask mini composer + delete confirm.
  const [subtaskOpen, setSubtaskOpen] = React.useState(false);
  const [subtaskTitle, setSubtaskTitle] = React.useState("");
  const [creatingSubtask, setCreatingSubtask] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  // Quick-set popovers for assignee/due date/priority — shown as small
  // icon affordances only when the field is unset, so a card can get a
  // first assignee/date/priority without opening the task (mirrors
  // task-list-row.tsx's inline cells).
  const [assigneeOpen, setAssigneeOpen] = React.useState(false);
  const [memberSearch, setMemberSearch] = React.useState("");
  const [dateOpen, setDateOpen] = React.useState(false);
  const [priorityOpen, setPriorityOpen] = React.useState(false);
  // The "More" menu is controlled so an action (Duplicate/Archive/…) can close
  // it on click. Left uncontrolled, the menu stayed open over the card and the
  // result only became visible once the user clicked outside.
  const [menuOpen, setMenuOpen] = React.useState(false);
  const dueDate = formatDueDate(task.dueDateEnd);
  const filteredMembers = members.filter((m) => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) {
      return true;
    }
    return (m.name ?? m.email ?? "").toLowerCase().includes(q);
  });

  // Assignees render from local state so picking one applies on the click
  // itself, instead of only appearing after the server round-trip + refresh
  // (which read as "it commits when you click outside").
  const [localAssignees, setLocalAssignees] = React.useState(task.assignees);
  React.useEffect(() => {
    setLocalAssignees(task.assignees);
  }, [task.assignees]);

  async function handleToggleAssignee(userId: string) {
    const isAssigned = localAssignees.some((a) => a.userId === userId);
    const member = members.find((m) => m.userId === userId);
    const previous = localAssignees;
    setLocalAssignees(
      isAssigned
        ? previous.filter((a) => a.userId !== userId)
        : [
            ...previous,
            {
              userId,
              name: member?.name ?? member?.email ?? "Unknown",
              image: member?.image ?? null,
            },
          ]
    );
    setAssigneeOpen(false);
    setMemberSearch("");
    const res = isAssigned
      ? await removeAssignee(
          workspaceId!,
          spaceId!,
          listId ?? null,
          task.id,
          userId
        )
      : await addAssignee(
          workspaceId!,
          spaceId!,
          listId ?? null,
          task.id,
          userId
        );
    if (res && "error" in res) {
      setLocalAssignees(previous); // revert
      toast.error(res.error);
      return;
    }
    onRefresh?.();
  }

  async function handleSetDueDate(date: Date | null) {
    setDateOpen(false);
    // "Due Date" is the deadline (end date). Preserve an existing start date;
    // for tasks with no start, set both so single-date tasks stay consistent.
    const patch = task.dueDateStart
      ? { dueDateEnd: date }
      : { dueDateStart: date, dueDateEnd: date };
    const res = await updateTask(
      workspaceId!,
      spaceId!,
      listId ?? null,
      task.id,
      patch
    );
    if (res && "error" in res) {
      toast.error("Failed to update due date");
      return;
    }
    onRefresh?.();
  }

  async function handleSetPriority(p: Task["priority"]) {
    setPriorityOpen(false);
    const res = await updateTask(
      workspaceId!,
      spaceId!,
      listId ?? null,
      task.id,
      {
        priority: p,
      }
    );
    if (res && "error" in res) {
      toast.error("Failed to update priority");
      return;
    }
    onRefresh?.();
  }

  // Collapsible subtask list — collapsed by default (per requirements) so a
  // task with subtasks doesn't cost extra card height until asked for. The
  // full list is fetched lazily on first expand rather than eagerly for
  // every card; only the count (task.subtaskCount, from the server) is known
  // up front.
  const [subtasksExpanded, setSubtasksExpanded] = React.useState(false);
  const [subtaskList, setSubtaskList] = React.useState<SubtaskRow[] | null>(
    null
  );
  const [loadingSubtasks, setLoadingSubtasks] = React.useState(false);

  async function loadSubtasks() {
    if (!workspaceId || !spaceId) {
      return;
    }
    setLoadingSubtasks(true);
    const res = await getSubtasks(workspaceId, spaceId, task.id);
    setLoadingSubtasks(false);
    if (!("error" in res)) {
      setSubtaskList(res.subtasks);
    }
  }

  function toggleSubtasksExpanded() {
    const next = !subtasksExpanded;
    setSubtasksExpanded(next);
    if (next && subtaskList === null) {
      void loadSubtasks();
    }
  }

  // Re-fetch if the count changes while expanded (e.g. a subtask was added
  // via the card's own "+" composer, or a realtime refresh landed) so the
  // expanded list doesn't go stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on count change while expanded
  React.useEffect(() => {
    if (subtasksExpanded) {
      void loadSubtasks();
    }
  }, [task.subtaskCount]);

  async function handleToggleSubtaskComplete(sub: SubtaskRow) {
    const isDone = sub.statusType === "CLOSED";
    const doneStatus = statuses?.find((s) => s.type === "CLOSED");
    const openStatus =
      statuses?.find((s) => s.type === "OPEN") ??
      statuses?.find((s) => s.type === "ACTIVE");
    const target = isDone ? openStatus : doneStatus;
    if (!target) {
      return;
    }
    setSubtaskList(
      (prev) =>
        prev?.map((s) =>
          s.id === sub.id
            ? {
                ...s,
                statusId: target.id,
                statusType: target.type,
                statusColor: target.color,
                statusName: target.name,
              }
            : s
        ) ?? prev
    );
    const res = await updateTaskStatus(
      workspaceId!,
      spaceId!,
      listId ?? null,
      sub.id,
      target.id
    );
    if (res && "error" in res) {
      toast.error("Failed to update subtask");
      void loadSubtasks();
    }
  }

  function startRename() {
    if (!canEdit) {
      return;
    }
    setTitleDraft(localTitle);
    setRenaming(true);
  }
  function cancelRename() {
    setRenaming(false);
  }
  async function commitRename() {
    const trimmed = titleDraft.trim();
    setRenaming(false);
    // Empty or unchanged after trim → keep the old title, no request.
    if (!trimmed || trimmed === localTitle) {
      return;
    }
    setLocalTitle(trimmed); // optimistic
    const res = await updateTask(
      workspaceId!,
      spaceId!,
      listId ?? null,
      task.id,
      { title: trimmed }
    );
    if (res && "error" in res) {
      setLocalTitle(task.title); // revert
      toast.error(res.error);
      return;
    }
    onRefresh?.();
  }

  // Completion is status-driven: "complete" == current status type CLOSED.
  const currentStatus = statuses?.find((s) => s.id === task.statusId);
  const isDone = currentStatus?.type === "CLOSED";
  const doneStatus = statuses?.find((s) => s.type === "CLOSED");
  const openStatus =
    statuses?.find((s) => s.type === "OPEN") ??
    statuses?.find((s) => s.type === "ACTIVE");
  const completeTarget = isDone ? openStatus : doneStatus;

  async function toggleComplete() {
    if (!completeTarget) {
      return;
    }
    const res = await updateTaskStatus(
      workspaceId!,
      spaceId!,
      listId ?? null,
      task.id,
      completeTarget.id
    );
    if (res && "error" in res) {
      toast.error(res.error);
      return;
    }
    onRefresh?.();
  }

  async function addSubtask() {
    const trimmed = subtaskTitle.trim();
    if (!trimmed || creatingSubtask) {
      return;
    }
    setCreatingSubtask(true);
    const res = await createSubtask(workspaceId!, spaceId!, task.id, trimmed);
    setCreatingSubtask(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setSubtaskTitle("");
    setSubtaskOpen(false);
    toast.success("Subtask added");
    onRefresh?.();
  }

  async function handleDuplicate() {
    const res = await duplicateTask(
      workspaceId!,
      spaceId!,
      listId ?? null,
      task.id
    );
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    flashDuplicatedTask(res.taskId);
    onRefresh?.();
  }
  async function handleArchive() {
    await archiveTask(workspaceId!, spaceId!, listId ?? null, task.id);
    onRefresh?.();
    toastWithUndo("Task archived", async () => {
      await unarchiveTask(workspaceId!, spaceId!, listId ?? null, task.id);
      onRefresh?.();
    });
  }
  async function confirmDelete() {
    setDeleting(true);
    const res = await deleteTask(
      workspaceId!,
      spaceId!,
      listId ?? null,
      task.id
    );
    setDeleting(false);
    setDeleteOpen(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    onRefresh?.();
  }
  async function copyTaskLink() {
    try {
      await navigator.clipboard.writeText(taskUrl(workspaceId!, task.id));
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy link");
    }
  }
  async function copyTaskId() {
    try {
      await navigator.clipboard.writeText(task.id);
      toast.success("Task ID copied");
    } catch {
      toast.error("Couldn't copy ID");
    }
  }

  const iconBtn =
    "flex size-7 sm:size-6 items-center justify-center rounded hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const menuItem =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer";

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-elevated p-3 shadow-sm group/card",
        isDragging && "opacity-40 shadow-none border-dashed",
        overlay && "shadow-xl rotate-1 cursor-grabbing",
        !isDragging && !overlay && "hover:shadow-md transition-shadow",
        highlighted && "ring-2 ring-primary/40 border-primary/40 bg-primary/5"
      )}
    >
      <div
        {...dragListeners}
        // touch-none (touch-action: none): without it, the browser starts
        // its own native scroll on the very first touchmove — winning the
        // gesture before dnd-kit's TouchSensor ever sees enough movement to
        // activate a drag, so dragging silently never starts on mobile.
        className={cn(
          "touch-none",
          !overlay && "cursor-grab active:cursor-grabbing"
        )}
      >
        {renaming ? (
          <input
            autoFocus
            className="w-full rounded-md border border-base-300 bg-base-100 px-1.5 py-0.5 text-[13px] font-medium text-base-content focus:outline-none focus:ring-2 focus:ring-ring"
            onBlur={() => void commitRename()}
            onChange={(e) => setTitleDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                void commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            value={titleDraft}
          />
        ) : titleTruncated && !overlay ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="text-[13px] font-medium text-base-content leading-snug select-none line-clamp-2"
                ref={titleRef}
              >
                {localTitle}
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs" side="top">
              <span className="block min-w-0 whitespace-normal break-words text-center">
                {localTitle}
              </span>
            </TooltipContent>
          </Tooltip>
        ) : (
          <p
            className="text-[13px] font-medium text-base-content leading-snug select-none line-clamp-2"
            ref={titleRef}
          >
            {localTitle}
          </p>
        )}
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
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-2xs text-base-content/60">
              #{task.seqNumber}
            </span>
            {task.dependencyInfo && (
              <TaskDependencyBadge
                incomplete={task.dependencyInfo.incomplete}
                total={task.dependencyInfo.total}
              />
            )}
            <TrackedTimeBadge seconds={task.trackedSeconds} />
          </div>
          {/* Assignee / Due Date / Priority — persistent quick-edit controls,
              not just quick-SET. Each stays clickable whether the value is
              set or not, so a card never needs to be opened just to change
              one of these. Both onClick and onPointerDown must stop
              propagation on every trigger — this row is nested inside the
              drag/click wrapper above (unlike the hover quick-actions
              overlay, which is a sibling and needs neither). Read-only
              (!canEdit) falls back to plain, non-interactive display.
              On its own row (not sharing space with #seqNumber/tracked-time
              above) so it never gets squeezed into horizontal overflow. */}
          <div className="flex flex-wrap items-center gap-1">
            {canEdit ? (
              <Popover onOpenChange={setPriorityOpen} open={priorityOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 py-1.5 sm:py-0.5 text-xs font-bold transition-colors hover:bg-base-200"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="Change priority"
                    type="button"
                  >
                    {task.priority === "NONE" ? (
                      <FlagIcon className="size-3.5 text-base-content/60" />
                    ) : (
                      <span
                        className={cn(
                          "flex items-center gap-1",
                          PRIORITY_CONFIG[task.priority].color
                        )}
                      >
                        <span>{PRIORITY_CONFIG[task.priority].icon}</span>
                        {PRIORITY_CONFIG[task.priority].label}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-40 p-1"
                  onClick={(e) => e.stopPropagation()}
                  side="bottom"
                >
                  {(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map(
                    (value) => (
                      <button
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200",
                          task.priority === value && "bg-base-200"
                        )}
                        key={value}
                        onClick={() => void handleSetPriority(value)}
                        type="button"
                      >
                        <span>{PRIORITY_CONFIG[value].icon}</span>
                        <span className={PRIORITY_CONFIG[value].color}>
                          {PRIORITY_CONFIG[value].label}
                        </span>
                      </button>
                    )
                  )}
                  <div className="my-1 h-px bg-base-300" />
                  <button
                    className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-base-content/60 hover:bg-base-200"
                    onClick={() => void handleSetPriority("NONE")}
                    type="button"
                  >
                    <XIcon className="size-3.5 shrink-0" /> Clear
                  </button>
                </PopoverContent>
              </Popover>
            ) : (
              task.priority !== "NONE" && (
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs font-bold shrink-0",
                    PRIORITY_CONFIG[task.priority].color
                  )}
                >
                  <span>{PRIORITY_CONFIG[task.priority].icon}</span>
                  {PRIORITY_CONFIG[task.priority].label}
                </span>
              )
            )}

            {canEdit ? (
              <Popover onOpenChange={setDateOpen} open={dateOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 py-1.5 sm:py-0.5 text-xs font-semibold transition-colors hover:bg-base-200",
                      dueDate?.overdue ? "text-red-500" : "text-base-content/60"
                    )}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={dueDate ? "Change due date" : "Set due date"}
                    type="button"
                  >
                    <CalendarBlankIcon className="size-3.5" />
                    {dueDate && <span>{dueDate.label}</span>}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-auto p-0"
                  onClick={(e) => e.stopPropagation()}
                  side="bottom"
                >
                  <Calendar
                    mode="single"
                    onSelect={(date) => void handleSetDueDate(date ?? null)}
                    selected={task.dueDateEnd ?? undefined}
                  />
                  {task.dueDateEnd && (
                    <div className="border-t border-base-300 p-1">
                      <button
                        className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-base-content/60 hover:bg-base-200"
                        onClick={() => void handleSetDueDate(null)}
                        type="button"
                      >
                        <XIcon className="size-3.5 shrink-0" /> Clear due date
                      </button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            ) : (
              dueDate && (
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs font-semibold shrink-0",
                    dueDate.overdue ? "text-red-500" : "text-base-content/60"
                  )}
                >
                  <CalendarBlankIcon className="size-3.5" />
                  {dueDate.label}
                </span>
              )
            )}

            {canEdit ? (
              <Popover
                onOpenChange={(o) => {
                  setAssigneeOpen(o);
                  if (!o) {
                    setMemberSearch("");
                  }
                }}
                open={assigneeOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className="ml-auto flex shrink-0 cursor-pointer items-center rounded-full p-1 -m-1 sm:p-0 sm:m-0 transition-colors hover:bg-base-200"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={
                      localAssignees.length > 0 ? "Change assignee" : "Assign"
                    }
                    type="button"
                  >
                    {localAssignees.length > 0 ? (
                      <div className="flex -space-x-1.5">
                        {localAssignees.slice(0, 3).map((a) => (
                          <Avatar
                            className="size-7 border-2 border-base-100"
                            key={a.userId}
                            title={a.name}
                          >
                            {a.image && (
                              <AvatarImage
                                alt={a.name}
                                src={avatarSrc(a.image)}
                              />
                            )}
                            <AvatarFallback className="text-xs font-semibold bg-primary text-primary-content">
                              {userInitials(a.name)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {localAssignees.length > 3 && (
                          <div className="flex size-7 items-center justify-center rounded-full border-2 border-base-100 bg-base-200 text-xs font-medium text-base-content/60">
                            +{localAssignees.length - 3}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="flex size-7 items-center justify-center text-base-content/60">
                        <UserIcon className="size-3.5" />
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-64 p-2"
                  onClick={(e) => e.stopPropagation()}
                  side="bottom"
                >
                  <Input
                    autoFocus
                    className="h-8 text-xs mb-2"
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search members…"
                    value={memberSearch}
                  />
                  {filteredMembers.length === 0 ? (
                    <p className="py-2 px-1 text-xs text-base-content/60">
                      No members found
                    </p>
                  ) : (
                    <div className="max-h-52 overflow-y-auto">
                      {filteredMembers.map((m) => {
                        const assigned = localAssignees.some(
                          (a) => a.userId === m.userId
                        );
                        return (
                          <button
                            className={cn(
                              "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors",
                              assigned ? "bg-primary/10" : "hover:bg-base-200"
                            )}
                            key={m.userId}
                            onClick={() => void handleToggleAssignee(m.userId)}
                            type="button"
                          >
                            <Avatar className="size-6 shrink-0">
                              {m.image && (
                                <AvatarImage src={avatarSrc(m.image)} />
                              )}
                              <AvatarFallback className="text-2xs bg-primary/10 text-primary font-semibold">
                                {userInitials(m.name ?? m.email ?? "?")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="flex-1 min-w-0 truncate text-left">
                              {m.name ?? m.email}
                            </span>
                            {assigned && (
                              <CheckIcon
                                className="size-3.5 shrink-0 text-primary"
                                weight="bold"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            ) : (
              localAssignees.length > 0 && (
                <div className="ml-auto flex -space-x-1.5">
                  {localAssignees.slice(0, 3).map((a) => (
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
                  {localAssignees.length > 3 && (
                    <div className="flex size-7 items-center justify-center rounded-full border-2 border-base-100 bg-base-200 text-xs font-medium text-base-content/60">
                      +{localAssignees.length - 3}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>
        {resolvedCustomFieldNodes.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {customFieldNodes}
            {hiddenCustomFieldCount > 0 && (
              <span
                className="text-2xs font-medium text-base-content/60"
                title={`${hiddenCustomFieldCount} more field${hiddenCustomFieldCount === 1 ? "" : "s"} set`}
              >
                +{hiddenCustomFieldCount} more
              </span>
            )}
          </div>
        )}
        {/* Collapsible subtasks — collapsed by default. onClick/onPointerDown
            stop propagation throughout for the same reason as the
            Assignee/Date/Priority controls above: this lives inside the
            drag/click wrapper, so an unguarded click would either start a
            drag or navigate into the parent task. */}
        {task.subtaskCount > 0 && (
          <div className="mt-2 border-t border-base-300 pt-1.5">
            <button
              className="flex w-full cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
              onClick={(e) => {
                e.stopPropagation();
                toggleSubtasksExpanded();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              type="button"
            >
              {subtasksExpanded ? (
                <CaretDownIcon className="size-3 shrink-0" />
              ) : (
                <CaretRightIcon className="size-3 shrink-0" />
              )}
              {task.subtaskCount}{" "}
              {task.subtaskCount === 1 ? "subtask" : "subtasks"}
            </button>
            {subtasksExpanded && (
              <div className="mt-1 space-y-0.5 pl-1">
                {loadingSubtasks ? (
                  <div className="space-y-1 py-0.5">
                    {["k0", "k1"].map((k) => (
                      <div
                        className="h-5 animate-pulse rounded bg-base-200"
                        key={k}
                      />
                    ))}
                  </div>
                ) : (
                  subtaskList?.map((sub) => {
                    const isDone = sub.statusType === "CLOSED";
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: contains a nested "Complete" <button>, so the row itself can't literally be a <button>
                      <div
                        className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 transition-colors hover:bg-base-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        key={sub.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(
                            `/${workspaceId}/task/${sub.id}?from=board`
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            router.push(
                              `/${workspaceId}/task/${sub.id}?from=board`
                            );
                          }
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        role="button"
                        tabIndex={0}
                      >
                        <button
                          className="shrink-0 text-base-content/60 transition-colors hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleToggleSubtaskComplete(sub);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          title={isDone ? "Reopen" : "Complete"}
                          type="button"
                        >
                          {isDone ? (
                            <CheckCircleIcon
                              className="size-3.5 text-primary"
                              weight="fill"
                            />
                          ) : (
                            <CircleIcon className="size-3.5" />
                          )}
                        </button>
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-xs",
                            isDone && "text-base-content/60 line-through"
                          )}
                        >
                          {sub.title}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              aria-label={`Status: ${sub.statusName ?? "No status"}`}
                              className="size-2.5 shrink-0 rounded-full"
                              role="img"
                              style={{
                                backgroundColor: sub.statusColor ?? "#9CA3AF",
                              }}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {sub.statusName ?? "No status"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hover quick actions — sibling of the drag/click div above, so it starts
          neither a drag nor a task-open. Revealed by CSS on card hover, keyboard
          focus-within, or while one of its menus is open (data-state=open).
          pointer-events-none while hidden so taps pass through to open the task.
          Hidden entirely while renaming so it doesn't overlap the title input. */}
      {interactive && !renaming && (
        <div className="pointer-events-none absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-md border bg-elevated/95 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 group-hover/card:pointer-events-auto group-hover/card:opacity-100 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100">
          {canEdit && completeTarget && (
            <button
              className={iconBtn}
              onClick={() => void toggleComplete()}
              title={isDone ? "Reopen" : "Complete"}
              type="button"
            >
              {isDone ? (
                <ArrowCounterClockwiseIcon className="size-4" />
              ) : (
                <CheckCircleIcon className="size-4" />
              )}
            </button>
          )}
          {canEdit && (
            <Popover
              onOpenChange={(o) => {
                setSubtaskOpen(o);
                if (!o) {
                  setSubtaskTitle("");
                }
              }}
              open={subtaskOpen}
            >
              <PopoverTrigger asChild>
                <button className={iconBtn} title="Add subtask" type="button">
                  <ListPlusIcon className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-64 rounded-xl p-2"
                collisionPadding={8}
                side="bottom"
              >
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    className="h-8 rounded-md text-xs"
                    disabled={creatingSubtask}
                    onChange={(e) => setSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addSubtask();
                      }
                    }}
                    placeholder="Subtask name…"
                    value={subtaskTitle}
                  />
                  <Button
                    className="h-8 shrink-0 rounded-md px-3 text-xs font-semibold"
                    disabled={creatingSubtask || !subtaskTitle.trim()}
                    onClick={() => void addSubtask()}
                    size="sm"
                  >
                    Add
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {canEdit && (
            <button
              className={iconBtn}
              onClick={startRename}
              title="Rename"
              type="button"
            >
              <TextAaIcon className="size-4" />
            </button>
          )}
          {/* Every item closes the menu on click — the action then runs with
              the card visible, instead of the menu sitting open until an
              outside click made the result look like it applied late. */}
          <Popover onOpenChange={setMenuOpen} open={menuOpen}>
            <PopoverTrigger asChild>
              <button className={iconBtn} title="More" type="button">
                <DotsThreeIcon className="size-4.5" weight="bold" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 rounded-xl p-1">
              <button
                className={menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  void copyTaskLink();
                }}
                type="button"
              >
                <LinkIcon className="size-3.5 text-base-content/60" /> Copy task
                link
              </button>
              <a
                className={menuItem}
                href={taskUrl(workspaceId!, task.id)}
                onClick={() => setMenuOpen(false)}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ArrowSquareOutIcon className="size-3.5 text-base-content/60" />{" "}
                Open in new tab
              </a>
              <button
                className={menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  void copyTaskId();
                }}
                type="button"
              >
                <HashIcon className="size-3.5 text-base-content/60" /> Copy task
                ID
              </button>
              {canEdit && (
                <>
                  <div className="h-px bg-base-300 my-1" />
                  <button
                    className={menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      void handleDuplicate();
                    }}
                    type="button"
                  >
                    <CopyIcon className="size-3.5 text-base-content/60" />{" "}
                    Duplicate
                  </button>
                  <button
                    className={menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      void handleArchive();
                    }}
                    type="button"
                  >
                    <ArchiveIcon className="size-3.5 text-base-content/60" />{" "}
                    Archive
                  </button>
                </>
              )}
              {isAdmin && (
                <button
                  className={cn(
                    menuItem,
                    "text-red-600 hover:bg-red-50 hover:text-red-700"
                  )}
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteOpen(true);
                  }}
                  type="button"
                >
                  <TrashIcon className="size-3.5" /> Delete
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>
      )}

      {interactive && (
        <Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
          <DialogContent className="rounded-xl sm:max-w-sm">
            <DialogTitle className="sr-only">Delete task</DialogTitle>
            <div className="flex flex-col items-center gap-3 pt-2 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-red-100">
                <TrashIcon className="size-6 text-red-600" />
              </div>
              <div>
                <p className="text-base font-semibold">Delete task?</p>
                <p className="mt-1 text-sm text-base-content/60">
                  “{localTitle}” will move to Trash. A workspace admin can
                  restore it.
                </p>
              </div>
              <div className="mt-2 flex w-full gap-2">
                <Button
                  className="flex-1 rounded-md"
                  disabled={deleting}
                  onClick={() => setDeleteOpen(false)}
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 rounded-md"
                  disabled={deleting}
                  onClick={() => void confirmDelete()}
                  variant="destructive"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Sortable task card ───────────────────────────────────────────────────────

function TaskCard({
  task,
  workspaceId,
  spaceId,
  listId,
  statuses,
  canEdit,
  isAdmin,
  onRefresh,
  customFields,
  members,
  taskNavIds,
}: {
  task: Task;
  workspaceId: string;
  spaceId: string;
  listId: string;
  statuses: Status[];
  canEdit?: boolean;
  isAdmin?: boolean;
  onRefresh: () => void;
  customFields: CustomFieldRow[];
  members: BoardMember[];
  taskNavIds: string[];
}) {
  const router = useRouter();
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

  // Wrap listeners to allow click-through when not dragging
  const clickableListeners = {
    ...listeners,
    onClick: (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging) {
        e.stopPropagation();
        setTaskNavContext({ taskIds: taskNavIds });
        router.push(`/${workspaceId}/task/${task.id}?from=board`);
      }
    },
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <CardContent
        canEdit={canEdit}
        customFields={customFields}
        dragListeners={clickableListeners}
        isAdmin={isAdmin}
        isDragging={isDragging}
        listId={listId}
        members={members}
        onRefresh={onRefresh}
        spaceId={spaceId}
        statuses={statuses}
        task={task}
        workspaceId={workspaceId}
      />
    </div>
  );
}

// ─── Column (droppable) ───────────────────────────────────────────────────────

function Column({
  status,
  tasks,
  workspaceId,
  space,
  list,
  statuses,
  canEdit,
  isAdmin,
  onRefresh,
  customFields,
  members,
  taskNavIds,
}: {
  status: Status;
  tasks: Task[];
  workspaceId: string;
  space: BoardViewProps["space"];
  list: BoardViewProps["list"];
  statuses: Status[];
  canEdit?: boolean;
  isAdmin?: boolean;
  onRefresh: () => void;
  customFields: CustomFieldRow[];
  members: BoardMember[];
  taskNavIds: string[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  return (
    <div
      className="flex w-64 shrink-0 flex-col rounded-xl p-2 gap-2 max-h-[calc(100vh-14rem)]"
      style={{ backgroundColor: `${status.color}14` }}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-1 py-1">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: status.color }}
        />
        <span className="min-w-0 flex-1 truncate font-semibold text-sm uppercase tracking-wide text-base-content/80">
          {status.name}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ backgroundColor: `${status.color}22`, color: status.color }}
        >
          {tasks.length}
        </span>
      </div>

      {/* Droppable task list — flex-1 + overflow-y-auto gives each column its own scroll */}
      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          className={cn(
            "flex flex-col gap-2 rounded-lg p-1 transition-all flex-1 overflow-y-auto min-h-0 no-scrollbar",
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
            <TaskCard
              canEdit={canEdit}
              customFields={customFields}
              isAdmin={isAdmin}
              key={t.id}
              listId={list.id}
              members={members}
              onRefresh={onRefresh}
              spaceId={space.id}
              statuses={statuses}
              task={t}
              taskNavIds={taskNavIds}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      </SortableContext>

      <QuickCreateTask
        listId={list.id}
        placeholder="Add task"
        spaceId={space.id}
        statuses={statuses}
        statusId={status.id}
        workspaceId={workspaceId}
      />
    </div>
  );
}

// ─── View persistence ────────────────────────────────────────────────────────
// Remember Sort / Filters per list across reloads (per-browser), same pattern
// as list-view's ListViewPrefs. Not URL/backend — a full named-views system is
// out of scope.
type BoardViewPrefs = {
  sortBy: "name" | "priority" | null;
  sortOrder: "asc" | "desc";
  statusFilter: string[];
  priorityFilter: string[];
  assigneeFilter: string[];
  customFieldFilters: CustomFieldFilters;
};

function boardViewPrefsKey(listId: string) {
  return `kanbanica:board-view:${listId}`;
}

function loadBoardViewPrefs(listId: string): Partial<BoardViewPrefs> | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(boardViewPrefsKey(listId));
    return raw ? (JSON.parse(raw) as Partial<BoardViewPrefs>) : null;
  } catch {
    return null;
  }
}

// ─── Board ────────────────────────────────────────────────────────────────────

export function BoardView({
  workspaceId,
  space,
  list,
  statuses,
  tasks,
  members = [],
  customFields = [],
  canEdit,
  canManage,
  isAdmin,
  archivedLoading,
  archivedTasks,
  onArchivedChanged,
  onToggleArchived,
  showArchived,
}: BoardViewProps) {
  const router = useRouter();
  // Re-pull the server-rendered board after a card quick-action. The actions
  // revalidate + broadcast server-side; this refreshes the current view too.
  const handleRefresh = React.useCallback(() => router.refresh(), [router]);

  // ── Board "Fields" preference — which custom fields show on cards ────────
  // Reuses the same generic {id,label}[] preference hook List View's Columns
  // menu uses (hooks/use-list-column-preferences.ts), keyed separately
  // (`${list.id}:board`) so choosing card fields doesn't also toggle List
  // View's table columns. Hidden by default, same as List View.
  const fieldOptions = React.useMemo(
    () => customFields.map((f) => ({ id: f.id, label: f.name })),
    [customFields]
  );
  const { visibleIds: visibleFieldIds, setVisibleIds: setVisibleFieldIds } =
    useListColumnPreferences(`${list.id}:board`, fieldOptions);
  const visibleCustomFields = React.useMemo(
    () => customFields.filter((f) => visibleFieldIds.includes(f.id)),
    [customFields, visibleFieldIds]
  );

  // ── "Add group" — create a new status column (reuses createListStatus). ────
  const [newGroupOpen, setNewGroupOpen] = React.useState(false);
  const [newGroupName, setNewGroupName] = React.useState("");
  const [newGroupColor, setNewGroupColor] = React.useState("#6B7280");
  const [newGroupCategory, setNewGroupCategory] =
    React.useState<DashboardCategory>("OPEN");
  const [creatingGroup, setCreatingGroup] = React.useState(false);
  const [groupError, setGroupError] = React.useState("");

  async function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name || creatingGroup) {
      return;
    }
    // Group names must be unique within the list. Checked here for instant
    // feedback; createListStatus enforces the same rule server-side (a stale
    // `statuses` prop or a concurrent create can still collide).
    if (
      statuses.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())
    ) {
      setGroupError(`A group named “${name}” already exists`);
      return;
    }
    setGroupError("");
    setCreatingGroup(true);
    const res = await createListStatus(workspaceId, space.id, list.id, {
      name,
      color: newGroupColor,
      type: "OPEN",
      dashboardCategory: newGroupCategory,
    });
    setCreatingGroup(false);
    if ("error" in res) {
      setGroupError(res.error);
      return;
    }
    setNewGroupName("");
    setNewGroupColor("#6B7280");
    setNewGroupCategory("OPEN");
    setGroupError("");
    setNewGroupOpen(false);
    handleRefresh();
  }

  // Local task state for optimistic drag updates
  const [localTasks, setLocalTasks] = React.useState<Task[]>(tasks);
  const [activeTask, setActiveTask] = React.useState<Task | null>(null);

  // Sync when server data changes
  React.useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  // ── Toolbar state ─────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = React.useState(false);
  // "C" opens the Create Task popup (same as the toolbar button).
  useCreateTaskShortcut(() => setCreateOpen(true), canEdit || isAdmin);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sortBy, setSortBy] = React.useState<"name" | "priority" | null>(null);
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("asc");
  // Sort is a single-select menu — picking an option closes the popover
  // immediately, same as FacetFilter's `single` mode.
  const [sortMenuOpen, setSortMenuOpen] = React.useState(false);
  // Mobile-only "Filters" bottom sheet (see the mobile toolbar block below) —
  // desktop keeps every filter inline, so this only matters under `md:`.
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  // Local filter state (mirrors list-view pattern)
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = React.useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = React.useState<string[]>([]);
  const [customFieldFilters, setCustomFieldFilters] =
    React.useState<CustomFieldFilters>({});

  // Apply persisted view prefs after mount (avoids SSR/client hydration mismatch).
  // `prefsHydrated` gates the persist effect so we never overwrite saved prefs
  // with the defaults before they're loaded.
  const [prefsHydrated, setPrefsHydrated] = React.useState(false);
  React.useEffect(() => {
    const p = loadBoardViewPrefs(list.id);
    if (p) {
      if (p.sortBy !== undefined) {
        setSortBy(p.sortBy);
      }
      if (p.sortOrder) {
        setSortOrder(p.sortOrder);
      }
      if (p.statusFilter) {
        setStatusFilter(p.statusFilter);
      }
      if (p.priorityFilter) {
        setPriorityFilter(p.priorityFilter);
      }
      if (p.assigneeFilter) {
        setAssigneeFilter(p.assigneeFilter);
      }
      if (p.customFieldFilters) {
        setCustomFieldFilters(p.customFieldFilters);
      }
    }
    setPrefsHydrated(true);
  }, [list.id]);

  // Persist view prefs whenever they change (only after hydration).
  React.useEffect(() => {
    if (!prefsHydrated) {
      return;
    }
    try {
      window.localStorage.setItem(
        boardViewPrefsKey(list.id),
        JSON.stringify({
          sortBy,
          sortOrder,
          statusFilter,
          priorityFilter,
          assigneeFilter,
          customFieldFilters,
        })
      );
    } catch {
      // ignore quota / disabled storage
    }
  }, [
    prefsHydrated,
    list.id,
    sortBy,
    sortOrder,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    customFieldFilters,
  ]);

  // ── Filters (built-in + custom fields) ────────────────────────────────────
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

  // Count shown on the mobile "Filters" button/chip row — search has its own
  // always-visible input on mobile, so it's deliberately excluded here.
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

  // ── Filtered + sorted tasks (for display) ────────────────────────────────
  const processedTasks = React.useMemo(() => {
    let result = filterTasks(
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

    if (sortBy === "name") {
      result = [...result].sort((a, b) =>
        sortOrder === "asc"
          ? a.title.localeCompare(b.title)
          : b.title.localeCompare(a.title)
      );
    } else if (sortBy === "priority") {
      result = [...result].sort((a, b) => {
        const diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        return sortOrder === "asc" ? diff : -diff;
      });
    }

    return result;
  }, [
    localTasks,
    searchQuery,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    customFieldFilters,
    customFields,
    members,
    sortBy,
    sortOrder,
  ]);

  // tasksByStatus uses processed tasks for display; DnD handlers still use localTasks
  const tasksByStatus = React.useMemo(() => {
    const map: Record<string, Task[]> = Object.fromEntries(
      statuses.map((s) => [s.id, []])
    );
    for (const t of processedTasks) {
      if (t.statusId && map[t.statusId]) {
        map[t.statusId].push(t);
      }
    }
    return map;
  }, [processedTasks, statuses]);

  // Previous/Next Task nav context: current columns left-to-right, each
  // column's cards top-to-bottom — the same order the board renders. Handed
  // to Task Detail so Prev/Next walks it without a DB query.
  const visibleOrderedTaskIds = React.useMemo(() => {
    const ids: string[] = [];
    if (showArchived && archivedTasks) {
      for (const t of archivedTasks) {
        ids.push(t.id);
      }
    }
    for (const s of statuses) {
      for (const t of tasksByStatus[s.id] ?? []) {
        ids.push(t.id);
      }
    }
    return ids;
  }, [showArchived, archivedTasks, statuses, tasksByStatus]);

  // Split mouse/touch instead of one PointerSensor: touch needs
  // `touch-action: none` to beat native scroll, which would turn a plain
  // distance-based swipe into a drag — TouchSensor's delay+tolerance
  // requires a press-and-hold first, so a quick swipe still scrolls.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  function findStatusForTask(taskId: string) {
    return localTasks.find((t) => t.id === taskId)?.statusId ?? null;
  }

  // Pause live auto-refresh while dragging so it can't clobber the drag.
  const pauseRealtime = useRealtimePause();
  const dragResumeRef = React.useRef<null | (() => void)>(null);
  const endDrag = React.useCallback(() => {
    dragResumeRef.current?.();
    dragResumeRef.current = null;
  }, []);

  function onDragStart({ active }: DragStartEvent) {
    endDrag();
    dragResumeRef.current = pauseRealtime();
    setActiveTask(localTasks.find((t) => t.id === active.id) ?? null);
  }

  function onDragCancel() {
    setActiveTask(null);
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

    const activeStatus = findStatusForTask(activeId);
    // over could be a column (statusId) or another task
    const overStatus =
      statuses.find((s) => s.id === overId)?.id ?? findStatusForTask(overId);

    if (!activeStatus || !overStatus) {
      return;
    }

    if (activeStatus === overStatus) {
      // Same column — reorder positions optimistically
      setLocalTasks((prev) => {
        const oldIndex = prev.findIndex((t) => t.id === activeId);
        const newIndex = prev.findIndex((t) => t.id === overId);
        if (oldIndex === -1 || newIndex === -1) {
          return prev;
        }
        return arrayMove(prev, oldIndex, newIndex);
      });
    } else {
      // Cross-column — move task to new column
      setLocalTasks((prev) =>
        prev.map((t) =>
          t.id === activeId ? { ...t, statusId: overStatus } : t
        )
      );
    }
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setActiveTask(null);
    endDrag();
    if (!over) {
      return;
    }

    const activeId = active.id as string;
    const finalStatus = findStatusForTask(activeId); // from localTasks after all onDragOver updates
    const originalStatus = tasks.find((t) => t.id === activeId)?.statusId;

    if (!finalStatus) {
      return;
    }

    if (finalStatus === originalStatus) {
      // Same column — persist new card order
      const columnTaskIds = localTasks
        .filter((t) => t.statusId === finalStatus)
        .map((t) => t.id);
      const originalIds = tasks
        .filter((t) => t.statusId === originalStatus)
        .map((t) => t.id);
      if (columnTaskIds.join(",") === originalIds.join(",")) {
        return; // no change
      }
      const res = await reorderTasksInStatus(
        workspaceId,
        space.id,
        list.id,
        columnTaskIds
      );
      if ("error" in res) {
        setLocalTasks(tasks);
      }
    } else {
      // Cross-column — update status
      const res = await updateTaskStatus(
        workspaceId,
        space.id,
        list.id,
        activeId,
        finalStatus
      );
      if ("error" in res) {
        setLocalTasks(tasks);
      }
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <CreateTaskModal
        canManage={canEdit || isAdmin}
        listId={list.id}
        onOpenChange={setCreateOpen}
        open={createOpen}
        spaceId={space.id}
        statuses={statuses}
        workspaceId={workspaceId}
      />

      {/* Toolbar — desktop/tablet only; mobile gets its own compact toolbar
          below (same state/handlers, different presentation). */}
      <div className="hidden md:flex items-center justify-between gap-4 flex-wrap mb-3">
        {/* Logical groups get their own gap-2 row; the gap-4 on this wrapper
            is what separates the groups from each other (Search /
            Status+Priority+Assignee+Filters / Sort+Fields) — a bit more
            breathing room than the gap-2 used inside each group. */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* Search */}
          <SearchInput
            className="w-64 focus:w-80"
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
            placeholder="Search tasks…"
            value={searchQuery}
          />

          {/* Filters — shared facet controls (same state + filter logic).
              Kept exactly as standalone toolbar buttons — the Filters
              builder is an additional entry point onto this same state, not
              a replacement for these. Below 1300px they'd wrap onto a
              second row one at a time, so under that width they collapse
              into one CombinedFacetFilter button instead — same state, same
              options, just grouped under one popover. Only one of the two
              ever renders. */}
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
              Status/Priority/Assignee already have dedicated buttons above,
              so they're deliberately excluded here to avoid duplicating
              them. Custom fields are picked dynamically instead of getting
              their own always-visible toolbar button, so the toolbar stays
              the same width no matter how many custom fields a list has.
              Hidden entirely when there are none — it would otherwise open
              onto an empty "No filters yet" picker with nothing to add. */}
          {filterFields.length > 0 && (
            <FilterBuilder
              fields={filterFields}
              isActive={isFilterFieldActive}
              onClear={clearFilterField}
              renderControl={renderFilterControl}
            />
          )}

          <div className="mx-1 h-5 w-px shrink-0 bg-base-300" />

          <div className="flex items-center gap-2 flex-wrap">
            {/* Sort — no "Group By" control here: the status columns are
                already the grouping (List view's Group By is an alternative
                to its flat list), so adding a second grouping mechanism on
                top of the columns would conflict rather than add parity. */}
            <Popover onOpenChange={setSortMenuOpen} open={sortMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1.5 h-8 rounded-lg border border-base-300 px-3 text-xs font-semibold text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors cursor-pointer select-none"
                  type="button"
                >
                  <ArrowsDownUpIcon className="size-3.5" />
                  Sort:{" "}
                  {sortBy
                    ? sortBy.charAt(0).toUpperCase() + sortBy.slice(1)
                    : "None"}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-44 p-1 flex flex-col gap-0.5"
              >
                <button
                  className={cn(
                    "px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-base-200 cursor-pointer text-base-content",
                    !sortBy && "bg-base-200"
                  )}
                  onClick={() => {
                    setSortBy(null);
                    setSortMenuOpen(false);
                  }}
                  type="button"
                >
                  None
                </button>
                <button
                  className={cn(
                    "px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-base-200 cursor-pointer text-base-content",
                    sortBy === "name" && "bg-base-200"
                  )}
                  onClick={() => {
                    setSortBy("name");
                    setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                    setSortMenuOpen(false);
                  }}
                  type="button"
                >
                  Task Name
                </button>
                <button
                  className={cn(
                    "px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-base-200 cursor-pointer text-base-content",
                    sortBy === "priority" && "bg-base-200"
                  )}
                  onClick={() => {
                    setSortBy("priority");
                    setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                    setSortMenuOpen(false);
                  }}
                  type="button"
                >
                  Priority
                </button>
              </PopoverContent>
            </Popover>

            {/* Fields — which custom fields show on cards (hidden by
                default, persisted per board via useListColumnPreferences).
                Cards are read-only; editing stays on Task Detail / the
                drawer. */}
            {customFields.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex h-8 shrink-0 select-none items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors cursor-pointer",
                      visibleFieldIds.length > 0
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-base-300 text-base-content/60 hover:bg-base-200 hover:text-base-content"
                    )}
                    type="button"
                  >
                    <SlidersHorizontalIcon className="size-3.5" />
                    Fields
                    {visibleFieldIds.length > 0 && (
                      <span className="font-bold">
                        ({visibleFieldIds.length})
                      </span>
                    )}
                    <CaretDownIcon className="size-3 opacity-60" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 rounded-xl p-1.5">
                  <p className="px-2 py-1 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                    Custom Fields
                  </p>
                  <FacetOptionList
                    emptyText="No custom fields"
                    onChange={setVisibleFieldIds}
                    options={fieldOptions.map((f) => ({
                      value: f.id,
                      label: f.label,
                    }))}
                    searchable={fieldOptions.length > 6}
                    selected={visibleFieldIds}
                  />
                </PopoverContent>
              </Popover>
            )}

            <div className="mx-1 h-5 w-px shrink-0 bg-base-300" />

            {/* Manage Custom Fields — a discoverability shortcut straight to
                Project Settings → Custom Fields, not a general Settings
                button. Only shown to full-access members (same permission
                requireFieldAdmin enforces for a space-scoped field), and
                independent of whether any custom fields exist yet — that's
                the point: it's how you'd go create the first one when
                Filters/Fields are hidden. */}
            {canManage && (
              <button
                className="flex items-center justify-center size-8 rounded-lg border border-base-300 text-base-content/60 hover:bg-base-200/30 hover:text-base-content transition-colors cursor-pointer"
                onClick={() =>
                  router.push(
                    `/${workspaceId}/${space.id}/settings/custom-fields`
                  )
                }
                title="Manage Custom Fields"
                type="button"
              >
                <ManageFieldsIcon className="size-4" />
              </button>
            )}

            {/* Secondary actions — same "More" menu pattern as List view
                (Export/Import/Archived/Shortcuts), so the toolbar doesn't
                grow a button per action. */}
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
                    triggerExportDownload({ kind: "list", listId: list.id })
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

      {/* ── Mobile toolbar (below md:) ──────────────────────────────────────
          Same state/handlers as the desktop toolbar above — this is a
          presentation-only split, not a second filtering implementation.
          Search + a compact Create button up top, a single "Filters" entry
          point (Status/Priority/Assignee/Sort/custom fields all live in a
          bottom sheet) instead of every control inline, an overflow menu for
          the desktop-only utility controls (Fields/Manage Custom Fields),
          and active-filter chips below. */}
      <div className="flex flex-col gap-2 mb-3 md:hidden">
        <div className="flex items-center gap-2">
          <SearchInput
            className="min-w-0 flex-1"
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
            placeholder="Search tasks…"
            value={searchQuery}
          />
          <button
            aria-label="Create task"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-content shadow-sm transition-all hover:bg-primary/95"
            onClick={() => setCreateOpen(true)}
            type="button"
          >
            <PlusIcon className="size-4.5" weight="bold" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Sheet onOpenChange={setMobileFiltersOpen} open={mobileFiltersOpen}>
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
                      onClick={() => setSortBy(null)}
                      type="button"
                    >
                      None
                    </button>
                    <button
                      className={cn(
                        "rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-base-200",
                        sortBy === "name" && "bg-base-200 text-base-content"
                      )}
                      onClick={() => {
                        setSortBy("name");
                        setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                      }}
                      type="button"
                    >
                      Task Name
                    </button>
                    <button
                      className={cn(
                        "rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-base-200",
                        sortBy === "priority" && "bg-base-200 text-base-content"
                      )}
                      onClick={() => {
                        setSortBy("priority");
                        setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                      }}
                      type="button"
                    >
                      Priority
                    </button>
                  </div>
                </div>

                {onToggleArchived && (
                  <>
                    <div className="h-px bg-base-300" />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Show archived</span>
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
              {customFields.length > 0 && (
                <div className="px-1 py-1.5">
                  <p className="px-1.5 pb-1 text-2xs font-bold uppercase tracking-wide text-base-content/60">
                    Fields shown on cards
                  </p>
                  <FacetOptionList
                    emptyText="No custom fields"
                    onChange={setVisibleFieldIds}
                    options={fieldOptions.map((f) => ({
                      value: f.id,
                      label: f.label,
                    }))}
                    searchable={fieldOptions.length > 6}
                    selected={visibleFieldIds}
                  />
                </div>
              )}
              {canManage && (
                <>
                  <div className="my-1 h-px bg-base-300" />
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-base-200"
                    onClick={() =>
                      router.push(
                        `/${workspaceId}/${space.id}/settings/custom-fields`
                      )
                    }
                    type="button"
                  >
                    <ManageFieldsIcon className="size-4 text-base-content/60" />
                    Manage Custom Fields
                  </button>
                </>
              )}
              <div className="my-1 h-px bg-base-300" />
              <ExportMenuRow scope={{ kind: "list", listId: list.id }} />
              {canManage && (
                <ImportMenuRow
                  listId={list.id}
                  spaceId={space.id}
                  workspaceId={workspaceId}
                />
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
                    setStatusFilter(statusFilter.filter((id) => id !== sId))
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
                    setAssigneeFilter(assigneeFilter.filter((id) => id !== aId))
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

      {showArchived && (
        <div className="mb-6 overflow-hidden rounded-xl border border-base-300 bg-base-200/20">
          <div className="flex items-center gap-2 select-none border-b border-base-300 bg-base-200/50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-base-content/60">
            <ArchiveIcon className="size-4" />
            Archived ({archivedTasks?.length ?? 0})
          </div>
          {(!archivedTasks || archivedTasks.length === 0) && (
            <div className="px-4 py-6 text-center text-xs italic text-base-content/60">
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
                <span className="shrink-0 select-none font-mono text-2xs text-base-content/60">
                  #{t.seqNumber}
                </span>
                <span className="flex-1 truncate text-[13px] font-medium text-base-content/60 line-through">
                  {t.title}
                </span>
                <button
                  className="invisible flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-lg border border-base-300 bg-base-100 px-2.5 py-1 text-2xs font-semibold text-base-content/60 transition-colors group-hover:visible hover:text-base-content"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await unarchiveTask(workspaceId, space.id, list.id, t.id);
                    await onArchivedChanged?.();
                    toastWithUndo("Task unarchived", async () => {
                      await archiveTask(workspaceId, space.id, list.id, t.id);
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

      <DndContext
        collisionDetection={closestCenter}
        id="board-dnd"
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
        sensors={sensors}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 items-start">
          {statuses.map((status) => (
            <Column
              canEdit={canEdit}
              customFields={visibleCustomFields}
              isAdmin={isAdmin}
              key={status.id}
              list={list}
              members={members}
              onRefresh={handleRefresh}
              space={space}
              status={status}
              statuses={statuses}
              taskNavIds={visibleOrderedTaskIds}
              tasks={tasksByStatus[status.id] ?? []}
              workspaceId={workspaceId}
            />
          ))}

          {/* Add group — creates a new status column (Full Access only). */}
          {canManage && (
            <button
              className="flex h-9 shrink-0 select-none items-center gap-1.5 rounded-lg border border-dashed border-base-300 px-3 text-sm font-medium text-base-content/60 transition-colors hover:border-primary/40 hover:bg-base-200 hover:text-base-content"
              onClick={() => setNewGroupOpen(true)}
              type="button"
            >
              <PlusIcon className="size-4" weight="bold" /> Add group
            </button>
          )}
        </div>

        {/* Drag overlay — shown while dragging */}
        <DragOverlay>
          {activeTask && (
            <CardContent
              customFields={visibleCustomFields}
              members={members}
              overlay
              task={activeTask}
            />
          )}
        </DragOverlay>
      </DndContext>

      {/* New group (status) dialog — mirrors the List view's New Status dialog. */}
      {canManage && (
        <Dialog
          onOpenChange={(o) => {
            setNewGroupOpen(o);
            if (!o) {
              setGroupError("");
            }
          }}
          open={newGroupOpen}
        >
          <DialogContent className="rounded-xl sm:max-w-xs">
            <DialogTitle className="text-sm font-bold">New Group</DialogTitle>
            <div className="space-y-3">
              <Input
                aria-invalid={!!groupError}
                autoFocus
                className="h-9 text-xs"
                onChange={(e) => {
                  setNewGroupName(e.target.value);
                  setGroupError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleCreateGroup();
                  }
                }}
                placeholder="Group name"
                value={newGroupName}
              />
              {groupError && <p className="text-xs text-error">{groupError}</p>}
              <div className="flex flex-wrap gap-2">
                {STATUS_PRESET_COLORS.map((color) => (
                  <button
                    className={cn(
                      "size-6 cursor-pointer rounded-full transition-transform",
                      newGroupColor === color &&
                        "scale-110 ring-2 ring-base-content ring-offset-2 ring-offset-popover"
                    )}
                    key={color}
                    onClick={() => setNewGroupColor(color)}
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
                    setNewGroupCategory(v as DashboardCategory)
                  }
                  value={newGroupCategory}
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
            <div className="flex justify-end gap-2">
              <Button
                className="h-8 text-xs font-semibold"
                onClick={() => {
                  setGroupError("");
                  setNewGroupOpen(false);
                }}
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                className="h-8 text-xs font-bold"
                disabled={creatingGroup || !newGroupName.trim()}
                onClick={() => void handleCreateGroup()}
              >
                {creatingGroup ? "Creating…" : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <KeyboardShortcutsDialog
        onOpenChange={setShortcutsOpen}
        open={shortcutsOpen}
      />

      {/* Opened from the desktop "More" menu above; mobile opens the same
          dialog via ImportMenuRow's own internal state instead. */}
      <ImportWizardDialog
        listId={list.id}
        onOpenChange={setImportOpen}
        open={importOpen}
        spaceId={space.id}
        workspaceId={workspaceId}
      />
    </TooltipProvider>
  );
}
