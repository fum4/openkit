import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ListFilter,
  Loader2,
  PauseCircle,
  PlayCircle,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ACTIVITY_TYPES } from "@openkit/shared/activity-event";
import {
  ACTIVITY_FILTER_GROUP_OPTIONS,
  ActivityFeedPanel,
  type ActivityFilterGroup,
  isActionRequiredEvent,
} from "./ActivityFeed";
import {
  activityFilterScopeForProject,
  readPersistedActivityDebugMode,
  readPersistedActivityFilters,
  writePersistedActivityDebugMode,
  writePersistedActivityFilters,
} from "../hooks/activityFilterPersistence";
import { createActivityEvent, type ActivityEvent, type OpsLogEvent } from "../hooks/api";
import { useProjectActivityFeeds } from "../hooks/useProjectActivityFeeds";
import { useProjectOpsLogs } from "../hooks/useProjectOpsLogs";
import { ToggleSwitch } from "./ToggleSwitch";
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

const LOG_LEVEL_CLASS: Record<OpsLogEvent["level"], string> = {
  debug: "text-[#9ca3af] bg-white/[0.06]",
  info: "text-sky-300 bg-sky-500/10",
  warning: "text-amber-300 bg-amber-500/10",
  error: "text-red-300 bg-red-500/10",
};

const LOG_STATUS_CLASS: Record<OpsLogEvent["status"], string> = {
  started: "text-amber-300 bg-amber-500/10",
  succeeded: "text-emerald-300 bg-emerald-500/10",
  failed: "text-red-300 bg-red-500/10",
  info: "text-[#9ca3af] bg-white/[0.06]",
};

const LOG_LEVEL_OPTIONS: OpsLogEvent["level"][] = ["error", "warning", "info", "debug"];

const HTTP_METHOD_TEXT_CLASS: Record<string, string> = {
  GET: "text-blue-300",
  POST: "text-emerald-300",
  DELETE: "text-red-300",
  PUT: "text-orange-300",
};

const STATUS_PREFIX_PATTERN = /^(Started|Succeeded|Failed):\s+/i;

function buildUnavailableMessage(status: "running" | "starting" | "stopped" | "error"): string {
  if (status === "running") return "Live activity should be available shortly.";
  if (status === "starting") {
    return "Project is starting. Live activity will appear when it is ready.";
  }
  if (status === "error") {
    return "Project failed to start. Resolve the project error to resume activity.";
  }
  return "Project is stopped. Start it to stream live activity updates.";
}

function formatClockTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getHttpMethod(event: OpsLogEvent): string | null {
  const methodRaw = event.metadata?.method;
  if (typeof methodRaw !== "string") return null;
  const method = methodRaw.trim().toUpperCase();
  return method.length > 0 ? method : null;
}

function getHttpMethodTextClass(method: string): string {
  return HTTP_METHOD_TEXT_CLASS[method] ?? "text-[#9ca3af]";
}

function stripStatusPrefix(message: string): string {
  return message.replace(STATUS_PREFIX_PATTERN, "");
}

function renderLogMessage(event: OpsLogEvent): ReactNode {
  const message = stripStatusPrefix(event.message);
  const method = getHttpMethod(event);
  if (!method) return message;

  const prefix = `${method} `;
  if (!message.startsWith(prefix)) {
    return message;
  }

  return (
    <>
      <span className={getHttpMethodTextClass(method)}>{method}</span>
      {message.slice(method.length)}
    </>
  );
}

function matchesLogQuery(event: OpsLogEvent, query: string): boolean {
  if (!query) return true;
  const method = getHttpMethod(event);
  const message = stripStatusPrefix(event.message);
  const haystack = [
    message,
    event.source,
    event.action,
    method,
    event.command?.command,
    event.command?.args.join(" "),
    event.command?.cwd,
    event.command?.stdout,
    event.command?.stderr,
    event.worktreeId,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();
  return haystack.includes(query);
}

export function ActivityPage({
  disabledActivityEventTypes,
  onNavigateToWorktree,
  onNavigateToIssue,
}: ActivityPageProps) {
  const { feeds } = useProjectActivityFeeds(disabledActivityEventTypes);
  const { feeds: opsFeeds } = useProjectOpsLogs();
  const opsFeedByProjectId = useMemo(
    () => Object.fromEntries(opsFeeds.map((feed) => [feed.project.id, feed])),
    [opsFeeds],
  );

  const [selectedFilterGroupsByProjectId, setSelectedFilterGroupsByProjectId] = useState<
    Record<string, ActivityFilterGroup[]>
  >({});
  const [debugModeByProjectId, setDebugModeByProjectId] = useState<Record<string, boolean>>({});
  const [logSearchByProjectId, setLogSearchByProjectId] = useState<Record<string, string>>({});
  const [selectedLogLevelsByProjectId, setSelectedLogLevelsByProjectId] = useState<
    Record<string, OpsLogEvent["level"][]>
  >({});
  const [openLogFilterProjectId, setOpenLogFilterProjectId] = useState<string | null>(null);

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

    const pruneByActiveIds = <T,>(record: Record<string, T>): Record<string, T> => {
      const next: Record<string, T> = {};
      for (const [key, value] of Object.entries(record)) {
        if (activeIds.has(key)) {
          next[key] = value;
        }
      }
      return next;
    };

    setSelectedFilterGroupsByProjectId((prev) => pruneByActiveIds(prev));
    setDebugModeByProjectId((prev) => pruneByActiveIds(prev));
    setLogSearchByProjectId((prev) => pruneByActiveIds(prev));
    setSelectedLogLevelsByProjectId((prev) => pruneByActiveIds(prev));
    setOpenLogFilterProjectId((prev) => (prev && activeIds.has(prev) ? prev : null));
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
    setDebugModeByProjectId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const feed of feeds) {
        if (next[feed.project.id] !== undefined) continue;
        next[feed.project.id] = readPersistedActivityDebugMode(
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

  useEffect(() => {
    for (const [projectId, enabled] of Object.entries(debugModeByProjectId)) {
      const scope = filterScopeByProjectId[projectId];
      if (!scope) continue;
      writePersistedActivityDebugMode(scope, enabled);
    }
  }, [debugModeByProjectId, filterScopeByProjectId]);

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
          const debugMode = debugModeByProjectId[feed.project.id] ?? false;
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

          const opsFeed = opsFeedByProjectId[feed.project.id];
          const opsEvents = opsFeed?.events ?? [];
          const logSearchQuery = (logSearchByProjectId[feed.project.id] ?? "").trim().toLowerCase();
          const selectedLogLevels =
            selectedLogLevelsByProjectId[feed.project.id] ?? LOG_LEVEL_OPTIONS;
          const selectedLogLevelSet = new Set(selectedLogLevels);
          const isLogLevelFilterActive = selectedLogLevels.length < LOG_LEVEL_OPTIONS.length;
          const filteredOpsEvents = opsEvents.filter((event) => {
            if (!selectedLogLevelSet.has(event.level)) {
              return false;
            }
            return matchesLogQuery(event, logSearchQuery);
          });

          const clearCurrentView = () => {
            if (debugMode) {
              opsFeed?.clearAll();
            } else {
              feed.clearAll();
            }
          };

          return (
            <section
              key={feed.project.id}
              className={`min-w-[500px] h-full min-h-0 rounded-xl bg-[#12151a] overflow-hidden flex flex-col border transition-colors ${
                debugMode ? "border-amber-400/20" : "border-transparent"
              }`}
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
                  {(feed.isRunning || debugMode) && (
                    <button
                      type="button"
                      onClick={clearCurrentView}
                      className={`mr-3 text-[10px] ${text.muted} hover:text-white transition-colors flex items-center gap-1 whitespace-nowrap`}
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear
                    </button>
                  )}

                  {feed.isRunning && !debugMode && (
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

                  <div className="ml-1 flex items-center gap-2">
                    <span className={`text-[10px] ${debugMode ? "text-amber-300" : text.muted}`}>
                      Debug
                    </span>
                    <ToggleSwitch
                      checked={debugMode}
                      size="sm"
                      ariaLabel="Toggle debug logs"
                      checkedTrackClassName="bg-amber-500/30"
                      checkedThumbClassName="bg-amber-300"
                      onToggle={() =>
                        setDebugModeByProjectId((prev) => ({
                          ...prev,
                          [feed.project.id]: !(prev[feed.project.id] ?? false),
                        }))
                      }
                    />
                  </div>

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

              {debugMode ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                      <Search
                        className={`w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 ${text.dimmed}`}
                      />
                      <input
                        value={logSearchByProjectId[feed.project.id] ?? ""}
                        onChange={(e) =>
                          setLogSearchByProjectId((prev) => ({
                            ...prev,
                            [feed.project.id]: e.target.value,
                          }))
                        }
                        placeholder="Search command, source, message..."
                        className={`w-full pl-7 pr-2 py-1.5 bg-white/[0.04] rounded text-xs ${text.primary} placeholder-[#6b7280] focus:outline-none focus:bg-white/[0.06]`}
                      />
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Filter debug logs"
                        title="Filter debug logs"
                        onClick={() =>
                          setOpenLogFilterProjectId((prev) =>
                            prev === feed.project.id ? null : feed.project.id,
                          )
                        }
                        className={`p-1.5 rounded transition-colors ${
                          isLogLevelFilterActive
                            ? "text-amber-300"
                            : `${text.muted} hover:text-white`
                        }`}
                      >
                        <ListFilter className="w-3.5 h-3.5" />
                      </button>

                      {openLogFilterProjectId === feed.project.id && (
                        <div className="absolute right-0 top-full mt-1.5 z-20 min-w-[150px] rounded-md border border-white/[0.08] bg-[#171a1f] shadow-lg p-2 space-y-1">
                          {LOG_LEVEL_OPTIONS.map((level) => {
                            const checked = selectedLogLevelSet.has(level);
                            return (
                              <label
                                key={level}
                                className="flex items-center gap-2 text-[11px] text-[#c9d1d9] cursor-pointer select-none"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setSelectedLogLevelsByProjectId((prev) => {
                                      const current = prev[feed.project.id] ?? LOG_LEVEL_OPTIONS;
                                      const nextSet = new Set<OpsLogEvent["level"]>(current);
                                      if (nextSet.has(level)) {
                                        nextSet.delete(level);
                                      } else {
                                        nextSet.add(level);
                                      }
                                      const nextLevels = LOG_LEVEL_OPTIONS.filter((value) =>
                                        nextSet.has(value),
                                      );
                                      return {
                                        ...prev,
                                        [feed.project.id]: nextLevels,
                                      };
                                    });
                                  }}
                                  className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 accent-amber-400"
                                />
                                <span className="capitalize">{level}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {!feed.isRunning && opsEvents.length === 0 ? (
                      <div className="h-full flex items-center justify-center px-6 text-center">
                        <div>
                          <p className={`text-sm ${text.secondary}`}>Live activity unavailable</p>
                          <p className={`text-xs ${text.dimmed} mt-1 max-w-[420px]`}>
                            {buildUnavailableMessage(feed.project.status)}
                          </p>
                        </div>
                      </div>
                    ) : filteredOpsEvents.length === 0 ? (
                      <div className="h-full flex items-center justify-center px-6 text-center">
                        <div>
                          <p className={`text-sm ${text.secondary}`}>No matching logs.</p>
                          <p className={`text-xs ${text.dimmed} mt-1`}>
                            Adjust filters or wait for new activity.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <ul className="divide-y divide-white/[0.05]">
                        {filteredOpsEvents.map((event) => {
                          return (
                            <li key={event.id} className="px-4 py-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className={`text-xs ${text.primary} break-words`}>
                                    {renderLogMessage(event)}
                                  </p>
                                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                                    <span
                                      className={`text-[10px] px-1.5 py-0.5 rounded ${LOG_LEVEL_CLASS[event.level]}`}
                                    >
                                      {event.level}
                                    </span>
                                    <span
                                      className={`text-[10px] px-1.5 py-0.5 rounded ${LOG_STATUS_CLASS[event.status]}`}
                                    >
                                      {event.status}
                                    </span>
                                    <span className={`text-[10px] ${text.dimmed}`}>
                                      {event.source}
                                    </span>
                                    <span className={`text-[10px] ${text.dimmed}`}>
                                      {event.action}
                                    </span>
                                    {event.worktreeId && (
                                      <span className={`text-[10px] ${text.dimmed}`}>
                                        worktree: {event.worktreeId}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <p className={`text-[10px] ${text.muted}`}>
                                    {formatClockTime(event.timestamp)}
                                  </p>
                                  <p className={`text-[10px] ${text.dimmed}`}>
                                    {formatRelativeTime(event.timestamp)}
                                  </p>
                                </div>
                              </div>

                              {event.command && (
                                <div className="mt-2 rounded-md border border-white/[0.08] bg-black/20 p-2">
                                  <p className="text-[10px] text-teal-300 font-mono break-words">
                                    $ {event.command.command}
                                    {event.command.args.length > 0
                                      ? ` ${event.command.args.join(" ")}`
                                      : ""}
                                  </p>
                                  <div className="mt-1 flex items-center gap-3 flex-wrap">
                                    {event.command.cwd && (
                                      <span className={`text-[10px] ${text.dimmed} font-mono`}>
                                        {event.command.cwd}
                                      </span>
                                    )}
                                    {typeof event.command.durationMs === "number" && (
                                      <span className={`text-[10px] ${text.dimmed}`}>
                                        <Clock3 className="w-3 h-3 inline mr-1" />
                                        {event.command.durationMs}ms
                                      </span>
                                    )}
                                    {event.command.exitCode !== undefined &&
                                      event.command.exitCode !== null && (
                                        <span className={`text-[10px] ${text.dimmed}`}>
                                          exit {event.command.exitCode}
                                        </span>
                                      )}
                                    {event.command.signal && (
                                      <span className={`text-[10px] ${text.dimmed}`}>
                                        signal {event.command.signal}
                                      </span>
                                    )}
                                  </div>
                                  {event.command.stderr && (
                                    <p className="mt-1 text-[10px] text-red-300/90 whitespace-pre-wrap break-words font-mono">
                                      {event.command.stderr}
                                    </p>
                                  )}
                                  {event.command.stdout && (
                                    <p className="mt-1 text-[10px] text-slate-300 whitespace-pre-wrap break-words font-mono">
                                      {event.command.stdout}
                                    </p>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {opsEvents.some(
                    (event) => event.status === "failed" || event.level === "error",
                  ) && (
                    <div className="px-4 py-2 border-t border-amber-400/15 bg-amber-400/5 text-[11px] text-amber-200/85 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Failure events detected in this project.
                    </div>
                  )}
                  {opsEvents.length > 0 &&
                    !opsEvents.some(
                      (event) => event.status === "failed" || event.level === "error",
                    ) && (
                      <div className="px-4 py-2 border-t border-emerald-400/15 bg-emerald-400/5 text-[11px] text-emerald-200/85 flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        No failures in current log window.
                      </div>
                    )}
                </div>
              ) : feed.isRunning ? (
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
