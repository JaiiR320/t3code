import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type IssueScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { connectionAtomRuntime } from "../connection/runtime";

export const issueList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:issues:list",
  tag: WS_METHODS.issuesList,
  staleTimeMs: 60_000,
});

export const issueDetail = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:issues:detail",
  tag: WS_METHODS.issuesDetail,
  staleTimeMs: 60_000,
});

/** Atoms are keyed by their input's JSON, so every reader builds it in this one order. */
export function issueDetailInput(scope: IssueScope, number: number, page: number) {
  return { projectId: scope.projectId, remote: scope.remote, number, page };
}

/** Read when a label or assignee menu opens, and kept for a minute across issues. */
export const issueMetadataCandidates = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:issues:metadata-candidates",
  tag: WS_METHODS.issuesMetadataCandidates,
  staleTimeMs: 60_000,
});

/** Re-reads the issue afterwards: GitHub may drop an assignee it cannot assign without saying so. */
export const setIssueMetadata = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:issues:set-metadata",
  tag: WS_METHODS.issuesSetMetadata,
  onSettled: ({ environmentId, input }, registry) =>
    Effect.sync(() =>
      registry.refresh(
        issueDetail({ environmentId, input: issueDetailInput(input, input.number, 1) }),
      ),
    ),
});
