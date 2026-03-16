import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { reportPersistentErrorToast } from "../errorToasts";
import { useServerUrlOptional } from "../contexts/ServerContext";
import {
  fetchHooksConfig as apiFetchConfig,
  fetchEffectiveHooksConfig as apiFetchEffectiveConfig,
  saveHooksConfig as apiSaveConfig,
  type HooksConfig,
} from "./api";

export function useHooksConfig() {
  const serverUrl = useServerUrlOptional();
  const queryClient = useQueryClient();
  const queryKey = ["hooks-config", serverUrl];

  const {
    data: config = null,
    isLoading,
    refetch,
  } = useQuery<HooksConfig>({
    queryKey,
    queryFn: () => apiFetchConfig(serverUrl!),
    enabled: serverUrl !== null,
    staleTime: 30_000,
  });

  const saveConfig = useCallback(
    async (newConfig: HooksConfig) => {
      if (serverUrl === null) return;
      const result = await apiSaveConfig(newConfig, serverUrl);
      if (result.success && result.config) {
        queryClient.setQueryData(queryKey, result.config);
      }
      return result;
    },
    [serverUrl, queryClient],
  );

  return { config, isLoading, refetch, saveConfig };
}

export function useEffectiveHooksConfig(worktreeId: string | null) {
  const serverUrl = useServerUrlOptional();
  const [config, setConfig] = useState<HooksConfig | null>(null);

  const fetchConfig = useCallback(async () => {
    if (serverUrl === null || !worktreeId) {
      setConfig(null);
      return;
    }
    try {
      const data = await apiFetchEffectiveConfig(worktreeId, serverUrl);
      setConfig(data);
    } catch (error) {
      reportPersistentErrorToast(error, "Failed to fetch effective hooks config", {
        scope: "hooks:effective-config",
      });
    }
  }, [serverUrl, worktreeId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return { config, refetch: fetchConfig };
}
