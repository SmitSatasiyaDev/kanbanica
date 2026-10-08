"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MemberFilter } from "@/lib/daily-checklist/team-aggregate";
import { MyChecklistPanel } from "./my-checklist-panel";
import { TeamChecklistPanel } from "./team-checklist-panel";
import { setUrlParams } from "./url-state";

export function DailyChecklistView({
  workspaceId,
  canSeeTeam,
  isAdmin,
  initialTab,
  initialView,
  initialFilter,
  today,
}: {
  canSeeTeam: boolean;
  initialFilter: MemberFilter;
  initialTab: "my" | "team";
  initialView: "today" | "history";
  isAdmin: boolean;
  today: string;
  workspaceId: string;
}) {
  const [tab, setTab] = useState<"my" | "team">(canSeeTeam ? initialTab : "my");

  // Remember the chosen tab in the URL so a refresh stays put. Entering the page without a
  // `tab` param opens "Assigned" (the default for anyone who can see it).
  function changeTab(next: "my" | "team") {
    setTab(next);
    setUrlParams({ tab: next, view: null, filter: null });
  }

  return (
    <div className="space-y-6">
      {canSeeTeam && (
        <Tabs onValueChange={(v) => changeTab(v as "my" | "team")} value={tab}>
          <TabsList aria-label="Checklist">
            <TabsTrigger value="my">My Checklist</TabsTrigger>
            <TabsTrigger value="team">Assigned</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {tab === "my" ? (
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
