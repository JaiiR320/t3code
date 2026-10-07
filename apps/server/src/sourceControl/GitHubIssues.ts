import {
  IssueReadError,
  type IssueScope,
  type IssueListInput,
  type IssueDetailInput,
  type IssueMetadataChangeInput,
} from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ProjectService } from "../project/ProjectService.ts";
import type { VcsProcess } from "../vcs/VcsProcess.ts";
import type { GitHubApi } from "./GitHubApi.ts";

const RawActor = Schema.Struct({ login: Schema.String, avatar_url: Schema.String });
const Actor = Schema.NullOr(RawActor);
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
  assignees: Schema.Array(RawActor),
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
const CANDIDATE_PAGE_SIZE = 100;
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
const decodeLabels = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        color: Schema.String,
        description: Schema.NullOr(Schema.String),
      }),
    ),
  ),
);
const decodeAssignees = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(RawActor)));
const ChangeBody = Schema.Union([
  Schema.Struct({ labels: Schema.Array(Schema.String) }),
  Schema.Struct({ assignees: Schema.Array(Schema.String) }),
]);
const isIssueReadError = Schema.is(IssueReadError);

const actor = (raw: typeof RawActor.Type | null) =>
  raw ? { login: raw.login, avatarUrl: raw.avatar_url } : { login: "ghost", avatarUrl: null };

const summary = (issue: typeof RawIssue.Type) => ({
  number: issue.number,
  title: issue.title,
  url: issue.html_url,
  state: issue.state,
  author: actor(issue.user),
  createdAt: issue.created_at,
  labels: issue.labels,
  commentCount: issue.comments,
});

/** GitHub-only. Resolve each remote on the owning server, including worktrees. */
export function make({
  projects,
  vcs,
  github,
}: {
  projects: Pick<ProjectService["Service"], "getShell">;
  vcs: Pick<VcsProcess["Service"], "run">;
  github: Pick<GitHubApi["Service"], "rest">;
}) {
  const resolve = Effect.fn("GitHubIssues.resolve")(function* (input: IssueScope) {
    const project = yield* projects.getShell(input.projectId);
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
    return { repository: key.slice("github.com/".length) };
  });

  const api = Effect.fn("GitHubIssues.api")(function* (endpoint: string) {
    const response = yield* github.rest({
      host: "github.com",
      operation: "GitHubIssues.read",
      path: endpoint,
      maxResponseBytes: 4_000_000,
    });
    return response.body;
  });
  const write = Effect.fn("GitHubIssues.write")(function* (
    method: "POST" | "DELETE",
    endpoint: string,
    body?: typeof ChangeBody.Type,
  ) {
    yield* github.rest({
      host: "github.com",
      operation: "GitHubIssues.write",
      method,
      path: endpoint,
      ...(body ? { body } : {}),
    });
  });
  const readError = (error: { readonly message: string }) =>
    isIssueReadError(error) ? error : new IssueReadError({ message: error.message });

  const list = Effect.fn("GitHubIssues.list")(function* (input: IssueListInput) {
    const { repository } = yield* resolve(input);
    const raw = yield* api(
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
    const { repository } = yield* resolve(input);
    const endpoint = `repos/${repository}/issues/${input.number}`;
    const raw = yield* api(endpoint);
    const issue = yield* decodeIssue(raw);
    if (issue.pull_request !== undefined) {
      return yield* new IssueReadError({
        message: "This number belongs to a pull request, not an issue.",
      });
    }
    const commentsRaw = yield* api(`${endpoint}/comments?per_page=${PAGE_SIZE}&page=${input.page}`);
    const comments = yield* decodeComments(commentsRaw);
    return {
      repository,
      issue: summary(issue),
      body: issue.body ?? "",
      assignees: issue.assignees.map(actor),
      milestone: issue.milestone?.title ?? null,
      comments: comments.map((comment) => ({
        id: comment.id,
        author: actor(comment.user),
        body: comment.body,
        createdAt: comment.created_at,
      })),
      nextPage: comments.length === PAGE_SIZE ? input.page + 1 : null,
    };
  }, Effect.mapError(readError));

  /** Read when a label or assignee menu opens: both lists in one trip, shared by both menus. */
  const metadataCandidates = Effect.fn("GitHubIssues.metadataCandidates")(function* (
    input: IssueScope,
  ) {
    const { repository } = yield* resolve(input);
    const [labels, assignees] = yield* Effect.all(
      [
        api(`repos/${repository}/labels?per_page=${CANDIDATE_PAGE_SIZE}`).pipe(
          Effect.flatMap(decodeLabels),
        ),
        api(`repos/${repository}/assignees?per_page=${CANDIDATE_PAGE_SIZE}`).pipe(
          Effect.flatMap(decodeAssignees),
        ),
      ],
      { concurrency: 2 },
    );
    return {
      labels,
      assignees: assignees.map(actor),
      labelsTruncated: labels.length === CANDIDATE_PAGE_SIZE,
      assigneesTruncated: assignees.length === CANDIDATE_PAGE_SIZE,
    };
  }, Effect.mapError(readError));

  const setMetadata = Effect.fn("GitHubIssues.setMetadata")(function* (
    input: IssueMetadataChangeInput,
  ) {
    const { repository } = yield* resolve(input);
    const endpoint = `repos/${repository}/issues/${input.number}/${input.field}`;
    if (input.field === "assignees") {
      return yield* write(input.applied ? "POST" : "DELETE", endpoint, {
        assignees: input.names,
      });
    }
    if (input.applied) return yield* write("POST", endpoint, { labels: input.names });
    // The label endpoint takes one name in its path, which may carry a space or a slash.
    yield* Effect.forEach(
      input.names,
      (name) => write("DELETE", `${endpoint}/${encodeURIComponent(name)}`),
      { discard: true },
    );
  }, Effect.mapError(readError));

  return { list, detail, metadataCandidates, setMetadata };
}
