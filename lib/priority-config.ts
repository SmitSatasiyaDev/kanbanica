import { formatDay, toDay } from "@/lib/due-date";

export const PRIORITY_CONFIG = {
  NONE: { label: "No Priority", color: "text-gray-400", icon: "😴" },
  LOW: { label: "Low", color: "text-gray-500", icon: "🦥" },
  MEDIUM: { label: "Medium", color: "text-yellow-600", icon: "🚶" },
  HIGH: { label: "High", color: "text-orange-500", icon: "🏃" },
  URGENT: { label: "Urgent", color: "text-red-500", icon: "🚨" },
} as const;

export type Priority = keyof typeof PRIORITY_CONFIG;

export function userInitials(name: string): string {
  if (!name) {
    return "?";
  }
  const clean = name.includes("@") ? name.split("@")[0] : name;
  return (
    clean
      .split(/[\s._-]+/)
      .map((n) => n[0])
      .filter(Boolean)
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

export function avatarSrc(key: string | null | undefined): string | undefined {
  return key ? `/api/files/${key}` : undefined;
}

/** `day` is a stored `YYYY-MM-DD` due day; `today` comes from `useToday()` / `getUserToday()`. */
export function formatDueDate(
  day: string | null,
  today: string
): { label: string; overdue: boolean } | null {
  const due = toDay(day);
  if (!due) {
    return null;
  }
  return {
    label: due === today ? "Today" : formatDay(due),
    overdue: due < today,
  };
}
