import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, ProjectId } from "./baseSchemas.ts";

export const IssueScope = Schema.Struct({
  projectId: ProjectId,
  remote: Schema.Literals(["origin", "upstream"]),
});
export type IssueScope = typeof IssueScope.Type;

export const IssueListInput = Schema.Struct({
  ...IssueScope.fields,
  state: Schema.Literals(["open", "closed"]),
  page: PositiveInt.check(Schema.isLessThanOrEqualTo(20)),
});
export type IssueListInput = typeof IssueListInput.Type;

export const IssueDetailInput = Schema.Struct({
  ...IssueScope.fields,
  number: PositiveInt,
  page: PositiveInt,
});
export type IssueDetailInput = typeof IssueDetailInput.Type;

export const IssueLabel = Schema.Struct({ name: Schema.String, color: Schema.String });
export const RepositoryIssue = Schema.Struct({
  number: PositiveInt,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  author: Schema.String,
  createdAt: Schema.String,
  labels: Schema.Array(IssueLabel),
  commentCount: NonNegativeInt,
});
export type RepositoryIssue = typeof RepositoryIssue.Type;

export const IssueListResult = Schema.Struct({
  repository: Schema.String,
  issues: Schema.Array(RepositoryIssue),
  totalCount: NonNegativeInt,
  nextPage: Schema.NullOr(PositiveInt),
});

export const IssueDetailResult = Schema.Struct({
  repository: Schema.String,
  issue: RepositoryIssue,
  body: Schema.String,
  assignees: Schema.Array(Schema.String),
  milestone: Schema.NullOr(Schema.String),
  comments: Schema.Array(
    Schema.Struct({
      id: PositiveInt,
      author: Schema.String,
      body: Schema.String,
      createdAt: Schema.String,
    }),
  ),
  nextPage: Schema.NullOr(PositiveInt),
});
export type IssueDetailResult = typeof IssueDetailResult.Type;

export class IssueReadError extends Schema.TaggedError<IssueReadError>()("IssueReadError", {
  message: Schema.String,
}) {}
