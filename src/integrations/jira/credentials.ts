import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME } from "../../constants";
import type { DataLifecycleConfig, JiraCredentials, JiraProjectConfig } from "./types";

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

export function loadJiraCredentials(configDir: string): JiraCredentials | null {
  const jira = readIntegrations(configDir).jira as Record<string, unknown> | undefined;
  if (!jira?.authMethod) return null;
  return jira as unknown as JiraCredentials;
}

export function saveJiraCredentials(configDir: string, creds: JiraCredentials): void {
  const data = readIntegrations(configDir);
  data.jira = { ...(data.jira as Record<string, unknown>), ...creds };
  writeIntegrations(configDir, data);
}

export function loadJiraProjectConfig(configDir: string): JiraProjectConfig {
  const jira = readIntegrations(configDir).jira as Record<string, unknown> | undefined;
  if (!jira) return {};
  return {
    defaultProjectKey: jira.defaultProjectKey as string | undefined,
    refreshIntervalMinutes: jira.refreshIntervalMinutes as number | undefined,
    dataLifecycle: jira.dataLifecycle as DataLifecycleConfig | undefined,
    autoStartAgent: jira.autoStartAgent as JiraProjectConfig["autoStartAgent"] | undefined,
    autoStartClaudeOnNewIssue: jira.autoStartClaudeOnNewIssue as boolean | undefined,
    autoStartClaudeSkipPermissions: jira.autoStartClaudeSkipPermissions as boolean | undefined,
    autoStartClaudeFocusTerminal: jira.autoStartClaudeFocusTerminal as boolean | undefined,
  };
}

export function saveJiraProjectConfig(configDir: string, config: JiraProjectConfig): void {
  const data = readIntegrations(configDir);
  data.jira = { ...(data.jira as Record<string, unknown>), ...config };
  writeIntegrations(configDir, data);
}
