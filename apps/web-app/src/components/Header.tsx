import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ACTIVITY_TYPES } from "@openkit/shared/activity-event";
import { useApi } from "../hooks/useApi";
import { useActivityFeed } from "../hooks/useActivityFeed";
import { ActivityBell, ActivityFeed } from "./ActivityFeed";
import type { View } from "./NavBar";
import { nav } from "../theme";

const tabs: { id: View; label: string }[] = [
  { id: "workspace", label: "Workspace" },
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
    source: "jira" | "linear";
    issueId: string;
    projectName?: string;
    sourceServerUrl?: string;
  }) => void;
  disabledActivityEventTypes?: string[];
}

function eventNeedsUserInput(event: {
  category: string;
  type: string;
  severity: string;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}): boolean {
  if (event.category !== "agent") return false;
  if (event.type === ACTIVITY_TYPES.AGENT_AWAITING_INPUT) {
    return (
      event.metadata?.requiresUserAction === true || event.metadata?.awaitingUserInput === true
    );
  }
  return event.metadata?.requiresUserAction === true;
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
  const [feedOpen, setFeedOpen] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(true);
  const [selectedFilterGroups, setSelectedFilterGroups] = useState<
    Array<"worktree" | "hooks" | "agents" | "system">
  >(() => {
    try {
      const stored = localStorage.getItem("OpenKit:activityFeedFilters");
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      const next = new Set<"worktree" | "hooks" | "agents" | "system">();
      for (const value of parsed) {
        if (value === "worktree" || value === "hooks" || value === "agents" || value === "system") {
          next.add(value);
        } else if (value === "agents-system") {
          next.add("agents");
          next.add("system");
        }
      }
      return [...next];
    } catch {
      return [];
    }
  });
  const [seenEventIds, setSeenEventIds] = useState<Set<string>>(() => new Set());
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
      .filter((event) => eventNeedsUserInput(event))
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
    try {
      if (selectedFilterGroups.length === 0) {
        localStorage.removeItem("OpenKit:activityFeedFilters");
      } else {
        localStorage.setItem("OpenKit:activityFeedFilters", JSON.stringify(selectedFilterGroups));
      }
    } catch {
      // Ignore storage issues
    }
  }, [selectedFilterGroups]);

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
  const toggleFilterGroup = (group: "worktree" | "hooks" | "agents" | "system") => {
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

          <div className="relative">
            <ActivityBell unreadCount={unreadCount} isOpen={feedOpen} onClick={handleToggleFeed} />
            <AnimatePresence>
              {feedOpen && (
                <ActivityFeed
                  events={visibleEvents}
                  unseenEventIds={unseenEventIds}
                  unreadCount={unreadCount}
                  onMarkAllRead={markAllRead}
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
