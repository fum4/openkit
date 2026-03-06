import { AnimatePresence } from "motion/react";
import { Download, Rocket, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ACTIVITY_TYPES } from "@openkit/shared/activity-event";
import { useServer } from "../contexts/ServerContext";
import { reportPersistentErrorToast } from "../errorToasts";
import {
  activityFilterScopeForProject,
  readPersistedActivityFilters,
  writePersistedActivityFilters,
} from "../hooks/activityFilterPersistence";
import { useApi } from "../hooks/useApi";
import { useActivityFeed } from "../hooks/useActivityFeed";
import {
  ActivityBell,
  ActivityFeed,
  isActionRequiredEvent,
  type ActivityFilterGroup,
} from "./ActivityFeed";
import type { View } from "./NavBar";
import { nav } from "../theme";

const tabs: { id: View; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "activity", label: "Activity" },
  { id: "agents", label: "Agents" },
  { id: "hooks", label: "Hooks" },
  { id: "integrations", label: "Integrations" },
  { id: "configuration", label: "Settings" },
];

interface HeaderProps {
  activeView: View;
  onChangeView: (view: View) => void;
  currentProjectName?: string | null;
  onNavigateToWorktree?: (target: {
    worktreeId: string;
    projectName?: string;
    sourceServerUrl?: string;
    openClaudeTab?: boolean;
    openHooksTab?: boolean;
  }) => void;
  onNavigateToIssue?: (target: {
    source: "jira" | "linear" | "local";
    issueId: string;
    projectName?: string;
    sourceServerUrl?: string;
  }) => void;
  disabledActivityEventTypes?: string[];
}

function eventContextKey(event: {
  projectName?: string;
  worktreeId?: string;
  metadata?: Record<string, unknown>;
}): string {
  const sourceServerUrl =
    typeof event.metadata?.sourceServerUrl === "string"
      ? (event.metadata.sourceServerUrl as string)
      : "__local__";
  return `${sourceServerUrl}::${event.projectName ?? "unknown-project"}::${event.worktreeId ?? "global"}`;
}

function eventIssueId(event: { metadata?: Record<string, unknown>; worktreeId?: string }): string {
  if (typeof event.metadata?.issueId === "string" && event.metadata.issueId.length > 0) {
    return event.metadata.issueId as string;
  }
  return event.worktreeId ?? "No task id";
}

export function Header({
  activeView,
  onChangeView,
  currentProjectName,
  onNavigateToWorktree,
  onNavigateToIssue,
  disabledActivityEventTypes,
}: HeaderProps) {
  const api = useApi();
  const { activeProject, serverUrl } = useServer();
  const [appUpdate, setAppUpdate] = useState<AppUpdateState | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(true);
  const [selectedFilterGroups, setSelectedFilterGroups] = useState<ActivityFilterGroup[]>([]);
  const [seenEventIds, setSeenEventIds] = useState<Set<string>>(() => new Set());
  const skipFilterPersistenceRef = useRef(true);
  const filterScope = useMemo(
    () =>
      activityFilterScopeForProject({
        serverUrl,
        projectId: activeProject?.id,
        projectName: currentProjectName,
      }),
    [activeProject?.id, currentProjectName, serverUrl],
  );
  const { events, unreadCount, markAllRead, clearAll } = useActivityFeed(
    undefined,
    undefined,
    undefined,
    disabledActivityEventTypes,
  );
  const visibleEvents = useMemo(() => {
    if (showAllProjects) return events;
    const normalizedProject = currentProjectName?.trim().toLowerCase();
    if (!normalizedProject) return events;
    return events.filter((event) => {
      const eventProject = event.projectName?.trim().toLowerCase();
      if (!eventProject) return true;
      return eventProject === normalizedProject;
    });
  }, [currentProjectName, events, showAllProjects]);
  const unseenEventIds = useMemo(() => {
    const unseen = new Set<string>();
    for (const event of visibleEvents) {
      if (!seenEventIds.has(event.id)) unseen.add(event.id);
    }
    return unseen;
  }, [seenEventIds, visibleEvents]);
  const [inputMenuOpen, setInputMenuOpen] = useState(false);
  const [inputHintPopover, setInputHintPopover] = useState<string | null>(null);
  const inputBadgeRef = useRef<HTMLDivElement>(null);

  const inputRequiredEvents = useMemo(() => {
    const latestByContext = new Map<string, (typeof events)[number]>();

    for (const event of visibleEvents) {
      if (event.category !== "agent") continue;
      const key = eventContextKey(event);
      if (!latestByContext.has(key)) {
        latestByContext.set(key, event);
      }
    }

    return [...latestByContext.values()]
      .filter((event) => isActionRequiredEvent(event))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [visibleEvents]);

  useEffect(() => {
    if (inputRequiredEvents.length <= 1) {
      setInputMenuOpen(false);
    }
  }, [inputRequiredEvents.length]);

  useEffect(() => {
    if (!feedOpen) return;
    setSeenEventIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const event of visibleEvents) {
        if (!next.has(event.id)) {
          next.add(event.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [feedOpen, visibleEvents]);

  useEffect(() => {
    if (events.length === 0) {
      setSeenEventIds(new Set());
    }
  }, [events.length]);

  useEffect(() => {
    skipFilterPersistenceRef.current = true;
    setSelectedFilterGroups(
      readPersistedActivityFilters(filterScope, { allowLegacyFallback: true }),
    );
  }, [filterScope]);

  useEffect(() => {
    if (skipFilterPersistenceRef.current) {
      skipFilterPersistenceRef.current = false;
      return;
    }
    writePersistedActivityFilters(filterScope, selectedFilterGroups);
  }, [filterScope, selectedFilterGroups]);

  useEffect(() => {
    if (!inputHintPopover) return;
    const timer = setTimeout(() => setInputHintPopover(null), 4200);
    return () => clearTimeout(timer);
  }, [inputHintPopover]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !inputBadgeRef.current) return;
      if (!inputBadgeRef.current.contains(target)) {
        setInputMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  const singleInputRequired = inputRequiredEvents.length === 1 ? inputRequiredEvents[0] : null;
  const singleInputProject = singleInputRequired?.projectName ?? "Unknown project";
  const singleInputWorktree = singleInputRequired?.worktreeId ?? "No worktree";

  const clearInputRequired = (event: (typeof inputRequiredEvents)[number]) => {
    const sourceServerUrl =
      typeof event.metadata?.sourceServerUrl === "string"
        ? (event.metadata.sourceServerUrl as string)
        : undefined;
    const fallbackGroupKey = event.worktreeId
      ? `agent-awaiting-input:${event.worktreeId}`
      : undefined;
    void api.createActivityEvent({
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
    });
  };

  const navigateToPending = (event: (typeof inputRequiredEvents)[number]): boolean => {
    const sourceServerUrl =
      typeof event.metadata?.sourceServerUrl === "string"
        ? (event.metadata.sourceServerUrl as string)
        : undefined;
    if (onNavigateToWorktree && event.worktreeId) {
      onNavigateToWorktree({
        worktreeId: event.worktreeId,
        projectName: event.projectName,
        sourceServerUrl,
        openClaudeTab: true,
      });
      return true;
    }
    return false;
  };

  const showNavigationHint = (event: (typeof inputRequiredEvents)[number]) => {
    const project = event.projectName ?? "this project";
    const worktree = event.worktreeId;
    setInputHintPopover(
      worktree
        ? `Please open ${project} and go to ${worktree} > Claude.`
        : `Please open ${project} and check the Claude terminal for required input.`,
    );
  };

  const handleInputRequiredClick = () => {
    if (inputRequiredEvents.length === 0) return;
    if (inputRequiredEvents.length > 1) {
      setInputMenuOpen((prev) => !prev);
      return;
    }
    if (!singleInputRequired) return;
    clearInputRequired(singleInputRequired);
    const navigated = navigateToPending(singleInputRequired);
    if (!navigated) {
      showNavigationHint(singleInputRequired);
    } else {
      setInputMenuOpen(false);
    }
  };

  const handlePendingSelection = (event: (typeof inputRequiredEvents)[number]) => {
    clearInputRequired(event);
    const navigated = navigateToPending(event);
    if (!navigated) {
      showNavigationHint(event);
    }
    setInputMenuOpen(false);
  };

  const handleToggleFeed = () => {
    setFeedOpen((prev) => {
      if (!prev) {
        setTimeout(() => markAllRead(), 500);
      }
      return !prev;
    });
  };

  useEffect(() => {
    if (!window.electronAPI) return;
    if (
      typeof window.electronAPI.getAppUpdateState !== "function" ||
      typeof window.electronAPI.onAppUpdateState !== "function"
    ) {
      return;
    }
    window.electronAPI
      .getAppUpdateState()
      .then(setAppUpdate)
      .catch((error) => {
        reportPersistentErrorToast(error, "Failed to initialize updater state", {
          scope: "header:updater-init",
        });
      });
    const unsubscribe = window.electronAPI.onAppUpdateState((state) => setAppUpdate(state));
    return unsubscribe;
  }, []);

  const shouldShowUpdateChip = useMemo(() => {
    if (!appUpdate) return false;
    return ["available", "downloading", "downloaded", "error"].includes(appUpdate.status);
  }, [appUpdate]);

  const updateBaseText = useMemo(() => {
    if (!appUpdate) return "";
    switch (appUpdate.status) {
      case "checking":
        return "Checking updates";
      case "available":
        return "Download update";
      case "downloading":
        return appUpdate.progress != null
          ? `Downloading ${Math.round(appUpdate.progress)}%`
          : "Downloading update";
      case "downloaded":
        return "Install update";
      case "error":
        return "Retry update";
      default:
        return "";
    }
  }, [appUpdate]);

  const updateIcon = useMemo(() => {
    if (appUpdate?.status === "downloaded") {
      return <Rocket className="w-3 h-3 flex-shrink-0" />;
    }
    if (appUpdate?.status === "error") {
      return <RotateCcw className="w-3 h-3 flex-shrink-0" />;
    }
    if (appUpdate?.status === "downloading") {
      return <Download className="w-3 h-3 flex-shrink-0 animate-pulse" />;
    }
    return <Download className="w-3 h-3 flex-shrink-0" />;
  }, [appUpdate]);

  const handleUpdateChipClick = async () => {
    if (!window.electronAPI || !appUpdate) return;
    try {
      if (appUpdate.status === "downloaded") {
        if (typeof window.electronAPI.installAppUpdate !== "function") return;
        await window.electronAPI.installAppUpdate();
        return;
      }
      if (appUpdate.status === "available" && !appUpdate.autoDownloadEnabled) {
        if (typeof window.electronAPI.downloadAppUpdate !== "function") return;
        await window.electronAPI.downloadAppUpdate();
        return;
      }
      if (appUpdate.status === "error" || appUpdate.status === "idle") {
        if (typeof window.electronAPI.checkAppUpdates !== "function") return;
        await window.electronAPI.checkAppUpdates();
      }
    } catch (error) {
      reportPersistentErrorToast(error, "Updater action failed", {
        scope: "header:updater-action",
      });
    }
  };
  const toggleFilterGroup = (group: ActivityFilterGroup) => {
    setSelectedFilterGroups((prev) => {
      if (prev.includes(group)) return prev.filter((item) => item !== group);
      return [...prev, group];
    });
  };
  const clearFilterGroups = () => {
    setSelectedFilterGroups([]);
  };

  return (
    <header
      className="h-[4.25rem] flex-shrink-0 relative bg-[#0c0e12]/60 backdrop-blur-md z-40"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Center: nav tabs */}
      <div
        className="absolute inset-x-0 bottom-[1.375rem] flex justify-center"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onChangeView(t.id)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors duration-150 ${
                activeView === t.id ? nav.active : nav.inactive
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right: activity bell */}
      <div
        className="absolute right-4 bottom-[1.375rem] flex items-center"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          {inputRequiredEvents.length > 0 && (
            <div ref={inputBadgeRef} className="relative">
              <button
                type="button"
                onClick={handleInputRequiredClick}
                className="h-7 max-w-[420px] px-2.5 rounded-md border border-accent/30 bg-accent/10 text-[10px] text-accent hover:bg-accent/20 transition-colors duration-150 inline-flex items-center gap-1.5"
                title={
                  inputRequiredEvents.length > 1
                    ? `${inputRequiredEvents.length} actions require your input`
                    : `${singleInputRequired?.title ?? ""} (${singleInputProject} • ${singleInputWorktree})`
                }
              >
                <span
                  aria-hidden="true"
                  className="inline-flex w-3.5 h-3.5 items-center justify-center text-[11px] font-bold leading-none flex-shrink-0"
                >
                  !
                </span>
                <span className="truncate">
                  {inputRequiredEvents.length > 1
                    ? "Agents await your input"
                    : "Agent awaits your input"}
                </span>
                <span className="inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-accent/20 text-accent text-[9px] font-semibold leading-none flex-shrink-0">
                  {inputRequiredEvents.length}
                </span>
              </button>
              {inputMenuOpen && inputRequiredEvents.length > 1 && (
                <div className="absolute right-0 top-full mt-2 w-[420px] max-h-[320px] overflow-y-auto rounded-md border border-white/[0.12] bg-[#12151a] shadow-xl">
                  <div className="px-3 py-2 border-b border-white/[0.08] text-[10px] text-[#9ca3af]">
                    Select a task that needs your input
                  </div>
                  <div className="divide-y divide-white/[0.06]">
                    {inputRequiredEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => handlePendingSelection(event)}
                        className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors"
                      >
                        <div className="text-[10px] text-accent truncate">
                          {event.projectName ?? "Unknown project"} · {eventIssueId(event)}
                        </div>
                        <div className="text-[10px] text-[#9ca3af] truncate mt-0.5">
                          {event.title}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {inputHintPopover && (
                <div className="absolute right-0 top-full mt-2 max-w-[340px] px-2.5 py-2 rounded-md border border-white/[0.12] bg-[#12151a] text-[10px] text-[#9ca3af] shadow-xl">
                  {inputHintPopover}
                </div>
              )}
            </div>
          )}

          {shouldShowUpdateChip && appUpdate && (
            <button
              type="button"
              onClick={handleUpdateChipClick}
              className={`relative h-7 px-2.5 rounded-md text-[10px] text-amber-100/75 transition-colors duration-150 overflow-hidden inline-flex items-center justify-center gap-1.5 ${
                appUpdate.status === "downloading"
                  ? "bg-transparent hover:bg-transparent"
                  : "bg-amber-300/10 hover:bg-amber-300/14"
              }`}
              title={updateBaseText}
            >
              {updateIcon}
              <span className="truncate text-center">{updateBaseText}</span>
              {appUpdate.status === "downloading" && (
                <span
                  className="absolute bottom-0 left-0 h-[1.5px] bg-amber-300 transition-[width] duration-200"
                  style={{ width: `${Math.max(0, Math.min(100, appUpdate.progress ?? 0))}%` }}
                />
              )}
            </button>
          )}

          <div className="relative ml-1.5">
            <ActivityBell unreadCount={unreadCount} isOpen={feedOpen} onClick={handleToggleFeed} />
            <AnimatePresence>
              {feedOpen && (
                <ActivityFeed
                  events={visibleEvents}
                  unseenEventIds={unseenEventIds}
                  onClearAll={clearAll}
                  showAllProjects={showAllProjects}
                  onToggleShowAllProjects={() => setShowAllProjects((prev) => !prev)}
                  selectedFilterGroups={selectedFilterGroups}
                  onToggleFilterGroup={toggleFilterGroup}
                  onClearFilterGroups={clearFilterGroups}
                  onClose={() => setFeedOpen(false)}
                  onNavigateToWorktree={onNavigateToWorktree}
                  onNavigateToIssue={onNavigateToIssue}
                  onResolveActionRequired={clearInputRequired}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}
