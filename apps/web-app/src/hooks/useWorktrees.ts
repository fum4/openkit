import { useCallback, useEffect, useState } from "react";

import type { WorktreeInfo, PortsInfo, JiraStatus, GitHubStatus, LinearStatus } from "../types";
import { useServerUrlOptional } from "../contexts/ServerContext";
import {
  fetchWorktrees as apiFetchWorktrees,
  getEventsUrl,
  fetchPorts as apiFetchPorts,
  fetchJiraStatus as apiFetchJiraStatus,
  fetchGitHubStatus as apiFetchGitHubStatus,
  fetchLinearStatus as apiFetchLinearStatus,
  fetchConfig as apiFetchConfig,
} from "./api";

export function useWorktrees(
  onNotification?: (message: string, level: "error" | "info") => void,
  onHookUpdate?: (worktreeId: string) => void,
) {
  const serverUrl = useServerUrlOptional();
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorktrees = useCallback(async () => {
    if (serverUrl === null) return; // No active project in Electron mode
    try {
      const data = await apiFetchWorktrees(serverUrl);
      setWorktrees((data.worktrees || []) as WorktreeInfo[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch worktrees");
    }
  }, [serverUrl]);

  // Store callbacks in refs so they don't cause reconnects
  const notificationRef = useCallback(
    (message: string, level: "error" | "info") => {
      onNotification?.(message, level);
    },
    [onNotification],
  );

  const hookUpdateRef = useCallback(
    (worktreeId: string) => {
      onHookUpdate?.(worktreeId);
    },
    [onHookUpdate],
  );

  useEffect(() => {
    if (serverUrl === null) {
      setWorktrees([]);
      setIsConnected(false);
      return;
    }

    fetchWorktrees();

    const eventSource = new EventSource(getEventsUrl(serverUrl));

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "worktrees") {
          setWorktrees(data.worktrees || []);
        } else if (data.type === "notification") {
          notificationRef(data.message, data.level);
        } else if (data.type === "hook-update") {
          hookUpdateRef(data.worktreeId);
        } else if (data.type === "activity") {
          window.dispatchEvent(new CustomEvent("OpenKit:activity", { detail: data.event }));
        } else if (data.type === "activity-history") {
          window.dispatchEvent(
            new CustomEvent("OpenKit:activity-history", { detail: data.events }),
          );
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
      setTimeout(() => {
        fetchWorktrees();
      }, 5000);
    };

    return () => {
      eventSource.close();
    };
  }, [fetchWorktrees, notificationRef, hookUpdateRef, serverUrl]);

  return { worktrees, isConnected, error, refetch: fetchWorktrees };
}

export function useProjectName() {
  const serverUrl = useServerUrlOptional();
  const [projectName, setProjectName] = useState<string | null>(null);

  useEffect(() => {
    if (serverUrl === null) {
      setProjectName(null);
      return;
    }

    apiFetchConfig(serverUrl)
      .then((data) => {
        if (data.projectName) setProjectName(data.projectName);
      })
      .catch(() => {});
  }, [serverUrl]);

  return projectName;
}

export function usePorts() {
  const serverUrl = useServerUrlOptional();
  const [ports, setPorts] = useState<PortsInfo>({
    discovered: [],
    offsetStep: 1,
  });

  const fetchPorts = useCallback(async () => {
    if (serverUrl === null) return;
    try {
      const data = await apiFetchPorts(serverUrl);
      setPorts(data);
    } catch {
      // Ignore errors
    }
  }, [serverUrl]);

  useEffect(() => {
    fetchPorts();
  }, [fetchPorts]);

  return { ports, refetchPorts: fetchPorts };
}

export function useJiraStatus() {
  const serverUrl = useServerUrlOptional();
  const [jiraStatus, setJiraStatus] = useState<JiraStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (serverUrl === null) {
      setJiraStatus(null);
      return;
    }

    apiFetchJiraStatus(serverUrl)
      .then((data) => setJiraStatus(data))
      .catch(() => {});
  }, [refreshKey, serverUrl]);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { jiraStatus, refetchJiraStatus: refetch };
}

export function useLinearStatus() {
  const serverUrl = useServerUrlOptional();
  const [linearStatus, setLinearStatus] = useState<LinearStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (serverUrl === null) {
      setLinearStatus(null);
      return;
    }

    apiFetchLinearStatus(serverUrl)
      .then((data) => setLinearStatus(data))
      .catch(() => {});
  }, [refreshKey, serverUrl]);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { linearStatus, refetchLinearStatus: refetch };
}

export function useGitHubStatus() {
  const serverUrl = useServerUrlOptional();
  const [status, setStatus] = useState<GitHubStatus | null>(null);

  useEffect(() => {
    if (serverUrl === null) {
      setStatus(null);
      return;
    }

    apiFetchGitHubStatus(serverUrl)
      .then((data) => setStatus(data))
      .catch(() => {});
  }, [serverUrl]);

  return status;
}
