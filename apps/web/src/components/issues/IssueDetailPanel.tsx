import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, IssueDetailResult, IssueScope } from "@t3tools/contracts";
import {
  ExternalLinkIcon,
  GitBranchPlusIcon,
  MessageSquareIcon,
  MilestoneIcon,
  TagIcon,
  UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { issueDetail } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestCommentBody } from "../pullRequest/PullRequestCommentBody";
import {
  PullRequestMarkdown,
  PullRequestMarkdownContext,
} from "../pullRequest/PullRequestMarkdown";
import {
  PullRequestCommentCard,
  PullRequestCommentIdentity,
  PullRequestMetaRow,
  PullRequestSummarySection,
} from "../pullRequest/PullRequestSummaryParts";
import { PullRequestsUnavailableState } from "../pullRequest/PullRequestsUnavailableState";
import {
  PullRequestActorLabel,
  PullRequestLabelChip,
  PullRequestMetaLine,
} from "../pullRequest/pullRequestPresentation";
import { SourceControlDetailChrome } from "../pullRequest/SourceControlDetailChrome";
import {
  ISSUE_STATE_PRESENTATION,
  issueActor,
  issueProfileUrl,
  issueThreadPrompt,
} from "./issuePresentation";

type IssueComment = IssueDetailResult["comments"][number];

/**
 * An issue in the source control page's shared panel, in the frame and sections a pull request
 * uses there. Comments arrive a page at a time, oldest first, and "Load more" reads the next.
 */
export function IssueDetailPanel({
  environmentId,
  scope,
  number,
}: {
  environmentId: EnvironmentId;
  scope: IssueScope;
  number: number;
}) {
  const detailQuery = useEnvironmentQuery(
    issueDetail({ environmentId, input: { ...scope, number, page: 1 } }),
  );
  const detail = detailQuery.data;
  const project = useProjects().find(
    (item) => item.environmentId === environmentId && item.id === scope.projectId,
  );
  const [commentPages, setCommentPages] = useState(1);
  const markdownContext = useMemo(
    () =>
      detail ? { repositoryUrl: `https://github.com/${detail.repository}`, threadRef: null } : null,
    [detail],
  );
  const newThread = useNewThreadHandler();
  const [startingThread, setStartingThread] = useState(false);
  // A fresh worktree with no base branch picked, which the branch picker fills with the
  // repository's default branch. The worktree itself is made when the first message is sent.
  const startThread = async (issueDetailResult: IssueDetailResult) => {
    if (startingThread) return;
    setStartingThread(true);
    const opened = await newThread(scopeProjectRef(environmentId, scope.projectId), {
      envMode: "worktree",
      branch: null,
      worktreePath: null,
    }).catch(() => null);
    setStartingThread(false);
    if (opened === null) {
      toastManager.add({ type: "error", title: "Could not open a thread for this issue" });
      return;
    }
    useComposerDraftStore
      .getState()
      .setPrompt(opened.draftId, issueThreadPrompt(issueDetailResult));
  };

  const cwd = project?.workspaceRoot ?? null;
  const state = detail ? ISSUE_STATE_PRESENTATION[detail.issue.state] : null;
  const openExternal = (url: string) => void readLocalApi()?.shell.openExternal(url);

  return (
    <SourceControlDetailChrome
      ready={detail !== null}
      scrollStateKey="issue"
      closeLabel="Collapse issue panel"
      identity={
        detail && state ? (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => openExternal(`https://github.com/${detail.repository}`)}
                    className="min-w-0 cursor-pointer truncate text-left font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {detail.repository}
                  </button>
                }
              />
              <TooltipPopup side="top">Open {detail.repository} repository</TooltipPopup>
            </Tooltip>
            <IssueNumberLink detail={detail} onOpen={openExternal} />
          </>
        ) : null
      }
      condensedIdentity={
        detail ? (
          <>
            <IssueNumberLink detail={detail} onOpen={openExternal} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {detail.issue.title}
                  </span>
                }
              />
              <TooltipPopup side="top">{detail.issue.title}</TooltipPopup>
            </Tooltip>
          </>
        ) : null
      }
      actions={
        detail ? (
          <Button
            size="xs"
            variant="outline"
            disabled={startingThread}
            onClick={() => void startThread(detail)}
          >
            <GitBranchPlusIcon aria-hidden className="size-3.5" />
            <span className="@max-[30rem]/pr-header:hidden">
              {startingThread ? "Opening..." : "Start thread"}
            </span>
          </Button>
        ) : null
      }
      condensedSummary={
        detail ? (
          <div className="min-w-0 px-4 pb-2 pt-1">
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <PullRequestActorLabel
                actor={issueActor(detail.issue.author)}
                profileUrl={issueProfileUrl(detail.issue.author, detail.issue.url)}
                variant="avatar"
                className="shrink-0"
              />
              <span className="shrink-0">{formatRelativeTimeLabel(detail.issue.createdAt)}</span>
              <IssueCommentCount count={detail.issue.commentCount} className="ml-auto text-2xs" />
            </div>
          </div>
        ) : null
      }
      fold={
        detail && state ? (
          <div className="mt-1 min-w-0 px-4 pb-4">
            <Tooltip>
              <TooltipTrigger
                render={
                  <h1 className="min-h-7 min-w-0 truncate text-base font-semibold leading-snug sm:min-h-6">
                    {detail.issue.title}
                  </h1>
                }
              />
              <TooltipPopup side="top">{detail.issue.title}</TooltipPopup>
            </Tooltip>
            <div className="mt-2 flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <PullRequestMetaLine className="min-w-0 whitespace-nowrap">
                <span
                  className={cn("inline-flex items-center gap-1 font-medium", state.toneClassName)}
                >
                  <state.Icon aria-hidden className="size-3.5" />
                  {state.label}
                </span>
                <PullRequestActorLabel
                  actor={issueActor(detail.issue.author)}
                  profileUrl={issueProfileUrl(detail.issue.author, detail.issue.url)}
                />
                <span>opened {formatRelativeTimeLabel(detail.issue.createdAt)}</span>
              </PullRequestMetaLine>
              <IssueCommentCount count={detail.issue.commentCount} className="ml-auto" />
            </div>
          </div>
        ) : null
      }
    >
      {detailQuery.error && !detail ? (
        <PullRequestsUnavailableState
          title="Could not load this issue"
          error={detailQuery.error}
          refreshing={detailQuery.isPending}
          onRetry={() => detailQuery.refresh()}
        />
      ) : detail && markdownContext ? (
        <PullRequestMarkdownContext value={markdownContext}>
          <div className="h-full overflow-y-auto" data-pull-request-summary-scroll>
            <section className="px-4 pt-2.5 pb-1">
              <div className="space-y-2">
                <PullRequestMetaRow icon={<UsersIcon className="size-3.5" />} label="Assignees">
                  {detail.assignees.length ? (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      {detail.assignees.map((login) => (
                        <PullRequestActorLabel
                          key={login}
                          actor={issueActor(login)}
                          profileUrl={issueProfileUrl(login, detail.issue.url)}
                        />
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </PullRequestMetaRow>
                <PullRequestMetaRow icon={<TagIcon className="size-3.5" />} label="Labels">
                  {detail.issue.labels.length ? (
                    <span className="flex min-w-0 flex-wrap gap-1">
                      {detail.issue.labels.map((label) => (
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
            </section>

            <PullRequestSummarySection
              key={`description:${detail.issue.url}`}
              title="Description"
              keepMounted
            >
              {cwd === null ? null : (
                <PullRequestMarkdown
                  text={detail.body.trim() ? detail.body : "_No description provided._"}
                  cwd={cwd}
                  environmentId={environmentId}
                />
              )}
            </PullRequestSummarySection>

            <PullRequestSummarySection
              key={`comments:${detail.issue.url}`}
              title={`Comments (${detail.issue.commentCount.toLocaleString()})`}
            >
              {detail.comments.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">No comments yet.</p>
              ) : (
                <div className="space-y-3">
                  <IssueComments
                    detail={detail}
                    comments={detail.comments}
                    cwd={cwd}
                    environmentId={environmentId}
                  />
                  {Array.from({ length: commentPages - 1 }, (_, index) => (
                    <IssueCommentPage
                      key={index + 2}
                      environmentId={environmentId}
                      scope={scope}
                      number={number}
                      page={index + 2}
                      detail={detail}
                      cwd={cwd}
                      last={index + 2 === commentPages}
                      onLoadMore={() => setCommentPages((count) => count + 1)}
                    />
                  ))}
                  {commentPages === 1 && detail.nextPage !== null ? (
                    <LoadMoreComments onLoadMore={() => setCommentPages(2)} />
                  ) : null}
                </div>
              )}
            </PullRequestSummarySection>
          </div>
        </PullRequestMarkdownContext>
      ) : (
        <IssueDetailGhost />
      )}
    </SourceControlDetailChrome>
  );
}

function IssueNumberLink({
  detail,
  onOpen,
}: {
  detail: IssueDetailResult;
  onOpen: (url: string) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => onOpen(detail.issue.url)}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center gap-0.5 font-medium underline-offset-2 hover:underline",
              ISSUE_STATE_PRESENTATION[detail.issue.state].toneClassName,
            )}
            aria-label={`Open issue #${detail.issue.number} on GitHub`}
          >
            #{detail.issue.number}
            <ExternalLinkIcon aria-hidden className="size-2.5" />
          </button>
        }
      />
      <TooltipPopup side="top">Open on GitHub</TooltipPopup>
    </Tooltip>
  );
}

function IssueCommentCount({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 tabular-nums", className)}
      aria-label={`${count.toLocaleString()} ${count === 1 ? "comment" : "comments"}`}
    >
      <MessageSquareIcon aria-hidden className="size-3" />
      {count.toLocaleString()}
    </span>
  );
}

function IssueComments({
  detail,
  comments,
  cwd,
  environmentId,
}: {
  detail: IssueDetailResult;
  comments: ReadonlyArray<IssueComment>;
  cwd: string | null;
  environmentId: EnvironmentId;
}) {
  return comments.map((comment) => (
    <PullRequestCommentCard
      key={comment.id}
      header={
        <>
          <PullRequestCommentIdentity
            actor={issueActor(comment.author)}
            profileUrl={issueProfileUrl(comment.author, detail.issue.url)}
            createdAt={comment.createdAt}
            url={`${detail.issue.url}#issuecomment-${comment.id}`}
          />
          {comment.author === detail.issue.author ? (
            <Badge variant="outline" size="sm">
              Author
            </Badge>
          ) : null}
        </>
      }
    >
      {cwd === null ? null : (
        <div className="px-3 py-3">
          <PullRequestCommentBody text={comment.body} cwd={cwd} environmentId={environmentId} />
        </div>
      )}
    </PullRequestCommentCard>
  ));
}

/** A later page of comments, read when "Load more" asks for it. */
function IssueCommentPage({
  environmentId,
  scope,
  number,
  page,
  detail,
  cwd,
  last,
  onLoadMore,
}: {
  environmentId: EnvironmentId;
  scope: IssueScope;
  number: number;
  page: number;
  detail: IssueDetailResult;
  cwd: string | null;
  last: boolean;
  onLoadMore: () => void;
}) {
  const query = useEnvironmentQuery(
    issueDetail({ environmentId, input: { ...scope, number, page } }),
  );
  if (query.error && !query.data) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs">
        <span>{query.error}</span>
        <Button size="xs" variant="outline" onClick={() => query.refresh()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!query.data) return <Skeleton shape="card" className="h-24 w-full" />;
  return (
    <>
      <IssueComments
        detail={detail}
        comments={query.data.comments}
        cwd={cwd}
        environmentId={environmentId}
      />
      {last && query.data.nextPage !== null ? <LoadMoreComments onLoadMore={onLoadMore} /> : null}
    </>
  );
}

function LoadMoreComments({ onLoadMore }: { onLoadMore: () => void }) {
  return (
    <Button size="sm" variant="ghost" className="w-full" onClick={onLoadMore}>
      Load more comments
    </Button>
  );
}

function IssueDetailGhost() {
  return (
    <div role="status" aria-label="Loading issue" className="space-y-5 p-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <Skeleton shape="card" className="h-40 w-full" />
      <Skeleton shape="card" className="h-24 w-full" />
    </div>
  );
}
