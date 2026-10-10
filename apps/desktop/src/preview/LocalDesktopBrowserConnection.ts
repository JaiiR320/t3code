// @effect-diagnostics nodeBuiltinImport:off - Connects Electron to a machine-local browser channel.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import * as DesktopBrowserHost from "./DesktopBrowserHost.ts";

interface ConnectionInput {
  readonly environmentId: string;
  readonly socketPath: string;
  readonly token: string;
}

export class LocalDesktopBrowserConnection extends Context.Service<
  LocalDesktopBrowserConnection,
  {
    readonly connect: (input: ConnectionInput) => Effect.Effect<boolean>;
    readonly disconnect: (environmentId: string) => Effect.Effect<void>;
    readonly isConnected: (environmentId: string) => Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/preview/LocalDesktopBrowserConnection") {}

/** Only the ephemeral IPC endpoint shape advertised by the local server is accepted. */
const isLocalEndpoint = (path: string, platform: NodeJS.Platform) => {
  if (platform === "win32") {
    return /^\\\\\.\\pipe\\t3-desktop-browser-[A-Za-z0-9_-]+$/.test(path);
  }
  const parent = NodePath.dirname(path);
  return (
    NodePath.isAbsolute(path) &&
    NodePath.basename(path) === "host.sock" &&
    /^t3-desktop-browser-[A-Za-z0-9_-]+$/.test(NodePath.basename(parent)) &&
    NodePath.normalize(path) === path
  );
};

// CDP carries full-page screenshots as base64, including tall high-DPI pages.
const MAX_LINE_BYTES = 64 * 1024 * 1024;

export const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const host = yield* DesktopBrowserHost.DesktopBrowserHost;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const runPromise = Effect.runPromiseWith(context);
  const lock = yield* Semaphore.make(1);
  const connections = new Map<
    string,
    {
      input: ConnectionInput;
      socket: NodeNet.Socket;
      scope: Scope.Closeable;
      ready: boolean;
    }
  >();

  const disconnectUnlocked = (environmentId: string, expectedSocket?: NodeNet.Socket) =>
    Effect.suspend(() => {
      const connection = connections.get(environmentId);
      if (!connection || (expectedSocket && connection.socket !== expectedSocket))
        return Effect.void;
      connections.delete(environmentId);
      connection.ready = false;
      return Scope.close(connection.scope, Exit.void);
    });
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...connections.keys()], (environmentId) => disconnectUnlocked(environmentId), {
      discard: true,
    }),
  );

  const connect = (input: ConnectionInput) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        if (
          !isLocalEndpoint(input.socketPath, platform) ||
          !input.token ||
          input.token.includes("\n")
        )
          return false;
        const previous = connections.get(input.environmentId);
        if (
          previous?.ready &&
          previous.input.socketPath === input.socketPath &&
          previous.input.token === input.token
        )
          return true;
        yield* disconnectUnlocked(input.environmentId);
        const scope = yield* Scope.make();
        const socket = new NodeNet.Socket();
        const connection = { input, socket, scope, ready: false };
        connections.set(input.environmentId, connection);
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => socket.destroy()),
        );

        const ready = yield* Effect.promise(
          () =>
            new Promise<boolean>((resolve) => {
              let settled = false;
              let buffered = "";
              const settle = (value: boolean) => {
                if (settled) return;
                settled = true;
                resolve(value);
              };
              const lost = () => {
                connection.ready = false;
                settle(false);
                if (connections.get(input.environmentId) === connection)
                  runFork(disconnectUnlocked(input.environmentId, socket));
              };
              socket.on("error", lost);
              socket.on("close", lost);
              socket.setEncoding("utf8");
              socket.on("data", (chunk: string) => {
                socket.pause();
                buffered += chunk;
                if (Buffer.byteLength(buffered) > MAX_LINE_BYTES) {
                  socket.destroy();
                  return;
                }
                const lines = buffered.split("\n");
                buffered = lines.pop() ?? "";
                void (async () => {
                  try {
                    for (const line of lines) {
                      if (socket.destroyed || connections.get(input.environmentId) !== connection)
                        return;
                      if (!line) continue;
                      if (!connection.ready) {
                        const handshake: unknown = JSON.parse(line);
                        if (
                          typeof handshake !== "object" ||
                          handshake === null ||
                          !("type" in handshake) ||
                          handshake.type !== "ready"
                        ) {
                          socket.destroy();
                          return;
                        }
                        connection.ready = true;
                        settle(true);
                      } else {
                        await runPromise(host.handleCommandLineFor(input.environmentId, line));
                      }
                    }
                    if (!socket.destroyed) socket.resume();
                  } catch {
                    socket.destroy();
                  }
                })();
              });
              socket.connect(input.socketPath, () => {
                socket.write(`${JSON.stringify({ token: input.token })}\n`);
              });
            }),
        ).pipe(Effect.timeoutOption("2 seconds"), Effect.map(Option.getOrElse(() => false)));
        if (!ready || socket.destroyed) {
          yield* disconnectUnlocked(input.environmentId);
          return false;
        }
        yield* host.eventsFor(input.environmentId).pipe(
          Stream.runForEach((bytes) =>
            Effect.promise(
              () =>
                new Promise<void>((resolve) => {
                  if (socket.destroyed) {
                    resolve();
                    return;
                  }
                  const cleanup = () => {
                    socket.off("drain", cleanup);
                    socket.off("close", cleanup);
                    resolve();
                  };
                  if (socket.write(bytes)) resolve();
                  else {
                    socket.once("drain", cleanup);
                    socket.once("close", cleanup);
                  }
                }),
            ),
          ),
          Effect.forkIn(scope),
        );
        return connection.ready;
      }).pipe(Effect.onInterrupt(() => disconnectUnlocked(input.environmentId))),
    );

  return LocalDesktopBrowserConnection.of({
    connect,
    disconnect: (environmentId) => lock.withPermits(1)(disconnectUnlocked(environmentId)),
    isConnected: (environmentId) =>
      Effect.sync(() => connections.get(environmentId)?.ready ?? false),
  });
});

export const layer = Layer.effect(LocalDesktopBrowserConnection, make);
