import type { ReactNode } from "react";

/**
 * One content container for the whole Checklist feature (My/Assigned/Today/History, Admin
 * Templates/Today/History, Create/Edit template) so header, tabs and content share the same
 * left/right edges. Full available width (no max-width cap); wide tables like the History matrix scroll inside their own container.
 */
export default function DailyChecklistLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {children}
    </div>
  );
}
