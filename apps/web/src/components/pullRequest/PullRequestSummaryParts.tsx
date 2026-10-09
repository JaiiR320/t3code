import type { PullRequestActor } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestActorLabel } from "./pullRequestPresentation";
import { sectionCollapseAnchorScrollTop } from "./pullRequestSummaryScroll.logic";

/** One labelled line of the summary's metadata block: reviewers, labels, assignees. */
export function PullRequestMetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-7 min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs sm:min-h-6">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}

/** Who wrote a comment and when, the time linking to the comment on its host when it has one. */
export function PullRequestCommentIdentity({
  actor,
  profileUrl,
  createdAt,
  url,
}: {
  actor: PullRequestActor | null;
  profileUrl: string | null;
  createdAt: string;
  url: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <PullRequestActorLabel actor={actor} profileUrl={profileUrl} className="max-w-full" />
      <Tooltip>
        <TooltipTrigger
          render={
            url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground hover:underline"
              />
            ) : (
              <span className="text-muted-foreground" />
            )
          }
        >
          <time dateTime={createdAt}>{formatRelativeTimeLabel(createdAt)}</time>
        </TooltipTrigger>
        <TooltipPopup>
          {new Date(createdAt).toLocaleString()}
          {url ? " · Open comment on host" : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

/**
 * A conversation card: a tinted strip for who said it and what can be done about it, then the
 * words. Offscreen cards skip style, layout and paint; long threads carry pages of highlighted
 * code, and the conversation sits below the description either way. Remember measured heights
 * so skipping a card above the viewport does not shrink the scroll range at the bottom.
 */
export function PullRequestCommentCard({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="group rounded-lg border border-border/60 bg-background [contain-intrinsic-block-size:auto_160px] [content-visibility:auto]">
      <div className="flex flex-wrap items-start gap-2 rounded-t-lg bg-muted/25 px-3 py-2.5">
        {header}
      </div>
      {children}
    </article>
  );
}

/**
 * A collapsible block of a pull request or issue summary under a sticky heading. The scroll
 * box around it carries `data-pull-request-summary-scroll` so collapsing from a pinned heading
 * keeps that heading where the reader pressed it.
 */
export function PullRequestSummarySection({
  title,
  defaultOpen = true,
  keepMounted = false,
  actions,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  keepMounted?: boolean;
  /** Heading controls stay separate from the collapse trigger so they remain independently usable. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headingRef = useRef<HTMLDivElement>(null);
  const setOpenWithScrollAnchor = (nextOpen: boolean) => {
    if (!nextOpen) {
      const heading = headingRef.current;
      const section = heading?.closest<HTMLElement>("[data-pull-request-summary-section]");
      const scroller = heading?.closest<HTMLElement>("[data-pull-request-summary-scroll]");
      if (heading && section && scroller) {
        const target = sectionCollapseAnchorScrollTop({
          scrollTop: scroller.scrollTop,
          viewportTop: scroller.getBoundingClientRect().top,
          sectionTop: section.getBoundingClientRect().top,
          headingTop: heading.getBoundingClientRect().top,
        });
        // Synchronous with the press: React commits the collapsed height before the browser
        // paints, so the reader sees the heading they pressed stay put rather than a jump first.
        if (target !== null) scroller.scrollTop = target;
      }
    }
    setOpen(nextOpen);
  };
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpenWithScrollAnchor}
      render={<section aria-label={title} />}
      data-pull-request-summary-section
    >
      {/* The heading rides the top of the scroll box the way a diff's file header does, so a
          section can be collapsed from wherever its body has been read to rather than only from
          where it started. Opaque, because the rows it covers scroll beneath it. */}
      <div
        ref={headingRef}
        className="sticky top-0 z-10 flex w-full items-center bg-background pr-4"
      >
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
          <span>{title}</span>
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground/60 transition-transform",
              open && "rotate-90",
            )}
          />
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsiblePanel keepMounted={keepMounted}>
        <div className="px-4 pb-4">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
