import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME } from "../../constants";
import type { DataLifecycleConfig, LinearCredentials, LinearProjectConfig } from "./types";

const INTEGRATIONS_FILE = "integrations.json";

function readIntegrations(configDir: string): Record<string, unknown> {
  const filePath = path.join(configDir, CONFIG_DIR_NAME, INTEGRATIONS_FILE);
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function writeIntegrations(configDir: string, data: Record<string, unknown>): void {
  const filePath = path.join(configDir, CONFIG_DIR_NAME, INTEGRATIONS_FILE);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

export function loadLinearCredentials(configDir: string): LinearCredentials | null {
  const linear = readIntegrations(configDir).linear as Record<string, unknown> | undefined;
  if (!linear?.apiKey) return null;
  return linear as unknown as LinearCredentials;
}

export function saveLinearCredentials(configDir: string, creds: LinearCredentials): void {
  const data = readIntegrations(configDir);
  data.linear = { ...(data.linear as Record<string, unknown>), ...creds };
  writeIntegrations(configDir, data);
}

export function loadLinearProjectConfig(configDir: string): LinearProjectConfig {
  const linear = readIntegrations(configDir).linear as Record<string, unknown> | undefined;
  if (!linear) return {};
  return {
    defaultTeamKey: linear.defaultTeamKey as string | undefined,
    refreshIntervalMinutes: linear.refreshIntervalMinutes as number | undefined,
    dataLifecycle: linear.dataLifecycle as DataLifecycleConfig | undefined,
    autoStartAgent: linear.autoStartAgent as LinearProjectConfig["autoStartAgent"] | undefined,
    autoStartClaudeOnNewIssue: linear.autoStartClaudeOnNewIssue as boolean | undefined,
    autoStartClaudeSkipPermissions: linear.autoStartClaudeSkipPermissions as boolean | undefined,
    autoStartClaudeFocusTerminal: linear.autoStartClaudeFocusTerminal as boolean | undefined,
  };
}

export function saveLinearProjectConfig(configDir: string, config: LinearProjectConfig): void {
  const data = readIntegrations(configDir);
  data.linear = { ...(data.linear as Record<string, unknown>), ...config };
  writeIntegrations(configDir, data);
}
