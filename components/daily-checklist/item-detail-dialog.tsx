"use client";

import { CalendarBlankIcon } from "@phosphor-icons/react";
import { format, parse } from "date-fns";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { setChecklistItemFieldValues } from "@/app/actions/daily-checklist";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatSavedFieldValue } from "@/lib/daily-checklist/field-summary";
import { FIELD_LIMITS } from "@/lib/daily-checklist/fields";
import type { FieldValueDTO } from "@/lib/daily-checklist/types";

const ISO = "yyyy-MM-dd";
const NONE = "__none__";

/** Value for the dialog/history; "—" when unset. */
export function displayFieldValue(f: FieldValueDTO): string {
  return formatSavedFieldValue(f) ?? "—";
}

export function ItemDetailDialog({
  workspaceId,
  itemId,
  title,
  fields,
  editable,
  onClose,
  onSaved,
}: {
  editable: boolean;
  fields: FieldValueDTO[];
  itemId: string | null;
  onClose: () => void;
  onSaved: () => void;
  title: string;
  workspaceId: string;
}) {
  const [values, setValues] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (itemId) {
      setValues(Object.fromEntries(fields.map((f) => [f.id, f.value])));
      setError(null);
    }
  }, [itemId, fields]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId) {
      return;
    }
    setBusy(true);
    const res = await setChecklistItemFieldValues(workspaceId, itemId, values);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    toast.success("Saved");
    onSaved();
    onClose();
  }

  return (
    <Dialog onOpenChange={(o) => !o && onClose()} open={itemId !== null}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl sm:max-w-md">
        <form className="space-y-4" onSubmit={save}>
          <DialogHeader>
            <DialogTitle className="break-words">{title}</DialogTitle>
            <DialogDescription>
              {fields.length === 0
                ? "This item has no custom fields."
                : editable
                  ? "Fill in the details for this item."
                  : "Read-only."}
            </DialogDescription>
          </DialogHeader>
          {fields.map((f) => (
            <div className="space-y-1.5" key={f.id}>
              <Label htmlFor={`fv-${f.id}`}>
                {f.name}
                {f.required && <span className="text-error"> *</span>}
              </Label>
              {editable ? (
                <FieldInput
                  field={f}
                  onChange={(v) => setValues((p) => ({ ...p, [f.id]: v }))}
                  value={values[f.id] ?? null}
                />
              ) : (
                <p className="text-sm" id={`fv-${f.id}`}>
                  {displayFieldValue(f)}
                </p>
              )}
            </div>
          ))}
          {error && (
            <p className="text-error text-sm" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              {editable && fields.length > 0 ? "Cancel" : "Close"}
            </Button>
            {editable && fields.length > 0 && (
              <Button disabled={busy} type="submit">
                Save
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldValueDTO;
  onChange: (v: string | null) => void;
  value: string | null;
}) {
  const id = `fv-${field.id}`;
  switch (field.type) {
    case "DROPDOWN":
      return (
        <Select
          onValueChange={(v) => onChange(v === NONE ? null : v)}
          value={value ?? NONE}
        >
          <SelectTrigger aria-label={field.name} className="w-full" id={id}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent className="p-1.5">
            {!field.required && <SelectItem value={NONE}>—</SelectItem>}
            {(field.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "NUMBER":
      return (
        <Input
          id={id}
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          step="any"
          type="number"
          value={value ?? ""}
        />
      );
    case "CHECKBOX":
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            aria-label={field.name}
            checked={value === "true"}
            id={id}
            onCheckedChange={(c) => onChange(c === true ? "true" : "false")}
          />
          <span className="text-sm">{value === "true" ? "Yes" : "No"}</span>
        </div>
      );
    case "DATE":
      return (
        <DateInput
          id={id}
          label={field.name}
          onChange={onChange}
          value={value}
        />
      );
    default:
      return (
        <Input
          id={id}
          maxLength={FIELD_LIMITS.textValue}
          onChange={(e) => onChange(e.target.value)}
          value={value ?? ""}
        />
      );
  }
}

function DateInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  onChange: (v: string | null) => void;
  value: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          className="flex h-10 w-full items-center gap-2 rounded-md border border-base-300 px-3 text-sm transition-colors hover:bg-base-200"
          id={id}
          type="button"
        >
          <CalendarBlankIcon className="size-3.5 shrink-0 text-base-content/60" />
          <span className={value ? "" : "text-base-content/60"}>
            {value
              ? format(parse(value, ISO, new Date()), "MMM d, yyyy")
              : "Pick a date"}
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
          selected={value ? parse(value, ISO, new Date()) : undefined}
        />
        {value && (
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
  );
}
