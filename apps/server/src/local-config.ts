import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";

import type { WorktreeConfig } from "./types";

const LOCAL_CONFIG_FILE_NAME = "local-config.json";

export interface LocalConfig {
  allowAgentCommits?: boolean;
  allowAgentPushes?: boolean;
  allowAgentPRs?: boolean;
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
  return next;
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
