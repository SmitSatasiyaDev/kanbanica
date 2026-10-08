// Pure / client-safe helpers for Checklist custom fields.

export const FIELD_TYPES = [
  "TEXT",
  "DROPDOWN",
  "NUMBER",
  "DATE",
  "CHECKBOX",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Text",
  DROPDOWN: "Dropdown",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
};

export const FIELD_LIMITS = {
  name: 100,
  optionLabel: 100,
  options: 50,
  fieldsPerTemplate: 20,
  textValue: 500,
} as const;

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldSnapshot {
  options: FieldOption[] | null;
  required: boolean;
  type: FieldType;
}

/** Stable option value derived from its label; `taken` guarantees uniqueness within a field. */
export function optionValueFor(label: string, taken: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "option";
  let v = base;
  for (let i = 2; taken.has(v); i++) {
    v = `${base}-${i}`;
  }
  taken.add(v);
  return v;
}

const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
};

export type ValueResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Validates + canonicalises a value against a field snapshot. Empty input is "unset" (null);
 * whether empty is allowed is decided separately by `isMissing` (required fields).
 */
export function normalizeFieldValue(
  field: FieldSnapshot,
  raw: unknown
): ValueResult {
  if (
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "")
  ) {
    return { ok: true, value: null };
  }
  switch (field.type) {
    case "TEXT": {
      if (typeof raw !== "string") {
        return { ok: false, error: "Text value must be a string" };
      }
      const v = raw.trim();
      if (v.length > FIELD_LIMITS.textValue) {
        return {
          ok: false,
          error: `Text must be ${FIELD_LIMITS.textValue} characters or fewer`,
        };
      }
      return { ok: true, value: v };
    }
    case "NUMBER": {
      const s =
        typeof raw === "number"
          ? String(raw)
          : typeof raw === "string"
            ? raw.trim()
            : "";
      if (
        !/^-?\d+(\.\d+)?$/.test(s) ||
        !Number.isFinite(Number(s)) ||
        s.length > 30
      ) {
        return { ok: false, error: "Value must be a valid number" };
      }
      return { ok: true, value: String(Number(s)) };
    }
    case "DATE": {
      if (typeof raw !== "string" || !isRealDate(raw.trim())) {
        return { ok: false, error: "Value must be a valid date (YYYY-MM-DD)" };
      }
      return { ok: true, value: raw.trim() };
    }
    case "CHECKBOX": {
      const s = String(raw).trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(s)) {
        return { ok: true, value: "true" };
      }
      if (["false", "0", "no", "off"].includes(s)) {
        return { ok: true, value: "false" };
      }
      return { ok: false, error: "Value must be true or false" };
    }
    case "DROPDOWN": {
      if (
        typeof raw !== "string" ||
        !(field.options ?? []).some((o) => o.value === raw)
      ) {
        return {
          ok: false,
          error: "Value is not one of the available options",
        };
      }
      return { ok: true, value: raw };
    }
    default:
      return { ok: false, error: "Unsupported field type" };
  }
}

/** Required-field check. An unchecked required checkbox counts as missing. */
export function isMissing(
  field: { required: boolean; type: FieldType },
  value: string | null
): boolean {
  if (!field.required) {
    return false;
  }
  if (field.type === "CHECKBOX") {
    return value !== "true";
  }
  return value === null || value === "";
}
