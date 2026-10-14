import {
  daysBetween,
  dueStatus,
  formatDayWithWeekday,
  toDay,
} from "@/lib/due-date";

/**
 * "5 days overdue" / "Due today" / "Due tomorrow" / "Due Mon, Jan 5" — from the
 * due day alone. `today` is the viewer's day (`useToday()` / `getUserToday()`).
 */
export function describeDeadline(
  dueDate: string | Date,
  today: string
): {
  text: string;
  overdue: boolean;
} {
  const due = toDay(dueDate) ?? today;
  const status = dueStatus(due, today);
  if (status === "overdue") {
    const days = daysBetween(due, today);
    return {
      text: `${days} day${days === 1 ? "" : "s"} overdue`,
      overdue: true,
    };
  }
  if (status === "today") {
    return { text: "Due today", overdue: false };
  }
  if (status === "tomorrow") {
    return { text: "Due tomorrow", overdue: false };
  }
  return { text: `Due ${formatDayWithWeekday(due)}`, overdue: false };
}
