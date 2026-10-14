"use client";

import {
  ArchiveIcon,
  CaretDownIcon,
  CheckSquareIcon,
  ClockIcon,
  FunnelIcon,
  ListIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import {
  type GlobalSearchResults,
  getSearchFilterOptions,
  globalSearch,
  recordSearchVisit,
  type SearchFilterOptions,
} from "@/app/actions/search";
import { SpaceIcon } from "@/components/common/space-icon";
import { useToday } from "@/components/common/timezone-provider";
import { UserAvatar } from "@/components/common/user-avatar";
import {
  FacetFilter,
  type FacetOption,
  FacetOptionList,
} from "@/components/filters/facet-filter";
import { FilterChip } from "@/components/filters/filter-chip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import {
  DUE_OPTIONS,
  type DueValue,
  type GlobalSearchFilters,
  hasActiveFilters,
  PRIORITY_OPTIONS,
  type SearchEntityType,
  STATUS_TYPE_OPTIONS,
  type StatusType,
  TYPE_OPTIONS,
} from "@/lib/filters/options";
import {
  formatDueDate,
  PRIORITY_CONFIG,
  type Priority,
} from "@/lib/priority-config";
import {
  clearRecentlyOpened,
  getRecentlyOpened,
  type OpenedItem,
  recordOpened,
} from "@/lib/recent-opened";
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  type RecentSearch,
} from "@/lib/recent-search";
import { setTaskNavContext } from "@/lib/task-nav-context";
import { cn } from "@/lib/utils";

interface SearchPaletteProps {
  onClose: () => void;
  open: boolean;
  workspaceId: string;
}

/** Flat, keyboard-navigable list of the navigable results (members excluded). */
type FlatItem =
  | { kind: "task"; id: string }
  | { kind: "list"; id: string; spaceId: string }
  | { kind: "space"; id: string };

const SKELETON_ROWS = ["s1", "s2", "s3", "s4"];

// Quick filters TOGGLE the same filter state as the advanced controls (no
// separate state): click enables, click again disables.
type QuickFilter =
  | { label: string; kind: "priority"; value: string }
  | { label: string; kind: "statusType"; value: StatusType }
  | { label: string; kind: "due"; value: DueValue };

const QUICK_FILTERS: QuickFilter[] = [
  { label: "🚨 Urgent", kind: "priority", value: "URGENT" },
  { label: "📅 Due today", kind: "due", value: "today" },
  { label: "⏰ Overdue", kind: "due", value: "overdue" },
  { label: "✅ Done", kind: "statusType", value: "CLOSED" },
  { label: "🏃 In progress", kind: "statusType", value: "ACTIVE" },
];

// Single source of truth for the footer hint bar.
const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "↑↓", label: "Navigate" },
  { keys: "Enter", label: "Open" },
  { keys: "Esc", label: "Close" },
  { keys: "Tab", label: "Next filter" },
];

export function SearchPalette({
  workspaceId,
  open,
  onClose,
}: SearchPaletteProps) {
  const router = useRouter();
  const today = useToday();
  const { query, setQuery, debouncedQuery } = useDebouncedSearch(300);
  const [filters, setFilters] = React.useState<GlobalSearchFilters>({});
  const [results, setResults] = React.useState<GlobalSearchResults | null>(
    null
  );
  const [loading, setLoading] = React.useState(false);
  const [options, setOptions] = React.useState<SearchFilterOptions | null>(
    null
  );
  const [recent, setRecent] = React.useState<RecentSearch[]>([]);
  const [recentOpened, setRecentOpened] = React.useState<OpenedItem[]>([]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtersActive = hasActiveFilters(filters);
  const searching = Boolean(debouncedQuery) || filtersActive;

  // Reset + load options/recent when opened.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 50);
    setQuery("");
    setFilters({});
    setResults(null);
    setSelectedIndex(0);
    setRecent(getRecentSearches(workspaceId));
    setRecentOpened(getRecentlyOpened(workspaceId));
    getSearchFilterOptions(workspaceId).then((res) => {
      if (!("error" in res)) {
        setOptions(res);
      }
    });
  }, [open, workspaceId, setQuery]);

  // Run a search on debounced text OR active filters (filter-only search).
  React.useEffect(() => {
    setSelectedIndex(0);
    if (!(Boolean(debouncedQuery) || hasActiveFilters(filters))) {
      setResults(null);
      return;
    }
    setLoading(true);
    globalSearch(workspaceId, debouncedQuery, filters)
      .then((res) => {
        if (!("error" in res)) {
          setResults(res);
        }
      })
      .finally(() => setLoading(false));
  }, [debouncedQuery, filters, workspaceId]);

  const flatItems = React.useMemo<FlatItem[]>(() => {
    if (!results) {
      return [];
    }
    const items: FlatItem[] = [];
    for (const t of results.tasks) {
      items.push({ kind: "task", id: t.id });
    }
    for (const l of results.lists) {
      items.push({ kind: "list", id: l.id, spaceId: l.spaceId });
    }
    for (const s of results.spaces) {
      items.push({ kind: "space", id: s.id });
    }
    return items;
  }, [results]);

  // Close on Escape (from anywhere).
  React.useEffect(() => {
    if (!open) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function set<K extends keyof GlobalSearchFilters>(
    key: K,
    value: GlobalSearchFilters[K]
  ) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  // Quick filters toggle a single value in the shared filter state.
  function isQuickActive(qf: QuickFilter): boolean {
    if (qf.kind === "due") {
      return filters.due === qf.value;
    }
    return (filters[qf.kind] ?? []).includes(qf.value);
  }
  function toggleQuick(qf: QuickFilter) {
    if (qf.kind === "due") {
      set("due", filters.due === qf.value ? "" : qf.value);
      return;
    }
    const current = (filters[qf.kind] ?? []) as string[];
    const next = current.includes(qf.value)
      ? current.filter((v) => v !== qf.value)
      : [...current, qf.value];
    set(qf.kind, next as GlobalSearchFilters[typeof qf.kind]);
  }

  async function navigateTask(taskId: string) {
    const t = results?.tasks.find((x) => x.id === taskId);
    if (t) {
      recordOpened(workspaceId, {
        kind: "task",
        id: t.id,
        title: t.title,
        subtitle: `${t.spaceName}${t.listName ? ` • ${t.listName}` : ""}`,
      });
    }
    addRecentSearch(workspaceId, query, filters);
    await recordSearchVisit(workspaceId, "task", taskId);
    onClose();
    setTaskNavContext({ taskIds: results?.tasks.map((x) => x.id) ?? [] });
    router.push(`/${workspaceId}/task/${taskId}`);
  }

  async function navigateList(listId: string, spaceId: string) {
    const l = results?.lists.find((x) => x.id === listId);
    if (l) {
      recordOpened(workspaceId, {
        kind: "list",
        id: l.id,
        title: l.name,
        subtitle: l.spaceName,
        spaceId: l.spaceId,
      });
    }
    addRecentSearch(workspaceId, query, filters);
    await recordSearchVisit(workspaceId, "list", listId);
    onClose();
    router.push(`/${workspaceId}/${spaceId}/list/${listId}`);
  }

  async function navigateSpace(spaceId: string) {
    const s = results?.spaces.find((x) => x.id === spaceId);
    // Archived projects have no viewable page (they're hidden from the
    // sidebar and can only be unarchived, not opened) — surface that instead
    // of navigating into a 404.
    if (s?.isArchived) {
      toast.info(
        `"${s.name}" is archived. Unarchive it from the sidebar to open it.`
      );
      return;
    }
    if (s) {
      recordOpened(workspaceId, { kind: "space", id: s.id, title: s.name });
    }
    addRecentSearch(workspaceId, query, filters);
    await recordSearchVisit(workspaceId, "space", spaceId);
    onClose();
    router.push(`/${workspaceId}/${spaceId}`);
  }

  function navigateOpened(item: OpenedItem) {
    onClose();
    if (item.kind === "task") {
      router.push(`/${workspaceId}/task/${item.id}`);
    } else if (item.kind === "list" && item.spaceId) {
      router.push(`/${workspaceId}/${item.spaceId}/list/${item.id}`);
    } else {
      router.push(`/${workspaceId}/${item.id}`);
    }
  }

  function navigateFlat(it: FlatItem) {
    if (it.kind === "task") {
      void navigateTask(it.id);
    } else if (it.kind === "list") {
      void navigateList(it.id, it.spaceId);
    } else {
      void navigateSpace(it.id);
    }
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (flatItems.length === 0) {
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const it = flatItems[selectedIndex];
      if (it) {
        e.preventDefault();
        navigateFlat(it);
      }
    }
  }

  function applyRecent(r: RecentSearch) {
    setQuery(r.query);
    setFilters(r.filters);
  }

  if (!open) {
    return null;
  }

  // Split for the empty state's "Recently viewed tasks" / "Recent projects"
  // sections — same underlying recentOpened data, just grouped by kind.
  const recentTasks = recentOpened.filter((o) => o.kind === "task");
  const recentProjects = recentOpened.filter((o) => o.kind === "space");
  const recentLists = recentOpened.filter((o) => o.kind === "list");

  function handleClearRecentlyOpened() {
    clearRecentlyOpened(workspaceId);
    setRecentOpened([]);
  }

  const hasResults =
    results &&
    (results.tasks.length > 0 ||
      results.lists.length > 0 ||
      results.spaces.length > 0 ||
      results.members.length > 0);

  // Filter-option lists from the loaded workspace options.
  const assigneeOptions: FacetOption[] = [
    { value: "unassigned", label: "Unassigned" },
    ...(options?.members ?? []).map((m) => ({
      value: m.userId,
      label: m.name ?? m.email ?? "Unknown",
    })),
  ];
  const spaceOptions: FacetOption[] = (options?.spaces ?? []).map((s) => ({
    value: s.id,
    label: s.name,
    icon: <SpaceIcon color={s.color} emoji={s.logoEmoji} size="sm" />,
  }));
  const sprintOptions: FacetOption[] = (options?.sprints ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));
  const tagOptions: FacetOption[] = (options?.tags ?? []).map((t) => ({
    value: t.id,
    label: t.name,
    color: t.color,
  }));

  const moreCount =
    (filters.priority?.length ?? 0) +
    (filters.space?.length ?? 0) +
    (filters.sprint?.length ?? 0) +
    (filters.tags?.length ?? 0) +
    (filters.due ? 1 : 0);

  // Active-filter chips (each removes exactly its own value).
  const activeChips: { key: string; label: string; onRemove: () => void }[] =
    [];
  if (filters.type && filters.type !== "all") {
    activeChips.push({
      key: "type",
      label:
        TYPE_OPTIONS.find((o) => o.value === filters.type)?.label ??
        filters.type,
      onRemove: () => set("type", "all"),
    });
  }
  for (const st of filters.statusType ?? []) {
    activeChips.push({
      key: `st-${st}`,
      label: STATUS_TYPE_OPTIONS.find((o) => o.value === st)?.label ?? st,
      onRemove: () =>
        set(
          "statusType",
          (filters.statusType ?? []).filter((v) => v !== st)
        ),
    });
  }
  for (const p of filters.priority ?? []) {
    activeChips.push({
      key: `p-${p}`,
      label: PRIORITY_CONFIG[p as Priority]?.label ?? p,
      onRemove: () =>
        set(
          "priority",
          (filters.priority ?? []).filter((v) => v !== p)
        ),
    });
  }
  for (const a of filters.assignee ?? []) {
    const m = options?.members.find((x) => x.userId === a);
    activeChips.push({
      key: `a-${a}`,
      label:
        a === "unassigned" ? "Unassigned" : (m?.name ?? m?.email ?? "Assignee"),
      onRemove: () =>
        set(
          "assignee",
          (filters.assignee ?? []).filter((v) => v !== a)
        ),
    });
  }
  for (const sp of filters.space ?? []) {
    activeChips.push({
      key: `sp-${sp}`,
      label: options?.spaces.find((x) => x.id === sp)?.name ?? "Project",
      onRemove: () =>
        set(
          "space",
          (filters.space ?? []).filter((v) => v !== sp)
        ),
    });
  }
  for (const spr of filters.sprint ?? []) {
    activeChips.push({
      key: `spr-${spr}`,
      label: options?.sprints.find((x) => x.id === spr)?.name ?? "Sprint",
      onRemove: () =>
        set(
          "sprint",
          (filters.sprint ?? []).filter((v) => v !== spr)
        ),
    });
  }
  for (const t of filters.tags ?? []) {
    activeChips.push({
      key: `t-${t}`,
      label: options?.tags.find((x) => x.id === t)?.name ?? "Tag",
      onRemove: () =>
        set(
          "tags",
          (filters.tags ?? []).filter((v) => v !== t)
        ),
    });
  }
  if (filters.due) {
    activeChips.push({
      key: "due",
      label:
        DUE_OPTIONS.find((o) => o.value === filters.due)?.label ?? filters.due,
      onRemove: () => set("due", ""),
    });
  }

  const active = flatItems[selectedIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[6dvh] sm:pt-[12vh]">
      {/* Backdrop — light blur + a semi-transparent dark overlay. Purely a
          dismiss target; Escape (handled above) covers the keyboard path.
          aria-hidden takes it out of the accessibility tree entirely. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "relative z-10 flex w-[min(880px,92vw)] flex-col overflow-hidden rounded-xl border bg-elevated shadow-2xl transition-[height] duration-200",
          // Grow to fit ~4–5 result rows only when there's data; otherwise keep
          // the compact default so an empty palette isn't oversized. dvh (not
          // vh) on mobile so the panel shrinks with the on-screen keyboard
          // instead of getting pushed off the bottom of the layout viewport.
          hasResults
            ? "h-[min(600px,85dvh)] sm:h-[min(600px,85vh)]"
            : "h-[min(440px,85dvh)] sm:h-[min(440px,85vh)]"
        )}
      >
        {/* Search input — the dominant element. */}
        <div className="flex h-[66px] shrink-0 items-center gap-3 border-b px-4 sm:gap-4 sm:px-6">
          <MagnifyingGlassIcon className="size-6 shrink-0 text-base-content/60" />
          <input
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-base-content/60 sm:text-lg"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search tasks, lists, projects, members — or filter below…"
            ref={inputRef}
            type="text"
            value={query}
          />
          {query && (
            <button
              aria-label="Clear search"
              className="flex size-6 shrink-0 items-center justify-center rounded text-base-content/60 hover:bg-base-200 hover:text-base-content"
              onClick={() => setQuery("")}
              type="button"
            >
              <XIcon className="size-3.5" weight="bold" />
            </button>
          )}
          <button
            aria-label="Close"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-error/10 text-error hover:bg-error/20 dark:bg-error/20 dark:hover:bg-error/30"
            onClick={onClose}
            type="button"
          >
            <XIcon className="size-4" weight="bold" />
          </button>
        </div>

        {/* Filter row — high-value facets inline; the rest behind "More filters".
            The muted background groups the filter controls into their own zone,
            distinct from the search box above and the results below. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b bg-base-200/30 px-3 py-3 sm:px-5">
          <FacetFilter
            label="Type"
            onChange={(n) => set("type", (n[0] as SearchEntityType) ?? "all")}
            options={TYPE_OPTIONS.filter((o) => o.value !== "all")}
            selected={
              filters.type && filters.type !== "all" ? [filters.type] : []
            }
            single
          />
          <FacetFilter
            label="Assignee"
            onChange={(n) => set("assignee", n)}
            options={assigneeOptions}
            searchable
            selected={filters.assignee ?? []}
          />
          <FacetFilter
            label="Status"
            onChange={(n) => set("statusType", n as StatusType[])}
            options={STATUS_TYPE_OPTIONS}
            selected={filters.statusType ?? []}
          />

          {/* More filters */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "flex h-9 shrink-0 select-none items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors",
                  moreCount > 0
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-base-300 text-base-content/60 hover:bg-base-200 hover:text-base-content"
                )}
                type="button"
              >
                <FunnelIcon className="size-3.5" />
                More filters
                {moreCount > 0 && (
                  <span className="font-bold">({moreCount})</span>
                )}
                <CaretDownIcon className="size-3 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-[55vh] w-72 overflow-y-auto rounded-xl p-2"
            >
              <Accordion
                className="w-full"
                collapsible
                defaultValue="priority"
                type="single"
              >
                <MoreFilterAccordionItem
                  count={filters.priority?.length ?? 0}
                  label="Priority"
                  value="priority"
                >
                  <FacetOptionList
                    onChange={(n) => set("priority", n)}
                    options={PRIORITY_OPTIONS}
                    selected={filters.priority ?? []}
                  />
                </MoreFilterAccordionItem>
                <MoreFilterAccordionItem
                  count={filters.space?.length ?? 0}
                  label="Project"
                  value="project"
                >
                  <FacetOptionList
                    emptyText="No projects"
                    onChange={(n) => set("space", n)}
                    options={spaceOptions}
                    searchable={spaceOptions.length > 6}
                    selected={filters.space ?? []}
                  />
                </MoreFilterAccordionItem>
                <MoreFilterAccordionItem
                  count={filters.sprint?.length ?? 0}
                  label="Sprint"
                  value="sprint"
                >
                  <FacetOptionList
                    emptyText="No sprints"
                    onChange={(n) => set("sprint", n)}
                    options={sprintOptions}
                    searchable={sprintOptions.length > 6}
                    selected={filters.sprint ?? []}
                  />
                </MoreFilterAccordionItem>
                <MoreFilterAccordionItem
                  count={filters.tags?.length ?? 0}
                  label="Tags"
                  value="tags"
                >
                  <FacetOptionList
                    emptyText="No tags"
                    onChange={(n) => set("tags", n)}
                    options={tagOptions}
                    searchable={tagOptions.length > 6}
                    selected={filters.tags ?? []}
                  />
                </MoreFilterAccordionItem>
                <MoreFilterAccordionItem
                  count={filters.due ? 1 : 0}
                  label="Due Date"
                  value="due"
                >
                  <FacetOptionList
                    onChange={(n) => set("due", (n[0] as DueValue) ?? "")}
                    options={DUE_OPTIONS}
                    selected={filters.due ? [filters.due] : []}
                    single
                  />
                </MoreFilterAccordionItem>
              </Accordion>
            </PopoverContent>
          </Popover>

          <span className="mx-1 h-5 w-px shrink-0 bg-base-300" />

          {/* Quick filters — toggle chips over the same filter state. */}
          {QUICK_FILTERS.map((q) => {
            const activeQuick = isQuickActive(q);
            return (
              <button
                className={cn(
                  "flex h-9 shrink-0 select-none items-center rounded-full border px-3 text-xs font-medium transition-colors",
                  activeQuick
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-base-300 text-base-content/60 hover:bg-base-200 hover:text-base-content"
                )}
                key={q.label}
                onClick={() => toggleQuick(q)}
                type="button"
              >
                {q.label}
              </button>
            );
          })}
        </div>

        {/* Active-filter chips */}
        {activeChips.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-base-200/30 px-3 py-2.5 sm:px-5">
            {activeChips.map((c) => (
              <FilterChip key={c.key} label={c.label} onRemove={c.onRemove} />
            ))}
            <button
              className="ml-auto shrink-0 rounded-md px-2 py-1 text-xs font-medium text-base-content/60 hover:text-base-content"
              onClick={() => setFilters({})}
              type="button"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Results / recent — this area absorbs all the extra height so the
            fixed-height chrome above/below stays constant. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <div className="space-y-1.5 p-3">
              {SKELETON_ROWS.map((k) => (
                <div className="flex items-center gap-3 px-3 py-3" key={k}>
                  <div className="size-2 shrink-0 animate-pulse rounded-full bg-base-200" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-1/2 animate-pulse rounded bg-base-200" />
                    <div className="h-2.5 w-1/3 animate-pulse rounded bg-base-200" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && searching && !hasResults && (
            <div className="flex flex-col items-center gap-2.5 py-16">
              <MagnifyingGlassIcon className="size-8 text-base-content/30" />
              <p className="text-sm text-base-content/60">
                No results{debouncedQuery ? ` for “${debouncedQuery}”` : ""}
              </p>
            </div>
          )}

          {!loading && !searching && (
            <div className="p-3">
              {recent.length > 0 && (
                <section className="pb-3">
                  <div className="flex items-center justify-between px-3 pb-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                      Recent searches
                    </p>
                    <button
                      className="text-2xs text-base-content/60 hover:text-base-content"
                      onClick={() => {
                        clearRecentSearches(workspaceId);
                        setRecent([]);
                      }}
                      type="button"
                    >
                      Clear
                    </button>
                  </div>
                  {recent.map((r) => (
                    <button
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-base-200"
                      key={`${r.at}-${r.query}`}
                      onClick={() => applyRecent(r)}
                      type="button"
                    >
                      <ClockIcon className="size-4 shrink-0 text-base-content/60" />
                      <span className="flex-1 truncate text-sm">
                        {r.query || "Filtered search"}
                      </span>
                      {recentFilterCount(r) > 0 && (
                        <span className="shrink-0 text-2xs text-base-content/60">
                          {recentFilterCount(r)} filter
                          {recentFilterCount(r) > 1 ? "s" : ""}
                        </span>
                      )}
                    </button>
                  ))}
                </section>
              )}

              <RecentOpenedSection
                icon={
                  <CheckSquareIcon className="size-4 shrink-0 text-base-content/60" />
                }
                items={recentTasks}
                onClear={
                  recentTasks.length > 0 ? handleClearRecentlyOpened : undefined
                }
                onSelect={navigateOpened}
                title="Recently viewed tasks"
              />
              <RecentOpenedSection
                icon={
                  <SquaresFourIcon className="size-4 shrink-0 text-base-content/60" />
                }
                items={recentProjects}
                onClear={
                  recentTasks.length === 0 && recentProjects.length > 0
                    ? handleClearRecentlyOpened
                    : undefined
                }
                onSelect={navigateOpened}
                title="Recent projects"
              />
              <RecentOpenedSection
                icon={
                  <ListIcon className="size-4 shrink-0 text-base-content/60" />
                }
                items={recentLists}
                onClear={
                  recentTasks.length === 0 &&
                  recentProjects.length === 0 &&
                  recentLists.length > 0
                    ? handleClearRecentlyOpened
                    : undefined
                }
                onSelect={navigateOpened}
                title="Recent lists"
              />

              {/* First-run fallback — only when there's truly no recent
                  activity yet. Keyboard shortcuts live in the footer below,
                  so this doesn't repeat them. */}
              {recent.length === 0 && recentOpened.length === 0 && (
                <section className="flex flex-col items-center gap-2 px-3 py-14 text-center">
                  <MagnifyingGlassIcon className="size-8 text-base-content/30" />
                  <p className="text-sm font-medium">
                    Search across your workspace
                  </p>
                  <p className="max-w-xs text-xs text-base-content/60">
                    Find tasks, lists, projects, and members — or narrow things
                    down with the filters above. Your recent searches and
                    recently viewed items will show up here.
                  </p>
                </section>
              )}
            </div>
          )}

          {!loading && hasResults && results && (
            <div className="divide-y">
              {results.tasks.length > 0 && (
                <ResultSection count={results.tasks.length} title="Tasks">
                  {results.tasks.map((t) => {
                    const isActive =
                      active?.kind === "task" && active.id === t.id;
                    const cfg = PRIORITY_CONFIG[t.priority as Priority];
                    const due = formatDueDate(t.dueDateEnd, today);
                    return (
                      <button
                        className={cn(
                          "flex w-full items-start gap-3 border-l-2 px-5 py-2.5 text-left transition-colors",
                          isActive
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-base-200"
                        )}
                        key={t.id}
                        onClick={() => navigateTask(t.id)}
                        type="button"
                      >
                        <span
                          className="mt-1.5 inline-flex size-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: t.statusColor ?? undefined,
                          }}
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <p
                              className={cn(
                                "truncate text-sm font-medium",
                                t.isArchived &&
                                  "text-base-content/60 line-through"
                              )}
                            >
                              {t.title}
                            </p>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {t.isArchived && (
                                <span className="flex items-center gap-1 rounded-full bg-base-200 px-2 py-0.5 text-2xs font-medium text-base-content/60">
                                  <ArchiveIcon className="size-3" />
                                  Archived
                                </span>
                              )}
                              {t.statusName && (
                                <span
                                  className="rounded-full px-2 py-0.5 text-2xs font-medium"
                                  style={{
                                    backgroundColor: t.statusColor
                                      ? t.statusColor + "26"
                                      : undefined,
                                    color: t.statusColor ?? undefined,
                                  }}
                                >
                                  {t.statusName}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-base-content/60">
                            <span className="truncate">
                              {t.spaceName}
                              {t.listName ? ` • ${t.listName}` : ""}
                            </span>
                            {cfg && t.priority !== "NONE" && (
                              <span
                                className={cn(
                                  "flex items-center gap-0.5 font-medium",
                                  cfg.color
                                )}
                              >
                                <span>{cfg.icon}</span>
                                {cfg.label}
                              </span>
                            )}
                            {due && (
                              <span
                                className={
                                  due.overdue ? "font-medium text-error" : ""
                                }
                              >
                                {due.label}
                              </span>
                            )}
                            {t.assignees.length > 0 && (
                              <span className="flex -space-x-1">
                                {t.assignees.slice(0, 3).map((a) => (
                                  <UserAvatar
                                    className="border border-base-100"
                                    email={a.email}
                                    key={a.userId}
                                    name={a.name}
                                    size="xs"
                                  />
                                ))}
                                {t.assignees.length > 3 && (
                                  <span className="flex size-5 items-center justify-center rounded-full border border-base-100 bg-base-200 text-[9px] font-medium">
                                    +{t.assignees.length - 3}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </ResultSection>
              )}

              {results.lists.length > 0 && (
                <ResultSection count={results.lists.length} title="Lists">
                  {results.lists.map((l) => {
                    const isActive =
                      active?.kind === "list" && active.id === l.id;
                    return (
                      <button
                        className={cn(
                          "flex w-full items-center gap-3 border-l-2 px-5 py-2 text-left transition-colors",
                          isActive
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-base-200"
                        )}
                        key={l.id}
                        onClick={() => navigateList(l.id, l.spaceId)}
                        type="button"
                      >
                        <ListIcon className="size-4 shrink-0 text-base-content/60" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {l.name}
                          </p>
                          <p className="text-xs text-base-content/60">
                            {l.spaceName}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </ResultSection>
              )}

              {results.spaces.length > 0 && (
                <ResultSection count={results.spaces.length} title="Projects">
                  {results.spaces.map((s) => {
                    const isActive =
                      active?.kind === "space" && active.id === s.id;
                    return (
                      <button
                        className={cn(
                          "flex w-full items-center gap-3 border-l-2 px-5 py-2 text-left transition-colors",
                          isActive
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-base-200"
                        )}
                        key={s.id}
                        onClick={() => navigateSpace(s.id)}
                        type="button"
                      >
                        {s.logoEmoji ? (
                          <span className="flex size-4 shrink-0 items-center justify-center text-[15px] leading-none">
                            {s.logoEmoji}
                          </span>
                        ) : (
                          <SquaresFourIcon
                            className="size-4 shrink-0"
                            style={{ color: s.color ?? undefined }}
                          />
                        )}
                        <p
                          className={cn(
                            "truncate text-sm font-medium",
                            s.isArchived && "text-base-content/60 line-through"
                          )}
                        >
                          {s.name}
                        </p>
                        {s.isArchived && (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-base-200 px-2 py-0.5 text-2xs font-medium text-base-content/60">
                            <ArchiveIcon className="size-3" />
                            Archived
                          </span>
                        )}
                      </button>
                    );
                  })}
                </ResultSection>
              )}

              {results.members.length > 0 && (
                <ResultSection count={results.members.length} title="Members">
                  {results.members.map((m) => (
                    <div
                      className="flex w-full items-center gap-3 border-l-2 border-transparent px-5 py-2"
                      key={m.userId}
                    >
                      <UserAvatar email={m.email} name={m.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {m.name ?? m.email}
                        </p>
                        {m.name && (
                          <p className="text-xs text-base-content/60">
                            {m.email}
                          </p>
                        )}
                      </div>
                      <span className="text-2xs uppercase text-base-content/60">
                        {m.role}
                      </span>
                    </div>
                  ))}
                </ResultSection>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t px-4 py-3 text-2xs text-base-content/60 sm:px-6">
          {SHORTCUTS.map((s) => (
            <FooterHint key={s.keys} keys={s.keys} label={s.label} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="py-2">
      <p className="px-5 pb-1 text-xs font-semibold uppercase tracking-wider text-base-content/60">
        {title} <span className="text-base-content/60">({count})</span>
      </p>
      {children}
    </section>
  );
}

/** One kind-filtered "recently viewed" list in the empty state (tasks / projects / lists). */
function RecentOpenedSection({
  title,
  icon,
  items,
  onSelect,
  onClear,
}: {
  title: string;
  icon: React.ReactNode;
  items: OpenedItem[];
  onSelect: (item: OpenedItem) => void;
  onClear?: () => void;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="pb-3">
      <div className="flex items-center justify-between px-3 pb-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
          {title}
        </p>
        {onClear && (
          <button
            className="text-2xs text-base-content/60 hover:text-base-content"
            onClick={onClear}
            type="button"
          >
            Clear recently viewed
          </button>
        )}
      </div>
      {items.map((o) => (
        <button
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-base-200"
          key={`${o.kind}-${o.id}`}
          onClick={() => onSelect(o)}
          type="button"
        >
          {icon}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{o.title}</p>
            {o.subtitle && (
              <p className="truncate text-xs text-base-content/60">
                {o.subtitle}
              </p>
            )}
          </div>
        </button>
      ))}
    </section>
  );
}

function MoreFilterAccordionItem({
  value,
  label,
  count,
  children,
}: {
  value: string;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="py-2.5 text-xs font-semibold hover:no-underline">
        <span className="flex items-center gap-1.5">
          {label}
          {count > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs font-bold text-primary-content">
              {count}
            </span>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-2">{children}</AccordionContent>
    </AccordionItem>
  );
}

function FooterHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="inline-flex h-4 items-center rounded border bg-base-200 px-1 font-medium text-base-content/60">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

function recentFilterCount(r: RecentSearch): number {
  const f = r.filters;
  let n = 0;
  if (f.type && f.type !== "all") {
    n++;
  }
  if (f.statusType?.length) {
    n++;
  }
  if (f.priority?.length) {
    n++;
  }
  if (f.assignee?.length) {
    n++;
  }
  if (f.space?.length) {
    n++;
  }
  if (f.sprint?.length) {
    n++;
  }
  if (f.tags?.length) {
    n++;
  }
  if (f.due) {
    n++;
  }
  return n;
}
