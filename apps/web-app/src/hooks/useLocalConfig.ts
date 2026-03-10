import { useCallback, useEffect, useState } from "react";

import { reportPersistentErrorToast } from "../errorToasts";
import { useServerUrlOptional } from "../contexts/ServerContext";
import { fetchLocalConfig as apiFetchLocalConfig } from "./api";

export interface LocalConfig {
  allowAgentCommits?: boolean;
  allowAgentPushes?: boolean;
  allowAgentPRs?: boolean;
  shortcuts?: Record<string, string>;
}

export function useLocalConfig() {
  const serverUrl = useServerUrlOptional();
  const [localConfig, setLocalConfig] = useState<LocalConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLocalConfig = useCallback(async () => {
    if (serverUrl === null) {
      setLocalConfig(null);
      setIsLoading(false);
      return;
    }

    try {
      const data = await apiFetchLocalConfig(serverUrl);
      setLocalConfig(data as LocalConfig);
    } catch (error) {
      reportPersistentErrorToast(error, "Failed to fetch local config", {
        scope: "local-config:fetch",
      });
    } finally {
      setIsLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    setIsLoading(true);
    fetchLocalConfig();
  }, [fetchLocalConfig]);

  return { localConfig, isLoading, refetch: fetchLocalConfig };
}
