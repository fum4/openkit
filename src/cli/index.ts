#!/usr/bin/env node

import { execFile, execFileSync, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { APP_NAME, CONFIG_DIR_NAME } from "../constants";
import { log } from "../logger";
import { loadGlobalPreferences } from "../shared/global-preferences";
import { startWorktreeServer } from "../server/index";
import { findConfigFile, loadConfig } from "./config";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const LOCK_FILE = path.join(os.homedir(), CONFIG_DIR_NAME, "electron.lock");

function findElectron():
  | { type: "app"; appPath: string }
  | { type: "dev"; electronBin: string; projectRoot: string }
  | null {
  if (process.platform !== "darwin") return null;

  // 1. Check for installed .app bundle
  try {
    const result = execFileSync("mdfind", ['kMDItemCFBundleIdentifier == "com.dawg.app"'], {
      encoding: "utf-8",
      timeout: 3000,
    });
    const appPath = result.trim().split("\n")[0];
    if (appPath && existsSync(appPath)) {
      return { type: "app", appPath };
    }
  } catch {
    /* ignore */
  }

  // 2. Check for electron binary in the dawg project's node_modules
  //    (dev mode — cliDir is dist/cli or src/cli)
  const projectRoot = path.resolve(cliDir, "..", "..");
  const electronBin = path.join(projectRoot, "node_modules", ".bin", "electron");
  const electronMain = path.join(projectRoot, "dist", "electron", "main.js");
  if (existsSync(electronBin) && existsSync(electronMain)) {
    return { type: "dev", electronBin, projectRoot };
  }

  return null;
}

async function openUI(port: number): Promise<void> {
  const electron = findElectron();

  if (electron?.type === "app") {
    log.info("Opening in app...");
    execFile("open", [`dawg://open?port=${port}`], (err) => {
      if (err) {
        log.info("Falling back to browser...");
        openBrowser(`http://localhost:${port}`);
      }
    });
  } else if (electron?.type === "dev") {
    log.info("Opening in electron (dev)...");
    const child = spawn(electron.electronBin, [electron.projectRoot, "--port", String(port)], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } else if (process.stdin.isTTY) {
    const { promptAndInstallApp } = await import("./install-app");
    const installed = await promptAndInstallApp(port);
    if (!installed) {
      log.info(`Server running at http://localhost:${port}`);
    }
  } else {
    log.info(`Server running at http://localhost:${port}`);
  }
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(cmd, [url], () => {});
}

function isElectronRunning(): boolean {
  try {
    if (!existsSync(LOCK_FILE)) return false;
    const data = JSON.parse(readFileSync(LOCK_FILE, "utf-8"));
    // Check if the process is still running
    if (data.pid) {
      try {
        process.kill(data.pid, 0); // Signal 0 = check if process exists
        return true;
      } catch {
        return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function openProjectInElectron(projectDir: string): void {
  const encodedDir = encodeURIComponent(projectDir);
  const url = `dawg://open-project?dir=${encodedDir}`;

  if (process.platform === "darwin") {
    execFile("open", [url], (err) => {
      if (err) {
        log.error("Failed to open in Electron:", err.message);
      }
    });
  } else {
    // On other platforms, try xdg-open
    execFile("xdg-open", [url], () => {});
  }
}

function printHelp() {
  log.plain(`${APP_NAME} — git worktree manager with automatic port offsetting

Usage: ${APP_NAME} [command] [options]

Commands:
  (default)     Start the server and open the UI
  init          Interactive setup wizard to create .dawg/config.json
  add [name]    Set up an integration (github, linear, jira)
  mcp           Start as an MCP server (for AI coding agents)
  task [source] [ID...] Create worktrees from issues (jira, linear, local)

Options:
  --no-open     Start the server without opening the UI
  --auto-init   Auto-initialize config if none found
  --help, -h    Show this help message
  --version, -v Show version`);
}

async function main() {
  const subcommand = process.argv[2];

  if (subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }

  if (subcommand === "--version" || subcommand === "-v") {
    log.plain("0.1.0");
    return;
  }

  if (subcommand === "init") {
    const { runInit } = await import("./init");
    await runInit();
    return;
  }

  if (subcommand === "add") {
    const { runAdd } = await import("./add");
    await runAdd();
    return;
  }

  if (subcommand === "mcp") {
    // MCP uses stdout for JSON-RPC — redirect console.log to stderr
    // BEFORE anything else runs (loadConfig logs to stdout)
    console.log = console.error;

    const { config, configPath } = loadConfig();
    const { startMcpServer } = await import("../mcp");
    await startMcpServer(config, configPath);
    return;
  }

  if (subcommand === "task") {
    const args = process.argv.slice(3).filter((arg) => !arg.startsWith("--"));
    const { runTask, runTaskInteractive } = await import("./task");
    const sources = ["jira", "linear", "local"];

    if (args.length === 0) {
      await runTaskInteractive();
      return;
    }

    const first = args[0].toLowerCase();
    if (sources.includes(first)) {
      const source = first as "jira" | "linear" | "local";
      const ids = args.slice(1);
      if (ids.length === 0) {
        log.error(`Usage: ${APP_NAME} task ${source} <ID> [ID...]`);
        process.exit(1);
      }
      await runTask(source, ids, ids.length > 1);
    } else {
      log.error(`Unknown source "${args[0]}". Use: ${APP_NAME} task <jira|linear|local> <ID>`);
      process.exit(1);
    }
    return;
  }

  const noOpen = process.argv.includes("--no-open") || process.env.DAWG_NO_OPEN === "1";
  const autoInit = process.argv.includes("--auto-init") || process.env.DAWG_AUTO_INIT === "1";
  const projectDir = process.cwd();

  // Determine port: DAWG_PORT env override → global preferences → default
  const globalPrefs = loadGlobalPreferences();
  const basePort = process.env.DAWG_PORT
    ? parseInt(process.env.DAWG_PORT, 10)
    : globalPrefs.basePort;

  log.info("Starting...");

  // Check if Electron app is already running
  // If so, open this project as a new tab instead of starting a new server
  if (!noOpen && isElectronRunning()) {
    log.info("Electron app is already running.");
    log.info("Opening project in existing window...");
    openProjectInElectron(projectDir);
    return;
  }

  // Auto-run init if no config found
  if (!findConfigFile()) {
    if (autoInit) {
      // Auto-initialize with default config for Electron spawned servers
      log.info("No configuration found. Auto-initializing...");
      const { autoInitConfig } = await import("./init");
      await autoInitConfig(projectDir);
    } else if (process.stdin.isTTY) {
      log.info("No configuration found. Starting setup wizard...");
      log.plain("");
      const { runInit } = await import("./init");
      await runInit();
    } else {
      // Non-interactive (e.g. spawned from Electron) — proceed with defaults
      // The frontend will show a setup screen
      log.info("No configuration found. Proceeding with defaults...");
    }
  }

  const { config, configPath } = loadConfig();

  log.info("Configuration:");
  log.plain(`  Project directory: ${config.projectDir}`);
  log.plain(`  Start command: ${config.startCommand || "(not set)"}`);
  log.plain(`  Install command: ${config.installCommand || "(not set)"}`);
  log.plain(`  Base branch: ${config.baseBranch}`);
  log.plain(
    `  Discovered ports: ${config.ports.discovered.length > 0 ? config.ports.discovered.join(", ") : "(none - run discovery)"}`,
  );
  log.plain(`  Offset step: ${config.ports.offsetStep}`);
  const envMappingKeys = config.envMapping ? Object.keys(config.envMapping) : [];
  log.plain(`  Env mappings: ${envMappingKeys.length > 0 ? envMappingKeys.join(", ") : "(none)"}`);
  log.plain(`  Base port: ${basePort}`);
  log.plain("");

  const { port: actualPort } = await startWorktreeServer(config, configPath, { port: basePort });

  if (!noOpen) {
    const url = `http://localhost:${actualPort}`;
    log.plain("");
    log.info(`Opening ${url}`);
    log.plain("");
    await openUI(actualPort);
  }
}

main().catch((error) => {
  log.error("Fatal error:", error);
  process.exit(1);
});
