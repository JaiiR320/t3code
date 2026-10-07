# MacBook (macOS, Apple Silicon)

The MacBook runs the launchd service `com.t3tools.t3code.service` with the desktop app's local environment turned off; the service also hosts T3 Connect for the phone. Server, contracts, and web client changes only take effect once the service runs them.

Install the service runtime first, then the desktop app:

```bash
node scripts/install-personal-service.ts
node scripts/install-personal-desktop.ts
```

## Service

- The installer builds a `<version>+personal.<time>.<sha>` runtime under `~/.t3/runtime/versions`, smoke-tests it, and records it as `activeVersion` in `~/.t3/runtime/service-state.json` without restarting. A `.restart-pending` file there means the service still runs the old runtime.
- Find the running runtime from the service PID: `launchctl list | grep com.t3tools.t3code.service` gives the PID, then `ps -p <pid> -o args=` shows which version directory it runs.
- Remove obsolete personal runtimes, keeping the newest, one previous working version, and any version still running.
- Jair restarts with `t3 service restart` when ready.

## Desktop app

- The installer builds an unsigned arm64 zip, ad-hoc signs the extracted bundle, and keeps each build under `~/.local/opt/t3code-<version>-personal-<sha>-<time>`, along with the previous build for rollback.
- If T3 is running from `~/Applications`, the installer cannot replace it and leaves the build staged. After quitting T3, Jair runs `node scripts/install-personal-desktop.ts --activate` to copy the newest build into `~/Applications` without rebuilding, then reopens T3.
- `timeout` is not available on macOS; do not wrap commands in it.
