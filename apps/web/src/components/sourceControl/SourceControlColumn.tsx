import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CircleDotIcon, SearchIcon } from "lucide-react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { PullRequestRefreshControl } from "../pullRequest/PullRequestListFilters";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

export type SourceControlTab = "pull-requests" | "issues";

export const SOURCE_CONTROL_TAB_LABELS: Record<SourceControlTab, string> = {
  "pull-requests": "Pull requests",
  issues: "Issues",
};

const SOURCE_CONTROL_TABS = [
  { value: "issues", Icon: CircleDotIcon },
  { value: "pull-requests", Icon: PullRequestGlyph.pullRequest },
] as const;

/** The page's two lists, as a repository host lays them out: a row of tabs over the content. */
function SourceControlTabs({
  value,
  onChange,
}: {
  value: SourceControlTab;
  onChange: (tab: SourceControlTab) => void;
}) {
  return (
    <nav
      aria-label="Source control"
      className="flex items-end gap-4 border-b border-border/60 px-1"
    >
      {SOURCE_CONTROL_TABS.map(({ value: tab, Icon }) => (
        <button
          key={tab}
          type="button"
          aria-current={tab === value ? "page" : undefined}
          onClick={() => onChange(tab)}
          className={cn(
            "-mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm transition-colors",
            tab === value
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon aria-hidden className="size-4" />
          {SOURCE_CONTROL_TAB_LABELS[tab]}
        </button>
      ))}
    </nav>
  );
}

/**
 * The search, folded to an icon until asked for. Opening moves focus into the input — the
 * whole point of pressing it is to type. It stays open while it holds a query, so an active
 * search is never invisible; empty and blurred, it folds back.
 */
function ExpandableSearch({
  label,
  searchInput,
  searchValue,
  open,
  onOpenChange,
  focusToken,
  onFocusWithin,
}: {
  label: string;
  searchInput: ReactNode;
  searchValue: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bumped to pull focus into the input while it is already showing — the Mod+F path. */
  focusToken: number;
  /**
   * Focus entering and leaving the expanded input. An unmount fires no blur, which is the
   * point: whoever unmounted this can still see the reader was mid-typing and move the
   * focus somewhere that continues the sentence.
   */
  onFocusWithin?: (focused: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    containerRef.current?.querySelector("input")?.focus();
  }, [open]);
  const appliedFocusToken = useRef(focusToken);
  useEffect(() => {
    if (appliedFocusToken.current === focusToken) return;
    appliedFocusToken.current = focusToken;
    const input = containerRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [focusToken]);
  if (open || searchValue.length > 0) {
    return (
      <div
        ref={containerRef}
        className="w-56 min-w-24 shrink"
        onFocus={() => onFocusWithin?.(true)}
        onBlur={() => {
          onFocusWithin?.(false);
          if (searchValue.length === 0) onOpenChange(false);
        }}
      >
        {searchInput}
      </div>
    );
  }
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} onClick={() => onOpenChange(true)}>
      <SearchIcon className="size-4" />
    </Button>
  );
}

/**
 * The source control page's list column. The tabs and full controls live at the top of the
 * scroll flow; once they scroll away, the title transforms into the scope itself — "Pull
 * requests / Open ▾ Authored ▾" — where each segment is the menu for that filter, and a folded
 * search sits on the right. Scrolled back up, the topbar returns to the plain title. The topbar
 * is the window drag region throughout; its interactive children opt out through the
 * `.drag-region` descendant rules.
 */
export function SourceControlColumn({
  tab,
  onTab,
  refreshing,
  onRefresh,
  refreshLabel,
  searchValue,
  searchLabel,
  searchInput,
  condensedFilters,
  controls,
  rightPanelControl,
  titlebarControls,
  rightPanelOpen,
  listBody,
  scrollRef,
}: {
  tab: SourceControlTab;
  onTab: (tab: SourceControlTab) => void;
  refreshing: boolean;
  onRefresh: () => void;
  refreshLabel: string;
  searchValue: string;
  searchLabel: string;
  searchInput: ReactNode;
  /** The tab's filters as compact menus, shown in the topbar once the controls scroll away. */
  condensedFilters: ReactNode;
  /** The tab's filter controls, after the search in the scroll flow. */
  controls: ReactNode;
  rightPanelControl: ReactNode;
  titlebarControls: ReactNode;
  rightPanelOpen: boolean;
  listBody: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const markerRef = useRef<HTMLDivElement | null>(null);
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(entry ? !entry.isIntersecting : false),
      { root: scrollRef.current },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);
  // Typing into the topbar search narrows the list, and a short enough list un-scrolls the
  // page — which dissolves the condensed topbar and unmounts the very input being typed in.
  // The two inputs are one search to the reader, so the focus follows the value into the
  // in-flow bar, caret at the end, and the sentence continues.
  const topbarSearchFocusedRef = useRef(false);
  const inFlowSearchRef = useRef<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchExpanded = searchOpen || searchValue.length > 0;
  // Mod+F belongs to this page's own search: the desktop shell binds no find-in-page, so the
  // shortcut would otherwise do nothing. Condensed, it unfolds the topbar search; at the top,
  // it focuses the in-flow bar and selects the query the way a find field would.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (condensed) {
        setSearchOpen(true);
        setSearchFocusToken((token) => token + 1);
        return;
      }
      const input = inFlowSearchRef.current?.querySelector("input");
      input?.focus();
      input?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [condensed]);
  useEffect(() => {
    if (condensed) return;
    // The fold-out is gone from the chrome; forgetting it open keeps the next condensing
    // from starting with an empty expanded search nobody asked for.
    setSearchOpen(false);
    if (!topbarSearchFocusedRef.current) return;
    topbarSearchFocusedRef.current = false;
    const input = inFlowSearchRef.current?.querySelector("input");
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [condensed]);

  return (
    // Painted flat like the chat column: the inset underneath carries the chrome grain, and a
    // content surface that lets it show reads as a different background than every thread.
    <div className="@container/pr-list flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {/* A closed right panel leaves this column full-width, so the shared header
          reserves native window controls and hosts the controls strip itself: on
          desktop the header is a drag-region, and only a no-drag descendant wins
          clicks from it - a floating sibling loses to app-region hit-testing no
          matter its z-index. While the panel is open, the strip mounts back at
          the route level, whose box spans the panel too, so the toggle keeps one
          fixed top-right anchor. */}
      <WorkspacePageHeader
        electron={isElectron}
        reserveNativeControls={!rightPanelOpen}
        className="relative bg-background"
      >
        {titlebarControls}
        {condensed ? (
          <WorkspaceBreadcrumb ariaLabel="Source control scope" className="overflow-hidden">
            {/* An expanded search owns the scarce horizontal space. The page title stays
                available to readers while the live filters remain available in both states. */}
            <WorkspaceBreadcrumbItem current className={cn(searchExpanded && "sr-only")}>
              <h1 className="truncate">{SOURCE_CONTROL_TAB_LABELS[tab]}</h1>
            </WorkspaceBreadcrumbItem>
            {searchExpanded ? null : <WorkspaceBreadcrumbSeparator />}
            <WorkspaceBreadcrumbItem className="shrink gap-1.5">
              {condensedFilters}
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        ) : (
          <WorkspaceBreadcrumb ariaLabel="Source control breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Source Control</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        )}
        <div className="min-w-0 flex-1" />
        {condensed ? (
          <div className="flex shrink items-center gap-1.5">
            <ExpandableSearch
              label={searchLabel}
              searchInput={searchInput}
              searchValue={searchValue}
              open={searchOpen}
              onOpenChange={setSearchOpen}
              focusToken={searchFocusToken}
              onFocusWithin={(focused) => {
                topbarSearchFocusedRef.current = focused;
              }}
            />
            <PullRequestRefreshControl
              compact
              label={refreshLabel}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          </div>
        ) : null}
        {rightPanelControl}
      </WorkspacePageHeader>

      <div
        ref={scrollRef}
        className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto"
      >
        {/* The top padding is the shared fade band's height, the same pairing the
            settings page makes: at rest the controls sit fully below the mask, and only
            content actually passing under the chrome fades. */}
        <WorkspacePageContainer width="expanded" className="min-h-full gap-4">
          <div className="flex flex-col gap-3">
            <SourceControlTabs value={tab} onChange={onTab} />
            <div ref={inFlowSearchRef} className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 basis-full @lg/pr-list:basis-0 @lg/pr-list:flex-1">
                {searchInput}
              </div>
              {controls}
              {!condensed ? (
                <PullRequestRefreshControl
                  label={refreshLabel}
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                />
              ) : null}
            </div>
            {/* Scrolled past this marker, the controls are gone and the title takes over. */}
            <div ref={markerRef} aria-hidden className="-mt-3 h-px w-full" />
          </div>

          {listBody}
        </WorkspacePageContainer>
      </div>
    </div>
  );
}
