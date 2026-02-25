import { execFile, execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";

import { select } from "@inquirer/prompts";

import { APP_NAME } from "@openkit/shared/constants";
import { getComponentsDir, resolveAvailableWebUiPath } from "@openkit/shared/ui-components";
import { log } from "@openkit/shared/logger";

import { installDesktopApp } from "./install-app";
import { getProjectRoot } from "./runtime-paths";

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name?: string;
  assets: GithubAsset[];
}

const OPENKIT_RELEASES_API_URL =
  process.env.OPENKIT_RELEASES_API_URL ??
  "https://api.github.com/repos/fum4/openkit/releases/latest";

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(cmd, [url], () => {});
}

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf-8", timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const { stdout } = await exec("curl", [
    "-sL",
    "-H",
    "Accept: application/vnd.github+json",
    OPENKIT_RELEASES_API_URL,
  ]);
  return JSON.parse(stdout);
}

function findWebUiAsset(release: GithubRelease): GithubAsset | null {
  const assets = release.assets ?? [];

  const preferred = assets.find((asset) => {
    const name = asset.name.toLowerCase();
    const isArchive = name.endsWith(".tar.gz") || name.endsWith(".tgz");
    if (!isArchive) return false;
    return name.includes("web-app") || name.includes("webapp") || name.includes("openkit-ui");
  });
  if (preferred) return preferred;

  return (
    assets.find((asset) => {
      const name = asset.name.toLowerCase();
      const isArchive = name.endsWith(".tar.gz") || name.endsWith(".tgz");
      if (!isArchive) return false;
      return name.includes("web") || name.includes("ui");
    }) ?? null
  );
}

function findUiRoot(dir: string, depth = 0): string | null {
  if (existsSync(path.join(dir, "index.html"))) return dir;
  if (depth >= 3) return null;

  const children = readdirSync(dir, { withFileTypes: true });
  for (const child of children) {
    if (!child.isDirectory()) continue;
    const nested = path.join(dir, child.name);
    const result = findUiRoot(nested, depth + 1);
    if (result) return result;
  }

  return null;
}

function readLatestTagFromMarker(markerFile: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(markerFile, "utf-8"));
    return typeof raw.tag === "string" ? raw.tag : null;
  } catch {
    return null;
  }
}

function writeInstallMarker(markerFile: string, tag: string, assetName: string): void {
  writeFileSync(
    markerFile,
    JSON.stringify({ tag, assetName, installedAt: new Date().toISOString() }, null, 2),
  );
}

export async function installWebUiBundle(): Promise<{ tag: string; path: string }> {
  if (process.platform === "win32") {
    throw new Error(`${APP_NAME} web UI bundle install currently supports macOS/Linux only.`);
  }

  log.info("Fetching latest release metadata...");
  const release = await fetchLatestRelease();
  const asset = findWebUiAsset(release);
  if (!asset) {
    throw new Error(
      "Could not find a web UI bundle asset in the latest release. Expected a .tar.gz/.tgz asset containing 'web' or 'ui'.",
    );
  }

  const tag = (release.tag_name ?? "latest").replace(/^v/, "");
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "openkit-ui-"));
  const archivePath = path.join(tmpDir, asset.name);
  const extractDir = path.join(tmpDir, "extract");
  mkdirSync(extractDir, { recursive: true });

  try {
    log.info(`Downloading ${asset.name}...`);
    await exec("curl", ["-L", "-o", archivePath, asset.browser_download_url]);

    log.info("Extracting web UI bundle...");
    execFileSync("tar", ["-xzf", archivePath, "-C", extractDir], { stdio: "ignore" });

    const uiRoot = findUiRoot(extractDir);
    if (!uiRoot) {
      throw new Error("Downloaded bundle did not contain an index.html.");
    }

    const componentsDir = getComponentsDir();
    const webDir = path.join(componentsDir, "web");
    const releaseDir = path.join(webDir, tag);
    const currentLink = path.join(webDir, "current");
    const markerPath = path.join(webDir, "installed.json");

    mkdirSync(webDir, { recursive: true });
    rmSync(releaseDir, { recursive: true, force: true });
    execFileSync("cp", ["-R", uiRoot, releaseDir], { stdio: "ignore" });

    rmSync(currentLink, { recursive: true, force: true });
    symlinkSync(releaseDir, currentLink, "dir");
    writeInstallMarker(markerPath, tag, asset.name);

    return { tag, path: releaseDir };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function detectDesktopUi(projectRoot: string): "installed-app" | "dev-electron" | null {
  if (process.platform === "darwin") {
    try {
      const result = execFileSync("mdfind", ['kMDItemCFBundleIdentifier == "com.openkit.app"'], {
        encoding: "utf-8",
        timeout: 3000,
      });
      const appPath = result.trim().split("\n")[0];
      if (appPath && existsSync(appPath)) return "installed-app";
    } catch {
      // ignore
    }
  }

  const electronBin = path.join(projectRoot, "node_modules", ".bin", "electron");
  const electronMain = path.join(projectRoot, "apps", "desktop-app", "dist", "main.js");
  if (existsSync(electronBin) && existsSync(electronMain)) {
    return "dev-electron";
  }

  return null;
}

function getWebInstallMetadata(): string | null {
  const markerPath = path.join(getComponentsDir(), "web", "installed.json");
  return readLatestTagFromMarker(markerPath);
}

export function printUiStatus(): void {
  const projectRoot = getProjectRoot();
  const webUiPath = resolveAvailableWebUiPath(projectRoot);
  const desktopStatus = detectDesktopUi(projectRoot);
  const downloadedTag = getWebInstallMetadata();

  log.plain(`${APP_NAME} UI status`);
  log.plain(`  Project root: ${projectRoot}`);
  log.plain(`  Web UI available: ${webUiPath ? "yes" : "no"}`);
  if (webUiPath) {
    log.plain(`  Web UI path: ${webUiPath}`);
  }
  if (downloadedTag) {
    log.plain(`  Downloaded web UI version: ${downloadedTag}`);
  }
  log.plain(
    `  Desktop UI: ${
      desktopStatus === "installed-app"
        ? "installed app"
        : desktopStatus === "dev-electron"
          ? "dev electron runtime"
          : "not detected"
    }`,
  );
}

async function runInteractiveUiSetup(port?: number): Promise<void> {
  if (!process.stdin.isTTY) {
    log.info("Interactive UI setup requires a TTY.");
    return;
  }

  const choices = [
    {
      value: "web",
      name: port
        ? "Install web UI bundle and open in browser"
        : "Install web UI bundle (for browser mode)",
    },
    {
      value: "desktop",
      name: port ? "Install desktop app and open it" : "Install desktop app",
    },
    {
      value: "browser",
      name: port
        ? "Open browser only (no install)"
        : "Skip install (browser will require UI assets)",
    },
    {
      value: "skip",
      name: "Skip",
    },
  ];

  const selection = await select({
    message: "UI setup",
    choices,
    default: "web",
  });

  if (selection === "skip") return;

  if (selection === "browser") {
    if (typeof port === "number") {
      openBrowser(`http://localhost:${port}`);
    } else {
      log.info("Run openkit to start the server, then open the URL in your browser.");
    }
    return;
  }

  if (selection === "desktop") {
    await installDesktopApp(port);
    return;
  }

  if (selection === "web") {
    const installed = await installWebUiBundle();
    log.success(`Installed web UI ${installed.tag} at ${installed.path}`);
    if (typeof port === "number") {
      openBrowser(`http://localhost:${port}`);
    }
  }
}

export async function runUiSetupFlow(port?: number): Promise<void> {
  try {
    await runInteractiveUiSetup(port);
  } catch (err) {
    if ((err as { name?: string })?.name === "ExitPromptError") {
      log.plain("");
      return;
    }
    throw err;
  }
}

function printUiHelp(): void {
  log.plain(`${APP_NAME} ui — manage optional UI components

Usage:
  openkit ui
  openkit ui status
  openkit ui install web
  openkit ui install desktop
  openkit ui install both

Notes:
  - "openkit ui" runs an interactive setup flow.
  - Downloaded web UI bundles are stored under ~/.openkit/components/web/.
  - Desktop app installs currently use macOS DMG flow.`);
}

export async function runUiCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printUiHelp();
    return;
  }

  const [subcommand, arg] = args;

  if (!subcommand) {
    await runUiSetupFlow();
    return;
  }

  if (subcommand === "status") {
    printUiStatus();
    return;
  }

  if (subcommand === "install") {
    const target = (arg ?? "web").toLowerCase();
    if (target === "web") {
      const installed = await installWebUiBundle();
      log.success(`Installed web UI ${installed.tag} at ${installed.path}`);
      return;
    }
    if (target === "desktop") {
      await installDesktopApp();
      return;
    }
    if (target === "both" || target === "all") {
      const installed = await installWebUiBundle();
      log.success(`Installed web UI ${installed.tag} at ${installed.path}`);
      await installDesktopApp();
      return;
    }
    log.error(`Unknown install target "${target}". Use web, desktop, or both.`);
    process.exit(1);
  }

  log.error(`Unknown ui subcommand "${subcommand}".`);
  printUiHelp();
  process.exit(1);
}
