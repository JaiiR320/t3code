import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { Atom } from "effect/unstable/reactivity";

export function createClientKeybindingsAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly configValueAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<Pick<ServerConfig, "keybindings"> | null>;
}) {
  return Atom.make((get): ServerConfig["keybindings"] => {
    const entries = get(input.catalogValueAtom).entries;
    for (const [environmentId, entry] of entries) {
      if (entry.target._tag === "PrimaryConnectionTarget") {
        return mergeWithDefaultKeybindings(
          get(input.configValueAtom(environmentId))?.keybindings ?? [],
        );
      }
    }

    // A desktop with its local environment disabled, or a hosted web client,
    // gets its shortcuts from the first enabled environment with loaded config.
    for (const [environmentId, entry] of entries) {
      if (!entry.enabled) continue;
      const config = get(input.configValueAtom(environmentId));
      if (config !== null) return mergeWithDefaultKeybindings(config.keybindings);
    }
    return mergeWithDefaultKeybindings([]);
  });
}
