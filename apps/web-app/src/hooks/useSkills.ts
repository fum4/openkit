import { useQuery } from "@tanstack/react-query";

import {
  fetchSkills,
  fetchSkill,
  fetchClaudePlugins,
  fetchClaudePluginDetail,
  fetchAvailablePlugins,
  fetchSkillDeploymentStatus,
} from "./api";
import { useServerUrlOptional } from "../contexts/ServerContext";

export function useSkills() {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["skills", serverUrl],
    queryFn: async () => {
      const result = await fetchSkills(serverUrl);
      if (result.error) throw new Error(result.error);
      return result.skills;
    },
    enabled: serverUrl !== null,
    staleTime: 5_000,
  });

  return {
    skills: data ?? [],
    isLoading,
    isFetching,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}

export function useSkillDetail(name: string | null) {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["skill", serverUrl, name],
    queryFn: async () => {
      if (!name) return null;
      const result = await fetchSkill(name, serverUrl);
      if (result.error) throw new Error(result.error);
      return result.skill ?? null;
    },
    enabled: serverUrl !== null && name !== null,
    staleTime: 5_000,
  });

  return {
    skill: data ?? null,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}

export function useSkillDeploymentStatus() {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["skillDeploymentStatus", serverUrl],
    queryFn: () => fetchSkillDeploymentStatus(serverUrl),
    enabled: serverUrl !== null,
    staleTime: 5_000,
  });

  return {
    status: data?.status ?? {},
    isLoading,
    refetch,
  };
}

export function useClaudePlugins() {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["claudePlugins", serverUrl],
    queryFn: () => fetchClaudePlugins(serverUrl),
    enabled: serverUrl !== null,
    staleTime: 5_000,
  });

  return {
    plugins: data?.plugins ?? [],
    cliAvailable: data?.cliAvailable ?? false,
    isLoading,
    isFetching,
    refetch,
  };
}

export function useClaudePluginDetail(id: string | null) {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["claudePlugin", serverUrl, id],
    queryFn: async () => {
      if (!id) return null;
      const result = await fetchClaudePluginDetail(id, serverUrl);
      if (result.error) throw new Error(result.error);
      return result.plugin ?? null;
    },
    enabled: serverUrl !== null && id !== null,
    staleTime: 5_000,
  });

  return {
    plugin: data ?? null,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}

export function useAvailablePlugins(enabled: boolean) {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["availablePlugins", serverUrl],
    queryFn: async () => {
      const result = await fetchAvailablePlugins(serverUrl);
      if (result.error) throw new Error(result.error);
      return result.available;
    },
    enabled: serverUrl !== null && enabled,
    staleTime: 60_000,
  });

  return {
    available: data ?? [],
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}
