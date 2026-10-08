"use client";

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CalendarBlankIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { format, parse } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createChecklistTemplate,
  getAssignableMembers,
  updateChecklistTemplate,
} from "@/app/actions/daily-checklist-admin";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CHECKLIST_PRIORITIES,
  type ChecklistPriority,
  LIMITS,
  RECURRENCE_LABEL,
  RECURRENCES,
  type Recurrence,
  WEEKDAY_LABELS,
} from "@/lib/daily-checklist/constants";
import { FIELD_LIMITS, FIELD_TYPE_LABEL } from "@/lib/daily-checklist/fields";
import type { TemplateDTO } from "@/lib/daily-checklist/types";
import { filterMembersByQuery } from "@/lib/member-search";
import { PRIORITY_CONFIG } from "@/lib/priority-config";
import { cn } from "@/lib/utils";

import { FieldDialog, type FieldDraft } from "./field-dialog";

interface DraftItem {
  dueTime: string;
  id?: string;
  key: string;
  priority: ChecklistPriority;
  title: string;
}

interface Member {
  email: string;
  image: string | null;
  name: string;
  userId: string;
}

const ISO = "yyyy-MM-dd";
const toDate = (s: string) => parse(s, ISO, new Date());
const ITEM_GRID =
  "grid grid-cols-[2rem_minmax(10rem,1fr)_8.5rem_7.5rem_6.5rem] items-center gap-x-2 px-2";
const newItem = (): DraftItem => ({
  key: crypto.randomUUID(),
  title: "",
  priority: "NONE",
  dueTime: "",
});

export function TemplateForm({
  workspaceId,
  template,
  today,
  title,
  description: pageDescription,
}: {
  /** Header copy (the form renders its own header so the actions can sit top-right). */
  description?: string;
  title?: string;
  /** null = create */
  template: TemplateDTO | null;
  today: string;
  workspaceId: string;
}) {
  const router = useRouter();
  const backHref = `/${workspaceId}/daily-checklist/admin`;
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [items, setItems] = useState<DraftItem[]>(() =>
    template && template.items.length > 0
      ? template.items.map((i) => ({
          key: i.id,
          id: i.id,
          title: i.title,
          priority: i.priority,
          dueTime: i.dueTime ?? "",
        }))
      : [newItem()]
  );
  const [assignees, setAssignees] = useState<Set<string>>(
    () => new Set(template?.assignees.map((a) => a.userId) ?? [])
  );
  const [fields, setFields] = useState<FieldDraft[]>(() =>
    (template?.fields ?? []).map((f) => ({
      key: f.id,
      id: f.id,
      name: f.name,
      type: f.type,
      isRequired: f.isRequired,
      appliesToAll: f.appliesToAll,
      itemKeys: f.itemIds,
      options: f.options.map((o) => ({
        key: crypto.randomUUID(),
        label: o.label,
      })),
    }))
  );
  // `draft: null` = adding a new field.
  const [fieldEdit, setFieldEdit] = useState<{
    draft: FieldDraft | null;
  } | null>(null);
  const [recurrence, setRecurrence] = useState<Recurrence>(
    template?.recurrence ?? "WEEKDAYS"
  );
  const [days, setDays] = useState<number[]>(template?.recurrenceDays ?? []);
  const [startDate, setStartDate] = useState(template?.startDate ?? today);
  const [endDate, setEndDate] = useState<string | null>(
    template?.endDate ?? null
  );
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAssignableMembers(workspaceId).then((res) => {
      if ("members" in res) {
        setMembers(res.members as Member[]);
      } else {
        toast.error(res.error);
      }
    });
  }, [workspaceId]);

  function scopeLabel(f: FieldDraft) {
    if (f.appliesToAll) {
      return "All items";
    }
    const names = items
      .map((it, i) => ({
        key: it.key,
        title: it.title.trim() || `Item ${i + 1}`,
      }))
      .filter((it) => f.itemKeys.includes(it.key))
      .map((it) => it.title);
    return names.length <= 2
      ? names.join(", ") || "No items"
      : `${names.length} items`;
  }

  const visibleMembers = useMemo(
    () => filterMembersByQuery(members, query),
    [members, query]
  );

  function patchItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, ...patch } : i))
    );
  }
  function moveItem(index: number, dir: -1 | 1) {
    setItems((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) {
        return prev;
      }
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const validKeys = new Set(
      items.filter((i) => i.title.trim()).map((i) => i.key)
    );
    // A field limited to items that were since removed/blanked would apply to nothing.
    const orphan = fields.find(
      (f) => !f.appliesToAll && !f.itemKeys.some((k) => validKeys.has(k))
    );
    if (orphan) {
      setError(`Select at least one checklist item for "${orphan.name}"`);
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      name,
      description: description.trim() || null,
      recurrence,
      recurrenceDays: days,
      startDate,
      // Kept in state so switching back restores it, but never saved for a one-time template.
      endDate: recurrence === "ONCE" ? null : endDate,
      items: items
        .filter((i) => i.title.trim())
        .map((i) => ({
          id: i.id,
          key: i.key,
          title: i.title,
          priority: i.priority,
          dueTime: i.dueTime || null,
        })),
      assigneeIds: [...assignees],
      fields: fields.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        isRequired: f.isRequired,
        appliesToAll: f.appliesToAll,
        itemKeys: f.appliesToAll
          ? []
          : f.itemKeys.filter((k) => validKeys.has(k)),
        options: f.options.map((o) => ({ label: o.label })),
      })),
    };
    const res = template
      ? await updateChecklistTemplate(workspaceId, template.id, payload)
      : await createChecklistTemplate(workspaceId, payload);
    if ("error" in res) {
      setBusy(false);
      setError(res.error);
      return;
    }
    toast.success(template ? "Template updated" : "Template created");
    router.push(backHref);
    router.refresh();
  }

  const submitLabel = template ? "Save changes" : "Create template";

  return (
    <>
      <form className="space-y-4" onSubmit={submit}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <Link
              className="mb-2 inline-flex items-center gap-1.5 rounded-md text-base-content/60 text-sm hover:text-base-content"
              href={backHref}
            >
              <ArrowLeftIcon className="size-4" /> Back to Templates
            </Link>
            {title && (
              <h1 className="font-black text-3xl text-base-content tracking-normal">
                {title}
              </h1>
            )}
            {pageDescription && (
              <p className="mt-1.5 max-w-2xl text-base-content/60 text-sm leading-relaxed">
                {pageDescription}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={backHref}>Cancel</Link>
            </Button>
            <Button
              className="shadow-sm"
              disabled={busy || !name.trim()}
              type="submit"
            >
              {submitLabel}
            </Button>
          </div>
        </div>

        <Card className="gap-3 rounded-xl" size="sm">
          <CardHeader className="gap-0.5">
            <CardTitle className="normal-case tracking-normal text-base font-semibold">
              Basic information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input
                id="tpl-name"
                maxLength={LIMITS.templateName}
                onChange={(e) => setName(e.target.value)}
                placeholder="Daily Developer Checklist"
                required
                value={name}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Textarea
                className="min-h-0"
                id="tpl-desc"
                maxLength={LIMITS.text}
                onChange={(e) => setDescription(e.target.value)}
                rows={1}
                value={description}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="gap-3 rounded-xl" size="sm">
          <CardHeader className="gap-0.5">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="normal-case tracking-normal text-base font-semibold">
                Checklist items
              </CardTitle>
              <Button
                disabled={items.length >= LIMITS.templateItems}
                onClick={() => setItems((p) => [...p, newItem()])}
                size="sm"
                type="button"
                variant="outline"
              >
                <PlusIcon className="size-4" /> Add Item
              </Button>
            </div>
            <CardDescription>
              These items are copied into each generated checklist day. Changes
              apply to future days only — past days keep what they were
              generated with.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset className="border-0 p-0">
              <legend className="sr-only">Checklist items</legend>
              {/* Narrow screens scroll sideways so the columns stay aligned. */}
              <div className="overflow-x-auto rounded-xl border border-base-300">
                <div className="min-w-[36rem]">
                  <div
                    aria-hidden
                    className={cn(
                      ITEM_GRID,
                      "border-base-300 border-b bg-base-200/50 py-2 font-semibold text-base-content/60 text-xs uppercase tracking-wide"
                    )}
                  >
                    <span className="text-center">#</span>
                    <span>Task</span>
                    <span>Priority</span>
                    <span>Due time</span>
                    <span className="text-right">Actions</span>
                  </div>
                  <div className="divide-y divide-base-300/70">
                    {items.map((it, i) => (
                      <div className={cn(ITEM_GRID, "py-1.5")} key={it.key}>
                        <span className="text-center text-base-content/60 text-xs tabular-nums">
                          {i + 1}
                        </span>
                        <Input
                          aria-label={`Item ${i + 1} title`}
                          className="h-8 min-w-0"
                          maxLength={LIMITS.title}
                          onChange={(e) =>
                            patchItem(it.key, { title: e.target.value })
                          }
                          placeholder={`Item ${i + 1}`}
                          value={it.title}
                        />
                        <Select
                          onValueChange={(v) =>
                            patchItem(it.key, {
                              priority: v as ChecklistPriority,
                            })
                          }
                          value={it.priority}
                        >
                          <SelectTrigger
                            aria-label={`Item ${i + 1} priority`}
                            className="h-8 w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="p-1.5">
                            {CHECKLIST_PRIORITIES.map((p) => (
                              <SelectItem key={p} value={p}>
                                {PRIORITY_CONFIG[p].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          aria-label={`Item ${i + 1} due time`}
                          className="h-8 w-full"
                          onChange={(e) =>
                            patchItem(it.key, { dueTime: e.target.value })
                          }
                          type="time"
                          value={it.dueTime}
                        />
                        <div className="flex justify-end">
                          <Button
                            aria-label={`Move item ${i + 1} up`}
                            disabled={i === 0}
                            onClick={() => moveItem(i, -1)}
                            size="icon-xs"
                            type="button"
                            variant="ghost"
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            aria-label={`Move item ${i + 1} down`}
                            disabled={i === items.length - 1}
                            onClick={() => moveItem(i, 1)}
                            size="icon-xs"
                            type="button"
                            variant="ghost"
                          >
                            <ArrowDownIcon />
                          </Button>
                          <Button
                            aria-label={`Remove item ${i + 1}`}
                            onClick={() =>
                              setItems((p) => p.filter((x) => x.key !== it.key))
                            }
                            size="icon-xs"
                            type="button"
                            variant="ghost"
                          >
                            <XIcon />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p className="px-3 py-4 text-center text-base-content/60 text-sm">
                        No items yet. Use Add Item to create the first one.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </fieldset>
          </CardContent>
        </Card>

        <Card className="gap-3 rounded-xl" size="sm">
          <CardHeader className="gap-0.5">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="normal-case tracking-normal text-base font-semibold">
                Custom fields
              </CardTitle>
              {fields.length > 0 && (
                <Button
                  disabled={fields.length >= FIELD_LIMITS.fieldsPerTemplate}
                  onClick={() => setFieldEdit({ draft: null })}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <PlusIcon className="size-4" /> Add Custom Field
                </Button>
              )}
            </div>
            <CardDescription>
              Add fields that members fill in for each checklist item.
              {template &&
                " Field changes apply to future days. Past days keep the fields they had."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset className="border-0 p-0">
              <legend className="sr-only">Custom fields</legend>
              {fields.length === 0 ? (
                <div className="flex flex-col items-center gap-1 rounded-xl border border-base-300 border-dashed bg-base-200/30 px-4 py-6 text-center">
                  <p className="font-medium text-sm">No custom fields yet</p>
                  <p className="text-base-content/60 text-xs">
                    Add fields that members should fill in for each checklist
                    item.
                  </p>
                  <Button
                    className="mt-2"
                    onClick={() => setFieldEdit({ draft: null })}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <PlusIcon className="size-4" /> Add Custom Field
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-base-300/70 rounded-xl border border-base-300">
                  {fields.map((f, i) => (
                    <div
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pr-1.5 pl-3"
                      key={f.key}
                    >
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="break-words font-medium text-sm">
                          {f.name}
                        </p>
                        <p className="text-base-content/60 text-xs">
                          {FIELD_TYPE_LABEL[f.type]}
                          {f.type === "DROPDOWN"
                            ? ` · ${f.options.length} options`
                            : ""}
                          {` · ${scopeLabel(f)}`}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 font-medium text-xs",
                          f.isRequired
                            ? "bg-error/10 text-error"
                            : "bg-base-200 text-base-content/70"
                        )}
                      >
                        {f.isRequired ? "Required" : "Optional"}
                      </span>
                      <div className="flex">
                        <Button
                          aria-label={`Move field ${f.name} up`}
                          disabled={i === 0}
                          onClick={() =>
                            setFields((p) => {
                              const n = [...p];
                              [n[i - 1], n[i]] = [n[i], n[i - 1]];
                              return n;
                            })
                          }
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <ArrowUpIcon />
                        </Button>
                        <Button
                          aria-label={`Move field ${f.name} down`}
                          disabled={i === fields.length - 1}
                          onClick={() =>
                            setFields((p) => {
                              const n = [...p];
                              [n[i + 1], n[i]] = [n[i], n[i + 1]];
                              return n;
                            })
                          }
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <ArrowDownIcon />
                        </Button>
                        <Button
                          aria-label={`Edit field ${f.name}`}
                          onClick={() => setFieldEdit({ draft: f })}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Edit
                        </Button>
                        <Button
                          aria-label={`Delete field ${f.name}`}
                          onClick={() =>
                            setFields((p) => p.filter((x) => x.key !== f.key))
                          }
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </fieldset>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="h-full gap-3 rounded-xl" size="sm">
            <CardHeader className="gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="normal-case tracking-normal text-base font-semibold">
                  Assign members
                </CardTitle>
                <span className="rounded-md bg-base-200 px-2 py-0.5 font-medium text-base-content/70 text-xs tabular-nums">
                  {assignees.size} selected
                </span>
              </div>
              <CardDescription>
                New assignees receive today&apos;s checklist immediately when
                the recurrence applies. Existing generated checklists are not
                changed when assignments are edited.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <fieldset className="space-y-2 border-0 p-0">
                <legend className="sr-only">Assign members</legend>
                <SearchInput
                  aria-label="Search members"
                  onChange={(e) => setQuery(e.target.value)}
                  onClear={() => setQuery("")}
                  placeholder="Search members"
                  value={query}
                />
                <ul className="max-h-48 divide-y divide-base-300 overflow-y-auto rounded-xl border border-base-300">
                  {visibleMembers.length === 0 && (
                    <li className="px-3 py-2 text-base-content/60 text-sm">
                      No members found
                    </li>
                  )}
                  {visibleMembers.map((m) => {
                    const on = assignees.has(m.userId);
                    return (
                      <li key={m.userId}>
                        <div className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-base-200">
                          <Checkbox
                            aria-label={`Assign ${m.name || m.email}`}
                            checked={on}
                            onCheckedChange={() =>
                              setAssignees((prev) => {
                                const next = new Set(prev);
                                if (on) {
                                  next.delete(m.userId);
                                } else {
                                  next.add(m.userId);
                                }
                                return next;
                              })
                            }
                          />
                          <UserAvatar
                            email={m.email}
                            image={m.image}
                            name={m.name}
                            size="xs"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {m.name || m.email}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-base-content/60 text-xs">
                  {assignees.size} selected
                </p>
                {template?.assignees.some((a) => !assignees.has(a.userId)) && (
                  <p className="text-warning text-xs" role="status">
                    This removes them from future checklist generation. Their
                    existing checklist history remains unchanged.
                  </p>
                )}
              </fieldset>
            </CardContent>
          </Card>

          <Card className="h-full gap-3 rounded-xl" size="sm">
            <CardHeader className="gap-0.5">
              <CardTitle className="normal-case tracking-normal text-base font-semibold">
                Recurrence
              </CardTitle>
              <CardDescription>
                When this checklist is generated for each assignee.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Repeat</Label>
                  <Select
                    onValueChange={(v) => setRecurrence(v as Recurrence)}
                    value={recurrence}
                  >
                    <SelectTrigger aria-label="Repeat" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="p-1.5">
                      {RECURRENCES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {RECURRENCE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(recurrence === "CUSTOM" || recurrence === "WEEKLY") && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>
                      {recurrence === "WEEKLY" ? "Day of the week" : "Days"}
                    </Label>
                    <fieldset
                      aria-label="Weekdays"
                      className="flex flex-wrap gap-1.5 border-0 p-0"
                    >
                      {WEEKDAY_LABELS.map((d, i) => {
                        const on = days.includes(i);
                        return (
                          <Button
                            aria-pressed={on}
                            className={cn(
                              "rounded-md",
                              on && "ring-2 ring-primary/40"
                            )}
                            key={d}
                            onClick={() =>
                              setDays((prev) =>
                                recurrence === "WEEKLY"
                                  ? [i]
                                  : on
                                    ? prev.filter((x) => x !== i)
                                    : [...prev, i]
                              )
                            }
                            size="sm"
                            type="button"
                            variant={on ? "default" : "outline"}
                          >
                            {d}
                          </Button>
                        );
                      })}
                    </fieldset>
                  </div>
                )}
                <DateField
                  label="Start date"
                  onChange={(v) => v && setStartDate(v)}
                  value={startDate}
                />
                {recurrence !== "ONCE" && (
                  <DateField
                    clearable
                    label="End date (optional)"
                    onChange={setEndDate}
                    value={endDate}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {error && (
          <p className="text-error text-sm" role="alert">
            {error}
          </p>
        )}
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-base-300 border-t bg-base-100/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:rounded-xl sm:border">
          <Button asChild variant="outline">
            <Link href={backHref}>Cancel</Link>
          </Button>
          <Button disabled={busy || !name.trim()} type="submit">
            {submitLabel}
          </Button>
        </div>
      </form>
      {/* Outside the <form>: React events bubble through portals, so the dialog's own submit would otherwise submit the template. */}
      <FieldDialog
        existingNames={fields
          .filter((f) => f.key !== fieldEdit?.draft?.key)
          .map((f) => f.name)}
        field={fieldEdit?.draft ?? null}
        items={items.map((it) => ({ key: it.key, title: it.title }))}
        onClose={() => setFieldEdit(null)}
        onSave={(f) => {
          setFields((p) =>
            p.some((x) => x.key === f.key)
              ? p.map((x) => (x.key === f.key ? f : x))
              : [...p, f]
          );
          setFieldEdit(null);
        }}
        open={fieldEdit !== null}
      />
      ;
    </>
  );
}

function DateField({
  label,
  value,
  onChange,
  clearable,
}: {
  clearable?: boolean;
  label: string;
  onChange: (v: string | null) => void;
  value: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-label={label}
            className="flex h-10 w-full items-center gap-2 rounded-md border border-base-300 px-3 text-sm transition-colors hover:bg-base-200"
            type="button"
          >
            <CalendarBlankIcon className="size-3.5 shrink-0 text-base-content/60" />
            <span className={value ? "" : "text-base-content/60"}>
              {value ? format(toDate(value), "MMM d, yyyy") : "No end date"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            onSelect={(d) => {
              onChange(d ? format(d, ISO) : null);
              setOpen(false);
            }}
            selected={value ? toDate(value) : undefined}
          />
          {clearable && value && (
            <div className="border-base-300 border-t p-2">
              <Button
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
