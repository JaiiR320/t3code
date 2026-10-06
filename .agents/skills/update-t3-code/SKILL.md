---
name: update-t3-code
description: Update Jair's T3 Code fork from upstream, preserve personal changes, install the service and desktop app, then push personal after Jair verifies the update. Use for requests like "update T3 Code" or "sync upstream and update my app". A request only to compare branches does not authorize this workflow.
---

# Update T3 Code

Use the checkout containing this skill. Run commands from its root and read its current [AGENTS.md](../../../AGENTS.md), especially the personal fork, verification, and installation instructions. This skill authorizes preparing and installing the update; publishing waits for Jair's verification.

## Prepare and merge

- Inspect the working tree, branches, worktrees, and remotes. Preserve unrelated uncommitted work; use an isolated worktree if needed rather than discarding it or including it in the update.
- Verify `origin` is `JaiiR320/t3code` and `upstream` is `pingdotgg/t3code`. Fetch current `upstream/main` and `origin/personal` without tags or recursive submodule updates. Preserve local commits that have not been pushed. If the fork's remote branch has advanced, integrate those commits too.
- Fast-forward local `main` to `upstream/main`. Keep personal fixes out of `main`. If `main` has diverged, inspect and report the discrepancy rather than resetting it. Account for branches checked out in other worktrees.
- Keep a backup ref to the original `personal` tip. Start a focused update branch from `personal`, with a name such as `update/upstream-<date>`. Do not prefix names with `codex/`.
- Merge `main` into the update branch, leaving the merge uncommitted while reviewing it. Resolve conflicts by understanding both versions. Review automatically merged files that both sides changed, especially shared contracts, RPC registrations, settings, and client integration. Do not choose one entire side just to make a conflict disappear.
- Compare the personal changes before and after the merge. Check that personal-only files and upstream-only files are preserved, and inspect the combined edits in overlapping files. Do not create an empty merge commit when there are no changes to merge.

## Check and commit

Run focused tests for conflicts, overlapping behavior, and any merge adaptations. Run targeted lint and package typechecks for the affected scope. Follow AGENTS.md's restriction against repo-wide checks. For shared contracts or runtime changes, account for web, desktop, mobile, and server consumers.

If desktop tests need a missing Electron runtime, repair it first with:

```bash
node apps/desktop/scripts/ensure-electron-runtime.mjs
```

Fix straightforward integration failures and rerun the affected checks. Do not silently remove personal features or introduce unrelated behavior changes. Browser or computer verification requires Jair's explicit agreement; this workflow's verification checkpoint is Jair testing the installed app.

Commit the reviewed merge and any necessary adaptations with plain conventional titles. Verify both the original personal tip and the fetched upstream tip are ancestors of the result. Fast-forward local `personal` to the tested update branch and leave the checkout on `personal`. If it advanced during the work, integrate the new commits and validate the resulting state instead of overwriting them.

## Install the tested source

Run the repository installers sequentially, because they share build outputs and the service installer temporarily changes package versions. Skip the service installer on a machine without the background service, such as Jair's Mac, where the desktop app runs its bundled server and the desktop install covers server changes:

```bash
node scripts/install-personal-service.ts
node scripts/install-personal-desktop.ts
```

- The service installer builds, smoke-tests, and selects a fresh personal runtime. Verify the `t3` launcher and the service unit's configured target. Clean up obsolete personal runtimes, keeping the newest, one previous working runtime, and every older runtime still running. Determine running paths from the service's actual PID (`/proc` on Linux, `ps -p <pid> -o args=` on macOS); never kill processes by a name or path pattern.
- The desktop installer ensures Electron, builds a fresh app, verifies the extracted app and runtime, selects it, and cleans up obsolete builds and temporary artifacts. On Linux x64 it builds an AppImage and atomically switches `~/.local/bin/t3code`; verify the launcher target and leave both desktop entries and `/opt/t3code-bin` alone. On macOS it builds a zip and copies the verified app into `~/Applications`. If T3 is running from there, the build stays staged under `~/.local/opt`; tell Jair to quit T3 and run `node scripts/install-personal-desktop.ts --activate`.
- Never pass `--restart` to the service installer, restart the service, quit the app, or touch `~/.t3/userdata`. Jair performs any required restart outside the active T3 session.
- If an install fails, fix what can be fixed within this update and retry the affected step. Otherwise report exactly which installation remains old; keep its working launcher and build. Do not ask for verification or push a partially installed update as though it succeeded.
- If a later source fix changes runtime behavior, rebuild and install the affected surfaces before asking Jair to verify.

## Verification checkpoint

Report the merged upstream version or tip, source commit, any uncommitted changes included, checks run, installed desktop and service paths, and retained rollback builds. Distinguish the service's configured runtime from the version still running.

Where the service is installed, tell Jair to run `t3 service restart` when ready if it still runs the old runtime, and to quit and reopen T3 to use the newly selected desktop build (on macOS, run `--activate` after quitting if the build was only staged). Explain that restarting the service ends its active agent turns and terminals. Ask Jair to test the installed update, then end the turn and wait for the reply.

**Push to `origin/personal` only after Jair confirms the installed update works.** This is the verification gate Jair requested. Do not infer verification from elapsed time, passing automated tests, an unrelated message, or a report about the old running version. Link this skill when explaining why the push is pending.

## Finalize after verification

Jair's confirmation that this installed update works authorizes completing this workflow's push; do not ask for another confirmation. Commit any remaining changes belonging to the update and ensure local `personal` includes the verified result. Preserve unrelated work.

Recheck the fork remote and fetch `origin/personal` before pushing. If it advanced, integrate its commits without force-pushing. New runtime behavior requires the relevant checks, installation, and Jair's verification again. Push only `personal` to `origin`, never to upstream; do not push `main`, create a PR, or publish a release unless separately requested.

Confirm `personal` and `origin/personal` match and report the final commit and working-tree state. Keep the update and backup branches unless Jair requests cleanup.
