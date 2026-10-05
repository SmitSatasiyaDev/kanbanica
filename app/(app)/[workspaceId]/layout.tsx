import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { ADMIN_ROLE } from "@/config/platform";
import {
  channel,
  list,
  space,
  spaceMember,
  sprint,
  task,
  user,
  workspace,
  workspaceMember,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getAccessibleSpaceIds,
  getWorkspaceMembership,
} from "@/lib/permissions";
import { notDeleted } from "@/lib/task-visibility";
import { getWorkspaceCapacity } from "@/lib/workspace-limits";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  const userId = session.user.id;

  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    notFound();
  }

  const [
    ws,
    currentUserRow,
    allMemberships,
    spaceIds,
    archivedSpaceIds,
    channels,
  ] = await Promise.all([
    db
      .select({
        id: workspace.id,
        name: workspace.name,
        logoEmoji: workspace.logoEmoji,
        theme: workspace.theme,
      })
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), eq(workspace.status, "ACTIVE")))
      .limit(1)
      .then((r) => r[0] ?? null),
    // Appearance mode is personal, not workspace state — sourced from the
    // signed-in user's own row, never from `workspace`.
    db
      .select({ appearanceMode: user.appearanceMode })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        workspaceId: workspaceMember.workspaceId,
        name: workspace.name,
        logoEmoji: workspace.logoEmoji,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
      .where(
        and(
          eq(workspaceMember.userId, userId),
          eq(workspaceMember.status, "ACTIVE"),
          eq(workspace.status, "ACTIVE")
        )
      )
      .orderBy(asc(workspaceMember.createdAt)),
    getAccessibleSpaceIds(userId, workspaceId),
    getAccessibleSpaceIds(userId, workspaceId, true),
    db
      .select({
        id: channel.id,
        name: channel.name,
        createdAt: channel.createdAt,
      })
      .from(channel)
      .where(eq(channel.workspaceId, workspaceId))
      .orderBy(asc(channel.createdAt)),
  ]);

  if (!ws) {
    notFound();
  }

  // Limit + usage for the task-limit banner (usage is only counted when a
  // limit is set).
  const taskCapacity = await getWorkspaceCapacity(workspaceId);

  const [spaces, archivedSpaces] = await Promise.all([
    spaceIds.length > 0
      ? db
          .select({
            id: space.id,
            name: space.name,
            color: space.color,
            logoEmoji: space.logoEmoji,
            isPrivate: space.isPrivate,
            sprintDateFormat: space.sprintDateFormat,
          })
          .from(space)
          .where(and(inArray(space.id, spaceIds), eq(space.isArchived, false)))
          .orderBy(asc(space.orderIndex), asc(space.createdAt))
      : Promise.resolve(
          [] as {
            id: string;
            name: string;
            color: string | null;
            logoEmoji: string | null;
            isPrivate: boolean;
            sprintDateFormat: string;
          }[]
        ),
    archivedSpaceIds.length > 0
      ? db
          .select({
            id: space.id,
            name: space.name,
            color: space.color,
            logoEmoji: space.logoEmoji,
            isPrivate: space.isPrivate,
            sprintDateFormat: space.sprintDateFormat,
          })
          .from(space)
          .where(inArray(space.id, archivedSpaceIds))
          .orderBy(asc(space.orderIndex), asc(space.createdAt))
      : Promise.resolve(
          [] as {
            id: string;
            name: string;
            color: string | null;
            logoEmoji: string | null;
            isPrivate: boolean;
            sprintDateFormat: string;
          }[]
        ),
  ]);

  const isAdminOrOwner =
    membership.role === "OWNER" || membership.role === "ADMIN";

  const spaceListMap: Record<
    string,
    {
      id: string;
      name: string;
      color: string | null;
      description: string | null;
      taskCount: number;
    }[]
  > = {};
  // Per-space canManageList: OWNER/ADMIN always can; others need FULL_ACCESS in spaceMember
  const spaceCanManageMap: Record<string, boolean> = {};
  const archivedListsBySpace: Record<
    string,
    {
      id: string;
      name: string;
      color: string | null;
      description: string | null;
    }[]
  > = {};

  if (spaces.length > 0) {
    const spaceIdList = spaces.map((s) => s.id);

    const [lists, spacePermissions, archivedListRows, listTaskCounts] =
      await Promise.all([
        db
          .select({
            id: list.id,
            name: list.name,
            spaceId: list.spaceId,
            color: list.color,
            description: list.description,
          })
          .from(list)
          .where(
            and(inArray(list.spaceId, spaceIdList), eq(list.isArchived, false))
          )
          .orderBy(asc(list.orderIndex), asc(list.createdAt)),

        isAdminOrOwner
          ? Promise.resolve([] as { spaceId: string; permission: string }[])
          : db
              .select({
                spaceId: spaceMember.spaceId,
                permission: spaceMember.permission,
              })
              .from(spaceMember)
              .where(
                and(
                  eq(spaceMember.userId, userId),
                  inArray(spaceMember.spaceId, spaceIdList)
                )
              ),

        // Fetch archived lists for active spaces
        db
          .select({
            id: list.id,
            name: list.name,
            spaceId: list.spaceId,
            color: list.color,
            description: list.description,
          })
          .from(list)
          .where(
            and(inArray(list.spaceId, spaceIdList), eq(list.isArchived, true))
          )
          .orderBy(asc(list.orderIndex), asc(list.createdAt)),

        // Total tasks per list for the sidebar count badge — top-level
        // (non-subtask), non-archived tasks, matching the List view's own
        // "N tasks" header count.
        db
          .select({ listId: task.listId, count: count() })
          .from(task)
          .where(
            and(
              inArray(task.spaceId, spaceIdList),
              notDeleted(),
              eq(task.isArchived, false),
              isNull(task.parentTaskId)
            )
          )
          .groupBy(task.listId),
      ]);

    const taskCountByListId: Record<string, number> = {};
    for (const row of listTaskCounts) {
      if (row.listId) {
        taskCountByListId[row.listId] = row.count;
      }
    }

    for (const l of archivedListRows) {
      if (!archivedListsBySpace[l.spaceId]) {
        archivedListsBySpace[l.spaceId] = [];
      }
      archivedListsBySpace[l.spaceId].push({
        id: l.id,
        name: l.name,
        color: l.color,
        description: l.description,
      });
    }

    for (const l of lists) {
      if (!spaceListMap[l.spaceId]) {
        spaceListMap[l.spaceId] = [];
      }
      spaceListMap[l.spaceId].push({
        id: l.id,
        name: l.name,
        color: l.color,
        description: l.description,
        taskCount: taskCountByListId[l.id] ?? 0,
      });
    }

    const permMap: Record<string, string> = {};
    for (const sp of spacePermissions) {
      permMap[sp.spaceId] = sp.permission;
    }

    for (const s of spaces) {
      spaceCanManageMap[s.id] =
        isAdminOrOwner || permMap[s.id] === "FULL_ACCESS";
    }
  }

  // Fetch active + planned sprints for all accessible spaces
  const sprintsBySpace: Record<
    string,
    {
      id: string;
      name: string;
      status: "PLANNED" | "ACTIVE" | "CLOSED";
      startDate: Date | null;
      endDate: Date | null;
    }[]
  > = {};
  if (spaces.length > 0) {
    const spaceIdList = spaces.map((s) => s.id);
    const sprintRows = await db
      .select({
        id: sprint.id,
        name: sprint.name,
        status: sprint.status,
        spaceId: sprint.spaceId,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
      })
      .from(sprint)
      .where(
        and(
          inArray(sprint.spaceId, spaceIdList),
          inArray(sprint.status, ["ACTIVE", "PLANNED"])
        )
      )
      .orderBy(asc(sprint.createdAt));
    for (const sp of sprintRows) {
      if (!sprintsBySpace[sp.spaceId]) {
        sprintsBySpace[sp.spaceId] = [];
      }
      sprintsBySpace[sp.spaceId].push({
        id: sp.id,
        name: sp.name,
        status: sp.status,
        startDate: sp.startDate,
        endDate: sp.endDate,
      });
    }
  }

  return (
    <ThemeProvider
      initialAppearanceMode={
        (currentUserRow?.appearanceMode ?? "auto") as "light" | "dark" | "auto"
      }
      initialTheme={ws.theme}
      workspaceId={workspaceId}
    >
      <RealtimeProvider workspaceId={workspaceId}>
        <WorkspaceShell
          archivedSpaces={archivedSpaces.map((s) => ({
            ...s,
            lists: [],
            archivedLists: [],
            sprints: [],
            canManageList: isAdminOrOwner,
            sprintDateFormat: s.sprintDateFormat ?? "MM/DD",
          }))}
          channels={channels}
          isPlatformAdmin={session.user.role === ADMIN_ROLE}
          role={membership.role}
          spaces={spaces.map((s) => ({
            ...s,
            lists: spaceListMap[s.id] ?? [],
            archivedLists: archivedListsBySpace[s.id] ?? [],
            canManageList: spaceCanManageMap[s.id] ?? isAdminOrOwner,
            sprints: sprintsBySpace[s.id] ?? [],
          }))}
          taskCapacity={{ limit: taskCapacity.limit, used: taskCapacity.used }}
          user={{
            name: session.user.name ?? null,
            email: session.user.email,
            image: session.user.image ?? null,
          }}
          workspace={ws}
          workspaces={allMemberships.map((m) => ({
            id: m.workspaceId,
            name: m.name,
            logoEmoji: m.logoEmoji,
          }))}
        >
          {children}
        </WorkspaceShell>
      </RealtimeProvider>
    </ThemeProvider>
  );
}
