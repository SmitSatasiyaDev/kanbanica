import { z } from "zod";
import {
  CHECKLIST_PRIORITIES,
  CHECKLIST_STATUSES,
  DATE_RE,
  LIMITS,
  RECURRENCES,
  TIME_RE,
} from "./constants";
import { FIELD_LIMITS, FIELD_TYPES } from "./fields";

const title = z.string().trim().min(1, "Title is required").max(LIMITS.title);
const optionalText = z
  .string()
  .trim()
  .max(LIMITS.text)
  .nullish()
  .transform((v) => (v ? v : null));
const dueTime = z
  .string()
  .regex(TIME_RE, "Due time must be HH:MM")
  .nullish()
  .transform((v) => v || null);
const isoDate = z
  .string()
  .regex(DATE_RE, "Invalid date")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "Invalid date");

export const dateSchema = isoDate;
export const statusSchema = z.enum(CHECKLIST_STATUSES);
export const prioritySchema = z.enum(CHECKLIST_PRIORITIES);

export const itemFieldsSchema = z.object({
  title,
  description: optionalText,
  notes: optionalText,
  priority: prioritySchema.default("NONE"),
  dueTime,
});

export const itemPatchSchema = z
  .object({
    title,
    description: optionalText,
    notes: optionalText,
    priority: prioritySchema,
    dueTime,
  })
  .partial();

export const templateItemSchema = z.object({
  title,
  description: optionalText,
  priority: prioritySchema.default("NONE"),
  dueTime,
});

export const fieldSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z
      .string()
      .trim()
      .min(1, "Field name is required")
      .max(FIELD_LIMITS.name, "Field name is too long"),
    type: z.enum(FIELD_TYPES, { error: "Unsupported field type" }),
    isRequired: z.boolean().default(false),
    // true = every template item (the default, matching every pre-existing field);
    // false = only the items referenced by `itemKeys` (template item ids, or the client
    // key of an item created in the same save).
    // undefined = unspecified: new fields apply to all items, updates keep what is stored.
    appliesToAll: z.boolean().optional(),
    itemKeys: z.array(z.string().min(1)).max(LIMITS.templateItems).default([]),
    options: z
      .array(
        z.object({
          label: z
            .string()
            .trim()
            .min(1, "Option label is required")
            .max(FIELD_LIMITS.optionLabel, "Option label is too long"),
        })
      )
      .max(FIELD_LIMITS.options)
      .default([]),
  })
  .superRefine((v, ctx) => {
    if (v.appliesToAll === false && v.itemKeys.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["itemKeys"],
        message: "Select at least one checklist item for this field",
      });
    }
    if (v.type !== "DROPDOWN") {
      return;
    }
    if (v.options.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "A dropdown needs at least one option",
      });
    }
    const seen = new Set<string>();
    for (const o of v.options) {
      const k = o.label.toLowerCase();
      if (seen.has(k)) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: `Duplicate option "${o.label}"`,
        });
        return;
      }
      seen.add(k);
    }
  })
  .transform((v) => ({
    ...v,
    options: v.type === "DROPDOWN" ? v.options : [],
    itemKeys: v.appliesToAll === false ? [...new Set(v.itemKeys)] : [],
  }));

export type FieldInput = z.infer<typeof fieldSchema>;

export const templateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(LIMITS.templateName),
    description: optionalText,
    recurrence: z.enum(RECURRENCES),
    recurrenceDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    startDate: isoDate,
    endDate: isoDate.nullish().transform((v) => v ?? null),
    items: z.array(templateItemSchema).max(LIMITS.templateItems).default([]),
    fields: z
      .array(fieldSchema)
      .max(FIELD_LIMITS.fieldsPerTemplate)
      .default([]),
    assigneeIds: z.array(z.string().min(1)).max(LIMITS.assignees).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.recurrence !== "ONCE" && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be on or after the start date",
      });
    }
    const names = new Set<string>();
    for (const f of v.fields) {
      const k = f.name.toLowerCase();
      if (names.has(k)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields"],
          message: `Duplicate field name "${f.name}"`,
        });
        break;
      }
      names.add(k);
    }
    if (v.recurrence === "CUSTOM" && v.recurrenceDays.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrenceDays"],
        message: "Pick at least one weekday",
      });
    }
  })
  .transform((v) => ({
    ...v,
    // A one-time template has no end date; never persist an irrelevant one.
    endDate: v.recurrence === "ONCE" ? null : v.endDate,
    recurrenceDays:
      v.recurrence === "WEEKLY" || v.recurrence === "CUSTOM"
        ? [...new Set(v.recurrenceDays)].sort((a, b) => a - b)
        : [],
    assigneeIds: [...new Set(v.assigneeIds)],
  }));

export type TemplateInput = z.infer<typeof templateSchema>;

/** First zod issue as a user-facing message. */
export function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}
