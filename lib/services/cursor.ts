import { z } from "zod";

// Opaque paging cursors for the list services. A cursor is base64url JSON of a
// keyset position (the sort key of the last row returned plus its id), never a
// bare offset, so a row added or removed between two pages cannot shift later
// pages. Every cursor carries a kind tag, so a cursor from one list cannot be
// used on another.

export const INVALID_CURSOR_ERROR = "Invalid cursor";

const MAX_CURSOR_LENGTH = 1000;

export type CursorKind =
  | "my_tasks"
  | "search"
  | "projects"
  | "lists"
  | "members"
  | "notifications"
  | "sprint_tasks"
  | "comments";

export function encodeCursor(kind: CursorKind, position: object): string {
  return Buffer.from(JSON.stringify({ k: kind, ...position }), "utf8").toString(
    "base64url"
  );
}

// Decodes and checks a cursor against the shape for its kind. Returns null for
// anything that is not exactly what `encodeCursor` produces: bad base64, bad
// JSON, the wrong kind, or fields of the wrong type.
export function decodeCursor<S extends z.ZodType>(
  kind: CursorKind,
  raw: string,
  shape: S
): z.infer<S> | null {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(raw)
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { k?: unknown }).k !== kind
  ) {
    return null;
  }
  const { k: _kind, ...rest } = parsed as Record<string, unknown>;
  const checked = shape.safeParse(rest);
  return checked.success ? checked.data : null;
}

// Shapes shared by the cursors. Dates are `YYYY-MM-DD` calendar days; instants
// are the database's own text form of a timestamp, kept as text so no
// precision is lost on the way through JavaScript.
export const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const instantString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}[ T][0-9:.]+(Z|[+-]\d{2}(:?\d{2})?)?$/)
  .max(64);
export const idString = z.string().min(1).max(200);

// Fetches one row more than `limit` so the caller knows whether another page
// exists without a second query.
export function pageOf<T>(
  rows: T[],
  limit: number
): { items: T[]; hasMore: boolean } {
  return rows.length > limit
    ? { items: rows.slice(0, limit), hasMore: true }
    : { items: rows, hasMore: false };
}

const sortInt = z.number().int().min(-2_147_483_648).max(2_147_483_647);

// One shape per list. Short keys keep the cursors small.
export const cursorShapes = {
  // Due end day, due start day (null = no date, sorted last), task id.
  my_tasks: z.object({
    e: dayString.nullable(),
    s: dayString.nullable(),
    id: idString,
  }),
  // Last update (text form), task id.
  search: z.object({ u: instantString, id: idString }),
  // Workspace id, order index, project id.
  projects: z.object({ w: idString, o: sortInt, i: idString }),
  // Order index, list id.
  lists: z.object({ o: sortInt, i: idString }),
  // Name, user id.
  members: z.object({ n: z.string().max(500), i: idString }),
  // Created at (text form), notification id.
  notifications: z.object({ c: instantString, i: idString }),
  // Order index, task id.
  sprint_tasks: z.object({ o: sortInt, i: idString }),
  // Created at (text form), comment id.
  comments: z.object({ c: instantString, i: idString }),
} as const;

// Decodes a cursor of the given kind with its own shape.
export function readCursor<K extends keyof typeof cursorShapes>(
  kind: K,
  raw: string
): z.infer<(typeof cursorShapes)[K]> | null {
  return decodeCursor(kind, raw, cursorShapes[kind]) as z.infer<
    (typeof cursorShapes)[K]
  > | null;
}
