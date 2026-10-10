import { create } from "zustand";

/** A successful private IPC handshake, rather than a URL, proves locality. */
export const useLocalBrowserHostStore = create<{
  readonly connected: Readonly<Record<string, boolean>>;
  readonly hosted: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  readonly setConnected: (environmentId: string, connected: boolean) => void;
  readonly setHosting: (
    key: {
      readonly environmentId?: string | undefined;
      readonly threadId: string;
      readonly tabId: string;
    },
    hosting: boolean,
  ) => void;
}>()((set) => ({
  connected: {},
  hosted: {},
  setConnected: (environmentId, connected) =>
    set((state) => {
      if ((state.connected[environmentId] ?? false) === connected) return state;
      const next = { ...state.connected };
      if (connected) next[environmentId] = true;
      else delete next[environmentId];
      if (connected) return { connected: next };
      const hosted = { ...state.hosted };
      delete hosted[environmentId];
      return { connected: next, hosted };
    }),
  setHosting: (key, hosting) =>
    set((state) => {
      if (!key.environmentId) return state;
      const id = `${key.threadId}\u0000${key.tabId}`;
      const tabs = { ...state.hosted[key.environmentId] };
      if ((tabs[id] ?? false) === hosting) return state;
      if (hosting) tabs[id] = true;
      else delete tabs[id];
      return { hosted: { ...state.hosted, [key.environmentId]: tabs } };
    }),
}));
