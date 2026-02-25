import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchLinearIssues } from "./api";
import { useServerUrlOptional } from "../contexts/ServerContext";

export function useLinearIssues(enabled: boolean, refreshIntervalMinutes = 5) {
  const serverUrl = useServerUrlOptional();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const staleTime = refreshIntervalMinutes * 60 * 1000;

  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ["linear-issues", debouncedQuery, serverUrl],
    queryFn: async () => {
      const result = await fetchLinearIssues(debouncedQuery || undefined, serverUrl);
      if (result.error) throw new Error(result.error);
      return result.issues;
    },
    enabled: enabled && serverUrl !== null,
    staleTime,
    refetchInterval: staleTime,
  });

  return {
    issues: data ?? [],
    isLoading,
    isFetching,
    error: error instanceof Error ? error.message : null,
    searchQuery,
    setSearchQuery,
    refetch,
    dataUpdatedAt,
  };
}
