# Omarchy PC (Linux x64)

The PC runs the systemd service `t3code.service` on port 3773. The desktop app connects to it rather than its bundled server, so server, contracts, and web client changes only take effect once the service runs them.

Install the service runtime first, then the desktop app:

```bash
node scripts/install-personal-service.ts
node scripts/install-personal-desktop.ts
```

## Service

- The installer builds a `<version>+personal.<time>.<sha>` runtime under `~/.t3/runtime/versions`, smoke-tests it, and switches the service unit and the `t3` launcher to it without restarting. If the Rust toolchain is missing on `PATH`, it tries `~/.cargo/bin`.
- Verify the `t3` launcher and the unit's configured target. Find the running runtime from the service's main PID (`systemctl --user show t3code.service -p MainPID`, or without `--user` if it is a system unit) and `/proc/<pid>/exe` or `/proc/<pid>/cmdline`.
- Remove obsolete personal runtimes, keeping the newest, one previous working version, and any version still running.
- Jair restarts with `t3 service restart` when ready.

## Desktop app

- The installer builds an AppImage, extracts it with `--appimage-extract` into a fresh directory under `~/.local/opt`, and atomically switches the stable launcher `~/.local/bin/t3code`. Verify the launcher target afterward.
- Leave both desktop entries, `~/.local/share/applications/t3code.desktop` and `~/.local/share/applications/com.t3tools.T3Code.desktop`, alone; they launch the stable launcher.
- Do not modify the system package under `/opt/t3code-bin`.
- Jair quits and reopens T3 to use the new build.
