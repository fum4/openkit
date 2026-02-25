import { execFile, execFileSync } from "child_process";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import os from "os";
import path from "path";

import { confirm } from "@inquirer/prompts";
import pc from "picocolors";

import { log } from "@openkit/shared/logger";

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  assets: GithubAsset[];
}

const OPENKIT_RELEASES_API_URL =
  process.env.OPENKIT_RELEASES_API_URL ??
  "https://api.github.com/repos/fum4/openkit/releases/latest";

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf-8", timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

function spinner(message: string): { stop: (finalMessage?: string) => void } {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;

  const id = setInterval(() => {
    process.stderr.write(`\r${pc.cyan(frames[i++ % frames.length])} ${message}`);
  }, 80);

  return {
    stop(finalMessage?: string) {
      clearInterval(id);
      process.stderr.write(`\r${" ".repeat(message.length + 4)}\r`);
      if (finalMessage) log.success(finalMessage);
    },
  };
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

function findDmgAsset(release: GithubRelease): GithubAsset | null {
  const arch = process.arch; // "arm64" or "x64"
  const archSuffix = arch === "arm64" ? "arm64" : "x64";

  return (
    release.assets.find((a) => a.name.endsWith(".dmg") && a.name.includes(archSuffix)) ??
    // Fallback: any DMG if arch-specific not found
    release.assets.find((a) => a.name.endsWith(".dmg")) ??
    null
  );
}

async function downloadDmg(url: string, dest: string): Promise<void> {
  await exec("curl", ["-L", "-o", dest, url]);
}

async function installFromDmg(dmgPath: string): Promise<string> {
  const mountPoint = `/tmp/OpenKit-mount-${process.pid}`;

  try {
    // Mount DMG
    await exec("hdiutil", ["attach", dmgPath, "-nobrowse", "-quiet", "-mountpoint", mountPoint]);

    // Find the .app inside the mount
    const { stdout } = await exec("ls", [mountPoint]);
    const appName = stdout
      .trim()
      .split("\n")
      .find((f) => f.endsWith(".app"));

    if (!appName) {
      throw new Error("No .app found in DMG");
    }

    const sourcePath = path.join(mountPoint, appName);

    // Try /Applications first, fallback to ~/Applications
    let targetDir = "/Applications";
    try {
      execFileSync("cp", ["-R", sourcePath, targetDir + "/"], { timeout: 30_000 });
    } catch {
      targetDir = path.join(os.homedir(), "Applications");
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
      execFileSync("cp", ["-R", sourcePath, targetDir + "/"], { timeout: 30_000 });
    }

    return path.join(targetDir, appName);
  } finally {
    // Always cleanup: detach mount
    try {
      execFileSync("hdiutil", ["detach", mountPoint, "-quiet"], { timeout: 10_000 });
    } catch {
      /* best effort */
    }
  }
}

export async function installDesktopApp(port?: number): Promise<boolean> {
  try {
    // 1. Fetch latest release
    const s1 = spinner("Fetching latest release...");
    let release: GithubRelease;
    try {
      release = await fetchLatestRelease();
      s1.stop("Found latest release");
    } catch (err) {
      s1.stop();
      log.error(`Failed to fetch release: ${err instanceof Error ? err.message : err}`);
      return false;
    }

    // 2. Find DMG asset
    const asset = findDmgAsset(release);
    if (!asset) {
      log.error("No DMG found in the latest release for your architecture.");
      return false;
    }

    // 3. Download DMG
    const dmgPath = `/tmp/OpenKit-install-${process.pid}.dmg`;
    const s2 = spinner(`Downloading ${asset.name}...`);
    try {
      await downloadDmg(asset.browser_download_url, dmgPath);
      s2.stop(`Downloaded ${asset.name}`);
    } catch (err) {
      s2.stop();
      log.error(`Download failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }

    // 4. Install from DMG
    const s3 = spinner("Installing...");
    let appPath: string;
    try {
      appPath = await installFromDmg(dmgPath);
      s3.stop(`Installed to ${appPath}`);
    } catch (err) {
      s3.stop();
      log.error(`Installation failed: ${err instanceof Error ? err.message : err}`);
      return false;
    } finally {
      // Cleanup temp DMG
      try {
        unlinkSync(dmgPath);
      } catch {
        /* best effort */
      }
    }

    // 5. Open the app
    if (typeof port === "number") {
      log.info("Opening app...");
      execFile("open", [`OpenKit://open?port=${port}`], (err) => {
        if (err) {
          // Fallback: open the app bundle directly
          execFile("open", ["-a", appPath, "--args", "--port", String(port)], () => {});
        }
      });
    } else {
      log.success("Desktop app installed");
    }

    return true;
  } catch (err) {
    // Catch-all: inquirer cancellation (Ctrl+C) or unexpected errors
    if ((err as { name?: string })?.name === "ExitPromptError") {
      log.plain("");
      return false;
    }
    log.error(`Unexpected error: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export async function promptAndInstallApp(port: number): Promise<boolean> {
  try {
    log.plain("");
    const shouldInstall = await confirm({
      message: "Desktop app not found. Install it?",
      default: true,
    });

    if (!shouldInstall) return false;
    log.plain("");
    return await installDesktopApp(port);
  } catch (err) {
    if ((err as { name?: string })?.name === "ExitPromptError") {
      log.plain("");
      return false;
    }
    log.error(`Unexpected error: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
