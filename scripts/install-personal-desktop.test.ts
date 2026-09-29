// @effect-diagnostics nodeBuiltinImport:off - Installer tests exercise real files and subprocesses in scratch directories.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { createPackage } from "@electron/asar";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";

import { installDesktopArtifact, pruneDesktopInstalls } from "./install-personal-desktop.ts";

let scratch: string;
beforeEach(() => {
  scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-desktop-installer-test-"));
});
afterEach(() => NodeFS.rmSync(scratch, { recursive: true, force: true }));

async function fixture(
  options: { version?: string; runtime?: string; extractionFails?: boolean } = {},
) {
  const source = NodePath.join(scratch, "source");
  NodeFS.mkdirSync(source);
  NodeFS.writeFileSync(
    NodePath.join(source, "package.json"),
    JSON.stringify({ version: options.version ?? "0.0.44" }),
  );
  const archive = NodePath.join(scratch, "app.asar");
  await createPackage(source, archive);
  const artifact = NodePath.join(scratch, "fixture.AppImage");
  const executable = `#!/bin/sh\nif [ "$1" = "-p" ]; then printf '%s\\n' '${options.runtime ?? "44.4.2"}'; else printf '%s\\n' "$@"; fi\n`;
  NodeFS.writeFileSync(
    artifact,
    `#!${process.execPath}\n
const fs = require('node:fs');
if (${options.extractionFails ?? false}) process.exit(1);
fs.mkdirSync('squashfs-root/resources', {recursive: true});
fs.copyFileSync(${JSON.stringify(archive)}, 'squashfs-root/resources/app.asar');
fs.writeFileSync('squashfs-root/t3code', ${JSON.stringify(executable)}, {mode: 0o755});
`,
  );
  const installRoot = NodePath.join(scratch, "opt");
  NodeFS.mkdirSync(installRoot);
  const previous = NodePath.join(installRoot, "t3code-previous");
  NodeFS.mkdirSync(NodePath.join(previous, "squashfs-root"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(previous, "squashfs-root/t3code"), "previous executable");
  const launcher = NodePath.join(scratch, "bin/t3code");
  NodeFS.mkdirSync(NodePath.dirname(launcher));
  const previousLauncher = `#!/bin/sh\nexec ${previous}/squashfs-root/t3code "$@"\n`;
  NodeFS.writeFileSync(launcher, previousLauncher, { mode: 0o755 });
  return {
    artifact,
    installDirectory: NodePath.join(installRoot, "t3code-new build's path"),
    launcher,
    version: "0.0.44",
    electronVersion: "44.4.2",
    sourceCommit: "source-commit",
    uncommittedChanges: " M AGENTS.md",
    previous,
    previousLauncher,
    installRoot,
  };
}

it("switches to a verified build, forwards arguments, and records the source", async () => {
  const input = await fixture();
  expect(installDesktopArtifact(input)).toBe(input.previous);
  expect(
    NodeChildProcess.execFileSync(input.launcher, ["two words", "$(echo unchanged)", "a'b"], {
      encoding: "utf8",
    }),
  ).toBe("two words\n$(echo unchanged)\na'b\n");
  expect(
    JSON.parse(
      NodeFS.readFileSync(NodePath.join(input.installDirectory, "personal-install.json"), "utf8"),
    ),
  ).toEqual({
    version: "0.0.44",
    sourceCommit: "source-commit",
    uncommittedChanges: " M AGENTS.md",
  });
  expect(NodeFS.readFileSync(NodePath.join(input.previous, "squashfs-root/t3code"), "utf8")).toBe(
    "previous executable",
  );
  expect(
    installDesktopArtifact({
      ...input,
      installDirectory: NodePath.join(input.installRoot, "t3code-next"),
    }),
  ).toBe(input.installDirectory);
});

it.each([{ extractionFails: true }, { version: "0.0.43" }, { runtime: "broken runtime" }])(
  "keeps the working launcher and removes a failed install: %j",
  async (options) => {
    const input = await fixture(options);
    expect(() => installDesktopArtifact(input)).toThrow();
    expect(NodeFS.readFileSync(input.launcher, "utf8")).toBe(input.previousLauncher);
    expect(NodeFS.existsSync(input.installDirectory)).toBe(false);
  },
);

it("refuses to overwrite an existing installation", async () => {
  const input = await fixture();
  NodeFS.mkdirSync(input.installDirectory);
  NodeFS.writeFileSync(NodePath.join(input.installDirectory, "keep"), "working files");
  expect(() => installDesktopArtifact(input)).toThrow();
  expect(NodeFS.readFileSync(NodePath.join(input.installDirectory, "keep"), "utf8")).toBe(
    "working files",
  );
  expect(NodeFS.readFileSync(input.launcher, "utf8")).toBe(input.previousLauncher);
});

it("keeps the rollback build and process references while pruning obsolete builds", () => {
  const installRoot = NodePath.join(scratch, "opt");
  const procRoot = NodePath.join(scratch, "proc");
  NodeFS.mkdirSync(installRoot);
  NodeFS.mkdirSync(procRoot);
  const build = (name: string) => {
    const directory = NodePath.join(installRoot, `t3code-${name}`);
    NodeFS.mkdirSync(directory);
    NodeFS.writeFileSync(NodePath.join(directory, "personal-install.json"), "{}");
    return directory;
  };
  const current = build("current");
  const previous = build("previous");
  const obsolete = build("obsolete");
  const legacy = NodePath.join(installRoot, "t3code-legacy");
  NodeFS.mkdirSync(NodePath.join(legacy, "squashfs-root/resources"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(legacy, "squashfs-root/t3code"), "old executable");
  NodeFS.writeFileSync(NodePath.join(legacy, "squashfs-root/resources/app.asar"), "old archive");
  const active = [build("executable"), build("cwd"), build("command")];
  for (const [index, directory] of active.entries()) {
    const processDirectory = NodePath.join(procRoot, String(index + 100));
    NodeFS.mkdirSync(processDirectory);
    if (index === 0)
      NodeFS.symlinkSync(
        `${directory}/squashfs-root/t3code`,
        NodePath.join(processDirectory, "exe"),
      );
    if (index === 1) NodeFS.symlinkSync(directory, NodePath.join(processDirectory, "cwd"));
    if (index === 2)
      NodeFS.writeFileSync(
        NodePath.join(processDirectory, "cmdline"),
        `node\0${directory}/helper.js\0`,
      );
  }
  const unrelated = NodePath.join(installRoot, "t3code-unrelated");
  NodeFS.mkdirSync(unrelated);
  const symlink = NodePath.join(installRoot, "t3code-symlink");
  NodeFS.symlinkSync(scratch, symlink);
  pruneDesktopInstalls({ installRoot, current, previous, procRoot });
  expect(NodeFS.existsSync(obsolete)).toBe(false);
  expect(NodeFS.existsSync(legacy)).toBe(false);
  for (const directory of [current, previous, ...active, unrelated, symlink]) {
    expect(NodeFS.existsSync(directory)).toBe(true);
  }
});

it("keeps the latest prior install when the launcher target cannot be read", () => {
  const installRoot = NodePath.join(scratch, "opt");
  const procRoot = NodePath.join(scratch, "proc");
  NodeFS.mkdirSync(installRoot);
  NodeFS.mkdirSync(procRoot);
  const build = (name: string, time: number) => {
    const directory = NodePath.join(installRoot, `t3code-${name}`);
    NodeFS.mkdirSync(directory);
    NodeFS.writeFileSync(NodePath.join(directory, "personal-install.json"), "{}");
    NodeFS.utimesSync(directory, time, time);
    return directory;
  };
  const obsolete = build("obsolete", 1);
  const rollback = build("rollback", 2);
  const current = build("current", 3);
  const unrelated = NodePath.join(installRoot, "t3code-unrelated");
  NodeFS.mkdirSync(unrelated);
  pruneDesktopInstalls({ installRoot, current, previous: undefined, procRoot });
  expect(NodeFS.existsSync(obsolete)).toBe(false);
  for (const directory of [current, rollback, unrelated])
    expect(NodeFS.existsSync(directory)).toBe(true);
});
