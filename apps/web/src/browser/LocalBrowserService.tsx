import {
  AuthPreviewOperateScope,
  LocalDesktopBrowserEndpoint,
  type EnvironmentId,
} from "@t3tools/contracts";
import { withDeviceHubQuery } from "@t3tools/client-runtime/state/deviceHubAccess";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { useEffect } from "react";

import { readPreviewStreamAccess } from "~/state/previewStream";
import { useEnvironmentScope } from "~/state/session";
import { useLocalBrowserHostStore } from "./localBrowserHostStore";

const decodeEndpoint = Schema.decodeUnknownOption(LocalDesktopBrowserEndpoint);

/** Attach an independent service only if its private socket exists on this machine. */
export function LocalBrowserService({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const canOperate = useEnvironmentScope(environmentId, AuthPreviewOperateScope);
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!canOperate || !preview?.connectLocalBrowser || !preview.isLocalBrowserConnected) return;
    const connect = preview.connectLocalBrowser;
    const isConnected = preview.isLocalBrowserConnected;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const update = (connected: boolean) => {
      if (!stopped) useLocalBrowserHostStore.getState().setConnected(environmentId, connected);
    };
    const check = async () => {
      let connected = false;
      try {
        connected = await isConnected(environmentId);
        if (!connected && !stopped) {
          const access = await readPreviewStreamAccess(environmentId, true);
          if (access && !stopped) {
            request = new AbortController();
            const response = await fetch(
              withDeviceHubQuery(`${access.httpBase}/desktop-host`, access),
              {
                credentials: access.credentials ? "include" : "omit",
                signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
              },
            );
            if (response.ok && !stopped) {
              const endpoint = decodeEndpoint(await response.json());
              if (Option.isSome(endpoint) && !stopped)
                connected = await connect(environmentId, endpoint.value);
            }
          }
        }
      } catch {
        // Remote machines, older servers, and an occupied host keep streaming.
      }
      update(connected);
      if (!stopped) {
        timer = setTimeout(() => void check(), connected ? 2_000 : 15_000);
      }
    };
    void check();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      request?.abort();
      useLocalBrowserHostStore.getState().setConnected(environmentId, false);
      void preview.disconnectLocalBrowser?.(environmentId);
    };
  }, [environmentId, canOperate]);
  return null;
}
