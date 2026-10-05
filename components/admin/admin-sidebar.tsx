"use client";

import {
  ArrowLeftIcon,
  BuildingsIcon,
  ChartBarIcon,
  EnvelopeIcon,
  GearSixIcon,
  ListIcon,
  PlugsIcon,
  ScrollIcon,
  SignOutIcon,
  SquaresFourIcon,
  StackIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { PRODUCT_NAME } from "@/config/platform";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface NavChild {
  href: string;
  label: string;
}

interface NavItem {
  children?: NavChild[];
  href: string;
  icon: typeof SquaresFourIcon;
  label: string;
}

const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: SquaresFourIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/workspaces", label: "Workspaces", icon: BuildingsIcon },
  { href: "/admin/analytics", label: "Analytics", icon: ChartBarIcon },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollIcon },
];

const ORBIT_NAV_ITEMS: NavItem[] = [
  { href: "/orbit", label: "Overview", icon: SquaresFourIcon },
  { href: "/orbit/users", label: "Users", icon: UsersIcon },
  { href: "/orbit/email", label: "Email", icon: EnvelopeIcon },
  { href: "/orbit/queues", label: "Queues", icon: StackIcon },
  { href: "/orbit/integrations", label: "Integrations", icon: PlugsIcon },
  {
    href: "/orbit/settings",
    label: "Settings",
    icon: GearSixIcon,
    children: [
      { href: "/orbit/settings/notifications", label: "Notifications" },
    ],
  },
];

interface AdminSidebarProps {
  email?: string;
}

export function AdminSidebar({ email }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isOrbit = pathname.startsWith("/orbit");
  const navItems = isOrbit ? ORBIT_NAV_ITEMS : ADMIN_NAV_ITEMS;
  // No persistent sidebar below `lg` — this drawer mirrors the pattern in
  // components/workspace/workspace-shell.tsx (hamburger + slide-in + backdrop).
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await authClient.signOut();
    // /orbit uses a Better Auth session; /admin uses the legacy password
    // login — sending an orbit admin to /admin/login would be a dead end.
    router.push(isOrbit ? "/login" : "/admin/login");
  }

  return (
    <>
      {/* Mobile top bar — normal-flow sibling of <aside>, so the parent
          layout's `flex-col lg:flex-row` stacks it above <main> on small
          screens and it disappears entirely at `lg` (where the sidebar is
          static again). */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950 px-3 text-slate-100 lg:hidden">
        <button
          aria-label="Open menu"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white"
          onClick={() => setMobileOpen(true)}
          type="button"
        >
          <ListIcon className="size-5" />
        </button>
        <span className="text-sm font-bold">Admin Console</span>
      </div>

      {mobileOpen && (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-20 border-0 bg-black/50 p-0 lg:hidden"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950 text-slate-100 transition-transform duration-200 lg:static lg:h-full",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="px-4 py-5 border-b border-slate-800 flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-emerald-400 to-emerald-600 shadow-md shadow-emerald-500/30">
            <svg
              className="h-4 w-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
          </div>
          <div>
            <div className="text-2xs font-semibold text-slate-500 uppercase tracking-wider">
              {PRODUCT_NAME}
            </div>
            <div className="text-sm font-bold leading-tight">Admin Console</div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {/* Return to the normal Kanbanica app without signing out. */}
          <Link
            className="mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-800/60 hover:text-white"
            href="/post-auth"
            onClick={() => setMobileOpen(false)}
          >
            <ArrowLeftIcon className="w-4 h-4 shrink-0" />
            Back to app
          </Link>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/admin" || item.href === "/orbit"
                ? pathname === item.href
                : pathname.startsWith(item.href);
            // A group with children is a heading-style parent: the parent
            // stays neutral and the active child carries the highlight.
            const hasChildren = !!item.children?.length;
            const parentActive = hasChildren ? false : isActive;
            return (
              <div key={item.href}>
                <Link
                  className={cn(
                    "relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    parentActive
                      ? "bg-emerald-500/10 text-emerald-300 font-medium"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-white",
                    hasChildren && isActive && "text-slate-200"
                  )}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                >
                  {parentActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-emerald-400" />
                  )}
                  <Icon
                    className={cn(
                      "w-4 h-4 shrink-0",
                      parentActive && "text-emerald-400"
                    )}
                  />
                  {item.label}
                </Link>
                {item.children?.map((child) => {
                  const childActive = pathname.startsWith(child.href);
                  return (
                    <Link
                      className={cn(
                        "relative ml-7 mt-0.5 flex items-center rounded-md px-3 py-1.5 text-sm transition-colors",
                        childActive
                          ? "bg-emerald-500/10 text-emerald-300 font-medium"
                          : "text-slate-400 hover:bg-slate-800/60 hover:text-white"
                      )}
                      href={child.href}
                      key={child.href}
                      onClick={() => setMobileOpen(false)}
                    >
                      {childActive && (
                        <span className="absolute -left-4 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-emerald-400" />
                      )}
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="px-2 py-4 border-t border-slate-800 space-y-2">
          {email && (
            <div className="px-3 text-xs text-slate-500 truncate" title={email}>
              {email}
            </div>
          )}
          <button
            className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
            onClick={handleSignOut}
            type="button"
          >
            <SignOutIcon className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
