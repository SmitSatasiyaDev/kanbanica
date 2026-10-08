import type { FieldValueDTO } from "./types";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Human-readable stored value; null when the field has no saved value. Uses the day's own snapshot. */
export function formatSavedFieldValue(
  f: Pick<FieldValueDTO, "type" | "value" | "options">
): string | null {
  if (f.value === null || f.value === undefined || f.value.trim() === "") {
    return null;
  }
  switch (f.type) {
    case "DROPDOWN":
      return f.options?.find((o) => o.value === f.value)?.label ?? f.value;
    case "CHECKBOX":
      return f.value === "true" ? "Yes" : "No";
    case "DATE": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.value);
      return m
        ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
        : f.value;
    }
    default:
      return f.value;
  }
}

export interface FieldSummaryEntry {
  id: string;
  label: string;
  text: string;
}

/** Fields that have a saved value, in the template's (snapshotted) order. */
export function summarizeFieldValues(
  fields: FieldValueDTO[] | undefined
): FieldSummaryEntry[] {
  return [...(fields ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((f) => {
      const text = formatSavedFieldValue(f);
      return text === null ? [] : [{ id: f.id, label: f.name, text }];
    });
}
