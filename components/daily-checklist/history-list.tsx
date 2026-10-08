"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { computeProgress } from "@/lib/daily-checklist/progress";
import type { HistoryPage, HistoryRow } from "@/lib/daily-checklist/types";
import { GroupedHistory } from "./history-grouped";
import { DayStatusLabel, EmptyState, formatLongDate } from "./shared";

export function HistoryList({
  fetchPage,
  onOpen,
  renderRows,
  showUser = false,
  showTemplate = false,
  emptyText,
  resetKey,
}: {
  emptyText: string;
  fetchPage: (before?: string) => Promise<HistoryPage | { error: string }>;
  onOpen?: (row: HistoryRow) => void;
  /** Replaces the default row rendering (pagination, loading and empty states stay here). */
  renderRows?: (rows: HistoryRow[]) => ReactNode;
  /** Re-fetches from page one when this changes. */
  resetKey?: unknown;
  showTemplate?: boolean;
  showUser?: boolean;
}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Blocks a second request while one is in flight (fast double-clicks on "Load more").
  const inFlight = useRef(false);

  const load = useCallback(
    async (before?: string) => {
      if (before && inFlight.current) {
        return;
      }
      inFlight.current = true;
      setLoading(true);
      try {
        const res = await fetchPage(before);
        if ("error" in res) {
          setError(res.error);
        } else {
          setError(null);
          setRows((prev) => {
            if (!before) {
              return res.rows;
            }
            // Never show the same saved day twice (e.g. overlapping pages).
            const seen = new Set(prev.map((r) => r.dayId));
            return [...prev, ...res.rows.filter((r) => !seen.has(r.dayId))];
          });
          setCursor(res.nextCursor);
        }
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [fetchPage]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the explicit reload trigger
  useEffect(() => {
    load();
  }, [load, resetKey]);

  if (loading && rows.length === 0) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton className="h-12 w-full rounded-xl" key={i} />
        ))}
      </div>
    );
  }
  if (error) {
    return <p className="text-error text-sm">{error}</p>;
  }
  if (rows.length === 0) {
    return <EmptyState title={emptyText} />;
  }

  return (
    <div className="space-y-3">
      {renderRows ? (
        renderRows(rows)
      ) : showTemplate ? (
        <GroupedHistory
          onOpen={(r) => onOpen?.(r)}
          rows={rows}
          showUser={showUser}
        />
      ) : (
        <ul className="divide-y divide-base-300 overflow-hidden rounded-xl border border-base-300">
          {rows.map((r) => {
            const p = computeProgress({
              completed: r.completed,
              total: r.total,
            });
            return (
              <li key={r.dayId}>
                <button
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm transition-colors hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => onOpen?.(r)}
                  type="button"
                >
                  <span className="min-w-28 font-medium">
                    {formatLongDate(r.date)}
                  </span>
                  {(showTemplate || showUser) && (
                    <span className="min-w-0 flex-1 truncate text-base-content/70">
                      {[
                        showTemplate ? r.templateName : null,
                        showUser ? r.userName : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  <span className="ml-auto tabular-nums">
                    {r.completed} / {r.total} · {p.percent}%
                  </span>
                  <DayStatusLabel status={r.status} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {cursor && (
        <Button
          disabled={loading}
          onClick={() => load(cursor)}
          size="sm"
          variant="outline"
        >
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
