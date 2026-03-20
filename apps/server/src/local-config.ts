import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";

import type { WorktreeConfig } from "./types";

const LOCAL_CONFIG_FILE_NAME = "config.local.json";

export interface LocalConfig {
  allowAgentCommits?: boolean;
  allowAgentPushes?: boolean;
  allowAgentPRs?: boolean;
  useNativePortHook?: boolean;
  shortcuts?: Record<string, string>;
  arrowNavEnabled?: boolean;
  autoCleanupOnPrMerge?: boolean;
  autoCleanupOnPrClose?: boolean;
}

function getLocalConfigPath(configDir: string): string {
  return path.join(configDir, CONFIG_DIR_NAME, LOCAL_CONFIG_FILE_NAME);
}

function sanitizeLocalConfig(value: unknown): LocalConfig {
  if (!value || typeof value !== "object") return {};

  const raw = value as Record<string, unknown>;
  const next: LocalConfig = {};
  if (typeof raw.allowAgentCommits === "boolean") {
    next.allowAgentCommits = raw.allowAgentCommits;
  }
  if (typeof raw.allowAgentPushes === "boolean") {
    next.allowAgentPushes = raw.allowAgentPushes;
  }
  if (typeof raw.allowAgentPRs === "boolean") {
    next.allowAgentPRs = raw.allowAgentPRs;
  }
  if (typeof raw.useNativePortHook === "boolean") {
    next.useNativePortHook = raw.useNativePortHook;
  }
  if (typeof raw.arrowNavEnabled === "boolean") {
    next.arrowNavEnabled = raw.arrowNavEnabled;
  }
  if (typeof raw.autoCleanupOnPrMerge === "boolean") {
    next.autoCleanupOnPrMerge = raw.autoCleanupOnPrMerge;
  }
  if (typeof raw.autoCleanupOnPrClose === "boolean") {
    next.autoCleanupOnPrClose = raw.autoCleanupOnPrClose;
  }
  if (raw.shortcuts && typeof raw.shortcuts === "object") {
    const shortcuts: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw.shortcuts as Record<string, unknown>)) {
      if (typeof val === "string") shortcuts[key] = val;
    }
    if (Object.keys(shortcuts).length > 0) next.shortcuts = shortcuts;
  }
  return next;
}

const DEFAULT_SHORTCUTS: Record<string, string> = {
  "project-tab": "meta",
  "nav-worktrees": "meta+w",
  "nav-issues": "meta+i",
  "nav-agents": "meta+a",
  "nav-activity": "meta+l",
  "nav-integrations": "meta+e",
  "nav-settings": "meta+s",
};

export function ensureLocalConfigDefaults(configDir: string): void {
  const current = loadLocalConfig(configDir);
  let needsWrite = false;

  if (current.allowAgentCommits === undefined) {
    current.allowAgentCommits = false;
    needsWrite = true;
  }
  if (current.allowAgentPushes === undefined) {
    current.allowAgentPushes = false;
    needsWrite = true;
  }
  if (current.allowAgentPRs === undefined) {
    current.allowAgentPRs = false;
    needsWrite = true;
  }
  if (current.arrowNavEnabled === undefined) {
    current.arrowNavEnabled = true;
    needsWrite = true;
  }
  if (current.autoCleanupOnPrMerge === undefined) {
    current.autoCleanupOnPrMerge = false;
    needsWrite = true;
  }
  if (current.autoCleanupOnPrClose === undefined) {
    current.autoCleanupOnPrClose = false;
    needsWrite = true;
  }
  if (!current.shortcuts) {
    current.shortcuts = { ...DEFAULT_SHORTCUTS };
    needsWrite = true;
  } else {
    for (const [key, val] of Object.entries(DEFAULT_SHORTCUTS)) {
      if (!(key in current.shortcuts)) {
        current.shortcuts[key] = val;
        needsWrite = true;
      }
    }
  }

  if (needsWrite) {
    const configDirPath = path.join(configDir, CONFIG_DIR_NAME);
    if (!existsSync(configDirPath)) {
      mkdirSync(configDirPath, { recursive: true });
    }
    writeFileSync(getLocalConfigPath(configDir), JSON.stringify(current, null, 2) + "\n");
  }
}

export function loadLocalConfig(configDir: string): LocalConfig {
  const localConfigPath = getLocalConfigPath(configDir);
  if (!existsSync(localConfigPath)) return {};

  try {
    return sanitizeLocalConfig(JSON.parse(readFileSync(localConfigPath, "utf-8")));
  } catch {
    return {};
  }
}

export function loadLocalGitPolicyConfig(
  configDir: string,
): Required<Pick<WorktreeConfig, "allowAgentCommits" | "allowAgentPushes" | "allowAgentPRs">> {
  const local = loadLocalConfig(configDir);
  return {
    allowAgentCommits: local.allowAgentCommits === true,
    allowAgentPushes: local.allowAgentPushes === true,
    allowAgentPRs: local.allowAgentPRs === true,
  };
}

export function updateLocalConfig(configDir: string, updates: Partial<LocalConfig>): void {
  const configDirPath = path.join(configDir, CONFIG_DIR_NAME);
  if (!existsSync(configDirPath)) {
    mkdirSync(configDirPath, { recursive: true });
  }

  const current = loadLocalConfig(configDir);
  const next = {
    ...current,
    ...updates,
  };

  writeFileSync(getLocalConfigPath(configDir), JSON.stringify(next, null, 2) + "\n");
}
