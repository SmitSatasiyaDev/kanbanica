"use client";

import {
  ArchiveIcon,
  ArrowSquareOutIcon,
  ArrowsOutCardinalIcon,
  CalendarBlankIcon,
  CheckIcon,
  CopyIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  HashIcon,
  LightningIcon,
  LinkIcon,
  PencilSimpleIcon,
  PushPinIcon,
  TextAaIcon,
  TrashIcon,
  TrayIcon,
  UserIcon,
  UserPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import {
  type CustomFieldRow,
  deleteCustomFieldValue,
  setCustomFieldValue,
} from "@/app/actions/custom-field";
import { getWorkspaceLists } from "@/app/actions/list";
import { bulkMoveTasksToSprint, getSprints } from "@/app/actions/sprint";
import {
  archiveTask,
  deleteTask,
  duplicateTask,
  getWorkspaceMembers,
  moveTask,
  unarchiveTask,
  updateTask,
  updateTaskStatus,
} from "@/app/actions/task";
import { addAssignee, removeAssignee } from "@/app/actions/task-assignee";
import { SpaceIcon } from "@/components/common/space-icon";
import {
  CustomFieldEditor,
  type CustomFieldMember,
} from "@/components/task/custom-field-editors";
import {
  TaskDependencyBadge,
  type TaskDependencyIndicator,
} from "@/components/task/task-dependency-badge";
import { TrackedTimeBadge } from "@/components/task/tracked-time-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InviteMemberModal } from "@/components/workspace/invite-member-modal";
import { taskUrl } from "@/lib/app-url";
import {
  CUSTOM_FIELD_COLUMN_WIDTH_CLASS,
  describeCustomFieldValue,
} from "@/lib/custom-fields/column-display";
import {
  flashDuplicatedTask,
  useIsDuplicateHighlighted,
} from "@/lib/duplicate-highlight";
import {
  avatarSrc,
  formatDueDate,
  PRIORITY_CONFIG,
  userInitials,
} from "@/lib/priority-config";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskListRowData {
  assignees: { userId: string; name: string; image: string | null }[];
  customFieldValues?: Record<string, unknown>;
  dependencyInfo?: TaskDependencyIndicator;
  dueDateEnd?: Date | null;
  dueDateStart: Date | null;
  id: string;
  isPinnedToList?: boolean;
  listId?: string | null;
  priority: string | null;
  seqNumber: number;
  statusId: string | null;
  tags: { id: string; name: string; color: string }[];
  title: string;
  trackedSeconds?: number;
}

type WorkspaceMember = {
  userId: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
};
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

export interface TaskListRowProps {
  canEdit?: boolean;
  /** Show "Pin to top / Unpin from top" in the ⋯ menu (list view) */
  canPinToList?: boolean;
  /** Custom field definitions visible as columns — same array reference for
   * every row (loaded once server-side), never fetched per row. */
  customFields?: CustomFieldRow[];
  dragProps?: Record<string, unknown>;
  // Optional DnD props — provided by a SortableTaskRow wrapper in list view
  dragRef?: (node: HTMLElement | null) => void;
  dragStyle?: React.CSSProperties;
  /** Exclude this sprint from the "Move to Sprint" list (sprint view passes its own id) */
  excludeSprintId?: string;
  isAdmin?: boolean;
  isDragging?: boolean;
  isPersonallyPinned?: boolean;
  /** Explicit list context — overrides task.listId for all server actions */
  listId?: string;
  /** Called with the new task id after a successful duplicate (sprint view uses this to add the copy to the sprint) */
  onAfterDuplicate?: (newTaskId: string) => Promise<void>;
  /** Show a "Backlog" button inside the "Move to Sprint" section (sprint view) */
  onMoveToBacklog?: () => void;
  onOpen: () => void;
  onRefresh: () => void;
  onSelect: (id: string, checked: boolean) => void;
  selected: boolean;
  spaceId: string;
  statusColor: string;
  statuses: { id: string; name: string; color: string }[];
  task: TaskListRowData;
  workspaceId: string;
  /** Full active workspace member list (loaded once server-side) — passed
   * through to CustomFieldEditor for PERSON-type fields. Separate from this
   * component's own lazily-loaded `members` state, which is scoped to the
   * Assignee popover only. */
  workspaceMembers?: CustomFieldMember[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskListRow({
  task,
  statusColor,
  workspaceId,
  spaceId,
  listId: listIdProp,
  statuses,
  canEdit,
  isAdmin,
  canPinToList,
  excludeSprintId,
  selected,
  onSelect,
  onOpen,
  onRefresh,
  isPersonallyPinned: isPersonallyPinnedProp,
  onMoveToBacklog,
  onAfterDuplicate,
  dragRef,
  dragStyle,
  dragProps,
  isDragging,
  customFields = [],
  workspaceMembers = [],
}: TaskListRowProps) {
  const _router = useRouter();
  const { mutate } = useSWRConfig();

  const effectiveListId = listIdProp || task.listId || null;
  const highlighted = useIsDuplicateHighlighted(task.id);

  // ── Optimistic state ──────────────────────────────────────────────────────
  const [localPriority, setLocalPriority] = React.useState<string>(
    task.priority ?? "NONE"
  );
  // The "Due Date" column is `dueDateEnd`, strictly — the same field the inline
  // editor writes. It used to fall back to `dueDateStart` when the end was
  // empty, which made clearing a due date look like a no-op on any task that
  // also had a start date (the start would immediately take its place).
  const [localDueDate, setLocalDueDate] = React.useState<Date | null>(
    task.dueDateEnd ?? null
  );
  const [localPersonalPin, setLocalPersonalPin] = React.useState(
    isPersonallyPinnedProp ?? false
  );
  // One generic map for every custom field on this row — not one useState per
  // field/type, since the field set is open-ended and CustomFieldEditor (not
  // this component) owns all per-type rendering/editing behavior.
  const [localCustomFieldValues, setLocalCustomFieldValues] = React.useState<
    Record<string, unknown>
  >(task.customFieldValues ?? {});
  React.useEffect(() => {
    setLocalCustomFieldValues(task.customFieldValues ?? {});
  }, [task.customFieldValues]);

  // ── Inline rename ─────────────────────────────────────────────────────────
  const [localTitle, setLocalTitle] = React.useState(task.title);
  const [renaming, setRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(task.title);
  React.useEffect(() => {
    setLocalTitle(task.title);
  }, [task.title]);

  // Return DOM focus to this row (keyboard-nav position is preserved).
  function focusRow() {
    if (typeof document === "undefined") {
      return;
    }
    document
      .querySelector<HTMLElement>(`[data-task-row][data-task-id="${task.id}"]`)
      ?.focus();
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
    requestAnimationFrame(focusRow);
  }

  async function commitRename() {
    const trimmed = titleDraft.trim();
    setRenaming(false);
    requestAnimationFrame(focusRow);
    // Empty after trim → reject, keep the previous title, no request.
    if (!trimmed) {
      toast.error("Task title can't be empty");
      return;
    }
    // Unchanged → exit without a network request.
    if (trimmed === localTitle) {
      return;
    }
    setLocalTitle(trimmed); // optimistic
    const res = await updateTask(
      workspaceId,
      spaceId,
      effectiveListId,
      task.id,
      { title: trimmed }
    );
    if (res && "error" in res) {
      setLocalTitle(task.title); // revert
      toast.error(res.error);
      return;
    }
    onRefresh();
  }

  async function copyTaskLink() {
    try {
      await navigator.clipboard.writeText(taskUrl(workspaceId, task.id));
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

  React.useEffect(() => {
    setLocalPriority(task.priority ?? "NONE");
  }, [task.priority]);
  React.useEffect(() => {
    setLocalDueDate(task.dueDateEnd ?? null);
  }, [task.dueDateEnd]);
  React.useEffect(() => {
    if (isPersonallyPinnedProp !== undefined) {
      setLocalPersonalPin(isPersonallyPinnedProp);
    }
  }, [isPersonallyPinnedProp]);

  // Fetch pin state when parent doesn't supply it
  React.useEffect(() => {
    if (isPersonallyPinnedProp !== undefined) {
      return;
    }
    fetch(`/api/tasks/${task.id}/pin`)
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.pinned === "boolean") {
          setLocalPersonalPin(d.pinned);
        }
      })
      .catch(() => {});
  }, [task.id, isPersonallyPinnedProp]);

  React.useEffect(() => {
    function onUnpin(e: Event) {
      if ((e as CustomEvent<{ taskId: string }>).detail.taskId === task.id) {
        setLocalPersonalPin(false);
      }
    }
    window.addEventListener("task-personal-unpin", onUnpin);
    return () => window.removeEventListener("task-personal-unpin", onUnpin);
  }, [task.id]);

  const priority =
    PRIORITY_CONFIG[localPriority as keyof typeof PRIORITY_CONFIG] ??
    PRIORITY_CONFIG.NONE;
  const dueDate = formatDueDate(localDueDate);

  // ── Popover open state ────────────────────────────────────────────────────
  const [assigneeOpen, setAssigneeOpen] = React.useState(false);
  const [members, setMembers] = React.useState<WorkspaceMember[] | null>(null);
  const [memberSearch, setMemberSearch] = React.useState("");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [dateOpen, setDateOpen] = React.useState(false);
  const [priorityOpen, setPriorityOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [moveSprints, setMoveSprints] = React.useState<SprintOption[] | null>(
    null
  );
  const [moveListSpaces, setMoveListSpaces] = React.useState<
    ListSpaceOption[] | null
  >(null);

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function loadMembers() {
    if (members !== null) {
      return;
    }
    const res = await getWorkspaceMembers(workspaceId);
    if ("error" in res) {
      return;
    }
    setMembers(res.members);
  }

  // Force a re-fetch (e.g. after inviting a member) regardless of cache.
  async function refreshMembers() {
    const res = await getWorkspaceMembers(workspaceId);
    if (!("error" in res)) {
      setMembers(res.members);
    }
  }

  async function loadMoveData() {
    if (moveSprints !== null) {
      return;
    }
    const [sprintsRes, listsRes] = await Promise.all([
      getSprints(workspaceId, spaceId),
      getWorkspaceLists(workspaceId, effectiveListId ?? ""),
    ]);
    setMoveSprints(
      "error" in sprintsRes
        ? []
        : sprintsRes.sprints.filter(
            (s) => s.status !== "CLOSED" && s.id !== excludeSprintId
          )
    );
    setMoveListSpaces("error" in listsRes ? [] : listsRes.spaces);
  }

  async function handleTogglePersonalPin(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !localPersonalPin;
    setLocalPersonalPin(next);
    try {
      const res = await fetch(`/api/tasks/${task.id}/pin`, {
        method: next ? "POST" : "DELETE",
      });
      if (res.ok) {
        void mutate(`/api/workspaces/${workspaceId}/pinned-tasks`);
      } else {
        setLocalPersonalPin(!next);
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to update pin");
      }
    } catch {
      setLocalPersonalPin(!next);
      toast.error("Failed to update pin");
    }
  }

  async function handleToggleAssignee(userId: string | null) {
    if (!userId) {
      return;
    }
    const isAssigned = task.assignees.some((a) => a.userId === userId);
    if (isAssigned) {
      await removeAssignee(
        workspaceId,
        spaceId,
        effectiveListId,
        task.id,
        userId
      );
    } else {
      await addAssignee(workspaceId, spaceId, effectiveListId, task.id, userId);
    }
    onRefresh();
  }

  async function handleSetDueDate(date: Date | null) {
    const prev = localDueDate;
    setLocalDueDate(date);
    setDateOpen(false);
    // "Due Date" is the deadline — it maps to `dueDateEnd` and NOTHING else.
    // It deliberately never touches `dueDateStart`: a single-field "Set date"
    // affordance that silently also wrote the start date made every quick-edit
    // overwrite an existing start, and gave date-less tasks a start date the
    // user never asked for. Start dates are edited on the task detail only.
    const res = await updateTask(
      workspaceId,
      spaceId,
      effectiveListId,
      task.id,
      { dueDateEnd: date }
    );
    if ("error" in res) {
      setLocalDueDate(prev);
      toast.error("Failed to update due date");
    } else {
      onRefresh();
    }
  }

  async function handleSetPriority(p: string) {
    const prev = localPriority;
    setLocalPriority(p);
    setPriorityOpen(false);
    const res = await updateTask(
      workspaceId,
      spaceId,
      effectiveListId,
      task.id,
      { priority: p as "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT" }
    );
    if ("error" in res) {
      setLocalPriority(prev);
      toast.error("Failed to update priority");
    } else {
      onRefresh();
    }
  }

  // Generic for every custom field type — `value === null` means "clear"
  // (routed to deleteCustomFieldValue, matching the Task Detail integration),
  // anything else is a set. Mirrors handleSetPriority's optimistic shape.
  async function handleCustomFieldChange(fieldId: string, value: unknown) {
    const prev = localCustomFieldValues[fieldId];
    setLocalCustomFieldValues((p) => ({ ...p, [fieldId]: value }));
    const res =
      value === null || value === undefined
        ? await deleteCustomFieldValue(workspaceId, spaceId, task.id, fieldId)
        : await setCustomFieldValue(
            workspaceId,
            spaceId,
            task.id,
            fieldId,
            value
          );
    if ("error" in res) {
      setLocalCustomFieldValues((p) => ({ ...p, [fieldId]: prev }));
      toast.error(res.error);
    } else {
      onRefresh();
    }
  }

  async function handleMoveToSprint(
    targetSprintId: string,
    sprintName: string
  ) {
    const res = await bulkMoveTasksToSprint(
      workspaceId,
      spaceId,
      effectiveListId || null,
      [task.id],
      targetSprintId
    );
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Moved to ${sprintName}`);
    onRefresh();
  }

  async function handleMoveToList(targetListId: string, listName: string) {
    const res = await moveTask(workspaceId, spaceId, task.id, targetListId);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Moved to ${listName}`);
    onRefresh();
  }

  async function handleDuplicate(e: React.MouseEvent) {
    e.stopPropagation();
    const res = await duplicateTask(
      workspaceId,
      spaceId,
      effectiveListId || null,
      task.id
    );
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    if (onAfterDuplicate) {
      await onAfterDuplicate(res.taskId);
    }
    flashDuplicatedTask(res.taskId);
    onRefresh();
  }

  async function handleArchive(e: React.MouseEvent) {
    e.stopPropagation();
    await archiveTask(workspaceId, spaceId, effectiveListId, task.id);
    onRefresh();
    toastWithUndo("Task archived", async () => {
      await unarchiveTask(workspaceId, spaceId, effectiveListId, task.id);
      onRefresh();
    });
  }

  async function handlePinToList(e: React.MouseEvent) {
    e.stopPropagation();
    const res = await fetch(`/api/tasks/${task.id}/pin-to-list`, {
      method: "POST",
    });
    if (res.ok) {
      onRefresh();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Failed to pin task");
    }
  }

  async function handleUnpinFromList(e: React.MouseEvent) {
    e.stopPropagation();
    const res = await fetch(`/api/tasks/${task.id}/pin-to-list`, {
      method: "DELETE",
    });
    if (res.ok) {
      onRefresh();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Failed to unpin task");
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    const res = await deleteTask(
      workspaceId,
      spaceId,
      effectiveListId,
      task.id
    );
    setDeleting(false);
    setDeleteOpen(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    onRefresh();
  }

  const filteredMembers = (members ?? []).filter(
    (m) =>
      m.name?.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.email?.toLowerCase().includes(memberSearch.toLowerCase())
  );

  // ── Shared column sections ─────────────────────────────────────────────────

  const assigneeCell = (
    // biome-ignore lint/a11y/noStaticElementInteractions: cell only swallows clicks so they don't bubble to the row; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: cell only swallows clicks so they don't bubble to the row; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children
    <div
      className="w-36 shrink-0 self-stretch flex items-center justify-center px-2"
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
      {canEdit ? (
        <Popover
          onOpenChange={(o) => {
            setAssigneeOpen(o);
            if (o) {
              void loadMembers();
            }
          }}
          open={assigneeOpen}
        >
          <PopoverTrigger asChild>
            <button
              className="inline-flex items-center gap-2 px-2 py-1 rounded-md border border-transparent hover:bg-base-200/60 transition-colors cursor-pointer select-none"
              type="button"
            >
              {task.assignees.length > 0 ? (
                <TooltipProvider>
                  <div className="flex -space-x-1.5">
                    {task.assignees.slice(0, 3).map((a) => (
                      <Tooltip key={a.userId}>
                        <TooltipTrigger asChild>
                          <Avatar className="size-6 shrink-0 border border-base-100 shadow-sm">
                            {a.image && (
                              <AvatarImage
                                alt={a.name}
                                src={avatarSrc(a.image)}
                              />
                            )}
                            <AvatarFallback className="text-2xs bg-primary text-primary-content font-semibold">
                              {userInitials(a.name)}
                            </AvatarFallback>
                          </Avatar>
                        </TooltipTrigger>
                        <TooltipContent
                          className="px-2 py-1 text-2xs"
                          side="top"
                        >
                          <p>{a.name}</p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                    {task.assignees.length > 3 && (
                      <div className="flex size-6 items-center justify-center rounded-full border border-base-100 bg-base-200 text-2xs text-base-content/60 font-bold shadow-sm">
                        +{task.assignees.length - 3}
                      </div>
                    )}
                  </div>
                </TooltipProvider>
              ) : (
                <UserIcon
                  className="size-4 text-gray-400 group-hover/row:text-gray-600"
                  weight="bold"
                />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2" side="bottom">
            <Input
              className="h-8 text-xs mb-2"
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search members…"
              value={memberSearch}
            />
            {members === null ? (
              <p className="py-2 px-1 text-xs text-base-content/60">Loading…</p>
            ) : filteredMembers.length === 0 ? (
              <p className="py-2 px-1 text-xs text-base-content/60">
                No members found
              </p>
            ) : (
              <div className="max-h-52 overflow-y-auto">
                <p className="px-1 pb-1 text-2xs font-semibold text-base-content/60 uppercase tracking-wide">
                  People
                </p>
                {filteredMembers.map((m) => {
                  const assigned = task.assignees.some(
                    (a) => a.userId === m.userId
                  );
                  return (
                    <button
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors cursor-pointer",
                        assigned ? "bg-primary/10" : "hover:bg-base-200"
                      )}
                      key={m.userId}
                      onClick={() => void handleToggleAssignee(m.userId)}
                      type="button"
                    >
                      <Avatar className="size-6 shrink-0">
                        {m.image && <AvatarImage src={avatarSrc(m.image)} />}
                        <AvatarFallback className="text-2xs bg-primary/10 text-primary font-semibold">
                          {userInitials(m.name ?? m.email ?? "?")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex-1 min-w-0 text-left truncate">
                        {m.name ?? m.email}
                      </span>
                      {assigned && (
                        <CheckIcon
                          className="size-3.5 text-primary shrink-0"
                          weight="bold"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-1 border-t border-base-300 pt-1">
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-base-content/60 hover:bg-base-200 hover:text-base-content cursor-pointer"
                onClick={() => {
                  setAssigneeOpen(false);
                  setInviteOpen(true);
                }}
                type="button"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-base-300">
                  <UserPlusIcon className="size-3.5" />
                </span>
                <span className="flex-1 truncate text-left">Invite member</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex items-center gap-2 px-2">
          {task.assignees.length > 0 ? (
            <div className="flex -space-x-1.5">
              {task.assignees.slice(0, 3).map((a) => (
                <Avatar
                  className="size-6 shrink-0 border border-base-100 shadow-sm"
                  key={a.userId}
                >
                  {a.image && (
                    <AvatarImage alt={a.name} src={avatarSrc(a.image)} />
                  )}
                  <AvatarFallback className="text-2xs bg-primary text-primary-content font-semibold">
                    {userInitials(a.name)}
                  </AvatarFallback>
                </Avatar>
              ))}
              {task.assignees.length > 3 && (
                <div className="flex size-6 items-center justify-center rounded-full border border-base-100 bg-base-200 text-2xs text-base-content/60 font-bold shadow-sm">
                  +{task.assignees.length - 3}
                </div>
              )}
            </div>
          ) : (
            <UserIcon className="size-4 text-gray-300" weight="bold" />
          )}
        </div>
      )}
    </div>
  );

  const dueDateCell = (
    // biome-ignore lint/a11y/noStaticElementInteractions: cell only swallows clicks so they don't bubble to the row; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: cell only swallows clicks so they don't bubble to the row; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children
    <div
      className="w-28 shrink-0 self-stretch flex items-center px-2"
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
      {canEdit ? (
        <Popover onOpenChange={setDateOpen} open={dateOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-transparent hover:bg-base-200/60 transition-all text-xs font-semibold cursor-pointer select-none",
                dueDate?.overdue ? "text-red-500" : "text-gray-600",
                !dueDate && "opacity-0 group-hover/row:opacity-100"
              )}
              type="button"
            >
              <CalendarBlankIcon className="size-3.5 shrink-0" />
              {dueDate ? (
                <span>{dueDate.label}</span>
              ) : (
                <span className="text-gray-400">Set date</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0" side="bottom">
            {/* A due date can't land before the task's start date — the only
                way `dueDateStart` participates here. It is never written. */}
            <Calendar
              disabled={
                task.dueDateStart
                  ? { before: new Date(task.dueDateStart) }
                  : undefined
              }
              mode="single"
              onSelect={(date) => {
                void handleSetDueDate(date ?? null);
                setDateOpen(false);
              }}
              selected={localDueDate ?? undefined}
            />
            {localDueDate && (
              <div className="border-t p-2">
                <Button
                  className="w-full text-xs"
                  onClick={() => void handleSetDueDate(null)}
                  size="sm"
                  variant="ghost"
                >
                  Clear due date
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      ) : (
        <div
          className={cn(
            "flex items-center gap-1.5 px-2 text-xs font-semibold",
            dueDate?.overdue ? "text-red-500" : "text-gray-400"
          )}
        >
          <CalendarBlankIcon className="size-3.5 shrink-0" />
          {dueDate ? <span>{dueDate.label}</span> : null}
        </div>
      )}
    </div>
  );

  const priorityCell = (
    // biome-ignore lint/a11y/noStaticElementInteractions: cell only swallows clicks so they don't bubble to the row; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: cell only swallows clicks so they don't bubble to the row; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children
    <div
      className="w-32 shrink-0 self-stretch flex items-center px-2"
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
      {canEdit ? (
        <Popover onOpenChange={setPriorityOpen} open={priorityOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-transparent hover:bg-base-200/60 transition-all cursor-pointer select-none",
                localPriority === "NONE" &&
                  "opacity-0 group-hover/row:opacity-100"
              )}
              type="button"
            >
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs font-bold",
                  priority.color
                )}
              >
                <span>{priority.icon}</span>
                {priority.label}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44 p-1" side="bottom">
            <p className="px-2 py-1 text-2xs font-bold text-base-content/60 uppercase tracking-wide">
              Priority
            </p>
            {(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((value) => (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 cursor-pointer",
                  localPriority === value && "bg-base-200"
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
            ))}
            <div className="h-px bg-base-300 my-1" />
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-base-content/60 hover:bg-base-200 cursor-pointer"
              onClick={() => void handleSetPriority("NONE")}
              type="button"
            >
              <XIcon className="size-3.5 shrink-0" /> Clear
            </button>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex items-center gap-1.5 px-2">
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs font-bold",
              priority.color
            )}
          >
            <span>{priority.icon}</span>
            {priority.label}
          </span>
        </div>
      )}
    </div>
  );

  // One thin cell per visible custom field — CustomFieldEditor (PR2, unchanged)
  // owns 100% of the per-type rendering/editing; this component never
  // branches on field.type.
  const customFieldCells = customFields.map((field) => (
    // biome-ignore lint/a11y/noStaticElementInteractions: cell only swallows clicks so they don't bubble to the row; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: cell only swallows clicks so they don't bubble to the row; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children
    <div
      className={cn(
        "self-stretch flex min-w-0 items-center overflow-hidden px-2",
        CUSTOM_FIELD_COLUMN_WIDTH_CLASS[field.type]
      )}
      key={field.id}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) {
          return;
        }
        if (e.key === "Enter") {
          e.stopPropagation();
        }
      }}
      title={describeCustomFieldValue(
        field,
        localCustomFieldValues[field.id],
        workspaceMembers
      )}
    >
      <CustomFieldEditor
        disabled={!canEdit}
        emptyPlaceholder="—"
        field={field}
        members={workspaceMembers}
        onChange={(value) => handleCustomFieldChange(field.id, value)}
        value={localCustomFieldValues[field.id]}
      />
    </div>
  ));

  const actionsCell = (
    // biome-ignore lint/a11y/noStaticElementInteractions: cell only swallows clicks so they don't bubble to the row; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: cell only swallows clicks so they don't bubble to the row; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children
    <div
      className="w-48 shrink-0 py-1.5 pr-4 flex items-center justify-end gap-0.5"
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
      <div className="opacity-0 group-hover/row:opacity-100 transition-all duration-200 flex items-center gap-0.5">
        <button
          className="flex size-7 items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors cursor-pointer"
          onClick={handleTogglePersonalPin}
          title={localPersonalPin ? "Unpin from sidebar" : "Pin to sidebar"}
          type="button"
        >
          <PushPinIcon
            className="size-4"
            weight={localPersonalPin ? "fill" : "regular"}
          />
        </button>
        <button
          className="flex size-7 items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors cursor-pointer"
          onClick={onOpen}
          title="Edit Task"
          type="button"
        >
          <PencilSimpleIcon className="size-4" />
        </button>
        {canEdit && (
          <button
            className="flex size-7 items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors cursor-pointer"
            onClick={handleDuplicate}
            title="Duplicate Task"
            type="button"
          >
            <CopyIcon className="size-4" />
          </button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="flex size-7 items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors cursor-pointer"
              title="Move Status"
              type="button"
            >
              <ArrowsOutCardinalIcon className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1">
            <p className="px-2 py-1 text-2xs font-bold text-base-content/60 uppercase tracking-wide">
              Move Status
            </p>
            {statuses.map((s) => (
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                key={s.id}
                onClick={async () => {
                  await updateTaskStatus(
                    workspaceId,
                    spaceId,
                    effectiveListId,
                    task.id,
                    s.id
                  );
                  onRefresh();
                }}
                type="button"
              >
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
        {isAdmin && (
          <button
            className="flex size-7 items-center justify-center rounded-md hover:bg-red-50 text-red-500 hover:text-red-700 transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteOpen(true);
            }}
            title="Delete Task"
            type="button"
          >
            <TrashIcon className="size-4" />
          </button>
        )}
        {canEdit && (
          <Popover
            onOpenChange={(open) => {
              if (open) {
                void loadMoveData();
              }
            }}
          >
            <PopoverTrigger asChild>
              <button
                className="flex size-7 items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors cursor-pointer"
                type="button"
              >
                <DotsThreeIcon className="size-4.5" weight="bold" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-56 p-1 max-h-80 overflow-y-auto"
            >
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                onClick={startRename}
                type="button"
              >
                <TextAaIcon className="size-3.5 text-base-content/60" /> Rename
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                onClick={copyTaskLink}
                type="button"
              >
                <LinkIcon className="size-3.5 text-base-content/60" /> Copy task
                link
              </button>
              <a
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                href={taskUrl(workspaceId, task.id)}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ArrowSquareOutIcon className="size-3.5 text-base-content/60" />{" "}
                Open in new tab
              </a>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                onClick={copyTaskId}
                type="button"
              >
                <HashIcon className="size-3.5 text-base-content/60" /> Copy task
                ID
              </button>
              <div className="h-px bg-base-300 my-1" />
              <p className="px-2 py-1 text-2xs font-bold text-base-content/60 uppercase tracking-wide">
                Move to Sprint
              </p>
              {moveSprints === null ? (
                <p className="px-2 py-1.5 text-xs text-base-content/60">
                  Loading…
                </p>
              ) : moveSprints.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-base-content/60">
                  No active sprints
                </p>
              ) : (
                moveSprints.map((s) => (
                  <button
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-base-200 cursor-pointer"
                    key={s.id}
                    onClick={() => void handleMoveToSprint(s.id, s.name)}
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
                        "text-2xs px-1.5 py-0.5 rounded-full shrink-0",
                        s.status === "ACTIVE"
                          ? "bg-primary/10 text-primary"
                          : "bg-base-200 text-base-content/60"
                      )}
                    >
                      {s.status === "ACTIVE" ? "Active" : "Planned"}
                    </span>
                  </button>
                ))
              )}
              {onMoveToBacklog && (
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-base-200 cursor-pointer"
                  onClick={() => void onMoveToBacklog()}
                  type="button"
                >
                  <TrayIcon className="size-3.5 shrink-0 text-base-content/60" />{" "}
                  Backlog
                </button>
              )}
              <div className="h-px bg-base-300 my-1" />
              <p className="px-2 py-1 text-2xs font-bold text-base-content/60 uppercase tracking-wide">
                Move to List
              </p>
              {moveListSpaces === null ? (
                <p className="px-2 py-1.5 text-xs text-base-content/60">
                  Loading…
                </p>
              ) : moveListSpaces.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-base-content/60">
                  No other lists
                </p>
              ) : (
                moveListSpaces.map((sp) => (
                  <div key={sp.id}>
                    <p className="flex items-center gap-1.5 px-2 py-0.5 text-2xs font-bold text-base-content/60 uppercase">
                      <SpaceIcon
                        color={sp.color ?? "#6B7280"}
                        emoji={sp.logoEmoji}
                      />
                      {sp.name}
                    </p>
                    {sp.lists.map((l) => (
                      <button
                        className="flex w-full items-center gap-2 rounded pl-5 pr-2 py-1.5 text-xs hover:bg-base-200 cursor-pointer"
                        key={l.id}
                        onClick={() => void handleMoveToList(l.id, l.name)}
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
                ))
              )}
              {canPinToList && (
                <>
                  <div className="h-px bg-base-300 my-1" />
                  {task.isPinnedToList ? (
                    <button
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                      onClick={handleUnpinFromList}
                      type="button"
                    >
                      <PushPinIcon
                        className="size-3.5 text-primary shrink-0"
                        weight="fill"
                      />{" "}
                      Unpin from top
                    </button>
                  ) : (
                    <button
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                      onClick={handlePinToList}
                      type="button"
                    >
                      <PushPinIcon className="size-3.5 text-base-content/60 shrink-0" />{" "}
                      Pin to top
                    </button>
                  )}
                </>
              )}
              <div className="h-px bg-base-300 my-1" />
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                onClick={handleArchive}
                type="button"
              >
                <ArchiveIcon className="size-3.5 text-base-content/60" />{" "}
                Archive
              </button>
            </PopoverContent>
          </Popover>
        )}
        {/* Viewers get a minimal menu with just the share actions. */}
        {!canEdit && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex size-7 items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors cursor-pointer"
                type="button"
              >
                <DotsThreeIcon className="size-4.5" weight="bold" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                onClick={copyTaskLink}
                type="button"
              >
                <LinkIcon className="size-3.5 text-base-content/60" /> Copy task
                link
              </button>
              <a
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                href={taskUrl(workspaceId, task.id)}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ArrowSquareOutIcon className="size-3.5 text-base-content/60" />{" "}
                Open in new tab
              </a>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                onClick={copyTaskId}
                type="button"
              >
                <HashIcon className="size-3.5 text-base-content/60" /> Copy task
                ID
              </button>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Invite member (from assignee dropdown) */}
      <InviteMemberModal
        onInvited={refreshMembers}
        onOpenChange={setInviteOpen}
        open={inviteOpen}
        workspaceId={workspaceId}
      />

      {/* Delete confirmation */}
      <Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <DialogContent
          className="sm:max-w-sm text-center"
          onClick={(e) => e.stopPropagation()}
          showCloseButton={false}
        >
          <div className="flex justify-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-red-100">
              <TrashIcon className="size-6 text-red-500" />
            </div>
          </div>
          <div className="space-y-1.5">
            <DialogTitle className="text-center text-base">
              Delete task?
            </DialogTitle>
            <p className="text-sm text-base-content/60 text-center leading-relaxed">
              <span className="font-medium text-base-content">
                &ldquo;{task.title}&rdquo;
              </span>{" "}
              will move to Trash. A workspace admin can restore it.
            </p>
          </div>
          <div className="flex gap-3 mt-1">
            <Button
              className="flex-1"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={deleting}
              onClick={confirmDelete}
              variant="destructive"
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Desktop row */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: row has nested interactive controls (buttons, popovers); keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: row has nested interactive controls (buttons, popovers); keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children */}
      <div
        ref={dragRef}
        style={dragStyle}
        {...dragProps}
        className={cn(
          "group/row hidden md:flex items-center border-b border-base-300 cursor-pointer text-base-content bg-elevated min-h-10 text-sm",
          "outline-none focus:ring-2 focus:ring-inset focus:ring-primary/50 focus:relative focus:z-[1]",
          isDragging
            ? "opacity-40 shadow-none border-dashed"
            : "transition-colors duration-150",
          highlighted
            ? "bg-primary/10 ring-1 ring-inset ring-primary/30 relative z-[1]"
            : selected
              ? "bg-primary/5"
              : "hover:bg-base-200/30"
        )}
        data-task-id={task.id}
        data-task-row
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) {
            return;
          }
          if (e.key === "Enter") {
            onOpen();
          }
        }}
        tabIndex={-1}
      >
        <div
          className={cn(
            "w-0.75 self-stretch shrink-0 transition-opacity duration-200",
            selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
          )}
          style={{ backgroundColor: statusColor }}
        />
        <div className="flex items-center gap-1 pl-2 py-1.5 shrink-0 w-14">
          {dragProps && (
            <DotsSixVerticalIcon
              className={cn(
                "size-3.5 text-base-content/60 shrink-0 transition duration-200 cursor-grab active:cursor-grabbing hover:text-base-content",
                selected
                  ? "opacity-100"
                  : "opacity-0 group-hover/row:opacity-100"
              )}
            />
          )}
          <button
            className={cn(
              "flex size-4 items-center justify-center rounded border transition-opacity duration-200 cursor-pointer",
              selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(task.id, !selected);
            }}
            type="button"
          >
            <div
              className={cn(
                "flex size-4 items-center justify-center rounded border transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-content"
                  : "border-base-300 hover:border-primary/40 bg-base-100"
              )}
            >
              {selected && <CheckIcon className="size-2.5" weight="bold" />}
            </div>
          </button>
        </div>
        <div className="flex flex-1 items-center gap-2.5 min-w-0 py-1.5 pr-4 pl-1">
          <span className="text-2xs text-gray-400 font-mono shrink-0 select-none flex items-center gap-1.5">
            <PushPinIcon
              className={cn(
                "size-2.5 shrink-0",
                localPersonalPin ? "text-primary" : "invisible"
              )}
              weight="fill"
            />
            #{task.seqNumber}
          </span>
          {renaming ? (
            <input
              autoFocus
              className="flex-1 min-w-0 bg-transparent text-[13px] font-medium text-base-content outline-none border-b border-primary/50"
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
              value={titleDraft}
            />
          ) : (
            <>
              <span className="text-[13px] font-medium text-base-content truncate group-hover/row:text-primary transition-colors">
                {localTitle}
              </span>
              {canEdit && (
                <button
                  aria-label={`Rename “${localTitle}”`}
                  className="flex size-5 shrink-0 items-center justify-center rounded-md text-base-content/60 opacity-0 transition-colors hover:bg-base-200 hover:text-base-content focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 group-hover/row:opacity-100 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename();
                  }}
                  title="Rename task"
                  type="button"
                >
                  <PencilSimpleIcon className="size-3" />
                </button>
              )}
            </>
          )}
          {task.tags.slice(0, 2).map((tag) => (
            <span
              className="hidden lg:inline-flex shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold tracking-wide border"
              key={tag.id}
              style={{
                backgroundColor: `${tag.color}10`,
                color: tag.color,
                borderColor: `${tag.color}30`,
              }}
            >
              {tag.name}
            </span>
          ))}
          {task.dependencyInfo && (
            <TaskDependencyBadge
              className="shrink-0"
              incomplete={task.dependencyInfo.incomplete}
              total={task.dependencyInfo.total}
            />
          )}
          <TrackedTimeBadge
            className="shrink-0"
            seconds={task.trackedSeconds}
          />
        </div>
        {assigneeCell}
        {dueDateCell}
        {priorityCell}
        {customFieldCells}
        {actionsCell}
      </div>

      {/* Mobile card */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: card has nested interactive controls (buttons, popovers); keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: card has nested interactive controls (buttons, popovers); keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children */}
      <div
        className={cn(
          "md:hidden flex flex-col p-4 border-b border-base-300 gap-3 hover:bg-base-200/30 bg-elevated transition-all cursor-pointer relative",
          highlighted && "bg-primary/10 ring-1 ring-inset ring-primary/30"
        )}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) {
            return;
          }
          if (e.key === "Enter") {
            onOpen();
          }
        }}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: card has no alternative keyboard entry point (unlike the desktop row, it isn't part of the roving-tabindex list nav), and no ARIA role fits with nested interactive children
        tabIndex={0}
      >
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: statusColor }}
        />
        <div className="flex items-start gap-2.5 pl-2">
          <button
            className="flex size-4.5 items-center justify-center rounded border transition-colors cursor-pointer shrink-0 mt-0.5"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(task.id, !selected);
            }}
            type="button"
          >
            <div
              className={cn(
                "flex size-4 items-center justify-center rounded border transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-content"
                  : "border-base-300 hover:border-primary/40 bg-base-100"
              )}
            >
              {selected && <CheckIcon className="size-2.5" weight="bold" />}
            </div>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-2xs text-gray-400 font-mono font-bold">
                #{task.seqNumber}
              </span>
              {localPriority !== "NONE" && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-2xs font-bold px-1.5 py-0.5 rounded border border-current/10 bg-current/5",
                    PRIORITY_CONFIG[
                      localPriority as keyof typeof PRIORITY_CONFIG
                    ]?.color ?? "text-gray-400"
                  )}
                >
                  <span>
                    {
                      PRIORITY_CONFIG[
                        localPriority as keyof typeof PRIORITY_CONFIG
                      ]?.icon
                    }
                  </span>
                  {
                    PRIORITY_CONFIG[
                      localPriority as keyof typeof PRIORITY_CONFIG
                    ]?.label
                  }
                </span>
              )}
            </div>
            {renaming ? (
              <input
                autoFocus
                className="w-full bg-transparent text-[13px] font-medium text-base-content outline-none border-b border-primary/50"
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
                value={titleDraft}
              />
            ) : (
              <p className="text-[13px] font-medium text-base-content line-clamp-2">
                {localTitle}
              </p>
            )}
          </div>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: wrapper only swallows clicks so they don't bubble to the card; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children */}
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: wrapper only swallows clicks so they don't bubble to the card; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children */}
          <div
            className="shrink-0"
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
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="flex size-7 items-center justify-center rounded hover:bg-base-200 text-base-content/60 cursor-pointer"
                  type="button"
                >
                  <DotsThreeIcon className="size-4.5" weight="bold" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                  onClick={onOpen}
                  type="button"
                >
                  <PencilSimpleIcon className="size-3.5 text-base-content/60" />{" "}
                  Edit
                </button>
                {canEdit && (
                  <button
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                    onClick={startRename}
                    type="button"
                  >
                    <TextAaIcon className="size-3.5 text-base-content/60" />{" "}
                    Rename
                  </button>
                )}
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                  onClick={copyTaskLink}
                  type="button"
                >
                  <LinkIcon className="size-3.5 text-base-content/60" /> Copy
                  link
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                  onClick={copyTaskId}
                  type="button"
                >
                  <HashIcon className="size-3.5 text-base-content/60" /> Copy ID
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                  onClick={handleDuplicate}
                  type="button"
                >
                  <CopyIcon className="size-3.5 text-base-content/60" />{" "}
                  Duplicate
                </button>
                {isAdmin ? (
                  <button
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 text-left cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteOpen(true);
                    }}
                    type="button"
                  >
                    <TrashIcon className="size-3.5" /> Delete
                  </button>
                ) : (
                  <button
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-base-200 text-left cursor-pointer"
                    onClick={handleArchive}
                    type="button"
                  >
                    <ArchiveIcon className="size-3.5 text-base-content/60" />{" "}
                    Archive
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="flex items-center justify-between pl-2 mt-1">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: wrapper only swallows clicks so they don't bubble to the card; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children */}
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: wrapper only swallows clicks so they don't bubble to the card; keyboard access via tabIndex+onKeyDown below, ARIA role would be invalid with nested interactive children */}
          <div
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
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded bg-base-200/50 text-2xs font-semibold transition-all cursor-pointer",
                    dueDate?.overdue
                      ? "text-red-500 bg-red-50"
                      : "text-base-content/70"
                  )}
                  type="button"
                >
                  <CalendarBlankIcon className="size-3.5" />
                  <span>{dueDate ? dueDate.label : "Set date"}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  disabled={
                    task.dueDateStart
                      ? { before: new Date(task.dueDateStart) }
                      : undefined
                  }
                  mode="single"
                  onSelect={(date) => void handleSetDueDate(date ?? null)}
                  selected={localDueDate ?? undefined}
                />
                {localDueDate && (
                  <div className="border-t p-2">
                    <Button
                      className="w-full text-xs"
                      onClick={() => void handleSetDueDate(null)}
                      size="sm"
                      variant="ghost"
                    >
                      Clear due date
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
          <button
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
            type="button"
          >
            {task.assignees.length > 0 && (
              <div className="flex -space-x-1.5">
                {task.assignees.slice(0, 3).map((a) => (
                  <Avatar
                    className="size-5.5 border border-base-100"
                    key={a.userId}
                  >
                    {a.image && <AvatarImage src={avatarSrc(a.image)} />}
                    <AvatarFallback className="text-[8px] bg-primary text-primary-content font-semibold">
                      {userInitials(a.name)}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {task.assignees.length > 3 && (
                  <div className="flex size-5.5 items-center justify-center rounded-full border border-base-100 bg-base-200 text-[8px] font-bold text-base-content/60">
                    +{task.assignees.length - 3}
                  </div>
                )}
              </div>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
