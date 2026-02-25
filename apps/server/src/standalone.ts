#!/usr/bin/env node

import { existsSync, readFileSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME, DEFAULT_PORT } from "@openkit/shared/constants";
import { loadGlobalPreferences } from "@openkit/shared/global-preferences";
import { log } from "@openkit/shared/logger";
import type { WorktreeConfig } from "@openkit/shared/worktree-types";

import { startWorktreeServer } from "./index";

const CONFIG_FILE_NAME = "config.json";

interface ConfigFile {
  projectDir?: string;
  startCommand?: string;
  installCommand?: string;
  baseBranch?: string;
  ports?: {
    discovered?: number[];
    offsetStep?: number;
  };
  envMapping?: Record<string, string>;
  autoInstall?: boolean;
  localIssuePrefix?: string;
  localAutoStartAgent?: "claude" | "codex" | "gemini" | "opencode";
  localAutoStartClaudeOnNewIssue?: boolean;
  localAutoStartClaudeSkipPermissions?: boolean;
  localAutoStartClaudeFocusTerminal?: boolean;
  openProjectTarget?: WorktreeConfig["openProjectTarget"];
}

function isInsideWorktree(configPath: string): boolean {
  const normalized = configPath.replace(/\\/g, "/");
  return normalized.includes(`${CONFIG_DIR_NAME}/worktrees/`);
}

function findConfigFile(): string | null {
  let currentDir = process.cwd();
  const { root } = path.parse(currentDir);

  while (currentDir !== root) {
    const configPath = path.join(currentDir, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
    if (existsSync(configPath) && !isInsideWorktree(configPath)) {
      return configPath;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

function parsePortArg(args: string[]): number | null {
  const equalsArg = args.find((arg) => arg.startsWith("--port="));
  if (equalsArg) {
    const value = Number.parseInt(equalsArg.split("=")[1] ?? "", 10);
    return Number.isFinite(value) ? value : null;
  }

  const index = args.findIndex((arg) => arg === "--port" || arg === "-p");
  if (index === -1) return null;

  const value = Number.parseInt(args[index + 1] ?? "", 10);
  return Number.isFinite(value) ? value : null;
}

function loadConfig(): { config: WorktreeConfig; configPath: string | null } {
  const configPath = findConfigFile();

  const defaults: WorktreeConfig = {
    projectDir: ".",
    startCommand: "",
    installCommand: "",
    baseBranch: "origin/main",
    ports: {
      discovered: [],
      offsetStep: 1,
    },
    autoInstall: true,
    localIssuePrefix: "LOCAL",
    localAutoStartAgent: "claude",
    localAutoStartClaudeOnNewIssue: false,
    localAutoStartClaudeSkipPermissions: true,
    localAutoStartClaudeFocusTerminal: true,
  };

  if (!configPath) {
    log.warn(`No ${CONFIG_DIR_NAME}/${CONFIG_FILE_NAME} found, using defaults`);
    return { config: defaults, configPath: null };
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const fileConfig: ConfigFile = JSON.parse(content);
    const configDir = path.dirname(path.dirname(configPath));
    if (configDir !== process.cwd()) {
      process.chdir(configDir);
    }

    const config: WorktreeConfig = {
      projectDir: fileConfig.projectDir ?? defaults.projectDir,
      startCommand: fileConfig.startCommand ?? defaults.startCommand,
      installCommand: fileConfig.installCommand ?? defaults.installCommand,
      baseBranch: fileConfig.baseBranch ?? defaults.baseBranch,
      ports: {
        discovered: fileConfig.ports?.discovered ?? defaults.ports.discovered,
        offsetStep: fileConfig.ports?.offsetStep ?? defaults.ports.offsetStep,
      },
      envMapping: fileConfig.envMapping,
      autoInstall: fileConfig.autoInstall ?? defaults.autoInstall,
      localIssuePrefix: fileConfig.localIssuePrefix ?? defaults.localIssuePrefix,
      localAutoStartAgent: fileConfig.localAutoStartAgent ?? defaults.localAutoStartAgent,
      localAutoStartClaudeOnNewIssue:
        fileConfig.localAutoStartClaudeOnNewIssue ?? defaults.localAutoStartClaudeOnNewIssue,
      localAutoStartClaudeSkipPermissions:
        fileConfig.localAutoStartClaudeSkipPermissions ??
        defaults.localAutoStartClaudeSkipPermissions,
      localAutoStartClaudeFocusTerminal:
        fileConfig.localAutoStartClaudeFocusTerminal ?? defaults.localAutoStartClaudeFocusTerminal,
      openProjectTarget: fileConfig.openProjectTarget,
    };

    return { config, configPath };
  } catch (error) {
    log.error(`Failed to load config from ${configPath}:`, error);
    return { config: defaults, configPath: null };
  }
}

function printHelp() {
  log.plain(`OpenKit server standalone

Usage:
  pnpm start
  pnpm start -- --port 7070

Options:
  --port, -p <number>  Preferred starting port
  --help, -h           Show this help`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const { config, configPath } = loadConfig();
  const globalPrefs = loadGlobalPreferences();
  const portArg = parsePortArg(args);
  const portFromEnv = process.env.OPENKIT_SERVER_PORT
    ? Number.parseInt(process.env.OPENKIT_SERVER_PORT, 10)
    : undefined;
  const requestedPort =
    portArg ??
    (Number.isFinite(portFromEnv) ? (portFromEnv as number) : undefined) ??
    globalPrefs.basePort ??
    DEFAULT_PORT;

  await startWorktreeServer(config, configPath, { port: requestedPort });
}

main().catch((error) => {
  log.error("Failed to start standalone server:", error);
  process.exit(1);
});
