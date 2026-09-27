import type { IssueDetailResult, PullRequestActor, RepositoryIssue } from "@t3tools/contracts";
import { CircleCheckIcon, CircleDotIcon, type LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { PULL_REQUEST_STATE_PRESENTATION } from "../pullRequest/pullRequestIcons";

/** Issues wear the pull request palette: open is green, and closed reads as done. */
export const ISSUE_STATE_PRESENTATION = {
  open: {
    label: "Open",
    Icon: CircleDotIcon,
    toneClassName: PULL_REQUEST_STATE_PRESENTATION.open.toneClassName,
  },
  closed: {
    label: "Closed",
    Icon: CircleCheckIcon,
    toneClassName: PULL_REQUEST_STATE_PRESENTATION.merged.toneClassName,
  },
} as const satisfies Record<
  RepositoryIssue["state"],
  { label: string; Icon: LucideIcon; toneClassName: string }
>;

export function IssueGlyph({
  state,
  className,
}: {
  state: RepositoryIssue["state"];
  className?: string;
}) {
  const { Icon, toneClassName } = ISSUE_STATE_PRESENTATION[state];
  return <Icon aria-hidden className={cn("size-4 shrink-0", toneClassName, className)} />;
}

/** Issues only report a login, so the shared actor components fall back to initials. */
export function issueActor(login: string): PullRequestActor {
  return { login, name: null, avatarUrl: null };
}

export function issueProfileUrl(login: string, issueUrl: string) {
  return login.endsWith("[bot]") ? null : new URL(`/${encodeURIComponent(login)}`, issueUrl).href;
}

/** The composer's starting point for a thread on an issue: a link to it and how to read it. */
export function issueThreadPrompt(detail: IssueDetailResult) {
  const { issue } = detail;
  return [
    `Work on #${issue.number}: ${issue.title}`,
    "",
    issue.url,
    "",
    `Read the issue and its comments with \`gh issue view ${issue.number} --repo ${detail.repository} --comments\` before making changes.`,
  ].join("\n");
}
