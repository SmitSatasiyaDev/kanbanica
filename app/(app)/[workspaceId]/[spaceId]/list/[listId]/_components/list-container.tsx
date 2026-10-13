"use client";

import {
  ArchiveIcon,
  CalendarBlankIcon,
  CopyIcon,
  DotsThreeIcon,
  GearIcon,
  RowsIcon,
  SquaresFourIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useState, useTransition } from "react";
import type { CustomFieldRow } from "@/app/actions/custom-field";
import { archiveList, unarchiveList } from "@/app/actions/list";
import { getArchivedTasksForList } from "@/app/actions/task";
import { DeleteListDialog } from "@/components/list/delete-list-dialog";
import { DuplicateListDialog } from "@/components/list/duplicate-list-dialog";
import { CreateTaskModal } from "@/components/task/create-task-modal";
import type { TaskDependencyIndicator } from "@/components/task/task-dependency-badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PRODUCT_NAME } from "@/config/platform";
import { useSetTopbar } from "@/lib/topbar-context";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";
import { BoardSkeleton } from "./board-skeleton";
import { BoardView } from "./board-view";
import { CalendarView } from "./calendar-view";
import { ListView } from "./list-view";

type View = "list" | "board" | "calendar";

// Remember the last-used List/Board/Calendar tab per list across reloads
// (per-browser), same pattern as list-view/board-view's filter/sort prefs.
// An explicit `?view=` in the URL (e.g. the task detail page's back button)
// always wins over the saved preference, since that's a deliberate "return
// to X" request rather than a fresh visit to the project.
function viewPrefKey(listId: string) {
  return `kanbanica:list-view-tab:${listId}`;
}

function loadViewPref(listId: string): View | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(viewPrefKey(listId));
    return raw === "list" || raw === "board" || raw === "calendar" ? raw : null;
  } catch {
    return null;
  }
}

interface Status {
  color: string;
  id: string;
  name: string;
  orderIndex: number;
  type: "OPEN" | "ACTIVE" | "CLOSED";
}

interface Task {
  assignees: { userId: string; name: string; image: string | null }[];
  customFieldValues?: Record<string, unknown>;
  dependencyInfo?: TaskDependencyIndicator;
  dueDateEnd: string | null;
  dueDateStart: string | null;
  id: string;
  isPinnedToList: boolean;
  orderIndex: number;
  pinnedToListOrder: number | null;
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  seqNumber: number;
  statusId: string | null;
  subtaskCount: number;
  tags: { id: string; name: string; color: string }[];
  title: string;
  trackedSeconds?: number;
}

interface ListContainerProps {
  canEdit: boolean;
  canManage: boolean;
  canPinToList: boolean;
  currentUserId: string;
  customFields?: CustomFieldRow[];
  isAdmin: boolean;
  list: {
    id: string;
    name: string;
    color: string | null;
    description: string | null;
  };
  members: {
    userId: string;
    name: string | null;
    email: string | null;
    image: string | null;
  }[];
  personallyPinnedIds: Set<string>;
  pinnedTasks: Task[];
  space: {
    id: string;
    name: string;
    color: string | null;
    logoEmoji: string | null;
  };
  statuses: Status[];
  tags: { id: string; name: string; color: string }[];
  tasks: Task[];
  workspaceId: string;
}

const VIEWS: { key: View; label: string; icon: React.ReactNode }[] = [
  {
    key: "board",
    label: "Board",
    icon: <SquaresFourIcon className="size-3.5" />,
  },
  { key: "list", label: "List", icon: <RowsIcon className="size-3.5" /> },
  {
    key: "calendar",
    label: "Calendar",
    icon: <CalendarBlankIcon className="size-3.5" />,
  },
];

export function ListContainer({
  workspaceId,
  space,
  list,
  statuses,
  tasks,
  pinnedTasks,
  members,
  tags,
  customFields,
  canManage,
  canEdit,
  isAdmin,
  canPinToList,
  currentUserId,
  personallyPinnedIds,
}: ListContainerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>(
    (searchParams.get("view") as View) ?? "board"
  );

  // Restore the last-used tab for this list once mounted (skipped when the
  // URL already carries an explicit `view`, e.g. arriving via the task
  // detail page's back button — see viewPrefKey above).
  React.useEffect(() => {
    if (searchParams.get("view")) {
      return;
    }
    const saved = loadViewPref(list.id);
    if (saved) {
      setView(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id, searchParams.get]);

  useSetTopbar({
    breadcrumbs: [
      {
        label: space.name,
        color: space.color,
        emoji: space.logoEmoji,
        href: `/${workspaceId}/${space.id}`,
      },
    ],
    title: list.name,
    actions:
      canManage || isAdmin ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="flex size-7 items-center justify-center rounded-md hover:bg-base-200 transition-colors"
              type="button"
            >
              <DotsThreeIcon
                className="size-4.5 text-base-content/70"
                weight="bold"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1">
            {canManage && (
              <>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                  onClick={() =>
                    router.push(
                      `/${workspaceId}/${space.id}/list/${list.id}/settings/general`
                    )
                  }
                  type="button"
                >
                  <GearIcon className="size-4 shrink-0 text-base-content/70" />{" "}
                  Settings
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                  onClick={() => setDuplicateOpen(true)}
                  type="button"
                >
                  <CopyIcon className="size-4 shrink-0 text-base-content/70" />{" "}
                  Duplicate
                </button>
                <div className="my-1 h-px bg-base-300" />
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                  onClick={async () => {
                    const res = await archiveList(
                      workspaceId,
                      space.id,
                      list.id
                    );
                    if (!("error" in res)) {
                      router.push(`/${workspaceId}/${space.id}`);
                      toastWithUndo("List archived", async () => {
                        const undo = await unarchiveList(
                          workspaceId,
                          space.id,
                          list.id
                        );
                        if (!("error" in undo)) {
                          router.push(
                            `/${workspaceId}/${space.id}/list/${list.id}`
                          );
                        }
                      });
                    }
                  }}
                  type="button"
                >
                  <ArchiveIcon className="size-4 shrink-0 text-base-content/70" />{" "}
                  Archive List
                </button>
              </>
            )}
            {isAdmin && (
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-error transition-colors hover:bg-error/10"
                onClick={() => setDeleteOpen(true)}
                type="button"
              >
                <TrashIcon className="size-3.5 shrink-0" /> Delete List
              </button>
            )}
          </PopoverContent>
        </Popover>
      ) : undefined,
  });
  const [pendingView, setPendingView] = useState<View | null>(null);
  const [isViewPending, startViewTransition] = useTransition();

  // Defer the heavy Board mount so the tab click stays responsive. `pendingView`
  // is set urgently (so a shaped skeleton paints immediately), while the actual
  // view swap runs inside the transition and replaces the skeleton when ready.
  function switchView(next: View) {
    if (next === view) {
      return;
    }
    setPendingView(next);
    startViewTransition(() => {
      setView(next);
      setPendingView(null);
    });
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    try {
      window.localStorage.setItem(viewPrefKey(list.id), next);
    } catch {
      // ignore quota / disabled storage
    }
  }

  // The tab title is server-rendered from the list/space name (`page.tsx`'s
  // generateMetadata), which has no way to know which of List/Board/Calendar
  // is active — that's client-only state. Keep the tab in sync on the client
  // instead, prefixing the view label for Board/Calendar so the title
  // actually reflects what's on screen; List keeps the original title as-is.
  React.useEffect(() => {
    const viewLabel = VIEWS.find((v) => v.key === view)?.label;
    document.title =
      view === "list"
        ? `${list.name} · ${space.name} | ${PRODUCT_NAME}`
        : `${viewLabel} · ${list.name} · ${space.name} | ${PRODUCT_NAME}`;
  }, [view, list.name, space.name]);

  const showBoardSkeleton = isViewPending && pendingView === "board";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // Persisted per-list (localStorage, same pattern as list-view's Sort/Group
  // By/Filters prefs) so navigating into a task and back doesn't silently
  // close the Archived section. Starts `false` so server and first client
  // render match (localStorage isn't available on the server); the real
  // saved value is applied after mount below.
  const [showArchived, setShowArchived] = React.useState(false);
  const [archivedTasks, setArchivedTasks] = React.useState<
    { id: string; title: string; seqNumber: number }[]
  >([]);
  const [archivedLoading, setArchivedLoading] = React.useState(false);

  async function loadArchivedTasks() {
    setArchivedLoading(true);
    const result = await getArchivedTasksForList(
      workspaceId,
      space.id,
      list.id
    );
    if (!("error" in result)) {
      setArchivedTasks(result.tasks);
    }
    setArchivedLoading(false);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when the list changes, not when loadArchivedTasks is redefined
  React.useEffect(() => {
    const saved = window.localStorage.getItem(
      `kanbanica:list-archived:${list.id}`
    );
    if (saved !== "1") {
      return;
    }
    setShowArchived(true);
    void loadArchivedTasks();
  }, [list.id]);

  async function handleToggleArchived() {
    if (!showArchived && archivedTasks.length === 0) {
      await loadArchivedTasks();
    }
    setShowArchived((v) => {
      const next = !v;
      window.localStorage.setItem(
        `kanbanica:list-archived:${list.id}`,
        next ? "1" : "0"
      );
      return next;
    });
  }

  return (
    <div className="space-y-5 p-3 sm:p-6">
      <CreateTaskModal
        canManage={canManage}
        listId={list.id}
        onOpenChange={setCreateOpen}
        open={createOpen}
        spaceId={space.id}
        statuses={statuses}
        workspaceId={workspaceId}
      />
      {isAdmin && (
        <DeleteListDialog
          list={list}
          onOpenChange={setDeleteOpen}
          open={deleteOpen}
          spaceId={space.id}
          workspaceId={workspaceId}
        />
      )}
      {canManage && (
        <DuplicateListDialog
          list={list}
          onOpenChange={setDuplicateOpen}
          open={duplicateOpen}
          spaceId={space.id}
          workspaceId={workspaceId}
        />
      )}

      {/* Negative margin lives on this outer wrapper, not the sticky element
          itself — Chromium/WebKit include a sticky element's own negative
          margins in its static position, inflating scrollHeight and causing
          a phantom scrollbar. Fixed `h-14` (rather than breakpoint-dependent
          vertical padding) keeps this bar's real height matching the `top-14`
          the List/Calendar sticky toolbars below it assume — a mismatch here
          left a gap where stuck content showed through underlying rows.
          The active view lives INSIDE this wrapper too (not as a sibling) —
          a sticky element can only stay stuck while its containing block is
          scrolling through the viewport, so a wrapper sized to the tabs bar
          alone gave it no room to remain stuck past the first few px of
          scroll. Nesting the (much taller) view content here gives the
          sticky bar real scroll range. */}
      <div className="-mx-3 -mt-3 sm:-mx-6 sm:-mt-6">
        <div className="sticky top-0 z-20 flex h-14 items-end gap-1 overflow-x-auto overflow-y-hidden border-b bg-elevated px-3 sm:px-6">
          {VIEWS.map(({ key, label, icon }) => (
            <button
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
                view === key
                  ? "border-primary text-base-content"
                  : "border-transparent text-base-content/60 hover:text-base-content"
              )}
              key={key}
              onClick={() => switchView(key)}
              type="button"
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Restores the horizontal inset the wrapper's -mx cancelled, and the
            space-y-5 gap that used to sit between the tabs bar and this
            content when it was a sibling. Bottom inset still comes from the
            outer p-3/sm:p-6 — this wrapper only cancels top/left/right. */}
        <div className="px-3 pt-5 sm:px-6">
          {/* Active view — while switching into Board, show a board-shaped
              skeleton and suppress the outgoing view so they don't overlap. */}
          {showBoardSkeleton && (
            <BoardSkeleton columns={statuses.length || 4} />
          )}
          {!showBoardSkeleton && view === "list" && (
            <ListView
              archivedLoading={archivedLoading}
              archivedTasks={showArchived ? archivedTasks : []}
              canEdit={canEdit}
              canManage={canManage}
              canPinToList={canPinToList}
              currentUserId={currentUserId}
              customFields={customFields}
              isAdmin={isAdmin}
              listId={list.id}
              members={members}
              onArchivedChanged={async () => {
                const result = await getArchivedTasksForList(
                  workspaceId,
                  space.id,
                  list.id
                );
                if (!("error" in result)) {
                  setArchivedTasks(result.tasks);
                }
              }}
              onToggleArchived={handleToggleArchived}
              personallyPinnedIds={personallyPinnedIds}
              pinnedTasks={pinnedTasks}
              showArchived={showArchived}
              spaceId={space.id}
              statuses={statuses}
              tags={tags}
              tasks={tasks}
              workspaceId={workspaceId}
            />
          )}
          {!showBoardSkeleton && view === "board" && (
            <BoardView
              archivedLoading={archivedLoading}
              archivedTasks={showArchived ? archivedTasks : []}
              canEdit={canEdit}
              canManage={canManage}
              customFields={customFields}
              headerless
              isAdmin={isAdmin}
              list={list}
              members={members}
              onArchivedChanged={async () => {
                const result = await getArchivedTasksForList(
                  workspaceId,
                  space.id,
                  list.id
                );
                if (!("error" in result)) {
                  setArchivedTasks(result.tasks);
                }
              }}
              onToggleArchived={handleToggleArchived}
              showArchived={showArchived}
              space={space}
              statuses={statuses}
              tags={tags}
              tasks={tasks}
              workspaceId={workspaceId}
            />
          )}
          {!showBoardSkeleton && view === "calendar" && (
            <CalendarView
              archivedLoading={archivedLoading}
              archivedTasks={showArchived ? archivedTasks : []}
              canEdit={canEdit}
              listId={list.id}
              members={members}
              onArchivedChanged={async () => {
                const result = await getArchivedTasksForList(
                  workspaceId,
                  space.id,
                  list.id
                );
                if (!("error" in result)) {
                  setArchivedTasks(result.tasks);
                }
              }}
              onToggleArchived={handleToggleArchived}
              showArchived={showArchived}
              spaceId={space.id}
              statuses={statuses}
              tasks={[...pinnedTasks, ...tasks]}
              workspaceId={workspaceId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
