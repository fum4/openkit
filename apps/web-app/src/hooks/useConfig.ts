import { useCallback, useEffect, useState } from "react";

import { reportPersistentErrorToast } from "../errorToasts";
import { useServerUrlOptional } from "../contexts/ServerContext";
import { fetchConfig as apiFetchConfig } from "./api";

export interface WorktreeConfig {
  projectDir: string;
  startCommand: string;
  installCommand: string;
  baseBranch: string;
  ports: {
    discovered: number[];
    offsetStep: number;
  };
  envMapping?: Record<string, string>;
  autoInstall?: boolean;
  localIssuePrefix?: string;
  localAutoStartAgent?: "claude" | "codex" | "gemini" | "opencode";
  localAutoStartClaudeOnNewIssue?: boolean;
  localAutoStartClaudeSkipPermissions?: boolean;
  localAutoStartClaudeFocusTerminal?: boolean;
  openProjectTarget?: string;
  allowAgentCommits?: boolean;
  allowAgentPushes?: boolean;
  allowAgentPRs?: boolean;
  useNativePortHook?: boolean;
  showDiffStats?: boolean;
  activity?: {
    retentionDays?: number;
    maxSizeMB?: number;
    categories?: Record<string, boolean>;
    disabledEvents?: string[];
    toastEvents?: string[];
    osNotificationEvents?: string[];
  };
  /** Ops log (debug log) configuration */
  opsLog?: {
    retentionDays?: number;
    maxSizeMB?: number;
  };
}

export function useConfig() {
  const serverUrl = useServerUrlOptional();
  const [config, setConfig] = useState<WorktreeConfig | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [hasBranchNameRule, setHasBranchNameRule] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchConfig = useCallback(async () => {
    if (serverUrl === null) {
      setConfig(null);
      setProjectName(null);
      setHasBranchNameRule(false);
      setIsLoading(false);
      return;
    }

    try {
      const data = await apiFetchConfig(serverUrl);
      setConfig(data.config || null);
      setProjectName(data.projectName || null);
      setHasBranchNameRule(data.hasBranchNameRule ?? false);
    } catch (error) {
      reportPersistentErrorToast(error, "Failed to fetch config", { scope: "config:fetch" });
    } finally {
      setIsLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    setIsLoading(true);
    fetchConfig();
  }, [fetchConfig]);

  // Listen for external config file changes pushed via SSE
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.config) setConfig(detail.config);
      if (detail?.projectName !== undefined) setProjectName(detail.projectName);
    };
    window.addEventListener("OpenKit:config-changed", handler);
    return () => window.removeEventListener("OpenKit:config-changed", handler);
  }, []);

  return {
    config,
    projectName,
    hasBranchNameRule,
    isLoading,
    refetch: fetchConfig,
  };
}

// Re-export API functions that components use directly
export { saveConfig, setupJira, updateJiraConfig, disconnectJira } from "./api";
