"use client";

import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FIELD_LIMITS,
  FIELD_TYPE_LABEL,
  FIELD_TYPES,
  type FieldType,
} from "@/lib/daily-checklist/fields";
import { fieldSchema, firstError } from "@/lib/daily-checklist/validation";

export interface FieldDraft {
  /** true = every checklist item; false = only the items in `itemKeys`. */
  appliesToAll: boolean;
  /** Present for a field that already exists on the template (its type is then locked). */
  id?: string;
  isRequired: boolean;
  /** Keys (template item ids / draft item keys) of the items the field applies to. */
  itemKeys: string[];
  key: string;
  name: string;
  options: { key: string; label: string }[];
  type: FieldType;
}

const newOption = (label = "") => ({ key: crypto.randomUUID(), label });

export function emptyFieldDraft(): FieldDraft {
  return {
    key: crypto.randomUUID(),
    name: "",
    type: "TEXT",
    isRequired: false,
    appliesToAll: true,
    itemKeys: [],
    options: [],
  };
}

export function FieldDialog({
  field,
  open,
  existingNames,
  items,
  onClose,
  onSave,
}: {
  existingNames: string[];
  /** The template's current checklist items, for "Selected checklist items". */
  items: { key: string; title: string }[];
  field: FieldDraft | null;
  onClose: () => void;
  onSave: (f: FieldDraft) => void;
  open: boolean;
}) {
  const [draft, setDraft] = useState<FieldDraft>(emptyFieldDraft());
  const [error, setError] = useState<string | null>(null);
  const isEdit = Boolean(field?.id);

  useEffect(() => {
    if (open) {
      setDraft(field ?? emptyFieldDraft());
      setError(null);
    }
  }, [open, field]);

  function setType(type: FieldType) {
    setDraft((d) => ({
      ...d,
      type,
      options:
        type === "DROPDOWN" && d.options.length === 0
          ? [newOption()]
          : d.options,
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const parsed = fieldSchema.safeParse({
      id: draft.id,
      name: draft.name,
      type: draft.type,
      isRequired: draft.isRequired,
      appliesToAll: draft.appliesToAll,
      itemKeys: draft.itemKeys,
      options: draft.options
        .filter((o) => o.label.trim())
        .map((o) => ({ label: o.label })),
    });
    if (!parsed.success) {
      setError(firstError(parsed.error));
      return;
    }
    if (
      existingNames.some(
        (n) => n.toLowerCase() === parsed.data.name.toLowerCase()
      )
    ) {
      setError(`A field named "${parsed.data.name}" already exists`);
      return;
    }
    onSave({
      ...draft,
      name: parsed.data.name,
      itemKeys: parsed.data.itemKeys,
      options: parsed.data.options.map((o) => ({
        key: crypto.randomUUID(),
        label: o.label,
      })),
    });
  }

  return (
    <Dialog onOpenChange={(o) => !o && onClose()} open={open}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl sm:max-w-md">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit custom field" : "Add custom field"}
            </DialogTitle>
            <DialogDescription>
              Members fill this in on each checklist item. Changes apply to
              future days only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cf-name">Field name</Label>
            <Input
              id="cf-name"
              maxLength={FIELD_LIMITS.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              placeholder="e.g. Subscription"
              value={draft.name}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Field type</Label>
            <Select
              disabled={isEdit}
              onValueChange={(v) => setType(v as FieldType)}
              value={draft.type}
            >
              <SelectTrigger aria-label="Field type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="p-1.5">
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {FIELD_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-base-content/60 text-xs">
                The type can't be changed after the field is created.
              </p>
            )}
          </div>

          {draft.type === "DROPDOWN" && (
            <fieldset className="space-y-2">
              <legend className="mb-1 font-medium text-sm">Options</legend>
              {draft.options.map((o, i) => (
                <div className="flex items-center gap-2" key={o.key}>
                  <Input
                    aria-label={`Option ${i + 1}`}
                    maxLength={FIELD_LIMITS.optionLabel}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        options: d.options.map((x) =>
                          x.key === o.key ? { ...x, label: e.target.value } : x
                        ),
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setDraft((d) => ({
                          ...d,
                          options: [...d.options, newOption()],
                        }));
                      }
                    }}
                    value={o.label}
                  />
                  <Button
                    aria-label={`Remove option ${i + 1}`}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        options: d.options.filter((x) => x.key !== o.key),
                      }))
                    }
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
              <Button
                disabled={draft.options.length >= FIELD_LIMITS.options}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    options: [...d.options, newOption()],
                  }))
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <PlusIcon className="size-4" /> Add option
              </Button>
            </fieldset>
          )}

          <fieldset className="space-y-2 border-0 p-0">
            <legend className="mb-1 font-medium text-sm">Apply to</legend>
            <RadioGroup
              className="gap-1.5"
              onValueChange={(v) => {
                setError(null);
                setDraft((d) => ({ ...d, appliesToAll: v === "all" }));
              }}
              value={draft.appliesToAll ? "all" : "selected"}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id="cf-apply-all" value="all" />
                <Label htmlFor="cf-apply-all">All checklist items</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  disabled={items.length === 0}
                  id="cf-apply-selected"
                  value="selected"
                />
                <Label htmlFor="cf-apply-selected">
                  Selected checklist items
                </Label>
              </div>
            </RadioGroup>
            {items.length === 0 && (
              <p className="text-base-content/60 text-xs">
                Add checklist items first to limit a field to specific items.
              </p>
            )}
            {!draft.appliesToAll && items.length > 0 && (
              <ul className="max-h-32 divide-y divide-base-300 overflow-y-auto rounded-xl border border-base-300">
                {items.map((it, i) => {
                  const on = draft.itemKeys.includes(it.key);
                  return (
                    <li
                      className="flex items-center gap-2 px-3 py-1.5 text-sm"
                      key={it.key}
                    >
                      <Checkbox
                        aria-label={`Apply to ${it.title || `Item ${i + 1}`}`}
                        checked={on}
                        id={`cf-item-${it.key}`}
                        onCheckedChange={() => {
                          setError(null);
                          setDraft((d) => ({
                            ...d,
                            itemKeys: on
                              ? d.itemKeys.filter((k) => k !== it.key)
                              : [...d.itemKeys, it.key],
                          }));
                        }}
                      />
                      <Label
                        className="min-w-0 flex-1 truncate font-normal"
                        htmlFor={`cf-item-${it.key}`}
                      >
                        {it.title || `Item ${i + 1}`}
                      </Label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>

          <div className="flex items-center gap-2">
            <Checkbox
              aria-label="Required"
              checked={draft.isRequired}
              id="cf-required"
              onCheckedChange={(c) =>
                setDraft((d) => ({ ...d, isRequired: c === true }))
              }
            />
            <Label htmlFor="cf-required">
              Required before an item can be marked Done
            </Label>
          </div>

          {error && (
            <p className="text-error text-sm" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button type="submit">
              {isEdit ? "Save field" : "Create field"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
