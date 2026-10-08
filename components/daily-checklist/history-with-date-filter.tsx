"use client";

import {
  type ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { parseHistoryStatus } from "@/lib/daily-checklist/history-report";
import type { HistoryReportStatus } from "@/lib/daily-checklist/types";
import {
  FilterSelect,
  RangePicker,
  STATUS_OPTIONS,
} from "./admin/history-report";
import { HistoryList } from "./history-list";

type Page = Awaited<
  ReturnType<ComponentProps<typeof HistoryList>["fetchPage"]>
>;

interface FetchOpts {
  before?: string;
  from?: string;
  status?: HistoryReportStatus;
  templateId?: string;
  to?: string;
}

/** History list + the admin History's filter row (date range, template, status) for members. */
export function HistoryWithDateFilter({
  today,
  emptyText,
  fetch,
  loadTemplates,
  ...rest
}: Omit<
  ComponentProps<typeof HistoryList>,
  "fetchPage" | "emptyText" | "resetKey"
> & {
  emptyText: string;
  fetch: (opts: FetchOpts) => Promise<Page>;
  /** Omit for Personal history — personal days have no template, so no template filter. */
  loadTemplates?: () => Promise<
    { id: string; name: string }[] | { error: string }
  >;
  today: string;
}) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [status, setStatus] = useState<HistoryReportStatus | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>(
    []
  );
  const loadRef = useRef(loadTemplates);
  loadRef.current = loadTemplates;
  useEffect(() => {
    loadRef.current?.().then((res) => {
      if (Array.isArray(res)) {
        setTemplates(res);
      }
    });
  }, []);

  // Callers pass an inline wrapper, so keep the latest in a ref: `fetchPage` (and with it the
  // list's reset) then changes only when a filter does.
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;
  const fetchPage = useCallback(
    (before?: string) =>
      fetchRef.current({
        before,
        from: range?.from,
        to: range?.to,
        templateId: template ?? undefined,
        status: status ?? undefined,
      }),
    [range, template, status]
  );
  const filtered = range !== null || template !== null || status !== null;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-lg leading-tight">
          Checklist History
        </h2>
        <p className="text-base-content/60 text-sm">
          View completed checklists and track your activity
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker
          from={range?.from ?? null}
          onChange={(from, to) => setRange({ from, to })}
          to={range?.to ?? null}
          today={today}
        />
        {loadTemplates && (
          <FilterSelect
            allLabel="All Templates"
            label="Filter by template"
            onChange={setTemplate}
            options={templates.map((t) => ({ value: t.id, label: t.name }))}
            searchable
            value={template}
          />
        )}
        <FilterSelect
          allLabel="All Status"
          label="Filter by status"
          onChange={(v) => setStatus(parseHistoryStatus(v) ?? null)}
          options={STATUS_OPTIONS}
          value={status}
        />
        {filtered && (
          <Button
            onClick={() => {
              setRange(null);
              setTemplate(null);
              setStatus(null);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear filters
          </Button>
        )}
      </div>
      <HistoryList
        {...rest}
        emptyText={
          filtered ? "No checklist history matches these filters." : emptyText
        }
        fetchPage={fetchPage}
        resetKey={`${range?.from}|${range?.to}|${template}|${status}`}
      />
    </div>
  );
}
