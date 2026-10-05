/**
 * Case-insensitive, partial-match filter for member pickers. Matches the
 * member's display name (falling back to email when there is no name, which is
 * what the pickers show). A blank/whitespace query returns the list unchanged.
 */
export function filterMembersByQuery<
  T extends { name?: string | null; email?: string | null },
>(members: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return members;
  }
  return members.filter((m) =>
    (m.name || m.email || "").toLowerCase().includes(q)
  );
}
