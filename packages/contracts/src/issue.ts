import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

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
/** A GitHub account on an issue. A deleted one reads as `ghost`, with no avatar. */
export const IssueActor = Schema.Struct({
  login: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
});
export type IssueActor = typeof IssueActor.Type;
export const RepositoryIssue = Schema.Struct({
  number: PositiveInt,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  author: IssueActor,
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
  assignees: Schema.Array(IssueActor),
  milestone: Schema.NullOr(Schema.String),
  comments: Schema.Array(
    Schema.Struct({
      id: PositiveInt,
      author: IssueActor,
      body: Schema.String,
      createdAt: Schema.String,
    }),
  ),
  nextPage: Schema.NullOr(PositiveInt),
});
export type IssueDetailResult = typeof IssueDetailResult.Type;

/** Everything a repository offers to put on an issue, read when a label or assignee menu opens. */
export const IssueMetadataCandidates = Schema.Struct({
  labels: Schema.Array(
    Schema.Struct({ ...IssueLabel.fields, description: Schema.NullOr(Schema.String) }),
  ),
  assignees: Schema.Array(IssueActor),
  /** The repository has more than one read returns, so the menu is not all of them. */
  labelsTruncated: Schema.Boolean,
  assigneesTruncated: Schema.Boolean,
});
export type IssueMetadataCandidates = typeof IssueMetadataCandidates.Type;

/** Puts labels or assignees on an issue, or takes them off, leaving the rest as they were. */
export const IssueMetadataChangeInput = Schema.Struct({
  ...IssueScope.fields,
  number: PositiveInt,
  field: Schema.Literals(["labels", "assignees"]),
  names: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(25)),
  applied: Schema.Boolean,
});
export type IssueMetadataChangeInput = typeof IssueMetadataChangeInput.Type;

export class IssueReadError extends Schema.TaggedError<IssueReadError>()("IssueReadError", {
  message: Schema.String,
}) {}
