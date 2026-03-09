import { useCallback, useEffect, useRef, useState } from "react";

import { reportPersistentErrorToast } from "../errorToasts";
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

interface WorktreeScopeHydrationState {
  currentServerUrl: string | null;
  hydratedServerUrl: string | null;
  isHydrating: boolean;
}

export function useWorktrees(
  onNotification?: (message: string, level: "error" | "info") => void,
  onHookUpdate?: (worktreeId: string) => void,
) {
  const serverUrl = useServerUrlOptional();
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeHydrationState, setScopeHydrationState] = useState<WorktreeScopeHydrationState>({
    currentServerUrl: serverUrl,
    hydratedServerUrl: null,
    isHydrating: serverUrl !== null,
  });
  const activeScopeRef = useRef<{ seq: number; serverUrl: string | null }>({
    seq: 0,
    serverUrl,
  });

  const isScopeActive = useCallback((scopeSeq: number, scopeServerUrl: string | null) => {
    return (
      activeScopeRef.current.seq === scopeSeq && activeScopeRef.current.serverUrl === scopeServerUrl
    );
  }, []);

  const markScopeHydrated = useCallback((scopeServerUrl: string) => {
    setScopeHydrationState((prev) => {
      if (prev.currentServerUrl !== scopeServerUrl) return prev;
      if (prev.hydratedServerUrl === scopeServerUrl && !prev.isHydrating) return prev;
      return {
        currentServerUrl: scopeServerUrl,
        hydratedServerUrl: scopeServerUrl,
        isHydrating: false,
      };
    });
  }, []);

  const fetchWorktreesForScope = useCallback(
    async (scopeSeq: number, scopeServerUrl: string) => {
      let data;
      try {
        data = await apiFetchWorktrees(scopeServerUrl);
      } catch (err) {
        if (!isScopeActive(scopeSeq, scopeServerUrl)) {
          return false;
        }

        const message = err instanceof Error ? err.message : "Failed to fetch worktrees";
        setError(message);
        reportPersistentErrorToast(err, "Failed to fetch worktrees", { scope: "worktrees:fetch" });
        return false;
      }

      if (!isScopeActive(scopeSeq, scopeServerUrl)) {
        return false;
      }

      setWorktrees((data.worktrees || []) as WorktreeInfo[]);
      setError(null);
      markScopeHydrated(scopeServerUrl);
      return true;
    },
    [isScopeActive, markScopeHydrated],
  );

  const fetchWorktrees = useCallback(async () => {
    if (serverUrl === null) return;
    const scope = activeScopeRef.current;
    if (!scope.serverUrl) return;
    try {
      await fetchWorktreesForScope(scope.seq, scope.serverUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch worktrees";
      setError(message);
      reportPersistentErrorToast(err, "Failed to fetch worktrees", { scope: "worktrees:fetch" });
    }
  }, [fetchWorktreesForScope, serverUrl]);

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
    activeScopeRef.current = {
      seq: activeScopeRef.current.seq + 1,
      serverUrl,
    };
    const scopeSeq = activeScopeRef.current.seq;

    setWorktrees([]);
    setIsConnected(false);
    setError(null);
    setScopeHydrationState({
      currentServerUrl: serverUrl,
      hydratedServerUrl: null,
      isHydrating: serverUrl !== null,
    });

    if (serverUrl === null) {
      return;
    }

    void fetchWorktreesForScope(scopeSeq, serverUrl);

    const eventSource = new EventSource(getEventsUrl(serverUrl));

    eventSource.onopen = () => {
      if (!isScopeActive(scopeSeq, serverUrl)) return;
      setIsConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      if (!isScopeActive(scopeSeq, serverUrl)) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "worktrees") {
          setWorktrees(data.worktrees || []);
          markScopeHydrated(serverUrl);
          setError(null);
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
      if (!isScopeActive(scopeSeq, serverUrl)) return;
      setIsConnected(false);
      setError("Live updates disconnected");
      reportPersistentErrorToast("Live updates disconnected", "Live updates disconnected", {
        scope: "worktrees:sse",
      });
      eventSource.close();
      setTimeout(() => {
        if (!isScopeActive(scopeSeq, serverUrl)) return;
        void fetchWorktreesForScope(scopeSeq, serverUrl);
      }, 5000);
    };

    return () => {
      eventSource.close();
    };
  }, [
    fetchWorktreesForScope,
    hookUpdateRef,
    isScopeActive,
    markScopeHydrated,
    notificationRef,
    serverUrl,
  ]);

  const hasHydratedCurrentScope =
    serverUrl !== null &&
    scopeHydrationState.currentServerUrl === serverUrl &&
    scopeHydrationState.hydratedServerUrl === serverUrl &&
    !scopeHydrationState.isHydrating;

  const isHydratingCurrentScope =
    serverUrl !== null &&
    scopeHydrationState.currentServerUrl === serverUrl &&
    scopeHydrationState.isHydrating;

  return {
    worktrees,
    isConnected,
    error,
    refetch: fetchWorktrees,
    hasHydratedCurrentScope,
    isHydratingCurrentScope,
  };
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
      .catch((error) => {
        reportPersistentErrorToast(error, "Failed to load project name", {
          scope: "project-name:fetch",
        });
      });
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
    } catch (error) {
      reportPersistentErrorToast(error, "Failed to fetch ports", { scope: "ports:fetch" });
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
      .catch((error) => {
        reportPersistentErrorToast(error, "Failed to fetch Jira status", {
          scope: "jira-status:fetch",
        });
      });
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
      .catch((error) => {
        reportPersistentErrorToast(error, "Failed to fetch Linear status", {
          scope: "linear-status:fetch",
        });
      });
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
      .catch((error) => {
        reportPersistentErrorToast(error, "Failed to fetch GitHub status", {
          scope: "github-status:fetch",
        });
      });
  }, [serverUrl]);

  return status;
}
