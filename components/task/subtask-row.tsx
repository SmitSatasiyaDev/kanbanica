"use client";

import {
  CalendarBlankIcon,
  CaretRightIcon,
  CheckIcon,
  TrashIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import * as React from "react";
import { toast } from "sonner";
import { updateTask, updateTaskStatus } from "@/app/actions/task";
import { addAssignee, removeAssignee } from "@/app/actions/task-assignee";
import { useToday } from "@/components/common/timezone-provider";
import { UserAvatar } from "@/components/common/user-avatar";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateStrToLocalDate, dateToDay, toDay } from "@/lib/due-date";
import { cn } from "@/lib/utils";

type StatusType = "OPEN" | "ACTIVE" | "CLOSED";

interface Assignee {
  email: string | null;
  image: string | null;
  name: string | null;
  userId: string | null;
}

export interface SubtaskRowData {
  assignees: Assignee[];
  dueDateEnd: string | null;
  dueDateStart: string | null;
  id: string;
  listId: string | null;
  seqNumber: number;
  statusColor: string | null;
  statusId: string | null;
  statusName: string | null;
  statusType: StatusType | null;
  title: string;
}

interface Member {
  email: string | null;
  image: string | null;
  name: string | null;
  userId: string;
}

interface SubtaskRowProps {
  canEdit: boolean;
  members: Member[];
  onChanged: () => void;
  onDelete: () => void;
  onNavigate: () => void;
  /** The parent task's list — statuses come from here; used as the action list. */
  parentListId: string | null;
  spaceId: string;
  statuses: { id: string; name: string; color: string; type: StatusType }[];
  subtask: SubtaskRowData;
  workspaceId: string;
}

const STATUS_GROUPS: { type: StatusType; label: string }[] = [
  { type: "OPEN", label: "Not started" },
  { type: "ACTIVE", label: "Active" },
  { type: "CLOSED", label: "Closed" },
];

// Stored due dates are `YYYY-MM-DD` days; local state holds their local-midnight Date.
function toDate(v: string | null): Date | null {
  const day = toDay(v);
  return day ? dateStrToLocalDate(day) : null;
}

export function SubtaskRow({
  subtask,
  workspaceId,
  spaceId,
  parentListId,
  statuses,
  members,
  canEdit,
  onChanged,
  onDelete,
  onNavigate,
}: SubtaskRowProps) {
  const listId = subtask.listId ?? parentListId ?? "";

  // Optimistic local state so edits feel instant; re-synced from props on reload.
  const [statusId, setStatusId] = React.useState(subtask.statusId);
  const [assignees, setAssignees] = React.useState<Assignee[]>(
    subtask.assignees
  );
  const [dueStart, setDueStart] = React.useState<Date | null>(
    toDate(subtask.dueDateStart)
  );
  const [dueEnd, setDueEnd] = React.useState<Date | null>(
    toDate(subtask.dueDateEnd)
  );

  React.useEffect(() => {
    setStatusId(subtask.statusId);
    setAssignees(subtask.assignees);
    setDueStart(toDate(subtask.dueDateStart));
    setDueEnd(toDate(subtask.dueDateEnd));
  }, [subtask]);

  const [statusOpen, setStatusOpen] = React.useState(false);
  const [assigneeOpen, setAssigneeOpen] = React.useState(false);
  const [dueOpen, setDueOpen] = React.useState(false);
  const [memberSearch, setMemberSearch] = React.useState("");

  const currentStatus =
    statuses.find((s) => s.id === statusId) ??
    (subtask.statusColor
      ? {
          color: subtask.statusColor,
          name: subtask.statusName ?? "Status",
          type: subtask.statusType,
        }
      : null);
  const isClosed =
    (statuses.find((s) => s.id === statusId)?.type ?? subtask.statusType) ===
    "CLOSED";
  const today = useToday();
  const overdue = !!dueEnd && !isClosed && dateToDay(dueEnd) < today;

  async function chooseStatus(s: { id: string }) {
    setStatusOpen(false);
    if (s.id === statusId) {
      return;
    }
    const prev = statusId;
    setStatusId(s.id);
    const res = await updateTaskStatus(
      workspaceId,
      spaceId,
      listId,
      subtask.id,
      s.id
    );
    if (res && typeof res === "object" && "error" in res) {
      setStatusId(prev);
      toast.error(res.error as string);
      return;
    }
    onChanged();
  }

  async function toggleAssignee(m: Member) {
    const assigned = assignees.some((a) => a.userId === m.userId);
    const prev = assignees;
    setAssignees(
      assigned
        ? assignees.filter((a) => a.userId !== m.userId)
        : [
            ...assignees,
            { userId: m.userId, name: m.name, email: m.email, image: m.image },
          ]
    );
    const res = assigned
      ? await removeAssignee(workspaceId, spaceId, listId, subtask.id, m.userId)
      : await addAssignee(workspaceId, spaceId, listId, subtask.id, m.userId);
    if (res && typeof res === "object" && "error" in res) {
      setAssignees(prev);
      toast.error(res.error as string);
      return;
    }
    onChanged();
  }

  async function setDueDate(date: Date | null) {
    setDueOpen(false);
    const day = date ? dateToDay(date) : null;
    const patch =
      dueStart && date
        ? { dueDateEnd: day }
        : { dueDateStart: day, dueDateEnd: day };
    setDueEnd(date);
    if (date && !dueStart) {
      setDueStart(date);
    }
    if (!date) {
      setDueStart(null);
    }
    const res = await updateTask(
      workspaceId,
      spaceId,
      listId,
      subtask.id,
      patch
    );
    if (res && typeof res === "object" && "error" in res) {
      toast.error(res.error as string);
      return;
    }
    onChanged();
  }

  const filteredMembers = members.filter((m) =>
    (m.name ?? m.email ?? "").toLowerCase().includes(memberSearch.toLowerCase())
  );
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    // biome-ignore lint/a11y/useSemanticElements: row navigates on click, but wraps several nested buttons (status/due/assignee/delete) so it can't itself become a <button> — role="button" + tabIndex/onKeyDown provide the same keyboard semantics
    <div
      className="group flex items-center gap-2 rounded-md border bg-elevated px-3 py-2 hover:bg-base-200/30 cursor-pointer"
      onClick={onNavigate}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {/* Status — click the dot to change */}
      <Popover onOpenChange={setStatusOpen} open={statusOpen}>
        <PopoverTrigger asChild disabled={!canEdit}>
          <button
            className="flex size-5 shrink-0 items-center justify-center rounded-full hover:ring-2 hover:ring-border disabled:cursor-default"
            onClick={stop}
            title={currentStatus?.name ?? "Status"}
            type="button"
          >
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: currentStatus?.color ?? "#9CA3AF" }}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-52 p-1" onClick={stop}>
          <div className="max-h-64 overflow-y-auto">
            {STATUS_GROUPS.map(({ type, label }) => {
              const group = statuses.filter((s) => s.type === type);
              if (group.length === 0) {
                return null;
              }
              return (
                <div key={type}>
                  <p className="px-2 pt-2 pb-0.5 text-2xs font-semibold uppercase tracking-wider text-base-content/60">
                    {label}
                  </p>
                  {group.map((s) => (
                    <button
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                      key={s.id}
                      onClick={() => chooseStatus(s)}
                      type="button"
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="flex-1 truncate text-left">
                        {s.name}
                      </span>
                      {s.id === statusId && (
                        <CheckIcon className="size-3.5 shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <span className="shrink-0 font-mono text-xs text-base-content/60">
        #{subtask.seqNumber}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          isClosed && "text-base-content/60 line-through"
        )}
      >
        {subtask.title}
      </span>

      {/* Due date */}
      <Popover onOpenChange={setDueOpen} open={dueOpen}>
        <PopoverTrigger asChild disabled={!canEdit}>
          <button
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-base-200 disabled:cursor-default",
              dueEnd
                ? overdue
                  ? "text-red-500"
                  : "text-base-content"
                : "text-base-content/60 opacity-0 group-hover:opacity-100"
            )}
            onClick={stop}
            title="Due date"
            type="button"
          >
            <CalendarBlankIcon className="size-3.5" />
            {dueEnd && <span>{format(dueEnd, "MMM d")}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0" onClick={stop}>
          <Calendar
            mode="single"
            onSelect={(d) => setDueDate(d ?? null)}
            selected={dueEnd ?? undefined}
          />
          {dueEnd && (
            <button
              className="w-full border-t px-3 py-2 text-left text-xs text-base-content/60 hover:text-error transition-colors"
              onClick={() => setDueDate(null)}
              type="button"
            >
              Clear due date
            </button>
          )}
        </PopoverContent>
      </Popover>

      {/* Assignees */}
      <Popover onOpenChange={setAssigneeOpen} open={assigneeOpen}>
        <PopoverTrigger asChild disabled={!canEdit}>
          <button
            className={cn(
              "flex shrink-0 items-center rounded-md transition-colors hover:bg-base-200 disabled:cursor-default",
              assignees.length === 0 &&
                "size-6 justify-center text-base-content/60 opacity-0 group-hover:opacity-100"
            )}
            onClick={stop}
            title="Assignees"
            type="button"
          >
            {assignees.length === 0 ? (
              <UserPlusIcon className="size-4" />
            ) : (
              <span className="flex -space-x-1.5">
                {assignees.slice(0, 3).map((a) => (
                  <UserAvatar
                    className="ring-2 ring-elevated"
                    email={a.email}
                    image={a.image}
                    key={a.userId}
                    name={a.name}
                    size="xs"
                  />
                ))}
                {assignees.length > 3 && (
                  <span className="flex size-5 items-center justify-center rounded-full bg-base-200 text-2xs font-medium text-base-content/60 ring-2 ring-elevated">
                    +{assignees.length - 3}
                  </span>
                )}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-2" onClick={stop}>
          <Input
            autoFocus
            className="mb-2 h-7 text-xs"
            onChange={(e) => setMemberSearch(e.target.value)}
            placeholder="Search members…"
            value={memberSearch}
          />
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {filteredMembers.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-base-content/60">
                No members
              </p>
            )}
            {filteredMembers.map((m) => {
              const selected = assignees.some((a) => a.userId === m.userId);
              return (
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                  key={m.userId}
                  onClick={() => toggleAssignee(m)}
                  type="button"
                >
                  <UserAvatar
                    email={m.email}
                    image={m.image}
                    name={m.name}
                    size="sm"
                  />
                  <span className="flex-1 truncate text-left">
                    {m.name ?? m.email}
                  </span>
                  {selected && (
                    <CheckIcon className="size-3.5 shrink-0 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {canEdit && (
        <button
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-base-content/60 opacity-0 transition-colors hover:bg-error/10 hover:text-error group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete subtask"
          type="button"
        >
          <TrashIcon className="size-3.5" />
        </button>
      )}
      <CaretRightIcon className="size-3.5 shrink-0 text-base-content/60 opacity-0 group-hover:opacity-100" />
    </div>
  );
}
