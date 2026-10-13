"use client";

import {
  CalendarBlankIcon,
  CircleHalfIcon,
  LightningIcon,
  TagIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import * as React from "react";
import { getSprints } from "@/app/actions/sprint";
import { getWorkspaceMembers } from "@/app/actions/task";
import { createTag, getWorkspaceTags } from "@/app/actions/task-tag";
import { UserAvatar } from "@/components/common/user-avatar";
import { FacetOptionList } from "@/components/filters/facet-filter";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateToDay } from "@/lib/due-date";
import { PRIORITY_CONFIG, type Priority } from "@/lib/priority-config";
import { cn } from "@/lib/utils";

// Optional metadata collected during inline task creation. All fields optional —
// an empty value creates a title-only task exactly like before.
export type QuickTaskMetaValue = {
  assigneeIds: string[];
  priority: Priority;
  dueDate: Date | null;
  tagIds: string[];
  sprintId: string | null;
  statusId: string | null;
};

export const EMPTY_QUICK_META: QuickTaskMetaValue = {
  assigneeIds: [],
  priority: "NONE",
  dueDate: null,
  tagIds: [],
  sprintId: null,
  statusId: null,
};

export function hasQuickMeta(m: QuickTaskMetaValue): boolean {
  return (
    m.assigneeIds.length > 0 ||
    m.priority !== "NONE" ||
    m.dueDate !== null ||
    m.tagIds.length > 0 ||
    m.sprintId !== null ||
    m.statusId !== null
  );
}

// The subset of createTask()'s `data` argument the quick metadata maps to.
// Sprint is applied separately (addTaskToSprint) — createTask takes no sprint.
export function quickMetaCreateFields(m: QuickTaskMetaValue) {
  return {
    ...(m.priority !== "NONE" && { priority: m.priority }),
    ...(m.dueDate && { dueDateEnd: dateToDay(m.dueDate) }),
    ...(m.assigneeIds.length > 0 && { assigneeIds: m.assigneeIds }),
    ...(m.tagIds.length > 0 && { tagIds: m.tagIds }),
    ...(m.statusId && { statusId: m.statusId }),
  };
}

type Status = { id: string; name: string; color: string };

function chipClass(active: boolean) {
  return cn(
    "flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
    active
      ? "border-primary/40 bg-primary/10 text-base-content"
      : "border-base-300 text-base-content/60 hover:bg-base-200 hover:text-base-content"
  );
}

export function QuickTaskMeta({
  workspaceId,
  spaceId,
  statuses,
  value,
  onChange,
}: {
  workspaceId: string;
  spaceId: string;
  statuses: Status[];
  value: QuickTaskMetaValue;
  onChange: (next: QuickTaskMetaValue) => void;
}) {
  const [members, setMembers] = React.useState<
    { userId: string; name: string; email: string; image: string | null }[]
  >([]);
  const [tags, setTags] = React.useState<
    { id: string; name: string; color: string }[]
  >([]);
  const [sprints, setSprints] = React.useState<{ id: string; name: string }[]>(
    []
  );
  const [showMore, setShowMore] = React.useState(false);

  // Lazy-load option data once when the quick-create form (and this bar) mounts,
  // reusing the same server actions the task detail uses.
  React.useEffect(() => {
    let active = true;
    void (async () => {
      const [m, t, s] = await Promise.all([
        getWorkspaceMembers(workspaceId),
        getWorkspaceTags(workspaceId),
        getSprints(workspaceId, spaceId),
      ]);
      if (!active) {
        return;
      }
      if (m && "members" in m) {
        setMembers(
          (m.members ?? [])
            .filter((x): x is typeof x & { userId: string } => !!x.userId)
            .map((x) => ({
              userId: x.userId,
              name: x.name || x.email,
              email: x.email,
              image: x.image,
            }))
        );
      }
      if (t && "tags" in t) {
        setTags(t.tags ?? []);
      }
      if (s && "sprints" in s) {
        setSprints(
          (s.sprints ?? [])
            .filter((sp) => sp.status !== "CLOSED")
            .map((sp) => ({ id: sp.id, name: sp.name }))
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [workspaceId, spaceId]);

  const priorityCfg = PRIORITY_CONFIG[value.priority];
  const selectedSprint = sprints.find((s) => s.id === value.sprintId);
  const selectedStatus = statuses.find((s) => s.id === value.statusId);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Assignee */}
      <MetaChip
        active={value.assigneeIds.length > 0}
        icon={<UsersIcon className="size-3.5" />}
        label={
          value.assigneeIds.length > 0
            ? `${value.assigneeIds.length} assignee${value.assigneeIds.length === 1 ? "" : "s"}`
            : "Assignee"
        }
      >
        {() => (
          <FacetOptionList
            emptyText="No members"
            onChange={(next) => onChange({ ...value, assigneeIds: next })}
            options={members.map((m) => ({
              value: m.userId,
              label: m.name,
              icon: (
                <UserAvatar
                  email={m.email}
                  image={m.image}
                  name={m.name}
                  size="xs"
                />
              ),
            }))}
            searchable
            selected={value.assigneeIds}
          />
        )}
      </MetaChip>

      {/* Priority */}
      <MetaChip
        active={value.priority !== "NONE"}
        icon={
          <span aria-hidden>
            {value.priority === "NONE" ? "🚩" : priorityCfg.icon}
          </span>
        }
        label={value.priority === "NONE" ? "Priority" : priorityCfg.label}
      >
        {(close) => (
          <FacetOptionList
            onAfterToggle={close}
            onChange={(next) =>
              onChange({ ...value, priority: (next[0] as Priority) ?? "NONE" })
            }
            options={(
              Object.entries(PRIORITY_CONFIG) as [
                Priority,
                (typeof PRIORITY_CONFIG)[Priority],
              ][]
            ).map(([key, cfg]) => ({
              value: key,
              label: cfg.label,
              icon: <span aria-hidden>{cfg.icon}</span>,
            }))}
            selected={value.priority === "NONE" ? [] : [value.priority]}
            single
          />
        )}
      </MetaChip>

      {showMore ? (
        <>
          {/* Due date */}
          <Popover>
            <PopoverTrigger asChild>
              <button className={chipClass(!!value.dueDate)} type="button">
                <CalendarBlankIcon className="size-3.5" />
                {value.dueDate ? format(value.dueDate, "MMM d") : "Due date"}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                onSelect={(d) => onChange({ ...value, dueDate: d ?? null })}
                selected={value.dueDate ?? undefined}
              />
              {value.dueDate && (
                <div className="border-t p-2">
                  <Button
                    className="w-full text-xs"
                    onClick={() => onChange({ ...value, dueDate: null })}
                    size="sm"
                    variant="ghost"
                  >
                    Clear due date
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>

          {/* Tags */}
          <MetaChip
            active={value.tagIds.length > 0}
            icon={<TagIcon className="size-3.5" />}
            label={
              value.tagIds.length > 0
                ? `${value.tagIds.length} tag${value.tagIds.length === 1 ? "" : "s"}`
                : "Tags"
            }
          >
            {() => (
              <FacetOptionList
                emptyText="No tags"
                onChange={(next) => onChange({ ...value, tagIds: next })}
                onCreate={async (label) => {
                  const res = await createTag(workspaceId, label);
                  if ("tag" in res) {
                    setTags((prev) => [...prev, res.tag]);
                    onChange({
                      ...value,
                      tagIds: [...value.tagIds, res.tag.id],
                    });
                  }
                }}
                options={tags.map((t) => ({
                  value: t.id,
                  label: t.name,
                  color: t.color,
                }))}
                searchable
                selected={value.tagIds}
              />
            )}
          </MetaChip>

          {/* Sprint */}
          <MetaChip
            active={!!value.sprintId}
            icon={<LightningIcon className="size-3.5" />}
            label={selectedSprint?.name ?? "Sprint"}
          >
            {(close) => (
              <FacetOptionList
                emptyText="No sprints"
                onAfterToggle={close}
                onChange={(next) =>
                  onChange({ ...value, sprintId: next[0] ?? null })
                }
                options={sprints.map((s) => ({ value: s.id, label: s.name }))}
                selected={value.sprintId ? [value.sprintId] : []}
                single
              />
            )}
          </MetaChip>

          {/* Status */}
          {statuses.length > 0 && (
            <MetaChip
              active={!!value.statusId}
              icon={<CircleHalfIcon className="size-3.5" />}
              label={selectedStatus?.name ?? "Status"}
            >
              {(close) => (
                <FacetOptionList
                  onAfterToggle={close}
                  onChange={(next) =>
                    onChange({ ...value, statusId: next[0] ?? null })
                  }
                  options={statuses.map((s) => ({
                    value: s.id,
                    label: s.name,
                    color: s.color,
                  }))}
                  selected={value.statusId ? [value.statusId] : []}
                  single
                />
              )}
            </MetaChip>
          )}
        </>
      ) : (
        <button
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
          onClick={() => setShowMore(true)}
          type="button"
        >
          + More options
        </button>
      )}
    </div>
  );
}

// `children` is a render prop so a single-select list can close the popover the
// moment an option is picked (a task has exactly one priority/status/sprint, so
// there's nothing left to choose). Multi-select chips ignore the argument and
// stay open for further toggles.
function MetaChip({
  active,
  icon,
  label,
  children,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button className={chipClass(active)} type="button">
          {icon}
          <span className="max-w-32 truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 rounded-xl p-1">
        {children(close)}
      </PopoverContent>
    </Popover>
  );
}
