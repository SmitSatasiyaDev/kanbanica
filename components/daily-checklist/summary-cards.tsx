import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export interface SummaryCardSpec {
  /** Toggle state for a filter card (omit for a card that only resets). Styles + aria-pressed. */
  active?: boolean;
  /** Small secondary line under the label. */
  hint?: string;
  Icon: Icon;
  label: string;
  /** Set → the card is a button (History filters). Unset → a plain, non-interactive card. */
  onClick?: () => void;
  title?: string;
  tone: string;
  /** Rendered as the big number / text. */
  value: React.ReactNode;
}

const base =
  "flex min-w-0 items-center gap-3 rounded-xl border bg-elevated p-3 text-left sm:p-4";
const baseCompact =
  "flex min-w-0 items-center gap-3 rounded-xl border bg-elevated px-3 py-2.5 text-left";

/** The History / Today summary row: one visual language, filters (button) or display-only (div). */
export function SummaryCardGrid({
  cards,
  compact = false,
}: {
  cards: SummaryCardSpec[];
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 lg:grid-cols-4",
        compact ? "gap-2" : "gap-3"
      )}
    >
      {cards.map((c) => {
        const body = (
          <>
            <span
              aria-hidden
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full",
                compact ? "size-8" : "size-10 sm:size-11",
                c.tone
              )}
            >
              <c.Icon className={compact ? "size-4" : "size-5"} weight="fill" />
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block font-semibold tabular-nums leading-tight",
                  compact ? "text-lg" : "text-xl sm:text-2xl"
                )}
              >
                {c.value}
              </span>
              <span className="block truncate text-base-content/60 text-xs sm:text-sm">
                {c.label}
              </span>
              {c.hint && (
                <span className="block truncate text-base-content/50 text-xs tabular-nums">
                  {c.hint}
                </span>
              )}
            </span>
          </>
        );
        if (!c.onClick) {
          return (
            <div
              className={cn(compact ? baseCompact : base, "border-base-300")}
              key={c.label}
            >
              {body}
            </div>
          );
        }
        return (
          <button
            aria-pressed={c.active}
            className={cn(
              compact ? baseCompact : base,
              "transition-colors hover:bg-base-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              c.active
                ? "border-primary bg-base-200 ring-1 ring-primary"
                : "border-base-300"
            )}
            key={c.label}
            onClick={c.onClick}
            title={c.title}
            type="button"
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
