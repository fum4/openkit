import { useQuery } from "@tanstack/react-query";

import { fetchMcpServers, fetchMcpDeploymentStatus, fetchMcpServer } from "./api";
import { useServerUrlOptional } from "../contexts/ServerContext";

export function useMcpServers(search?: string) {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["mcpServers", serverUrl, search],
    queryFn: async () => {
      const result = await fetchMcpServers(search, serverUrl);
      if (result.error) throw new Error(result.error);
      return result.servers;
    },
    enabled: serverUrl !== null,
    staleTime: 5_000,
  });

  return {
    servers: data ?? [],
    isLoading,
    isFetching,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}

export function useMcpDeploymentStatus() {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["mcpDeploymentStatus", serverUrl],
    queryFn: () => fetchMcpDeploymentStatus(serverUrl),
    enabled: serverUrl !== null,
    staleTime: 5_000,
  });

  return {
    status: data?.status ?? {},
    isLoading,
    refetch,
  };
}

export function useMcpServerDetail(id: string | null) {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["mcpServer", serverUrl, id],
    queryFn: async () => {
      if (!id) return null;
      const result = await fetchMcpServer(id, serverUrl);
      if (result.error) throw new Error(result.error);
      return result.server ?? null;
    },
    enabled: serverUrl !== null && id !== null,
    staleTime: 5_000,
  });

  return {
    server: data ?? null,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}
