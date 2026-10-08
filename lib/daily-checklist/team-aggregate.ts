import type { ChecklistStatus } from "./constants";
import type { TeamItemRow } from "./types";

export type TeamFilter = "all" | "mine" | "pending" | "done";

/** The member-facing Team Checklist filters. There is no "all" tab; "mine" is the default. */
export type MemberFilter = Exclude<TeamFilter, "all">;

/** Any unknown/legacy value (including the removed "all") falls back to "mine". */
export function normalizeMemberFilter(v: unknown): MemberFilter {
  return v === "pending" || v === "done" || v === "mine" ? v : "mine";
}

export interface TeamGroup {
  /** Done members (no. of members whose own item is DONE). */
  completed: number;
  dueTime: string | null;
  key: string;
  /** One entry per assignee — each is that person's own, untouched daily item. */
  members: TeamItemRow[];
  priority: TeamItemRow["priority"];
  status: ChecklistStatus;
  templateName: string | null;
  title: string;
  total: number;
}

/**
 * Identity of one logical checklist item for a day: the template + the template item the
 * daily items were snapshotted from. Titles are never used on their own (two items can share
 * one). If the template item was later deleted (`templateItemId` is null on every copy) the
 * snapshot's order + title within the template stands in for it.
 */
export function groupKey(
  r: Pick<TeamItemRow, "templateId" | "templateItemId" | "sortOrder" | "title">
): string {
  const item = r.templateItemId ?? `~${r.sortOrder}~${r.title}`;
  return `${r.templateId ?? ""}:${item}`;
}

/** Presentation-only aggregation of per-user daily items; the rows themselves are never merged or altered. */
export function groupTeamRows(rows: TeamItemRow[]): TeamGroup[] {
  const map = new Map<string, TeamItemRow[]>();
  for (const r of rows) {
    const k = groupKey(r);
    const list = map.get(k);
    if (list) {
      list.push(r);
    } else {
      map.set(k, [r]);
    }
  }
  return [...map.entries()].map(([key, members]) => {
    const completed = members.filter((m) => m.status === "DONE").length;
    const total = members.length;
    const status: ChecklistStatus =
      completed === total
        ? "DONE"
        : completed > 0 || members.some((m) => m.status === "IN_PROGRESS")
          ? "IN_PROGRESS"
          : "PENDING";
    const first = members[0];
    return {
      key,
      title: first.title,
      templateName: first.templateName,
      priority: first.priority,
      dueTime: first.dueTime,
      members,
      completed,
      total,
      status,
    };
  });
}

/** Pending = at least one assignee isn't Done. Done = every assignee is Done. */
export function filterTeamGroups(
  groups: TeamGroup[],
  filter: Exclude<TeamFilter, "mine">
): TeamGroup[] {
  switch (filter) {
    case "pending":
      return groups.filter((g) => g.completed < g.total);
    case "done":
      return groups.filter((g) => g.completed === g.total);
    default:
      return groups;
  }
}

/** "My Assigned": the viewer's own items, never aggregated. */
export function myRows(rows: TeamItemRow[]): TeamItemRow[] {
  return rows.filter((r) => r.editable);
}

/**
 * Member Team Checklist filters, applied to the viewer's OWN items only: Status = all of them,
 * Pending = not Done yet (pending or in progress), Done = Done. Never includes teammates' items.
 */
export function filterMyRows(
  rows: TeamItemRow[],
  filter: MemberFilter
): TeamItemRow[] {
  const mine = myRows(rows);
  switch (filter) {
    case "pending":
      return mine.filter((r) => r.status !== "DONE");
    case "done":
      return mine.filter((r) => r.status === "DONE");
    default:
      return mine;
  }
}

/** True when the member's item has a saved, non-blank note. */
export function hasNote(r: Pick<TeamItemRow, "notes">): boolean {
  return Boolean(r.notes?.trim());
}

/** Number of members in a group whose own item has a note (one `notes` field per item). */
export function noteCount(members: Pick<TeamItemRow, "notes">[]): number {
  return members.filter(hasNote).length;
}
