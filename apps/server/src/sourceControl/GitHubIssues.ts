import {
  IssueReadError,
  type IssueScope,
  type IssueListInput,
  type IssueDetailInput,
} from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { VcsProcess } from "../vcs/VcsProcess.ts";
import type { GitHubCli } from "./GitHubCli.ts";

const Actor = Schema.NullOr(Schema.Struct({ login: Schema.String }));
const RawIssue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  html_url: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  user: Actor,
  created_at: Schema.String,
  labels: Schema.Array(Schema.Struct({ name: Schema.String, color: Schema.String })),
  comments: Schema.Int,
  body: Schema.NullOr(Schema.String),
  assignees: Schema.Array(Schema.Struct({ login: Schema.String })),
  milestone: Schema.NullOr(Schema.Struct({ title: Schema.String })),
  pull_request: Schema.optionalKey(Schema.Unknown),
});
const RawComment = Schema.Struct({
  id: Schema.Int,
  user: Actor,
  body: Schema.String,
  created_at: Schema.String,
});
const PAGE_SIZE = 50;
const decodeIssue = Schema.decodeEffect(Schema.fromJsonString(RawIssue));
const decodeComments = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(RawComment)));
const decodeSearch = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      total_count: Schema.Int,
      incomplete_results: Schema.Boolean,
      items: Schema.Array(RawIssue),
    }),
  ),
);
const isIssueReadError = Schema.is(IssueReadError);

const summary = (issue: typeof RawIssue.Type) => ({
  number: issue.number,
  title: issue.title,
  url: issue.html_url,
  state: issue.state,
  author: issue.user?.login ?? "ghost",
  createdAt: issue.created_at,
  labels: issue.labels,
  commentCount: issue.comments,
});

/** Read-only GitHub prototype. Resolve each remote on the owning server, including worktrees. */
export function make({
  projects,
  vcs,
  gh,
}: {
  projects: Pick<ProjectionSnapshotQuery["Service"], "getProjectShellById">;
  vcs: Pick<VcsProcess["Service"], "run">;
  gh: Pick<GitHubCli["Service"], "execute">;
}) {
  const resolve = Effect.fn("GitHubIssues.resolve")(function* (input: IssueScope) {
    const project = yield* projects.getProjectShellById(input.projectId);
    if (Option.isNone(project)) {
      return yield* new IssueReadError({ message: "This project is no longer available." });
    }
    const cwd = project.value.workspaceRoot;
    const remote = yield* vcs
      .run({
        operation: "GitHubIssues.remote",
        command: "git",
        args: ["remote", "get-url", input.remote],
        cwd,
      })
      .pipe(
        Effect.mapError(
          () =>
            new IssueReadError({
              message: `Cannot read the ${input.remote} remote. Choose another remote or a Git project.`,
            }),
        ),
      );
    const key = normalizeGitRemoteUrl(remote.stdout);
    if (!/^github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(key)) {
      return yield* new IssueReadError({
        message: "This prototype supports repositories on github.com.",
      });
    }
    return { cwd, repository: key.slice("github.com/".length) };
  });

  const api = Effect.fn("GitHubIssues.api")(function* (cwd: string, endpoint: string) {
    const output = yield* gh.execute({
      cwd,
      args: ["api", "--hostname", "github.com", endpoint],
      rateLimitHost: "github.com",
      maxOutputBytes: 4_000_000,
    });
    return output.stdout;
  });
  const readError = (error: { readonly message: string }) =>
    isIssueReadError(error) ? error : new IssueReadError({ message: error.message });

  const list = Effect.fn("GitHubIssues.list")(function* (input: IssueListInput) {
    const { cwd, repository } = yield* resolve(input);
    const raw = yield* api(
      cwd,
      `search/issues?q=${encodeURIComponent(`repo:${repository} is:issue is:${input.state}`)}&sort=created&order=desc&per_page=${PAGE_SIZE}&page=${input.page}`,
    );
    const result = yield* decodeSearch(raw);
    if (result.incomplete_results) {
      return yield* new IssueReadError({
        message: "GitHub returned an incomplete issue search. Please retry.",
      });
    }
    return {
      repository,
      issues: result.items.filter((row) => row.pull_request === undefined).map(summary),
      totalCount: result.total_count,
      // GitHub search only exposes its first 1,000 matches.
      nextPage: input.page * PAGE_SIZE < Math.min(result.total_count, 1000) ? input.page + 1 : null,
    };
  }, Effect.mapError(readError));

  const detail = Effect.fn("GitHubIssues.detail")(function* (input: IssueDetailInput) {
    const { cwd, repository } = yield* resolve(input);
    const endpoint = `repos/${repository}/issues/${input.number}`;
    const raw = yield* api(cwd, endpoint);
    const issue = yield* decodeIssue(raw);
    if (issue.pull_request !== undefined) {
      return yield* new IssueReadError({
        message: "This number belongs to a pull request, not an issue.",
      });
    }
    const commentsRaw = yield* api(
      cwd,
      `${endpoint}/comments?per_page=${PAGE_SIZE}&page=${input.page}`,
    );
    const comments = yield* decodeComments(commentsRaw);
    return {
      repository,
      issue: summary(issue),
      body: issue.body ?? "",
      assignees: issue.assignees.map((actor) => actor.login),
      milestone: issue.milestone?.title ?? null,
      comments: comments.map((comment) => ({
        id: comment.id,
        author: comment.user?.login ?? "ghost",
        body: comment.body,
        createdAt: comment.created_at,
      })),
      nextPage: comments.length === PAGE_SIZE ? input.page + 1 : null,
    };
  }, Effect.mapError(readError));

  return { list, detail };
}
