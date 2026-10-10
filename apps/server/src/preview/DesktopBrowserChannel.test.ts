// @effect-diagnostics nodeBuiltinImport:off - Exercises the real inherited descriptor lifecycle in a subprocess.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

import { describe, it as plainIt } from "vite-plus/test";
import * as NodeNet from "node:net";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as DesktopBrowserChannel from "./DesktopBrowserChannel.ts";

const key = { threadId: "thread-1", tabId: "tab-1" };

plainIt(
  "receives desktop messages and exits while the parent keeps both input pipes open",
  async () => {
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        NodeURL.fileURLToPath(
          new URL("./testing/DesktopPipeLifecycle.fixture.ts", import.meta.url),
        ),
      ],
      { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"] },
    );
    // A failed exit must not leave a test process running. This never fires on success.
    // @effect-diagnostics-next-line globalTimers:off -- Bounds the native subprocess on failure; success waits for process exit.
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 8_000);
    let output = "";
    let errors = "";
    let verified = false;
    child.stderr?.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    const write = (fd: number, value: Record<string, unknown>) => {
      const stream = child.stdio[fd];
      if (!stream || !("write" in stream)) throw new Error(`Missing pipe ${fd}`);
      stream.write(`${JSON.stringify(value)}\n`);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      let end: number;
      while ((end = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, end);
        output = output.slice(end + 1);
        if (line === "ready") {
          write(3, { type: "attached", ...key });
          write(5, { version: 1, type: "desktopTelemetryHello", electronPid: process.pid });
        } else if (line === "attached") {
          write(3, { type: "detached", ...key });
        } else if (line === "verified") {
          verified = true;
        }
      }
    });
    try {
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code, signal) => resolve({ code, signal }));
        },
      );
      expect(errors).not.toContain("Error");
      expect(verified).toBe(true);
      expect(result).toEqual({ code: 0, signal: null });
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      for (const stream of child.stdio) stream?.destroy();
    }
  },
);

const localChannel = Effect.gen(function* () {
  const config = ServerConfig.layerTest(process.cwd(), { prefix: "t3-desktop-browser-local-" });
  const context = yield* Layer.build(DesktopBrowserChannel.layer.pipe(Layer.provide(config)));
  return Context.get(context, DesktopBrowserChannel.DesktopBrowserChannel);
});

const connect = (socketPath: string) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<NodeNet.Socket>((resolve, reject) => {
          const socket = NodeNet.createConnection(socketPath);
          socket.once("error", reject);
          socket.once("connect", () => resolve(socket));
        }),
    ),
    (socket) =>
      Effect.sync(() => {
        socket.destroy();
      }),
  );
const nextLine = (socket: NodeNet.Socket) =>
  Effect.promise(
    () =>
      new Promise<string>((resolve, reject) => {
        socket.once("error", reject);
        socket.once("data", (data) => resolve(data.toString().trim()));
      }),
  );
const closes = (socket: NodeNet.Socket) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
      }),
  );

describe("local DesktopBrowserChannel", () => {
  it.live("authenticates a host, routes commands, and detaches its tabs on disconnect", () =>
    Effect.gen(function* () {
      const channel = yield* localChannel;
      expect(channel.available).toBe(false);
      const endpoint = channel.localEndpoint!;
      expect(endpoint).not.toBeNull();
      if ((yield* HostProcess.Platform) !== "win32") {
        expect(NodeFS.statSync(NodePath.dirname(endpoint.socketPath)).mode & 0o777).toBe(0o700);
        expect(NodeFS.statSync(endpoint.socketPath).mode & 0o777).toBe(0o600);
      }
      const socket = yield* connect(endpoint.socketPath);
      const ready = yield* nextLine(socket).pipe(Effect.forkChild);
      socket.write(`${JSON.stringify({ token: endpoint.token })}\n`);
      expect(yield* Fiber.join(ready)).toBe('{"type":"ready"}');
      expect(channel.available).toBe(true);
      const attached = yield* Stream.runHead(channel.attached).pipe(Effect.forkChild);
      socket.write(`${JSON.stringify({ type: "attached", ...key })}\n`);
      expect(yield* Fiber.join(attached)).toEqual(Option.some(key));
      expect(yield* channel.isAttached(key)).toBe(true);
      const command = yield* nextLine(socket).pipe(Effect.forkChild);
      yield* channel.pointer(key, { phase: "move", x: 10, y: 20 });
      expect(JSON.parse(yield* Fiber.join(command))).toEqual({
        type: "pointer",
        ...key,
        phase: "move",
        x: 10,
        y: 20,
      });
      for (const hosting of [true, false]) {
        const readiness = yield* nextLine(socket).pipe(Effect.forkChild);
        yield* channel.hosting(key, hosting);
        expect(JSON.parse(yield* Fiber.join(readiness))).toEqual({
          type: "hosting",
          ...key,
          hosting,
        });
      }
      const detached = yield* Stream.runHead(channel.detached).pipe(Effect.forkChild);
      socket.end();
      expect(yield* Fiber.join(detached)).toEqual(Option.some(key));
      expect(channel.available).toBe(false);
      expect(yield* channel.isAttached(key)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.live("rejects invalid credentials and competing hosts", () =>
    Effect.gen(function* () {
      const channel = yield* localChannel;
      const endpoint = channel.localEndpoint!;
      const invalid = yield* connect(endpoint.socketPath);
      const invalidClosed = yield* closes(invalid).pipe(Effect.forkChild);
      invalid.write('{"token":"invalid"}\n');
      yield* Fiber.join(invalidClosed);
      expect(channel.available).toBe(false);
      const host = yield* connect(endpoint.socketPath);
      const ready = yield* nextLine(host).pipe(Effect.forkChild);
      host.write(`${JSON.stringify({ token: endpoint.token })}\n`);
      yield* Fiber.join(ready);
      const competing = yield* connect(endpoint.socketPath);
      const competingClosed = yield* closes(competing).pipe(Effect.forkChild);
      competing.write(`${JSON.stringify({ token: endpoint.token })}\n`);
      yield* Fiber.join(competingClosed);
      expect(channel.available).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.live("removes its private socket directory when its scope closes", () =>
    Effect.gen(function* () {
      const path = yield* Effect.scoped(
        localChannel.pipe(Effect.map((channel) => channel.localEndpoint!.socketPath)),
      );
      if ((yield* HostProcess.Platform) !== "win32")
        expect(NodeFS.existsSync(NodePath.dirname(path))).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
