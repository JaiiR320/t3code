---
name: update-t3-code
description: Update Jair's T3 Code fork from upstream, preserve personal changes, build and install it on his devices (MacBook, Omarchy PC, Android phone), then push personal after Jair verifies the update. Use for requests like "update T3 Code", "sync upstream and update my app", or "build the Android app for my phone". A request only to compare branches does not authorize this workflow.
---

# Update T3 Code

Use the checkout containing this skill. Run commands from its root and read its current [AGENTS.md](../../../AGENTS.md), especially the personal fork, verification, and installation instructions. This skill authorizes preparing and installing the update; publishing waits for Jair's verification.

This file covers the generic flow: merge, check, install, verify, push. Device-specific install steps live beside it. Read the one for the machine you are running on, plus any device Jair asks for:

- [MacBook](macbook.md): desktop app in `~/Applications` and the launchd service.
- [Omarchy PC](omarchy.md): AppImage launcher and the systemd service.
- [Android phone](android.md): a local release APK sent over LocalSend, updating the installed app in place.

Identify the machine with `uname -s` (`Darwin` is the MacBook, `Linux` is Omarchy). Only build the Android app when Jair asks for it or the update changes mobile or shared client code he wants on his phone.

## Prepare and merge

- Inspect the working tree, branches, worktrees, and remotes. Preserve unrelated uncommitted work; use an isolated worktree if needed rather than discarding it or including it in the update.
- Verify `origin` is `JaiiR320/t3code` and `upstream` is `pingdotgg/t3code`; add `upstream` if it is missing. Fetch current `upstream/main` and `origin/personal` without tags or recursive submodule updates. Preserve local commits that have not been pushed. If the fork's remote branch has advanced, integrate those commits too.
- Fast-forward local `main` to `upstream/main` (create it from `upstream/main` if it does not exist). Keep personal fixes out of `main`. If `main` has diverged, inspect and report the discrepancy rather than resetting it. Account for branches checked out in other worktrees.
- Keep a backup ref to the original `personal` tip, such as `backup/personal-pre-update-<date>`. Start a focused update branch from `personal`, with a name such as `update/upstream-<date>`. Do not prefix names with `codex/`.
- Merge `main` into the update branch, leaving the merge uncommitted while reviewing it. Resolve conflicts by understanding both versions. Review automatically merged files that both sides changed, especially shared contracts, RPC registrations, settings, and client integration. Do not choose one entire side just to make a conflict disappear.
- If upstream's changes overlap Jair's personal features (for example his GitHub issues and combined Source Control page), stop and ask which direction to take before resolving.
- Where Jair's fork moved or replaced an upstream file, port upstream's diff for that file (`git diff <merge-base> main -- <file>`) onto the personal file rather than keeping either side wholesale.
- Compare the personal changes before and after the merge. Check that personal-only files and upstream-only files are preserved, and inspect the combined edits in overlapping files. Do not create an empty merge commit when there are no changes to merge.

## Check and commit

Run `vp i` after the merge, since upstream often changes dependencies. Run focused tests for conflicts, overlapping behavior, and any merge adaptations. Run targeted lint and package typechecks for the affected scope (`vp run typecheck` inside each package). Follow AGENTS.md's restriction against repo-wide checks. For shared contracts or runtime changes, typecheck web, desktop, mobile, client-runtime, and server.

Common breakages after a merge: a personal service calling a server API upstream removed or renamed, a personal RPC missing from upstream's new exhaustive registries (permissions, instrumentation), and import paths changed by a dependency upgrade.

If desktop tests need a missing Electron runtime, repair it first with:

```bash
node apps/desktop/scripts/ensure-electron-runtime.mjs
```

Fix straightforward integration failures and rerun the affected checks. Do not silently remove personal features or introduce unrelated behavior changes. Browser or computer verification requires Jair's explicit agreement; this workflow's verification checkpoint is Jair testing the installed app.

Commit the reviewed merge and any necessary adaptations with plain conventional titles. Verify both the original personal tip and the fetched upstream tip are ancestors of the result. Fast-forward local `personal` to the tested update branch and leave the checkout on `personal`. If it advanced during the work, integrate the new commits and validate the resulting state instead of overwriting them.

## Install the tested source

Follow the device file for each target. These rules apply on every device:

- Run installers sequentially. They share build outputs, and the service installer temporarily changes package versions.
- Never pass `--restart` to the service installer, restart the service, quit the app, or touch `~/.t3/userdata`. Jair performs any required restart outside the active T3 session.
- Determine running paths from a process's actual PID; never kill processes by a name or path pattern.
- If an install fails, fix what can be fixed within this update and retry the affected step. Otherwise report exactly which installation remains old; keep its working launcher and build. Do not ask for verification or push a partially installed update as though it succeeded.
- If a later source fix changes runtime behavior, rebuild and install the affected surfaces before asking Jair to verify.

## Verification checkpoint

Report the merged upstream version or tip, source commit, any uncommitted changes included, checks run, installed paths per device, and retained rollback builds. Distinguish the service's configured runtime from the version still running.

Tell Jair what each device still needs: a service restart (`t3 service restart`, which ends the service's active agent turns and terminals), quitting and reopening the desktop app (plus `--activate` on the MacBook if the build was only staged), or tapping install on the phone. Ask Jair to test the installed update, then end the turn and wait for the reply.

**Push to `origin/personal` only after Jair confirms the installed update works.** This is the verification gate Jair requested. Do not infer verification from elapsed time, passing automated tests, an unrelated message, or a report about the old running version. Link this skill when explaining why the push is pending.

## Finalize after verification

Jair's confirmation that this installed update works authorizes completing this workflow's push; do not ask for another confirmation. Commit any remaining changes belonging to the update and ensure local `personal` includes the verified result. Preserve unrelated work.

Recheck the fork remote and fetch `origin/personal` before pushing. If it advanced, integrate its commits without force-pushing. New runtime behavior requires the relevant checks, installation, and Jair's verification again. Push only `personal` to `origin`, never to upstream; do not push `main`, create a PR, or publish a release unless separately requested.

Confirm `personal` and `origin/personal` match and report the final commit and working-tree state. Keep the update and backup branches unless Jair requests cleanup.
