"use client";

import {
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  FlagIcon,
  SquaresFourIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import {
  getMyTasks,
  type MyTask,
  type MyTasksGroupBy,
} from "@/app/actions/my-tasks";
import type { MyFocusKind } from "@/app/actions/workspace-overview";
import { SpaceIcon } from "@/components/common/space-icon";
import { useToday } from "@/components/common/timezone-provider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDay, toDay, weekRange } from "@/lib/due-date";
import { setTaskNavContext, type TaskNavContext } from "@/lib/task-nav-context";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MyTasksViewProps {
  workspaceId: string;
}

interface Group {
  accent?: string;
  icon?: React.ReactNode;
  key: string;
  label: string;
  tasks: MyTask[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  URGENT: { label: "Urgent", color: "text-red-500", icon: "🚨" },
  HIGH: { label: "High", color: "text-orange-500", icon: "🏃" },
  MEDIUM: { label: "Medium", color: "text-yellow-500", icon: "🚶" },
  LOW: { label: "Low", color: "text-blue-500", icon: "🦥" },
  NONE: { label: "—", color: "text-base-content/40", icon: "😴" },
} as const;

function formatDue(
  task: MyTask,
  today: string
): { label: string; overdue: boolean } | null {
  const day = toDay(task.dueDateEnd ?? task.dueDateStart);
  if (!day) {
    return null;
  }
  if (day === today) {
    return { label: "Today", overdue: false };
  }
  return {
    label: formatDay(day),
    overdue: day < today && task.status.type !== "CLOSED",
  };
}

// Narrows the list to one bucket from the Workspace Overview "My Focus
// Today" widget, reached via `?focus=` — the same four buckets that widget
// computes server-side (`getWorkspaceMyFocusTasks`), recomputed here
// client-side over the already-fetched My Tasks list. "assigned" needs no
// extra filtering — every task in this view is already assigned to the
// current user.
const FOCUS_LABELS: Record<MyFocusKind, string> = {
  overdue: "Overdue Tasks",
  dueToday: "Due Today",
  review: "Waiting for Review",
  assigned: "Assigned to Me",
};

function isReviewStatus(statusName: string): boolean {
  return statusName.trim().toLowerCase() === "review";
}

function parseFocusParam(value: string | null): MyFocusKind | null {
  return value === "overdue" ||
    value === "dueToday" ||
    value === "review" ||
    value === "assigned"
    ? value
    : null;
}

function applyFocusFilter(
  tasks: MyTask[],
  focus: MyFocusKind | null,
  today: string
): MyTask[] {
  if (!focus || focus === "assigned") {
    return tasks;
  }
  if (focus === "review") {
    return tasks.filter((t) => isReviewStatus(t.status.name));
  }
  return tasks.filter((t) => {
    if (t.status.type === "CLOSED") {
      return false;
    }
    const due = toDay(t.dueDateEnd ?? t.dueDateStart);
    if (!due) {
      return false;
    }
    return focus === "overdue" ? due < today : due === today;
  });
}

function groupByDueDate(tasks: MyTask[], today: string): Group[] {
  const week = weekRange(today, 1);

  const overdue: MyTask[] = [];
  const dueToday: MyTask[] = [];
  const thisWeek: MyTask[] = [];
  const upcoming: MyTask[] = [];
  const noDate: MyTask[] = [];

  for (const t of tasks) {
    const date = t.dueDateEnd ?? t.dueDateStart;
    if (!date) {
      noDate.push(t);
      continue;
    }
    const d = toDay(date) ?? today;
    if (d < today) {
      overdue.push(t);
      continue;
    }
    if (d === today) {
      dueToday.push(t);
      continue;
    }
    if (d >= week.from && d <= week.to) {
      thisWeek.push(t);
      continue;
    }
    upcoming.push(t);
  }

  return [
    {
      key: "overdue",
      label: "Overdue",
      icon: <WarningIcon className="size-3.5 text-red-500" />,
      tasks: overdue,
      accent: "text-red-500",
    },
    {
      key: "today",
      label: "Due Today",
      icon: <ClockIcon className="size-3.5 text-orange-500" />,
      tasks: dueToday,
      accent: "text-orange-500",
    },
    {
      key: "thisWeek",
      label: "Due This Week",
      icon: <CalendarBlankIcon className="size-3.5 text-blue-500" />,
      tasks: thisWeek,
      accent: "text-blue-500",
    },
    {
      key: "upcoming",
      label: "Upcoming",
      icon: <CalendarBlankIcon className="size-3.5 text-base-content/60" />,
      tasks: upcoming,
    },
    {
      key: "noDate",
      label: "No Due Date",
      icon: <CalendarBlankIcon className="size-3.5 text-base-content/40" />,
      tasks: noDate,
    },
  ].filter((g) => g.tasks.length > 0);
}

function groupByWorkspace(tasks: MyTask[]): Group[] {
  const map = new Map<string, { label: string; tasks: MyTask[] }>();
  for (const t of tasks) {
    const existing = map.get(t.workspace.id);
    if (existing) {
      existing.tasks.push(t);
    } else {
      map.set(t.workspace.id, { label: t.workspace.name, tasks: [t] });
    }
  }
  return Array.from(map.values()).map((g, i) => ({
    key: `ws-${i}`,
    label: g.label,
    tasks: g.tasks,
  }));
}

function groupBySpace(tasks: MyTask[]): Group[] {
  const map = new Map<
    string,
    {
      label: string;
      color: string | null;
      logoEmoji: string | null;
      tasks: MyTask[];
    }
  >();
  for (const t of tasks) {
    const existing = map.get(t.space.id);
    if (existing) {
      existing.tasks.push(t);
    } else {
      map.set(t.space.id, {
        label: t.space.name,
        color: t.space.color,
        logoEmoji: t.space.logoEmoji,
        tasks: [t],
      });
    }
  }
  return Array.from(map.values()).map((g, i) => ({
    key: `space-${i}`,
    label: g.label,
    icon: <SpaceIcon color={g.color} emoji={g.logoEmoji} size="sm" />,
    tasks: g.tasks,
  }));
}

function groupByList(tasks: MyTask[]): Group[] {
  const map = new Map<
    string,
    { space: string; label: string; tasks: MyTask[] }
  >();
  for (const t of tasks) {
    const existing = map.get(t.list.id);
    if (existing) {
      existing.tasks.push(t);
    } else {
      map.set(t.list.id, {
        space: t.space.name,
        label: t.list.name,
        tasks: [t],
      });
    }
  }
  return Array.from(map.values()).map((g, i) => ({
    key: `list-${i}`,
    label: `${g.space} › ${g.label}`,
    tasks: g.tasks,
  }));
}

function groupByPriority(tasks: MyTask[]): Group[] {
  const order: MyTask["priority"][] = [
    "URGENT",
    "HIGH",
    "MEDIUM",
    "LOW",
    "NONE",
  ];
  const map = new Map<string, MyTask[]>();
  for (const p of order) {
    map.set(p, []);
  }
  for (const t of tasks) {
    map.get(t.priority)?.push(t);
  }
  return order
    .filter((p) => (map.get(p)?.length ?? 0) > 0)
    .map((p) => {
      const cfg = PRIORITY_CONFIG[p];
      return {
        key: p,
        label: cfg.label,
        icon: <span className="mr-1">{cfg.icon}</span>,
        tasks: map.get(p) ?? [],
      };
    });
}

function groupByStatus(tasks: MyTask[]): Group[] {
  const map = new Map<
    string,
    { label: string; color: string; tasks: MyTask[] }
  >();
  for (const t of tasks) {
    const existing = map.get(t.status.id);
    if (existing) {
      existing.tasks.push(t);
    } else {
      map.set(t.status.id, {
        label: t.status.name,
        color: t.status.color,
        tasks: [t],
      });
    }
  }
  return Array.from(map.values()).map((g, i) => ({
    key: `status-${i}`,
    label: g.label,
    tasks: g.tasks,
  }));
}

function buildGroups(
  tasks: MyTask[],
  groupBy: MyTasksGroupBy,
  today: string
): Group[] {
  switch (groupBy) {
    case "due_date":
      return groupByDueDate(tasks, today);
    case "workspace":
      return groupByWorkspace(tasks);
    case "space":
      return groupBySpace(tasks);
    case "list":
      return groupByList(tasks);
    case "priority":
      return groupByPriority(tasks);
    case "status":
      return groupByStatus(tasks);
  }
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({ task, taskNav }: { task: MyTask; taskNav: TaskNavContext }) {
  const router = useRouter();
  const priority = PRIORITY_CONFIG[task.priority];
  const today = useToday();
  const due = formatDue(task, today);
  const titleRef = React.useRef<HTMLSpanElement>(null);
  const [titleTruncated, setTitleTruncated] = React.useState(false);

  // Only offer the hover tooltip when the title is actually clipped —
  // comparing scrollWidth (full content width) against clientWidth (visible
  // width) is the standard way to detect that. Re-checked on window resize
  // since the fixed-width Task column's available space changes with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: task.title drives a DOM re-measure, not read directly in the body
  React.useEffect(() => {
    function checkTruncation() {
      const el = titleRef.current;
      setTitleTruncated(!!el && el.scrollWidth > el.clientWidth);
    }
    checkTruncation();
    window.addEventListener("resize", checkTruncation);
    return () => window.removeEventListener("resize", checkTruncation);
  }, [task.title]);

  return (
    <tr
      className="group/row border-b border-base-300/40 hover:bg-base-200/30 cursor-pointer transition-colors"
      onClick={() => {
        setTaskNavContext(taskNav);
        router.push(`/${task.workspace.id}/task/${task.id}`);
      }}
    >
      {/* Title + breadcrumb — max-w-xl caps how wide the text gets even on
          very wide screens, so titles ellipsize at a consistent length
          instead of stretching to fill however much space table-fixed
          happens to leave for this column. min-w-0 has to cascade through
          every flex ancestor down to the truncating spans, or their default
          flex-item min-width:auto keeps them at their full intrinsic width
          and the ellipsis never engages. */}
      <td className="py-2.5 pl-10 pr-4">
        <div className="flex min-w-0 max-w-xl flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-xs text-base-content/50 font-mono shrink-0 w-6">
              #{task.seqNumber}
            </span>
            {titleTruncated ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="min-w-0 flex-1 truncate text-[15px] font-medium"
                      ref={titleRef}
                    >
                      {task.title}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm" side="top">
                    <p>{task.title}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-[15px] font-medium"
                ref={titleRef}
              >
                {task.title}
              </span>
            )}
          </div>
          <span className="pl-8 text-xs text-base-content/60 truncate">
            <span className="font-medium text-base-content/80">
              {task.workspace.name}
            </span>
            {" › "}
            {task.space.name} › {task.list.name}
          </span>
        </div>
      </td>

      {/* Status */}
      <td className="py-2.5 px-4 w-32">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: `${task.status.color}18`,
            color: task.status.color,
          }}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: task.status.color }}
          />
          {task.status.name}
        </span>
      </td>

      {/* Due date */}
      <td className="py-2.5 px-4 w-28">
        {due ? (
          <span
            className={cn(
              "text-sm font-medium",
              due.overdue ? "text-red-500" : "text-base-content/60"
            )}
          >
            {due.label}
          </span>
        ) : (
          <CalendarBlankIcon className="size-4 text-base-content/30" />
        )}
      </td>

      {/* Priority */}
      <td className="py-2.5 px-4 w-28">
        {task.priority === "NONE" ? (
          <FlagIcon className="size-4 text-base-content/30" />
        ) : (
          <span
            className={cn(
              "flex items-center gap-1 text-sm font-medium",
              priority.color
            )}
          >
            <span>{priority.icon}</span>
            {priority.label}
          </span>
        )}
      </td>
    </tr>
  );
}

// ─── Task group ───────────────────────────────────────────────────────────────

function TaskGroup({
  group,
  taskNav,
}: {
  group: Group;
  taskNav: TaskNavContext;
}) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <>
      <tr className="bg-base-200/20">
        <td className="py-2 pl-4 pr-3" colSpan={4}>
          <button
            className="flex items-center gap-2 select-none"
            onClick={() => setCollapsed((v) => !v)}
            type="button"
          >
            {collapsed ? (
              <CaretRightIcon className="size-3.5 text-base-content/60 shrink-0" />
            ) : (
              <CaretDownIcon className="size-3.5 text-base-content/60 shrink-0" />
            )}
            {group.icon}
            <span className={cn("text-sm font-semibold", group.accent)}>
              {group.label}
            </span>
            <span className="text-xs text-base-content/60 tabular-nums">
              {group.tasks.length}
            </span>
          </button>
        </td>
      </tr>
      {!collapsed &&
        group.tasks.map((t) => (
          <TaskRow key={t.id} task={t} taskNav={taskNav} />
        ))}
    </>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS: { value: MyTasksGroupBy; label: string }[] = [
  { value: "due_date", label: "Due Date" },
  { value: "workspace", label: "Workspace" },
  { value: "space", label: "Space" },
  { value: "list", label: "List" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
];

export function MyTasksView(_props: MyTasksViewProps) {
  const [tasks, setTasks] = React.useState<MyTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [groupBy, setGroupBy] = React.useState<MyTasksGroupBy>("due_date");
  const [showCompleted, _setShowCompleted] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focus = parseFocusParam(searchParams.get("focus"));
  const today = useToday();

  const fetchTasks = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyTasks({ showCompleted });
      if ("error" in res) {
        return;
      }
      setTasks(res.tasks);
    } finally {
      setLoading(false);
    }
  }, [showCompleted]);

  React.useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const filtered = search.trim()
    ? tasks.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
    : tasks;
  const focused = applyFocusFilter(filtered, focus, today);

  const groups = buildGroups(focused, groupBy, today);

  // Previous/Next Task nav context: My Tasks is cross-workspace, so each
  // task's own workspace travels alongside its id — handed to Task Detail
  // so Prev/Next walks this same order without a DB query.
  const taskNav = React.useMemo<TaskNavContext>(() => {
    const taskIds: string[] = [];
    const workspaceByTaskId: Record<string, string> = {};
    for (const group of groups) {
      for (const t of group.tasks) {
        taskIds.push(t.id);
        workspaceByTaskId[t.id] = t.workspace.id;
      }
    }
    return { taskIds, workspaceByTaskId };
  }, [groups]);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-y-1.5 gap-x-3">
        <div className="flex items-center gap-2">
          <CheckCircleIcon className="size-5 text-primary" weight="fill" />
          <h1 className="text-lg font-semibold">My Tasks</h1>
        </div>
        <span className="text-sm text-base-content/60 tabular-nums">
          {loading
            ? "…"
            : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
        </span>
        {focus && (
          <button
            className="flex items-center gap-1.5 rounded-full bg-base-200 px-2.5 py-1 text-xs font-medium text-base-content hover:bg-base-200/70 transition-colors cursor-pointer"
            onClick={() => router.replace(pathname)}
            type="button"
          >
            Focused: {FOCUS_LABELS[focus]}
            <XIcon className="size-3" />
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <SearchInput
          className="w-48 focus:w-64"
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="Search tasks…"
          value={search}
        />

        {/* Group by */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="flex items-center gap-1.5 h-8 rounded-lg border border-base-300 px-3 text-xs font-semibold text-base-content/70 hover:bg-base-200/30 transition-colors cursor-pointer select-none"
              type="button"
            >
              <SquaresFourIcon className="size-3.5 text-gray-500" />
              Group By:{" "}
              {GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-44 p-1 flex flex-col gap-0.5"
          >
            {GROUP_BY_OPTIONS.map((o) => (
              <button
                className={cn(
                  "px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-base-200/30 cursor-pointer",
                  groupBy === o.value && "bg-base-200 text-base-content"
                )}
                key={o.value}
                onClick={() => setGroupBy(o.value)}
                type="button"
              >
                {o.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Show completed */}
        {/* <button
          onClick={() => setShowCompleted((v) => !v)}
          className={cn(
            "h-8 rounded-md border px-3 text-xs font-medium transition-colors",
            showCompleted
              ? "bg-primary text-primary-content border-primary"
              : "bg-base-100 text-base-content/60 hover:text-base-content",
          )}
        >
          {showCompleted ? "Hide Completed" : "Show Completed"}
        </button> */}
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-xl border bg-elevated overflow-hidden animate-pulse">
          <div className="h-10 bg-base-200/40 border-b" />
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div className="h-10 rounded bg-base-200" key={i} />
            ))}
          </div>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border bg-elevated flex flex-col items-center gap-3 py-20 text-center">
          <CheckCircleIcon
            className="size-10 text-base-content/20"
            weight="fill"
          />
          <p className="text-sm font-medium text-base-content/60">
            {search
              ? "No tasks match your search"
              : focus
                ? `No tasks in "${FOCUS_LABELS[focus]}"`
                : showCompleted
                  ? "No tasks assigned to you"
                  : "You're all caught up!"}
          </p>
          {!showCompleted && tasks.length === 0 && (
            <p className="text-xs text-base-content/60">
              Tasks assigned to you will appear here
            </p>
          )}
          {!showCompleted &&
            tasks.length > 0 &&
            filtered.length === 0 &&
            search && (
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => setSearch("")}
                type="button"
              >
                Clear search
              </button>
            )}
        </div>
      ) : (
        <div className="rounded-xl border bg-elevated overflow-hidden">
          {/* Horizontal scroll on narrow viewports — the table below keeps a
              min-width so its fixed Status/Due Date/Priority columns stay
              legible instead of getting squeezed; wide/desktop containers
              are unaffected since they already exceed that min-width. */}
          <div className="overflow-x-auto">
            {/* table-fixed is what makes the explicit column widths below
                actually binding — without it, a long unbroken task title can
                force the Task column (and the whole table) wider than its
                container, pushing Status/Due Date/Priority out of alignment. */}
            <table className="w-full min-w-[640px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-base-300/60 bg-base-200/20">
                  <th className="py-2 pl-10 pr-4 text-left text-sm font-semibold text-base-content/60">
                    Task
                  </th>
                  <th className="py-2 px-4 text-left text-sm font-semibold text-base-content/60 w-32">
                    Status
                  </th>
                  <th className="py-2 px-4 text-left text-sm font-semibold text-base-content/60 w-28">
                    Due Date
                  </th>
                  <th className="py-2 px-4 text-left text-sm font-semibold text-base-content/60 w-28">
                    Priority
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group, i) => (
                  <React.Fragment key={group.key}>
                    {i > 0 && (
                      <tr aria-hidden>
                        <td
                          className="h-2 bg-transparent border-none"
                          colSpan={4}
                        />
                      </tr>
                    )}
                    <TaskGroup group={group} taskNav={taskNav} />
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
