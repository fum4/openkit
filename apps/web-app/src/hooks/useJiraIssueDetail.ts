import { useQuery } from "@tanstack/react-query";

import { fetchJiraIssueDetail } from "./api";
import type { JiraIssueDetail } from "../types";
import { useServerUrlOptional } from "../contexts/ServerContext";

export function useJiraIssueDetail(issueKey: string | null, refreshIntervalMinutes = 5) {
  const serverUrl = useServerUrlOptional();
  const staleTime = refreshIntervalMinutes * 60 * 1000;

  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } =
    useQuery<JiraIssueDetail | null>({
      queryKey: ["jira-issue", issueKey, serverUrl],
      queryFn: async () => {
        const result = await fetchJiraIssueDetail(issueKey!, serverUrl);
        if (result.error) throw new Error(result.error);
        return result.issue ?? null;
      },
      enabled: !!issueKey && serverUrl !== null,
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
