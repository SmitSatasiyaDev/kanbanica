"use client";

import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { UserAvatar } from "@/components/common/user-avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  groupTodayRows,
  type TodayTemplateGroup,
} from "@/lib/daily-checklist/today-group";
import type { TodayInstanceRow } from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { TodayMatrix } from "../history-inline";
import { DayStatusLabel, formatShortDate } from "../shared";

function Avatars({ users }: { users: TodayInstanceRow[] }) {
  return (
    <span className="-space-x-1.5 inline-flex shrink-0">
      {users.slice(0, 3).map((u) => (
        <UserAvatar
          className="ring-2 ring-base-100"
          email=""
          image={u.userImage}
          key={u.dayId}
          name={u.userName}
          size="xs"
        />
      ))}
    </span>
  );
}

function ParentProgress({ g }: { g: TodayTemplateGroup }) {
  if (g.users.length === 1) {
    const u = g.users[0];
    return (
      <span className="tabular-nums">
        {u.completed}/{u.total}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      <span data-testid="users-progress">
        {g.usersComplete}/{g.users.length} users complete
      </span>
      <span className="block text-base-content/60 text-xs">
        {g.itemsCompleted}/{g.itemsTotal} items
      </span>
    </span>
  );
}

/** Each user's items for one template today (members × items matrix, read-only). */
function GroupDetails({
  g,
  date,
  workspaceId,
}: {
  date: string;
  g: TodayTemplateGroup;
  workspaceId: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-base-300 bg-base-100"
      data-testid="today-users"
    >
      <TodayMatrix
        date={date}
        label={g.name ?? "Checklist"}
        users={g.users}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function ExpandToggle({
  g,
  open,
  onToggle,
}: {
  g: TodayTemplateGroup;
  onToggle: () => void;
  open: boolean;
}) {
  const Caret = open ? CaretUpIcon : CaretDownIcon;
  return (
    <button
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} users: ${g.name ?? "template"}`}
      className="inline-flex items-center gap-2 rounded-md py-0.5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={onToggle}
      type="button"
    >
      <Avatars users={g.users} />
      <span className="text-sm">{g.users.length} users</span>
      <Caret aria-hidden className="size-3 text-base-content/60" />
    </button>
  );
}

/** Template + date → one row; multi-user templates expand to list each user's progress (read-only, no detail popup). */
export function TodayGroups({
  rows,
  date,
  workspaceId,
}: {
  date: string;
  rows: TodayInstanceRow[];
  workspaceId: string;
}) {
  const groups = useMemo(() => groupTodayRows(rows, date), [rows, date]);
  // Details (each user's items) start expanded; the toggle collapses a template.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setCollapsed((p) => {
      const n = new Set(p);
      if (n.has(k)) {
        n.delete(k);
      } else {
        n.add(k);
      }
      return n;
    });

  return (
    <>
      {/* ≥ md: table */}
      <div className="hidden overflow-hidden rounded-xl border border-base-300 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.flatMap((g) => {
              const single = g.users.length === 1 ? g.users[0] : null;
              const expanded = !collapsed.has(g.key);
              const main = (
                <TableRow data-testid="today-group" key={g.key}>
                  <TableCell className="max-w-xs break-words font-medium">
                    {g.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    {single ? (
                      <span className="inline-flex items-center gap-2">
                        <UserAvatar
                          email=""
                          image={single.userImage}
                          name={single.userName}
                          size="xs"
                        />
                        {single.userName}
                      </span>
                    ) : (
                      <ExpandToggle
                        g={g}
                        onToggle={() => toggle(g.key)}
                        open={expanded}
                      />
                    )}
                  </TableCell>
                  <TableCell>{formatShortDate(date)}</TableCell>
                  <TableCell>
                    <ParentProgress g={g} />
                  </TableCell>
                  <TableCell>
                    <DayStatusLabel
                      status={single ? single.status : g.status}
                    />
                  </TableCell>
                </TableRow>
              );
              return expanded
                ? [
                    main,
                    <TableRow key={`${g.key}:users`}>
                      <TableCell className="bg-base-200/40" colSpan={5}>
                        <GroupDetails
                          date={date}
                          g={g}
                          workspaceId={workspaceId}
                        />
                      </TableCell>
                    </TableRow>,
                  ]
                : [main];
            })}
          </TableBody>
        </Table>
      </div>

      {/* < md: cards */}
      <ul className="space-y-2 md:hidden">
        {groups.map((g) => {
          const single = g.users.length === 1 ? g.users[0] : null;
          const expanded = !collapsed.has(g.key);
          return (
            <li
              className="space-y-2 rounded-xl border border-base-300 p-4"
              data-testid="today-group"
              key={g.key}
            >
              <p className="break-words font-medium text-sm">{g.name ?? "—"}</p>
              {single ? (
                <span className="inline-flex items-center gap-2 text-left text-sm">
                  <UserAvatar
                    email=""
                    image={single.userImage}
                    name={single.userName}
                    size="xs"
                  />
                  {single.userName}
                </span>
              ) : (
                <ExpandToggle
                  g={g}
                  onToggle={() => toggle(g.key)}
                  open={expanded}
                />
              )}
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                )}
              >
                <span className="text-base-content/60">
                  {formatShortDate(date)}
                </span>
                <span>·</span>
                <ParentProgress g={g} />
                <span>·</span>
                <DayStatusLabel status={single ? single.status : g.status} />
              </div>
              {!single && expanded && (
                <GroupDetails date={date} g={g} workspaceId={workspaceId} />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
