import { useQuery } from "@tanstack/react-query";

import { useApi } from "./useApi";
import { useFileChangeEvent } from "./useFileChangeEvent";

export function useAgentRule(fileId: string) {
  const api = useApi();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["agentRule", fileId],
    queryFn: () => api.fetchAgentRule(fileId),
    staleTime: 30_000,
  });

  useFileChangeEvent("agent-rules", refetch);

  return {
    exists: data?.exists ?? false,
    content: data?.content ?? "",
    isLoading,
    refetch,
  };
}
