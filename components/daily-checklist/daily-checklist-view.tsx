"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { MemberFilter } from "@/lib/daily-checklist/team-aggregate";
import { MyChecklistPanel } from "./my-checklist-panel";
import { type ChecklistScope, ScopePicker } from "./scope-picker";
import { TeamChecklistPanel } from "./team-checklist-panel";
import { setUrlParams } from "./url-state";

export function DailyChecklistView({
  workspaceId,
  canSeeTeam,
  isAdmin,
  initialScope,
  initialView,
  initialFilter,
  today,
}: {
  canSeeTeam: boolean;
  initialFilter: MemberFilter;
  initialScope: ChecklistScope | null;
  initialView: "today" | "history";
  isAdmin: boolean;
  today: string;
  workspaceId: string;
}) {
  // Guests only have a personal checklist, so there is nothing to choose.
  const [scope, setScope] = useState<ChecklistScope | null>(
    canSeeTeam ? initialScope : "personal"
  );

  // The chosen scope lives in the URL so a refresh or a direct link lands on the same checklist.
  function choose(next: ChecklistScope | null) {
    setScope(next);
    setUrlParams({ scope: next, tab: null, view: null, filter: null });
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4" data-stable-gutter>
      {scope && canSeeTeam && (
        <button
          className="inline-flex items-center gap-1.5 rounded-md text-base-content/60 text-sm transition-colors hover:text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => choose(null)}
          type="button"
        >
          <ArrowLeftIcon aria-hidden className="size-3.5" />
          Change checklist
        </button>
      )}
      <h1 className="sr-only">Checklist</h1>
      {scope === null ? (
        <ScopePicker onSelect={choose} />
      ) : scope === "personal" ? (
        <MyChecklistPanel
          initialView={initialView}
          today={today}
          workspaceId={workspaceId}
        />
      ) : (
        <TeamChecklistPanel
          initialFilter={initialFilter}
          initialView={initialView}
          isAdmin={isAdmin}
          today={today}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}
