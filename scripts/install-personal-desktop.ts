// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - Standalone Node installer, like install-personal-service.ts.
/** Builds and installs Jair's Linux desktop without opening or restarting it. */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { extractFile } from "@electron/asar";

const repoRoot = NodePath.dirname(import.meta.dirname);
const receiptName = "personal-install.json";

function log(message: string) {
  console.log(`[personal-desktop] ${message}`);
}

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.SpawnSyncOptions = {},
) {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ""} failed (${result.signal ?? result.status}).`);
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function previousInstall(launcher: string, installRoot: string) {
  if (!NodeFS.existsSync(launcher)) return undefined;
  const content = NodeFS.readFileSync(launcher, "utf8");
  // Read our generated launcher and the unquoted launchers from earlier manual installs.
  const target = /^exec (.+) "\$@"$/m.exec(content)?.[1];
  if (!target) return undefined;
  const executable =
    target.startsWith("'") && target.endsWith("'")
      ? target.slice(1, -1).replaceAll("'\\''", "'")
      : target;
  const directory = NodePath.dirname(NodePath.dirname(executable));
  return NodePath.dirname(directory) === installRoot && NodeFS.existsSync(executable)
    ? directory
    : undefined;
}

/** Only repoint the launcher once extraction, app metadata, and the runtime have passed. */
export function installDesktopArtifact(input: {
  readonly artifact: string;
  readonly installDirectory: string;
  readonly launcher: string;
  readonly version: string;
  readonly electronVersion: string;
  readonly sourceCommit: string;
  readonly uncommittedChanges: string;
}) {
  const previous = previousInstall(input.launcher, NodePath.dirname(input.installDirectory));
  // Refuse an existing directory, including one used by a running app.
  NodeFS.mkdirSync(input.installDirectory);
  const launcherTemporary = `${input.launcher}.${NodePath.basename(input.installDirectory)}.tmp`;
  let installed = false;
  try {
    NodeFS.chmodSync(input.artifact, 0o755);
    run(input.artifact, ["--appimage-extract"], {
      cwd: input.installDirectory,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const appRoot = NodePath.join(input.installDirectory, "squashfs-root");
    const executable = NodePath.join(appRoot, "t3code");
    NodeFS.accessSync(executable, NodeFS.constants.X_OK);
    const manifest: unknown = JSON.parse(
      extractFile(NodePath.join(appRoot, "resources/app.asar"), "package.json").toString(),
    );
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      !("version" in manifest) ||
      manifest.version !== input.version
    ) {
      throw new Error(`The extracted app does not have expected version ${input.version}.`);
    }
    // Electron's Node mode executes this probe without starting the GUI or opening userdata.
    const runtime = NodeChildProcess.execFileSync(executable, ["-p", "process.versions.electron"], {
      cwd: input.installDirectory,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 30_000,
    }).trim();
    if (runtime !== input.electronVersion) {
      throw new Error(`Expected Electron ${input.electronVersion}, got ${runtime}.`);
    }
    NodeFS.writeFileSync(
      NodePath.join(input.installDirectory, receiptName),
      JSON.stringify(
        {
          version: input.version,
          sourceCommit: input.sourceCommit,
          uncommittedChanges: input.uncommittedChanges,
        },
        null,
        2,
      ) + "\n",
    );
    NodeFS.mkdirSync(NodePath.dirname(input.launcher), { recursive: true });
    NodeFS.writeFileSync(launcherTemporary, `#!/bin/sh\nexec ${shellQuote(executable)} "$@"\n`, {
      mode: 0o755,
      flag: "wx",
    });
    NodeFS.renameSync(launcherTemporary, input.launcher);
    installed = true;
    return previous;
  } finally {
    NodeFS.rmSync(launcherTemporary, { force: true });
    if (!installed) NodeFS.rmSync(input.installDirectory, { recursive: true, force: true });
  }
}

/** Find builds referenced by Linux processes so cleanup never removes a running app. */
function runningInstalls(
  installRoot: string,
  directories: ReadonlyArray<string>,
  procRoot: string,
) {
  const running = new Set<string>();
  for (const processDirectory of NodeFS.readdirSync(procRoot)) {
    if (!/^\d+$/.test(processDirectory)) continue;
    for (const link of ["exe", "cwd"]) {
      let target: string;
      try {
        target = NodeFS.readlinkSync(NodePath.join(procRoot, processDirectory, link));
      } catch {
        continue;
      }
      const relative = NodePath.relative(installRoot, target);
      const directory = NodePath.join(installRoot, relative.split(NodePath.sep)[0]!);
      if (directories.includes(directory)) running.add(directory);
    }
    try {
      const command = NodeFS.readFileSync(NodePath.join(procRoot, processDirectory, "cmdline"));
      for (const directory of directories) {
        if (command.includes(directory + NodePath.sep)) running.add(directory);
      }
    } catch {
      // Processes can exit between enumeration and reading their command line.
    }
  }
  return running;
}

/** Retain the selected build, its predecessor, and every build still in use. */
export function pruneDesktopInstalls(input: {
  readonly installRoot: string;
  readonly current: string;
  readonly previous: string | undefined;
  readonly procRoot?: string;
}) {
  const directories = NodeFS.readdirSync(input.installRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("t3code-"))
    .map((entry) => NodePath.join(input.installRoot, entry.name))
    .filter(
      (directory) =>
        // Recognize our receipts and the extracted AppImage layout of earlier manual installs.
        NodeFS.existsSync(NodePath.join(directory, receiptName)) ||
        (NodeFS.existsSync(NodePath.join(directory, "squashfs-root/t3code")) &&
          NodeFS.existsSync(NodePath.join(directory, "squashfs-root/resources/app.asar"))),
    );
  const keep = runningInstalls(input.installRoot, directories, input.procRoot ?? "/proc");
  keep.add(input.current);
  const previous =
    input.previous ??
    directories
      .filter((directory) => directory !== input.current)
      .sort((a, b) => NodeFS.statSync(b).mtimeMs - NodeFS.statSync(a).mtimeMs)[0];
  if (previous) keep.add(previous);
  for (const directory of directories) {
    if (keep.has(directory)) continue;
    NodeFS.rmSync(directory, { recursive: true });
    log(`Removed obsolete build ${directory}.`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: node scripts/install-personal-desktop.ts\nBuilds a fresh Linux x64 AppImage, verifies it, and switches ~/.local/bin/t3code. Does not restart the app or service.",
    );
    return;
  }
  if (args.length) throw new Error("No arguments are supported. Use --help for usage.");
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone installer has no Effect runtime.
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("This installer supports Linux x64 only.");
  }
  const captureGit = (args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  const sourceCommit = captureGit(["rev-parse", "HEAD"]);
  const uncommittedChanges = captureGit(["status", "--porcelain"]);
  const desktopPackage: { version: string; dependencies: { electron: string } } = JSON.parse(
    NodeFS.readFileSync(NodePath.join(repoRoot, "apps/desktop/package.json"), "utf8"),
  );
  const sha = sourceCommit.slice(0, 10);
  const stamp = new Date().toISOString().replace(/\D/g, "");
  const home = NodeOS.homedir();
  const installRoot = NodePath.join(home, ".local/opt");
  const installDirectory = NodePath.join(
    installRoot,
    `t3code-${desktopPackage.version}-personal-${sha}${uncommittedChanges ? "-dirty" : ""}-${stamp}`,
  );
  const buildDirectory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-personal-desktop-"));
  try {
    log(`Building from ${sourceCommit}${uncommittedChanges ? " with uncommitted changes" : ""}.`);
    if (uncommittedChanges) log(uncommittedChanges);
    run(process.execPath, ["apps/desktop/scripts/ensure-electron-runtime.mjs"]);
    const cargoBin = NodePath.join(home, ".cargo/bin");
    run(
      process.execPath,
      [
        "scripts/build-desktop-artifact.ts",
        "--platform",
        "linux",
        "--target",
        "AppImage",
        "--arch",
        "x64",
        "--build-version",
        desktopPackage.version,
        "--output-dir",
        buildDirectory,
      ],
      {
        env: {
          ...process.env,
          PATH: NodeFS.existsSync(cargoBin)
            ? `${cargoBin}${NodePath.delimiter}${process.env.PATH ?? ""}`
            : process.env.PATH,
          T3CODE_DESKTOP_SKIP_BUILD: "false",
          T3CODE_DESKTOP_KEEP_STAGE: "false",
        },
      },
    );
    const artifacts = NodeFS.readdirSync(buildDirectory).filter((name) =>
      name.endsWith(".AppImage"),
    );
    if (artifacts.length !== 1)
      throw new Error(`Expected one AppImage, found ${artifacts.length}.`);
    NodeFS.mkdirSync(installRoot, { recursive: true });
    const previous = installDesktopArtifact({
      artifact: NodePath.join(buildDirectory, artifacts[0]!),
      installDirectory,
      launcher: NodePath.join(home, ".local/bin/t3code"),
      version: desktopPackage.version,
      electronVersion: desktopPackage.dependencies.electron,
      sourceCommit,
      uncommittedChanges,
    });
    log(`Installed ${desktopPackage.version} at ${installDirectory}.`);
    try {
      pruneDesktopInstalls({ installRoot, current: installDirectory, previous });
    } catch (error) {
      log(`Installed successfully, but cleanup could not finish: ${String(error)}`);
    }
    log(
      "Quit and reopen T3 when ready. The running app and service were not restarted. Server changes also need install-personal-service.ts and a later `t3 service restart`.",
    );
  } finally {
    NodeFS.rmSync(buildDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && NodeURL.pathToFileURL(process.argv[1]).href === import.meta.url) {
  // Let Ctrl-C reach the build subprocess, then clean up its scratch output.
  process.on("SIGINT", () => undefined);
  try {
    main();
  } catch (error) {
    console.error(`[personal-desktop] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
