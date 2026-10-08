"use client";

import {
  PencilSimpleIcon,
  PlusIcon,
  PowerIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  deleteChecklistTemplate,
  disableChecklistTemplate,
  getTeamChecklistHistory,
  getTodaysChecklists,
  listChecklistTemplates,
} from "@/app/actions/daily-checklist-admin";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RECURRENCE_LABEL,
  WEEKDAY_LABELS,
} from "@/lib/daily-checklist/constants";
import { FIELD_TYPE_LABEL } from "@/lib/daily-checklist/fields";
import type { TemplateDTO } from "@/lib/daily-checklist/types";
import { InlineHistory } from "../history-inline";
import { HistoryList } from "../history-list";
import {
  EmptyState,
  formatLongDate,
  formatShortDate,
  PriorityTag,
} from "../shared";
import { useChecklistData } from "../use-checklist-data";
import { HistoryDateFilter } from "./history-date-filter";
import { TodayGroups } from "./today-groups";

type Section = "templates" | "today" | "history";

export function AdminConsole({
  workspaceId,
  today,
  initialDate = null,
}: {
  initialDate?: string | null;
  today: string;
  workspaceId: string;
}) {
  // A valid ?date= in the URL opens History directly, filtered to that date.
  const [section, setSection] = useState<Section>(
    initialDate ? "history" : "templates"
  );
  const [historyDate, setHistoryDateState] = useState<string | null>(
    initialDate
  );
  const setHistoryDate = (d: string | null) => {
    setHistoryDateState(d);
    const url = new URL(window.location.href);
    if (d) {
      url.searchParams.set("date", d);
    } else {
      url.searchParams.delete("date");
    }
    window.history.replaceState(window.history.state, "", url);
  };
  const fetchHistory = useCallback(
    (before?: string) =>
      getTeamChecklistHistory(
        workspaceId,
        historyDate ? { date: historyDate } : { before }
      ),
    [workspaceId, historyDate]
  );

  return (
    <div className="space-y-6">
      <Tabs onValueChange={(v) => setSection(v as Section)} value={section}>
        <TabsList
          aria-label="Checklist admin"
          className="max-w-full overflow-x-auto"
        >
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="today">Today's Checklists</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
      </Tabs>

      {section === "templates" && (
        <TemplatesSection workspaceId={workspaceId} />
      )}
      {section === "today" && <TodaySection workspaceId={workspaceId} />}
      {section === "history" && (
        <div className="space-y-4">
          <HistoryDateFilter
            onChange={setHistoryDate}
            today={today}
            value={historyDate}
          />
          <HistoryList
            emptyText={
              historyDate
                ? `No checklist history for ${formatLongDate(historyDate)}.`
                : "No team checklist history yet."
            }
            fetchPage={fetchHistory}
            renderRows={(rows) => (
              <InlineHistory rows={rows} workspaceId={workspaceId} />
            )}
            resetKey={historyDate}
            showTemplate
            showUser
          />
        </div>
      )}
    </div>
  );
}

function recurrenceText(t: TemplateDTO) {
  const base = RECURRENCE_LABEL[t.recurrence];
  return t.recurrence === "CUSTOM" || t.recurrence === "WEEKLY"
    ? `${base}: ${t.recurrenceDays.map((d) => WEEKDAY_LABELS[d]).join(", ")}`
    : base;
}

function TemplatesSection({ workspaceId }: { workspaceId: string }) {
  const { data, error, loading, reload } = useChecklistData(
    () => listChecklistTemplates(workspaceId),
    [workspaceId]
  );
  const newHref = `/${workspaceId}/daily-checklist/admin/templates/new`;
  const [deleting, setDeleting] = useState<TemplateDTO | null>(null);

  async function toggle(t: TemplateDTO) {
    const res = await disableChecklistTemplate(workspaceId, t.id, !t.isActive);
    if ("error" in res) {
      toast.error(res.error);
    } else {
      toast.success(
        t.isActive
          ? "Template disabled — history is kept"
          : "Template re-enabled"
      );
    }
    await reload(true);
  }

  if (loading && !data) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (error || !data) {
    return (
      <p className="text-error text-sm">
        {error ?? "Could not load templates"}
      </p>
    );
  }

  return (
    <section aria-label="Templates" className="space-y-4">
      <div className="flex justify-end">
        <Button asChild>
          <Link href={newHref}>
            <PlusIcon className="size-4" /> Create Template
          </Link>
        </Button>
      </div>

      {data.templates.length === 0 ? (
        <EmptyState
          description="Create your first team checklist template."
          title="No checklist templates yet."
        >
          <Button asChild size="sm">
            <Link href={newHref}>
              <PlusIcon className="size-4" /> Create Template
            </Link>
          </Button>
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {data.templates.map((t) => (
            <li
              className="space-y-3 rounded-xl border border-base-300 p-4 sm:p-6"
              key={t.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words font-semibold">
                    {t.name}{" "}
                    {!t.isActive && (
                      <span className="ml-1 font-medium text-base-content/60 text-xs">
                        (Disabled)
                      </span>
                    )}
                  </h2>
                  {t.description && (
                    <p className="text-base-content/60 text-sm">
                      {t.description}
                    </p>
                  )}
                  <p className="mt-1 text-base-content/60 text-xs">
                    {recurrenceText(t)} · from {formatShortDate(t.startDate)}
                    {t.endDate ? ` to ${formatShortDate(t.endDate)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    aria-label={`Edit ${t.name}`}
                    asChild
                    size="sm"
                    variant="outline"
                  >
                    <Link
                      href={`/${workspaceId}/daily-checklist/admin/templates/${t.id}/edit`}
                    >
                      <PencilSimpleIcon className="size-4" /> Edit
                    </Link>
                  </Button>
                  <Button
                    aria-label={`${t.isActive ? "Disable" : "Re-enable"} ${t.name}`}
                    onClick={() => toggle(t)}
                    size="sm"
                    variant="outline"
                  >
                    <PowerIcon className="size-4" />{" "}
                    {t.isActive ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    aria-label={`Delete ${t.name}`}
                    onClick={() => setDeleting(t)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {t.items.map((i) => (
                  <li key={i.id}>
                    {i.title} <PriorityTag priority={i.priority} />
                    {i.dueTime && (
                      <span className="ml-2 text-base-content/60 text-xs">
                        Due {i.dueTime}
                      </span>
                    )}
                  </li>
                ))}
                {t.items.length === 0 && (
                  <li className="list-none text-base-content/60">
                    No items yet
                  </li>
                )}
              </ol>
              {t.fields.length > 0 && (
                <p className="text-base-content/70 text-xs">
                  <span className="font-medium">Custom fields:</span>{" "}
                  {t.fields
                    .map((f) => `${f.name} (${FIELD_TYPE_LABEL[f.type]})`)
                    .join(", ")}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {t.assignees.length === 0 && (
                  <span className="text-base-content/60 text-xs">
                    No one assigned
                  </span>
                )}
                {t.assignees.map((a) => (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-base-300 py-0.5 pr-2.5 pl-1 text-xs"
                    key={a.userId}
                  >
                    <UserAvatar
                      email={a.email}
                      image={a.image}
                      name={a.name}
                      size="xs"
                    />
                    {a.name || a.email}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        onOpenChange={(o) => !o && setDeleting(null)}
        open={deleting !== null}
      >
        <DialogContent className="rounded-xl sm:max-w-sm">
          <DialogHeader className="items-center text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-error/10">
              <TrashIcon className="size-6 text-error" />
            </div>
            <DialogTitle>Delete template?</DialogTitle>
            <DialogDescription>
              “{deleting?.name}” will stop generating new checklists. Past days
              stay available in History.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => setDeleting(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={async () => {
                if (deleting) {
                  const res = await deleteChecklistTemplate(
                    workspaceId,
                    deleting.id
                  );
                  if ("error" in res) {
                    toast.error(res.error);
                  } else {
                    toast.success("Template deleted");
                  }
                }
                setDeleting(null);
                await reload(true);
              }}
              variant="destructive"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TodaySection({ workspaceId }: { workspaceId: string }) {
  const { data, error, loading } = useChecklistData(
    () => getTodaysChecklists(workspaceId),
    [workspaceId]
  );
  if (loading && !data) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (error || !data) {
    return (
      <p className="text-error text-sm">
        {error ?? "Could not load today's checklists"}
      </p>
    );
  }
  if (data.rows.length === 0) {
    return (
      <EmptyState
        description="Templates that apply today and have assignees show up here."
        title="No team checklists for today."
      />
    );
  }
  return (
    <section aria-label="Today's checklists" className="space-y-3">
      <h2 className="font-semibold">{formatLongDate(data.date)}</h2>
      <TodayGroups
        date={data.date}
        rows={data.rows}
        workspaceId={workspaceId}
      />
    </section>
  );
}
