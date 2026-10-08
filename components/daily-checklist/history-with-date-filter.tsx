"use client";

import { type ComponentProps, useCallback, useRef, useState } from "react";
import { HistoryDateFilter } from "./admin/history-date-filter";
import { HistoryList } from "./history-list";
import { formatLongDate } from "./shared";

type Page = Awaited<
  ReturnType<ComponentProps<typeof HistoryList>["fetchPage"]>
>;

/** History list + jump-to-date picker (member Personal / Team history). */
export function HistoryWithDateFilter({
  today,
  emptyText,
  fetch,
  ...rest
}: Omit<
  ComponentProps<typeof HistoryList>,
  "fetchPage" | "emptyText" | "resetKey"
> & {
  emptyText: string;
  fetch: (opts: { before?: string; date?: string }) => Promise<Page>;
  today: string;
}) {
  const [date, setDate] = useState<string | null>(null);
  // Callers pass an inline wrapper, so keep the latest in a ref: `fetchPage` (and with it the
  // list's reset) then changes only when `date` does.
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;
  const fetchPage = useCallback(
    (before?: string) => fetchRef.current(date ? { date } : { before }),
    [date]
  );
  return (
    <div className="space-y-4">
      <HistoryDateFilter onChange={setDate} today={today} value={date} />
      <HistoryList
        {...rest}
        emptyText={
          date ? `No checklist history for ${formatLongDate(date)}.` : emptyText
        }
        fetchPage={fetchPage}
        resetKey={date}
      />
    </div>
  );
}
