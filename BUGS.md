# Known bugs

## A dead Codex app-server breaks Codex until the service restarts

All threads share one Codex app-server session per provider instance. If that process exits, every later Codex turn fails within milliseconds with "Codex App Server process exited with code 1". T3 keeps reusing the dead session instead of starting a new process.

The Codex adapter builds its event stream with `Stream.fromEffectRepeat(Queue.take(events))` (`apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`). That stream never ends when the process exits. `ProviderSessionManager` only releases a session with reason `runtime_error` when its event stream ends or fails, so the dead entry stays cached until it goes idle or the service restarts.

Seen on 2026-10-09: a broken Omarchy `codex` wrapper made the app-server exit at startup. After Codex itself was fixed, turns still failed until `t3 service restart`.

Fix: end or fail the adapter's event stream when the client's process exits, so the session is released and the next turn opens a new app-server. Add a test that kills the process and checks that a later turn starts a new one.
