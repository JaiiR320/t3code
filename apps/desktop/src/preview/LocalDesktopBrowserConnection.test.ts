// @effect-diagnostics nodeBuiltinImport:off - Exercises the real machine-local IPC transport.
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as DesktopBrowserHost from "./DesktopBrowserHost.ts";
import * as LocalConnection from "./LocalDesktopBrowserConnection.ts";

const fixture = Effect.acquireRelease(
  Effect.promise(async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-desktop-browser-"));
    const socketPath = NodePath.join(directory, "host.sock");
    const server = NodeNet.createServer();
    const sockets = new Set<NodeNet.Socket>();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    return { server, sockets, socketPath, directory };
  }),
  ({ server, sockets, directory }) =>
    Effect.promise(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }),
);

describe("LocalDesktopBrowserConnection", () => {
  it.effect("authenticates over IPC and routes commands and announcements to its environment", () =>
    Effect.gen(function* () {
      const local = yield* fixture;
      const host = yield* DesktopBrowserHost.make;
      const received = yield* Deferred.make<{ environmentId: string | undefined; line: string }>();
      const announced = yield* Deferred.make<string>();
      const runFork = Effect.runFork;
      const scopedHost = {
        ...host,
        handleCommandLineFor: (environmentId: string | undefined, line: string) =>
          Deferred.succeed(received, { environmentId, line }).pipe(Effect.asVoid),
      };
      const connection = yield* LocalConnection.make.pipe(
        Effect.provideService(DesktopBrowserHost.DesktopBrowserHost, scopedHost),
        Effect.provideService(HostProcess.Platform, "linux"),
      );
      const tokens: string[] = [];
      local.server.on("connection", (socket) => {
        let buffer = "";
        let authenticated = false;
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
          buffer += chunk;
          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (!authenticated) {
              tokens.push((JSON.parse(line) as { token: string }).token);
              authenticated = true;
              socket.write(
                '{"type":"ready"}\n{"type":"pointer","threadId":"t","tabId":"x","phase":"move","x":1,"y":2}\n',
              );
            } else runFork(Deferred.succeed(announced, line));
          }
        });
      });
      // Existing host tabs are irrelevant here; an attachment after connection is forwarded.
      expect(
        yield* connection.connect({
          environmentId: "service",
          socketPath: local.socketPath,
          token: "secret",
        }),
      ).toBe(true);
      expect(yield* Deferred.await(received)).toMatchObject({ environmentId: "service" });
      expect(tokens).toEqual(["secret"]);
      expect(yield* connection.isConnected("service")).toBe(true);
      host.attach(
        { environmentId: "service", threadId: "t", tabId: "x" },
        {
          webContents: {} as Electron.WebContents,
          debugger: { on: () => undefined, off: () => undefined } as unknown as Electron.Debugger,
        },
      );
      expect(JSON.parse(yield* Deferred.await(announced))).toEqual({
        type: "attached",
        threadId: "t",
        tabId: "x",
      });
      expect(
        yield* connection.connect({
          environmentId: "service",
          socketPath: local.socketPath,
          token: "secret",
        }),
      ).toBe(true);
      expect(tokens).toHaveLength(1);
      yield* connection.disconnect("service");
      expect(yield* connection.isConnected("service")).toBe(false);
      expect(
        yield* connection.connect({
          environmentId: "service",
          socketPath: local.socketPath,
          token: "secret",
        }),
      ).toBe(true);
      expect(tokens).toHaveLength(2);
    }).pipe(Effect.scoped),
  );

  it.effect("serializes disconnect behind a pending handshake", () =>
    Effect.gen(function* () {
      const local = yield* fixture;
      const host = yield* DesktopBrowserHost.make;
      const connection = yield* LocalConnection.make.pipe(
        Effect.provideService(DesktopBrowserHost.DesktopBrowserHost, host),
        Effect.provideService(HostProcess.Platform, "linux"),
      );
      const handshake = new Promise<NodeNet.Socket>((resolve) => {
        local.server.on("connection", (socket) => {
          socket.once("data", () => resolve(socket));
        });
      });
      const connecting = yield* connection
        .connect({ environmentId: "env", socketPath: local.socketPath, token: "secret" })
        .pipe(Effect.forkScoped);
      const peer = yield* Effect.promise(() => handshake);
      const disconnecting = yield* connection.disconnect("env").pipe(Effect.forkScoped);
      peer.write('{"type":"ready"}\n');
      expect(yield* Fiber.join(connecting)).toBe(true);
      yield* Fiber.join(disconnecting);
      expect(yield* connection.isConnected("env")).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects TCP endpoints and returns false when the peer closes during handshake", () =>
    Effect.gen(function* () {
      const local = yield* fixture;
      const host = yield* DesktopBrowserHost.make;
      const connection = yield* LocalConnection.make.pipe(
        Effect.provideService(DesktopBrowserHost.DesktopBrowserHost, host),
        Effect.provideService(HostProcess.Platform, "linux"),
      );
      expect(
        yield* connection.connect({
          environmentId: "env",
          socketPath: "127.0.0.1:3773",
          token: "secret",
        }),
      ).toBe(false);
      let attempts = 0;
      local.server.on("connection", (socket) => {
        attempts += 1;
        socket.once("data", () => {
          if (attempts === 1) socket.destroy();
          else socket.write('{"type":"ready"}\n');
        });
      });
      const input = { environmentId: "env", socketPath: local.socketPath, token: "secret" };
      expect(yield* connection.connect(input)).toBe(false);
      expect(yield* connection.isConnected("env")).toBe(false);
      expect(yield* connection.connect(input)).toBe(true);
      expect(attempts).toBe(2);
    }).pipe(Effect.scoped),
  );
});
