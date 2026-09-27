import { assert, it } from "@effect/vitest";
import { type ProjectId, type OrchestrationProjectShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";
import { make } from "./GitHubIssues.ts";
import { GitHubCliAuthenticationError } from "./GitHubCli.ts";

const project: OrchestrationProjectShell = {
  id: "project-1" as ProjectId,
  title: "Project",
  workspaceRoot: "/repo",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};
const scope = { projectId: project.id, remote: "upstream" as const };
const output = (stdout: string) => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});
const rawIssue = {
  number: 42,
  title: "Example issue",
  html_url: "https://github.com/team/repo/issues/42",
  state: "open",
  user: { login: "jair", avatar_url: "https://avatars/jair" },
  created_at: "2026-09-01T00:00:00Z",
  labels: [{ name: "bug", color: "ff0000" }],
  comments: 1,
  body: "Issue description",
  assignees: [{ login: "jair", avatar_url: "https://avatars/jair" }],
  milestone: { title: "Next" },
};

it.effect("reads the selected remote on the owning server and excludes pull requests", () =>
  Effect.gen(function* () {
    const reads: string[] = [];
    const service = make({
      projects: { getProjectShellById: () => Effect.succeedSome(project) },
      vcs: {
        run: (input) => {
          assert.deepStrictEqual(input.args, ["remote", "get-url", "upstream"]);
          assert.strictEqual(input.cwd, "/repo");
          return Effect.succeed(output("git@github.com:Team/Repo.git\n"));
        },
      },
      gh: {
        execute: (input) => {
          reads.push(input.args.join(" "));
          return Effect.succeed(
            output(
              JSON.stringify({
                total_count: 52,
                incomplete_results: false,
                items: [rawIssue, { ...rawIssue, number: 43, pull_request: { url: "pr" } }],
              }),
            ),
          );
        },
      },
    });
    const result = yield* service.list({ ...scope, state: "open", page: 2 });
    assert.strictEqual(result.repository, "team/repo");
    assert.deepStrictEqual(
      result.issues.map((issue) => issue.number),
      [42],
    );
    assert.strictEqual(result.nextPage, null);
    assert.match(
      reads[0]!,
      /api --hostname github.com search\/issues\?q=repo%3Ateam%2Frepo%20is%3Aissue%20is%3Aopen.*page=2$/,
    );
  }),
);

it.effect("paginates search results and stops at GitHub's 1,000-result limit", () =>
  Effect.gen(function* () {
    const service = make({
      projects: { getProjectShellById: () => Effect.succeedSome(project) },
      vcs: { run: () => Effect.succeed(output("https://github.com/team/repo.git")) },
      gh: {
        execute: () =>
          Effect.succeed(
            output(
              JSON.stringify({ total_count: 1100, incomplete_results: false, items: [rawIssue] }),
            ),
          ),
      },
    });
    const first = yield* service.list({ ...scope, state: "closed", page: 1 });
    assert.strictEqual(first.totalCount, 1100);
    assert.strictEqual(first.nextPage, 2);
    const last = yield* service.list({ ...scope, state: "closed", page: 20 });
    assert.strictEqual(last.nextPage, null);
  }),
);

it.effect("loads issue Markdown, metadata and paginated comments, including deleted authors", () =>
  Effect.gen(function* () {
    const service = make({
      projects: { getProjectShellById: () => Effect.succeedSome(project) },
      vcs: { run: () => Effect.succeed(output("https://github.com/team/repo")) },
      gh: {
        execute: (input) =>
          Effect.succeed(
            output(
              JSON.stringify(
                input.args.at(-1)?.includes("/comments?")
                  ? [{ id: 9, user: null, body: "A reply", created_at: rawIssue.created_at }]
                  : rawIssue,
              ),
            ),
          ),
      },
    });
    const result = yield* service.detail({ ...scope, number: 42, page: 1 });
    assert.strictEqual(result.body, "Issue description");
    assert.deepStrictEqual(result.issue.author, {
      login: "jair",
      avatarUrl: "https://avatars/jair",
    });
    assert.deepStrictEqual(result.assignees, [
      { login: "jair", avatarUrl: "https://avatars/jair" },
    ]);
    assert.strictEqual(result.milestone, "Next");
    assert.deepStrictEqual(result.comments[0]?.author, { login: "ghost", avatarUrl: null });
    assert.strictEqual(result.comments[0]?.body, "A reply");
    assert.strictEqual(result.nextPage, null);
  }),
);

it.effect("does not call GitHub for a missing project or unsupported remote", () =>
  Effect.gen(function* () {
    for (const exists of [true, false]) {
      const service = make({
        projects: {
          getProjectShellById: () => Effect.succeed(exists ? Option.some(project) : Option.none()),
        },
        vcs: { run: () => Effect.succeed(output("https://gitlab.com/team/repo")) },
        gh: { execute: () => Effect.die("GitHub must not be called") },
      });
      const error = yield* service.list({ ...scope, state: "open", page: 1 }).pipe(Effect.flip);
      assert.strictEqual(error._tag, "IssueReadError");
      assert.match(error.message, exists ? /github.com/ : /no longer available/);
    }
  }),
);

it.effect("returns an actionable authentication error", () =>
  Effect.gen(function* () {
    const service = make({
      projects: { getProjectShellById: () => Effect.succeedSome(project) },
      vcs: { run: () => Effect.succeed(output("https://github.com/team/repo")) },
      gh: {
        execute: () =>
          Effect.fail(
            new GitHubCliAuthenticationError({
              command: "gh",
              cwd: "/repo",
              cause: "not logged in",
            }),
          ),
      },
    });
    const error = yield* service.list({ ...scope, state: "open", page: 1 }).pipe(Effect.flip);
    assert.match(error.message, /gh auth login/);
  }),
);

it.effect("rejects a pull request opened through the issue detail route", () =>
  Effect.gen(function* () {
    const service = make({
      projects: { getProjectShellById: () => Effect.succeedSome(project) },
      vcs: { run: () => Effect.succeed(output("https://github.com/team/repo")) },
      gh: {
        execute: () => Effect.succeed(output(JSON.stringify({ ...rawIssue, pull_request: {} }))),
      },
    });
    const error = yield* service.detail({ ...scope, number: 42, page: 1 }).pipe(Effect.flip);
    assert.match(error.message, /pull request/);
  }),
);

it.effect("reads label and assignee candidates and says when either list is cut short", () =>
  Effect.gen(function* () {
    const service = make({
      projects: { getProjectShellById: () => Effect.succeedSome(project) },
      vcs: { run: () => Effect.succeed(output("https://github.com/team/repo")) },
      gh: {
        execute: (input) =>
          Effect.succeed(
            output(
              JSON.stringify(
                input.args.at(-1)?.startsWith("repos/team/repo/labels?")
                  ? [{ name: "bug", color: "ff0000", description: null }]
                  : Array.from({ length: 100 }, (_, index) => ({
                      login: `user${index}`,
                      avatar_url: `https://avatars/${index}`,
                    })),
              ),
            ),
          ),
      },
    });
    const result = yield* service.metadataCandidates(scope);
    assert.deepStrictEqual(result.labels, [{ name: "bug", color: "ff0000", description: null }]);
    assert.deepStrictEqual(result.assignees[0], { login: "user0", avatarUrl: "https://avatars/0" });
    assert.strictEqual(result.labelsTruncated, false);
    assert.strictEqual(result.assigneesTruncated, true);
  }),
);

it.effect("changes labels and assignees with bodies on stdin", () =>
  Effect.gen(function* () {
    const calls: Array<{ args: string; stdin: string | undefined }> = [];
    const service = make({
      projects: { getProjectShellById: () => Effect.succeedSome(project) },
      vcs: { run: () => Effect.succeed(output("https://github.com/team/repo")) },
      gh: {
        execute: (input) => {
          calls.push({ args: input.args.join(" "), stdin: input.stdin });
          return Effect.succeed(output("{}"));
        },
      },
    });
    const change = { ...scope, number: 42 };
    yield* service.setMetadata({ ...change, field: "labels", names: ["bug"], applied: true });
    yield* service.setMetadata({
      ...change,
      field: "labels",
      names: ["needs triage", "a/b"],
      applied: false,
    });
    yield* service.setMetadata({ ...change, field: "assignees", names: ["jair"], applied: false });
    const issue = "--hostname github.com repos/team/repo/issues/42";
    assert.deepStrictEqual(calls, [
      {
        args: `api --method POST ${issue}/labels --input -`,
        stdin: '{"labels":["bug"]}',
      },
      { args: `api --method DELETE ${issue}/labels/needs%20triage`, stdin: undefined },
      { args: `api --method DELETE ${issue}/labels/a%2Fb`, stdin: undefined },
      {
        args: `api --method DELETE ${issue}/assignees --input -`,
        stdin: '{"assignees":["jair"]}',
      },
    ]);
  }),
);
