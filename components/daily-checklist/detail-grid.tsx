import type { ReactNode } from "react";
import type { ChecklistPriority } from "@/lib/daily-checklist/constants";
import { summarizeFieldValues } from "@/lib/daily-checklist/field-summary";
import type { FieldValueDTO } from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import { PriorityTag } from "./shared";
import { InlineFields } from "./team-row-parts";

// One template shared by the header and every row, in every expanded details list
// (Today, member History, admin History) so the columns always line up. Below `md` the row
// stacks instead (task + actions, then status, then notes) so nothing needs to scroll.
const GRID_MD =
  "md:grid-cols-[minmax(10rem,1.6fr)_10rem_minmax(8rem,1.2fr)_8rem]";
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 md:items-center";

/** Header + `<ul>`; the header only shows once the columns do (`md`+). */
export function DetailGridFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <div
        aria-hidden
        className={cn(
          "hidden border-base-300/60 border-y px-2 py-1.5 font-medium text-base-content/50 text-xs md:grid md:items-center md:gap-x-3",
          GRID_MD
        )}
      >
        <span className="pl-6">Task</span>
        <span>Status</span>
        <span>Notes / Update</span>
        <span />
      </div>
      <ul className="divide-y divide-base-300/60 border-base-300/60 border-y md:border-t-0 md:border-b">
        {children}
      </ul>
    </div>
  );
}

export function DetailGridRow({
  checkbox,
  title,
  done,
  priority,
  due,
  status,
  fields,
  note,
  actions,
}: {
  actions?: ReactNode;
  checkbox: ReactNode;
  done: boolean;
  /** Due text/node (e.g. "Due 10:00"); null when the item has no due time — nothing renders. */
  due: ReactNode;
  fields?: FieldValueDTO[];
  note: string | null;
  priority: ChecklistPriority;
  status: string;
  title: string;
}) {
  const hasFields = summarizeFieldValues(fields).length > 0;
  const hasMeta = priority !== "NONE" || Boolean(due);
  return (
    <li className={cn(ROW, GRID_MD, "px-2 py-2 text-sm")}>
      <div className="flex min-w-0 items-start gap-2.5 md:order-1">
        <span className="mt-0.5 shrink-0">{checkbox}</span>
        <div className="min-w-0">
          <p
            className={cn(
              "truncate font-medium",
              done && "text-base-content/60 line-through"
            )}
            title={title}
          >
            {title}
          </p>
          {hasMeta && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-base-content/60 text-xs">
              {priority !== "NONE" && <PriorityTag priority={priority} />}
              {priority !== "NONE" && due && <span aria-hidden>·</span>}
              {due && <span className="whitespace-nowrap">{due}</span>}
            </p>
          )}
        </div>
      </div>
      <span
        className={cn(
          "col-span-2 truncate whitespace-nowrap pl-6.5 text-xs md:order-2 md:col-span-1 md:pl-0",
          done ? "text-success" : "text-base-content/60"
        )}
      >
        {status}
      </span>
      <div
        className="col-span-2 flex min-w-0 items-center gap-x-2 pl-6.5 text-base-content/60 text-xs md:order-3 md:col-span-1 md:pl-0"
        title={note ?? undefined}
      >
        {hasFields && <InlineFields fields={fields} />}
        {note && (
          <span className="min-w-0 truncate">
            <span className="text-base-content/50">Note: </span>
            {note}
          </span>
        )}
        {!(hasFields || note) && <span aria-hidden>—</span>}
      </div>
      <div className="col-start-2 row-start-1 flex items-center justify-end md:order-4 md:col-start-auto md:row-start-auto">
        {actions}
      </div>
    </li>
  );
}
