import { useQuery } from "@tanstack/react-query";

import { fetchCustomTasks } from "./api";
import { useServerUrlOptional } from "../contexts/ServerContext";

export function useCustomTasks() {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["customTasks", serverUrl],
    queryFn: async () => {
      const result = await fetchCustomTasks(serverUrl);
      if (result.error) throw new Error(result.error);
      return result.tasks;
    },
    enabled: serverUrl !== null,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  return {
    tasks: data ?? [],
    isLoading,
    isFetching,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}
