"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import * as React from "react";
import {
  type DashboardCategory,
  type DeadlineBucket,
  getWorkspaceMyFocusTasks,
  getWorkspaceTasksByAssignee,
  getWorkspaceTasksByDeadline,
  getWorkspaceTasksByPriority,
  getWorkspaceTasksByStatus,
  type MyFocusKind,
  type WorkspaceOverviewTaskRef,
} from "@/app/actions/workspace-overview";
import { useToday } from "@/components/common/timezone-provider";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { describeDeadline } from "@/lib/deadline-format";
import { PRIORITY_CONFIG, type Priority } from "@/lib/priority-config";

export type DrilldownRequest =
  | { kind: "status"; statusType: DashboardCategory }
  | { kind: "deadline"; bucket: DeadlineBucket }
  | { kind: "assignee"; userId: string }
  | { kind: "focus"; focusKind: MyFocusKind }
  | { kind: "priority"; priority: Priority };

// Text for the "View all …" footer link shown only for My Focus Today
// drill-downs — it hands off to the full My Tasks list (§ MyTasksView),
// pre-filtered via its `focus` search param, so a long result isn't stuck
// browsing a cramped side sheet.
const FOCUS_FOOTER_LABEL: Record<MyFocusKind, string> = {
  overdue: "overdue tasks",
  dueToday: "tasks due today",
  review: "tasks waiting for review",
  assigned: "tasks assigned to you",
};

interface TaskDrilldownSheetProps {
  label: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /**
   * What to fetch when the sheet opens. A plain descriptor rather than a
   * callback — callers pass their own React state value directly (stable
   * across re-renders unless they actually change the selection), so this
   * never triggers a refetch loop the way a fresh inline closure would.
   */
  request: DrilldownRequest | null;
  workspaceId: string;
}

function DrilldownRow({
  workspaceId,
  task,
}: {
  workspaceId: string;
  task: WorkspaceOverviewTaskRef;
}) {
  const cfg = PRIORITY_CONFIG[task.priority];
  const today = useToday();
  const deadline = task.dueDate ? describeDeadline(task.dueDate, today) : null;
  return (
    <Link
      className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-base-200/30 transition-colors"
      href={`/${workspaceId}/task/${task.id}`}
    >
      <span className="shrink-0">{cfg.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base-content/90">{task.title}</p>
        <p className="truncate text-sm text-base-content/60">
          {task.spaceName} · {task.listName}
        </p>
      </div>
      {deadline && (
        <span
          className={`shrink-0 text-sm tabular-nums ${deadline.overdue ? "text-error" : "text-base-content/60"}`}
        >
          {deadline.text}
        </span>
      )}
    </Link>
  );
}

export function TaskDrilldownSheet({
  workspaceId,
  open,
  onOpenChange,
  request,
  label,
}: TaskDrilldownSheetProps) {
  const [tasks, setTasks] = React.useState<WorkspaceOverviewTaskRef[] | null>(
    null
  );

  React.useEffect(() => {
    if (!open || !request) {
      return;
    }
    setTasks(null);
    const promise =
      request.kind === "status"
        ? getWorkspaceTasksByStatus(workspaceId, request.statusType)
        : request.kind === "deadline"
          ? getWorkspaceTasksByDeadline(workspaceId, request.bucket)
          : request.kind === "assignee"
            ? getWorkspaceTasksByAssignee(workspaceId, request.userId)
            : request.kind === "priority"
              ? getWorkspaceTasksByPriority(workspaceId, request.priority)
              : getWorkspaceMyFocusTasks(workspaceId, request.focusKind);
    void promise.then((res) => {
      setTasks("error" in res ? [] : res.tasks);
    });
  }, [open, request, workspaceId]);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="p-0">
        <SheetHeader className="border-b border-base-300 p-5">
          <SheetTitle className="normal-case text-lg font-semibold tracking-normal">
            {label} {tasks !== null && `(${tasks.length})`}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {tasks === null ? (
            <p className="py-10 text-center text-sm text-base-content/60">
              Loading…
            </p>
          ) : tasks.length === 0 ? (
            <p className="py-10 text-center text-sm text-base-content/60">
              No tasks here
            </p>
          ) : (
            tasks.map((t) => (
              <DrilldownRow key={t.id} task={t} workspaceId={workspaceId} />
            ))
          )}
        </div>
        {request?.kind === "focus" && tasks !== null && tasks.length > 0 && (
          <SheetFooter className="border-t border-base-300 p-3">
            <Link
              className="flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium text-primary hover:underline"
              href={`/${workspaceId}/my-tasks?focus=${request.focusKind}`}
              onClick={() => onOpenChange(false)}
            >
              View all {FOCUS_FOOTER_LABEL[request.focusKind]}
              <ArrowRightIcon className="size-3" />
            </Link>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
