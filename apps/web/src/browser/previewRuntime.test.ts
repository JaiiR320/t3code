import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  desktop: false,
  primary: null as string | null,
  serverBrowser: new Set<string>(),
}));

vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/previewStateStore", () => ({ isPreviewSupportedInRuntime: () => state.desktop }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => state.primary } }));
vi.mock("~/state/primaryEnvironment", () => ({ primaryEnvironmentIdAtom: {} }));
vi.mock("~/state/entities", () => ({
  readEnvironmentSupportsServerBrowser: (id: string) => state.serverBrowser.has(id),
  useEnvironmentSupportsServerBrowser: () => false,
}));

import {
  alternatePreviewRuntime,
  previewRuntimeFor,
  rendersServerTabNatively,
} from "./previewRuntime";

import { useLocalBrowserHostStore } from "./localBrowserHostStore";

const local = "local" as EnvironmentId;
const remote = "remote" as EnvironmentId;

afterEach(() => {
  useLocalBrowserHostStore.setState({ connected: {}, hosted: {} });
  state.desktop = false;
  state.primary = null;
  state.serverBrowser = new Set();
});

describe("previewRuntimeFor", () => {
  it("opens a remote environment's tabs on this computer in the desktop app", () => {
    state.desktop = true;
    state.primary = local;
    state.serverBrowser = new Set([local, remote]);

    expect(previewRuntimeFor(remote)).toBeUndefined();
    expect(previewRuntimeFor(local)).toBe("server");
  });

  it("keeps an attached local service's tabs native and agent-drivable", () => {
    state.desktop = true;
    state.serverBrowser = new Set([environmentId]);
    useLocalBrowserHostStore.getState().setConnected(environmentId, true);
    expect(previewRuntimeFor(environmentId)).toBe("server");
    useLocalBrowserHostStore.getState().setConnected(environmentId, false);
    expect(previewRuntimeFor(environmentId)).toBeUndefined();
  });

  it("uses the environment's browser where the client has none of its own", () => {
    state.serverBrowser = new Set([remote]);

    expect(previewRuntimeFor(remote)).toBe("server");
  });
});

describe("alternatePreviewRuntime", () => {
  it("moves a remote environment's tab between this computer and the environment", () => {
    state.desktop = true;

    expect(alternatePreviewRuntime(remote, local, true, {})).toBe("server");
    expect(alternatePreviewRuntime(remote, local, true, { runtime: "server" })).toBe("desktop");
    expect(alternatePreviewRuntime(local, local, true, {})).toBeNull();
    expect(alternatePreviewRuntime(remote, local, false, {})).toBeNull();
  });

  it("offers no move outside the desktop app", () => {
    expect(alternatePreviewRuntime(remote, null, true, { runtime: "server" })).toBeNull();
  });
});

const environmentId = EnvironmentId.make("service");
const snapshot = { runtime: "server" as const, threadId: ThreadId.make("thread"), tabId: "tab" };

it("keeps a local service streamed until it confirms the native tab is hosting", () => {
  const host = useLocalBrowserHostStore.getState();
  expect(rendersServerTabNatively(environmentId, null, snapshot)).toBe(false);
  host.setConnected(environmentId, true);
  expect(rendersServerTabNatively(environmentId, null, snapshot)).toBe(false);
  host.setHosting({ environmentId, ...snapshot }, true);
  expect(rendersServerTabNatively(environmentId, null, snapshot)).toBe(true);
  expect(rendersServerTabNatively(environmentId, null, { ...snapshot, tabId: "other" })).toBe(
    false,
  );
  host.setHosting({ environmentId, ...snapshot }, false);
  expect(rendersServerTabNatively(environmentId, null, snapshot)).toBe(false);
});

it("clears native eligibility on disconnect and requires confirmation again after reconnect", () => {
  const host = useLocalBrowserHostStore.getState();
  host.setConnected(environmentId, true);
  host.setHosting({ environmentId, ...snapshot }, true);
  host.setConnected(environmentId, false);
  host.setConnected(environmentId, true);
  expect(rendersServerTabNatively(environmentId, null, snapshot)).toBe(false);
});

it("preserves native rendering for the bundled desktop server", () => {
  expect(rendersServerTabNatively(environmentId, environmentId, snapshot)).toBe(true);
  expect(rendersServerTabNatively(EnvironmentId.make("remote"), environmentId, snapshot)).toBe(
    false,
  );
});
