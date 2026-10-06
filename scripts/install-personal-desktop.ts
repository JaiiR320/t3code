// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - Standalone Node installer, like install-personal-service.ts.
/** Builds and installs Jair's Linux or macOS desktop without opening or restarting it. */
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

interface InstallInput {
  readonly artifact: string;
  readonly installDirectory: string;
  readonly version: string;
  readonly electronVersion: string;
  readonly sourceCommit: string;
  readonly uncommittedChanges: string;
}

function verifyExtractedApp(input: {
  readonly installDirectory: string;
  readonly executable: string;
  readonly archive: string;
  readonly version: string;
  readonly electronVersion: string;
}) {
  NodeFS.accessSync(input.executable, NodeFS.constants.X_OK);
  const manifest: unknown = JSON.parse(extractFile(input.archive, "package.json").toString());
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    manifest.version !== input.version
  ) {
    throw new Error(`The extracted app does not have expected version ${input.version}.`);
  }
  // Electron's Node mode executes this probe without starting the GUI or opening userdata.
  const runtime = NodeChildProcess.execFileSync(
    input.executable,
    ["-p", "process.versions.electron"],
    {
      cwd: input.installDirectory,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 30_000,
    },
  ).trim();
  if (runtime !== input.electronVersion) {
    throw new Error(`Expected Electron ${input.electronVersion}, got ${runtime}.`);
  }
}

function writeReceipt(input: InstallInput) {
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
}

/** Only repoint the launcher once extraction, app metadata, and the runtime have passed. */
export function installDesktopArtifact(input: InstallInput & { readonly launcher: string }) {
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
    verifyExtractedApp({
      ...input,
      executable,
      archive: NodePath.join(appRoot, "resources/app.asar"),
    });
    writeReceipt(input);
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

/**
 * Extracts and verifies a macOS app into its own build directory. The bundle is
 * never moved afterwards, because a running Electron app launches its helpers
 * from inside it; `activateMacApp` copies it into place instead.
 */
export function installMacArtifact(input: InstallInput) {
  // Refuse an existing directory, including one used by a running app.
  NodeFS.mkdirSync(input.installDirectory);
  let installed = false;
  try {
    // ditto keeps the bundle's symlinks, permissions, and signature intact.
    run("ditto", ["-x", "-k", input.artifact, input.installDirectory]);
    const bundle = macBundle(input.installDirectory);
    if (!bundle) throw new Error("The archive does not contain exactly one app bundle.");
    const executables = NodeFS.readdirSync(NodePath.join(bundle, "Contents/MacOS"));
    if (executables.length !== 1) throw new Error("The app bundle has no single executable.");
    verifyExtractedApp({
      ...input,
      executable: NodePath.join(bundle, "Contents/MacOS", executables[0]!),
      archive: NodePath.join(bundle, "Contents/Resources/app.asar"),
    });
    // Apple Silicon refuses to launch code with a broken signature, so ad-hoc
    // sign an unsigned local build rather than install one that cannot open.
    const verify = ["--verify", "--deep", "--strict", bundle];
    if (NodeChildProcess.spawnSync("codesign", verify, { stdio: "ignore" }).status !== 0) {
      log("Ad-hoc signing the unsigned app bundle.");
      run("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "ignore" });
      run("codesign", verify);
    }
    writeReceipt(input);
    installed = true;
    return bundle;
  } finally {
    if (!installed) NodeFS.rmSync(input.installDirectory, { recursive: true, force: true });
  }
}

function macBundle(installDirectory: string) {
  const bundles = NodeFS.readdirSync(installDirectory).filter((name) => name.endsWith(".app"));
  return bundles.length === 1 ? NodePath.join(installDirectory, bundles[0]!) : undefined;
}

/**
 * Copies a verified bundle into the Applications directory, replacing the
 * previous copy only while nothing runs from it. Returns false when it is in use.
 */
export function activateMacApp(input: {
  readonly bundle: string;
  readonly applicationsDirectory: string;
  readonly references: ReadonlyArray<string>;
}) {
  const target = NodePath.join(input.applicationsDirectory, NodePath.basename(input.bundle));
  if (input.references.some((reference) => reference.includes(target + NodePath.sep))) {
    return false;
  }
  NodeFS.mkdirSync(input.applicationsDirectory, { recursive: true });
  const suffix = `${process.pid}-${Date.now()}`;
  const incoming = `${target}.incoming-${suffix}`;
  const outgoing = `${target}.outgoing-${suffix}`;
  try {
    // An APFS clone costs no extra space and leaves the build directory intact.
    run("cp", ["-cR", input.bundle, incoming]);
    const replacing = NodeFS.existsSync(target);
    if (replacing) NodeFS.renameSync(target, outgoing);
    NodeFS.renameSync(incoming, target);
    if (replacing) NodeFS.rmSync(outgoing, { recursive: true, force: true });
  } finally {
    NodeFS.rmSync(incoming, { recursive: true, force: true });
    if (NodeFS.existsSync(outgoing) && !NodeFS.existsSync(target)) {
      NodeFS.renameSync(outgoing, target);
    }
  }
  return true;
}

/** Executable paths, working directories, and command lines of Linux processes. */
function procReferences(procRoot: string) {
  const references: Array<string> = [];
  for (const processDirectory of NodeFS.readdirSync(procRoot)) {
    if (!/^\d+$/.test(processDirectory)) continue;
    for (const link of ["exe", "cwd"]) {
      try {
        references.push(NodeFS.readlinkSync(NodePath.join(procRoot, processDirectory, link)));
      } catch {
        // Processes can exit or deny access between enumeration and reading.
      }
    }
    try {
      references.push(
        NodeFS.readFileSync(NodePath.join(procRoot, processDirectory, "cmdline"), "utf8"),
      );
    } catch {
      // Processes can exit between enumeration and reading their command line.
    }
  }
  return references;
}

/** Command lines of macOS processes, which start with the executable path. */
function psReferences() {
  return NodeChildProcess.execFileSync("ps", ["-axww", "-o", "args="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).split("\n");
}

function processReferences() {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone installer has no Effect runtime.
  return process.platform === "darwin" ? psReferences() : procReferences("/proc");
}

/** Retain the selected build, its predecessor, and every build still in use. */
export function pruneDesktopInstalls(input: {
  readonly installRoot: string;
  readonly current: string;
  readonly previous: string | undefined;
  readonly procRoot?: string;
}) {
  const references = input.procRoot ? procReferences(input.procRoot) : processReferences();
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
  // Find builds referenced by processes so cleanup never removes a running app.
  const keep = new Set(
    directories.filter((directory) =>
      references.some(
        (reference) => reference === directory || reference.includes(directory + NodePath.sep),
      ),
    ),
  );
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

const usage = `Usage: node scripts/install-personal-desktop.ts [--activate]
Builds a fresh desktop app, verifies it, and selects it without restarting the app or service.
  Linux x64: installs an AppImage build under ~/.local/opt and switches ~/.local/bin/t3code.
  macOS: installs the app under ~/.local/opt and copies it into ~/Applications once it is not running.
  --activate (macOS): copy the newest installed build into ~/Applications without building.`;

function activateNewestMacBuild(installRoot: string, applicationsDirectory: string) {
  const newest = NodeFS.existsSync(installRoot)
    ? NodeFS.readdirSync(installRoot)
        .filter((name) => name.startsWith("t3code-"))
        .map((name) => NodePath.join(installRoot, name))
        .filter((directory) => NodeFS.existsSync(NodePath.join(directory, receiptName)))
        .sort((a, b) => NodeFS.statSync(b).mtimeMs - NodeFS.statSync(a).mtimeMs)[0]
    : undefined;
  const bundle = newest && macBundle(newest);
  if (!bundle) throw new Error(`No installed macOS build found under ${installRoot}.`);
  return activateLoggingResult(bundle, applicationsDirectory);
}

function activateLoggingResult(bundle: string, applicationsDirectory: string) {
  const activated = activateMacApp({ bundle, applicationsDirectory, references: psReferences() });
  log(
    activated
      ? `Selected ${bundle} as ${NodePath.join(applicationsDirectory, NodePath.basename(bundle))}.`
      : `${NodePath.basename(bundle)} is running, so ${applicationsDirectory} still has the previous build. Quit T3 and run \`node scripts/install-personal-desktop.ts --activate\`.`,
  );
  return activated;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    return;
  }
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone installer has no Effect runtime.
  const platform = process.platform;
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone installer has no Effect runtime.
  const arch = process.arch;
  const mac = platform === "darwin";
  if (!mac && (platform !== "linux" || arch !== "x64")) {
    throw new Error("This installer supports Linux x64 and macOS only.");
  }
  const home = NodeOS.homedir();
  const installRoot = NodePath.join(home, ".local/opt");
  const applicationsDirectory = NodePath.join(home, "Applications");
  if (mac && args.length === 1 && args[0] === "--activate") {
    activateNewestMacBuild(installRoot, applicationsDirectory);
    return;
  }
  if (args.length) throw new Error(`Unsupported arguments.\n${usage}`);
  const captureGit = (args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  const sourceCommit = captureGit(["rev-parse", "HEAD"]);
  const uncommittedChanges = captureGit(["status", "--porcelain"]);
  const desktopPackage: { version: string; dependencies: { electron: string } } = JSON.parse(
    NodeFS.readFileSync(NodePath.join(repoRoot, "apps/desktop/package.json"), "utf8"),
  );
  const sha = sourceCommit.slice(0, 10);
  const stamp = new Date().toISOString().replace(/\D/g, "");
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
    // A zip extracts without mounting anything; the dmg only wraps the same bundle.
    const [buildPlatform, target, extension] = mac
      ? ["mac", "zip", ".zip"]
      : ["linux", "AppImage", ".AppImage"];
    run(
      process.execPath,
      [
        "scripts/build-desktop-artifact.ts",
        "--platform",
        buildPlatform,
        "--target",
        target,
        "--arch",
        arch,
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
    const artifacts = NodeFS.readdirSync(buildDirectory).filter((name) => name.endsWith(extension));
    if (artifacts.length !== 1) {
      throw new Error(`Expected one ${extension} artifact, found ${artifacts.length}.`);
    }
    NodeFS.mkdirSync(installRoot, { recursive: true });
    const install = {
      artifact: NodePath.join(buildDirectory, artifacts[0]!),
      installDirectory,
      version: desktopPackage.version,
      electronVersion: desktopPackage.dependencies.electron,
      sourceCommit,
      uncommittedChanges,
    };
    let previous: string | undefined;
    let selected = true;
    if (mac) {
      const bundle = installMacArtifact(install);
      log(`Installed ${desktopPackage.version} at ${installDirectory}.`);
      selected = activateLoggingResult(bundle, applicationsDirectory);
    } else {
      previous = installDesktopArtifact({
        ...install,
        launcher: NodePath.join(home, ".local/bin/t3code"),
      });
      log(`Installed ${desktopPackage.version} at ${installDirectory}.`);
    }
    try {
      pruneDesktopInstalls({ installRoot, current: installDirectory, previous });
    } catch (error) {
      log(`Installed successfully, but cleanup could not finish: ${String(error)}`);
    }
    log(
      `${selected ? "Quit and reopen T3 when ready. " : ""}The running app and service were not restarted. Server changes also need install-personal-service.ts and a later \`t3 service restart\`.`,
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
