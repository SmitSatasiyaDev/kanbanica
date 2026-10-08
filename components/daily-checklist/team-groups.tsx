"use client";

import {
  CaretDownIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHalfIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { UserAvatar } from "@/components/common/user-avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ChecklistStatus } from "@/lib/daily-checklist/constants";
import type { TeamGroup } from "@/lib/daily-checklist/team-aggregate";
import { noteCount } from "@/lib/daily-checklist/team-aggregate";
import type { TeamItemRow } from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { PriorityTag } from "./shared";
import {
  AggregateNoteButton,
  DetailsButton,
  DueLabel,
  FieldSummary,
  NoteButton,
  RowCheckbox,
} from "./team-row-parts";

interface Props {
  groups: TeamGroup[];
  onDetails: (rowId: string) => void;
  onNote: (rowId: string) => void;
  onStatus: (row: TeamItemRow, s: ChecklistStatus) => void;
}

const MORE = 3;

/** "Smit, Jayesh, Dev" — first 3 names on ≥sm, first 2 on mobile, then "+N". */
function AssigneeNames({ members }: { members: TeamItemRow[] }) {
  const names = members.map((m) =>
    m.editable ? `${m.assigneeName} (you)` : m.assigneeName
  );
  const rest3 = names.length - MORE;
  const rest2 = names.length - 2;
  return (
    <span className="min-w-0 break-words text-sm" data-testid="assignees">
      {names.map((n, i) => (
        <span
          className={i >= 2 ? "hidden sm:inline" : undefined}
          key={members[i].id}
        >
          {i > 0 && i < MORE && ", "}
          {i < MORE ? n : null}
        </span>
      ))}
      {rest2 > 0 && (
        <span className="text-base-content/60 sm:hidden"> +{rest2}</span>
      )}
      {rest3 > 0 && (
        <span className="hidden text-base-content/60 sm:inline"> +{rest3}</span>
      )}
    </span>
  );
}

function AvatarStack({ members }: { members: TeamItemRow[] }) {
  return (
    <span className="-space-x-1.5 inline-flex shrink-0">
      {members.slice(0, 3).map((m) => (
        <UserAvatar
          className="ring-2 ring-base-100"
          email=""
          image={m.assigneeImage}
          key={m.id}
          name={m.assigneeName}
          size="xs"
        />
      ))}
    </span>
  );
}

/** "1/3 Done" with the existing icon+text status treatment (green when everyone is done). */
function Progress({ g }: { g: TeamGroup }) {
  const Icon =
    g.status === "DONE"
      ? CheckCircleIcon
      : g.status === "IN_PROGRESS"
        ? CircleHalfIcon
        : CircleDashedIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium text-xs",
        g.status === "DONE"
          ? "text-success"
          : g.status === "IN_PROGRESS"
            ? "text-warning"
            : "text-base-content/60"
      )}
    >
      <Icon
        aria-hidden
        className="size-4 shrink-0"
        weight={g.status === "PENDING" ? "regular" : "fill"}
      />
      <span data-testid="group-progress">
        {g.completed}/{g.total} Done
      </span>
    </span>
  );
}

function MemberList({
  g,
  onDetails,
  onNote,
  onStatus,
}: Props & { g: TeamGroup }) {
  return (
    <ul
      aria-label={`Members for ${g.title}`}
      className="divide-y divide-base-300 rounded-xl border border-base-300 bg-base-100"
      data-testid="member-list"
    >
      {g.members.map((m) => (
        <li
          className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2"
          key={m.id}
        >
          <RowCheckbox onChange={(st) => onStatus(m, st)} row={m} />
          <span className="inline-flex min-w-32 items-center gap-2 text-sm">
            <UserAvatar
              email=""
              image={m.assigneeImage}
              name={m.assigneeName}
              size="xs"
            />
            {m.assigneeName}
            {m.editable && (
              <span className="text-base-content/60 text-xs">(you)</span>
            )}
          </span>
          <div className="min-w-0 flex-1 basis-40 space-y-0.5">
            <FieldSummary row={m} />
            {(m.fields?.length ?? 0) > 0 && (
              <DetailsButton onOpen={() => onDetails(m.id)} row={m} />
            )}
          </div>
          <NoteButton onOpen={() => onNote(m.id)} row={m} />
        </li>
      ))}
    </ul>
  );
}

function ExpandButton({
  g,
  open,
  onToggle,
}: {
  g: TeamGroup;
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <button
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} each member's status: ${g.title}`}
      className="inline-flex items-center gap-1.5 rounded-md py-0.5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={onToggle}
      type="button"
    >
      <Progress g={g} />
      <CaretDownIcon
        aria-hidden
        className={cn(
          "size-3 text-base-content/60 transition-transform",
          open && "rotate-180"
        )}
      />
    </button>
  );
}

export function TeamGroupsView({ groups, onDetails, onNote, onStatus }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((p) => {
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
              <TableHead className="w-10">
                <span className="sr-only">Done</span>
              </TableHead>
              <TableHead>Checklist item</TableHead>
              <TableHead>Assignees</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="w-16">
                <span className="sr-only">Note</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.flatMap((g) => {
              const single = g.members.length === 1 ? g.members[0] : null;
              // The viewer's own member row (if any) drives the checkbox/note on shared rows too.
              const own = single ?? g.members.find((m) => m.editable) ?? null;
              const expanded = open.has(g.key);
              const main = (
                <TableRow data-testid="team-group" key={g.key}>
                  <TableCell className="w-10">
                    {own && (
                      <RowCheckbox
                        className="mt-0"
                        onChange={(st) => onStatus(own, st)}
                        row={own}
                      />
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <p
                      className={cn(
                        "break-words",
                        g.status === "DONE" &&
                          "text-base-content/60 line-through"
                      )}
                    >
                      {g.title}
                    </p>
                    {single && <FieldSummary row={single} />}
                    {single && (
                      <DetailsButton
                        onOpen={() => onDetails(single.id)}
                        row={single}
                      />
                    )}
                    {g.templateName && (
                      <p className="text-base-content/60 text-xs">
                        {g.templateName}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="max-w-56">
                    <span className="inline-flex items-center gap-2">
                      <AvatarStack members={g.members} />
                      <AssigneeNames members={g.members} />
                    </span>
                    {!single && (
                      <div>
                        <ExpandButton
                          g={g}
                          onToggle={() => toggle(g.key)}
                          open={expanded}
                        />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <PriorityTag priority={g.priority} />
                  </TableCell>
                  <TableCell>
                    <DueLabel dueTime={g.dueTime} rows={g.members} />
                  </TableCell>
                  <TableCell className="align-top">
                    {single ? (
                      <NoteButton
                        onOpen={() => onNote(single.id)}
                        row={single}
                      />
                    ) : (
                      <AggregateNoteButton
                        count={noteCount(g.members)}
                        onToggle={() => toggle(g.key)}
                        open={expanded}
                        title={g.title}
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
              return !single && expanded
                ? [
                    main,
                    <TableRow key={`${g.key}:members`}>
                      <TableCell className="bg-base-200/40" colSpan={6}>
                        <MemberList
                          g={g}
                          groups={groups}
                          onDetails={onDetails}
                          onNote={onNote}
                          onStatus={onStatus}
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
          const single = g.members.length === 1 ? g.members[0] : null;
          // The viewer's own member row (if any) drives the checkbox/note on shared rows too.
          const own = single ?? g.members.find((m) => m.editable) ?? null;
          const expanded = open.has(g.key);
          return (
            <li
              className="space-y-2 rounded-xl border border-base-300 p-4"
              data-testid="team-group"
              key={g.key}
            >
              <div className="flex items-start gap-3">
                {own && (
                  <RowCheckbox onChange={(st) => onStatus(own, st)} row={own} />
                )}
                <p
                  className={cn(
                    "min-w-0 flex-1 break-words font-medium text-sm",
                    g.status === "DONE" && "text-base-content/60 line-through"
                  )}
                >
                  {g.title}
                </p>
                {single ? (
                  <NoteButton onOpen={() => onNote(single.id)} row={single} />
                ) : (
                  <AggregateNoteButton
                    count={noteCount(g.members)}
                    onToggle={() => toggle(g.key)}
                    open={expanded}
                    title={g.title}
                  />
                )}
              </div>
              {g.templateName && (
                <p className="text-base-content/60 text-xs">{g.templateName}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base-content/70 text-xs">
                <AssigneeNames members={g.members} />
                <PriorityTag priority={g.priority} />
                {g.dueTime && (
                  <span>
                    <DueLabel
                      dueTime={g.dueTime}
                      prefix="Due "
                      rows={g.members}
                    />
                  </span>
                )}
              </div>
              {single && <FieldSummary row={single} />}
              {single && (
                <DetailsButton
                  onOpen={() => onDetails(single.id)}
                  row={single}
                />
              )}
              {!single && (
                <>
                  <ExpandButton
                    g={g}
                    onToggle={() => toggle(g.key)}
                    open={expanded}
                  />
                  {expanded && (
                    <MemberList
                      g={g}
                      groups={groups}
                      onDetails={onDetails}
                      onNote={onNote}
                      onStatus={onStatus}
                    />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
