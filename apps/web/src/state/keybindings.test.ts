import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import { EnvironmentId, type ServerConfig } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { createClientKeybindingsAtom } from "./keybindings";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");
const OTHER = EnvironmentId.make("other");

function catalogState(
  ids: readonly EnvironmentId[],
  disabled?: EnvironmentId,
): EnvironmentCatalogState {
  return {
    isReady: true,
    entries: new Map(
      ids.map((environmentId) => [
        environmentId,
        {
          target:
            environmentId === LOCAL
              ? new PrimaryConnectionTarget({
                  environmentId,
                  label: environmentId,
                  httpBaseUrl: "http://localhost",
                  wsBaseUrl: "ws://localhost",
                })
              : new BearerConnectionTarget({
                  environmentId,
                  label: environmentId,
                  connectionId: environmentId,
                }),
          profile: Option.none(),
          enabled: environmentId !== disabled,
        },
      ]),
    ),
  };
}

function config(key: string) {
  return { keybindings: compileResolvedKeybindingsConfig([{ key, command: "terminal.toggle" }]) };
}

function harness() {
  const catalog = Atom.make<EnvironmentCatalogState>(catalogState([]));
  const configs = Atom.family((_id: EnvironmentId) =>
    Atom.make<Pick<ServerConfig, "keybindings"> | null>(null),
  );
  const bindings = createClientKeybindingsAtom({
    catalogValueAtom: catalog,
    configValueAtom: configs,
  });
  const registry = AtomRegistry.make();
  registry.mount(bindings);
  const label = () =>
    shortcutLabelForCommand(registry.get(bindings), "terminal.toggle", { platform: "Linux" });
  return { catalog, configs, bindings, registry, label };
}

describe("client keybindings", () => {
  it("loads paired shortcuts after config arrives, including matching keys and tooltip labels", () => {
    const { catalog, configs, bindings, registry, label } = harness();
    try {
      registry.set(catalog, catalogState([REMOTE]));
      expect(label()).toBe("Ctrl+J");
      registry.set(configs(REMOTE), config("mod+`"));
      expect(label()).toBe("Ctrl+`");
      for (const terminalFocus of [false, true]) {
        expect(
          resolveShortcutCommand(
            {
              key: "`",
              code: "Backquote",
              ctrlKey: true,
              metaKey: false,
              altKey: false,
              shiftKey: false,
            },
            registry.get(bindings),
            {
              platform: "Linux",
              context: { terminalFocus, isDesktop: true },
            },
          ),
        ).toBe("terminal.toggle");
      }
      registry.set(configs(REMOTE), config("mod+g"));
      expect(label()).toBe("Ctrl+G");
      registry.set(catalog, catalogState([]));
      expect(label()).toBe("Ctrl+J");
      registry.set(catalog, catalogState([REMOTE]));
      expect(label()).toBe("Ctrl+G");
    } finally {
      registry.dispose();
    }
  });

  it("preserves local shortcuts regardless of remote registration order", () => {
    const { catalog, configs, registry, label } = harness();
    try {
      registry.set(configs(REMOTE), config("mod+`"));
      registry.set(catalog, catalogState([REMOTE, LOCAL]));
      expect(label()).toBe("Ctrl+J");
      registry.set(configs(LOCAL), config("mod+g"));
      expect(label()).toBe("Ctrl+G");
      registry.set(catalog, catalogState([REMOTE]));
      expect(label()).toBe("Ctrl+`");
    } finally {
      registry.dispose();
    }
  });

  it("skips disabled and unloaded environments, then follows the first enabled config", () => {
    const { catalog, configs, registry, label } = harness();
    try {
      registry.set(catalog, catalogState([REMOTE, OTHER]));
      registry.set(configs(OTHER), config("mod+g"));
      expect(label()).toBe("Ctrl+G");
      registry.set(configs(REMOTE), config("mod+`"));
      expect(label()).toBe("Ctrl+`");
      registry.set(catalog, catalogState([REMOTE, OTHER], REMOTE));
      expect(label()).toBe("Ctrl+G");
      registry.set(catalog, catalogState([REMOTE], REMOTE));
      expect(label()).toBe("Ctrl+J");
    } finally {
      registry.dispose();
    }
  });
});
