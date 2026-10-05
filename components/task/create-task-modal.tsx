"use client";

import {
  CalendarBlankIcon,
  CheckIcon,
  DotsThreeIcon,
  FlagIcon,
  GearIcon,
  PlusIcon,
  TagIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import * as React from "react";
import { toast } from "sonner";
import {
  createTask,
  getWorkspaceMembers,
  updateTask,
} from "@/app/actions/task";
import { createTag, getWorkspaceTags } from "@/app/actions/task-tag";
import { UserAvatar } from "@/components/common/user-avatar";
import { ManageStatusesDialog } from "@/components/list/manage-statuses-dialog";
import { MemberSearchInput } from "@/components/task/member-search-input";
import { TaskDescriptionEditor } from "@/components/task/task-description-editor";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNoteImageUpload } from "@/hooks/use-note-image-upload";
import { filterMembersByQuery } from "@/lib/member-search";
import { tiptapHasContent } from "@/lib/notes";
import { cn } from "@/lib/utils";

type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

interface Status {
  color: string;
  id: string;
  name: string;
  type: "OPEN" | "ACTIVE" | "CLOSED";
}

interface CreateTaskModalProps {
  canManage?: boolean;
  /** Preselect a due date when opening (e.g. the day clicked in Calendar view). */
  defaultDueDate?: Date | null;
  defaultStatusId?: string;
  listId: string;
  onCreated?: (taskId: string) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  spaceId: string;
  statuses: Status[];
  workspaceId: string;
}

const PRIORITY_OPTIONS: {
  value: Priority;
  label: string;
  color: string;
  icon: string;
}[] = [
  {
    value: "NONE",
    label: "No Priority",
    color: "text-base-content/60",
    icon: "😴",
  },
  { value: "LOW", label: "Low", color: "text-blue-500", icon: "🦥" },
  { value: "MEDIUM", label: "Medium", color: "text-yellow-500", icon: "🚶" },
  { value: "HIGH", label: "High", color: "text-orange-500", icon: "🏃" },
  { value: "URGENT", label: "Urgent", color: "text-red-500", icon: "🚨" },
];

export function CreateTaskModal({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  statuses: initialStatuses,
  defaultStatusId,
  defaultDueDate,
  onCreated,
  canManage,
}: CreateTaskModalProps) {
  const [localStatuses, setLocalStatuses] = React.useState(initialStatuses);
  const [manageStatusesOpen, setManageStatusesOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [descriptionJson, setDescriptionJson] = React.useState("");
  const descImages = useNoteImageUpload({
    deferred: true,
    acceptAllFiles: true,
  });
  const [statusId, setStatusId] = React.useState(
    defaultStatusId ?? initialStatuses[0]?.id ?? ""
  );

  React.useEffect(() => {
    setLocalStatuses(initialStatuses);
  }, [initialStatuses]);
  const [priority, setPriority] = React.useState<Priority>("NONE");
  const [dueDate, setDueDate] = React.useState<Date | null>(null);
  const [assigneeIds, setAssigneeIds] = React.useState<string[]>([]);
  const [tagIds, setTagIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [statusPopoverOpen, setStatusPopoverOpen] = React.useState(false);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = React.useState(false);
  const [dueDatePopoverOpen, setDueDatePopoverOpen] = React.useState(false);
  const [priorityPopoverOpen, setPriorityPopoverOpen] = React.useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = React.useState(false);

  const [members, setMembers] = React.useState<
    { userId: string; name: string; image: string | null }[]
  >([]);
  const [allTags, setAllTags] = React.useState<
    { id: string; name: string; color: string }[]
  >([]);
  const [tagSearch, setTagSearch] = React.useState("");
  const [memberSearch, setMemberSearch] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setStatusId(defaultStatusId ?? localStatuses[0]?.id ?? "");
      setTitle("");
      setDescriptionJson("");
      descImages.reset();
      setPriority("NONE");
      setDueDate(defaultDueDate ?? null);
      setAssigneeIds([]);
      setTagIds([]);
      setError("");

      Promise.all([
        getWorkspaceMembers(workspaceId),
        getWorkspaceTags(workspaceId),
      ]).then(([mem, tags]) => {
        if (mem && !("error" in mem)) {
          setMembers(
            mem.members
              .filter(
                (m): m is typeof m & { userId: string } => m.userId !== null
              )
              .map((m) => ({ userId: m.userId!, name: m.name, image: m.image }))
          );
        }
        if (tags && !("error" in tags)) {
          setAllTags(tags.tags);
        }
      });
    }
  }, [
    open,
    defaultStatusId,
    defaultDueDate,
    workspaceId,
    localStatuses[0]?.id,
    descImages.reset,
  ]);

  // Statuses may load asynchronously after the modal opens. Once they're
  // available, make sure a valid status is selected so the task is never
  // created without one (otherwise it lands in "No Status").
  React.useEffect(() => {
    if (!open || localStatuses.length === 0) {
      return;
    }
    setStatusId((prev) =>
      prev && localStatuses.some((s) => s.id === prev)
        ? prev
        : (defaultStatusId ?? localStatuses[0].id)
    );
  }, [open, localStatuses, defaultStatusId]);

  async function handleSubmit() {
    if (!title.trim()) {
      setError("Task name is required");
      return;
    }
    setLoading(true);
    setError("");

    let doc: unknown;
    if (descriptionJson) {
      try {
        const parsed = JSON.parse(descriptionJson);
        if (tiptapHasContent(parsed)) {
          doc = parsed;
        }
      } catch {
        doc = undefined;
      }
    }
    const hasImages = descImages.hasPending();

    // When there are pending images we DON'T save the description yet — the task
    // row must never hold keyless placeholder image nodes. We upload the images
    // against the new taskId, then persist the finalized description exactly once.
    const res = await createTask(workspaceId, spaceId, listId, {
      title: title.trim(),
      statusId,
      priority,
      description: hasImages ? undefined : doc,
      dueDateEnd: dueDate,
      assigneeIds,
      tagIds,
    });
    if ("error" in res) {
      setLoading(false);
      setError(res.error);
      return;
    }

    if (hasImages) {
      const {
        total,
        uploaded,
        failed,
        doc: finalDoc,
      } = await descImages.flushPending(res.taskId);
      // Deep-clone to strip ProseMirror null-prototype attrs (React Flight drops them).
      const finalDescription = finalDoc
        ? (JSON.parse(JSON.stringify(finalDoc)) as unknown)
        : undefined;
      if (finalDescription && tiptapHasContent(finalDescription)) {
        await updateTask(workspaceId, spaceId, listId, res.taskId, {
          description: finalDescription,
        });
      }
      if (failed > 0) {
        toast.error(
          `${uploaded} of ${total} images uploaded. You can retry from the task description.`
        );
      }
    }

    await onCreated?.(res.taskId);
    setLoading(false);
    onOpenChange(false);
  }

  const currentStatus = localStatuses.find((s) => s.id === statusId);
  const currentPriority = PRIORITY_OPTIONS.find((p) => p.value === priority)!;
  const selectedMembers = members.filter((m) => assigneeIds.includes(m.userId));
  const selectedTags = allTags.filter((t) => tagIds.includes(t.id));
  const filteredTags = allTags.filter((t) =>
    t.name.toLowerCase().includes(tagSearch.toLowerCase())
  );
  const exactTagMatch = allTags.some(
    (t) => t.name.toLowerCase() === tagSearch.toLowerCase()
  );

  return (
    <>
      <Dialog
        onOpenChange={(o) => {
          if (!o && loading) {
            return;
          }
          onOpenChange(o);
        }}
        open={open}
      >
        <DialogContent
          aria-describedby={undefined}
          className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col"
          // Don't let Esc / outside-click abandon the modal while the task is
          // being created and its images uploaded.
          onEscapeKeyDown={(e) => {
            if (loading) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            if (loading) {
              e.preventDefault();
            }
          }}
          onPointerDownOutside={(e) => {
            if (loading) {
              e.preventDefault();
            }
          }}
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Create Task</DialogTitle>
          </DialogHeader>

          {/* Top bar: tab + close button */}
          <div className="flex items-center border-b px-5 shrink-0">
            <button
              className="border-b-2 border-primary py-3 px-1 text-sm font-medium text-base-content"
              type="button"
            >
              Task
            </button>
            <div className="flex-1" />
            <button
              className="flex size-7 items-center justify-center rounded-md text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          {/* Body — scrolls so the footer (Create button) stays visible even
            with a long description or images. */}
          <div className="px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0">
            {/* Title */}
            <input
              autoFocus
              className="w-full text-xl font-semibold bg-transparent outline-none placeholder:text-base-content/40"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Task Name"
              value={title}
            />

            {/* Description — rich text with inline image paste/drop (deferred
              upload: images upload after the task is created). Keyed on `open`
              so it remounts empty each time the modal is reopened (the modal
              stays mounted; its editor content would otherwise persist). */}
            <TaskDescriptionEditor
              imageUpload={descImages}
              key={open ? "open" : "closed"}
              onChange={setDescriptionJson}
              placeholder="Add a description… Type '/' for commands or paste an image"
              spaceId={spaceId}
              value={descriptionJson}
              workspaceId={workspaceId}
            />

            {error && <p className="text-sm text-error">{error}</p>}

            {/* Quick fields row */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {/* Status */}
              <Popover
                onOpenChange={setStatusPopoverOpen}
                open={statusPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-base-200"
                    style={{
                      borderColor: currentStatus?.color,
                      color: currentStatus?.color,
                    }}
                    type="button"
                  >
                    {currentStatus?.name ?? "Status"}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-52 p-0">
                  <div
                    className="max-h-60 overflow-y-auto p-1"
                    onWheel={(e) => e.stopPropagation()}
                  >
                    {(["OPEN", "ACTIVE", "CLOSED"] as const).map((type) => {
                      const group = localStatuses.filter(
                        (s) => s.type === type
                      );
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
                                    <DotsThreeIcon
                                      className="size-3.5"
                                      weight="bold"
                                    />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="start"
                                  className="w-36"
                                  side="right"
                                >
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setStatusPopoverOpen(false);
                                      setManageStatusesOpen(true);
                                    }}
                                  >
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
                              onClick={() => {
                                setStatusId(s.id);
                                setStatusPopoverOpen(false);
                              }}
                              type="button"
                            >
                              <span
                                className="size-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: s.color }}
                              />
                              <span className="flex-1 text-left">{s.name}</span>
                              {s.id === statusId && (
                                <CheckIcon className="size-3.5 text-primary" />
                              )}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Assignee */}
              <Popover
                onOpenChange={(o) => {
                  setAssigneePopoverOpen(o);
                  if (!o) {
                    setMemberSearch("");
                  }
                }}
                open={assigneePopoverOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors"
                    type="button"
                  >
                    {selectedMembers.length > 0 ? (
                      <>
                        <div className="flex -space-x-1">
                          {selectedMembers.slice(0, 2).map((m) => (
                            <UserAvatar
                              className="border border-base-100"
                              image={m.image}
                              key={m.userId}
                              name={m.name}
                              size="xs"
                            />
                          ))}
                        </div>
                        <span>
                          {selectedMembers.length === 1
                            ? selectedMembers[0].name.split(" ")[0]
                            : `${selectedMembers.length} assignees`}
                        </span>
                      </>
                    ) : (
                      <>
                        <UserIcon className="size-3.5" />
                        Assignee
                      </>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-52 p-2">
                  <p className="text-xs text-base-content/60 px-1 mb-1.5">
                    Select members
                  </p>
                  <MemberSearchInput
                    onChange={setMemberSearch}
                    value={memberSearch}
                  />
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {filterMembersByQuery(members, memberSearch).length ===
                      0 && (
                      <p className="px-2 py-1.5 text-xs text-base-content/60">
                        No members found
                      </p>
                    )}
                    {filterMembersByQuery(members, memberSearch).map((m) => {
                      const selected = assigneeIds.includes(m.userId);
                      return (
                        <button
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                          key={m.userId}
                          onClick={() =>
                            setAssigneeIds((prev) =>
                              selected
                                ? prev.filter((id) => id !== m.userId)
                                : [...prev, m.userId]
                            )
                          }
                          type="button"
                        >
                          <UserAvatar
                            className="shrink-0"
                            image={m.image}
                            name={m.name}
                            size="sm"
                          />
                          <span className="flex-1 truncate text-left">
                            {m.name}
                          </span>
                          {selected && (
                            <CheckIcon className="size-3.5 text-primary shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Due date */}
              <Popover
                onOpenChange={setDueDatePopoverOpen}
                open={dueDatePopoverOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-base-200 transition-colors",
                      dueDate
                        ? "text-base-content"
                        : "text-base-content/60 hover:text-base-content"
                    )}
                    type="button"
                  >
                    <CalendarBlankIcon className="size-3.5" />
                    {dueDate ? format(dueDate, "MMM d") : "Due date"}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    // When opened from a Calendar day, allow any date (incl. past);
                    // otherwise keep the default "no past dates" restriction.
                    disabled={
                      defaultDueDate ? undefined : { before: new Date() }
                    }
                    mode="single"
                    onSelect={(date) => {
                      setDueDate(date ?? null);
                      setDueDatePopoverOpen(false);
                    }}
                    selected={dueDate ?? undefined}
                  />
                </PopoverContent>
              </Popover>

              {/* Priority */}
              <Popover
                onOpenChange={setPriorityPopoverOpen}
                open={priorityPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-base-200",
                      currentPriority.color
                    )}
                    type="button"
                  >
                    {priority === "NONE" ? (
                      <>
                        <FlagIcon className="size-3.5" weight="regular" />
                        Priority
                      </>
                    ) : (
                      <>
                        <span>{currentPriority.icon}</span>
                        {currentPriority.label}
                      </>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-40 p-1">
                  {PRIORITY_OPTIONS.map((p) => (
                    <button
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200",
                        p.color
                      )}
                      key={p.value}
                      onClick={() => {
                        setPriority(p.value);
                        setPriorityPopoverOpen(false);
                      }}
                      type="button"
                    >
                      <span>{p.icon}</span>
                      <span className="flex-1 text-left">{p.label}</span>
                      {p.value === priority && (
                        <CheckIcon className="size-3.5 shrink-0" />
                      )}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>

              {/* Tags */}
              <Popover onOpenChange={setTagPopoverOpen} open={tagPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors"
                    type="button"
                  >
                    <TagIcon className="size-3.5" />
                    {selectedTags.length > 0 ? (
                      <span>{selectedTags.map((t) => t.name).join(", ")}</span>
                    ) : (
                      "Tags"
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-52 p-2">
                  <Input
                    autoFocus
                    className="h-7 text-xs mb-2"
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="Search or create tag…"
                    value={tagSearch}
                  />
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {filteredTags.map((t) => {
                      const selected = tagIds.includes(t.id);
                      return (
                        <button
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                          key={t.id}
                          onClick={() =>
                            setTagIds((prev) =>
                              selected
                                ? prev.filter((id) => id !== t.id)
                                : [...prev, t.id]
                            )
                          }
                          type="button"
                        >
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: t.color }}
                          />
                          <span className="flex-1 truncate text-left text-xs">
                            {t.name}
                          </span>
                          {selected && (
                            <CheckIcon className="size-3.5 text-primary shrink-0" />
                          )}
                        </button>
                      );
                    })}
                    {tagSearch && !exactTagMatch && (
                      <button
                        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-primary hover:bg-base-200"
                        onClick={async () => {
                          const res = await createTag(
                            workspaceId,
                            tagSearch.trim()
                          );
                          if ("tag" in res) {
                            setAllTags((prev) => [...prev, res.tag]);
                            setTagIds((prev) => [...prev, res.tag.id]);
                            setTagSearch("");
                          }
                        }}
                        type="button"
                      >
                        <PlusIcon className="size-3.5" />
                        Create &ldquo;{tagSearch}&rdquo;
                      </button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end border-t px-6 py-3 bg-base-200/30 shrink-0">
            <Button
              className="h-8 text-sm"
              disabled={loading || !title.trim()}
              onClick={handleSubmit}
              variant="default"
            >
              {loading ? "Creating…" : "Create Task"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ManageStatusesDialog
        listId={listId}
        onOpenChange={setManageStatusesOpen}
        onSaved={(updated) => {
          setLocalStatuses(updated);
          if (!updated.find((s) => s.id === statusId)) {
            setStatusId(updated[0]?.id ?? "");
          }
        }}
        open={manageStatusesOpen}
        spaceId={spaceId}
        workspaceId={workspaceId}
      />
    </>
  );
}
