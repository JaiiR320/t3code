// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - a plain Node driver around the release scripts.
/**
 * Builds this checkout into a t3 release archive and switches the local
 * background service to it, so the service runs the fork instead of a
 * published release. Run as `node scripts/install-personal-service.ts`.
 *
 * It reuses the release pipeline rather than copying files into place: the
 * archive is built and smoke-tested the way CI does it, then installed by the
 * `t3 update` already on PATH, pointed at a one-shot local release server.
 * That keeps the runtime layout, checksum verification, launcher repointing,
 * and unit rewrite in the code that owns them.
 *
 * The version is the checkout's release version plus build metadata
 * (`0.0.42+personal.<utc-time>.<sha>[.dirty]`). Build metadata carries no
 * precedence, so the service never looks older or newer than the release it
 * is based on, and every build still gets its own runtime directory.
 *
 * The service is only switched, not restarted, unless `--restart` is passed:
 * a restart ends every agent turn and terminal the service is running, and
 * run from inside T3 it would stop the very process doing the update.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { releasePackageFiles } from "./update-release-package-versions.ts";

// Keep in step with SEA_NODE_VERSION in apps/server/vite.config.ts. `build-exe`
// injects into the Node running it, which must support --build-sea (25.7+).
const SEA_NODE_VERSION = "26.8.2";
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone script has no Effect runtime.
const arch = process.arch;
const RUST_TARGETS: Record<string, string> = {
  x64: "x86_64-unknown-linux-gnu",
  arm64: "aarch64-unknown-linux-gnu",
};

const repoRoot = NodePath.dirname(import.meta.dirname);
const restart = process.argv.includes("--restart");

function fail(message: string): never {
  console.error(`[personal-service] ${message}`);
  process.exit(1);
}

function log(message: string) {
  console.log(`[personal-service] ${message}`);
}

function run(command: string, args: ReadonlyArray<string>, env: NodeJS.ProcessEnv = {}) {
  log(`$ ${[command, ...args].join(" ")}`);
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ""} failed (${result.signal ?? result.status}).`);
  }
}

function capture(command: string, args: ReadonlyArray<string>) {
  return NodeChildProcess.execFileSync(command, args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone script has no Effect runtime.
if (process.platform !== "linux") fail("Only the Linux systemd service is supported.");
const rustTarget = RUST_TARGETS[arch] ?? fail(`Unsupported architecture ${arch}.`);
const platformKey = `linux-${arch}`;

// A restart stops the unit's whole cgroup before starting it again, and a
// process inside it would be killed between the two, leaving it stopped.
const insideService = NodeFS.readFileSync("/proc/self/cgroup", "utf8").includes("/t3code.service");
if (restart && insideService) {
  fail(
    "--restart would stop this process along with the service. Run it from a terminal outside T3, or drop --restart and restart later.",
  );
}

// `t3 update` only repoints the launcher it was started through, so it has to
// be the PATH launcher that already points into the runtime versions tree.
const launcher = (() => {
  try {
    return capture("sh", ["-c", "command -v t3"]);
  } catch {
    return fail("No t3 on PATH. Install T3 Code's CLI and background service first.");
  }
})();
if (!NodeFS.realpathSync(launcher).includes(`${NodePath.sep}runtime${NodePath.sep}versions`)) {
  fail(`${launcher} is not an installed t3 runtime launcher.`);
}

// CI gets this Node from vp's managed shims; a local shell usually has an
// older one on PATH, so borrow the pinned version through mise instead.
const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split(".").map(Number);
const seaNodeReady = nodeMajor > 25 || (nodeMajor === 25 && nodeMinor >= 7);
if (!seaNodeReady && NodeChildProcess.spawnSync("mise", ["--version"]).status !== 0) {
  fail(`Building the t3 executable needs Node 25.7+ or mise to fetch Node ${SEA_NODE_VERSION}.`);
}

const serverPackage = JSON.parse(
  NodeFS.readFileSync(NodePath.join(repoRoot, "apps/server/package.json"), "utf8"),
) as { version: string };
const baseVersion = serverPackage.version.split("+", 1)[0];
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const sha = capture("git", ["rev-parse", "--short", "HEAD"]);
const dirty = capture("git", ["status", "--porcelain"]).length > 0;
const version = `${baseVersion}+personal.${stamp}.${sha}${dirty ? ".dirty" : ""}`;
const releaseRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-personal-release-"));
const releaseDir = NodePath.join(releaseRoot, `v${version}`);
// The installed runtime is copied out of the archive, so the build is scratch on every exit.
process.on("exit", () => NodeFS.rmSync(releaseRoot, { recursive: true, force: true }));
const archiveName = `t3-${version}-${platformKey}.tar.gz`;
const archivePath = NodePath.join(releaseDir, archiveName);
log(`Building t3@${version} from ${sha}${dirty ? " with uncommitted changes" : ""}.`);

// The executable reads its version from the package manifests at build time,
// so they carry the personal version for the build and are put back after.
const manifests = releasePackageFiles.map((file) => {
  const filePath = NodePath.join(repoRoot, file);
  return { filePath, original: NodeFS.readFileSync(filePath) };
});
const restoreManifests = () => {
  for (const manifest of manifests) NodeFS.writeFileSync(manifest.filePath, manifest.original);
};
// Let a Ctrl-C reach the running build step, then fall through to the restore.
process.on("SIGINT", () => undefined);

try {
  const cargoHome = NodePath.join(NodeOS.homedir(), ".cargo", "bin");
  run(
    "cargo",
    [
      "build",
      "--locked",
      "--release",
      "--manifest-path",
      "native/resource-monitor/Cargo.toml",
      "--target",
      rustTarget,
    ],
    // rustup's own bin first: a version-manager shim may have no toolchain set here.
    NodeFS.existsSync(cargoHome)
      ? { PATH: `${cargoHome}${NodePath.delimiter}${process.env.PATH}` }
      : {},
  );
  const resourceMonitorDir = NodePath.join(releaseRoot, "resource-monitor");
  NodeFS.mkdirSync(NodePath.join(resourceMonitorDir, platformKey), { recursive: true });
  NodeFS.copyFileSync(
    NodePath.join(
      repoRoot,
      "native/resource-monitor/target",
      rustTarget,
      "release/t3-resource-monitor",
    ),
    NodePath.join(resourceMonitorDir, platformKey, "t3-resource-monitor"),
  );

  run("node", ["scripts/update-release-package-versions.ts", version]);
  run("vp", ["run", "--filter", "t3", "build"]);
  const buildExe = ["node", "apps/server/scripts/cli.ts", "build-exe"];
  if (seaNodeReady) {
    run(buildExe[0]!, buildExe.slice(1));
  } else {
    run("mise", ["exec", `node@${SEA_NODE_VERSION}`, "--", ...buildExe]);
  }
  run("node", [
    "scripts/build-cli-archive.ts",
    "--platform",
    "linux",
    "--arch",
    arch,
    "--version",
    version,
    "--resource-monitor-dir",
    resourceMonitorDir,
    "--output-dir",
    releaseDir,
  ]);
} catch (error) {
  restoreManifests();
  fail(error instanceof Error ? error.message : String(error));
}
restoreManifests();

if (!NodeFS.existsSync(archivePath)) fail(`The build did not produce ${archivePath}.`);
try {
  run("node", [
    "scripts/smoke-cli-archive.ts",
    "--archive",
    archivePath,
    "--expect-version",
    version,
  ]);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const digest = NodeCrypto.createHash("sha256")
  .update(NodeFS.readFileSync(archivePath))
  .digest("hex");
NodeFS.writeFileSync(NodePath.join(releaseDir, "SHA256SUMS"), `${digest}  ${archiveName}\n`);

// `t3 update` downloads from `<base>/v<version>/`, so serve the release root
// on loopback for exactly as long as the update runs.
const server = NodeHttp.createServer((request, response) => {
  const requested = NodePath.resolve(
    releaseRoot,
    `.${decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)}`,
  );
  if (!requested.startsWith(`${releaseRoot}${NodePath.sep}`) || !NodeFS.existsSync(requested)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-length": NodeFS.statSync(requested).size });
  NodeFS.createReadStream(requested).pipe(response);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address === "string") fail("The local release server has no port.");

log(`Installing t3@${version} through ${launcher}.`);
// Async, not spawnSync: the release server above has to keep answering while
// the update downloads from it.
const exitCode = await new Promise<number | null>((resolve) => {
  NodeChildProcess.spawn(
    launcher,
    ["update", version, "--allow-downgrade", ...(restart ? ["--yes"] : [])],
    {
      env: { ...process.env, T3CODE_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}` },
      stdio: "inherit",
    },
  ).on("exit", resolve);
});
server.close();
if (exitCode !== 0) fail(`t3 update exited with ${exitCode}.`);

if (!restart) {
  log(
    "Installed. The service keeps running its current version until you run `t3 service restart`, which ends the agent turns and terminals it is running.",
  );
}
