import { useQuery } from "@tanstack/react-query";

import { fetchCustomTaskDetail } from "./api";
import type { CustomTaskDetail } from "../types";
import { useServerUrlOptional } from "../contexts/ServerContext";

export function useCustomTaskDetail(id: string | null) {
  const serverUrl = useServerUrlOptional();

  const { data, isLoading, error, refetch, isFetching } = useQuery<CustomTaskDetail | null>({
    queryKey: ["customTask", id, serverUrl],
    queryFn: async () => {
      const result = await fetchCustomTaskDetail(id!, serverUrl);
      if (result.error) throw new Error(result.error);
      return result.task ?? null;
    },
    enabled: !!id && serverUrl !== null,
    staleTime: 5_000,
  });

  return {
    task: data ?? null,
    isLoading,
    isFetching,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}
