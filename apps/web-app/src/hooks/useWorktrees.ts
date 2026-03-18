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
  fetchInstanceInfo as apiFetchInstanceInfo,
  type InstanceInfo,
} from "./api";

export function useWorktrees(
  onNotification?: (message: string, level: "error" | "info") => void,
  onHookUpdate?: (worktreeId: string) => void,
) {
  const serverUrl = useServerUrlOptional();
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track which serverUrl produced the current worktrees so we return []
  // synchronously during the render where serverUrl changes but the clearing
  // effect hasn't run yet. Without this, stale worktrees from the previous
  // project leak into one render and trigger API calls against the wrong server.
  const worktreesSourceRef = useRef<string | null>(serverUrl);

  const fetchWorktrees = useCallback(async () => {
    if (serverUrl === null) return; // No active project in Electron mode
    try {
      const data = await apiFetchWorktrees(serverUrl);
      if (worktreesSourceRef.current !== serverUrl) return;
      setWorktrees((data.worktrees || []) as WorktreeInfo[]);
      setError(null);
    } catch (err) {
      if (worktreesSourceRef.current !== serverUrl) return;
      const message = err instanceof Error ? err.message : "Failed to fetch worktrees";
      setError(message);
      reportPersistentErrorToast(err, "Failed to fetch worktrees", { scope: "worktrees:fetch" });
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
      worktreesSourceRef.current = null;
      setWorktrees([]);
      setIsConnected(false);
      return;
    }

    worktreesSourceRef.current = serverUrl;
    setWorktrees([]);
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
        } else if (data.type === "config-changed") {
          window.dispatchEvent(new CustomEvent("OpenKit:config-changed", { detail: data }));
        } else if (data.type === "file-changed") {
          window.dispatchEvent(new CustomEvent("OpenKit:file-changed", { detail: data.category }));
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

    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    eventSource.onerror = () => {
      setIsConnected(false);
      setError("Live updates disconnected");
      reportPersistentErrorToast("Live updates disconnected", "Live updates disconnected", {
        scope: "worktrees:sse",
      });
      eventSource.close();
      retryTimeoutId = setTimeout(() => {
        fetchWorktrees();
      }, 5000);
    };

    return () => {
      eventSource.close();
      if (retryTimeoutId !== null) clearTimeout(retryTimeoutId);
    };
  }, [fetchWorktrees, notificationRef, hookUpdateRef, serverUrl]);

  const effectiveWorktrees = worktreesSourceRef.current === serverUrl ? worktrees : [];

  return { worktrees: effectiveWorktrees, isConnected, error, refetch: fetchWorktrees };
}

export function useProjectName() {
  const serverUrl = useServerUrlOptional();
  const [projectName, setProjectName] = useState<string | null>(null);

  useEffect(() => {
    if (serverUrl === null) {
      setProjectName(null);
      return;
    }

    let cancelled = false;
    apiFetchConfig(serverUrl)
      .then((data) => {
        if (!cancelled && data.projectName) setProjectName(data.projectName);
      })
      .catch((error) => {
        if (cancelled) return;
        reportPersistentErrorToast(error, "Failed to load project name", {
          scope: "project-name:fetch",
        });
      });

    return () => {
      cancelled = true;
    };
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

export function useInstanceInfo() {
  const serverUrl = useServerUrlOptional();
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfo>({
    branch: null,
    isWorktree: false,
    worktreeName: null,
  });

  useEffect(() => {
    // Pass serverUrl as-is — when null, the API call uses relative URLs (browser mode)
    apiFetchInstanceInfo(serverUrl)
      .then(setInstanceInfo)
      .catch(() => {
        // Instance info is best-effort — failure leaves the default state
      });
  }, [serverUrl]);

  // Derive port from serverUrl (Electron) or window.location (browser)
  const port = serverUrl
    ? new URL(serverUrl).port
    : typeof window !== "undefined" && window.location.port
      ? window.location.port
      : null;

  return { ...instanceInfo, port };
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

    let cancelled = false;
    apiFetchJiraStatus(serverUrl)
      .then((data) => {
        if (!cancelled) setJiraStatus(data);
      })
      .catch((error) => {
        if (cancelled) return;
        reportPersistentErrorToast(error, "Failed to fetch Jira status", {
          scope: "jira-status:fetch",
        });
      });

    return () => {
      cancelled = true;
    };
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

    let cancelled = false;
    apiFetchLinearStatus(serverUrl)
      .then((data) => {
        if (!cancelled) setLinearStatus(data);
      })
      .catch((error) => {
        if (cancelled) return;
        reportPersistentErrorToast(error, "Failed to fetch Linear status", {
          scope: "linear-status:fetch",
        });
      });

    return () => {
      cancelled = true;
    };
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

    let cancelled = false;
    apiFetchGitHubStatus(serverUrl)
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch((error) => {
        if (cancelled) return;
        reportPersistentErrorToast(error, "Failed to fetch GitHub status", {
          scope: "github-status:fetch",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  return status;
}
