"use client";

import {
  CaretDownIcon,
  CaretRightIcon,
  InfoIcon,
  NoteIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChecklistDays } from "@/app/actions/daily-checklist";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  groupHistory,
  type HistoryTemplateGroup,
} from "@/lib/daily-checklist/history-group";
import type {
  ChecklistItemDTO,
  DayDetail,
  HistoryRow,
  TodayInstanceRow,
} from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { displayFieldValue } from "./item-detail-dialog";
import {
  DayStatusLabel,
  formatLongDate,
  PriorityTag,
  StatusLabel,
} from "./shared";

const rowBtn =
  "flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left text-sm transition-colors hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset";

const flip = (set: Set<string>, k: string) => {
  const n = new Set(set);
  if (n.has(k)) {
    n.delete(k);
  } else {
    n.add(k);
  }
  return n;
};

function Caret({ open, className }: { open: boolean; className?: string }) {
  const Icon = open ? CaretDownIcon : CaretRightIcon;
  return <Icon aria-hidden className={cn("shrink-0", className)} />;
}

type Details = Record<string, DayDetail>;

/** dayId → saved day, fetched in batches (one read-only request per call), cached, never refetched. */
function useDayDetails(workspaceId: string) {
  // dayId → saved day. Shared across groups so re-expanding or loading more never refetches.
  const [details, setDetails] = useState<Details>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());
  const load = useCallback(
    async (key: string, dayIds: string[]) => {
      const missing = dayIds.filter((id) => !requested.current.has(id));
      if (missing.length === 0) {
        return;
      }
      for (const id of missing) {
        requested.current.add(id);
      }
      const res = await getChecklistDays(workspaceId, missing);
      if ("error" in res && typeof res.error === "string") {
        for (const id of missing) {
          requested.current.delete(id); // allow a retry on the next expand
        }
        setErrors((e) => ({ ...e, [key]: res.error as string }));
        return;
      }
      setErrors((e) => {
        const { [key]: _drop, ...rest } = e;
        return rest;
      });
      setDetails((d) => ({ ...d, ...(res as Details) }));
    },
    [workspaceId]
  );
  return { details, errors, load };
}

/**
 * Admin history: Date → Template → comparison matrix (members × saved items). Grouping is
 * presentation only (the rows the paginated list already fetched). Each template's saved items
 * are fetched lazily with ONE read-only request, the first time that template is shown.
 */
export function InlineHistory({
  rows,
  workspaceId,
  variant = "matrix",
}: {
  rows: HistoryRow[];
  /** "matrix": members × items (Admin). "self": the viewer's own items as a plain list (member History). */
  variant?: "matrix" | "self";
  workspaceId: string;
}) {
  const groups = useMemo(() => groupHistory(rows), [rows]);
  // Newest date starts expanded; dates loaded later start collapsed. Templates start expanded.
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());
  const [closedTemplates, setClosedTemplates] = useState<Set<string>>(
    new Set()
  );
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && groups.length > 0) {
      seeded.current = true;
      setOpenDates(new Set([groups[0].date]));
    }
  }, [groups]);

  const { details, errors, load } = useDayDetails(workspaceId);

  return (
    <div className="space-y-3" data-testid="history-inline">
      {groups.map((d) => {
        const open = openDates.has(d.date);
        const panelId = `hist-${d.date}`;
        return (
          <section
            className="overflow-hidden rounded-xl border border-base-300"
            key={d.date}
          >
            <h3 className="m-0">
              <button
                aria-controls={panelId}
                aria-expanded={open}
                className={cn(rowBtn, "bg-base-200/50 py-3 font-medium")}
                onClick={() => setOpenDates((s) => flip(s, d.date))}
                type="button"
              >
                <Caret className="size-4" open={open} />
                <span className="min-w-0 flex-1 basis-40">
                  {formatLongDate(d.date)}
                </span>
                <span className="tabular-nums">
                  {d.completed}/{d.total} · {d.percent}%
                </span>
                <DayStatusLabel status={d.status} />
              </button>
            </h3>
            {open && (
              <ul
                className="divide-y divide-base-300 border-base-300 border-t"
                id={panelId}
              >
                {d.templates.map((t) => {
                  const tk = `${d.date}:${t.key}`;
                  const tOpen = !closedTemplates.has(tk);
                  const label = t.name ?? "Checklist";
                  return (
                    <li key={tk}>
                      <button
                        aria-expanded={tOpen}
                        className={cn(rowBtn, "bg-base-200/30 py-2")}
                        onClick={() => setClosedTemplates((s) => flip(s, tk))}
                        type="button"
                      >
                        <Caret className="size-3" open={tOpen} />
                        <span className="min-w-0 flex-1 basis-40 break-words">
                          {label}
                          {variant === "matrix" && (
                            <span className="text-base-content/60 text-xs">
                              {" "}
                              · {t.members.length}{" "}
                              {t.members.length === 1 ? "member" : "members"}
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums">
                          {t.completed}/{t.total}
                        </span>
                        <DayStatusLabel status={t.status} />
                      </button>
                      {tOpen && (
                        <TemplateMatrix
                          details={details}
                          error={errors[tk]}
                          group={t}
                          label={label}
                          load={(ids) => load(tk, ids)}
                          variant={variant}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Today's Checklists (admin): the same members × items matrix for one template's day-instances. */
export function TodayMatrix({
  label,
  users,
  date,
  workspaceId,
}: {
  date: string;
  label: string;
  users: TodayInstanceRow[];
  workspaceId: string;
}) {
  const { details, errors, load } = useDayDetails(workspaceId);
  const group = useMemo(
    () => ({
      members: users.map(
        (u): HistoryRow => ({
          completed: u.completed,
          date,
          dayId: u.dayId,
          status: u.status,
          templateId: u.templateId,
          templateName: u.templateName,
          total: u.total,
          userId: u.userId,
          userName: u.userName,
        })
      ),
    }),
    [users, date]
  );
  return (
    <TemplateMatrix
      details={details}
      error={errors.today}
      group={group}
      label={label}
      load={(ids) => load("today", ids)}
      variant="matrix"
    />
  );
}

interface Column {
  dueTime: string | null;
  key: string;
  priority: ChecklistItemDTO["priority"];
  title: string;
}

/** Columns come from the saved items themselves (title + nth repeat), in first-seen order. */
function buildMatrix(members: HistoryRow[], details: Details) {
  const columns: Column[] = [];
  const seen = new Set<string>();
  const cells = new Map<string, Map<string, ChecklistItemDTO>>();
  for (const m of members) {
    const det = details[m.dayId];
    if (!det) {
      continue;
    }
    const byKey = new Map<string, ChecklistItemDTO>();
    const count = new Map<string, number>();
    for (const it of [...det.items].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const n = (count.get(it.title) ?? 0) + 1;
      count.set(it.title, n);
      const key = `${it.title}#${n}`;
      byKey.set(key, it);
      if (!seen.has(key)) {
        seen.add(key);
        columns.push({
          key,
          title: it.title,
          priority: it.priority,
          dueTime: it.dueTime,
        });
      }
    }
    cells.set(m.dayId, byKey);
  }
  return { columns, cells };
}

function TemplateMatrix({
  group,
  label,
  details,
  error,
  load,
  variant,
}: {
  variant: "matrix" | "self";
  details: Details;
  error: string | undefined;
  group: Pick<HistoryTemplateGroup, "members">;
  label: string;
  load: (dayIds: string[]) => Promise<void>;
}) {
  const ids = useMemo(() => group.members.map((m) => m.dayId), [group]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` is re-created per render; ids is the trigger
  useEffect(() => {
    load(ids);
  }, [ids]);

  const ready = ids.every((id) => details[id]);
  const { columns, cells } = useMemo(
    () => buildMatrix(group.members, details),
    [group.members, details]
  );

  if (!ready) {
    return (
      <div className="border-base-300 border-t px-4 py-3">
        {error ? (
          <p className="text-error text-sm" role="alert">
            {error}
          </p>
        ) : (
          <Skeleton className="h-20 w-full rounded-xl" />
        )}
      </div>
    );
  }

  if (variant === "self") {
    return <SelfItems details={details} group={group} />;
  }

  return (
    <div className="border-base-300 border-t">
      {/* Desktop / tablet: members × items. Only this container scrolls sideways. */}
      <section
        aria-label={`${label} history, scroll sideways for more items`}
        className="hidden overflow-x-auto md:block"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-scrollable region
        tabIndex={0}
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">{label} history by member</caption>
          <thead>
            <tr>
              <th
                className="sticky left-0 z-10 w-56 min-w-56 border-base-300 border-r border-b bg-base-100 px-4 py-2 text-left font-medium text-base-content/70 text-xs"
                scope="col"
              >
                Person
              </th>
              {columns.map((c) => (
                <th
                  className="w-40 min-w-40 max-w-40 border-base-300 border-b px-3 py-2 text-left align-top font-medium"
                  key={c.key}
                  scope="col"
                >
                  <span className="block truncate" title={c.title}>
                    {c.title}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 font-normal text-base-content/60 text-xs">
                    <PriorityTag priority={c.priority} />
                    <span>
                      {c.dueTime ? `Due ${c.dueTime}` : "No due time"}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.members.map((m) => (
              <tr className="hover:bg-base-200/40" key={m.dayId}>
                <th
                  className="sticky left-0 z-10 w-56 min-w-56 border-base-300 border-r border-b bg-base-100 px-4 py-2 text-left font-normal"
                  scope="row"
                >
                  <span
                    className="block truncate font-medium"
                    title={m.userName ?? ""}
                  >
                    {m.userName ?? "—"}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="tabular-nums">
                      {m.completed} / {m.total}
                    </span>
                    <DayStatusLabel status={m.status} />
                  </span>
                </th>
                {columns.map((c) => {
                  const it = cells.get(m.dayId)?.get(c.key);
                  return (
                    <td
                      className="w-40 min-w-40 max-w-40 border-base-300 border-b px-3 py-2 align-top"
                      key={c.key}
                    >
                      {it ? (
                        <Cell item={it} member={m.userName ?? "member"} />
                      ) : (
                        <span className="text-base-content/40">
                          —
                          <span className="sr-only">
                            {" "}
                            Not in this checklist
                          </span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Mobile: one compact section per member; items are rows. */}
      <ul className="divide-y divide-base-300 md:hidden">
        {group.members.map((m) => {
          const items = [...(details[m.dayId]?.items ?? [])].sort(
            (a, b) => a.sortOrder - b.sortOrder
          );
          return (
            <li className="px-4 py-3" key={m.dayId}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="min-w-0 flex-1 basis-32 break-words font-medium">
                  {m.userName ?? "—"}
                </span>
                <span className="text-sm tabular-nums">
                  {m.completed} / {m.total}
                </span>
                <DayStatusLabel status={m.status} />
              </div>
              <ul className="mt-1.5 divide-y divide-base-300/60">
                {items.map((it) => (
                  <li className="py-1.5 text-sm" key={it.id}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 break-words">{it.title}</span>
                      <Cell item={it} member={m.userName ?? "member"} />
                    </div>
                    <span className="flex flex-wrap items-center gap-x-3 text-base-content/60 text-xs">
                      <PriorityTag priority={it.priority} />
                      {it.dueTime && <span>Due {it.dueTime}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Member History: the viewer's own saved items for this template/day — no Person column, no matrix. */
function SelfItems({
  group,
  details,
}: {
  details: Details;
  group: Pick<HistoryTemplateGroup, "members">;
}) {
  const items = group.members.flatMap((m) =>
    [...(details[m.dayId]?.items ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder
    )
  );
  if (items.length === 0) {
    return (
      <p className="border-base-300 border-t px-4 py-3 text-base-content/60 text-sm">
        No items were saved for this day.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-base-300/60 border-base-300 border-t px-4">
      {items.map((it) => {
        const fields = (it.fields ?? []).filter((f) => f.name);
        return (
          <li className="py-2 text-sm" key={it.id}>
            <div className="flex items-start justify-between gap-3">
              <span
                className={cn(
                  "min-w-0 break-words",
                  it.status === "DONE" && "text-base-content/60 line-through"
                )}
                title={it.title}
              >
                {it.title}
              </span>
              <Cell item={it} member="you" />
            </div>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-base-content/60 text-xs">
              <PriorityTag priority={it.priority} />
              <span>{it.dueTime ? `Due ${it.dueTime}` : "No due time"}</span>
              {fields.map((f) => (
                <span className="break-words" key={f.id}>
                  {f.name}: {displayFieldValue(f)}
                </span>
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function timeOf(iso: string | null) {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** A note counts only if it has non-whitespace content (the text itself is shown untouched). */
function hasNote(notes: string | null | undefined): notes is string {
  return typeof notes === "string" && notes.trim().length > 0;
}

/**
 * Status (+ completion time) and, in the matrix, a read-only popover trigger: the note icon when
 * the item has a note, an info icon when it only has custom-field values. Notes are never
 * rendered inside the cell itself — the popover (mouse, keyboard, touch) shows them in full.
 */
function Cell({
  item,
  member,
  popover = true,
}: {
  item: ChecklistItemDTO;
  member: string;
  popover?: boolean;
}) {
  const done = item.status === "DONE" ? timeOf(item.completedAt) : null;
  const fields = (item.fields ?? []).filter((f) => f.name);
  const note = hasNote(item.notes);
  const hasDetail = popover && (note || fields.length > 0);
  const Icon = note ? NoteIcon : InfoIcon;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <StatusLabel status={item.status} />
      {done && <span className="text-base-content/60 text-xs">· {done}</span>}
      {hasDetail && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              aria-label={`${note ? "View note" : "View details"} for ${item.title}, ${member}`}
              className="inline-flex size-6 items-center justify-center rounded-md text-base-content/60 hover:bg-base-200 hover:text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              type="button"
            >
              <Icon aria-hidden className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-2 p-3 text-sm">
            <p className="break-words font-medium">{item.title}</p>
            <p className="text-base-content/60 text-xs">{member}</p>
            {note && (
              <div className="border-primary/40 border-l-2 pl-2 text-xs">
                <p className="font-medium text-base-content/60">Note</p>
                <p className="whitespace-pre-wrap break-words">{item.notes}</p>
              </div>
            )}
            {fields.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {fields.map((f) => (
                  <div className="contents" key={f.id}>
                    <dt className="text-base-content/60">{f.name}</dt>
                    <dd className="break-words">{displayFieldValue(f)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="text-base-content/50 text-xs">Read-only history</p>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
