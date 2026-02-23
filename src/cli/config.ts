import { existsSync, readFileSync } from "fs";
import path from "path";

import { APP_NAME, CONFIG_DIR_NAME } from "../constants";
import { log } from "../logger";
import type { PortConfig, WorktreeConfig } from "../server/types";

export { CONFIG_DIR_NAME };
export const CONFIG_FILE_NAME = "config.json";

export interface ConfigFile {
  projectDir?: string;
  startCommand?: string;
  installCommand?: string;
  baseBranch?: string;
  ports?: Partial<PortConfig>;
  envMapping?: Record<string, string>;
  autoInstall?: boolean;
  localIssuePrefix?: string;
  localAutoStartAgent?: "claude" | "codex" | "gemini" | "opencode";
  localAutoStartClaudeOnNewIssue?: boolean;
  localAutoStartClaudeSkipPermissions?: boolean;
  localAutoStartClaudeFocusTerminal?: boolean;
  openProjectTarget?: WorktreeConfig["openProjectTarget"];
}

/**
 * Check if a path is inside a OpenKit worktree directory.
 * Worktrees are stored at .openkit/worktrees/<name>/, so any config found
 * inside such a path belongs to the worktree's checkout, not the main project.
 */
function isInsideWorktree(configPath: string): boolean {
  // Normalize and check if path contains .openkit/worktrees/
  const normalized = configPath.replace(/\\/g, "/");
  return normalized.includes(`${CONFIG_DIR_NAME}/worktrees/`);
}

export function findConfigFile(): string | null {
  let currentDir = process.cwd();
  const { root } = path.parse(currentDir);

  while (currentDir !== root) {
    const configPath = path.join(currentDir, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
    if (existsSync(configPath)) {
      // Skip configs inside worktree directories - they're checkouts, not the main config
      if (!isInsideWorktree(configPath)) {
        return configPath;
      }
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

export function loadConfig(): { config: WorktreeConfig; configPath: string | null } {
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
    log.info(`Run "${APP_NAME} init" to create a config file`);
    return { config: defaults, configPath: null };
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const fileConfig: ConfigFile = JSON.parse(content);

    const configDir = path.dirname(path.dirname(configPath));
    if (configDir !== process.cwd()) {
      log.info(`Found config at ${configPath}`);
      process.chdir(configDir);
      log.info(`Changed working directory to ${configDir}`);
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

export function findConfigDir(): string | null {
  const configPath = findConfigFile();
  if (!configPath) return null;
  // configPath is like /path/to/project/.openkit/config.json → project dir is two levels up
  return path.dirname(path.dirname(configPath));
}
