"use client";

import {
  ArchiveIcon,
  ArrowLeftIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  CheckIcon,
  ClipboardTextIcon,
  CopyIcon,
  DotsThreeIcon,
  EyeIcon,
  EyeSlashIcon,
  FileIcon,
  FilePdfIcon,
  FlagIcon,
  GearIcon,
  GitBranchIcon,
  type Icon,
  LinkIcon,
  ListChecksIcon,
  PaperclipIcon,
  PlusIcon,
  PushPinIcon,
  TagIcon,
  TimerIcon,
  TrashIcon,
  TreeStructureIcon,
  UserIcon,
  UserPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import {
  type CustomFieldRow,
  deleteCustomFieldValue,
  getCustomFieldsForTasks,
  setCustomFieldValue,
} from "@/app/actions/custom-field";
import {
  archiveTask,
  createSubtask,
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
import { useRealtimeRefetch } from "@/components/realtime/realtime-provider";
import {
  AttachmentPreviewProvider,
  useAttachmentPreview,
} from "@/components/task/attachment-preview-modal";
import { CustomFieldEditor } from "@/components/task/custom-field-editors";
import { MemberSearchInput } from "@/components/task/member-search-input";
import { SubtaskRow } from "@/components/task/subtask-row";
import {
  TaskActivityFeed,
  type TaskActivityFeedHandle,
} from "@/components/task/task-activity-feed";
import { TaskDependencies } from "@/components/task/task-dependencies";
import { TaskDescriptionEditor } from "@/components/task/task-description-editor";
import { TaskTimeTracking } from "@/components/task/task-time-tracking";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { isWithinAnyOpenLayer } from "@/components/ui/overlay-stack";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InviteMemberModal } from "@/components/workspace/invite-member-modal";
import { useTaskNavShortcut } from "@/hooks/use-task-nav-shortcut";
import { useTaskNavigation } from "@/hooks/use-task-navigation";
import { flashDuplicatedTask } from "@/lib/duplicate-highlight";
import { filterMembersByQuery } from "@/lib/member-search";
import { useSetTopbar } from "@/lib/topbar-context";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";
import { TaskDetailSkeleton } from "./task-detail-skeleton";

type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

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

function avatarSrc(key: string | null | undefined): string | undefined {
  return key ? `/api/files/${key}` : undefined;
}

// ─── Field row (label + value in grid) ───────────────────────────────────────

function FieldRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-2 border-b border-base-300/40 last:border-0 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex items-center gap-2 text-sm text-base-content/60 sm:w-36 sm:shrink-0 sm:pt-0.5">
        <span className="shrink-0">{icon}</span>
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ─── Collapsible content-section header (Subtasks / Dependencies / Checklist) ──

function SectionHeader({
  icon: Icon,
  title,
  description,
  count,
}: {
  icon: Icon;
  title: string;
  description: string;
  count: number;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      {/* Icon + title sit together at the left edge. */}
      <span className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-base-content/60" />
        <span className="text-sm font-semibold">{title}</span>
        {count > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-base-200 px-1.5 text-2xs font-medium text-base-content/60 tabular-nums">
            {count}
          </span>
        )}
      </span>
      {/* Description is indented (pl-6 = icon width + gap) so it aligns under
          the title text, not the icon. Reads as a subtitle when collapsed. */}
      <span className="pl-6 text-xs font-normal text-base-content/60 group-aria-expanded/accordion-trigger:hidden">
        {description}
      </span>
    </span>
  );
}

// ─── Picker popover bodies (shared between the desktop field grid and the
// mobile compact Properties rows — one implementation, two trigger styles) ────

function StatusPickerContent({
  statuses,
  currentStatusId,
  canManage,
  onSelect,
  onManageStatuses,
}: {
  statuses: { id: string; name: string; color: string; type: string }[];
  currentStatusId: string | null;
  canManage: boolean;
  onSelect: (statusId: string) => void;
  onManageStatuses: () => void;
}) {
  return (
    <div
      className="max-h-60 overflow-y-auto p-1"
      onWheel={(e) => e.stopPropagation()}
    >
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
          <div key={type}>
            <div className="flex items-center px-2 pt-2 pb-0.5">
              <span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-base-content/60">
                {label}
              </span>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex size-4 items-center justify-center rounded text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors"
                      onClick={(e) => e.stopPropagation()}
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
                    <DropdownMenuItem onClick={onManageStatuses}>
                      <GearIcon className="size-3.5" />
                      Edit statuses
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {group.map((s) => (
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                key={s.id}
                onClick={() => onSelect(s.id)}
                type="button"
              >
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="flex-1 text-left">{s.name}</span>
                {s.id === currentStatusId && (
                  <CheckIcon className="size-3.5 text-primary" />
                )}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function PriorityPickerContent({
  currentPriority,
  onSelect,
}: {
  currentPriority: Priority;
  onSelect: (p: Priority) => void;
}) {
  return (
    <>
      {(
        Object.entries(PRIORITY_CONFIG) as [
          Priority,
          (typeof PRIORITY_CONFIG)[Priority],
        ][]
      ).map(([key, cfg]) => (
        <button
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200",
            cfg.color
          )}
          key={key}
          onClick={() => onSelect(key)}
          type="button"
        >
          <span>{cfg.icon}</span>
          <span className="flex-1 text-left">{cfg.label}</span>
          {key === currentPriority && (
            <CheckIcon className="size-3.5 shrink-0" />
          )}
        </button>
      ))}
    </>
  );
}

function AssigneePickerContent({
  members,
  assignedUserIds,
  onToggle,
  onInvite,
}: {
  members: {
    userId: string;
    name: string;
    email: string;
    image: string | null;
  }[];
  assignedUserIds: string[];
  onToggle: (userId: string) => void;
  onInvite: () => void;
}) {
  const [search, setSearch] = React.useState("");
  const filtered = filterMembersByQuery(members, search);
  return (
    <>
      <p className="text-xs text-base-content/60 px-1 mb-1.5">Select members</p>
      <MemberSearchInput onChange={setSearch} value={search} />
      <div className="space-y-0.5 max-h-48 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-base-content/60">
            No members found
          </p>
        )}
        {filtered.map((m) => {
          const selected = assignedUserIds.includes(m.userId);
          return (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
              key={m.userId}
              onClick={() => onToggle(m.userId)}
              type="button"
            >
              <Avatar className="size-6 shrink-0">
                {m.image && <AvatarImage src={avatarSrc(m.image)} />}
                <AvatarFallback className="text-2xs">
                  {userInitials(m.name, m.email)}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-left">{m.name}</span>
              {selected && (
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

function TagPickerContent({
  search,
  onSearchChange,
  filteredTags,
  selectedTagIds,
  exactMatch,
  onToggle,
  onCreate,
  onDeleteRequest,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  filteredTags: { id: string; name: string; color: string }[];
  selectedTagIds: string[];
  exactMatch: boolean;
  onToggle: (tagId: string) => void;
  onCreate: (name: string) => void;
  onDeleteRequest: (tag: { id: string; name: string }) => void;
}) {
  return (
    <>
      <Input
        autoFocus
        className="h-7 text-xs mb-2"
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && search.trim() && !exactMatch) {
            e.preventDefault();
            onCreate(search.trim());
          }
        }}
        placeholder="Search or create…"
        value={search}
      />
      <div className="space-y-0.5 max-h-40 overflow-y-auto">
        {filteredTags.map((tag) => {
          const selected = selectedTagIds.includes(tag.id);
          return (
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
                {selected && (
                  <CheckIcon className="size-3.5 text-primary shrink-0" />
                )}
              </button>
              <button
                className="opacity-0 group-hover/tag:opacity-100 flex size-5 items-center justify-center rounded hover:bg-error/10 hover:text-error transition-opacity shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteRequest({ id: tag.id, name: tag.name });
                }}
                type="button"
              >
                <TrashIcon className="size-3" />
              </button>
            </div>
          );
        })}
        {search && !exactMatch && (
          <button
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-primary hover:bg-base-200"
            onClick={() => onCreate(search.trim())}
            type="button"
          >
            <PlusIcon className="size-3.5" /> Create &ldquo;{search}&rdquo;
          </button>
        )}
      </div>
    </>
  );
}

// ─── Overflow menu items shared by the desktop "⋮" and the mobile header's
// overflow menu (mobile additionally prepends Pin/Copy link/Watch). ──────────

function TaskOverflowMenuItems({
  saving,
  onDuplicate,
  isArchived,
  onArchiveToggle,
  canPinToList,
  isPinnedToList,
  onPinToListToggle,
  onDelete,
}: {
  saving: boolean;
  onDuplicate: () => void;
  isArchived: boolean;
  onArchiveToggle: () => void;
  canPinToList: boolean;
  isPinnedToList: boolean;
  onPinToListToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <button
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
        disabled={saving}
        onClick={onDuplicate}
        type="button"
      >
        <CopyIcon className="size-3.5 text-base-content/60" /> Duplicate
      </button>
      <button
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
        onClick={onArchiveToggle}
        type="button"
      >
        <ArchiveIcon className="size-3.5 text-base-content/60" />{" "}
        {isArchived ? "Unarchive" : "Archive"}
      </button>
      {canPinToList && (
        <>
          <Separator className="my-1" />
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
            onClick={onPinToListToggle}
            type="button"
          >
            <PushPinIcon
              className={cn(
                "size-3.5",
                isPinnedToList ? "text-primary" : "text-base-content/60"
              )}
              weight={isPinnedToList ? "fill" : "regular"}
            />
            {isPinnedToList ? "Unpin from list" : "Pin to list top"}
          </button>
        </>
      )}
      <Separator className="my-1" />
      <button
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-error hover:bg-error/10"
        onClick={onDelete}
        type="button"
      >
        <TrashIcon className="size-3.5" /> Delete
      </button>
    </>
  );
}

// Decides where the single TaskActivityFeed instance mounts (left column vs
// desktop right column) — mounting it twice would double its data fetch and
// give it two comment composers, so this needs a real breakpoint check
// rather than hidden/md:hidden. Defaults to desktop; safe since this page
// only renders real content after the client-side fetch resolves.
function useIsBelowMd() {
  const [isBelow, setIsBelow] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    setIsBelow(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsBelow(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return isBelow;
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface TaskDetailPageProps {
  canPinToList?: boolean;
  listId: string;
  listName: string;
  spaceId: string;
  taskId: string;
  workspaceId: string;
  workspaceName: string;
}

export function TaskDetailPage({
  workspaceId,
  spaceId,
  listId,
  taskId,
  listName,
  workspaceName,
  canPinToList,
}: TaskDetailPageProps) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const searchParams = useSearchParams();
  const fromView = searchParams.get("from");
  const fromSprintId = searchParams.get("sid");

  // Previous/Next Task: walks the ordered task-id list the originating view
  // (List/Board/Calendar/My Tasks/Search) stashed right before opening this
  // task — see lib/task-nav-context.ts. No DB query, no extra fetch.
  const taskNav = useTaskNavigation(taskId);
  const buildTaskNavUrl = React.useCallback(
    (id: string) => {
      const targetWorkspaceId = taskNav.workspaceIdFor(id) ?? workspaceId;
      const query = fromView
        ? `?from=${fromView}${fromSprintId ? `&sid=${fromSprintId}` : ""}`
        : "";
      return `/${targetWorkspaceId}/task/${id}${query}`;
    },
    [taskNav, workspaceId, fromView, fromSprintId]
  );
  const goPrevTask = React.useCallback(() => {
    if (taskNav.prevId) {
      router.push(buildTaskNavUrl(taskNav.prevId));
    }
  }, [taskNav.prevId, buildTaskNavUrl, router]);
  const goNextTask = React.useCallback(() => {
    if (taskNav.nextId) {
      router.push(buildTaskNavUrl(taskNav.nextId));
    }
  }, [taskNav.nextId, buildTaskNavUrl, router]);
  useTaskNavShortcut(goPrevTask, goNextTask);

  const contextLabel = fromView === "sprint" ? "Sprint" : listName || "List";
  useSetTopbar({
    breadcrumbs: [{ label: workspaceName, href: `/${workspaceId}` }],
    title: contextLabel,
  });
  const [data, setData] = React.useState<Awaited<
    ReturnType<typeof getTaskDetail>
  > | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [titleEditing, setTitleEditing] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState("");
  const [descDraft, setDescDraft] = React.useState("");
  const [members, setMembers] = React.useState<
    { userId: string; name: string; email: string; image: string | null }[]
  >([]);
  const [allTags, setAllTags] = React.useState<
    { id: string; name: string; color: string }[]
  >([]);
  const [customFields, setCustomFields] = React.useState<CustomFieldRow[]>([]);
  const [customFieldValues, setCustomFieldValues] = React.useState<
    Record<string, unknown>
  >({});
  const [tagSearch, setTagSearch] = React.useState("");
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
  const [saving, setSaving] = React.useState(false);
  const [subtaskInput, setSubtaskInput] = React.useState("");
  // The subtask input only appears after clicking "+ Add subtask".
  const [addingSubtask, setAddingSubtask] = React.useState(false);
  // Completed subtasks are hidden behind a "Completed (N)" row by default.
  const [completedOpen, setCompletedOpen] = React.useState(false);
  const subtaskInputRef = React.useRef<HTMLInputElement>(null);
  // Subtask queued for deletion (confirmation dialog target) — a quick
  // hover-delete so removing one doesn't require opening it first.
  const [deletingSubtask, setDeletingSubtask] = React.useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deletingSubtaskBusy, setDeletingSubtaskBusy] = React.useState(false);
  // Which content sections (subtasks / dependencies / checklist) are expanded.
  // Multiple can be open at once: sections that already have data auto-open so
  // they show together, while empty ones start collapsed and auto-collapse on
  // an outside click.
  const [openSections, setOpenSections] = React.useState<string[]>([]);
  const sectionsRef = React.useRef<HTMLDivElement>(null);
  // The task we've already applied the "open sections with data" default to, so
  // a section the user later collapses is not re-opened on the next refetch.
  const initedSectionsTaskRef = React.useRef<string | null>(null);
  const [attachments, setAttachments] = React.useState<
    {
      id: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      url: string;
      commentId: string | null;
      isInline?: boolean;
      uploadedBy: string;
      createdAt: Date;
    }[]
  >([]);
  const [uploadingFile, setUploadingFile] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // Attachment drop-zone drag state. `dragDepth` counts enter/leave across child
  // elements so the overlay doesn't flicker when moving over children.
  const [attachmentDragOver, setAttachmentDragOver] = React.useState(false);
  const attachmentDragDepth = React.useRef(0);
  const [creatingSubtask, setCreatingSubtask] = React.useState(false);
  // Reset add-forms, completed-toggle and section state on task switch.
  React.useEffect(() => {
    setAddingSubtask(false);
    setCompletedOpen(false);
    setOpenSections([]);
    initedSectionsTaskRef.current = null;
    setMobilePropertiesOpen(true);
    setMobileStatusPopoverOpen(false);
    setMobilePriorityPopoverOpen(false);
    setMobileAssigneePopoverOpen(false);
    setMobileTagPopoverOpen(false);
    setMobileStartCalOpen(false);
    setMobileEndCalOpen(false);
  }, []);
  // Auto-open every section that already has data, once per task, so a task's
  // subtasks / dependencies / checklist are shown together on open. Guarded to
  // the current task's data and to run only once, so sections the user later
  // collapses stay collapsed across refetches.
  React.useEffect(() => {
    if (!data || "error" in data) {
      return;
    }
    if (data.task.id !== taskId) {
      return;
    }
    if (initedSectionsTaskRef.current === taskId) {
      return;
    }
    initedSectionsTaskRef.current = taskId;
    const open: string[] = [];
    if (!data.task.parentTaskId && (data.subtasks?.length ?? 0) > 0) {
      open.push("subtasks");
    }
    if (data.blockedBy.length + data.blocks.length > 0) {
      open.push("dependencies");
    }
    if (data.checklists.length > 0) {
      open.push("checklist");
    }
    if (data.timeEntries.length > 0) {
      open.push("timeTracking");
    }
    setOpenSections(open);
  }, [data, taskId]);
  // Clicking outside the sections collapses any *empty* open section (tidies up
  // add-forms opened but not used). Sections that have data stay open — the user
  // closes those with an explicit click on the header. Clicks inside portaled
  // overlays (the "Add dependency" dialog / popovers / menus) are ignored.
  React.useEffect(() => {
    if (openSections.length === 0) {
      return;
    }
    const hasData = (section: string): boolean => {
      if (!data || "error" in data) {
        return false;
      }
      if (section === "subtasks") {
        return (data.subtasks?.length ?? 0) > 0;
      }
      if (section === "dependencies") {
        return data.blockedBy.length + data.blocks.length > 0;
      }
      if (section === "checklist") {
        return data.checklists.length > 0;
      }
      if (section === "timeTracking") {
        return data.timeEntries.length > 0;
      }
      return false;
    };
    // No empty sections open → nothing an outside click would collapse.
    if (openSections.every(hasData)) {
      return;
    }
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (sectionsRef.current?.contains(target)) {
        return;
      }
      if (isWithinAnyOpenLayer(target)) {
        return;
      }
      setOpenSections((prev) => prev.filter(hasData));
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openSections, data]);
  const [isPinned, setIsPinned] = React.useState(false);
  const [statusPopoverOpen, setStatusPopoverOpen] = React.useState(false);
  const [manageStatusesOpen, setManageStatusesOpen] = React.useState(false);
  const [priorityPopoverOpen, setPriorityPopoverOpen] = React.useState(false);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = React.useState(false);
  const [startCalOpen, setStartCalOpen] = React.useState(false);
  const [endCalOpen, setEndCalOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [unarchiving, setUnarchiving] = React.useState(false);
  // Mobile-only compact Properties section (see the `md:hidden` block below):
  // its own popover-open state, separate from the desktop ones above, so the
  // desktop and mobile triggers (both always mounted, only one ever visible
  // via CSS) never end up both "open" and racing over the same boolean.
  const isMobile = useIsBelowMd();
  const [mobilePropertiesOpen, setMobilePropertiesOpen] = React.useState(true);
  const [mobileStatusPopoverOpen, setMobileStatusPopoverOpen] =
    React.useState(false);
  const [mobilePriorityPopoverOpen, setMobilePriorityPopoverOpen] =
    React.useState(false);
  const [mobileAssigneePopoverOpen, setMobileAssigneePopoverOpen] =
    React.useState(false);
  const [mobileTagPopoverOpen, setMobileTagPopoverOpen] = React.useState(false);
  const [mobileStartCalOpen, setMobileStartCalOpen] = React.useState(false);
  const [mobileEndCalOpen, setMobileEndCalOpen] = React.useState(false);

  const fetchAll = React.useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) {
        setLoading(true);
      }
      const [detail, mem, tags, attRes, pinRes, customFieldsRes] =
        await Promise.all([
          getTaskDetail(workspaceId, spaceId, taskId),
          getWorkspaceMembers(workspaceId),
          getWorkspaceTags(workspaceId),
          fetch(`/api/tasks/${taskId}/attachments`)
            .then((r) => r.json())
            .catch(() => ({ attachments: [] })),
          fetch(`/api/tasks/${taskId}/pin`, { method: "GET" })
            .then((r) => (r.ok ? r.json() : { pinned: false }))
            .catch(() => ({ pinned: false })),
          getCustomFieldsForTasks(workspaceId, spaceId, listId, [taskId]),
        ]);
      setData(detail && !("error" in detail) ? detail : null);
      if (mem && !("error" in mem)) {
        setMembers(
          mem.members
            .filter(
              (m): m is typeof m & { userId: string } => m.userId !== null
            )
            .map((m) => ({
              userId: m.userId!,
              name: m.name,
              email: m.email,
              image: m.image,
            }))
        );
      }
      if (tags && !("error" in tags)) {
        setAllTags(tags.tags);
      }
      if (attRes?.attachments) {
        setAttachments(attRes.attachments);
      }
      setIsPinned(!!pinRes?.pinned);
      if (customFieldsRes && !("error" in customFieldsRes)) {
        setCustomFields(customFieldsRes.fields);
        setCustomFieldValues(customFieldsRes.valuesByTask[taskId] ?? {});
      }
      if (showSpinner) {
        setLoading(false);
      }
    },
    [workspaceId, spaceId, listId, taskId]
  );

  async function handleTogglePin() {
    const next = !isPinned;
    setIsPinned(next);
    const res = await fetch(`/api/tasks/${taskId}/pin`, {
      method: next ? "POST" : "DELETE",
    });
    if (res.ok) {
      // The topbar's pinned-tasks strip is an SWR resource, not a server-
      // rendered path — revalidate its key so it updates now instead of on its
      // 60s poll. This is what the list row already does; without it, pinning
      // from here looked like it did nothing. Same event the topbar fires on
      // unpin, so any mounted list row drops its pin marker too.
      void mutate(`/api/workspaces/${workspaceId}/pinned-tasks`);
      if (!next) {
        window.dispatchEvent(
          new CustomEvent("task-personal-unpin", { detail: { taskId } })
        );
      }
      return;
    }
    setIsPinned(!next);
    const err = await res.json().catch(() => ({}));
    toast.error(err.error ?? "Failed to update pin");
  }

  // Initial load shows spinner; subsequent refreshes are silent
  const load = () => fetchAll(false);

  React.useEffect(() => {
    fetchAll(true);
  }, [fetchAll]);

  // Live updates: when another user changes THIS task, refetch just this task.
  // Events carrying a different taskId are ignored; events without one (list /
  // space / workspace changes) refetch, which is the safe default. The provider
  // already debounces and defers while typing / an overlay is open / tab hidden.
  useRealtimeRefetch((meta) => {
    if (meta?.taskId && meta.taskId !== taskId) {
      return;
    }
    void load();
  });

  // Last values the server gave us, so we can tell "no local edit" (draft still
  // equals the server value) from "unsaved local edit" (draft diverged).
  const serverTitleRef = React.useRef("");
  const serverDescRef = React.useRef("");

  React.useEffect(() => {
    if (!data || "error" in data) {
      return;
    }
    const nextTitle = data.task.title;
    const nextDesc =
      typeof data.task.description === "string"
        ? data.task.description
        : data.task.description
          ? JSON.stringify(data.task.description)
          : "";

    // Capture the PREVIOUS server values before overwriting the refs — the
    // functional updaters below run after this effect body, so they must close
    // over the old values, not the new ones.
    const prevServerTitle = serverTitleRef.current;
    const prevServerDesc = serverDescRef.current;

    // Adopt the incoming server value ONLY when the field has no unsaved local
    // change. Leaving `descDraft` untouched also means TaskDescriptionEditor's
    // setContent sync never runs → no cursor reset while someone is typing.
    setTitleDraft((cur) =>
      !titleEditing && cur === prevServerTitle ? nextTitle : cur
    );
    setDescDraft((cur) => (cur === prevServerDesc ? nextDesc : cur));

    // Self-heals: after a save the draft equals the new server value again, so
    // later remote updates are adopted normally.
    serverTitleRef.current = nextTitle;
    serverDescRef.current = nextDesc;
  }, [data, titleEditing]);

  const listBackUrl =
    fromView === "sprint" && fromSprintId
      ? `/${workspaceId}/${spaceId}/sprint/${fromSprintId}`
      : listId
        ? `/${workspaceId}/${spaceId}/list/${listId}${fromView && fromView !== "sprint" ? `?view=${fromView}` : ""}`
        : `/${workspaceId}`;

  if (loading) {
    return <TaskDetailSkeleton />;
  }

  if (!data || "error" in data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-base-content/60">Task not found.</p>
        <Button onClick={() => router.push(listBackUrl)} variant="ghost">
          <ArrowLeftIcon className="size-4 mr-2" /> Back to list
        </Button>
      </div>
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
    subtasks,
    parentTask,
    currentUserId,
  } = data;
  const backUrl = t.parentTaskId
    ? `/${workspaceId}/task/${t.parentTaskId}`
    : listBackUrl;
  // An archived task stays open on its own page behind a banner rather than
  // bouncing back to the list. It's lightly locked while archived: every
  // section that takes a `canEdit` flag is switched off and the title stops
  // being click-to-edit, so the banner's Unarchive is the one thing to do.
  const isArchived = t.isArchived;
  const canEditNow = canEdit && !isArchived;
  const isWatching = watchers.some((w) => w.userId === currentUserId);
  const currentStatus = statuses.find((s) => s.id === t.statusId);
  const priority =
    PRIORITY_CONFIG[t.priority as Priority] ?? PRIORITY_CONFIG.NONE;
  const totalChecked = checklists
    .flatMap((c) => c.items)
    .filter((i) => i.isChecked).length;
  const totalItems = checklists.flatMap((c) => c.items).length;
  const checkProgress =
    totalItems > 0 ? Math.round((totalChecked / totalItems) * 100) : 0;
  const filteredTags = allTags.filter((t) =>
    t.name.toLowerCase().includes(tagSearch.toLowerCase())
  );
  const exactTagMatch = allTags.some(
    (t) => t.name.toLowerCase() === tagSearch.toLowerCase()
  );

  const dueDateStart = t.dueDateStart ? new Date(t.dueDateStart) : null;
  const dueDateEnd = t.dueDateEnd ? new Date(t.dueDateEnd) : null;

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
    // Blur fires this even when nothing was edited. Skip the write (and its
    // "updated the description" activity entry) when the draft still matches the
    // server value. Reliable because loading the value uses setContent with
    // emitUpdate:false, so it never mutates descDraft on its own.
    if (descDraft === serverDescRef.current) {
      return;
    }
    await updateTask(workspaceId, spaceId, listId, taskId, {
      description: descDraft,
    });
    load();
  }

  // Popover closing is the caller's job (desktop and mobile each close their
  // own popover-open state) — these just do the write.
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
  // custom field value change doesn't invalidate anything else fetchAll()
  // loads, so there's nothing to gain from re-fetching the whole task.
  // `value === null` means "clear" — routed to deleteCustomFieldValue (revert
  // to the field's default) rather than persisting an explicit null.
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

  async function handleClearAllTags() {
    await Promise.all(
      tags.map((tag) =>
        removeTaskTag(workspaceId, spaceId, listId, taskId, tag.id)
      )
    );
    load();
  }

  async function handleCreateTag(name: string) {
    const res = await createTag(workspaceId, name);
    if ("tag" in res) {
      await addTaskTag(workspaceId, spaceId, listId, taskId, res.tag.id);
      setTagSearch("");
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
    if ("error" in res) {
      // Stay on the task so the error (e.g. workspace task limit) is seen.
      toast.error(res.error);
      return;
    }
    flashDuplicatedTask(res.taskId);
    router.push(backUrl);
  }

  // Archiving keeps the user here — the page re-renders behind the archived
  // banner instead of navigating away, so the state change is visible and
  // reversible without hunting for the task in the list's Archived section.
  async function handleArchive() {
    await archiveTask(workspaceId, spaceId, listId, taskId);
    await load();
    toastWithUndo("Task archived", async () => {
      await unarchiveTask(workspaceId, spaceId, listId, taskId);
      await load();
    });
  }

  async function handleUnarchive() {
    setUnarchiving(true);
    const res = await unarchiveTask(workspaceId, spaceId, listId, taskId);
    setUnarchiving(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    await load();
    toastWithUndo("Task unarchived", async () => {
      await archiveTask(workspaceId, spaceId, listId, taskId);
      await load();
    });
  }

  function handleDelete() {
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    setDeleting(true);
    await deleteTask(workspaceId, spaceId, listId, taskId);
    setDeleting(false);
    router.push(backUrl);
  }

  async function confirmDeleteSubtask() {
    if (!deletingSubtask) {
      return;
    }
    setDeletingSubtaskBusy(true);
    await deleteTask(workspaceId, spaceId, listId, deletingSubtask.id);
    setDeletingSubtaskBusy(false);
    setDeletingSubtask(null);
    load();
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

  // Shared by the desktop and mobile overflow menus (TaskOverflowMenuItems).
  async function handlePinToListToggle() {
    const isPinnedToList = !!(
      data &&
      !("error" in data) &&
      data.task.isPinnedToList
    );
    const res = await fetch(`/api/tasks/${taskId}/pin-to-list`, {
      method: isPinnedToList ? "DELETE" : "POST",
    });
    if (res.ok) {
      load();
    } else if (!isPinnedToList) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Failed to pin");
    }
  }

  async function handleFileUpload(file: File) {
    setUploadingFile(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/tasks/${taskId}/attachments`, {
      method: "POST",
      body: fd,
    });
    setUploadingFile(false);
    if (res.ok) {
      const { attachment } = await res.json();
      setAttachments((prev) => [...prev, attachment]);
    }
  }

  // Upload several files by reusing the single-file flow above (same API,
  // validation, permissions, activity log and notifications).
  async function handleFilesUpload(files: FileList | File[] | null) {
    if (!files) {
      return;
    }
    for (const file of Array.from(files)) {
      await handleFileUpload(file);
    }
  }

  // Only react to real file drags — never to the app's dnd-kit card dragging
  // (which uses pointer events and carries no `Files` dataTransfer type).
  function isFileDrag(e: React.DragEvent) {
    return Array.from(e.dataTransfer?.types ?? []).includes("Files");
  }

  function handleAttachmentDragEnter(e: React.DragEvent) {
    if (!isFileDrag(e)) {
      return;
    }
    e.preventDefault();
    attachmentDragDepth.current += 1;
    setAttachmentDragOver(true);
  }

  function handleAttachmentDragOver(e: React.DragEvent) {
    if (!isFileDrag(e)) {
      return;
    }
    e.preventDefault(); // required to allow the drop
  }

  function handleAttachmentDragLeave(e: React.DragEvent) {
    if (!isFileDrag(e)) {
      return;
    }
    attachmentDragDepth.current = Math.max(0, attachmentDragDepth.current - 1);
    if (attachmentDragDepth.current === 0) {
      setAttachmentDragOver(false);
    }
  }

  function handleAttachmentDrop(e: React.DragEvent) {
    if (!isFileDrag(e)) {
      return;
    }
    e.preventDefault();
    attachmentDragDepth.current = 0;
    setAttachmentDragOver(false);
    void handleFilesUpload(e.dataTransfer.files);
  }

  async function handleDeleteAttachment(attachmentId: string) {
    await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }

  // Task-level file attachments (excludes comment attachments and inline images).
  const visibleAttachments = attachments.filter(
    (a) => !a.commentId && !a.isInline
  );

  return (
    <AttachmentPreviewProvider>
      <div className="flex h-full flex-col overflow-hidden bg-base-100">
        {/* Top bar — desktop/tablet (`md:`+), unchanged from before. */}
        <div className="hidden md:flex flex-wrap items-center gap-2 border-b px-3 py-3 shrink-0 sm:gap-3 sm:px-5">
          <button
            className="flex items-center gap-1.5 text-sm text-base-content/60 hover:text-base-content transition-colors"
            onClick={() => router.push(backUrl)}
            type="button"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-base-content/60">
            <ClipboardTextIcon className="size-4 shrink-0" />
            <button
              className="hover:text-base-content transition-colors shrink-0"
              onClick={() => router.push(listBackUrl)}
              type="button"
            >
              {contextLabel}
            </button>
            {parentTask && (
              <>
                <CaretRightIcon className="size-3.5 shrink-0" />
                <button
                  className="hover:text-base-content transition-colors truncate max-w-32 sm:max-w-xs"
                  onClick={() =>
                    router.push(`/${workspaceId}/task/${parentTask.id}`)
                  }
                  type="button"
                >
                  {parentTask.title}
                </button>
              </>
            )}
            <CaretRightIcon className="size-3.5 shrink-0" />
            <span className="text-base-content font-medium truncate max-w-32 sm:max-w-xs">
              {t.title}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {taskNav.available && (
              <TooltipProvider>
                <div className="flex items-center gap-0.5 mr-1 pr-1 border-r">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        aria-label="Previous task"
                        className="flex size-7 items-center justify-center rounded-md text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={!taskNav.prevId}
                        onClick={goPrevTask}
                        type="button"
                      >
                        <CaretLeftIcon className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Previous Task</TooltipContent>
                  </Tooltip>
                  <span className="px-0.5 text-xs tabular-nums text-base-content/60 select-none">
                    {taskNav.position} / {taskNav.total}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        aria-label="Next task"
                        className="flex size-7 items-center justify-center rounded-md text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={!taskNav.nextId}
                        onClick={goNextTask}
                        type="button"
                      >
                        <CaretRightIcon className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Next Task</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            )}
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                isPinned
                  ? "bg-primary/10 text-primary"
                  : "text-base-content/60 hover:bg-base-200 hover:text-base-content"
              )}
              onClick={handleTogglePin}
              title={isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
              type="button"
            >
              <PushPinIcon
                className="size-3.5"
                weight={isPinned ? "fill" : "regular"}
              />
              <span className="hidden sm:inline">
                {isPinned ? "Pinned" : "Pin"}
              </span>
            </button>
            <button
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors"
              onClick={() => void copyLink()}
              title="Copy link"
              type="button"
            >
              <LinkIcon className="size-3.5" />{" "}
              <span className="hidden sm:inline">Copy link</span>
            </button>
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                isWatching
                  ? "bg-primary/10 text-primary"
                  : "text-base-content/60 hover:bg-base-200 hover:text-base-content"
              )}
              onClick={handleToggleWatch}
              title={isWatching ? "Unwatch" : "Watch"}
              type="button"
            >
              {isWatching ? (
                <EyeSlashIcon className="size-3.5" />
              ) : (
                <EyeIcon className="size-3.5" />
              )}
              <span className="hidden sm:inline">
                {isWatching ? "Unwatch" : "Watch"}
              </span>
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="flex size-7 items-center justify-center rounded-md hover:bg-base-200 text-base-content/60"
                  type="button"
                >
                  <DotsThreeIcon className="size-4.5" weight="bold" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                <TaskOverflowMenuItems
                  canPinToList={!!(canPinToList && listId)}
                  isArchived={isArchived}
                  isPinnedToList={!!data?.task.isPinnedToList}
                  onArchiveToggle={isArchived ? handleUnarchive : handleArchive}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onPinToListToggle={handlePinToListToggle}
                  saving={saving}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Compact header — mobile only (< md). Back, truncated title,
          Previous/Next, and a single overflow menu that folds in Pin/Copy
          link/Watch (separate buttons on desktop) alongside the shared
          Duplicate/Archive/Pin-to-list/Delete items. */}
        <div className="flex md:hidden items-center gap-0.5 border-b px-1 py-1.5 shrink-0">
          <button
            aria-label="Back"
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
            onClick={() => router.push(backUrl)}
            type="button"
          >
            <ArrowLeftIcon className="size-5" />
          </button>
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-base-content">
            {t.title}
          </span>
          {taskNav.available && (
            <div className="flex shrink-0 items-center">
              <button
                aria-label="Previous task"
                className="flex size-11 items-center justify-center rounded-md text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content disabled:pointer-events-none disabled:opacity-40"
                disabled={!taskNav.prevId}
                onClick={goPrevTask}
                type="button"
              >
                <CaretLeftIcon className="size-4.5" />
              </button>
              <button
                aria-label="Next task"
                className="flex size-11 items-center justify-center rounded-md text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content disabled:pointer-events-none disabled:opacity-40"
                disabled={!taskNav.nextId}
                onClick={goNextTask}
                type="button"
              >
                <CaretRightIcon className="size-4.5" />
              </button>
            </div>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button
                aria-label="More actions"
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-base-content/60 hover:bg-base-200"
                type="button"
              >
                <DotsThreeIcon className="size-5" weight="bold" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1">
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-base-200"
                onClick={handleTogglePin}
                type="button"
              >
                <PushPinIcon
                  className={cn(
                    "size-3.5",
                    isPinned ? "text-primary" : "text-base-content/60"
                  )}
                  weight={isPinned ? "fill" : "regular"}
                />
                {isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-base-200"
                onClick={() => void copyLink()}
                type="button"
              >
                <LinkIcon className="size-3.5 text-base-content/60" /> Copy link
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-base-200"
                onClick={handleToggleWatch}
                type="button"
              >
                {isWatching ? (
                  <EyeSlashIcon className="size-3.5 text-base-content/60" />
                ) : (
                  <EyeIcon className="size-3.5 text-base-content/60" />
                )}
                {isWatching ? "Unwatch" : "Watch"}
              </button>
              <Separator className="my-1" />
              <TaskOverflowMenuItems
                canPinToList={!!(canPinToList && listId)}
                isArchived={isArchived}
                isPinnedToList={!!data?.task.isPinnedToList}
                onArchiveToggle={isArchived ? handleUnarchive : handleArchive}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
                onPinToListToggle={handlePinToListToggle}
                saving={saving}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Archived banner — shown in place of the old redirect-to-list. The
            Unarchive action is omitted for viewers who can't edit; they still
            see why the task looks frozen. */}
        {isArchived && (
          <div className="shrink-0 border-b px-5 py-3">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-50 px-4 py-2.5 dark:bg-amber-950/30">
              <ArchiveIcon
                className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
                weight="fill"
              />
              <p className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-200">
                This task has been archived.{" "}
                <span className="text-amber-700/80 dark:text-amber-300/70">
                  It stays hidden from lists and boards until it&rsquo;s
                  restored.
                </span>
              </p>
              {canEdit && (
                <Button
                  className="shrink-0"
                  disabled={unarchiving}
                  onClick={handleUnarchive}
                  size="sm"
                  variant="outline"
                >
                  <ArchiveIcon className="size-3.5" />
                  {unarchiving ? "Restoring…" : "Unarchive"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Two-column body — stacks to a single scrolling column below `lg`;
          each pane (main content / activity) keeps its own independent
          scroll at `lg`+, matching the original desktop layout exactly. */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden lg:flex-row">
          {/* ── Left: main content ── */}
          <div className="flex-1 min-w-0 overflow-y-auto px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
            {/* ── Mobile hero: editable title + prominent status/priority ──
              (< md only). Reuses the same titleEditing/titleDraft/saveTitle
              state as the desktop title below, and the extracted
              StatusPickerContent/PriorityPickerContent bodies. */}
            <div className="md:hidden">
              {titleEditing ? (
                <textarea
                  autoFocus
                  className="mb-3 -mx-1 block w-full resize-none overflow-hidden rounded bg-transparent px-1 py-1 text-xl font-bold leading-tight outline-none"
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
                <h1 className="mb-3">
                  <button
                    className={cn(
                      "block w-full rounded px-1 -mx-1 py-1 text-left text-xl font-bold transition-colors",
                      canEditNow && "cursor-text hover:bg-base-200/50"
                    )}
                    disabled={!canEditNow}
                    onClick={() => setTitleEditing(true)}
                    type="button"
                  >
                    {t.title}
                  </button>
                </h1>
              )}

              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Popover
                  onOpenChange={setMobileStatusPopoverOpen}
                  open={mobileStatusPopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <button
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors hover:opacity-80"
                      style={{
                        backgroundColor: `${currentStatus?.color ?? "#9CA3AF"}20`,
                        color: currentStatus?.color ?? "#9CA3AF",
                      }}
                      type="button"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: currentStatus?.color ?? "#9CA3AF",
                        }}
                      />
                      {currentStatus?.name ?? "No status"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-52 p-0">
                    <StatusPickerContent
                      canManage={!!canPinToList}
                      currentStatusId={t.statusId}
                      onManageStatuses={() => {
                        setMobileStatusPopoverOpen(false);
                        setManageStatusesOpen(true);
                      }}
                      onSelect={(id) => {
                        setMobileStatusPopoverOpen(false);
                        handleStatusChange(id);
                      }}
                      statuses={statuses}
                    />
                  </PopoverContent>
                </Popover>
                <Popover
                  onOpenChange={setMobilePriorityPopoverOpen}
                  open={mobilePriorityPopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-80",
                        priority.bg,
                        priority.color
                      )}
                      type="button"
                    >
                      <span>{priority.icon}</span>
                      {priority.label}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-44 p-1">
                    <PriorityPickerContent
                      currentPriority={t.priority as Priority}
                      onSelect={(p) => {
                        setMobilePriorityPopoverOpen(false);
                        handlePriorityChange(p);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Collapsible compact Properties — assignee/dates/tags/custom
                fields. Starts expanded (compact single-line rows don't
                dominate the screen even open); the chevron lets it collapse. */}
              <div className="rounded-xl border bg-elevated mb-4 overflow-hidden">
                <button
                  aria-expanded={mobilePropertiesOpen}
                  className="flex w-full items-center justify-between px-3 py-2.5 min-h-11"
                  onClick={() => setMobilePropertiesOpen((o) => !o)}
                  type="button"
                >
                  <span className="text-2xs font-semibold uppercase tracking-wider text-base-content/60">
                    Properties
                  </span>
                  {mobilePropertiesOpen ? (
                    <CaretUpIcon className="size-4 text-base-content/60" />
                  ) : (
                    <CaretDownIcon className="size-4 text-base-content/60" />
                  )}
                </button>
                {mobilePropertiesOpen && (
                  <div className="border-t divide-y divide-border/60">
                    {/* Assignee */}
                    <Popover
                      onOpenChange={setMobileAssigneePopoverOpen}
                      open={mobileAssigneePopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className="flex w-full items-center gap-3 px-3 py-2.5 min-h-11 text-left transition-colors hover:bg-base-200/40"
                          type="button"
                        >
                          <span className="flex w-20 shrink-0 items-center gap-1.5 text-xs text-base-content/60">
                            <UserIcon className="size-3.5" /> Assignee
                          </span>
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            {assignees.length > 0 ? (
                              <>
                                <Avatar className="size-5 shrink-0">
                                  {assignees[0].image && (
                                    <AvatarImage
                                      src={avatarSrc(assignees[0].image)}
                                    />
                                  )}
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
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-64 p-2">
                        <AssigneePickerContent
                          assignedUserIds={assignees.map((a) => a.userId)}
                          members={members}
                          onInvite={() => {
                            setMobileAssigneePopoverOpen(false);
                            setInviteOpen(true);
                          }}
                          onToggle={handleToggleAssignee}
                        />
                      </PopoverContent>
                    </Popover>

                    {/* Dates */}
                    <div className="flex w-full items-center gap-3 px-3 py-2.5 min-h-11">
                      <span className="flex w-20 shrink-0 items-center gap-1.5 text-xs text-base-content/60">
                        <CalendarBlankIcon className="size-3.5" /> Dates
                      </span>
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
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
                              {dueDateStart
                                ? format(dueDateStart, "MMM d")
                                : "Start"}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-auto p-0">
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
                          <PopoverContent align="start" className="w-auto p-0">
                            <Calendar
                              disabled={
                                dueDateStart
                                  ? { before: dueDateStart }
                                  : undefined
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

                    {/* Tags */}
                    <Popover
                      onOpenChange={setMobileTagPopoverOpen}
                      open={mobileTagPopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className="flex w-full items-center gap-3 px-3 py-2.5 min-h-11 text-left transition-colors hover:bg-base-200/40"
                          type="button"
                        >
                          <span className="flex w-20 shrink-0 items-center gap-1.5 text-xs text-base-content/60">
                            <TagIcon className="size-3.5" /> Tags
                          </span>
                          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                            {tags.length > 0 ? (
                              tags.slice(0, 3).map((tag) => (
                                <span
                                  className="shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium"
                                  key={tag.id}
                                  style={{
                                    backgroundColor: `${tag.color}20`,
                                    color: tag.color,
                                  }}
                                >
                                  {tag.name}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-base-content/60">
                                None
                              </span>
                            )}
                            {tags.length > 3 && (
                              <span className="shrink-0 text-xs text-base-content/60">
                                +{tags.length - 3}
                              </span>
                            )}
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-56 p-2">
                        <TagPickerContent
                          exactMatch={exactTagMatch}
                          filteredTags={filteredTags}
                          onCreate={handleCreateTag}
                          onDeleteRequest={setDeleteTagTarget}
                          onSearchChange={setTagSearch}
                          onToggle={handleToggleTag}
                          search={tagSearch}
                          selectedTagIds={tags.map((tg) => tg.id)}
                        />
                      </PopoverContent>
                    </Popover>

                    {/* Custom fields */}
                    {customFields.map((field) => (
                      <div
                        className="flex w-full items-center gap-3 px-3 py-2.5 min-h-11"
                        key={field.id}
                      >
                        <span className="w-20 shrink-0 truncate text-xs text-base-content/60">
                          {field.name}
                        </span>
                        <div className="min-w-0 flex-1">
                          <CustomFieldEditor
                            disabled={!canEditNow}
                            field={field}
                            members={members}
                            onChange={(value) =>
                              handleCustomFieldChange(field.id, value)
                            }
                            value={customFieldValues[field.id]}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Desktop/tablet title (`md:`+) — unchanged from before. ── */}
            <div className="hidden md:block">
              {/* Title */}
              {titleEditing ? (
                // Textarea (not a single-line input) so a long title keeps the
                // same big font AND wraps across lines while editing, matching the
                // rendered heading. It auto-grows to fit; Enter still saves.
                <textarea
                  autoFocus
                  className="mb-5 -mx-1 block w-full resize-none overflow-hidden rounded bg-transparent px-1 py-1 text-2xl font-bold leading-tight outline-none"
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
                <h1 className="mb-5">
                  <button
                    className={cn(
                      "block w-full rounded px-1 -mx-1 py-1 text-left text-2xl font-bold transition-colors",
                      canEditNow && "cursor-text hover:bg-base-200/50"
                    )}
                    disabled={!canEditNow}
                    onClick={() => setTitleEditing(true)}
                    type="button"
                  >
                    {t.title}
                  </button>
                </h1>
              )}
            </div>

            {/* ── Desktop/tablet fields grid (`md:`+) — unchanged from before. ── */}
            <div className="hidden md:block">
              {/* Fields grid */}
              <div className="rounded-lg border bg-elevated px-4 mb-6">
                {/* Status */}
                <FieldRow
                  icon={
                    <span
                      className="size-3 rounded-full shrink-0"
                      style={{
                        backgroundColor: currentStatus?.color ?? "#9CA3AF",
                      }}
                    />
                  }
                  label="Status"
                >
                  <Popover
                    onOpenChange={setStatusPopoverOpen}
                    open={statusPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-semibold transition-colors hover:opacity-80"
                        style={{
                          backgroundColor: `${currentStatus?.color ?? "#9CA3AF"}20`,
                          color: currentStatus?.color ?? "#9CA3AF",
                        }}
                        type="button"
                      >
                        {currentStatus?.name ?? "No status"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-52 p-0">
                      <StatusPickerContent
                        canManage={!!canPinToList}
                        currentStatusId={t.statusId}
                        onManageStatuses={() => {
                          setStatusPopoverOpen(false);
                          setManageStatusesOpen(true);
                        }}
                        onSelect={(id) => {
                          setStatusPopoverOpen(false);
                          handleStatusChange(id);
                        }}
                        statuses={statuses}
                      />
                    </PopoverContent>
                  </Popover>
                </FieldRow>

                {/* Assignees */}
                <FieldRow
                  icon={<UserIcon className="size-3.5" />}
                  label="Assignees"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    {assignees.map((a) => (
                      <div
                        className="flex items-center gap-1 rounded-full bg-base-200 px-2 py-0.5 text-xs"
                        key={a.userId}
                      >
                        <Avatar className="size-4">
                          {a.image && <AvatarImage src={avatarSrc(a.image)} />}
                          <AvatarFallback className="text-[8px]">
                            {userInitials(a.name, a.email)}
                          </AvatarFallback>
                        </Avatar>
                        <span>{a.name ?? a.email}</span>
                        <button
                          className="text-base-content/60 hover:text-base-content"
                          onClick={() => handleToggleAssignee(a.userId)}
                          type="button"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </div>
                    ))}
                    <Popover
                      onOpenChange={setAssigneePopoverOpen}
                      open={assigneePopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className="flex size-6 items-center justify-center rounded-full border border-dashed border-base-300 text-base-content/60 hover:border-primary hover:text-primary transition-colors"
                          type="button"
                        >
                          <PlusIcon className="size-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-52 p-2">
                        <AssigneePickerContent
                          assignedUserIds={assignees.map((a) => a.userId)}
                          members={members}
                          onInvite={() => {
                            setAssigneePopoverOpen(false);
                            setInviteOpen(true);
                          }}
                          onToggle={handleToggleAssignee}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </FieldRow>

                {/* Dates */}
                <FieldRow
                  icon={<CalendarBlankIcon className="size-3.5" />}
                  label="Dates"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Popover onOpenChange={setStartCalOpen} open={startCalOpen}>
                      <PopoverTrigger asChild>
                        <button
                          className="flex items-center gap-1.5 rounded-md border bg-base-100 px-2 py-1 text-xs w-32 hover:bg-base-200 transition-colors"
                          type="button"
                        >
                          <CalendarBlankIcon className="size-3 text-base-content/60 shrink-0" />
                          <span
                            className={
                              dueDateStart
                                ? "text-base-content"
                                : "text-base-content/60"
                            }
                          >
                            {dueDateStart
                              ? format(dueDateStart, "MMM d, yyyy")
                              : "Start date"}
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-auto p-0">
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
                    <span className="text-base-content/60 text-xs">→</span>
                    <Popover onOpenChange={setEndCalOpen} open={endCalOpen}>
                      <PopoverTrigger asChild>
                        <button
                          className="flex items-center gap-1.5 rounded-md border bg-base-100 px-2 py-1 text-xs w-32 hover:bg-base-200 transition-colors"
                          type="button"
                        >
                          <CalendarBlankIcon className="size-3 text-base-content/60 shrink-0" />
                          <span
                            className={
                              dueDateEnd
                                ? "text-base-content"
                                : "text-base-content/60"
                            }
                          >
                            {dueDateEnd
                              ? format(dueDateEnd, "MMM d, yyyy")
                              : "End date"}
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-auto p-0">
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
                </FieldRow>

                {/* Priority */}
                <FieldRow
                  icon={<FlagIcon className="size-3.5" />}
                  label="Priority"
                >
                  <Popover
                    onOpenChange={setPriorityPopoverOpen}
                    open={priorityPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80",
                          priority.bg,
                          priority.color
                        )}
                        type="button"
                      >
                        <span>{priority.icon}</span>
                        {priority.label}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-44 p-1">
                      <PriorityPickerContent
                        currentPriority={t.priority as Priority}
                        onSelect={(p) => {
                          setPriorityPopoverOpen(false);
                          handlePriorityChange(p);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </FieldRow>

                {/* Tags */}
                <FieldRow icon={<TagIcon className="size-3.5" />} label="Tags">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tags.map((tag) => (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                        key={tag.id}
                        style={{
                          backgroundColor: `${tag.color}20`,
                          color: tag.color,
                        }}
                      >
                        {tag.name}
                        <button
                          className="opacity-60 hover:opacity-100"
                          onClick={() => handleToggleTag(tag.id)}
                          type="button"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </span>
                    ))}
                    <Popover
                      onOpenChange={setTagPopoverOpen}
                      open={tagPopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className="flex size-6 items-center justify-center rounded-full border border-dashed border-base-300 text-base-content/60 hover:border-primary hover:text-primary transition-colors"
                          type="button"
                        >
                          <PlusIcon className="size-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-52 p-2">
                        <TagPickerContent
                          exactMatch={exactTagMatch}
                          filteredTags={filteredTags}
                          onCreate={handleCreateTag}
                          onDeleteRequest={setDeleteTagTarget}
                          onSearchChange={setTagSearch}
                          onToggle={handleToggleTag}
                          search={tagSearch}
                          selectedTagIds={tags.map((tg) => tg.id)}
                        />
                      </PopoverContent>
                    </Popover>
                    {tags.length > 1 && (
                      <button
                        className="ml-0.5 text-xs text-base-content/60 hover:text-error transition-colors"
                        onClick={handleClearAllTags}
                        type="button"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </FieldRow>

                {/* Custom fields */}
                {customFields.map((field) => (
                  <FieldRow
                    icon={<span className="size-3 shrink-0" />}
                    key={field.id}
                    label={field.name}
                  >
                    <CustomFieldEditor
                      disabled={!canEditNow}
                      field={field}
                      members={members}
                      onChange={(value) =>
                        handleCustomFieldChange(field.id, value)
                      }
                      value={customFieldValues[field.id]}
                    />
                  </FieldRow>
                ))}
              </div>
            </div>

            {/* Description — shared by every breakpoint (single instance;
              the Tiptap editor is too heavy to double-mount). */}
            <div className="mb-6">
              <TaskDescriptionEditor
                onChange={setDescDraft}
                onSave={saveDescription}
                spaceId={spaceId}
                taskId={taskId}
                value={descDraft}
                workspaceId={workspaceId}
              />
            </div>

            {/* Activity/comments, mobile only (< md) — placed here (right
              after Description, ahead of Subtasks/Dependencies/Checklist) so
              the discussion is reachable with minimal scrolling. Gated on the
              actual breakpoint (not CSS hidden/md:hidden) because
              TaskActivityFeed fetches its own data and owns a comment
              composer — mounting it a second time for the desktop right
              column below would double-fetch and give two composers. */}
            {isMobile && (
              <div className="mb-6 md:hidden">
                <TaskActivityFeed
                  currentUserId={currentUserId}
                  listId={listId}
                  ref={feedRef}
                  spaceId={spaceId}
                  taskId={taskId}
                  workspaceId={workspaceId}
                />
              </div>
            )}

            {/* Unified content sections — sections with data open together on
              load; empty sections start collapsed and auto-collapse on an
              outside click. Inputs appear only after clicking "+ Add". */}
            <div className="mb-6" ref={sectionsRef}>
              <Accordion
                onValueChange={setOpenSections}
                type="multiple"
                value={openSections}
              >
                {/* Subtasks — only shown on parent tasks (not subtask detail pages) */}
                {!t.parentTaskId && (
                  <AccordionItem value="subtasks">
                    <AccordionTrigger className="hover:no-underline">
                      <SectionHeader
                        count={subtasks?.length ?? 0}
                        description="Split this work into smaller tasks."
                        icon={TreeStructureIcon}
                        title="Subtasks"
                      />
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3">
                      {subtasks && subtasks.length > 0 ? (
                        <>
                          <Progress
                            className="h-1.5"
                            value={Math.round(
                              (subtasks.filter((s) => s.statusType === "CLOSED")
                                .length /
                                subtasks.length) *
                                100
                            )}
                          />
                          {(() => {
                            const renderRow = (
                              sub: (typeof subtasks)[number]
                            ) => (
                              <SubtaskRow
                                canEdit={canEditNow}
                                key={sub.id}
                                members={members}
                                onChanged={load}
                                onDelete={() =>
                                  setDeletingSubtask({
                                    id: sub.id,
                                    title: sub.title,
                                  })
                                }
                                onNavigate={() =>
                                  router.push(`/${workspaceId}/task/${sub.id}`)
                                }
                                parentListId={t.listId}
                                spaceId={spaceId}
                                statuses={statuses}
                                subtask={sub}
                                workspaceId={workspaceId}
                              />
                            );
                            const active = subtasks.filter(
                              (s) => s.statusType !== "CLOSED"
                            );
                            const completed = subtasks.filter(
                              (s) => s.statusType === "CLOSED"
                            );
                            return (
                              <div className="space-y-1">
                                {active.map(renderRow)}
                                {completed.length > 0 && (
                                  <>
                                    <button
                                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors"
                                      onClick={() =>
                                        setCompletedOpen((o) => !o)
                                      }
                                      type="button"
                                    >
                                      {completedOpen ? (
                                        <CaretDownIcon className="size-3.5 shrink-0" />
                                      ) : (
                                        <CaretRightIcon className="size-3.5 shrink-0" />
                                      )}
                                      Completed ({completed.length})
                                    </button>
                                    {completedOpen && completed.map(renderRow)}
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </>
                      ) : (
                        !addingSubtask && (
                          <p className="text-sm text-base-content/60">
                            Break this task into smaller pieces.
                          </p>
                        )
                      )}

                      {addingSubtask ? (
                        <div className="flex gap-2 items-center">
                          <Input
                            autoFocus
                            className="h-8 rounded-lg text-xs"
                            disabled={creatingSubtask}
                            onChange={(e) => setSubtaskInput(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter" && subtaskInput.trim()) {
                                setCreatingSubtask(true);
                                const subRes = await createSubtask(
                                  workspaceId,
                                  spaceId,
                                  taskId,
                                  subtaskInput.trim()
                                );
                                if ("error" in subRes) {
                                  toast.error(subRes.error);
                                } else {
                                  setSubtaskInput("");
                                }
                                setCreatingSubtask(false);
                                load();
                                subtaskInputRef.current?.focus();
                              }
                              if (e.key === "Escape") {
                                setSubtaskInput("");
                                setAddingSubtask(false);
                              }
                            }}
                            placeholder="Subtask name…"
                            ref={subtaskInputRef}
                            value={subtaskInput}
                          />
                          <Button
                            className="h-8 rounded-lg text-xs shrink-0"
                            disabled={creatingSubtask}
                            onClick={() => {
                              setSubtaskInput("");
                              setAddingSubtask(false);
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            Cancel
                          </Button>
                          <Button
                            className="h-8 rounded-lg text-xs font-semibold shrink-0 px-3"
                            disabled={creatingSubtask || !subtaskInput.trim()}
                            onClick={async () => {
                              if (!subtaskInput.trim()) {
                                return;
                              }
                              setCreatingSubtask(true);
                              const subRes = await createSubtask(
                                workspaceId,
                                spaceId,
                                taskId,
                                subtaskInput.trim()
                              );
                              if ("error" in subRes) {
                                toast.error(subRes.error);
                              } else {
                                setSubtaskInput("");
                              }
                              setCreatingSubtask(false);
                              load();
                              subtaskInputRef.current?.focus();
                            }}
                            size="sm"
                          >
                            Save
                          </Button>
                        </div>
                      ) : (
                        <button
                          className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors"
                          onClick={() => setAddingSubtask(true)}
                          type="button"
                        >
                          <PlusIcon className="size-4" />
                          Add subtask
                        </button>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}

                {/* Dependencies */}
                <AccordionItem value="dependencies">
                  <AccordionTrigger className="hover:no-underline">
                    <SectionHeader
                      count={blockedBy.length + blocks.length}
                      description="Link tasks that block or depend on this one."
                      icon={GitBranchIcon}
                      title="Dependencies"
                    />
                  </AccordionTrigger>
                  <AccordionContent>
                    <TaskDependencies
                      blockedBy={blockedBy}
                      blocks={blocks}
                      canEdit={canEditNow}
                      hideHeader
                      listId={listId}
                      onChanged={load}
                      spaceId={spaceId}
                      taskId={taskId}
                      workspaceId={workspaceId}
                    />
                  </AccordionContent>
                </AccordionItem>

                {/* Checklist */}
                <AccordionItem value="checklist">
                  <AccordionTrigger className="hover:no-underline">
                    <SectionHeader
                      count={totalItems}
                      description="Break this task into small actionable steps."
                      icon={ListChecksIcon}
                      title="Checklist"
                    />
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    {checklists.length > 0 ? (
                      <div className="space-y-5">
                        {totalItems > 0 && (
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-base-content/60 w-8 text-right">
                              {checkProgress}%
                            </span>
                            <Progress
                              className="flex-1 h-1.5"
                              value={checkProgress}
                            />
                          </div>
                        )}
                        {checklists.map((cl) => (
                          <div key={cl.id}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-semibold text-sm flex-1">
                                {cl.name}
                              </span>
                              <button
                                className="text-base-content/60 hover:text-error"
                                onClick={async () => {
                                  await deleteChecklist(
                                    workspaceId,
                                    spaceId,
                                    listId,
                                    cl.id
                                  );
                                  load();
                                }}
                                type="button"
                              >
                                <XIcon className="size-3.5" />
                              </button>
                            </div>
                            <div className="space-y-1 mb-2">
                              {cl.items.map((item) => (
                                <div
                                  className="flex items-center gap-2 rounded-md py-1 px-1 hover:bg-base-200/30 group"
                                  key={item.id}
                                >
                                  <Checkbox
                                    checked={item.isChecked}
                                    className="shrink-0"
                                    onCheckedChange={() =>
                                      handleToggleItem(item.id)
                                    }
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
                                    className="opacity-0 group-hover:opacity-100 text-base-content/60 hover:text-error transition-opacity"
                                    onClick={async () => {
                                      await deleteChecklistItem(
                                        workspaceId,
                                        spaceId,
                                        listId,
                                        item.id
                                      );
                                      load();
                                    }}
                                    type="button"
                                  >
                                    <XIcon className="size-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <Input
                                className="h-7 rounded-lg text-xs"
                                onChange={(e) =>
                                  setNewItemTexts((prev) => ({
                                    ...prev,
                                    [cl.id]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleAddItem(cl.id);
                                  }
                                }}
                                placeholder="Add item…"
                                value={newItemTexts[cl.id] ?? ""}
                              />
                              <Button
                                className="h-7 rounded-lg px-3 text-xs font-semibold"
                                onClick={() => handleAddItem(cl.id)}
                                size="sm"
                              >
                                Add
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      !addingChecklist && (
                        <p className="text-sm text-base-content/60">
                          Track quick steps for this task.
                        </p>
                      )
                    )}

                    {addingChecklist ? (
                      <div className="flex gap-2 items-center">
                        <Input
                          autoFocus
                          className="h-7 rounded-lg text-xs w-44"
                          onChange={(e) => setNewChecklistName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleAddChecklist();
                            }
                            if (e.key === "Escape") {
                              setAddingChecklist(false);
                            }
                          }}
                          placeholder="Checklist name…"
                          value={newChecklistName}
                        />
                        <Button
                          className="h-7 rounded-lg px-3 text-xs font-semibold"
                          onClick={handleAddChecklist}
                          size="sm"
                        >
                          Add
                        </Button>
                        <Button
                          className="h-7 rounded-lg text-xs"
                          onClick={() => setAddingChecklist(false)}
                          size="sm"
                          variant="ghost"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors"
                        onClick={() => setAddingChecklist(true)}
                        type="button"
                      >
                        <PlusIcon className="size-4" />
                        Add checklist
                      </button>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* Time Tracking */}
                <AccordionItem value="timeTracking">
                  <AccordionTrigger className="hover:no-underline">
                    <SectionHeader
                      count={timeEntries.length}
                      description="Track time spent on this task."
                      icon={TimerIcon}
                      title="Time Tracking"
                    />
                  </AccordionTrigger>
                  <AccordionContent>
                    <TaskTimeTracking
                      canEdit={canEditNow}
                      currentUserId={currentUserId}
                      entries={timeEntries}
                      hideHeader
                      listId={listId}
                      onChanged={load}
                      spaceId={spaceId}
                      taskId={taskId}
                      workspaceId={workspaceId}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            <Separator className="mb-6" />

            {/* Attachments */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <PaperclipIcon className="size-4 text-base-content/60" />
                  <h3 className="text-sm font-semibold">Attachments</h3>
                  {visibleAttachments.length > 0 && (
                    <span className="text-xs text-base-content/60">
                      {visibleAttachments.length} file
                      {visibleAttachments.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {/* Hidden while empty — the large drop zone below is the only
                  call-to-action. Returns once the first file is uploaded. */}
                {visibleAttachments.length > 0 && (
                  <button
                    className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-base-content/60 border hover:bg-base-200 hover:text-base-content transition-colors disabled:opacity-50"
                    disabled={uploadingFile}
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <PlusIcon className="size-3.5" />
                    {uploadingFile ? "Uploading…" : "Add attachment"}
                  </button>
                )}
                {/* Always mounted — the drop zone and both buttons use this ref. */}
                <input
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleFileUpload(file);
                      e.target.value = "";
                    }
                  }}
                  ref={fileInputRef}
                  type="file"
                />
              </div>

              {/* Drop zone — always rendered. Clicking anywhere opens the file
                picker; dragging files in shows a drop overlay. Uses the same
                upload flow as the "Add attachment" button. */}
              {/* biome-ignore lint/a11y/useSemanticElements: wraps nested interactive children (attachment card buttons, "Add file" button) — a real <button> can't contain other buttons. */}
              <div
                aria-label="Add attachments — click to browse or drop files here"
                className={cn(
                  "relative rounded-lg border-2 border-dashed p-4 cursor-pointer transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  attachmentDragOver
                    ? "border-primary bg-primary/5"
                    : "border-base-300/50 hover:border-primary/40 hover:bg-base-200/30",
                  visibleAttachments.length === 0 && "min-h-40"
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={handleAttachmentDragEnter}
                onDragLeave={handleAttachmentDragLeave}
                onDragOver={handleAttachmentDragOver}
                onDrop={handleAttachmentDrop}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                role="button"
                tabIndex={0}
              >
                {visibleAttachments.length > 0 ? (
                  // biome-ignore lint/a11y/noStaticElementInteractions: only stops clicks from bubbling to the drop-zone's onClick; nested buttons below remain independently keyboard-accessible.
                  // biome-ignore lint/a11y/useKeyWithClickEvents: same as above — no independent action to key-trigger, nested buttons handle their own keyboard access.
                  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: same as above.
                  <div
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {visibleAttachments.map((att) => (
                      <TaskAttachmentCard
                        att={att}
                        key={att.id}
                        onDelete={handleDeleteAttachment}
                      />
                    ))}
                    <button
                      className="flex flex-col items-center justify-center h-full min-h-24 rounded-md border-2 border-dashed border-base-300/50 text-base-content/60 hover:border-primary/40 hover:text-base-content transition-colors disabled:opacity-50"
                      disabled={uploadingFile}
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      type="button"
                    >
                      <PlusIcon className="size-5" />
                      <span className="text-2xs mt-1">
                        {uploadingFile ? "Uploading…" : "Add file"}
                      </span>
                    </button>
                  </div>
                ) : (
                  /* Empty state — hidden as soon as one attachment exists */
                  <div className="flex flex-col items-center justify-center py-8 text-center select-none pointer-events-none">
                    <PaperclipIcon className="size-6 text-base-content/60" />
                    <p className="mt-2 text-sm font-medium text-base-content">
                      Attachments
                    </p>
                    <p className="mt-1 text-sm text-base-content/60">
                      {uploadingFile ? "Uploading…" : "Drag & drop files here"}
                    </p>
                    {!uploadingFile && (
                      <p className="text-sm text-base-content/60">
                        or click anywhere to upload
                      </p>
                    )}
                    <p className="mt-2 text-xs text-base-content/70">
                      Supports images, PDFs, documents, and other supported
                      files.
                    </p>
                  </div>
                )}

                {/* Drag overlay — pointer-events-none so the drop lands on the zone */}
                {attachmentDragOver && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-primary/10 backdrop-blur-[1px]">
                    <PaperclipIcon className="size-6 text-primary" />
                    <p className="mt-2 text-sm font-semibold text-primary">
                      Drop files here
                    </p>
                    <p className="text-xs text-base-content/60">
                      Release to upload
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Right: activity (`md:`+ only — mobile mounts its own
            TaskActivityFeed earlier in the left column instead; see the
            `isMobile` gate above). Unchanged from before at `md:`+. ── */}
          <div className="hidden min-h-0 w-full border-t md:flex md:flex-1 md:flex-col overflow-hidden lg:w-80 lg:flex-none lg:border-t-0 lg:border-l xl:w-96">
            <div className="flex shrink-0 border-b px-3 py-2.5 sm:px-5">
              <span className="text-xs font-medium text-base-content">
                Activity
              </span>
            </div>

            {/* No scroll here — the feed owns it, so its composer can sit as a
                fixed footer below the scrolling activity list. */}
            <div className="flex-1 min-h-0">
              {!isMobile && (
                <TaskActivityFeed
                  currentUserId={currentUserId}
                  hideHeader
                  listId={listId}
                  ref={feedRef}
                  spaceId={spaceId}
                  taskId={taskId}
                  variant="fill"
                  workspaceId={workspaceId}
                />
              )}
            </div>

            {/* Task seq footer */}
            <div className="border-t px-3 py-3 shrink-0 sm:px-5">
              <p className="text-xs text-base-content/60">
                <span className="font-mono">#{t.seqNumber}</span> · Created{" "}
                {format(new Date(t.createdAt), "MMM d, yyyy")}
              </p>
            </div>
          </div>
        </div>
      </div>

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
      <ManageStatusesDialog
        listId={listId}
        onOpenChange={setManageStatusesOpen}
        onSaved={() => fetchAll(false)}
        open={manageStatusesOpen}
        spaceId={spaceId}
        workspaceId={workspaceId}
      />
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
                This action cannot be undone.
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
      <Dialog
        onOpenChange={(open) => !open && setDeletingSubtask(null)}
        open={!!deletingSubtask}
      >
        <DialogContent className="sm:max-w-xs text-center">
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-error/10">
              <TrashIcon className="size-6 text-error" weight="fill" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Delete Subtask
              </DialogTitle>
              <p className="text-sm text-base-content/60 mt-1">
                {deletingSubtask
                  ? `"${deletingSubtask.title}" will be permanently deleted.`
                  : ""}{" "}
                This action cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <Button
              className="flex-1"
              disabled={deletingSubtaskBusy}
              onClick={() => setDeletingSubtask(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={deletingSubtaskBusy}
              onClick={confirmDeleteSubtask}
              variant="destructive"
            >
              {deletingSubtaskBusy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <InviteMemberModal
        onInvited={load}
        onOpenChange={setInviteOpen}
        open={inviteOpen}
        workspaceId={workspaceId}
      />
    </AttachmentPreviewProvider>
  );
}

// ─── Task attachment card ─────────────────────────────────────────────────────
// Rendered inside <AttachmentPreviewProvider> so it can open the in-app preview.

interface TaskAttachmentCardProps {
  att: {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    url: string;
  };
  onDelete: (id: string) => void;
}

function TaskAttachmentCard({ att, onDelete }: TaskAttachmentCardProps) {
  const preview = useAttachmentPreview();
  const isImg = att.mimeType.startsWith("image/");

  function fmtBytes(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(0)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function openPreview() {
    if (preview) {
      preview.open(att);
    } else {
      window.open(att.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="group relative rounded-md border bg-elevated overflow-hidden">
      {isImg ? (
        <button className="block w-full" onClick={openPreview} type="button">
          {/* biome-ignore lint/performance/noImgElement: served from storage.url() — a signed/auth-gated URL next/image can't optimize */}
          <img
            alt={att.fileName}
            className="w-full h-24 object-cover"
            src={att.url}
          />
        </button>
      ) : (
        <button
          className="flex w-full flex-col items-center justify-center gap-2 h-24 text-base-content/60 hover:text-base-content hover:bg-base-200 transition-colors"
          onClick={openPreview}
          type="button"
        >
          {att.mimeType === "application/pdf" ? (
            <FilePdfIcon className="size-8 text-red-500" />
          ) : (
            <FileIcon className="size-8" />
          )}
        </button>
      )}
      <div className="px-2 py-1.5 border-t">
        <p className="text-xs truncate font-medium">{att.fileName}</p>
        <p className="text-2xs text-base-content/60">
          {fmtBytes(att.fileSize)}
        </p>
      </div>
      <button
        className="absolute top-1.5 right-1.5 size-6 inline-flex items-center justify-center leading-none rounded-full bg-black/70 text-white hover:bg-red-500 opacity-0 group-hover:opacity-100 transition-all"
        onClick={() => onDelete(att.id)}
        type="button"
      >
        <XIcon className="size-3.5 shrink-0" weight="bold" />
      </button>
    </div>
  );
}
