import { useQuery } from "@tanstack/react-query";

import { fetchLinearIssueDetail } from "./api";
import type { LinearIssueDetail } from "../types";
import { useServerUrlOptional } from "../contexts/ServerContext";

export function useLinearIssueDetail(identifier: string | null, refreshIntervalMinutes = 5) {
  const serverUrl = useServerUrlOptional();
  const staleTime = refreshIntervalMinutes * 60 * 1000;

  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } =
    useQuery<LinearIssueDetail | null>({
      queryKey: ["linear-issue", identifier, serverUrl],
      queryFn: async () => {
        const result = await fetchLinearIssueDetail(identifier!, serverUrl);
        if (result.error) throw new Error(result.error);
        return result.issue ?? null;
      },
      enabled: !!identifier && serverUrl !== null,
      staleTime,
    });

  return {
    issue: data ?? null,
    isLoading,
    isFetching,
    error: error instanceof Error ? error.message : null,
    refetch,
    dataUpdatedAt,
  };
}
