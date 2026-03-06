import { AlertTriangle, Loader2, PauseCircle, PlayCircle, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ACTIVITY_TYPES } from "@openkit/shared/activity-event";
import {
  ACTIVITY_FILTER_GROUP_OPTIONS,
  ActivityFeedPanel,
  type ActivityFilterGroup,
  isActionRequiredEvent,
} from "./ActivityFeed";
import {
  activityFilterScopeForProject,
  readPersistedActivityFilters,
  writePersistedActivityFilters,
} from "../hooks/activityFilterPersistence";
import { createActivityEvent, type ActivityEvent } from "../hooks/api";
import { useProjectActivityFeeds } from "../hooks/useProjectActivityFeeds";
import { text } from "../theme";

type WorktreeNavigationTarget = {
  worktreeId: string;
  projectName?: string;
  sourceServerUrl?: string;
  openClaudeTab?: boolean;
  openHooksTab?: boolean;
};

type IssueNavigationTarget = {
  source: "jira" | "linear" | "local";
  issueId: string;
  projectName?: string;
  sourceServerUrl?: string;
};

interface ActivityPageProps {
  disabledActivityEventTypes?: string[];
  onNavigateToWorktree?: (target: WorktreeNavigationTarget) => void;
  onNavigateToIssue?: (target: IssueNavigationTarget) => void;
}

const STATUS_BADGE: Record<
  "running" | "starting" | "stopped" | "error",
  { label: string; className: string; icon: typeof PlayCircle }
> = {
  running: {
    label: "Running",
    className: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    icon: PlayCircle,
  },
  starting: {
    label: "Starting",
    className: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    icon: Loader2,
  },
  stopped: {
    label: "Stopped",
    className: "text-[#9ca3af] bg-white/[0.06] border-white/[0.12]",
    icon: PauseCircle,
  },
  error: {
    label: "Error",
    className: "text-red-300 bg-red-500/10 border-red-500/30",
    icon: AlertTriangle,
  },
};

function buildUnavailableMessage(status: "running" | "starting" | "stopped" | "error"): string {
  if (status === "running") return "Live activity should be available shortly.";
  if (status === "starting")
    return "Project is starting. Live activity will appear when it is ready.";
  if (status === "error")
    return "Project failed to start. Resolve the project error to resume activity.";
  return "Project is stopped. Start it to stream live activity updates.";
}

export function ActivityPage({
  disabledActivityEventTypes,
  onNavigateToWorktree,
  onNavigateToIssue,
}: ActivityPageProps) {
  const { feeds } = useProjectActivityFeeds(disabledActivityEventTypes);
  const [selectedFilterGroupsByProjectId, setSelectedFilterGroupsByProjectId] = useState<
    Record<string, ActivityFilterGroup[]>
  >({});
  const filterScopeByProjectId = useMemo(() => {
    const next: Record<string, string> = {};
    for (const feed of feeds) {
      next[feed.project.id] = activityFilterScopeForProject({
        serverUrl: feed.serverUrl,
        projectId: feed.project.id,
        projectName: feed.project.name,
      });
    }
    return next;
  }, [feeds]);

  useEffect(() => {
    const activeIds = new Set(feeds.map((feed) => feed.project.id));
    setSelectedFilterGroupsByProjectId((prev) => {
      let changed = false;
      const next: Record<string, ActivityFilterGroup[]> = {};
      for (const [projectId, filters] of Object.entries(prev)) {
        if (activeIds.has(projectId)) {
          next[projectId] = filters;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [feeds]);

  useEffect(() => {
    setSelectedFilterGroupsByProjectId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const feed of feeds) {
        if (next[feed.project.id] !== undefined) continue;
        next[feed.project.id] = readPersistedActivityFilters(
          filterScopeByProjectId[feed.project.id],
        );
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [feeds, filterScopeByProjectId]);

  useEffect(() => {
    for (const [projectId, selectedFilters] of Object.entries(selectedFilterGroupsByProjectId)) {
      const scope = filterScopeByProjectId[projectId];
      if (!scope) continue;
      writePersistedActivityFilters(scope, selectedFilters);
    }
  }, [filterScopeByProjectId, selectedFilterGroupsByProjectId]);

  const seenSignature = useMemo(
    () =>
      feeds
        .map((feed) => `${feed.project.id}:${feed.events.map((event) => event.id).join(",")}`)
        .join("|"),
    [feeds],
  );

  useEffect(() => {
    if (!seenSignature) return;
    for (const feed of feeds) {
      if (!feed.isRunning || feed.events.length === 0) continue;
      feed.markEventsSeen(feed.events.map((event) => event.id));
    }
  }, [feeds, seenSignature]);

  const clearInputRequired = useCallback((event: ActivityEvent) => {
    const sourceServerUrl =
      typeof event.metadata?.sourceServerUrl === "string"
        ? (event.metadata.sourceServerUrl as string)
        : null;
    const fallbackGroupKey = event.worktreeId
      ? `agent-awaiting-input:${event.worktreeId}`
      : undefined;

    void createActivityEvent(
      {
        category: "agent",
        type: ACTIVITY_TYPES.AGENT_AWAITING_INPUT,
        severity: "info",
        title: "Input acknowledged",
        detail: "Opening agent context",
        worktreeId: event.worktreeId,
        groupKey: event.groupKey ?? fallbackGroupKey,
        metadata: {
          requiresUserAction: false,
          awaitingUserInput: false,
          cleared: true,
          clearedReason: "user-clicked",
          ...(sourceServerUrl ? { sourceServerUrl } : {}),
        },
      },
      sourceServerUrl,
    );
  }, []);

  if (feeds.length === 0) {
    return (
      <div className="absolute inset-0 px-5 pb-16 overflow-hidden">
        <div className="min-h-[420px] rounded-xl border border-white/[0.08] bg-[#12151a] flex items-center justify-center">
          <div className="text-center">
            <p className={`text-sm ${text.secondary}`}>No projects are open.</p>
            <p className={`text-xs ${text.dimmed} mt-1`}>Open a project to view activity cards.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 px-5 pb-16 overflow-hidden">
      <div className="h-full min-h-0 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(500px,1fr))] [grid-auto-rows:minmax(0,1fr)]">
        {feeds.map((feed) => {
          const selectedFilterGroups = selectedFilterGroupsByProjectId[feed.project.id] ?? [];
          const selectedFilterGroupSet = new Set(selectedFilterGroups);
          const unseenEventIds = new Set(
            feed.events
              .filter((event) => !feed.seenEventIds.has(event.id))
              .map((event) => event.id),
          );
          const hasActionRequiredEvents = feed.events.some((event) => isActionRequiredEvent(event));
          const badge = STATUS_BADGE[feed.project.status];
          const StatusIcon = badge.icon;

          return (
            <section
              key={feed.project.id}
              className="min-w-[500px] h-full min-h-0 rounded-xl bg-[#12151a] overflow-hidden flex flex-col"
            >
              <div
                className={`px-4 py-3 border-b ${
                  hasActionRequiredEvents ? "border-amber-300/20" : "border-white/[0.06]"
                } flex items-center justify-between gap-3`}
              >
                <h2 className={`text-sm font-medium ${text.primary} truncate`}>
                  {feed.project.name}
                </h2>
                <div className="flex items-center gap-2">
                  {feed.isRunning && (
                    <button
                      type="button"
                      onClick={feed.clearAll}
                      className={`mr-3 text-[10px] ${text.muted} hover:text-white transition-colors flex items-center gap-1 whitespace-nowrap`}
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear
                    </button>
                  )}
                  {feed.isRunning && (
                    <div className="flex items-center gap-1.5 overflow-x-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFilterGroupsByProjectId((prev) => ({
                            ...prev,
                            [feed.project.id]: [],
                          }));
                        }}
                        className={`px-2 py-0.5 rounded-md text-[10px] whitespace-nowrap transition-colors ${
                          selectedFilterGroupSet.size === 0
                            ? "bg-accent/20 text-accent"
                            : `${text.muted} bg-white/[0.04] hover:bg-white/[0.08] hover:text-white`
                        }`}
                      >
                        All
                      </button>
                      {ACTIVITY_FILTER_GROUP_OPTIONS.map((group) => {
                        const selected = selectedFilterGroupSet.has(group.id);
                        return (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => {
                              setSelectedFilterGroupsByProjectId((prev) => {
                                const current = prev[feed.project.id] ?? [];
                                const next = current.includes(group.id)
                                  ? current.filter((value) => value !== group.id)
                                  : [...current, group.id];
                                return {
                                  ...prev,
                                  [feed.project.id]: next,
                                };
                              });
                            }}
                            className={`px-2 py-0.5 rounded-md text-[10px] whitespace-nowrap transition-colors ${
                              selected
                                ? "bg-accent/20 text-accent"
                                : `${text.muted} bg-white/[0.04] hover:bg-white/[0.08] hover:text-white`
                            }`}
                          >
                            {group.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {feed.project.status !== "running" && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-medium ${badge.className}`}
                    >
                      <StatusIcon
                        className={`w-3 h-3 ${feed.project.status === "starting" ? "animate-spin" : ""}`}
                      />
                      {badge.label}
                    </span>
                  )}
                </div>
              </div>

              {feed.isRunning ? (
                <ActivityFeedPanel
                  events={feed.events}
                  unseenEventIds={unseenEventIds}
                  isLoading={feed.isLoading}
                  onClearAll={feed.clearAll}
                  selectedFilterGroups={selectedFilterGroups}
                  onToggleFilterGroup={(group) => {
                    setSelectedFilterGroupsByProjectId((prev) => {
                      const current = prev[feed.project.id] ?? [];
                      const next = current.includes(group)
                        ? current.filter((value) => value !== group)
                        : [...current, group];
                      return {
                        ...prev,
                        [feed.project.id]: next,
                      };
                    });
                  }}
                  onClearFilterGroups={() => {
                    setSelectedFilterGroupsByProjectId((prev) => ({
                      ...prev,
                      [feed.project.id]: [],
                    }));
                  }}
                  onNavigateToWorktree={onNavigateToWorktree}
                  onNavigateToIssue={onNavigateToIssue}
                  onResolveActionRequired={clearInputRequired}
                  hideTitle
                  hideTopBar
                  hideClearAction
                  hideFilterBar
                  containerClassName="flex-1 min-h-0 flex flex-col"
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                  <p className={`text-sm ${text.secondary}`}>Live activity unavailable</p>
                  <p className={`text-xs ${text.dimmed} mt-1 max-w-[420px]`}>
                    {buildUnavailableMessage(feed.project.status)}
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
