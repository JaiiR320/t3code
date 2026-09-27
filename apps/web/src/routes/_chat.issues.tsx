import { createFileRoute } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  IssueDetailResult,
  PullRequestActor,
  RepositoryIssue,
} from "@t3tools/contracts";
import {
  BookMarkedIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  FolderIcon,
  GitBranchPlusIcon,
  GitForkIcon,
  MessageSquareIcon,
  MilestoneIcon,
  TagIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { Badge } from "../components/ui/badge";
import { Button, InlineButton } from "../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { RefreshIcon } from "../components/ui/refresh-icon";
import { SidebarInset } from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import { toastManager } from "../components/ui/toast";
import { PullRequestCommentBody } from "../components/pullRequest/PullRequestCommentBody";
import { PullRequestListGhost } from "../components/pullRequest/PullRequestGhosts";
import {
  PullRequestCommentCard,
  PullRequestCommentIdentity,
  PullRequestMetaRow,
  PullRequestSummarySection,
} from "../components/pullRequest/PullRequestSummaryParts";
import { PULL_REQUEST_STATE_PRESENTATION } from "../components/pullRequest/pullRequestIcons";
import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestListGroupHeader,
  PullRequestRowAuthor,
  PullRequestRowLines,
} from "../components/pullRequest/PullRequestListRow";
import {
  PullRequestFilterMenu,
  PullRequestRefreshControl,
  PullRequestSearchInput,
} from "../components/pullRequest/PullRequestListFilters";
import { PullRequestsUnavailableState } from "../components/pullRequest/PullRequestsUnavailableState";
import {
  PullRequestMarkdown,
  PullRequestMarkdownContext,
} from "../components/pullRequest/PullRequestMarkdown";
import {
  PullRequestActorLabel,
  PullRequestLabelChip,
  PullRequestMetaLine,
} from "../components/pullRequest/pullRequestPresentation";
import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useEscapeToGoBack } from "../hooks/useNavigateBack";
import { cn } from "../lib/utils";
import { useNavigateToMainApp } from "../components/sidebar/mainAppLocation";
import { useProjects, useServerConfigs } from "../state/entities";
import { issueList, issueDetail } from "../state/issues";
import { useEnvironmentQuery } from "../state/query";
import { formatRelativeTimeLabel } from "../timestampFormat";

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export const Route = createFileRoute("/_chat/issues")({
  validateSearch: (search: Record<string, unknown>) => ({
    project: typeof search.project === "string" ? search.project : undefined,
    remote: search.remote === "upstream" ? ("upstream" as const) : ("origin" as const),
    state: search.state === "closed" ? ("closed" as const) : ("open" as const),
    page: Math.min(20, positiveInteger(search.page, 1)),
    issue: positiveInteger(search.issue, 0) || undefined,
    commentsPage: positiveInteger(search.commentsPage, 1),
  }),
  component: IssuesPage,
});

/** Issues wear the pull request palette: open is green, and closed reads as done. */
const ISSUE_STATE_PRESENTATION = {
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

const STATE_OPTIONS = [
  { value: "open", label: "Open", Icon: CircleDotIcon },
  { value: "closed", label: "Closed", Icon: CircleCheckIcon },
] as const;

const REMOTE_OPTIONS = [
  { value: "origin", label: "origin", Icon: GitForkIcon },
  { value: "upstream", label: "upstream", Icon: GitForkIcon },
] as const;

/** Issues only report a login, so the shared actor components fall back to initials. */
function issueActor(login: string): PullRequestActor {
  return { login, name: null, avatarUrl: null };
}

function issueProfileUrl(login: string, issueUrl: string) {
  return login.endsWith("[bot]") ? null : new URL(`/${encodeURIComponent(login)}`, issueUrl).href;
}

/** The composer's starting point for a thread on an issue: a link to it and how to read it. */
function issueThreadPrompt(detail: IssueDetailResult) {
  const { issue } = detail;
  return [
    `Work on #${issue.number}: ${issue.title}`,
    "",
    issue.url,
    "",
    `Read the issue and its comments with \`gh issue view ${issue.number} --repo ${detail.repository} --comments\` before making changes.`,
  ].join("\n");
}

function IssueGlyph({ state, className }: { state: RepositoryIssue["state"]; className?: string }) {
  const { Icon, toneClassName } = ISSUE_STATE_PRESENTATION[state];
  return <Icon aria-hidden className={cn("size-4 shrink-0", toneClassName, className)} />;
}

function IssuesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const backToApp = useNavigateToMainApp();
  const allProjects = useProjects();
  const configs = useServerConfigs();
  const projects = allProjects.filter(
    (project) => configs.get(project.environmentId)?.environment.capabilities.issues === true,
  );
  const projectKey = (project: (typeof projects)[number]) =>
    `${project.environmentId}:${project.id}`;
  const project = search.project
    ? projects.find((item) => projectKey(item) === search.project)
    : projects[0];
  const multipleEnvironments = new Set(projects.map((item) => item.environmentId)).size > 1;
  const [query, setQuery] = useState("");
  const list = useEnvironmentQuery(
    project
      ? issueList({
          environmentId: project.environmentId,
          input: {
            projectId: project.id,
            remote: search.remote,
            state: search.state,
            page: search.page,
          },
        })
      : null,
  );
  const detail = useEnvironmentQuery(
    project && search.issue
      ? issueDetail({
          environmentId: project.environmentId,
          input: {
            projectId: project.id,
            remote: search.remote,
            number: search.issue,
            page: search.commentsPage,
          },
        })
      : null,
  );
  const update = (patch: Partial<typeof search>) =>
    void navigate({ search: { ...search, ...patch } });
  // Any change to what the list is reading starts over with an empty filter.
  const changeScope = (patch: Partial<typeof search>) => {
    setQuery("");
    update({ page: 1, ...patch });
  };
  const closeIssue = () => update({ issue: undefined, commentsPage: 1 });
  const newThread = useNewThreadHandler();
  const [startingThread, setStartingThread] = useState(false);
  // A fresh worktree with no base branch picked, which the branch picker fills with the
  // repository's default branch. The worktree itself is made when the first message is sent.
  const startIssueThread = async (issueDetail: IssueDetailResult) => {
    if (!project || startingThread) return;
    setStartingThread(true);
    const opened = await newThread(scopeProjectRef(project.environmentId, project.id), {
      envMode: "worktree",
      branch: null,
      worktreePath: null,
    }).catch(() => null);
    setStartingThread(false);
    if (opened === null) {
      toastManager.add({ type: "error", title: "Could not open a thread for this issue" });
      return;
    }
    useComposerDraftStore.getState().setPrompt(opened.draftId, issueThreadPrompt(issueDetail));
  };
  useEscapeToGoBack(search.issue ? closeIssue : backToApp);
  const trimmedQuery = query.trim().toLowerCase();
  const entries = (list.data?.issues ?? []).filter((issue) =>
    `${issue.number} ${issue.title} ${issue.labels.map((label) => label.name).join(" ")}`
      .toLowerCase()
      .includes(trimmedQuery),
  );

  const unavailable = !project ? (
    <IssuesState
      title={search.project ? "Project unavailable" : "Issues unavailable"}
      description={
        search.project
          ? "This project is no longer connected. Choose another project."
          : "Connect to an updated T3 Code server with a project to browse GitHub issues."
      }
    />
  ) : null;

  const listBody = unavailable ? (
    unavailable
  ) : list.error && !list.data ? (
    <PullRequestsUnavailableState
      icon={<CircleDotIcon />}
      title="Could not load issues"
      error={list.error}
      refreshing={list.isPending}
      onRetry={() => list.refresh()}
    />
  ) : !list.data ? (
    <PullRequestListGhost rows={7} label="Loading issues" />
  ) : entries.length === 0 ? (
    trimmedQuery ? (
      <IssuesState
        title="No matching issues"
        description="No issues on this page match your filter."
        action={
          <Button size="sm" variant="outline" onClick={() => setQuery("")}>
            Clear filter
          </Button>
        }
      />
    ) : (
      <IssuesState
        title={`No ${search.state} issues`}
        description={
          list.data.nextPage
            ? "Nothing on this page. Continue to the next page."
            : `${list.data.repository} has no ${search.state} issues here.`
        }
      />
    )
  ) : (
    <div className="space-y-0.5">
      <PullRequestListGroupHeader
        Icon={ISSUE_STATE_PRESENTATION[search.state].Icon}
        label={ISSUE_STATE_PRESENTATION[search.state].label}
        count={list.data.totalCount}
      >
        <span className="flex min-w-0 items-center gap-1">
          <BookMarkedIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{list.data.repository}</span>
        </span>
      </PullRequestListGroupHeader>
      {entries.map((issue) => (
        <IssueRow
          key={issue.number}
          issue={issue}
          onSelect={() => update({ issue: issue.number, commentsPage: 1 })}
        />
      ))}
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Issues breadcrumb">
            {search.issue ? (
              <>
                <WorkspaceBreadcrumbItem>
                  <InlineButton tone="muted" onClick={closeIssue}>
                    Issues
                  </InlineButton>
                </WorkspaceBreadcrumbItem>
                <WorkspaceBreadcrumbSeparator />
                <WorkspaceBreadcrumbItem current>
                  <h1 className="truncate tabular-nums">#{search.issue}</h1>
                </WorkspaceBreadcrumbItem>
              </>
            ) : (
              <WorkspaceBreadcrumbItem current>
                <h1 className="truncate">Issues</h1>
              </WorkspaceBreadcrumbItem>
            )}
          </WorkspaceBreadcrumb>
          <Badge variant="secondary" size="sm">
            Prototype
          </Badge>
          <div className="min-w-0 flex-1" />
          {search.issue && project ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh issue"
              disabled={detail.isPending}
              onClick={() => detail.refresh()}
            >
              <RefreshIcon size="md" refreshing={detail.isPending} />
            </Button>
          ) : null}
        </WorkspacePageHeader>
        <div
          key={`${search.project}:${search.remote}:${search.issue}:${search.page}:${search.commentsPage}`}
          className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto"
          data-pull-request-summary-scroll
        >
          {search.issue ? (
            <WorkspacePageContainer width="readable" className="min-h-full gap-5">
              {unavailable ??
                (detail.error && !detail.data ? (
                  <PullRequestsUnavailableState
                    icon={<CircleDotIcon />}
                    title="Could not load this issue"
                    error={detail.error}
                    refreshing={detail.isPending}
                    onRetry={() => detail.refresh()}
                  />
                ) : detail.data && project ? (
                  <IssueDetailView
                    detail={detail.data}
                    cwd={project.workspaceRoot}
                    environmentId={project.environmentId}
                    startingThread={startingThread}
                    onStartThread={(issueDetail) => void startIssueThread(issueDetail)}
                    commentsPagination={
                      <Pagination
                        label="Comments page"
                        page={search.commentsPage}
                        nextPage={detail.data.nextPage}
                        pending={detail.isPending}
                        onPage={(commentsPage) => update({ commentsPage })}
                      />
                    }
                  />
                ) : (
                  <IssueDetailGhost />
                ))}
            </WorkspacePageContainer>
          ) : (
            <WorkspacePageContainer width="expanded" className="min-h-full gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                  <PullRequestSearchInput
                    value={query}
                    label="Filter this page of issues"
                    placeholder="Filter this page by title, number, or label"
                    disabled={!project}
                    onChange={setQuery}
                  />
                </div>
                <PullRequestFilterMenu
                  label="Project"
                  outlined
                  value={project ? projectKey(project) : ""}
                  options={projects.map((item) => ({
                    value: projectKey(item),
                    label: multipleEnvironments
                      ? `${item.title} (${configs.get(item.environmentId)?.environment.label ?? item.environmentId})`
                      : item.title,
                    Icon: FolderIcon,
                    project: item,
                  }))}
                  onChange={(value) => changeScope({ project: value })}
                />
                <PullRequestFilterMenu
                  label="Repository remote"
                  outlined
                  value={search.remote}
                  options={REMOTE_OPTIONS}
                  onChange={(remote) => changeScope({ remote })}
                />
                <PullRequestFilterMenu
                  label="State"
                  outlined
                  value={search.state}
                  options={STATE_OPTIONS}
                  onChange={(state) => changeScope({ state })}
                />
                <PullRequestRefreshControl
                  label="Refresh issues"
                  refreshing={list.isPending}
                  onRefresh={() => list.refresh()}
                />
              </div>

              {listBody}

              {list.data && list.error ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs">
                  <span>{list.error} Showing the last issues loaded.</span>
                  <Button size="xs" variant="outline" onClick={() => list.refresh()}>
                    Retry
                  </Button>
                </div>
              ) : null}
              {list.data && list.data.totalCount > 1000 ? (
                <p className="px-3 text-xs text-muted-foreground">
                  Showing the newest 1,000 matching issues, the GitHub search limit.
                </p>
              ) : null}
              {list.data ? (
                <Pagination
                  label="Page"
                  page={search.page}
                  nextPage={list.data.nextPage}
                  pending={list.isPending}
                  onPage={(page) => {
                    setQuery("");
                    update({ page });
                  }}
                />
              ) : null}
            </WorkspacePageContainer>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

/** One issue in the pull request list's row shape: number and title over author and labels. */
function IssueRow({ issue, onSelect }: { issue: RepositoryIssue; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        PULL_REQUEST_ROW_CLASS,
        "cursor-pointer px-3 py-2.5 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <IssueGlyph state={issue.state} className="mt-0.75 self-start" />
      <PullRequestRowLines
        number={<span className={PULL_REQUEST_ROW_NUMBER_CLASS}>#{issue.number}</span>}
        title={issue.title}
        status={
          issue.commentCount > 0 ? (
            <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
              <MessageSquareIcon aria-hidden className="size-3" />
              {issue.commentCount}
              <span className="sr-only">comments</span>
            </span>
          ) : null
        }
        meta={
          <>
            <PullRequestRowAuthor actor={issueActor(issue.author)} className="min-w-3.5 max-w-40" />
            {issue.labels.length > 0 ? (
              // Every label, wrapping onto more lines rather than hiding behind a count.
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {issue.labels.map((label) => (
                  <PullRequestLabelChip key={label.name} label={label} />
                ))}
              </span>
            ) : null}
          </>
        }
        updatedAt={issue.createdAt}
      />
    </button>
  );
}

function IssuesState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyMedia variant="icon">
        <CircleDotIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

function Pagination({
  label,
  page,
  nextPage,
  pending,
  onPage,
}: {
  label: string;
  page: number;
  nextPage: number | null;
  pending: boolean;
  onPage: (page: number) => void;
}) {
  if (page === 1 && nextPage === null) return null;
  return (
    <div className="flex items-center justify-center gap-3 py-3 text-xs text-muted-foreground">
      <Button
        variant="outline"
        size="sm"
        disabled={pending || page === 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeftIcon aria-hidden />
        Previous
      </Button>
      <span className="tabular-nums">
        {label} {page}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || nextPage === null}
        onClick={() => {
          if (nextPage) onPage(nextPage);
        }}
      >
        Next
        <ChevronRightIcon aria-hidden />
      </Button>
    </div>
  );
}

function IssueDetailGhost() {
  return (
    <div role="status" aria-label="Loading issue" className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <Skeleton shape="card" className="h-40 w-full" />
      <Skeleton shape="card" className="h-24 w-full" />
    </div>
  );
}

function IssueDetailView({
  detail,
  cwd,
  environmentId,
  startingThread,
  onStartThread,
  commentsPagination,
}: {
  detail: IssueDetailResult;
  cwd: string;
  environmentId: EnvironmentId;
  startingThread: boolean;
  onStartThread: (detail: IssueDetailResult) => void;
  commentsPagination: ReactNode;
}) {
  const { issue } = detail;
  const state = ISSUE_STATE_PRESENTATION[issue.state];
  const markdownContext = useMemo(
    () => ({ repositoryUrl: `https://github.com/${detail.repository}`, threadRef: null }),
    [detail.repository],
  );
  return (
    <PullRequestMarkdownContext.Provider value={markdownContext}>
      <section aria-label={`Issue ${issue.number}`} className="flex flex-col gap-5">
        <header className="space-y-2">
          <h2 className="text-lg font-semibold leading-snug wrap-anywhere">
            {issue.title}{" "}
            <span className="font-normal tabular-nums text-muted-foreground">#{issue.number}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            <PullRequestMetaLine className="min-w-0 flex-wrap">
              <span
                className={cn("inline-flex items-center gap-1 font-medium", state.toneClassName)}
              >
                <state.Icon aria-hidden className="size-3.5" />
                {state.label}
              </span>
              <PullRequestActorLabel
                actor={issueActor(issue.author)}
                profileUrl={issueProfileUrl(issue.author, issue.url)}
              />
              <span>opened {formatRelativeTimeLabel(issue.createdAt)}</span>
              <span>
                {issue.commentCount.toLocaleString()}{" "}
                {issue.commentCount === 1 ? "comment" : "comments"}
              </span>
              <span className="truncate">{detail.repository}</span>
            </PullRequestMetaLine>
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              disabled={startingThread}
              onClick={() => onStartThread(detail)}
            >
              <GitBranchPlusIcon aria-hidden />
              {startingThread ? "Opening..." : "Start thread"}
            </Button>
            <Button
              size="xs"
              variant="ghost-muted"
              render={<a href={issue.url} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLinkIcon aria-hidden />
              Open on GitHub
            </Button>
          </div>
        </header>

        <div className="space-y-2 border-y border-border/60 py-3">
          <PullRequestMetaRow icon={<UsersIcon className="size-3.5" />} label="Assignees">
            {detail.assignees.length ? (
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                {detail.assignees.map((login) => (
                  <PullRequestActorLabel
                    key={login}
                    actor={issueActor(login)}
                    profileUrl={issueProfileUrl(login, issue.url)}
                  />
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </PullRequestMetaRow>
          <PullRequestMetaRow icon={<TagIcon className="size-3.5" />} label="Labels">
            {issue.labels.length ? (
              <span className="flex min-w-0 flex-wrap gap-1">
                {issue.labels.map((label) => (
                  <PullRequestLabelChip key={label.name} label={label} />
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </PullRequestMetaRow>
          <PullRequestMetaRow icon={<MilestoneIcon className="size-3.5" />} label="Milestone">
            {detail.milestone ?? <span className="text-muted-foreground">None</span>}
          </PullRequestMetaRow>
        </div>

        {/* The sections bring their own inset, like the pull request panel they share with. */}
        <div className="-mx-4">
          <PullRequestSummarySection title="Description" keepMounted>
            <PullRequestMarkdown
              text={detail.body.trim() ? detail.body : "_No description provided._"}
              cwd={cwd}
              environmentId={environmentId}
            />
          </PullRequestSummarySection>
          <PullRequestSummarySection title={`Comments (${issue.commentCount.toLocaleString()})`}>
            {detail.comments.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No comments yet.</p>
            ) : (
              <div className="space-y-3">
                {detail.comments.map((comment) => (
                  <PullRequestCommentCard
                    key={comment.id}
                    header={
                      <>
                        <PullRequestCommentIdentity
                          actor={issueActor(comment.author)}
                          profileUrl={issueProfileUrl(comment.author, issue.url)}
                          createdAt={comment.createdAt}
                          url={`${issue.url}#issuecomment-${comment.id}`}
                        />
                        {comment.author === issue.author ? (
                          <Badge variant="outline" size="sm">
                            Author
                          </Badge>
                        ) : null}
                      </>
                    }
                  >
                    <div className="px-3 py-3">
                      <PullRequestCommentBody
                        text={comment.body}
                        cwd={cwd}
                        environmentId={environmentId}
                      />
                    </div>
                  </PullRequestCommentCard>
                ))}
              </div>
            )}
            {commentsPagination}
          </PullRequestSummarySection>
        </div>
      </section>
    </PullRequestMarkdownContext.Provider>
  );
}
