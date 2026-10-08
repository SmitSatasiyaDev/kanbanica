"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  getMyTeamChecklist,
  getMyTeamChecklistHistory,
  updateTeamChecklistItem,
} from "@/app/actions/daily-checklist";
import { UserAvatar } from "@/components/common/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ChecklistStatus } from "@/lib/daily-checklist/constants";
import {
  filterMyRows,
  type MemberFilter,
  normalizeMemberFilter,
} from "@/lib/daily-checklist/team-aggregate";
import type { TeamItemRow } from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { InlineHistory } from "./history-inline";
import { HistoryWithDateFilter } from "./history-with-date-filter";
import { ItemDetailDialog } from "./item-detail-dialog";
import { ItemNoteDialog } from "./item-note-dialog";
import { EmptyState, formatLongDate, PriorityTag } from "./shared";
import {
  DetailsButton,
  DueLabel,
  FieldSummary,
  NoteButton,
  RowCheckbox,
} from "./team-row-parts";
import { setUrlParams } from "./url-state";
import { useChecklistData } from "./use-checklist-data";

export function TeamChecklistPanel({
  workspaceId,
  isAdmin,
  today,
  initialView,
  initialFilter,
}: {
  initialFilter: MemberFilter;
  initialView: "today" | "history";
  isAdmin: boolean;
  today: string;
  workspaceId: string;
}) {
  const [sub, setSub] = useState<"today" | "history">(initialView);
  const [filter, setFilter] = useState<MemberFilter>(initialFilter);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const { data, error, loading, reload } = useChecklistData(
    () => getMyTeamChecklist(workspaceId),
    [workspaceId]
  );

  async function setStatus(row: TeamItemRow, status: ChecklistStatus) {
    const res = await updateTeamChecklistItem(workspaceId, row.id, { status });
    if ("error" in res) {
      toast.error(res.error);
    }
    await reload(true);
  }

  const allRows = data?.rows ?? [];
  // Every filter (Status / Pending / Done) shows only the viewer's own items.
  const rows = filterMyRows(allRows, filter);
  const empty = rows.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          onValueChange={(v) => {
            setSub(v as "today" | "history");
            setUrlParams({ view: v });
          }}
          value={sub}
        >
          <TabsList aria-label="Team checklist views">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </Tabs>
        {isAdmin && (
          <Link
            className="text-primary text-sm underline-offset-4 hover:underline"
            href={`/${workspaceId}/daily-checklist/admin`}
          >
            Manage templates &amp; team progress
          </Link>
        )}
      </div>

      {sub === "history" ? (
        <HistoryWithDateFilter
          emptyText="No team checklist history yet."
          fetch={(o) => getMyTeamChecklistHistory(workspaceId, o)}
          renderRows={(rows) => (
            <InlineHistory
              rows={rows}
              variant="self"
              workspaceId={workspaceId}
            />
          )}
          showTemplate
          today={today}
        />
      ) : loading && !data ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : error || !data ? (
        <p className="text-error text-sm">
          {error ?? "Could not load team checklist"}
        </p>
      ) : (
        <section aria-labelledby="team-day-heading" className="space-y-4">
          <h2 className="font-bold text-xl" id="team-day-heading">
            {formatLongDate(data.date)}
          </h2>
          <Tabs
            onValueChange={(v) => {
              const f = normalizeMemberFilter(v);
              setFilter(f);
              setUrlParams({ filter: f });
            }}
            value={filter}
          >
            <TabsList
              aria-label="Filter team checklist"
              className="max-w-full overflow-x-auto"
            >
              <TabsTrigger value="mine">Status</TabsTrigger>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="done">Done</TabsTrigger>
            </TabsList>
          </Tabs>

          {data.rows.length === 0 ? (
            <EmptyState title="No team checklists assigned to you today." />
          ) : empty ? (
            <EmptyState title="Nothing matches this filter." />
          ) : (
            <MyRowsView
              onDetails={setDetailId}
              onNote={setNoteId}
              onStatus={setStatus}
              rows={rows}
            />
          )}
        </section>
      )}

      {(() => {
        const row = data?.rows.find((x) => x.id === detailId);
        return (
          <ItemDetailDialog
            editable={row?.editable ?? false}
            fields={row?.fields ?? []}
            itemId={row ? row.id : null}
            onClose={() => setDetailId(null)}
            onSaved={() => reload(true)}
            title={row?.title ?? ""}
            workspaceId={workspaceId}
          />
        );
      })()}
      {(() => {
        const row = data?.rows.find((x) => x.id === noteId);
        return (
          <ItemNoteDialog
            editable={row?.editable ?? false}
            itemId={row ? row.id : null}
            notes={row?.notes ?? null}
            onClose={() => setNoteId(null)}
            onSaved={() => reload(true)}
            title={row?.title ?? ""}
            workspaceId={workspaceId}
          />
        );
      })()}
    </div>
  );
}

/** The viewer's own items, one row per item (unchanged from before aggregation). */
function MyRowsView({
  rows,
  onDetails,
  onNote,
  onStatus,
}: {
  onDetails: (id: string) => void;
  onNote: (id: string) => void;
  onStatus: (row: TeamItemRow, s: ChecklistStatus) => void;
  rows: TeamItemRow[];
}) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-base-300 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <span className="sr-only">Done</span>
              </TableHead>
              <TableHead>Checklist item</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="w-16">
                <span className="sr-only">Note</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="w-10">
                  <RowCheckbox
                    className="mt-0"
                    onChange={(st) => onStatus(r, st)}
                    row={r}
                  />
                </TableCell>
                <TableCell className="max-w-xs">
                  <p
                    className={cn(
                      "break-words",
                      r.status === "DONE" && "text-base-content/60 line-through"
                    )}
                  >
                    {r.title}
                  </p>
                  <FieldSummary row={r} />
                  <DetailsButton onOpen={() => onDetails(r.id)} row={r} />
                  {r.templateName && (
                    <p className="text-base-content/60 text-xs">
                      {r.templateName}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <UserAvatar
                      email=""
                      image={r.assigneeImage}
                      name={r.assigneeName}
                      size="xs"
                    />
                    {r.assigneeName}
                    <span className="text-base-content/60 text-xs">(you)</span>
                  </span>
                </TableCell>
                <TableCell>
                  <PriorityTag priority={r.priority} />
                </TableCell>
                <TableCell>
                  <DueLabel dueTime={r.dueTime} rows={[r]} />
                </TableCell>
                <TableCell className="align-top">
                  <NoteButton onOpen={() => onNote(r.id)} row={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li
            className="space-y-2 rounded-xl border border-base-300 p-4"
            key={r.id}
          >
            <div className="flex items-start gap-3">
              <RowCheckbox onChange={(st) => onStatus(r, st)} row={r} />
              <p
                className={cn(
                  "min-w-0 flex-1 break-words font-medium text-sm",
                  r.status === "DONE" && "text-base-content/60 line-through"
                )}
              >
                {r.title}
              </p>
              <NoteButton onOpen={() => onNote(r.id)} row={r} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base-content/70 text-xs">
              <span>{r.assigneeName} (you)</span>
              <PriorityTag priority={r.priority} />
              {r.dueTime && (
                <span>
                  <DueLabel dueTime={r.dueTime} prefix="Due " rows={[r]} />
                </span>
              )}
            </div>
            <FieldSummary row={r} />
            <DetailsButton onOpen={() => onDetails(r.id)} row={r} />
          </li>
        ))}
      </ul>
    </>
  );
}
