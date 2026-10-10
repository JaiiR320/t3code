// @effect-diagnostics nodeBuiltinImport:off - Bridges Playwright to a local desktop browser host.
/**
 * The server end of the desktop browser channel (see `DesktopBrowserEvent`).
 *
 * Playwright connects over CDP only through a WebSocket URL, so each attached
 * desktop tab gets a loopback endpoint with an unguessable path. Its frames
 * cross bootstrap file descriptors or a private local socket to the desktop
 * relay, which owns the tab's `webContents.debugger`. The endpoint only bridges
 * to that one tab.
 */
import * as NodeStream from "@effect/platform-node/NodeStream";
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer";
import {
  DesktopBrowserCommand,
  DesktopBrowserEvent,
  type DesktopBrowserCommand as DesktopBrowserCommandType,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Ndjson from "effect/encoding/Ndjson";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as ServerConfig from "../config.ts";
import { writeAllToFileDescriptor } from "../resourceTelemetry/DesktopTelemetryReceiver.ts";

const decodeEvent = Schema.decodeUnknownEffect(DesktopBrowserEvent);
const encodeCommand = Schema.encodeEffect(Schema.fromJsonString(DesktopBrowserCommand));

export interface DesktopTabKey {
  readonly threadId: string;
  readonly tabId: string;
}

const keyOf = ({ threadId, tabId }: DesktopTabKey) => `${threadId}\u0000${tabId}`;

export class DesktopBrowserChannel extends Context.Service<
  DesktopBrowserChannel,
  {
    /** True while a desktop browser host is connected. */
    readonly available: boolean;
    readonly localEndpoint: { readonly socketPath: string; readonly token: string } | null;
    /**
     * Waits for a tab to be attached. Subscribes before it checks, so an
     * attach landing in between is never missed. False after `timeout`.
     */
    readonly awaitAttached: (key: DesktopTabKey, timeout: Duration.Input) => Effect.Effect<boolean>;
    /** Desktop tabs as they detach. */
    readonly detached: Stream.Stream<DesktopTabKey>;
    /** Desktop tabs as they attach, including a tab coming back after its DevTools close. */
    readonly attached: Stream.Stream<DesktopTabKey>;
    readonly isAttached: (key: DesktopTabKey) => Effect.Effect<boolean>;
    /**
     * A one-connection CDP endpoint for an attached tab. Closing the scope
     * releases the tab on the desktop and stops the endpoint.
     */
    readonly endpoint: (key: DesktopTabKey) => Effect.Effect<string, never, Scope.Scope>;
    /** Reports whether this server is driving the desktop tab. */
    readonly hosting: (key: DesktopTabKey, hosting: boolean) => Effect.Effect<void>;
    /** Draws the agent's cursor over a tab the desktop renders. */
    readonly pointer: (
      key: DesktopTabKey,
      pointer: { readonly phase: "move" | "click"; readonly x: number; readonly y: number },
    ) => Effect.Effect<void>;
  }
>()("t3/preview/DesktopBrowserChannel") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const inputFd = config.desktopBrowserFd;
  const controlFd = config.desktopBrowserControlFd;
  const changes = yield* PubSub.unbounded<{ key: DesktopTabKey; attached: boolean }>();
  const attachedTabs = new Set<string>();
  /** CDP frames from the desktop, per tab, for the endpoint connected to it. */
  const inbound = new Map<string, Queue.Queue<string>>();
  const writeLock = yield* Semaphore.make(1);

  const bootstrap = inputFd !== undefined && controlFd !== undefined;
  let peer: NodeNet.Socket | undefined;
  let localEndpoint: { socketPath: string; token: string } | null = null;

  const command = (message: DesktopBrowserCommandType) =>
    writeLock.withPermits(1)(
      encodeCommand(message).pipe(
        Effect.flatMap((line) =>
          bootstrap
            ? writeAllToFileDescriptor(controlFd, Buffer.from(`${line}\n`))
            : Effect.sync(() => {
                peer?.write(`${line}\n`);
              }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("desktop browser command failed", { cause }),
        ),
      ),
    );

  const receive = (value: unknown) =>
    decodeEvent(value).pipe(
      Effect.option,
      Effect.flatMap((decoded) => {
        if (Option.isNone(decoded)) return Effect.void;
        const event = decoded.value;
        const key = { threadId: event.threadId, tabId: event.tabId };
        const id = keyOf(key);
        switch (event.type) {
          case "cdp": {
            const queue = inbound.get(id);
            return queue ? Queue.offer(queue, event.message).pipe(Effect.asVoid) : Effect.void;
          }
          case "attached":
            attachedTabs.add(id);
            return PubSub.publish(changes, { key, attached: true }).pipe(Effect.asVoid);
          case "detached": {
            attachedTabs.delete(id);
            const queue = inbound.get(id);
            inbound.delete(id);
            return (queue ? Queue.shutdown(queue) : Effect.void).pipe(
              Effect.andThen(PubSub.publish(changes, { key, attached: false })),
              Effect.asVoid,
            );
          }
        }
      }),
    );
  const disconnect = Effect.gen(function* () {
    const ids = [...attachedTabs];
    attachedTabs.clear();
    for (const queue of inbound.values()) yield* Queue.shutdown(queue);
    inbound.clear();
    for (const id of ids) {
      const [threadId, tabId] = id.split("\u0000");
      yield* PubSub.publish(changes, {
        key: { threadId: threadId!, tabId: tabId! },
        attached: false,
      });
    }
  });

  if (bootstrap) {
    const readable = yield* Effect.acquireRelease(
      // Inherited pipe reads must remain cancellable during desktop shutdown.
      Effect.sync(() => new NodeNet.Socket({ fd: inputFd, readable: true, writable: false })),
      (stream) => Effect.sync(() => stream.destroy()),
    );
    yield* NodeStream.fromReadable<Uint8Array, Error>({
      evaluate: () => readable,
      closeOnDone: true,
      onError: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(
      Stream.pipeThroughChannel(Ndjson.decode({ ignoreEmptyLines: true })),
      Stream.runForEach(receive),
      Effect.catchCause((cause) => Effect.logWarning("desktop browser channel stopped", { cause })),
      Effect.forkScoped,
    );
  } else {
    yield* Effect.gen(function* () {
      const runFork = Effect.runForkWith(yield* Effect.context<never>());
      const scope = yield* Effect.scope;
      const platform = yield* HostProcess.Platform;
      const token = NodeCrypto.randomBytes(32).toString("base64url");
      const directory =
        platform === "win32"
          ? null
          : NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-desktop-browser-"));
      if (directory) {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
        );
        NodeFS.chmodSync(directory, 0o700);
      }
      const socketPath = directory
        ? NodePath.join(directory, "host.sock")
        : `\\\\.\\pipe\\t3-desktop-browser-${NodeCrypto.randomBytes(24).toString("hex")}`;
      const sockets = new Set<NodeNet.Socket>();
      const server = NodeNet.createServer((socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        let authenticated = false;
        let rejected = false;
        runFork(
          NodeStream.fromReadable<Uint8Array, Error>({
            evaluate: () => socket,
            closeOnDone: true,
            onError: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          }).pipe(
            Stream.pipeThroughChannel(Ndjson.decode({ ignoreEmptyLines: true })),
            Stream.runForEach((value) => {
              if (rejected) return Effect.void;
              if (authenticated) return receive(value);
              return Effect.sync(() => {
                const supplied =
                  typeof value === "object" && value !== null && "token" in value
                    ? value.token
                    : undefined;
                if (
                  peer ||
                  typeof supplied !== "string" ||
                  Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
                  !NodeCrypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
                ) {
                  rejected = true;
                  socket.destroy();
                  return;
                }
                authenticated = true;
                peer = socket;
                socket.write('{"type":"ready"}\n');
              });
            }),
            Effect.ignore,
            Effect.ensuring(
              Effect.gen(function* () {
                if (peer !== socket) return;
                yield* disconnect;
                peer = undefined;
              }),
            ),
            Effect.forkIn(scope),
          ),
        );
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const socket of sockets) socket.destroy();
          server.close();
        }),
      );
      const bound = yield* Effect.tryPromise(
        () =>
          new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(socketPath, () => {
              server.removeListener("error", reject);
              server.on("error", () => {});
              try {
                if (directory) NodeFS.chmodSync(socketPath, 0o600);
                resolve();
              } catch (error) {
                reject(error);
              }
            });
          }),
      ).pipe(
        Effect.map(() => true),
        Effect.catchCause((cause) =>
          Effect.logWarning("local desktop browser channel unavailable", { cause }).pipe(
            Effect.as(false),
          ),
        ),
      );
      if (bound) localEndpoint = { socketPath, token };
      else server.close();
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("local desktop browser channel unavailable", { cause }),
      ),
    );
  }

  const endpoint = (key: DesktopTabKey) =>
    Effect.gen(function* () {
      const id = keyOf(key);
      const secret = NodeCrypto.randomBytes(24).toString("base64url");
      const server = yield* NodeSocketServer.makeWebSocket({
        host: "127.0.0.1",
        port: 0,
        path: `/${secret}`,
      }).pipe(Effect.orDie);
      const queue = yield* Queue.unbounded<string>();
      inbound.set(id, queue);
      // A detach before this registration shut down no queue, so check again.
      if (!attachedTabs.has(id)) {
        inbound.delete(id);
        return yield* Effect.die("The desktop tab detached before the server connected.");
      }
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const current = inbound.get(id) === queue;
          if (current) inbound.delete(id);
          yield* Queue.shutdown(queue);
          if (current) yield* command({ type: "release", ...key });
        }),
      );
      // The relay serves one Playwright connection; a second would see the first's sessions.
      let connected = false;
      yield* server
        .run((socket) =>
          Effect.gen(function* () {
            if (connected) return;
            connected = true;
            const writer = yield* socket.writer;
            const reader = yield* socket.reader;
            yield* Stream.fromQueue(queue).pipe(
              Stream.runForEach((message) => writer.write(message)),
              Effect.forkScoped,
            );
            const decoder = new TextDecoder();
            return yield* reader.pull.pipe(
              Effect.flatMap((frames) =>
                Effect.forEach(
                  frames,
                  (frame) =>
                    command({
                      type: "cdp",
                      ...key,
                      message: typeof frame === "string" ? frame : decoder.decode(frame),
                    }),
                  { discard: true },
                ),
              ),
              Effect.forever,
            );
          }).pipe(Effect.scoped, Effect.ignore),
        )
        .pipe(Effect.forkScoped);
      const address = server.address;
      if (address._tag !== "InetAddressV4") return yield* Effect.die("Unexpected relay address.");
      return `ws://127.0.0.1:${address.port}/${secret}`;
    });

  return DesktopBrowserChannel.of({
    get available() {
      return bootstrap || (peer !== undefined && !peer.destroyed && !peer.readableEnded);
    },
    localEndpoint,
    awaitAttached: (key, timeout) =>
      Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          if (attachedTabs.has(keyOf(key))) return true;
          return yield* Stream.fromSubscription(subscription).pipe(
            Stream.filter((change) => change.attached && keyOf(change.key) === keyOf(key)),
            Stream.runHead,
            Effect.map(Option.isSome),
            Effect.timeoutOption(timeout),
            Effect.map((result) => Option.getOrElse(result, () => false)),
          );
        }),
      ),
    detached: Stream.fromPubSub(changes).pipe(
      Stream.filter((change) => !change.attached),
      Stream.map((change) => change.key),
    ),
    attached: Stream.fromPubSub(changes).pipe(
      Stream.filter((change) => change.attached),
      Stream.map((change) => change.key),
    ),
    isAttached: (key) => Effect.sync(() => attachedTabs.has(keyOf(key))),
    endpoint,
    hosting: (key, hosting) => command({ type: "hosting", ...key, hosting }),
    pointer: (key, pointer) => command({ type: "pointer", ...key, ...pointer }),
  });
});

export const layer = Layer.effect(DesktopBrowserChannel, make);
