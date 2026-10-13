"use client";

import { GaugeIcon } from "@phosphor-icons/react";
import Link from "next/link";
import type { WorkspaceOverviewData } from "@/app/actions/workspace-overview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDay } from "@/lib/due-date";

interface SprintOverviewProps {
  sprints: WorkspaceOverviewData["activeSprints"];
  workspaceId: string;
}

export function SprintOverview({ workspaceId, sprints }: SprintOverviewProps) {
  return (
    <Card id="sprint-overview">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 normal-case text-lg font-semibold tracking-normal">
          <GaugeIcon className="size-4.5 text-base-content/60" />
          Sprint Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sprints.map((s) => (
            <Link
              className="rounded-xl border border-base-300 p-4 hover:bg-base-200/30 transition-colors"
              href={`/${workspaceId}/${s.spaceId}/sprint/${s.id}`}
              key={s.id}
            >
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-base-content/60">
                  {s.spaceName}
                </span>
              </div>
              <p className="mt-1 truncate text-base font-semibold text-base-content">
                {s.name}
              </p>

              <div className="mt-3 flex items-end justify-between gap-2">
                <span className="text-2xl font-bold leading-none tracking-tight tabular-nums text-base-content">
                  {s.completionPercent}%
                </span>
                <span className="shrink-0 text-xs text-base-content/60">
                  {s.completedTasks}/{s.totalTasks} done
                </span>
              </div>
              <Progress className="mt-2 h-2.5" value={s.completionPercent} />

              <div className="mt-2.5 flex items-center justify-between text-xs text-base-content/60">
                <span>
                  {s.daysRemaining === null
                    ? "No end date"
                    : s.daysRemaining === 0
                      ? "Ends today"
                      : `${s.daysRemaining} day${s.daysRemaining === 1 ? "" : "s"} left`}
                </span>
                {s.endDate && <span>Ends {formatDay(s.endDate)}</span>}
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
