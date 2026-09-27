import type { EnvironmentId, IssueListInput, ProjectId, RepositoryIssue } from "@t3tools/contracts";
import { BookMarkedIcon, FolderIcon, GitForkIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { useProjects, useServerConfigs } from "~/state/entities";
import { issueList } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { PullRequestListGhost } from "../pullRequest/PullRequestGhosts";
import {
  PullRequestFilterMenu,
  PullRequestSearchInput,
  type PullRequestFilterOption,
} from "../pullRequest/PullRequestListFilters";
import {
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestListGroupHeader,
  PullRequestRowAuthor,
  PullRequestRowLines,
} from "../pullRequest/PullRequestListRow";
import { sourceControlPageRowClassName } from "../pullRequest/PullRequestRow";
import { PullRequestsUnavailableState } from "../pullRequest/PullRequestsUnavailableState";
import { PullRequestLabelChip } from "../pullRequest/pullRequestPresentation";
import { ISSUE_STATE_PRESENTATION, IssueGlyph, issueActor } from "./issuePresentation";

type IssueState = IssueListInput["state"];
type IssueRemote = IssueListInput["remote"];

const STATE_OPTIONS = [
  { value: "open", label: "Open", Icon: ISSUE_STATE_PRESENTATION.open.Icon },
  { value: "closed", label: "Closed", Icon: ISSUE_STATE_PRESENTATION.closed.Icon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueState>>;

const REMOTE_OPTIONS = [
  { value: "origin", label: "origin", Icon: GitForkIcon },
  { value: "upstream", label: "upstream", Icon: GitForkIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueRemote>>;

/** The server reads at most this many pages, GitHub search's thousand-result ceiling. */
const MAX_PAGES = 20;

export interface IssueSelection {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly remote: IssueRemote;
  readonly number: number;
}

/**
 * The source control page's issues tab, in the slots its list column lays out. Issues are read
 * one project at a time, so the tab follows the page's project scope and falls back to the first
 * project that can list issues.
 */
export function useIssuesTab({
  active,
  projectId,
  environmentId,
  remote,
  state,
  selected,
  onProject,
  onRemote,
  onState,
  onSelect,
}: {
  /** Whether the tab is showing. A hidden tab reads nothing. */
  active: boolean;
  projectId: ProjectId | undefined;
  environmentId: EnvironmentId | undefined;
  remote: IssueRemote;
  state: IssueState;
  selected: IssueSelection | null;
  onProject: (projectId: ProjectId, environmentId: EnvironmentId) => void;
  onRemote: (remote: IssueRemote) => void;
  onState: (state: IssueState) => void;
  onSelect: (issue: IssueSelection) => void;
}) {
  const configs = useServerConfigs();
  const projects = useProjects().filter(
    (project) => configs.get(project.environmentId)?.environment.capabilities.issues === true,
  );
  const project =
    projects.find(
      (item) =>
        item.id === projectId &&
        (environmentId === undefined || item.environmentId === environmentId),
    ) ?? projects[0];
  const multipleEnvironments = new Set(projects.map((item) => item.environmentId)).size > 1;
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState({ scope: "", count: 1 });
  const scopeKey = project ? `${project.environmentId}:${project.id}:${remote}:${state}` : "";
  // Any change to what the list reads starts over at one page.
  const pageCount = pages.scope === scopeKey ? pages.count : 1;
  const first = useEnvironmentQuery(
    active && project
      ? issueList({
          environmentId: project.environmentId,
          input: { projectId: project.id, remote, state, page: 1 },
        })
      : null,
  );
  const projectKey = (item: { environmentId: EnvironmentId; id: ProjectId }) =>
    `${item.environmentId}:${item.id}`;
  const trimmedQuery = query.trim().toLowerCase();
  const selectedNumber =
    selected !== null &&
    project !== undefined &&
    selected.environmentId === project.environmentId &&
    selected.projectId === project.id &&
    selected.remote === remote
      ? selected.number
      : null;

  const searchInput = (
    <PullRequestSearchInput
      value={query}
      label="Filter loaded issues"
      placeholder="Filter by title, number, or label"
      disabled={!project}
      onChange={setQuery}
    />
  );
  const projectMenu = (outlined: boolean) => (
    <PullRequestFilterMenu
      label="Project"
      outlined={outlined}
      value={project ? projectKey(project) : ""}
      options={projects.map((item) => ({
        value: projectKey(item),
        label: multipleEnvironments
          ? `${item.title} (${configs.get(item.environmentId)?.environment.label ?? item.environmentId})`
          : item.title,
        Icon: FolderIcon,
        project: item,
      }))}
      onChange={(value) => {
        const next = projects.find((item) => projectKey(item) === value);
        if (next) onProject(next.id, next.environmentId);
      }}
    />
  );
  const remoteMenu = (outlined: boolean) => (
    <PullRequestFilterMenu
      label="Repository remote"
      outlined={outlined}
      value={remote}
      options={REMOTE_OPTIONS}
      onChange={onRemote}
    />
  );
  const stateMenu = (outlined: boolean) => (
    <PullRequestFilterMenu
      label="Filter by state"
      outlined={outlined}
      value={state}
      options={STATE_OPTIONS}
      onChange={onState}
    />
  );

  const listBody = !project ? (
    <IssuesEmptyState
      title="Issues unavailable"
      description="Connect to an updated T3 Code server with a project to browse GitHub issues."
    />
  ) : first.error && !first.data ? (
    <PullRequestsUnavailableState
      icon={<ISSUE_STATE_PRESENTATION.open.Icon />}
      title="Could not load issues"
      error={first.error}
      refreshing={first.isPending}
      onRetry={() => first.refresh()}
    />
  ) : !first.data ? (
    <PullRequestListGhost rows={7} label="Loading issues" />
  ) : first.data.issues.length === 0 ? (
    <IssuesEmptyState
      title={`No ${state} issues`}
      description={`${first.data.repository} has no ${state} issues.`}
    />
  ) : (
    <div className="space-y-0.5">
      <PullRequestListGroupHeader
        Icon={ISSUE_STATE_PRESENTATION[state].Icon}
        label={ISSUE_STATE_PRESENTATION[state].label}
        count={first.data.totalCount}
      >
        <span className="flex min-w-0 items-center gap-1">
          <BookMarkedIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{first.data.repository}</span>
        </span>
      </PullRequestListGroupHeader>
      <IssueRows
        issues={first.data.issues}
        query={trimmedQuery}
        selectedNumber={selectedNumber}
        onSelect={(issue) =>
          onSelect({
            environmentId: project.environmentId,
            projectId: project.id,
            remote,
            number: issue.number,
          })
        }
      />
      {Array.from({ length: pageCount - 1 }, (_, index) => (
        <IssueListPage
          key={`${scopeKey}:${index + 2}`}
          environmentId={project.environmentId}
          input={{ projectId: project.id, remote, state, page: index + 2 }}
          query={trimmedQuery}
          selectedNumber={selectedNumber}
          last={index + 2 === pageCount}
          onLoadMore={() => setPages({ scope: scopeKey, count: pageCount + 1 })}
          onSelect={(issue) =>
            onSelect({
              environmentId: project.environmentId,
              projectId: project.id,
              remote,
              number: issue.number,
            })
          }
        />
      ))}
      {pageCount === 1 && first.data.nextPage !== null ? (
        <LoadMoreIssues onLoadMore={() => setPages({ scope: scopeKey, count: 2 })} />
      ) : null}
      {first.data.totalCount > 1000 && pageCount >= MAX_PAGES ? (
        <p className="py-3 text-center text-xs text-muted-foreground">
          GitHub search stops at the newest 1,000 matching issues.
        </p>
      ) : null}
    </div>
  );

  return {
    refreshing: first.isPending,
    onRefresh: () => first.refresh(),
    refreshLabel: "Refresh issues",
    searchValue: query,
    searchLabel: "Filter loaded issues",
    searchInput,
    condensedFilters: (
      <>
        {stateMenu(false)}
        {remoteMenu(false)}
      </>
    ),
    controls: (
      <>
        {projectMenu(true)}
        {remoteMenu(true)}
        {stateMenu(true)}
      </>
    ),
    listBody,
  };
}

function IssueListPage({
  environmentId,
  input,
  query,
  selectedNumber,
  last,
  onLoadMore,
  onSelect,
}: {
  environmentId: EnvironmentId;
  input: IssueListInput;
  query: string;
  selectedNumber: number | null;
  last: boolean;
  onLoadMore: () => void;
  onSelect: (issue: RepositoryIssue) => void;
}) {
  const page = useEnvironmentQuery(issueList({ environmentId, input }));
  if (page.error && !page.data) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs">
        <span>{page.error}</span>
        <Button size="xs" variant="outline" onClick={() => page.refresh()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!page.data) return <PullRequestListGhost rows={3} label="Loading more issues" />;
  return (
    <>
      <IssueRows
        issues={page.data.issues}
        query={query}
        selectedNumber={selectedNumber}
        onSelect={onSelect}
      />
      {last && page.data.nextPage !== null && input.page < MAX_PAGES ? (
        <LoadMoreIssues onLoadMore={onLoadMore} />
      ) : null}
    </>
  );
}

function IssueRows({
  issues,
  query,
  selectedNumber,
  onSelect,
}: {
  issues: ReadonlyArray<RepositoryIssue>;
  query: string;
  selectedNumber: number | null;
  onSelect: (issue: RepositoryIssue) => void;
}) {
  return issues
    .filter((issue) =>
      `${issue.number} ${issue.title} ${issue.labels.map((label) => label.name).join(" ")}`
        .toLowerCase()
        .includes(query),
    )
    .map((issue) => (
      <IssueRow
        key={issue.number}
        issue={issue}
        selected={selectedNumber === issue.number}
        onSelect={() => onSelect(issue)}
      />
    ));
}

/** One issue in the pull request list's row shape: number and title over author and labels. */
function IssueRow({
  issue,
  selected,
  onSelect,
}: {
  issue: RepositoryIssue;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={sourceControlPageRowClassName(selected)}
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

function LoadMoreIssues({ onLoadMore }: { onLoadMore: () => void }) {
  return (
    <div className="flex justify-center py-3">
      <Button size="sm" variant="outline" onClick={onLoadMore}>
        Load more issues
      </Button>
    </div>
  );
}

function IssuesEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Empty>
      <EmptyMedia variant="icon">
        <ISSUE_STATE_PRESENTATION.open.Icon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
