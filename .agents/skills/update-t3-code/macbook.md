# MacBook (macOS, Apple Silicon)

The MacBook runs the launchd service `com.t3tools.t3code.service` with the desktop app's local environment turned off; the service also hosts T3 Connect for the phone. Server, contracts, and web client changes only take effect once the service runs them.

Install the service runtime first, then the desktop app:

```bash
node scripts/install-personal-service.ts
node scripts/install-personal-desktop.ts
```

## Service

- The installer builds a `<version>+personal.<time>.<sha>` runtime under `~/.t3/runtime/versions`, smoke-tests it, and records it as `activeVersion` in `~/.t3/runtime/service-state.json` without restarting. A `.restart-pending` file there means the service still runs the old runtime.
- The service was first installed through `npx`, so `~/.local/bin/t3` is a symlink into the runtime versions tree that the installer repoints. If `t3` is missing from `PATH`, restore that symlink rather than reinstalling the service.
- `t3 connect status` should show the environment link as provisioned. If not, Jair runs `t3 connect link` after the restart.
- Find the running runtime from the service PID: `launchctl list | grep com.t3tools.t3code.service` gives the PID, then `ps -p <pid> -o args=` shows which version directory it runs.
- Remove obsolete personal runtimes, keeping the newest, one previous working version, and any version still running.
- Jair restarts with `t3 service restart` when ready.

## Desktop app

- The installer builds an unsigned arm64 zip, ad-hoc signs the extracted bundle, and keeps each build under `~/.local/opt/t3code-<version>-personal-<sha>-<time>`, along with the previous build for rollback.
- A running app loads its helpers from its own bundle, so the installer cannot replace `~/Applications` while T3 runs. Instead it leaves a detached waiter that copies the newest build into place as soon as T3 quits, so Jair only quits and reopens T3, like on Omarchy. The waiter logs to `~/.local/opt/activate-after-quit.log`; the newest waiter supersedes older ones. To check what is installed, compare `shasum` of `Contents/Resources/app.asar` in `~/Applications` with the build directories.
- `node scripts/install-personal-desktop.ts --activate` selects the newest build without rebuilding, or starts the same waiter if T3 is running.
- `timeout` is not available on macOS; do not wrap commands in it.
