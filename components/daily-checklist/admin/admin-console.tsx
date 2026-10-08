"use client";

import {
  CalendarBlankIcon,
  CaretDownIcon,
  DotsThreeVerticalIcon,
  ListBulletsIcon,
  ListChecksIcon,
  PencilSimpleIcon,
  PlusIcon,
  PowerIcon,
  TrashIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  deleteChecklistTemplate,
  disableChecklistTemplate,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RECURRENCE_LABEL,
  WEEKDAY_LABELS,
} from "@/lib/daily-checklist/constants";
import { FIELD_TYPE_LABEL } from "@/lib/daily-checklist/fields";
import type { TemplateDTO } from "@/lib/daily-checklist/types";
import { cn } from "@/lib/utils";
import {
  EmptyState,
  formatLongDate,
  formatShortDate,
  PriorityTag,
} from "../shared";
import { useChecklistData } from "../use-checklist-data";
import { HistoryReport } from "./history-report";
import { TodayGroups } from "./today-groups";

type Section = "templates" | "today" | "history";

const SECTIONS: Section[] = ["templates", "today", "history"];
const HISTORY_PARAMS = ["from", "to", "user", "template", "status", "page"];

export function AdminConsole({
  workspaceId,
  initialDate = null,
}: {
  initialDate?: string | null;
  workspaceId: string;
}) {
  // ?tab= wins; a legacy ?date= (or any History filter in the URL) opens History directly.
  const params = useSearchParams();
  const tab = params.get("tab");
  const [section, setSection] = useState<Section>(
    SECTIONS.find((s) => s === tab) ??
      (initialDate || HISTORY_PARAMS.some((k) => params.has(k))
        ? "history"
        : "templates")
  );
  const changeSection = (next: Section) => {
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    if (next !== "history") {
      for (const k of [...HISTORY_PARAMS, "date"]) {
        url.searchParams.delete(k);
      }
    }
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <div className="space-y-6" data-stable-gutter>
      <Tabs onValueChange={(v) => changeSection(v as Section)} value={section}>
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
        <HistoryReport initialDate={initialDate} workspaceId={workspaceId} />
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
            <TemplateRow
              key={t.id}
              onDelete={() => setDeleting(t)}
              onToggle={() => toggle(t)}
              t={t}
              workspaceId={workspaceId}
            />
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

/** One compact template row; items, custom fields and assignees fold open under the chevron. */
function TemplateRow({
  t,
  workspaceId,
  onToggle,
  onDelete,
}: {
  onDelete: () => void;
  onToggle: () => void;
  t: TemplateDTO;
  workspaceId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-base-300 bg-elevated">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
          <ListChecksIcon className="size-5" weight="fill" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="break-words font-semibold">{t.name}</h2>
          {t.description && (
            <p className="truncate text-base-content/60 text-sm">
              {t.description}
            </p>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-base-content/60 text-xs">
            <CalendarBlankIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">
              {recurrenceText(t)} · from {formatShortDate(t.startDate)}
              {t.endDate ? ` to ${formatShortDate(t.endDate)}` : ""}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-5 text-base-content/60 text-xs">
          <span className="flex items-center gap-2">
            <ListBulletsIcon aria-hidden className="size-5" />
            <span>
              <span className="block font-semibold text-base-content text-sm tabular-nums">
                {t.items.length}
              </span>
              Tasks
            </span>
          </span>
          <span className="flex items-center gap-2 border-base-300 border-l pl-5">
            <UsersIcon aria-hidden className="size-5" />
            <span>
              <span className="block font-semibold text-base-content text-sm tabular-nums">
                {t.assignees.length}
              </span>
              Assigned
            </span>
          </span>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-xs",
            t.isActive
              ? "bg-success/15 text-success"
              : "bg-base-200 text-base-content/70"
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {t.isActive ? "Active" : "Inactive"}
        </span>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`More actions for ${t.name}`}
                size="icon-sm"
                variant="ghost"
              >
                <DotsThreeVerticalIcon weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                aria-label={`${t.isActive ? "Disable" : "Re-enable"} ${t.name}`}
                onClick={onToggle}
              >
                <PowerIcon />
                {t.isActive ? "Disable" : "Enable"}
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={`Delete ${t.name}`}
                onClick={onDelete}
                variant="destructive"
              >
                <TrashIcon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            aria-controls={`tpl-${t.id}`}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} details: ${t.name}`}
            onClick={() => setOpen((o) => !o)}
            size="icon-sm"
            variant="ghost"
          >
            <CaretDownIcon
              className={cn("transition-transform", open && "rotate-180")}
            />
          </Button>
        </div>
      </div>
      {open && (
        <div
          className="space-y-3 border-base-300 border-t px-4 py-3"
          id={`tpl-${t.id}`}
        >
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
              <li className="list-none text-base-content/60">No items yet</li>
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
        </div>
      )}
    </li>
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
    <section aria-label="Today's checklists" className="space-y-5">
      <div>
        <h2 className="font-semibold text-xl">Today's Checklists</h2>
        <p className="text-base-content/60 text-sm">
          {formatLongDate(data.date)} · track team progress as it happens
        </p>
      </div>
      <TodayGroups
        date={data.date}
        rows={data.rows}
        workspaceId={workspaceId}
      />
    </section>
  );
}
