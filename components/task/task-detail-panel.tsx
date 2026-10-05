"use client";

import {
  ArchiveIcon,
  CheckIcon,
  ClipboardTextIcon,
  CopyIcon,
  DotsThreeIcon,
  EyeIcon,
  EyeSlashIcon,
  GearIcon,
  LinkIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
  UserPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import {
  type CustomFieldRow,
  deleteCustomFieldValue,
  getCustomFieldsForTasks,
  setCustomFieldValue,
} from "@/app/actions/custom-field";
import {
  archiveTask,
  deleteTask,
  duplicateTask,
  getTaskDetail,
  getWorkspaceMembers,
  unarchiveTask,
  updateTask,
  updateTaskStatus,
} from "@/app/actions/task";
import {
  addAssignee,
  removeAssignee,
  toggleWatcher,
} from "@/app/actions/task-assignee";
import {
  addChecklistItem,
  createChecklist,
  deleteChecklist,
  deleteChecklistItem,
  toggleChecklistItem,
} from "@/app/actions/task-checklist";
import {
  addTaskTag,
  createTag,
  deleteTag,
  getWorkspaceTags,
  removeTaskTag,
} from "@/app/actions/task-tag";
import { ManageStatusesDialog } from "@/components/list/manage-statuses-dialog";
import { AttachmentPreviewProvider } from "@/components/task/attachment-preview-modal";
import { CustomFieldEditor } from "@/components/task/custom-field-editors";
import { MemberSearchInput } from "@/components/task/member-search-input";
import {
  TaskActivityFeed,
  type TaskActivityFeedHandle,
} from "@/components/task/task-activity-feed";
import { TaskDependencies } from "@/components/task/task-dependencies";
import { TaskDescriptionEditor } from "@/components/task/task-description-editor";
import { TaskTimeTracking } from "@/components/task/task-time-tracking";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { InviteMemberModal } from "@/components/workspace/invite-member-modal";
import { flashDuplicatedTask } from "@/lib/duplicate-highlight";
import { filterMembersByQuery } from "@/lib/member-search";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

interface TaskDetailPanelProps {
  inline?: boolean; // render content directly without Sheet overlay
  isAdmin?: boolean;
  listId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  spaceId: string;
  taskId: string;
  workspaceId: string;
}

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<
  Priority,
  { label: string; color: string; icon: string; bg: string }
> = {
  NONE: {
    label: "No Priority",
    color: "text-base-content/60",
    icon: "😴",
    bg: "bg-base-200/60",
  },
  LOW: {
    label: "Low",
    color: "text-blue-500",
    icon: "🦥",
    bg: "bg-blue-50 dark:bg-blue-950/40",
  },
  MEDIUM: {
    label: "Medium",
    color: "text-yellow-500",
    icon: "🚶",
    bg: "bg-yellow-50 dark:bg-yellow-950/40",
  },
  HIGH: {
    label: "High",
    color: "text-orange-500",
    icon: "🏃",
    bg: "bg-orange-50 dark:bg-orange-950/40",
  },
  URGENT: {
    label: "Urgent",
    color: "text-red-500",
    icon: "🚨",
    bg: "bg-red-50 dark:bg-red-950/40",
  },
};

// ─── Avatar helper ────────────────────────────────────────────────────────────

function userInitials(name: string | null, email: string | null) {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return (email ?? "?").slice(0, 2).toUpperCase();
}

// ─── Assignee member picker ──────────────────────────────────────────────────

function AssigneeMemberPicker({
  members,
  assignees,
  onToggle,
  onInvite,
}: {
  members: { userId: string | null; name: string; email: string }[];
  assignees: { userId: string | null }[];
  onToggle: (userId: string) => void | Promise<void>;
  onInvite: () => void;
}) {
  const [search, setSearch] = React.useState("");
  const filtered = filterMembersByQuery(members, search);
  return (
    <>
      <p className="text-xs font-medium text-base-content/60 mb-1.5 px-1">
        Select members
      </p>
      <MemberSearchInput onChange={setSearch} value={search} />
      <div className="space-y-0.5 max-h-48 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-base-content/60">
            No members found
          </p>
        )}
        {filtered.map((m) => {
          const isAssigned = assignees.some((a) => a.userId === m.userId);
          return (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
              key={m.userId}
              onClick={() => onToggle(m.userId!)}
              type="button"
            >
              <Avatar className="size-6 shrink-0">
                <AvatarFallback className="text-2xs">
                  {userInitials(m.name, m.email)}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-left">
                {m.name || m.email}
              </span>
              {isAssigned && (
                <CheckIcon className="size-3.5 text-primary shrink-0" />
              )}
            </button>
          );
        })}
      </div>
      <Separator className="my-1.5" />
      <button
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-base-content/60 hover:bg-base-200 hover:text-base-content"
        onClick={onInvite}
        type="button"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-base-300">
          <UserPlusIcon className="size-3.5" />
        </span>
        <span className="flex-1 truncate text-left">Invite member</span>
      </button>
    </>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function TaskDetailPanel({
  open,
  onOpenChange,
  taskId,
  workspaceId,
  spaceId,
  listId,
  isAdmin,
  inline = false,
}: TaskDetailPanelProps) {
  const router = useRouter();
  const [data, setData] = React.useState<Awaited<
    ReturnType<typeof getTaskDetail>
  > | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [titleEditing, setTitleEditing] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState("");
  const [descDraft, setDescDraft] = React.useState("");
  const [members, setMembers] = React.useState<
    {
      userId: string | null;
      name: string;
      email: string;
      image: string | null;
    }[]
  >([]);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [allTags, setAllTags] = React.useState<
    { id: string; name: string; color: string }[]
  >([]);
  const [customFields, setCustomFields] = React.useState<CustomFieldRow[]>([]);
  const [customFieldValues, setCustomFieldValues] = React.useState<
    Record<string, unknown>
  >({});
  const [deleteTagTarget, setDeleteTagTarget] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const [newChecklistName, setNewChecklistName] = React.useState("");
  const [addingChecklist, setAddingChecklist] = React.useState(false);
  const [newItemTexts, setNewItemTexts] = React.useState<
    Record<string, string>
  >({});
  const feedRef = React.useRef<TaskActivityFeedHandle>(null);
  const checklistFormRef = React.useRef<HTMLDivElement>(null);
  const addChecklistTriggerRef = React.useRef<HTMLButtonElement>(null);
  const mainColumnRef = React.useRef<HTMLDivElement>(null);
  const [saving, setSaving] = React.useState(false);
  const [startCalOpen, setStartCalOpen] = React.useState(false);
  const [endCalOpen, setEndCalOpen] = React.useState(false);
  const [manageStatusesOpen, setManageStatusesOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  // Mobile-only compact Assignee/Due date block (< sm) — surfaces the two
  // most-used sidebar fields near the top instead of at the very bottom of a
  // long scroll. Separate popover-open state from the sidebar's own (below),
  // since both triggers stay mounted (one hidden via CSS) and sharing state
  // would open both Popover instances at once.
  const [mobileAssigneePopoverOpen, setMobileAssigneePopoverOpen] =
    React.useState(false);
  const [mobileStartCalOpen, setMobileStartCalOpen] = React.useState(false);
  const [mobileEndCalOpen, setMobileEndCalOpen] = React.useState(false);

  // Note: `load()` intentionally does NOT flip `loading` to true — it refetches
  // in the background so the panel stays mounted. Blanking the panel to a
  // skeleton on every post-edit / realtime refetch would unmount the
  // AttachmentPreviewProvider below and close an open image preview (the modal's
  // open state lives in that provider). The skeleton is shown only on the
  // initial open / task switch, via the effect below.
  const load = React.useCallback(async () => {
    const [detail, mem, tags, customFieldsRes] = await Promise.all([
      getTaskDetail(workspaceId, spaceId, taskId),
      getWorkspaceMembers(workspaceId),
      getWorkspaceTags(workspaceId),
      getCustomFieldsForTasks(workspaceId, spaceId, listId, [taskId]),
    ]);
    setData(detail && !("error" in detail) ? detail : null);
    if (mem && !("error" in mem)) {
      setMembers(
        mem.members.filter(
          (m): m is typeof m & { userId: string } => m.userId !== null
        )
      );
    }
    if (tags && !("error" in tags)) {
      setAllTags(tags.tags);
    }
    if (customFieldsRes && !("error" in customFieldsRes)) {
      setCustomFields(customFieldsRes.fields);
      setCustomFieldValues(customFieldsRes.valuesByTask[taskId] ?? {});
    }
    setLoading(false);
  }, [workspaceId, spaceId, taskId, listId]);

  React.useEffect(() => {
    if (open && taskId) {
      // Show the skeleton only for a genuine open / switch to another task.
      setLoading(true);
      load();
    }
  }, [open, taskId, load]);

  React.useEffect(() => {
    if (data && !("error" in data)) {
      setTitleDraft(data.task.title);
      setDescDraft(
        typeof data.task.description === "string"
          ? data.task.description
          : data.task.description
            ? JSON.stringify(data.task.description)
            : ""
      );
    }
  }, [data]);

  // Click-outside-to-cancel for the checklist form. Only listens while the
  // form is open, and `mousedown` (not `click`) so it fires before any other
  // click handler on the page and can't race with one.
  React.useEffect(() => {
    if (!addingChecklist) {
      return;
    }
    function handlePointerDown(e: MouseEvent) {
      if (
        checklistFormRef.current &&
        !checklistFormRef.current.contains(e.target as Node)
      ) {
        setAddingChecklist(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [addingChecklist]);

  // Return focus to the "Add checklist" trigger after the form closes, no
  // matter which of the three ways (Escape / Cancel / outside click) closed
  // it, so keyboard users don't lose their place.
  const wasAddingChecklistRef = React.useRef(false);
  React.useEffect(() => {
    if (wasAddingChecklistRef.current && !addingChecklist) {
      addChecklistTriggerRef.current?.focus();
    }
    wasAddingChecklistRef.current = addingChecklist;
  }, [addingChecklist]);

  if (!open) {
    return null;
  }

  if (loading || !data || "error" in data) {
    const loadingContent = (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-base-content/60">
          {loading ? "Loading…" : "Task not found"}
        </p>
      </div>
    );
    if (inline) {
      return <div className="h-full overflow-y-auto">{loadingContent}</div>;
    }
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent
          aria-describedby={undefined}
          className="w-full sm:max-w-2xl overflow-y-auto"
        >
          {loadingContent}
        </SheetContent>
      </Sheet>
    );
  }

  const {
    task: t,
    assignees,
    watchers,
    tags,
    checklists,
    blockedBy,
    blocks,
    timeEntries,
    canEdit,
    statuses,
    currentUserId,
  } = data;
  const isWatching = watchers.some((w) => w.userId === currentUserId);
  const priority =
    PRIORITY_CONFIG[t.priority as Priority] ?? PRIORITY_CONFIG.NONE;
  const totalChecked = checklists
    .flatMap((c) => c.items)
    .filter((i) => i.isChecked).length;
  const totalItems = checklists.flatMap((c) => c.items).length;
  const checkProgress =
    totalItems > 0 ? Math.round((totalChecked / totalItems) * 100) : 0;

  async function saveTitle() {
    if (!titleDraft.trim() || titleDraft === t.title) {
      setTitleEditing(false);
      return;
    }
    await updateTask(workspaceId, spaceId, listId, taskId, {
      title: titleDraft.trim(),
    });
    setTitleEditing(false);
    load();
  }

  async function saveDescription() {
    // Blur fires this even with no edit — skip the write (and its spurious
    // "updated the description" activity) when the draft matches the server value.
    const serverDesc =
      typeof t.description === "string"
        ? t.description
        : t.description
          ? JSON.stringify(t.description)
          : "";
    if (descDraft === serverDesc) {
      return;
    }
    await updateTask(workspaceId, spaceId, listId, taskId, {
      description: descDraft,
    });
    load();
  }

  async function handleStatusChange(statusId: string) {
    await updateTaskStatus(workspaceId, spaceId, listId, taskId, statusId);
    load();
  }

  async function handlePriorityChange(p: Priority) {
    await updateTask(workspaceId, spaceId, listId, taskId, { priority: p });
    load();
  }

  async function handleDueDateChange(
    field: "start" | "end",
    date: Date | null
  ) {
    if (field === "start") {
      // Keep end >= start: if the new start is after the current end, move end too.
      const patch =
        date && dueDateEnd && date > dueDateEnd
          ? { dueDateStart: date, dueDateEnd: date }
          : { dueDateStart: date };
      await updateTask(workspaceId, spaceId, listId, taskId, patch);
    } else {
      await updateTask(workspaceId, spaceId, listId, taskId, {
        dueDateEnd: date,
      });
    }
    load();
  }

  async function handleToggleAssignee(userId: string) {
    const already = assignees.some((a) => a.userId === userId);
    if (already) {
      await removeAssignee(workspaceId, spaceId, listId, taskId, userId);
    } else {
      await addAssignee(workspaceId, spaceId, listId, taskId, userId);
    }
    load();
  }

  // Updates local state directly on success instead of calling load() — a
  // custom field value change doesn't invalidate anything else load() fetches,
  // so there's nothing to gain from re-fetching the whole task. `value ===
  // null` means "clear" — routed to deleteCustomFieldValue (revert to the
  // field's default) rather than persisting an explicit null.
  async function handleCustomFieldChange(fieldId: string, value: unknown) {
    if (value === null || value === undefined) {
      const res = await deleteCustomFieldValue(
        workspaceId,
        spaceId,
        taskId,
        fieldId
      );
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const field = customFields.find((f) => f.id === fieldId);
      setCustomFieldValues((prev) => ({
        ...prev,
        [fieldId]: field?.defaultValue ?? null,
      }));
      return;
    }
    const res = await setCustomFieldValue(
      workspaceId,
      spaceId,
      taskId,
      fieldId,
      value
    );
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function handleToggleTag(tagId: string) {
    const already = tags.some((tag) => tag.id === tagId);
    if (already) {
      await removeTaskTag(workspaceId, spaceId, listId, taskId, tagId);
    } else {
      await addTaskTag(workspaceId, spaceId, listId, taskId, tagId);
    }
    load();
  }

  async function handleCreateTag(name: string) {
    const res = await createTag(workspaceId, name);
    if ("tag" in res) {
      await addTaskTag(workspaceId, spaceId, listId, taskId, res.tag.id);
      load();
    }
  }

  async function handleDeleteTag() {
    if (!deleteTagTarget) {
      return;
    }
    await deleteTag(workspaceId, deleteTagTarget.id);
    setDeleteTagTarget(null);
    load();
  }

  async function handleToggleWatch() {
    await toggleWatcher(workspaceId, spaceId, listId, taskId);
    load();
  }

  async function handleAddChecklist() {
    if (!newChecklistName.trim()) {
      return;
    }
    await createChecklist(
      workspaceId,
      spaceId,
      listId,
      taskId,
      newChecklistName
    );
    setNewChecklistName("");
    setAddingChecklist(false);
    load();
  }

  // Closing the checklist form — via Escape, the Cancel button, or a click
  // outside — never clears the draft (matches how Escape/Cancel already
  // behaved), so reopening "Add checklist" picks the draft back up.
  function closeChecklistForm() {
    setAddingChecklist(false);
  }

  async function handleToggleItem(itemId: string) {
    await toggleChecklistItem(workspaceId, spaceId, listId, itemId);
    load();
  }

  async function handleAddItem(checklistId: string) {
    const text = newItemTexts[checklistId] ?? "";
    if (!text.trim()) {
      return;
    }
    await addChecklistItem(workspaceId, spaceId, listId, checklistId, text);
    setNewItemTexts((prev) => ({ ...prev, [checklistId]: "" }));
    load();
  }

  async function handleDuplicate() {
    setSaving(true);
    const res = await duplicateTask(workspaceId, spaceId, listId, taskId);
    setSaving(false);
    if ("taskId" in res) {
      flashDuplicatedTask(res.taskId);
      onOpenChange(false);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  async function handleArchive() {
    await archiveTask(workspaceId, spaceId, listId, taskId);
    onOpenChange(false);
    toastWithUndo("Task archived", async () => {
      await unarchiveTask(workspaceId, spaceId, listId, taskId);
      router.refresh();
    });
  }

  function handleDelete() {
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    setDeleting(true);
    const res = await deleteTask(workspaceId, spaceId, listId, taskId);
    setDeleting(false);
    setDeleteOpen(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    onOpenChange(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/${workspaceId}/task/${taskId}`
      );
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  const dueDateStart = t.dueDateStart ? new Date(t.dueDateStart) : null;
  const dueDateEnd = t.dueDateEnd ? new Date(t.dueDateEnd) : null;

  const panelContent = (
    <>
      {/* Header */}
      <div className="flex items-start gap-2 border-b px-4 py-4 sm:px-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-base-content/60 mb-1">
            <ClipboardTextIcon className="size-3.5" />
            <span className="font-mono">#{t.seqNumber}</span>
            <button
              className="flex items-center gap-1 hover:text-base-content"
              onClick={() => void copyLink()}
              type="button"
            >
              <LinkIcon className="size-3" />
              Copy link
            </button>
          </div>
          {titleEditing ? (
            // Textarea so a long title keeps the same size and wraps while
            // editing (see task-detail-page). Auto-grows; Enter still saves.
            <textarea
              autoFocus
              className="-mx-1 block w-full resize-none overflow-hidden rounded bg-transparent px-1 py-0.5 text-base font-semibold leading-snug outline-none"
              onBlur={saveTitle}
              onChange={(e) => {
                setTitleDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveTitle();
                }
                if (e.key === "Escape") {
                  setTitleEditing(false);
                }
              }}
              ref={(el) => {
                if (el) {
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }
              }}
              rows={1}
              value={titleDraft}
            />
          ) : (
            <h2 className="text-base font-semibold">
              <button
                className="w-full cursor-text rounded px-1 -mx-1 py-0.5 text-left hover:bg-base-200"
                onClick={() => setTitleEditing(true)}
                type="button"
              >
                {t.title}
              </button>
            </h2>
          )}
        </div>
        {/* Header actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            className={cn(
              "flex min-h-11 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors sm:min-h-0",
              isWatching
                ? "bg-primary/10 text-primary"
                : "text-base-content/60 hover:bg-base-200 hover:text-base-content"
            )}
            onClick={handleToggleWatch}
            type="button"
          >
            {isWatching ? (
              <EyeSlashIcon className="size-3.5" />
            ) : (
              <EyeIcon className="size-3.5" />
            )}
            {isWatching ? "Unwatch" : "Watch"}
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex size-11 items-center justify-center rounded-md hover:bg-base-200 sm:size-8"
                type="button"
              >
                <DotsThreeIcon className="size-4.5" weight="bold" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                disabled={saving}
                onClick={handleDuplicate}
                type="button"
              >
                <CopyIcon className="size-3.5 text-base-content/60" /> Duplicate
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                onClick={handleArchive}
                type="button"
              >
                <ArchiveIcon className="size-3.5 text-base-content/60" />{" "}
                Archive
              </button>
              <Separator className="my-1" />
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-error hover:bg-error/10"
                onClick={handleDelete}
                type="button"
              >
                <TrashIcon className="size-3.5" /> Delete
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Body — two-column at `sm`+ (each pane scrolls independently, matching
        the Sheet's own `w-full sm:max-w-2xl` breakpoint); below `sm` it's a
        single naturally-flowing column that scrolls as one. */}
      <div className="flex flex-1 flex-col min-h-0 overflow-y-auto sm:flex-row sm:overflow-hidden">
        {/* Main column */}
        <div
          className="flex-1 min-w-0 px-4 pt-4 space-y-6 sm:overflow-y-auto sm:px-6"
          ref={mainColumnRef}
        >
          {/* Status + Priority row */}
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1">
              <Select
                onValueChange={handleStatusChange}
                value={t.statusId ?? undefined}
              >
                <SelectTrigger className="h-11 w-auto text-xs px-2 gap-1.5 sm:h-7">
                  {/* SelectValue already renders the selected item's dot + name. */}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" position="popper" sideOffset={4}>
                  {(["OPEN", "ACTIVE", "CLOSED"] as const).map((type) => {
                    const group = statuses.filter((s) => s.type === type);
                    if (group.length === 0) {
                      return null;
                    }
                    const label =
                      type === "OPEN"
                        ? "Not started"
                        : type === "ACTIVE"
                          ? "Active"
                          : "Closed";
                    return (
                      <SelectGroup key={type}>
                        <SelectLabel className="text-2xs font-semibold uppercase tracking-wider text-base-content/60 px-2 py-1">
                          {label}
                        </SelectLabel>
                        {group.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="flex items-center gap-1.5">
                              <span
                                className="size-2 rounded-full shrink-0"
                                style={{ backgroundColor: s.color }}
                              />
                              {s.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
              {isAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex size-5 items-center justify-center rounded text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors"
                      type="button"
                    >
                      <DotsThreeIcon className="size-3.5" weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-36"
                    side="right"
                  >
                    <DropdownMenuItem
                      onClick={() => setManageStatusesOpen(true)}
                    >
                      <GearIcon className="size-3.5" />
                      Edit statuses
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <Select
              onValueChange={(v) => handlePriorityChange(v as Priority)}
              value={t.priority}
            >
              <SelectTrigger
                className={cn(
                  "h-11 w-auto text-xs px-2 gap-1.5 sm:h-7",
                  priority.color,
                  priority.bg
                )}
              >
                {/* SelectValue already renders the selected item's icon + label. */}
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" position="popper" sideOffset={4}>
                <SelectGroup>
                  {(
                    Object.entries(PRIORITY_CONFIG) as [
                      Priority,
                      (typeof PRIORITY_CONFIG)[Priority],
                    ][]
                  ).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>
                      <span
                        className={cn("flex items-center gap-1.5", cfg.color)}
                      >
                        <span>{cfg.icon}</span>
                        {cfg.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Mobile-only compact Assignee + Due date (< sm) — the sidebar's
            own Assignees/Due date blocks (below) are hidden on mobile in
            favor of this, so key properties aren't buried under
            Description/Checklist/Time Tracking/Dependencies/Activity. */}
          <div className="space-y-3 rounded-xl border bg-elevated p-3 sm:hidden">
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-base-content/60">
                Assignee
              </span>
              <Popover
                onOpenChange={setMobileAssigneePopoverOpen}
                open={mobileAssigneePopoverOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className="flex min-h-9 flex-1 items-center gap-1.5 text-left"
                    type="button"
                  >
                    {assignees.length > 0 ? (
                      <>
                        <Avatar className="size-5 shrink-0">
                          <AvatarFallback className="text-[9px]">
                            {userInitials(
                              assignees[0].name,
                              assignees[0].email
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate text-sm">
                          {assignees[0].name ?? assignees[0].email}
                        </span>
                        {assignees.length > 1 && (
                          <span className="shrink-0 text-xs text-base-content/60">
                            +{assignees.length - 1}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-sm text-base-content/60">
                        Unassigned
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2">
                  <AssigneeMemberPicker
                    assignees={assignees}
                    members={members}
                    onInvite={() => {
                      setMobileAssigneePopoverOpen(false);
                      setInviteOpen(true);
                    }}
                    onToggle={handleToggleAssignee}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-base-content/60">
                Dates
              </span>
              <div className="flex min-h-9 flex-1 items-center gap-1.5 text-sm">
                <Popover
                  onOpenChange={setMobileStartCalOpen}
                  open={mobileStartCalOpen}
                >
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "truncate",
                        dueDateStart
                          ? "text-base-content"
                          : "text-base-content/60"
                      )}
                      type="button"
                    >
                      {dueDateStart ? format(dueDateStart, "MMM d") : "Start"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-auto p-0"
                    collisionPadding={16}
                  >
                    <Calendar
                      mode="single"
                      onSelect={(date) => {
                        handleDueDateChange("start", date ?? null);
                        setMobileStartCalOpen(false);
                      }}
                      selected={dueDateStart ?? undefined}
                    />
                  </PopoverContent>
                </Popover>
                <span className="shrink-0 text-base-content/60">→</span>
                <Popover
                  onOpenChange={setMobileEndCalOpen}
                  open={mobileEndCalOpen}
                >
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "truncate",
                        dueDateEnd
                          ? "text-base-content"
                          : "text-base-content/60"
                      )}
                      type="button"
                    >
                      {dueDateEnd ? format(dueDateEnd, "MMM d") : "End"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-auto p-0"
                    collisionPadding={16}
                  >
                    <Calendar
                      disabled={
                        dueDateStart ? { before: dueDateStart } : undefined
                      }
                      mode="single"
                      onSelect={(date) => {
                        handleDueDateChange("end", date ?? null);
                        setMobileEndCalOpen(false);
                      }}
                      selected={dueDateEnd ?? undefined}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <Label className="text-xs text-base-content/60 mb-1.5 block">
              Description
            </Label>
            <TaskDescriptionEditor
              key={taskId}
              onChange={setDescDraft}
              onSave={saveDescription}
              spaceId={spaceId}
              taskId={taskId}
              value={descDraft}
              workspaceId={workspaceId}
            />
          </div>

          {/* Checklists */}
          {checklists.length > 0 && (
            <div className="space-y-4">
              {checklists.map((cl) => {
                const clChecked = cl.items.filter((i) => i.isChecked).length;
                const clTotal = cl.items.length;
                return (
                  <div key={cl.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{cl.name}</span>
                      <span className="text-xs text-base-content/60">
                        {clChecked}/{clTotal}
                      </span>
                    </div>
                    {clTotal > 0 && (
                      <Progress
                        className="h-1.5 mb-2"
                        value={clTotal > 0 ? (clChecked / clTotal) * 100 : 0}
                      />
                    )}
                    <div className="space-y-1">
                      {cl.items.map((item) => (
                        <div
                          className="flex items-center gap-2 group"
                          key={item.id}
                        >
                          <Checkbox
                            checked={item.isChecked}
                            className="shrink-0"
                            onCheckedChange={() => handleToggleItem(item.id)}
                          />
                          <span
                            className={cn(
                              "flex-1 text-sm",
                              item.isChecked &&
                                "line-through text-base-content/60"
                            )}
                          >
                            {item.title}
                          </span>
                          <button
                            className="opacity-0 group-hover:opacity-100 flex size-5 items-center justify-center rounded hover:bg-error/10 text-error transition-opacity"
                            onClick={() =>
                              deleteChecklistItem(
                                workspaceId,
                                spaceId,
                                listId,
                                item.id
                              ).then(load)
                            }
                            type="button"
                          >
                            <XIcon className="size-3" />
                          </button>
                        </div>
                      ))}
                      {/* Add item row */}
                      <div className="flex gap-1 mt-1">
                        <Input
                          className="h-7 text-xs"
                          onChange={(e) =>
                            setNewItemTexts((prev) => ({
                              ...prev,
                              [cl.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddItem(cl.id);
                            }
                          }}
                          placeholder="Add item…"
                          value={newItemTexts[cl.id] ?? ""}
                        />
                        <Button
                          className="h-7 px-2"
                          onClick={() => handleAddItem(cl.id)}
                          size="sm"
                        >
                          <PlusIcon className="size-3.5" />
                        </Button>
                        <button
                          className="flex size-7 items-center justify-center rounded hover:bg-error/10 text-error"
                          onClick={() =>
                            deleteChecklist(
                              workspaceId,
                              spaceId,
                              listId,
                              cl.id
                            ).then(load)
                          }
                          title="Delete checklist"
                          type="button"
                        >
                          <TrashIcon className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add checklist */}
          {addingChecklist ? (
            <div className="flex gap-2" ref={checklistFormRef}>
              <Input
                autoFocus
                className="h-8 text-sm"
                onChange={(e) => setNewChecklistName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddChecklist();
                  }
                  if (e.key === "Escape") {
                    closeChecklistForm();
                  }
                }}
                placeholder="Checklist name…"
                value={newChecklistName}
              />
              <Button
                disabled={!newChecklistName.trim()}
                onClick={handleAddChecklist}
                size="sm"
              >
                Add
              </Button>
              <Button onClick={closeChecklistForm} size="sm" variant="ghost">
                Cancel
              </Button>
            </div>
          ) : (
            <button
              className="flex items-center gap-1.5 text-xs text-base-content/60 hover:text-base-content transition-colors"
              onClick={() => setAddingChecklist(true)}
              ref={addChecklistTriggerRef}
              type="button"
            >
              <PlusIcon className="size-3.5" />
              Add checklist
            </button>
          )}

          {/* Time Tracking */}
          <TaskTimeTracking
            canEdit={canEdit}
            currentUserId={currentUserId}
            entries={timeEntries}
            listId={listId}
            onChanged={load}
            spaceId={spaceId}
            taskId={taskId}
            workspaceId={workspaceId}
          />

          {/* Dependencies */}
          <TaskDependencies
            blockedBy={blockedBy}
            blocks={blocks}
            canEdit={canEdit}
            listId={listId}
            onChanged={load}
            spaceId={spaceId}
            taskId={taskId}
            workspaceId={workspaceId}
          />

          {/* Comments + Activity feed */}
          <TaskActivityFeed
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            listId={listId}
            ref={feedRef}
            spaceId={spaceId}
            taskId={taskId}
            workspaceId={workspaceId}
          />
        </div>

        {/* Sidebar column */}
        <div className="w-full border-t px-4 py-4 space-y-5 sm:w-56 sm:shrink-0 sm:overflow-y-auto sm:border-t-0 sm:border-l">
          {/* Assignees + Due date — hidden below `sm` (a compact version
            already sits near the top of the main column on mobile; see
            above). Unchanged at `sm`+. */}
          <div className="hidden sm:block space-y-5">
            {/* Assignees */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-base-content/60">
                  Assignees
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="size-5 flex items-center justify-center rounded hover:bg-base-200"
                      type="button"
                    >
                      <PlusIcon className="size-3.5 text-base-content/60" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 p-2">
                    <AssigneeMemberPicker
                      assignees={assignees}
                      members={members}
                      onInvite={() => setInviteOpen(true)}
                      onToggle={handleToggleAssignee}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              {assignees.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {assignees.map((a) => (
                    <div
                      className="flex items-center gap-1 rounded-full bg-base-200 px-2 py-0.5"
                      key={a.userId}
                    >
                      <Avatar className="size-4">
                        <AvatarFallback className="text-[8px]">
                          {userInitials(a.name, a.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs max-w-20 truncate">
                        {a.name ?? a.email}
                      </span>
                      <button
                        className="text-base-content/60 hover:text-base-content"
                        onClick={() => handleToggleAssignee(a.userId!)}
                        type="button"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-base-content/60">None</p>
              )}
            </div>

            <Separator />

            {/* Due date */}
            <div>
              <Label className="text-xs font-medium text-base-content/60 block mb-1.5">
                Due date
              </Label>
              <div className="space-y-1">
                <div>
                  <p className="text-2xs text-base-content/60 mb-0.5">Start</p>
                  <Popover onOpenChange={setStartCalOpen} open={startCalOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className="w-full flex items-center rounded-md border bg-base-100 px-2 py-1.5 text-xs hover:bg-base-200 transition-colors text-left"
                        type="button"
                      >
                        {dueDateStart ? (
                          format(dueDateStart, "MMM d, yyyy")
                        ) : (
                          <span className="text-base-content/60">
                            Pick a date
                          </span>
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-auto p-0"
                      collisionPadding={16}
                    >
                      <Calendar
                        mode="single"
                        onSelect={(date) => {
                          handleDueDateChange("start", date ?? null);
                          setStartCalOpen(false);
                        }}
                        selected={dueDateStart ?? undefined}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <p className="text-2xs text-base-content/60 mb-0.5">End</p>
                  <Popover onOpenChange={setEndCalOpen} open={endCalOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className="w-full flex items-center rounded-md border bg-base-100 px-2 py-1.5 text-xs hover:bg-base-200 transition-colors text-left"
                        type="button"
                      >
                        {dueDateEnd ? (
                          format(dueDateEnd, "MMM d, yyyy")
                        ) : (
                          <span className="text-base-content/60">
                            Pick a date
                          </span>
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-auto p-0"
                      collisionPadding={16}
                    >
                      <Calendar
                        disabled={
                          dueDateStart ? { before: dueDateStart } : undefined
                        }
                        mode="single"
                        onSelect={(date) => {
                          handleDueDateChange("end", date ?? null);
                          setEndCalOpen(false);
                        }}
                        selected={dueDateEnd ?? undefined}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-base-content/60">
                Tags
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="size-5 flex items-center justify-center rounded hover:bg-base-200"
                    type="button"
                  >
                    <PlusIcon className="size-3.5 text-base-content/60" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-52 p-2">
                  <TagPicker
                    allTags={allTags}
                    onCreate={handleCreateTag}
                    onDelete={(id, name) => setDeleteTagTarget({ id, name })}
                    onToggle={handleToggleTag}
                    selectedIds={tags.map((t) => t.id)}
                  />
                </PopoverContent>
              </Popover>
            </div>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge
                    className="gap-1 pr-1 text-xs"
                    key={tag.id}
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                    variant="secondary"
                  >
                    {tag.name}
                    <button
                      className="hover:opacity-70"
                      onClick={() => handleToggleTag(tag.id)}
                      type="button"
                    >
                      <XIcon className="size-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-base-content/60">None</p>
            )}
          </div>

          <Separator />

          {/* Watchers */}
          <div>
            <span className="text-xs font-medium text-base-content/60 block mb-1.5">
              Watchers
            </span>
            {watchers.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {watchers.map((w) => (
                  <div key={w.userId} title={w.name ?? w.email ?? ""}>
                    <Avatar className="size-6">
                      <AvatarFallback className="text-[9px]">
                        {userInitials(w.name, w.email)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-base-content/60">None</p>
            )}
          </div>

          <Separator />

          {/* Reporter */}
          <div>
            <span className="text-xs font-medium text-base-content/60 block mb-1">
              Reporter
            </span>
            <div className="flex items-center gap-1.5">
              <UserIcon className="size-3.5 shrink-0 text-base-content/60" />
              <span className="min-w-0 flex-1 truncate text-xs">
                {members.find((m) => m.userId === t.reporterId)?.name ??
                  "Unknown"}
              </span>
            </div>
          </div>

          {/* Custom fields */}
          {customFields.length > 0 && (
            <>
              <Separator />
              {customFields.map((field) => (
                <div key={field.id}>
                  <span className="text-xs font-medium text-base-content/60 block mb-1.5">
                    {field.name}
                  </span>
                  <CustomFieldEditor
                    disabled={!canEdit}
                    field={field}
                    members={members.filter(
                      (m): m is typeof m & { userId: string } =>
                        m.userId !== null
                    )}
                    onChange={(value) =>
                      handleCustomFieldChange(field.id, value)
                    }
                    value={customFieldValues[field.id]}
                  />
                </div>
              ))}
            </>
          )}

          {/* Checklist progress (sidebar summary) */}
          {totalItems > 0 && (
            <>
              <Separator />
              <div>
                <span className="text-xs font-medium text-base-content/60 block mb-1.5">
                  Checklist
                </span>
                <Progress className="h-1.5 mb-1" value={checkProgress} />
                <p className="text-xs text-base-content/60">
                  {totalChecked}/{totalItems} items
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );

  const deleteTaskDialog = (
    <Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
      <DialogContent className="sm:max-w-xs text-center">
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="flex size-12 items-center justify-center rounded-full bg-error/10">
            <TrashIcon className="size-6 text-error" weight="fill" />
          </div>
          <div>
            <DialogTitle className="text-base font-bold">
              Delete Task
            </DialogTitle>
            <p className="text-sm text-base-content/60 mt-1">
              The task moves to Trash. A workspace admin can restore it.
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-2">
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
  );

  const deleteTagDialog = (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          setDeleteTagTarget(null);
        }
      }}
      open={!!deleteTagTarget}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete tag &ldquo;{deleteTagTarget?.name}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the tag and remove it from every task
            in the workspace. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-error text-white hover:bg-error/90"
            onClick={handleDeleteTag}
          >
            Delete tag
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (inline) {
    return (
      <>
        <div className="h-full overflow-y-auto flex flex-col gap-0">
          <AttachmentPreviewProvider>{panelContent}</AttachmentPreviewProvider>
        </div>
        {deleteTagDialog}
        {deleteTaskDialog}
        <InviteMemberModal
          onInvited={load}
          onOpenChange={setInviteOpen}
          open={inviteOpen}
          workspaceId={workspaceId}
        />
      </>
    );
  }

  return (
    <>
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent
          aria-describedby={undefined}
          className="w-full sm:max-w-2xl overflow-y-auto flex flex-col gap-0 p-0"
        >
          <AttachmentPreviewProvider>{panelContent}</AttachmentPreviewProvider>
        </SheetContent>
      </Sheet>
      {deleteTagDialog}
      {deleteTaskDialog}
      <ManageStatusesDialog
        listId={listId}
        onOpenChange={setManageStatusesOpen}
        onSaved={() => load()}
        open={manageStatusesOpen}
        spaceId={spaceId}
        workspaceId={workspaceId}
      />
      <InviteMemberModal
        onInvited={load}
        onOpenChange={setInviteOpen}
        open={inviteOpen}
        workspaceId={workspaceId}
      />
    </>
  );
}

// ─── Tag picker sub-component ─────────────────────────────────────────────────

function TagPicker({
  allTags,
  selectedIds,
  onToggle,
  onCreate,
  onDelete,
}: {
  allTags: { id: string; name: string; color: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [search, setSearch] = React.useState("");

  const filtered = allTags.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );
  const exactMatch = allTags.some(
    (t) => t.name.toLowerCase() === search.toLowerCase()
  );

  return (
    <div>
      <Input
        autoFocus
        className="h-7 text-xs mb-2"
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && search.trim() && !exactMatch) {
            e.preventDefault();
            onCreate(search.trim());
            setSearch("");
          }
        }}
        placeholder="Search or create tag…"
        value={search}
      />
      <div className="space-y-0.5 max-h-40 overflow-y-auto">
        {filtered.map((tag) => (
          <div
            className="group/tag flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-base-200"
            key={tag.id}
          >
            <button
              className="flex flex-1 min-w-0 items-center gap-2"
              onClick={() => onToggle(tag.id)}
              type="button"
            >
              <span
                className="size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              <span className="flex-1 truncate text-left text-xs">
                {tag.name}
              </span>
              {selectedIds.includes(tag.id) && (
                <CheckIcon className="size-3.5 text-primary shrink-0" />
              )}
            </button>
            <button
              className="opacity-0 group-hover/tag:opacity-100 flex size-5 items-center justify-center rounded hover:bg-error/10 hover:text-error transition-opacity shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(tag.id, tag.name);
              }}
              type="button"
            >
              <TrashIcon className="size-3" />
            </button>
          </div>
        ))}
        {search && !exactMatch && (
          <button
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-primary hover:bg-base-200"
            onClick={() => {
              onCreate(search.trim());
              setSearch("");
            }}
            type="button"
          >
            <PlusIcon className="size-3.5" />
            Create &ldquo;{search}&rdquo;
          </button>
        )}
      </div>
    </div>
  );
}
