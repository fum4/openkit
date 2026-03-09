import { useEffect, useMemo, useState } from "react";

import { reportPersistentErrorToast } from "../errorToasts";
import type { Project } from "../contexts/ServerContext";
import { useServer } from "../contexts/ServerContext";
import type { OpsLogEvent } from "./api";
import { getEventsUrl } from "./api";

const SINGLE_PROJECT_ID = "__single_project__";

const SINGLE_PROJECT: Project = {
  id: SINGLE_PROJECT_ID,
  projectDir: ".",
  port: 0,
  name: "Current project",
  status: "running",
};

function resolveProjectServerUrl(project: Project): string | null {
  if (project.id === SINGLE_PROJECT_ID) {
    return null;
  }
  return `http://localhost:${project.port}`;
}

function upsertEvents(existing: OpsLogEvent[], incoming: OpsLogEvent[]): OpsLogEvent[] {
  if (incoming.length === 0) return existing;

  const byId = new Map(existing.map((event) => [event.id, event]));
  for (const event of incoming) {
    byId.set(event.id, event);
  }

  return [...byId.values()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

export interface ProjectOpsLogFeed {
  project: Project;
  serverUrl: string | null;
  isRunning: boolean;
  isLoading: boolean;
  events: OpsLogEvent[];
  clearAll: () => void;
}

export function useProjectOpsLogs() {
  const { projects, activeProject, isElectron } = useServer();
  const [eventsByProjectId, setEventsByProjectId] = useState<Record<string, OpsLogEvent[]>>({});
  const [isLoadingByProjectId, setIsLoadingByProjectId] = useState<Record<string, boolean>>({});

  const effectiveProjects = useMemo(() => {
    if (projects.length > 0) return projects;
    if (!isElectron) return [SINGLE_PROJECT];
    return [];
  }, [isElectron, projects]);

  useEffect(() => {
    const activeIds = new Set(effectiveProjects.map((project) => project.id));

    setEventsByProjectId((prev) => {
      const next: Record<string, OpsLogEvent[]> = {};
      for (const [projectId, events] of Object.entries(prev)) {
        if (activeIds.has(projectId)) {
          next[projectId] = events;
        }
      }
      return next;
    });

    setIsLoadingByProjectId((prev) => {
      const next: Record<string, boolean> = {};
      for (const [projectId, loading] of Object.entries(prev)) {
        if (activeIds.has(projectId)) {
          next[projectId] = loading;
        }
      }
      return next;
    });
  }, [effectiveProjects]);

  const runningTargets = useMemo(
    () =>
      effectiveProjects
        .filter((project) => project.status === "running")
        .map((project) => ({
          projectId: project.id,
          serverUrl: resolveProjectServerUrl(project),
        })),
    [effectiveProjects],
  );

  useEffect(() => {
    if (runningTargets.length === 0) return;

    const eventSources: EventSource[] = [];

    for (const target of runningTargets) {
      setIsLoadingByProjectId((prev) => ({
        ...prev,
        [target.projectId]: true,
      }));

      const eventSource = new EventSource(getEventsUrl(target.serverUrl));
      eventSource.onopen = () => {
        setIsLoadingByProjectId((prev) => ({
          ...prev,
          [target.projectId]: false,
        }));
      };
      eventSource.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data);
          if (payload.type === "ops-log-history" && Array.isArray(payload.events)) {
            const incoming = payload.events as OpsLogEvent[];
            setEventsByProjectId((prev) => ({
              ...prev,
              [target.projectId]: upsertEvents(prev[target.projectId] ?? [], incoming),
            }));
            setIsLoadingByProjectId((prev) => ({
              ...prev,
              [target.projectId]: false,
            }));
          }
          if (payload.type === "ops-log" && payload.event) {
            const incoming = payload.event as OpsLogEvent;
            setEventsByProjectId((prev) => ({
              ...prev,
              [target.projectId]: upsertEvents(prev[target.projectId] ?? [], [incoming]),
            }));
            setIsLoadingByProjectId((prev) => ({
              ...prev,
              [target.projectId]: false,
            }));
          }
        } catch {
          // Ignore malformed SSE payloads.
        }
      };

      eventSource.onerror = () => {
        setIsLoadingByProjectId((prev) => ({
          ...prev,
          [target.projectId]: false,
        }));
        reportPersistentErrorToast("Logs stream disconnected", "Logs stream disconnected", {
          scope: "ops-log:sse",
        });
        eventSource.close();
      };

      eventSources.push(eventSource);
    }

    return () => {
      eventSources.forEach((source) => source.close());
    };
  }, [runningTargets]);

  const feeds = useMemo(() => {
    const ordered = [...effectiveProjects];
    if (activeProject) {
      ordered.sort((a, b) => {
        if (a.id === activeProject.id && b.id !== activeProject.id) return -1;
        if (b.id === activeProject.id && a.id !== activeProject.id) return 1;
        return 0;
      });
    }

    return ordered.map((project) => ({
      project,
      serverUrl: resolveProjectServerUrl(project),
      isRunning: project.status === "running",
      isLoading: isLoadingByProjectId[project.id] ?? project.status === "running",
      events: eventsByProjectId[project.id] ?? [],
      clearAll: () => {
        setEventsByProjectId((prev) => ({
          ...prev,
          [project.id]: [],
        }));
      },
    }));
  }, [activeProject, effectiveProjects, eventsByProjectId, isLoadingByProjectId]);

  return { feeds };
}
