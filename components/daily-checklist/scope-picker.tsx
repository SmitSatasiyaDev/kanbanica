import { ListChecksIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export type ChecklistScope = "personal" | "assigned";

const OPTIONS: {
  Icon: typeof ListChecksIcon;
  description: string;
  label: string;
  scope: ChecklistScope;
  tone: string;
}[] = [
  {
    scope: "personal",
    label: "My Checklist",
    description: "Your personal checklist",
    Icon: ListChecksIcon,
    tone: "bg-primary/15 text-primary",
  },
  {
    scope: "assigned",
    label: "Assigned",
    description: "Checklists assigned to you",
    Icon: UsersThreeIcon,
    tone: "bg-info/15 text-info",
  },
];

/** Step one of the user Checklist: choose which checklist to open. */
export function ScopePicker({
  onSelect,
}: {
  onSelect: (scope: ChecklistScope) => void;
}) {
  return (
    <section aria-labelledby="cl-scope-heading" className="space-y-4">
      <h2 className="font-semibold text-lg" id="cl-scope-heading">
        What do you want to view?
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(({ scope, label, description, Icon, tone }) => (
          <button
            className={cn(
              "flex items-center gap-4 rounded-xl border border-base-300 bg-elevated p-5 text-left transition-colors",
              "hover:border-primary hover:bg-base-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            )}
            key={scope}
            onClick={() => onSelect(scope)}
            type="button"
          >
            <span
              aria-hidden
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full",
                tone
              )}
            >
              <Icon className="size-5" weight="fill" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-sm uppercase tracking-wide">
                {label}
              </span>
              <span className="block text-base-content/60 text-sm">
                {description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
