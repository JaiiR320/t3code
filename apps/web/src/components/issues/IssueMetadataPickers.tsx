/**
 * Putting labels and assignees on an issue, and taking them off, from the rows that list them.
 * The same menu the pull request label and reviewer pickers use, and read the same way: the
 * repository's labels and assignable people are asked for only once a menu opens.
 */
import type {
  EnvironmentId,
  IssueActor,
  IssueDetailResult,
  IssueMetadataCandidates,
  IssueScope,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CheckIcon, TagIcon, UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { issueMetadataCandidates, setIssueMetadata } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "../pullRequest/PullRequestCandidatePicker";
import { readableFailure } from "../pullRequest/pullRequestDetail.logic";
import { LabelCandidateRow } from "../pullRequest/PullRequestLabelPicker";
import { PullRequestActorLabel } from "../pullRequest/pullRequestPresentation";
import { issueActor } from "./issuePresentation";

type IssueLabel = IssueDetailResult["issue"]["labels"][number];

/**
 * The issue's labels and assignees, including changes made here until the re-read that follows
 * each one lands. Shared by the chips and both menus, so they agree while that read is out.
 */
export function useIssueMetadata({
  environmentId,
  scope,
  detail,
  detailUpdatedAt,
}: {
  environmentId: EnvironmentId;
  scope: IssueScope;
  detail: IssueDetailResult;
  detailUpdatedAt: number | null;
}) {
  const [local, setLocal] = useState<{
    basis: number | null;
    labels: ReadonlyArray<IssueLabel>;
    assignees: ReadonlyArray<IssueActor>;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const setMetadata = useAtomCommand(setIssueMetadata, { reportFailure: false });

  const current =
    local !== null && local.basis === detailUpdatedAt
      ? local
      : { labels: detail.issue.labels, assignees: detail.assignees };

  const toggleLabel = async (label: IssueLabel, applied: boolean) => {
    if (pending) return;
    setPending(true);
    const result = await setMetadata({
      environmentId,
      input: {
        ...scope,
        number: detail.issue.number,
        field: "labels",
        names: [label.name],
        applied,
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: applied ? `Could not put ${label.name} on` : `Could not take ${label.name} off`,
        description: readableFailure(
          squashAtomCommandFailure(result),
          "GitHub refused it. Check that you have triage access on this repository.",
        ),
      });
      return;
    }
    setLocal({
      basis: detailUpdatedAt,
      labels: applied
        ? [...current.labels, label]
        : current.labels.filter((entry) => entry.name !== label.name),
      assignees: current.assignees,
    });
  };

  const toggleAssignee = async (assignee: IssueActor, applied: boolean) => {
    const { login } = assignee;
    if (pending) return;
    setPending(true);
    const result = await setMetadata({
      environmentId,
      input: { ...scope, number: detail.issue.number, field: "assignees", names: [login], applied },
    });
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: applied ? `Could not assign ${login}` : `Could not unassign ${login}`,
        description: readableFailure(
          squashAtomCommandFailure(result),
          "GitHub refused it. Check that you have triage access on this repository.",
        ),
      });
      return;
    }
    setLocal({
      basis: detailUpdatedAt,
      labels: current.labels,
      assignees: applied
        ? [...current.assignees, assignee]
        : current.assignees.filter((entry) => entry.login !== login),
    });
  };

  return { ...current, pending, toggleLabel, toggleAssignee };
}

type IssueMetadata = ReturnType<typeof useIssueMetadata>;

/** Open state, search and the lazily read candidates, which both menus need alike. */
function useCandidateMenu(environmentId: EnvironmentId, scope: IssueScope) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Mounted with the menu closed, so nothing is asked of GitHub until it opens.
  const candidatesQuery = useEnvironmentQuery(
    open
      ? issueMetadataCandidates({
          environmentId,
          input: { projectId: scope.projectId, remote: scope.remote },
        })
      : null,
  );
  return {
    open,
    setOpen,
    query,
    setQuery,
    data: candidatesQuery.data,
    isPending: candidatesQuery.isPending && candidatesQuery.data === null,
    error: candidatesQuery.data === null ? candidatesQuery.error : null,
  };
}

function matches(query: string, ...fields: ReadonlyArray<string | null>) {
  const needle = query.toLowerCase();
  return needle.length === 0 || fields.some((field) => field?.toLowerCase().includes(needle));
}

export function IssueLabelPicker({
  environmentId,
  scope,
  metadata,
}: {
  environmentId: EnvironmentId;
  scope: IssueScope;
  metadata: IssueMetadata;
}) {
  const menu = useCandidateMenu(environmentId, scope);
  const candidates = useMemo(
    () =>
      (menu.data?.labels ?? []).filter((label) =>
        matches(menu.query, label.name, label.description),
      ),
    [menu.data, menu.query],
  );
  const isApplied = (name: string) => metadata.labels.some((label) => label.name === name);

  return (
    <PullRequestCandidatePicker<IssueMetadataCandidates["labels"][number]>
      icon={<TagIcon className="size-3.5" />}
      label="Change labels"
      allowed
      disabledReason=""
      open={menu.open}
      onOpenChange={menu.setOpen}
      query={menu.query}
      onQueryChange={menu.setQuery}
      searchLabel="Search labels"
      isPending={menu.isPending}
      error={menu.error}
      candidates={candidates}
      emptyLabel="This repository has no labels."
      noMatchLabel="No label matches that."
      errorLabel="The labels could not be read."
      truncated={menu.data?.labelsTruncated === true}
      truncatedLabel="This repository has more labels than are listed here. Apply the rest on GitHub."
      candidateKey={(label) => label.name}
      disabled={metadata.pending}
      onSelect={(label) =>
        void metadata.toggleLabel({ name: label.name, color: label.color }, !isApplied(label.name))
      }
    >
      {(label) => <LabelCandidateRow label={label} applied={isApplied(label.name)} />}
    </PullRequestCandidatePicker>
  );
}

export function IssueAssigneePicker({
  environmentId,
  scope,
  metadata,
}: {
  environmentId: EnvironmentId;
  scope: IssueScope;
  metadata: IssueMetadata;
}) {
  const menu = useCandidateMenu(environmentId, scope);
  const candidates = useMemo(
    () => (menu.data?.assignees ?? []).filter((person) => matches(menu.query, person.login)),
    [menu.data, menu.query],
  );
  const isAssigned = (login: string) =>
    metadata.assignees.some((assignee) => assignee.login === login);

  return (
    <PullRequestCandidatePicker<IssueMetadataCandidates["assignees"][number]>
      icon={<UserPlusIcon className="size-3.5" />}
      label="Change assignees"
      allowed
      disabledReason=""
      open={menu.open}
      onOpenChange={menu.setOpen}
      query={menu.query}
      onQueryChange={menu.setQuery}
      searchLabel="Search people with access"
      isPending={menu.isPending}
      error={menu.error}
      candidates={candidates}
      emptyLabel="Nobody can be assigned in this repository."
      noMatchLabel="Nobody with access matches that."
      errorLabel="The people with access could not be read."
      truncated={menu.data?.assigneesTruncated === true}
      truncatedLabel="This repository has more people with access than are listed here. Assign the rest on GitHub."
      candidateKey={(person) => person.login}
      disabled={metadata.pending}
      onSelect={(person) => void metadata.toggleAssignee(person, !isAssigned(person.login))}
    >
      {(person) => (
        <>
          <PullRequestActorLabel actor={issueActor(person)} className="flex-1" />
          {isAssigned(person.login) ? (
            <CheckIcon aria-label="Assigned" className="size-3.5 shrink-0" />
          ) : null}
        </>
      )}
    </PullRequestCandidatePicker>
  );
}
