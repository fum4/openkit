import { useCallback, useEffect, useState } from "react";

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
  localAutoStartClaudeOnNewIssue?: boolean;
  localAutoStartClaudeSkipPermissions?: boolean;
  localAutoStartClaudeFocusTerminal?: boolean;
  openProjectTarget?: string;
  allowAgentCommits?: boolean;
  allowAgentPushes?: boolean;
  allowAgentPRs?: boolean;
  activity?: {
    retentionDays?: number;
    categories?: Record<string, boolean>;
    disabledEvents?: string[];
    toastEvents?: string[];
    osNotificationEvents?: string[];
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
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    setIsLoading(true);
    fetchConfig();
  }, [fetchConfig]);

  return { config, projectName, hasBranchNameRule, isLoading, refetch: fetchConfig };
}

// Re-export API functions that components use directly
export { saveConfig, setupJira, updateJiraConfig, disconnectJira } from "./api";
