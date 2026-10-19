import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * The desktop app renders browser tabs for a server on the same machine, and
 * the server drives them with the same engine as its headless tabs. Messages
 * travel as newline-delimited JSON over bootstrap file descriptors or a
 * private authenticated IPC socket for an independently started service.
 *
 * Each tab carries one CDP connection, multiplexed by `tabId`. CDP frames pass
 * through untouched; the desktop answers them with `CdpRelay`.
 */

const TabKey = {
  threadId: TrimmedNonEmptyString,
  tabId: TrimmedNonEmptyString,
};

/** A private IPC endpoint reachable only on the environment's own machine. */
export const LocalDesktopBrowserEndpoint = Schema.Struct({
  socketPath: TrimmedNonEmptyString,
  token: TrimmedNonEmptyString,
});
export type LocalDesktopBrowserEndpoint = typeof LocalDesktopBrowserEndpoint.Type;

export const DesktopLocalBrowserConnectInput = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  ...LocalDesktopBrowserEndpoint.fields,
});

/** Desktop -> server. */
export const DesktopBrowserEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("attached"), ...TabKey }),
  /** Its `<webview>` went away: closed, crashed, swapped, or devtools took the debugger. */
  Schema.Struct({ type: Schema.Literal("detached"), ...TabKey }),
  Schema.Struct({ type: Schema.Literal("cdp"), ...TabKey, message: Schema.String }),
]);
export type DesktopBrowserEvent = typeof DesktopBrowserEvent.Type;

export const DesktopBrowserCommand = Schema.Union([
  /** Confirms that the server is driving this native page instead of a headless one. */
  Schema.Struct({ type: Schema.Literal("hosting"), ...TabKey, hosting: Schema.Boolean }),
  /** One CDP message for the tab's relay. */
  Schema.Struct({ type: Schema.Literal("cdp"), ...TabKey, message: Schema.String }),
  Schema.Struct({ type: Schema.Literal("release"), ...TabKey }),
  Schema.Struct({
    type: Schema.Literal("pointer"),
    ...TabKey,
    phase: Schema.Literals(["move", "click"]),
    x: Schema.Finite,
    y: Schema.Finite,
  }),
]);
export type DesktopBrowserCommand = typeof DesktopBrowserCommand.Type;
