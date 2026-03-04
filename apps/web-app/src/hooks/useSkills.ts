import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import type { ClaudeAgentDetail, ClaudeAgentSummary } from "../types";
import {
  fetchSkills,
  fetchSkill,
  fetchClaudePlugins,
  fetchClaudeAgents,
  fetchCustomClaudeAgents,
  fetchClaudePluginDetail,
  fetchClaudeAgentDetail,
  fetchCustomClaudeAgentDetail,
  fetchAvailablePlugins,
  fetchSkillDeploymentStatus,
} from "./api";
import { useServerUrlOptional } from "../contexts/ServerContext";

type AgentScope = "user" | "project" | "local";
type CustomScope = "global" | "project";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAgentScope(value: unknown): AgentScope {
  return value === "user" || value === "project" || value === "local" ? value : "local";
}

function normalizeCustomScope(value: unknown): CustomScope | undefined {
  return value === "global" || value === "project" ? value : undefined;
}

function normalizeDeployments(
  value: unknown,
): Record<string, { global?: boolean; project?: boolean }> {
  if (!isRecord(value)) return {};

  const deployments: Record<string, { global?: boolean; project?: boolean }> = {};
  for (const [agentId, rawStatus] of Object.entries(value)) {
    if (!isRecord(rawStatus)) continue;
    const global = rawStatus.global === true;
    const project = rawStatus.project === true;
    deployments[agentId] = {
      ...(global ? { global: true } : {}),
      ...(project ? { project: true } : {}),
    };
  }
  return deployments;
}

function normalizeAgentSummary(raw: unknown): ClaudeAgentSummary | null {
  if (!isRecord(raw)) return null;

  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return null;

  const isCustom = raw.isCustom === true || id.startsWith("custom::");
  const pluginName =
    typeof raw.pluginName === "string" ? raw.pluginName : isCustom ? "Custom" : "Unknown";

  const normalized: ClaudeAgentSummary = {
    id,
    name: typeof raw.name === "string" ? raw.name : id,
    description: typeof raw.description === "string" ? raw.description : "",
    pluginId: typeof raw.pluginId === "string" ? raw.pluginId : isCustom ? "custom" : "unknown",
    pluginName,
    pluginScope: normalizeAgentScope(raw.pluginScope),
    pluginEnabled: raw.pluginEnabled === true,
    marketplace: typeof raw.marketplace === "string" ? raw.marketplace : "local",
    ...(isCustom ? { isCustom: true } : {}),
  };

  const customScope = normalizeCustomScope(raw.customScope);
  if (customScope) normalized.customScope = customScope;
  if (isRecord(raw.deployments)) {
    normalized.deployments = normalizeDeployments(raw.deployments);
  }

  return normalized;
}

function normalizeAgentList(input: unknown): ClaudeAgentSummary[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => normalizeAgentSummary(item))
    .filter((item): item is ClaudeAgentSummary => item !== null);
}

function normalizeAgentDetail(raw: unknown): ClaudeAgentDetail | null {
  const summary = normalizeAgentSummary(raw);
  if (!summary || !isRecord(raw)) return null;
  return {
    ...summary,
    installPath: typeof raw.installPath === "string" ? raw.installPath : "",
    agentPath: typeof raw.agentPath === "string" ? raw.agentPath : "",
    content: typeof raw.content === "string" ? raw.content : "",
  };
}

interface ClaudeAgentsCachePayload {
  agents: ClaudeAgentSummary[];
  cliAvailable?: boolean;
}

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

export function useClaudeAgents() {
  const serverUrl = useServerUrlOptional();
  const storageKey = serverUrl
    ? `OpenKit:claudeAgentsCache:${serverUrl}`
    : "OpenKit:claudeAgentsCache";
  const fallbackStorageKey = "OpenKit:claudeAgentsCache:lastKnown";

  const readCache = (key: string): ClaudeAgentsCachePayload | undefined => {
    if (typeof window === "undefined") return undefined;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as ClaudeAgentsCachePayload;
      return {
        agents: normalizeAgentList(parsed.agents),
        cliAvailable: parsed.cliAvailable === true,
      };
    } catch {
      return undefined;
    }
  };

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["claudeAgents", serverUrl],
    queryFn: async () => {
      const [pluginAgents, customAgents] = await Promise.all([
        fetchClaudeAgents(serverUrl),
        fetchCustomClaudeAgents(serverUrl),
      ]);

      const combinedAgents = normalizeAgentList([
        ...(pluginAgents.agents ?? []),
        ...(customAgents.agents ?? []),
      ]).sort((a, b) => {
        if (a.pluginEnabled !== b.pluginEnabled) return a.pluginEnabled ? -1 : 1;
        const pluginCmp = a.pluginName.localeCompare(b.pluginName);
        if (pluginCmp !== 0) return pluginCmp;
        return a.name.localeCompare(b.name);
      });

      if (pluginAgents.error && customAgents.error) {
        throw new Error(pluginAgents.error ?? customAgents.error ?? "Failed to fetch agents");
      }

      return {
        agents: combinedAgents,
        cliAvailable: pluginAgents.cliAvailable ?? false,
      };
    },
    initialData: () => {
      return readCache(storageKey) ?? readCache(fallbackStorageKey);
    },
    enabled: serverUrl !== null,
    // Keep cached data visible immediately, then refresh in background.
    staleTime: 60_000,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ agents: data.agents ?? [], cliAvailable: !!data.cliAvailable }),
      );
      window.localStorage.setItem(
        fallbackStorageKey,
        JSON.stringify({ agents: data.agents ?? [], cliAvailable: !!data.cliAvailable }),
      );
    } catch {
      // Ignore localStorage failures.
    }
  }, [data, fallbackStorageKey, storageKey]);

  return {
    agents: data?.agents ?? [],
    cliAvailable: data?.cliAvailable ?? false,
    isLoading,
    isFetching,
    error: error instanceof Error ? error.message : null,
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

export function useClaudeAgentDetail(id: string | null) {
  const serverUrl = useServerUrlOptional();
  const storageKey =
    serverUrl && id
      ? `OpenKit:claudeAgentDetailCache:${serverUrl}:${id}`
      : id
        ? `OpenKit:claudeAgentDetailCache:${id}`
        : null;

  const readCache = (): ClaudeAgentDetail | null => {
    if (typeof window === "undefined" || !storageKey) return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      return normalizeAgentDetail(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["claudeAgent", serverUrl, id],
    queryFn: async () => {
      if (!id) return null;
      const result = id.startsWith("custom::")
        ? await fetchCustomClaudeAgentDetail(id, serverUrl)
        : await fetchClaudeAgentDetail(id, serverUrl);
      if (result.error) {
        const cached = readCache();
        if (cached) return cached;
        throw new Error(result.error);
      }
      return normalizeAgentDetail(result.agent);
    },
    initialData: () => readCache(),
    enabled: serverUrl !== null && id !== null,
    staleTime: 60_000,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!data || typeof window === "undefined" || !storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {
      // Ignore localStorage failures.
    }
  }, [data, storageKey]);

  return {
    agent: data ?? null,
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
