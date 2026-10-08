import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type {
  ChecklistPriority,
  ChecklistStatus,
} from "@/lib/daily-checklist/constants";
import { STATUS_LABEL } from "@/lib/daily-checklist/constants";
import type { DayStatus } from "@/lib/daily-checklist/progress";
import { PRIORITY_CONFIG } from "@/lib/priority-config";
import { cn } from "@/lib/utils";

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "October 7, 2026" — built from the stored calendar date, never via UTC. */
export function formatLongDate(date: string) {
  return parts(date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDate(date: string) {
  return parts(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function shiftDate(date: string, days: number) {
  const d = parts(date);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function PriorityTag({ priority }: { priority: ChecklistPriority }) {
  if (priority === "NONE") {
    return null;
  }
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        cfg.color
      )}
    >
      <span aria-hidden>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

/** Status is conveyed with an icon AND a text label — never colour alone. */
export function StatusLabel({ status }: { status: ChecklistStatus }) {
  const Icon =
    status === "DONE"
      ? CheckCircleIcon
      : status === "IN_PROGRESS"
        ? CircleHalfIcon
        : CircleDashedIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        status === "DONE"
          ? "text-success"
          : status === "IN_PROGRESS"
            ? "text-warning"
            : "text-base-content/60"
      )}
    >
      <Icon
        aria-hidden
        className="size-4 shrink-0"
        weight={status === "PENDING" ? "regular" : "fill"}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  EMPTY: "No items",
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
};

export function DayStatusLabel({ status }: { status: DayStatus }) {
  const s: ChecklistStatus =
    status === "COMPLETE"
      ? "DONE"
      : status === "IN_PROGRESS"
        ? "IN_PROGRESS"
        : "PENDING";
  const Icon =
    s === "DONE"
      ? CheckCircleIcon
      : s === "IN_PROGRESS"
        ? CircleHalfIcon
        : CircleDashedIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        s === "DONE"
          ? "text-success"
          : s === "IN_PROGRESS"
            ? "text-warning"
            : "text-base-content/60"
      )}
    >
      <Icon
        aria-hidden
        className="size-4 shrink-0"
        weight={s === "PENDING" ? "regular" : "fill"}
      />
      {DAY_STATUS_LABEL[status]}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-base-300 border-dashed px-6 py-12 text-center">
      <p className="font-medium text-sm">{title}</p>
      {description && (
        <p className="max-w-sm text-base-content/60 text-sm">{description}</p>
      )}
      {children}
    </div>
  );
}

/** "9:16 AM" in the given IANA timezone (null when there is no / an invalid timestamp). */
export function formatTimeIn(iso: string | null, timeZone?: string) {
  if (!iso) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || undefined,
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

const DAY_BADGE_LABEL: Record<DayStatus, string> = {
  COMPLETE: "Completed",
  IN_PROGRESS: "In Progress",
  NOT_STARTED: "Not Started",
  EMPTY: "No items",
};

/** The History status badge (pill), shared by History and Today. */
export function DayStatusBadge({
  status,
  overdue = false,
}: {
  overdue?: boolean;
  status: DayStatus;
}) {
  const tone =
    status === "COMPLETE"
      ? "bg-success/15 text-success"
      : status === "IN_PROGRESS"
        ? "bg-warning/20 text-warning"
        : "bg-base-200 text-base-content/70";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center rounded-md px-2 py-0.5 font-medium text-xs",
          tone
        )}
      >
        {DAY_BADGE_LABEL[status]}
      </span>
      {overdue && (
        <span className="inline-flex items-center gap-1 rounded-md bg-error/15 px-2 py-0.5 font-medium text-error text-xs">
          <WarningCircleIcon aria-hidden className="size-3" weight="fill" />
          Overdue
        </span>
      )}
    </span>
  );
}
