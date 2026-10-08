"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  getMyHistoryTemplates,
  getMyTeamChecklist,
  getMyTeamChecklistHistory,
  updateTeamChecklistItem,
} from "@/app/actions/daily-checklist";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ChecklistStatus } from "@/lib/daily-checklist/constants";
import {
  filterMyRows,
  type MemberFilter,
  myRows,
  normalizeMemberFilter,
} from "@/lib/daily-checklist/team-aggregate";
import type { TeamItemRow } from "@/lib/daily-checklist/types";
import { HistoryWithDateFilter } from "./history-with-date-filter";
import { ItemDetailDialog } from "./item-detail-dialog";
import { ItemNoteDialog } from "./item-note-dialog";
import { MemberHistoryTable } from "./member-history";
import { EmptyState, formatLongDate } from "./shared";
import { TodayChecklists } from "./today-checklists";
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Tabs
          onValueChange={(v) => {
            setSub(v as "today" | "history");
            setUrlParams({ view: v });
          }}
          value={sub}
        >
          <TabsList aria-label="Team checklist views">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="history">My History</TabsTrigger>
          </TabsList>
        </Tabs>
        {isAdmin && (
          <Link
            className="ml-auto text-primary text-sm underline-offset-4 hover:underline"
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
          loadTemplates={() => getMyHistoryTemplates(workspaceId)}
          renderRows={(rows) => (
            <MemberHistoryTable rows={rows} workspaceId={workspaceId} />
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
            <TodayChecklists
              allRows={myRows(allRows)}
              filter={filter}
              onDetails={setDetailId}
              onFilterChange={(f) => {
                setFilter(f);
                setUrlParams({ filter: f });
              }}
              onNote={setNoteId}
              onStatus={setStatus}
              visibleRows={rows}
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
