import { useQuery } from "@tanstack/react-query";

import { useApi } from "./useApi";

export function useAgentRule(fileId: string) {
  const api = useApi();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["agentRule", fileId],
    queryFn: () => api.fetchAgentRule(fileId),
    staleTime: 30_000,
  });

  return {
    exists: data?.exists ?? false,
    content: data?.content ?? "",
    isLoading,
    refetch,
  };
}
