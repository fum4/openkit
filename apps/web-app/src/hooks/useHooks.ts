import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useServerUrlOptional } from "../contexts/ServerContext";
import {
  fetchHooksConfig as apiFetchConfig,
  fetchEffectiveHooksConfig as apiFetchEffectiveConfig,
  fetchHookSkillResults as apiFetchSkillResults,
  saveHooksConfig as apiSaveConfig,
  type SkillHookResult,
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
    } catch {
      // Ignore
    }
  }, [serverUrl, worktreeId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return { config, refetch: fetchConfig };
}

export function useHookSkillResults(worktreeId: string | null) {
  const serverUrl = useServerUrlOptional();
  const [results, setResults] = useState<SkillHookResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchResults = useCallback(async () => {
    if (serverUrl === null || !worktreeId) {
      setResults([]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await apiFetchSkillResults(worktreeId, serverUrl);
      setResults(data.results);
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  }, [serverUrl, worktreeId]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  // Poll while any skill is in 'running' state
  useEffect(() => {
    const hasRunning = results.some((r) => r.status === "running");
    if (!hasRunning) return;
    const interval = setInterval(fetchResults, 2000);
    return () => clearInterval(interval);
  }, [results, fetchResults]);

  return { results, isLoading, refetch: fetchResults };
}
