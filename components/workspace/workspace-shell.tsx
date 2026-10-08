"use client";

import {
  ArchiveIcon,
  ArrowLeftIcon,
  BellIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  ChartPieSliceIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  DotsThreeIcon,
  FolderIcon,
  GearIcon,
  KeyboardIcon,
  LightningIcon,
  ListChecksIcon,
  ListIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  PaletteIcon,
  PencilSimpleIcon,
  PlusIcon,
  PushPinIcon,
  PushPinSlashIcon,
  ShieldCheckIcon,
  SignOutIcon,
  TrashIcon,
  TrayIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import useSWR, { useSWRConfig } from "swr";
import { archiveList, unarchiveList } from "@/app/actions/list";
import { archiveSpace, deleteSpace, unarchiveSpace } from "@/app/actions/space";
import { getSprintSettings } from "@/app/actions/sprint";
import { AddChannelMemberModal } from "@/components/channel/add-channel-member-modal";
import { CreateChannelModal } from "@/components/channel/create-channel-modal";
import { SpaceIcon } from "@/components/common/space-icon";
import { CreateListModal } from "@/components/list/create-list-modal";
import { DeleteListDialog } from "@/components/list/delete-list-dialog";
import { DuplicateListDialog } from "@/components/list/duplicate-list-dialog";
import { PushNotificationBanner } from "@/components/notifications/push-notification-banner";
import { SearchPalette } from "@/components/search/search-palette";
import { CreateSprintModal } from "@/components/sprint/create-sprint-modal";
import { KeyboardShortcutsDialog } from "@/components/task/keyboard-shortcuts-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { isOverlayOpen } from "@/components/ui/overlay-stack";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { CreateSpaceModal } from "@/components/workspace/create-space-modal";
import { SpaceActionDialog } from "@/components/workspace/space-action-dialog";
import { TaskLimitBanner } from "@/components/workspace/task-limit-banner";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { authClient } from "@/lib/auth-client";
import { rememberWorkspace } from "@/lib/last-workspace";
import { TopbarProvider, useTopbarState } from "@/lib/topbar-context";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";

function formatSprintDate(date: Date | null, fmt: string): string {
  if (!date) {
    return "?";
  }
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  const yyyy = String(d.getFullYear());
  switch (fmt) {
    case "DD/MM":
      return `${dd}/${mm}`;
    case "MM/DD/YY":
      return `${mm}/${dd}/${yy}`;
    case "DD/MM/YY":
      return `${dd}/${mm}/${yy}`;
    case "YYYY/MM/DD":
      return `${yyyy}/${mm}/${dd}`;
    default:
      return `${mm}/${dd}`; // MM/DD
  }
}

interface WorkspaceSummary {
  id: string;
  logoEmoji: string | null;
  name: string;
}

interface ListSummary {
  color: string | null;
  description: string | null;
  id: string;
  name: string;
  taskCount?: number;
}

interface SprintSummary {
  endDate: Date | null;
  id: string;
  name: string;
  startDate: Date | null;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
}

interface SpaceSummary {
  archivedLists: ListSummary[];
  canManageList: boolean;
  color: string | null;
  id: string;
  isPrivate: boolean;
  lists: ListSummary[];
  logoEmoji: string | null;
  name: string;
  sprintDateFormat: string;
  sprints: SprintSummary[];
}

interface ChannelSummary {
  createdAt: Date;
  id: string;
  name: string;
}

interface WorkspaceShellProps {
  archivedSpaces: SpaceSummary[];
  channels: ChannelSummary[];
  children: React.ReactNode;
  /** Platform admin (user.role === "admin") — unlocks the Admin Console link. */
  isPlatformAdmin?: boolean;
  role: string;
  spaces: SpaceSummary[];
  /** Workspace task limit + usage (limit null = unlimited). Drives the banner. */
  taskCapacity?: { limit: number | null; used: number };
  user: { name: string | null; email: string; image: string | null };
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
}

function workspaceBadge(ws: WorkspaceSummary) {
  return ws.logoEmoji ?? ws.name.charAt(0).toUpperCase();
}

export function WorkspaceShell({
  children,
  workspace,
  workspaces,
  spaces,
  archivedSpaces,
  channels: _channels,
  role,
  isPlatformAdmin = false,
  taskCapacity,
  user,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  // Key of the currently-open sidebar three-dot menu (space / list), so it can
  // be closed when an item is selected. Only one menu is open at a time.
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = React.useState(false);
  const [spaceAction, setSpaceAction] = React.useState<{
    id: string;
    name: string;
    variant: "archive" | "delete";
  } | null>(null);
  const [createListForSpace, setCreateListForSpace] = React.useState<{
    spaceId: string;
  } | null>(null);
  const [deleteList, setDeleteList] = React.useState<{
    spaceId: string;
    list: ListSummary;
  } | null>(null);
  const [duplicateListTarget, setDuplicateListTarget] = React.useState<{
    spaceId: string;
    list: ListSummary;
  } | null>(null);
  const [createChannelOpen, setCreateChannelOpen] = React.useState(false);
  const [addMemberChannel, setAddMemberChannel] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const [createSprintForSpace, setCreateSprintForSpace] = React.useState<{
    spaceId: string;
  } | null>(null);
  function openSprintSettings(spaceId: string) {
    router.push(`/${workspace.id}/${spaceId}/settings/sprints`);
  }

  async function handleCreateSprintClick(spaceId: string, _spaceName: string) {
    const settings = await getSprintSettings(workspace.id, spaceId);
    if ("error" in settings || settings.sprintStartDay === null) {
      openSprintSettings(spaceId);
    } else {
      setCreateSprintForSpace({ spaceId });
    }
  }

  // Auto-subscribe to push notifications if permission was already granted
  usePushSubscription();

  // Remember the workspace being viewed so "Back to app" (and the next sign-in)
  // returns here instead of always the first-created workspace.
  React.useEffect(() => {
    rememberWorkspace(workspace.id);
  }, [workspace.id]);

  const { data: notifData } = useSWR<{ unreadCount: number }>(
    "/api/me/notifications?filter=unread",
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 30_000 }
  );
  const unreadCount = notifData?.unreadCount ?? 0;

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email.slice(0, 2).toUpperCase();
  const displayName = user.name || user.email;
  const avatarUrl = user.image ? `/api/files/${user.image}` : null;
  const isAdmin = role === "OWNER" || role === "ADMIN";
  const [expandedArchivedLists, setExpandedArchivedLists] = React.useState<
    Set<string>
  >(new Set());
  const [expandedSprintGroups, setExpandedSprintGroups] = React.useState<
    Set<string>
  >(new Set());
  // Projects the user has collapsed in the sidebar. Persisted per-workspace so
  // teams with many projects can hide the ones they aren't working in.
  const [collapsedSpaces, setCollapsedSpaces] = React.useState<Set<string>>(
    new Set()
  );
  const collapsedStorageKey = `kanbanica:collapsed-spaces:${workspace.id}`;
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(collapsedStorageKey);
      if (raw) {
        setCollapsedSpaces(new Set(JSON.parse(raw) as string[]));
      } else {
        setCollapsedSpaces(new Set());
      }
    } catch {
      setCollapsedSpaces(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedStorageKey]);
  function persistCollapsedSpaces(next: Set<string>) {
    try {
      localStorage.setItem(collapsedStorageKey, JSON.stringify([...next]));
    } catch {
      // localStorage unavailable (private mode) — collapse still works in-session.
    }
  }
  function toggleSpaceCollapsed(id: string) {
    setCollapsedSpaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      persistCollapsedSpaces(next);
      return next;
    });
  }
  const allSpacesCollapsed =
    spaces.length > 0 && spaces.every((s) => collapsedSpaces.has(s.id));
  function toggleAllSpaces() {
    setCollapsedSpaces(() => {
      const next = allSpacesCollapsed
        ? new Set<string>()
        : new Set(spaces.map((s) => s.id));
      persistCollapsedSpaces(next);
      return next;
    });
  }
  const [showArchivedSpaces, setShowArchivedSpaces] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [showProjectPicker, setShowProjectPicker] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  // The account menu opens on hover. A short close delay lets the pointer travel
  // from the trigger into the (portaled) menu without it snapping shut.
  const profileCloseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  function openProfileMenu() {
    if (profileCloseTimer.current) {
      clearTimeout(profileCloseTimer.current);
    }
    setProfileOpen(true);
  }
  // Touch devices still dispatch synthetic mouseenter/mouseleave for taps —
  // including a spurious mouseenter on the trigger right after a menu item's
  // click closes the popover and reveals the trigger underneath the tap
  // point, which reopens it. Hover-driven open/close is desktop-only.
  function handleTriggerHoverEnter() {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      openProfileMenu();
    }
  }
  function handleTriggerHoverLeave() {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      scheduleCloseProfileMenu();
    }
  }
  function scheduleCloseProfileMenu() {
    if (profileCloseTimer.current) {
      clearTimeout(profileCloseTimer.current);
    }
    // Swapping in the project picker makes the menu shorter, and it is
    // bottom-anchored (side="top"), so its top edge drops — sliding the panel
    // out from under a stationary cursor and firing a spurious mouseleave.
    // Letting that schedule a close would reset the picker the user just
    // opened, making the click look like it did nothing. The picker is entered
    // by an explicit click, so keep it up until it's explicitly dismissed
    // (Back, picking a project, Escape, or a click outside).
    if (showProjectPicker) {
      return;
    }
    profileCloseTimer.current = setTimeout(() => {
      setProfileOpen(false);
      setShowProjectPicker(false);
    }, 180);
  }

  // Ctrl+K / Cmd+K (command palette) and "?" (keyboard shortcuts) — global.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
        return;
      }
      // "?" opens the keyboard-shortcuts panel anywhere in the app — unless the
      // user is typing (editor / input) or an overlay already owns the keyboard.
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        const typing =
          !!t &&
          (t.isContentEditable ||
            t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.tagName === "SELECT");
        if (typing) {
          return;
        }
        if (isOverlayOpen()) {
          return;
        }
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Auto-expand sprint group for the space whose sprint is currently active
  React.useEffect(() => {
    const match = pathname.match(/\/[^/]+\/([^/]+)\/sprint\//);
    if (match) {
      const spaceId = match[1];
      setExpandedSprintGroups((prev) => {
        if (prev.has(spaceId)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(spaceId);
        return next;
      });
    }
  }, [pathname]);

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <div className="workspace-shell flex h-screen bg-base-100 overflow-hidden">
      <SearchPalette
        onClose={() => setSearchOpen(false)}
        open={searchOpen}
        workspaceId={workspace.id}
      />
      <KeyboardShortcutsDialog
        onOpenChange={setShortcutsOpen}
        open={shortcutsOpen}
      />
      <CreateSpaceModal
        onOpenChange={setCreateSpaceOpen}
        open={createSpaceOpen}
        workspaceId={workspace.id}
      />

      {createListForSpace && (
        <CreateListModal
          onOpenChange={(open) => !open && setCreateListForSpace(null)}
          open
          spaceId={createListForSpace.spaceId}
          workspaceId={workspace.id}
        />
      )}

      {createSprintForSpace && (
        <CreateSprintModal
          onCreated={() => setCreateSprintForSpace(null)}
          onOpenChange={(open) => !open && setCreateSprintForSpace(null)}
          onOpenSettings={() => {
            setCreateSprintForSpace(null);
            openSprintSettings(createSprintForSpace.spaceId);
          }}
          open
          spaceId={createSprintForSpace.spaceId}
          workspaceId={workspace.id}
        />
      )}

      {deleteList && (
        <DeleteListDialog
          list={deleteList.list}
          onOpenChange={(open) => !open && setDeleteList(null)}
          open
          spaceId={deleteList.spaceId}
          workspaceId={workspace.id}
        />
      )}

      {duplicateListTarget && (
        <DuplicateListDialog
          list={duplicateListTarget.list}
          onOpenChange={(open) => !open && setDuplicateListTarget(null)}
          open
          spaceId={duplicateListTarget.spaceId}
          workspaceId={workspace.id}
        />
      )}

      <CreateChannelModal
        onOpenChange={setCreateChannelOpen}
        open={createChannelOpen}
        workspaceId={workspace.id}
      />

      {addMemberChannel && (
        <AddChannelMemberModal
          channelId={addMemberChannel.id}
          existingMemberIds={[]}
          onOpenChange={(open) => !open && setAddMemberChannel(null)}
          open
          workspaceId={workspace.id}
        />
      )}

      {spaceAction && (
        <SpaceActionDialog
          action={() =>
            spaceAction.variant === "delete"
              ? deleteSpace(workspace.id, spaceAction.id)
              : archiveSpace(workspace.id, spaceAction.id)
          }
          onOpenChange={(open) => !open && setSpaceAction(null)}
          open
          spaceName={spaceAction.name}
          variant={spaceAction.variant}
          workspaceId={workspace.id}
        />
      )}

      {sidebarOpen && (
        <button
          aria-label="Close sidebar"
          className="fixed inset-0 z-20 border-0 bg-black/50 p-0 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      )}

      {/* Sidebar — full height */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col border-r border-base-300 bg-(--bg-sidebar) transition-transform duration-200 lg:static lg:h-full",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Workspace switcher at top of sidebar */}
        <div className="flex h-12 shrink-0 items-center border-b border-[rgba(255,255,255,0.06)] px-2">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-(--bg-sidebar-item-hover) text-(--text-sidebar-active)"
                type="button"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-xs font-semibold text-(--text-sidebar-active)">
                  {workspaceBadge(workspace)}
                </span>
                <span className="flex-1 truncate text-left">
                  {workspace.name}
                </span>
                <CaretUpDownIcon className="size-3.5 shrink-0 text-(--text-muted)" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1">
              <p className="px-2 py-1.5 font-medium text-base-content/60 text-xs uppercase tracking-wide">
                Workspaces
              </p>
              {workspaces.map((ws) => (
                <Link
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                  href={`/${ws.id}`}
                  key={ws.id}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs">
                    {workspaceBadge(ws)}
                  </span>
                  <span className="flex-1 truncate">{ws.name}</span>
                  {ws.id === workspace.id && (
                    <CheckIcon className="size-4 text-primary" />
                  )}
                </Link>
              ))}
              <Separator className="my-1" />
              <Link
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
                href="/onboarding?new=1"
              >
                <PlusIcon className="size-4" />
                Create workspace
              </Link>
            </PopoverContent>
          </Popover>
        </div>

        {/* Main nav */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {/* Global links */}
          <div className="space-y-0.5">
            {[
              {
                href: `/${workspace.id}/overview`,
                label: "Overview",
                icon: (
                  <ChartPieSliceIcon
                    className="size-4 shrink-0"
                    weight="fill"
                  />
                ),
                badge: null,
              },
              {
                href: `/${workspace.id}/notifications`,
                label: "Inbox",
                icon: <TrayIcon className="size-4 shrink-0" weight="fill" />,
                badge: unreadCount > 0 ? unreadCount : null,
              },
              {
                href: `/${workspace.id}/my-tasks`,
                label: "My Tasks",
                icon: (
                  <CheckCircleIcon className="size-4 shrink-0" weight="fill" />
                ),
                badge: null,
              },
              {
                href: `/${workspace.id}/daily-checklist`,
                label: "Checklist",
                icon: (
                  <ListChecksIcon className="size-4 shrink-0" weight="fill" />
                ),
                badge: null,
              },
            ].map(({ href, label, icon, badge }) => {
              // Checklist owns a sub-route (/admin), so it stays highlighted there too.
              const active =
                pathname === href ||
                (href.endsWith("/daily-checklist") &&
                  pathname.startsWith(`${href}/`));
              return (
                <Link
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-colors select-none",
                    active
                      ? "bg-(--bg-sidebar-item-active) text-(--text-sidebar-active) font-medium overflow-hidden after:absolute after:left-0 after:inset-y-0 after:w-0.75 after:bg-primary"
                      : "text-(--text-sidebar) hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                  )}
                  href={href}
                  key={href}
                  onClick={() => setSidebarOpen(false)}
                >
                  {icon}
                  <span className="flex-1">{label}</span>
                  {badge !== null && (
                    <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-(--brand) px-1 text-2xs font-semibold text-white leading-none">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          <div>
            <div className="flex items-center px-3 pb-1 pt-2">
              <p className="flex-1 text-xs font-semibold tracking-widest uppercase text-(--text-muted)">
                Projects
              </p>
              {spaces.length > 1 && (
                <button
                  className="flex size-5 items-center justify-center rounded text-(--text-muted) transition-colors hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                  onClick={toggleAllSpaces}
                  title={
                    allSpacesCollapsed
                      ? "Expand all projects"
                      : "Collapse all projects"
                  }
                  type="button"
                >
                  <CaretUpDownIcon className="size-3.5" />
                </button>
              )}
              {isAdmin && (
                <button
                  className="flex size-5 items-center justify-center rounded text-(--text-muted) transition-colors hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                  onClick={() => setCreateSpaceOpen(true)}
                  title="Create Project"
                  type="button"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {spaces.map((s) => (
                <div key={s.id}>
                  <div className="group flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium text-(--text-sidebar-active)">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => toggleSpaceCollapsed(s.id)}
                      title={
                        collapsedSpaces.has(s.id)
                          ? "Expand project"
                          : "Collapse project"
                      }
                      type="button"
                    >
                      {collapsedSpaces.has(s.id) ? (
                        <CaretRightIcon className="size-3 shrink-0 text-(--text-muted)" />
                      ) : (
                        <CaretDownIcon className="size-3 shrink-0 text-(--text-muted)" />
                      )}
                      <SpaceIcon color={s.color} emoji={s.logoEmoji} />
                      <span className="flex-1 truncate">{s.name}</span>
                    </button>
                    {s.isPrivate && (
                      <LockSimpleIcon className="size-3 shrink-0 text-(--text-muted)" />
                    )}
                    {s.canManageList && (
                      <button
                        className="opacity-0 transition-opacity group-hover:opacity-100 flex size-5 items-center justify-center rounded hover:bg-(--bg-sidebar-item-hover) text-(--text-muted)"
                        onClick={() => setCreateListForSpace({ spaceId: s.id })}
                        title="Add list"
                        type="button"
                      >
                        <PlusIcon className="size-3.5" />
                      </button>
                    )}
                    <Popover
                      onOpenChange={(o) =>
                        setOpenMenu(o ? `space-${s.id}` : null)
                      }
                      open={openMenu === `space-${s.id}`}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className="opacity-0 transition-opacity group-hover:opacity-100 flex size-5 items-center justify-center rounded hover:bg-(--bg-sidebar-item-hover) text-(--text-muted)"
                          onClick={(e) => e.stopPropagation()}
                          title="Project options"
                          type="button"
                        >
                          <DotsThreeIcon className="size-4.5" weight="bold" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-48 p-1"
                        onClick={() => setOpenMenu(null)}
                        side="right"
                      >
                        {s.canManageList && (
                          <Link
                            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                            href={`/${workspace.id}/${s.id}/settings/general`}
                            onClick={() => setSidebarOpen(false)}
                          >
                            <GearIcon className="size-3.5 shrink-0 text-base-content/60" />
                            Settings
                          </Link>
                        )}
                        <Link
                          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                          href={`/${workspace.id}/${s.id}/activity`}
                          onClick={() => setSidebarOpen(false)}
                        >
                          <ClockIcon className="size-3.5 shrink-0 text-base-content/60" />
                          Activity
                        </Link>
                        {s.canManageList && (
                          <Link
                            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                            href={`/${workspace.id}/${s.id}/settings/members`}
                            onClick={() => setSidebarOpen(false)}
                          >
                            <LockSimpleIcon className="size-3.5 shrink-0 text-base-content/60" />
                            Members & Permissions
                          </Link>
                        )}
                        {isAdmin && (
                          <>
                            <div className="my-1 h-px bg-base-300" />
                            <button
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                              onClick={() =>
                                setSpaceAction({
                                  id: s.id,
                                  name: s.name,
                                  variant: "archive",
                                })
                              }
                              type="button"
                            >
                              <ArchiveIcon className="size-3.5 shrink-0 text-base-content/60" />
                              Archive Project
                            </button>
                            <button
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-error transition-colors hover:bg-error/10"
                              onClick={() =>
                                setSpaceAction({
                                  id: s.id,
                                  name: s.name,
                                  variant: "delete",
                                })
                              }
                              type="button"
                            >
                              <TrashIcon className="size-3.5 shrink-0" />
                              Delete Project
                            </button>
                          </>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                  {!collapsedSpaces.has(s.id) && (
                    <div className="space-y-0.5">
                      {s.lists.map((l) => {
                        const href = `/${workspace.id}/${s.id}/list/${l.id}`;
                        const active = pathname === href;
                        return (
                          <div
                            className="group/list relative flex items-center"
                            key={l.id}
                          >
                            <Link
                              className={cn(
                                "relative flex flex-1 items-center gap-2 rounded-md py-1.5 pr-7 pl-7 text-[13px] transition-colors select-none",
                                active
                                  ? "bg-(--bg-sidebar-item-active) text-(--text-sidebar-active) font-medium overflow-hidden after:absolute after:left-0 after:inset-y-0 after:w-0.75 after:bg-primary"
                                  : "text-(--text-sidebar) hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                              )}
                              href={href}
                              onClick={() => setSidebarOpen(false)}
                            >
                              <ListIcon
                                className="size-3.5 shrink-0"
                                style={{ color: l.color ?? "#9CA3AF" }}
                                weight="bold"
                              />
                              <span className="truncate">{l.name}</span>
                              {!!l.taskCount && (
                                <span className="ml-auto shrink-0 text-2xs font-medium tabular-nums text-(--text-muted)">
                                  {l.taskCount > 99 ? "99+" : l.taskCount}
                                </span>
                              )}
                            </Link>
                            {s.canManageList && (
                              <Popover
                                onOpenChange={(o) =>
                                  setOpenMenu(o ? `list-${l.id}` : null)
                                }
                                open={openMenu === `list-${l.id}`}
                              >
                                <PopoverTrigger asChild>
                                  <button
                                    className="absolute right-1 opacity-0 transition-opacity group-hover/list:opacity-100 flex size-5 items-center justify-center rounded hover:bg-(--bg-sidebar-item-hover)"
                                    onClick={(e) => e.stopPropagation()}
                                    title="List options"
                                    type="button"
                                  >
                                    <DotsThreeIcon
                                      className="size-4.5 text-(--text-muted)"
                                      weight="bold"
                                    />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent
                                  align="start"
                                  className="w-44 p-1"
                                  onClick={() => setOpenMenu(null)}
                                  side="right"
                                >
                                  <Link
                                    className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                                    href={`/${workspace.id}/${s.id}/list/${l.id}/settings/general`}
                                    onClick={() => setSidebarOpen(false)}
                                  >
                                    <GearIcon className="size-3.5 shrink-0 text-base-content/60" />
                                    Settings
                                  </Link>
                                  <Link
                                    className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                                    href={`/${workspace.id}/${s.id}/list/${l.id}/settings/statuses`}
                                    onClick={() => setSidebarOpen(false)}
                                  >
                                    <PencilSimpleIcon className="size-3.5 shrink-0 text-base-content/60" />
                                    Manage Statuses
                                  </Link>
                                  <button
                                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                                    onClick={() =>
                                      setDuplicateListTarget({
                                        spaceId: s.id,
                                        list: l,
                                      })
                                    }
                                    type="button"
                                  >
                                    <CopyIcon className="size-3.5 shrink-0 text-base-content/60" />
                                    Duplicate
                                  </button>
                                  <div className="my-1 h-px bg-base-300" />
                                  <button
                                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-base-200"
                                    onClick={async () => {
                                      const res = await archiveList(
                                        workspace.id,
                                        s.id,
                                        l.id
                                      );
                                      if (!("error" in res)) {
                                        router.push(`/${workspace.id}/${s.id}`);
                                        toastWithUndo(
                                          "List archived",
                                          async () => {
                                            const undo = await unarchiveList(
                                              workspace.id,
                                              s.id,
                                              l.id
                                            );
                                            if (!("error" in undo)) {
                                              router.push(
                                                `/${workspace.id}/${s.id}/list/${l.id}`
                                              );
                                            }
                                          }
                                        );
                                      }
                                    }}
                                    type="button"
                                  >
                                    <ArchiveIcon className="size-3.5 shrink-0" />
                                    Archive
                                  </button>
                                  {isAdmin && (
                                    <button
                                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-error transition-colors hover:bg-error/10"
                                      onClick={() =>
                                        setDeleteList({
                                          spaceId: s.id,
                                          list: l,
                                        })
                                      }
                                      type="button"
                                    >
                                      <TrashIcon className="size-3.5 shrink-0" />
                                      Delete
                                    </button>
                                  )}
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        );
                      })}
                      {s.sprints.length > 0 &&
                        (() => {
                          const sprintsExpanded = expandedSprintGroups.has(
                            s.id
                          );
                          const activeSprint = s.sprints.find(
                            (sp) => sp.status === "ACTIVE"
                          );
                          const isOnSprintRoute = pathname.includes(
                            `/${workspace.id}/${s.id}/sprint/`
                          );
                          return (
                            <div>
                              {/* Sprints folder header */}
                              <button
                                className={cn(
                                  "group/sprints relative flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-[13px] transition-colors select-none",
                                  isOnSprintRoute
                                    ? "text-(--text-sidebar-active)"
                                    : "text-(--text-sidebar) hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                                )}
                                onClick={() =>
                                  setExpandedSprintGroups((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(s.id)) {
                                      next.delete(s.id);
                                    } else {
                                      next.add(s.id);
                                    }
                                    return next;
                                  })
                                }
                                type="button"
                              >
                                {sprintsExpanded ? (
                                  <CaretDownIcon className="size-3 shrink-0 text-(--text-muted)" />
                                ) : (
                                  <CaretRightIcon className="size-3 shrink-0 text-(--text-muted)" />
                                )}
                                <LightningIcon
                                  className="size-3.5 shrink-0"
                                  style={{
                                    color: activeSprint ? "#4ADE80" : undefined,
                                  }}
                                  weight="fill"
                                />
                                <span className="flex-1 truncate text-left">
                                  Sprints
                                </span>
                                {activeSprint && !sprintsExpanded && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0 animate-pulse" />
                                )}
                                {s.canManageList && (
                                  <span className="opacity-0 group-hover/sprints:opacity-100 flex items-center gap-0.5 transition-opacity shrink-0">
                                    {/* biome-ignore lint/a11y/useSemanticElements: nested inside the outer "Sprints folder header" <button>; a real <button> here would be invalid HTML nesting */}
                                    <span
                                      className="flex size-4 items-center justify-center rounded hover:bg-(--bg-sidebar-item-hover)"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openSprintSettings(s.id);
                                      }}
                                      onKeyDown={(e) => {
                                        if (
                                          e.key === "Enter" ||
                                          e.key === " "
                                        ) {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          openSprintSettings(s.id);
                                        }
                                      }}
                                      role="button"
                                      tabIndex={0}
                                      title="Sprint settings"
                                    >
                                      <GearIcon className="size-3" />
                                    </span>
                                    {/* biome-ignore lint/a11y/useSemanticElements: nested inside the outer "Sprints folder header" <button>; a real <button> here would be invalid HTML nesting */}
                                    <span
                                      className="flex size-4 items-center justify-center rounded hover:bg-(--bg-sidebar-item-hover)"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCreateSprintClick(s.id, s.name);
                                      }}
                                      onKeyDown={(e) => {
                                        if (
                                          e.key === "Enter" ||
                                          e.key === " "
                                        ) {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          handleCreateSprintClick(s.id, s.name);
                                        }
                                      }}
                                      role="button"
                                      tabIndex={0}
                                      title="Create sprint"
                                    >
                                      <PlusIcon className="size-3" />
                                    </span>
                                  </span>
                                )}
                              </button>

                              {/* Sprint items */}
                              {sprintsExpanded &&
                                s.sprints.map((sp) => {
                                  const href = `/${workspace.id}/${s.id}/sprint/${sp.id}`;
                                  const active = pathname === href;
                                  return (
                                    <Link
                                      className={cn(
                                        "relative flex items-center gap-2 rounded-md py-1.5 pr-2 pl-12 text-[13px] transition-colors select-none",
                                        active
                                          ? "bg-(--bg-sidebar-item-active) text-(--text-sidebar-active) font-medium overflow-hidden after:absolute after:left-0 after:inset-y-0 after:w-0.75 after:bg-primary"
                                          : "text-(--text-sidebar) hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                                      )}
                                      href={href}
                                      key={sp.id}
                                      onClick={() => setSidebarOpen(false)}
                                    >
                                      <LightningIcon
                                        className="size-3.5 shrink-0"
                                        style={{
                                          color:
                                            sp.status === "ACTIVE"
                                              ? "#4ADE80"
                                              : undefined,
                                        }}
                                        weight={
                                          sp.status === "ACTIVE"
                                            ? "fill"
                                            : "regular"
                                        }
                                      />
                                      <span className="flex-1 min-w-0">
                                        <span className="truncate block">
                                          {sp.name}
                                        </span>
                                        {(sp.startDate || sp.endDate) && (
                                          <span className="text-2xs text-(--text-muted) font-normal leading-none">
                                            {formatSprintDate(
                                              sp.startDate,
                                              s.sprintDateFormat
                                            )}
                                            {" – "}
                                            {formatSprintDate(
                                              sp.endDate,
                                              s.sprintDateFormat
                                            )}
                                          </span>
                                        )}
                                      </span>
                                      {sp.status === "ACTIVE" && (
                                        <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0 animate-pulse" />
                                      )}
                                    </Link>
                                  );
                                })}
                            </div>
                          );
                        })()}
                      {s.sprints.length === 0 && s.canManageList && (
                        <button
                          className="flex w-full items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-xs text-(--text-muted) transition-colors hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                          onClick={() => handleCreateSprintClick(s.id, s.name)}
                          type="button"
                        >
                          <LightningIcon className="size-3" />
                          Create sprint
                        </button>
                      )}
                      {s.canManageList && (
                        <button
                          className="flex w-full items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-xs text-(--text-muted) transition-colors hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                          onClick={() =>
                            setCreateListForSpace({ spaceId: s.id })
                          }
                          type="button"
                        >
                          <PlusIcon className="size-3" />
                          Add list
                        </button>
                      )}
                      {s.archivedLists.length > 0 && (
                        <button
                          className="flex items-center gap-1.5 pl-7 pr-2 py-1 text-xs text-(--text-muted) hover:text-(--text-sidebar) transition-colors w-full"
                          onClick={() =>
                            setExpandedArchivedLists((prev) => {
                              const next = new Set(prev);
                              if (next.has(s.id)) {
                                next.delete(s.id);
                              } else {
                                next.add(s.id);
                              }
                              return next;
                            })
                          }
                          type="button"
                        >
                          <ArchiveIcon className="size-3" />
                          {expandedArchivedLists.has(s.id)
                            ? "Hide"
                            : `${s.archivedLists.length} archived`}
                        </button>
                      )}
                      {expandedArchivedLists.has(s.id) &&
                        s.archivedLists.map((l) => (
                          <div
                            className="group flex items-center gap-2 pl-7 pr-2 py-1 text-xs text-(--text-muted)"
                            key={l.id}
                          >
                            <ArchiveIcon className="size-3 shrink-0" />
                            <span className="flex-1 truncate italic">
                              {l.name}
                            </span>
                            {s.canManageList && (
                              <button
                                className="hidden group-hover:block text-2xs px-1.5 py-0.5 rounded bg-(--bg-sidebar-item-hover) hover:bg-(--bg-sidebar-item-active) text-(--text-sidebar)"
                                onClick={async () => {
                                  const res = await unarchiveList(
                                    workspace.id,
                                    s.id,
                                    l.id
                                  );
                                  if (!("error" in res)) {
                                    toastWithUndo(
                                      "List unarchived",
                                      async () => {
                                        await archiveList(
                                          workspace.id,
                                          s.id,
                                          l.id
                                        );
                                      }
                                    );
                                  }
                                }}
                                type="button"
                              >
                                Unarchive
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {archivedSpaces.length > 0 && (
            <div>
              <button
                className="flex items-center gap-1.5 px-3 pb-1 text-xs text-(--text-muted) hover:text-(--text-sidebar) transition-colors w-full"
                onClick={() => setShowArchivedSpaces((v) => !v)}
                type="button"
              >
                <ArchiveIcon className="size-3" />
                <span className="flex-1 text-left uppercase tracking-wide font-medium">
                  {showArchivedSpaces
                    ? "Hide archived projects"
                    : `Archived projects (${archivedSpaces.length})`}
                </span>
              </button>
              {showArchivedSpaces && (
                <div className="space-y-0.5">
                  {archivedSpaces.map((s) => (
                    <div
                      className="group flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-(--text-muted)"
                      key={s.id}
                    >
                      <SpaceIcon
                        color={s.color}
                        dotClassName="opacity-40"
                        emoji={s.logoEmoji}
                      />
                      <span className="flex-1 truncate italic">{s.name}</span>
                      {isAdmin && (
                        <button
                          className="hidden group-hover:block text-xs px-1.5 py-0.5 rounded bg-(--bg-sidebar-item-hover) text-(--text-sidebar)"
                          onClick={async () => {
                            await unarchiveSpace(workspace.id, s.id);
                          }}
                          type="button"
                        >
                          Unarchive
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Channels section — post-MVP, hidden for now */}
          {/* <div>
            <div className="flex items-center px-2 pb-1">
              <p className="flex-1 font-medium text-base-content/60 text-xs uppercase tracking-wide">
                Channels
              </p>
              <button
                onClick={() => setAddMemberChannel(channels[0] ? { id: channels[0].id, name: channels[0].name } : null)}
                className="flex size-5 items-center justify-center rounded text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
                title="Add Member"
                disabled={channels.length === 0}
              >
                <UserPlusIcon className="size-3.5" />
              </button>
              <button
                onClick={() => setCreateChannelOpen(true)}
                className="flex size-5 items-center justify-center rounded text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
                title="Create Channel"
              >
                <PlusIcon className="size-3.5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {channels.map((ch) => {
                const href = `/${workspace.id}/channel/${ch.id}`;
                const active = pathname === href;
                return (
                  <div key={ch.id} className="group/channel relative flex items-center">
                    <Link
                      href={href}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-base-200 font-medium text-base-content"
                          : "text-base-content/60 hover:bg-base-200 hover:text-base-content",
                      )}
                    >
                      <HashIcon className="size-4 shrink-0" weight="bold" />
                      <span className="truncate">{ch.name}</span>
                    </Link>
                    <button
                      onClick={() => setAddMemberChannel({ id: ch.id, name: ch.name })}
                      className="absolute right-1 opacity-0 transition-opacity group-hover/channel:opacity-100 flex size-5 items-center justify-center rounded hover:bg-base-200"
                      title="Add members"
                    >
                      <UserPlusIcon className="size-3.5 text-base-content/60" />
                    </button>
                  </div>
                );
              })}
              <button
                onClick={() => setCreateChannelOpen(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
              >
                <PlusIcon className="size-3" />
                Add Channel
              </button>
            </div>
          </div> */}
        </nav>

        {/* Platform admins: an extra entry into the Admin Console. The normal
            app stays the default experience; this is just an additional tool. */}
        {isPlatformAdmin && (
          <div className="border-t border-[rgba(255,255,255,0.08)] px-2 py-2">
            <Link
              className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] text-(--text-sidebar) transition-colors hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
              href="/orbit"
              onClick={() => setSidebarOpen(false)}
            >
              <ShieldCheckIcon className="size-4 shrink-0" weight="fill" />
              <span className="flex-1">Admin Console</span>
            </Link>
          </div>
        )}

        {/* Bottom user menu */}
        <div className="border-t border-[rgba(255,255,255,0.08)] p-2">
          <Popover
            onOpenChange={(open) => {
              setProfileOpen(open);
              if (!open) {
                setShowProjectPicker(false);
              }
            }}
            open={profileOpen}
          >
            <PopoverTrigger asChild>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-[13px] text-(--text-sidebar) transition-colors hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active) cursor-pointer"
                onMouseEnter={handleTriggerHoverEnter}
                onMouseLeave={handleTriggerHoverLeave}
                type="button"
              >
                <Avatar className="size-7 shrink-0">
                  {avatarUrl && (
                    <AvatarImage alt={displayName} src={avatarUrl} />
                  )}
                  <AvatarFallback className="text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate text-left">{displayName}</span>
                <CaretUpIcon
                  className={`size-3.5 shrink-0 opacity-50 transition-transform duration-200 ${profileOpen ? "rotate-180" : ""}`}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-56 p-1.5"
              onMouseEnter={handleTriggerHoverEnter}
              onMouseLeave={handleTriggerHoverLeave}
              onOpenAutoFocus={(e) => e.preventDefault()}
              side="top"
              sideOffset={4}
            >
              {showProjectPicker && spaces.length > 1 ? (
                /* Project picker — replaces the menu in-place (single popup, no side panel) */
                <div>
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-base-200"
                    onClick={() => setShowProjectPicker(false)}
                    type="button"
                  >
                    <ArrowLeftIcon className="size-4 shrink-0 text-base-content/60" />
                    <span className="flex-1 text-left">Project settings</span>
                  </button>
                  <Separator className="my-1.5" />
                  <div className="max-h-64 overflow-y-auto">
                    {spaces.map((s) => {
                      // The currently-viewed project is the second path segment:
                      // /{workspaceId}/{spaceId}/...
                      const isCurrent = pathname.split("/")[2] === s.id;
                      return (
                        <Link
                          className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-base-200 ${isCurrent ? "bg-base-200 font-medium" : ""}`}
                          href={`/${workspace.id}/${s.id}/settings/general`}
                          key={s.id}
                          onClick={() => {
                            setProfileOpen(false);
                            setShowProjectPicker(false);
                            setSidebarOpen(false);
                          }}
                        >
                          <SpaceIcon
                            color={s.color ?? "#6B7280"}
                            emoji={s.logoEmoji}
                            size="sm"
                          />
                          <span className="flex-1 truncate">{s.name}</span>
                          {isCurrent && (
                            <CheckIcon className="size-4 shrink-0 text-primary" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Account menu */
                <div>
                  <Link
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-base-200"
                    href={`/${workspace.id}/profile`}
                    onClick={() => {
                      setProfileOpen(false);
                      setSidebarOpen(false);
                    }}
                  >
                    <UserCircleIcon className="size-4 shrink-0 text-base-content/60" />
                    Edit profile
                  </Link>
                  <Separator className="my-1.5" />
                  {isAdmin && (
                    <Link
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-base-200"
                      href={`/${workspace.id}/settings/general`}
                      onClick={() => {
                        setProfileOpen(false);
                        setSidebarOpen(false);
                      }}
                    >
                      <GearIcon className="size-4 shrink-0 text-base-content/60" />
                      Workspace settings
                    </Link>
                  )}
                  {/* Project settings is an owner/admin affordance — members and
                      guests don't manage projects, so hide it for them. */}
                  {isAdmin &&
                    (spaces.length === 1 ? (
                      // Single project — go straight to its settings, no picker needed.
                      <Link
                        className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-base-200"
                        href={`/${workspace.id}/${spaces[0].id}/settings/general`}
                        onClick={() => {
                          setProfileOpen(false);
                          setSidebarOpen(false);
                        }}
                      >
                        <FolderIcon className="size-4 shrink-0 text-base-content/60" />
                        Project settings
                      </Link>
                    ) : (
                      <button
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-base-200"
                        onClick={() => {
                          // openProfileMenu() cancels any close already
                          // scheduled by a mouseleave in flight — without it
                          // that timer still fires and resets the picker.
                          openProfileMenu();
                          setShowProjectPicker(true);
                        }}
                        type="button"
                      >
                        <FolderIcon className="size-4 shrink-0 text-base-content/60" />
                        <span className="flex-1 text-left">
                          Project settings
                        </span>
                        <CaretRightIcon className="size-3.5 text-base-content/60" />
                      </button>
                    ))}
                  <Link
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-base-200"
                    href={`/${workspace.id}/notifications/settings`}
                    onClick={() => {
                      setProfileOpen(false);
                      setSidebarOpen(false);
                    }}
                  >
                    <BellIcon className="size-4 shrink-0 text-base-content/60" />
                    Notification settings
                  </Link>
                  {/* Trash holds workspace-wide deleted tasks — owner/admin only. */}
                  {isAdmin && (
                    <Link
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-base-200"
                      href={`/${workspace.id}/trash`}
                      onClick={() => {
                        setProfileOpen(false);
                        setSidebarOpen(false);
                      }}
                    >
                      <TrashIcon className="size-4 shrink-0 text-base-content/60" />
                      Trash
                    </Link>
                  )}
                  {/* Checklist templates & team progress — owner/admin only. */}
                  {isAdmin && (
                    <Link
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-base-200"
                      href={`/${workspace.id}/daily-checklist/admin`}
                      onClick={() => {
                        setProfileOpen(false);
                        setSidebarOpen(false);
                      }}
                    >
                      <ListChecksIcon className="size-4 shrink-0 text-base-content/60" />
                      Checklist admin
                    </Link>
                  )}
                  <Link
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-base-200"
                    href={`/${workspace.id}/theme`}
                    onClick={() => {
                      setProfileOpen(false);
                      setSidebarOpen(false);
                    }}
                  >
                    <PaletteIcon className="size-4 shrink-0 text-base-content/60" />
                    Theme
                  </Link>
                  <button
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-base-200"
                    onClick={() => {
                      setProfileOpen(false);
                      setShortcutsOpen(true);
                    }}
                    type="button"
                  >
                    <KeyboardIcon className="size-4 shrink-0 text-base-content/60" />
                    <span className="flex-1 text-left">Keyboard shortcuts</span>
                    <kbd className="rounded border bg-base-200 px-1.5 py-0.5 font-mono text-2xs font-medium text-base-content/60">
                      ?
                    </kbd>
                  </button>
                  <Separator className="my-1.5" />
                  <button
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-error transition-colors hover:bg-error/10"
                    onClick={() => {
                      setProfileOpen(false);
                      handleSignOut();
                    }}
                    type="button"
                  >
                    <SignOutIcon className="size-4 shrink-0" />
                    Sign out
                  </button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </aside>

      {/* Right column: topbar + main content */}
      <TopbarProvider>
        <TopbarRightColumn
          isAdmin={isAdmin}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSidebar={() => setSidebarOpen((open) => !open)}
          taskCapacity={taskCapacity}
          workspaceId={workspace.id}
        >
          {children}
        </TopbarRightColumn>
      </TopbarProvider>
    </div>
  );
}

// ─── Pinned Tasks Tab Strip ───────────────────────────────────────────────────

interface PinnedItem {
  id: string;
  listName: string | null;
  orderIndex: number;
  spaceName: string | null;
  taskId: string;
  taskTitle: string;
}

function PinnedTasksBar({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { mutate } = useSWRConfig();
  const swrKey = `/api/workspaces/${workspaceId}/pinned-tasks`;
  const { data } = useSWR<{ pinnedTasks: PinnedItem[] }>(
    swrKey,
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 60_000 }
  );
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const pinned = data?.pinnedTasks ?? [];
  if (pinned.length === 0) {
    return null;
  }

  async function handleUnpin(e: React.MouseEvent, taskId: string) {
    e.stopPropagation();
    mutate(
      swrKey,
      (prev: { pinnedTasks: PinnedItem[] } | undefined) => ({
        pinnedTasks: (prev?.pinnedTasks ?? []).filter(
          (t) => t.taskId !== taskId
        ),
      }),
      { revalidate: false }
    );
    window.dispatchEvent(
      new CustomEvent("task-personal-unpin", { detail: { taskId } })
    );
    await fetch(`/api/tasks/${taskId}/pin`, { method: "DELETE" });
    mutate(swrKey);
  }
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && scrollRef.current) {
      e.preventDefault();
      scrollRef.current.scrollLeft += e.deltaY;
    }
  }

  return (
    <div className="h-9 shrink-0 border-b border-base-300 bg-surface overflow-hidden">
      <div
        className="flex h-full items-center gap-1 px-3 overflow-x-auto [&::-webkit-scrollbar]:hidden"
        onWheel={handleWheel}
        ref={scrollRef}
        style={{ scrollbarWidth: "none" } as React.CSSProperties}
      >
        <PushPinIcon
          className="size-3 shrink-0 text-base-content/60"
          weight="fill"
        />
        {pinned.map((item) => {
          const isActive = pathname === `/${workspaceId}/task/${item.taskId}`;
          return (
            <div
              className={cn(
                "group/pin relative flex h-5 items-center rounded shrink-0 max-w-40 overflow-hidden border",
                isActive
                  ? "bg-primary/10 border-primary/30"
                  : "border-base-300 hover:bg-base-200"
              )}
              key={item.id}
            >
              <button
                className={cn(
                  "min-w-0 flex-1 flex h-full items-center pl-2 pr-1 text-xs font-medium transition-colors cursor-pointer overflow-hidden",
                  isActive
                    ? "text-primary"
                    : "text-base-content/60 group-hover/pin:text-base-content"
                )}
                onClick={() =>
                  router.push(`/${workspaceId}/task/${item.taskId}`)
                }
                title={[item.spaceName, item.listName]
                  .filter(Boolean)
                  .join(" · ")}
                type="button"
              >
                <span className="truncate block">{item.taskTitle}</span>
              </button>
              <button
                className="hidden group-hover/pin:flex shrink-0 h-full items-center px-1 text-base-content/60 hover:text-base-content transition-colors cursor-pointer"
                onClick={(e) => handleUnpin(e, item.taskId)}
                title="Unpin"
                type="button"
              >
                <PushPinSlashIcon className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TopbarRightColumn ────────────────────────────────────────────────────────
// Separated so it can read TopbarContext (must be inside TopbarProvider)

function TopbarRightColumn({
  workspaceId,
  isAdmin,
  taskCapacity,
  onOpenSidebar,
  onOpenSearch,
  children,
}: {
  workspaceId: string;
  isAdmin: boolean;
  taskCapacity?: { limit: number | null; used: number };
  onOpenSidebar: () => void;
  onOpenSearch: () => void;
  children: React.ReactNode;
}) {
  const topbar = useTopbarState();

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center border-b border-base-300 bg-surface px-4 gap-3">
        {/* Mobile sidebar toggle */}
        <Button
          className="size-8 lg:hidden shrink-0"
          onClick={onOpenSidebar}
          size="icon"
          variant="ghost"
        >
          <ListIcon className="size-5" />
        </Button>

        {/* Breadcrumb — injected by active page */}
        <div className="flex flex-1 items-center gap-1.5 min-w-0 text-sm">
          {topbar ? (
            <>
              {topbar.breadcrumbs.map((crumb, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs have no stable id (just label/href/emoji) and are rebuilt fresh per page render, never reordered in place
                <React.Fragment key={i}>
                  {i > 0 && (
                    <CaretRightIcon className="size-3.5 text-base-content/60 shrink-0" />
                  )}
                  {crumb.href ? (
                    <Link
                      className="flex items-center gap-1.5 text-base-content/60 font-medium shrink-0 hover:text-base-content transition-colors"
                      href={crumb.href}
                    >
                      {(crumb.emoji || crumb.color) && (
                        <SpaceIcon color={crumb.color} emoji={crumb.emoji} />
                      )}
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-1.5 text-base-content/60 font-medium shrink-0">
                      {(crumb.emoji || crumb.color) && (
                        <SpaceIcon color={crumb.color} emoji={crumb.emoji} />
                      )}
                      {crumb.label}
                    </span>
                  )}
                </React.Fragment>
              ))}
              {topbar.breadcrumbs.length > 0 && (
                <CaretRightIcon className="size-3.5 text-base-content/60 shrink-0" />
              )}
              <span className="font-semibold text-base-content truncate">
                {topbar.title}
              </span>
              {topbar.actions && (
                <div className="ml-auto shrink-0">{topbar.actions}</div>
              )}
            </>
          ) : null}
        </div>

        {/* Search — right side. Icon-only on narrow screens so it doesn't
            crowd out the breadcrumb; full search box from sm: up. */}
        <Button
          className="size-8 sm:hidden shrink-0"
          onClick={onOpenSearch}
          size="icon"
          variant="ghost"
        >
          <MagnifyingGlassIcon className="size-4.5" />
        </Button>
        <button
          className="hidden sm:flex items-center gap-2 h-8 w-52 shrink-0 rounded-md border bg-base-200/50 px-3 text-sm text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
          onClick={onOpenSearch}
          type="button"
        >
          <MagnifyingGlassIcon className="size-4 shrink-0" />
          <span className="flex-1 text-left text-sm">Search…</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border bg-base-100 px-1.5 py-0.5 text-xs font-medium text-base-content/60">
            ⌘K
          </kbd>
        </button>
      </header>

      <TaskLimitBanner
        capacity={taskCapacity}
        isAdmin={isAdmin}
        workspaceId={workspaceId}
      />
      <PushNotificationBanner workspaceId={workspaceId} />
      <PinnedTasksBar workspaceId={workspaceId} />
      <main className="flex-1 overflow-auto bg-app">{children}</main>
    </div>
  );
}
