import { motion } from "motion/react";
import {
  Bell,
  Bot,
  Check,
  FishingHook,
  GitBranch,
  Link,
  Loader2,
  Monitor,
  MoonStar,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { ACTIVITY_TYPES } from "../../server/activity-event";
import type { ActivityEvent } from "../hooks/api";
import type { HookFeedItem } from "../hooks/useActivityFeed";
import { ClaudeIcon, CodexIcon, GeminiIcon, JiraIcon, LinearIcon, OpenCodeIcon } from "../icons";
import { activity, integration, text } from "../theme";
import { ToggleSwitch } from "./ToggleSwitch";

const CATEGORY_ICONS: Record<string, typeof Bot> = {
  agent: Bot,
  worktree: GitBranch,
  git: GitBranch,
  integration: Link,
  system: Monitor,
};

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDays}d ago`;
}

function isHookEvent(event: ActivityEvent): boolean {
  return (
    event.groupKey?.startsWith("hooks:") === true ||
    Array.isArray(event.metadata?.hookItems) ||
    event.type === "hooks_started" ||
    event.type === "hooks_ran" ||
    event.type === "skill_started" ||
    event.type === "skill_completed" ||
    event.type === "skill_failed"
  );
}

function isActionRequired(event: ActivityEvent): boolean {
  if (event.type === ACTIVITY_TYPES.AGENT_AWAITING_INPUT) {
    return (
      event.metadata?.requiresUserAction === true || event.metadata?.awaitingUserInput === true
    );
  }
  return event.category === "agent" && event.metadata?.requiresUserAction === true;
}

function actionContextKey(event: ActivityEvent): string {
  const sourceServerUrl =
    typeof event.metadata?.sourceServerUrl === "string"
      ? (event.metadata.sourceServerUrl as string)
      : "__local__";
  return `${sourceServerUrl}::${event.projectName ?? "unknown-project"}::${event.worktreeId ?? "global"}`;
}

function getActiveActionRequiredEvents(events: ActivityEvent[]): ActivityEvent[] {
  const latestByContext = new Map<string, ActivityEvent>();

  for (const event of events) {
    if (event.category !== "agent") continue;
    const key = actionContextKey(event);
    if (!latestByContext.has(key)) {
      latestByContext.set(key, event);
    }
  }

  return [...latestByContext.values()]
    .filter((event) => isActionRequired(event))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function hookItems(event: ActivityEvent): HookFeedItem[] {
  const items = event.metadata?.hookItems as HookFeedItem[] | undefined;
  return Array.isArray(items) ? items : [];
}

type ActivityFilterGroup = "worktree" | "hooks" | "agents" | "system";

function HookStatusIcon({ status }: { status: HookFeedItem["status"] }) {
  if (status === "running") return <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
  if (status === "failed") return <X className="w-3.5 h-3.5 text-red-400" />;
  return <Check className="w-3.5 h-3.5 text-emerald-400" />;
}

function normalizeAgentToken(value: unknown): "claude" | "codex" | "gemini" | "opencode" | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (!token) return null;
  if (token.includes("claude")) return "claude";
  if (token.includes("codex")) return "codex";
  if (token.includes("gemini")) return "gemini";
  if (token.includes("opencode")) return "opencode";
  return null;
}

function getAgentIconVariant(
  event: ActivityEvent,
): "claude" | "codex" | "gemini" | "opencode" | null {
  const metadataAgent = normalizeAgentToken(event.metadata?.agent);
  if (metadataAgent) return metadataAgent;
  const metadataModel = normalizeAgentToken(event.metadata?.model);
  if (metadataModel) return metadataModel;
  const scanText = `${event.title ?? ""} ${event.detail ?? ""}`.toLowerCase();
  if (scanText.includes("claude")) return "claude";
  if (scanText.includes("codex")) return "codex";
  if (scanText.includes("gemini")) return "gemini";
  if (scanText.includes("opencode")) return "opencode";
  return null;
}

function isInFilterGroup(event: ActivityEvent, group: ActivityFilterGroup): boolean {
  if (group === "worktree") return event.category === "worktree";
  if (group === "hooks") return isHookEvent(event);
  if (group === "agents") return event.category === "agent" && !isHookEvent(event);
  return event.category === "system";
}

interface ActivityFeedProps {
  events: ActivityEvent[];
  unseenEventIds: Set<string>;
  unreadCount: number;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  showAllProjects: boolean;
  onToggleShowAllProjects: () => void;
  selectedFilterGroups: ActivityFilterGroup[];
  onToggleFilterGroup: (group: ActivityFilterGroup) => void;
  onClearFilterGroups: () => void;
  onClose: () => void;
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
  onResolveActionRequired?: (event: ActivityEvent) => void;
}

export function ActivityFeed({
  events,
  unseenEventIds,
  unreadCount,
  onMarkAllRead,
  onClearAll,
  showAllProjects,
  onToggleShowAllProjects,
  selectedFilterGroups,
  onToggleFilterGroup,
  onClearFilterGroups,
  onClose,
  onNavigateToWorktree,
  onNavigateToIssue,
  onResolveActionRequired,
}: ActivityFeedProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-activity-bell="true"]')) {
        return;
      }
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const selectedGroupSet = useMemo(() => new Set(selectedFilterGroups), [selectedFilterGroups]);
  const filteredEvents = useMemo(() => {
    if (selectedGroupSet.size === 0) return events;
    return events.filter((event) =>
      [...selectedGroupSet].some((group) => isInFilterGroup(event, group)),
    );
  }, [events, selectedGroupSet]);
  const actionRequiredEvents = useMemo(
    () => getActiveActionRequiredEvents(filteredEvents),
    [filteredEvents],
  );
  const actionRequiredIds = useMemo(
    () => new Set(actionRequiredEvents.map((event) => event.id)),
    [actionRequiredEvents],
  );
  const regularEvents = useMemo(
    () => filteredEvents.filter((event) => !actionRequiredIds.has(event.id)),
    [actionRequiredIds, filteredEvents],
  );

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="absolute right-0 top-full mt-2 w-[500px] max-h-[620px] rounded-xl bg-[#12151a] border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden z-50"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <h3 className={`text-sm font-medium ${text.primary}`}>Recent activity</h3>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className={`text-[10px] ${text.muted} hover:text-white transition-colors flex items-center gap-1`}
            >
              <Check className="w-3 h-3" />
              Mark read
            </button>
          )}
          <button
            onClick={onClearAll}
            className={`text-[10px] ${text.muted} hover:text-white transition-colors flex items-center gap-1`}
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
          <div className={`flex items-center gap-1.5 ml-3 text-[10px] ${text.muted}`}>
            <button
              type="button"
              onClick={onToggleShowAllProjects}
              className="transition-colors hover:text-white"
            >
              Show all projects
            </button>
            <ToggleSwitch
              checked={showAllProjects}
              onToggle={(event) => {
                event.stopPropagation();
                onToggleShowAllProjects();
              }}
              size="sm"
              ariaLabel="Show all projects"
            />
          </div>
        </div>
      </div>
      <div className="px-4 py-3.5 border-b border-white/[0.06] flex items-center gap-1.5 overflow-x-auto">
        <button
          type="button"
          onClick={onClearFilterGroups}
          className={`px-2 py-0.5 rounded-md text-[10px] whitespace-nowrap transition-colors ${
            selectedGroupSet.size === 0
              ? "bg-accent/20 text-accent"
              : `${text.muted} bg-white/[0.04] hover:bg-white/[0.08] hover:text-white`
          }`}
        >
          All
        </button>
        {[
          { id: "worktree", label: "Worktree" },
          { id: "hooks", label: "Hooks" },
          { id: "agents", label: "Agents" },
          { id: "system", label: "System" },
        ].map((group) => {
          const selected = selectedGroupSet.has(group.id as ActivityFilterGroup);
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onToggleFilterGroup(group.id as ActivityFilterGroup)}
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

      <div className="flex-1 overflow-y-auto min-h-0">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <MoonStar className={`w-7 h-7 ${text.dimmed} mb-2`} />
            <p className={`text-xs ${text.dimmed}`}>No recent activity</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <MoonStar className={`w-7 h-7 ${text.dimmed} mb-2`} />
            <p className={`text-xs ${text.dimmed}`}>No activity matches selected types</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {actionRequiredEvents.length > 0 && (
              <div className="bg-amber-500/[0.04] border-b border-amber-500/20">
                <div className="px-4 py-2 border-b border-amber-500/10">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                    Requires your action
                  </p>
                </div>
                {actionRequiredEvents.map((event) => (
                  <ActivityRow
                    key={event.id}
                    event={event}
                    showUnreadDot={unseenEventIds.has(event.id)}
                    onNavigateToWorktree={onNavigateToWorktree}
                    onNavigateToIssue={onNavigateToIssue}
                    onResolveActionRequired={onResolveActionRequired}
                  />
                ))}
              </div>
            )}

            {regularEvents.map((event) => (
              <ActivityRow
                key={event.id}
                event={event}
                showUnreadDot={unseenEventIds.has(event.id)}
                onNavigateToWorktree={onNavigateToWorktree}
                onNavigateToIssue={onNavigateToIssue}
                onResolveActionRequired={onResolveActionRequired}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ActivityRow({
  event,
  showUnreadDot,
  onNavigateToWorktree,
  onNavigateToIssue,
  onResolveActionRequired,
}: {
  event: ActivityEvent;
  showUnreadDot: boolean;
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
  onResolveActionRequired?: (event: ActivityEvent) => void;
}) {
  const actionRequired = isActionRequired(event);
  const hookEvent = isHookEvent(event);
  const issueSource =
    event.metadata?.source === "jira" || event.metadata?.source === "linear"
      ? (event.metadata.source as "jira" | "linear")
      : null;
  const claudeRelated = event.type === "auto_task_claimed" || event.metadata?.autoClaimed === true;
  const issueId =
    typeof event.metadata?.issueId === "string" ? (event.metadata.issueId as string) : null;
  const shouldShowWorktreeLink = Boolean(
    event.worktreeId &&
    (!issueId || !issueSource || event.worktreeId.toLowerCase() !== issueId.toLowerCase()),
  );
  const Icon = hookEvent ? FishingHook : (CATEGORY_ICONS[event.category] ?? Monitor);
  const agentIconVariant = event.category === "agent" ? getAgentIconVariant(event) : null;
  const categoryColor = hookEvent
    ? "text-yellow-400"
    : (activity.categoryColor[event.category] ?? "text-[#6b7280]");
  const categoryBg = hookEvent
    ? "bg-yellow-400/10"
    : issueSource === "jira"
      ? "bg-blue-500/10"
      : issueSource === "linear"
        ? "bg-[#5E6AD2]/10"
        : (activity.categoryBg[event.category] ?? "bg-white/[0.06]");
  const items = hookItems(event);
  const hasChildren = hookEvent && items.length > 0;
  const sourceServerUrl =
    typeof event.metadata?.sourceServerUrl === "string"
      ? (event.metadata.sourceServerUrl as string)
      : undefined;
  const navigateToWorktree = (options?: { openClaudeTab?: boolean; openHooksTab?: boolean }) => {
    if (!event.worktreeId || !onNavigateToWorktree) return false;
    if (actionRequired) onResolveActionRequired?.(event);
    onNavigateToWorktree({
      worktreeId: event.worktreeId,
      projectName: event.projectName,
      sourceServerUrl,
      openClaudeTab: options?.openClaudeTab,
      openHooksTab: options?.openHooksTab,
    });
    return true;
  };
  const navigateToIssue = () => {
    if (!issueSource || !issueId || !onNavigateToIssue) return false;
    if (actionRequired) onResolveActionRequired?.(event);
    onNavigateToIssue({
      source: issueSource,
      issueId,
      projectName: event.projectName,
      sourceServerUrl,
    });
    return true;
  };
  const handleRowClick = () => {
    if (hookEvent && event.worktreeId) {
      navigateToWorktree({ openHooksTab: true });
      return;
    }
    if (issueSource && issueId) {
      if (claudeRelated && event.worktreeId) {
        navigateToWorktree({ openClaudeTab: true });
        return;
      }
      navigateToIssue();
      return;
    }
    if (event.worktreeId) {
      navigateToWorktree({ openClaudeTab: claudeRelated });
    }
  };
  const rowClickable = Boolean(
    (hookEvent && event.worktreeId && onNavigateToWorktree) ||
    (issueSource &&
      issueId &&
      ((claudeRelated && event.worktreeId && onNavigateToWorktree) || onNavigateToIssue)) ||
    (event.worktreeId && onNavigateToWorktree),
  );

  return (
    <div
      className={`px-4 py-3 hover:bg-white/[0.02] transition-colors ${rowClickable ? "cursor-pointer" : ""}`}
      role={rowClickable ? "button" : undefined}
      tabIndex={rowClickable ? 0 : undefined}
      onClick={rowClickable ? handleRowClick : undefined}
      onKeyDown={
        rowClickable
          ? (e) => {
              if (e.currentTarget !== e.target) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleRowClick();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex-shrink-0 w-7 h-7 rounded-lg ${categoryBg} flex items-center justify-center mt-0.5`}
        >
          {agentIconVariant === "claude" ? (
            <ClaudeIcon className="w-3.5 h-3.5 text-[#D97757]" />
          ) : agentIconVariant === "codex" ? (
            <CodexIcon className="w-3.5 h-3.5 text-white/90" />
          ) : agentIconVariant === "gemini" ? (
            <GeminiIcon className="w-3.5 h-3.5 text-[#8AB4FF]/95" />
          ) : agentIconVariant === "opencode" ? (
            <OpenCodeIcon className="w-3.5 h-3.5 text-[#78D0A9]/95" />
          ) : issueSource === "jira" ? (
            <JiraIcon className={`w-3.5 h-3.5 ${integration.jira}`} />
          ) : issueSource === "linear" ? (
            <LinearIcon className={`w-3.5 h-3.5 ${integration.linear}`} />
          ) : (
            <Icon className={`w-3.5 h-3.5 ${categoryColor}`} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-xs ${text.primary} leading-relaxed`}>{event.title}</p>
          </div>
          {event.detail && <p className={`text-[10px] ${text.muted} mt-0.5`}>{event.detail}</p>}
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] ${text.dimmed}`}>
              {formatRelativeTime(event.timestamp)}
            </span>
            {event.projectName && (
              <span className={`text-[10px] ${text.dimmed}`}>{event.projectName}</span>
            )}
            {issueSource && issueId && onNavigateToIssue ? (
              claudeRelated && event.worktreeId && onNavigateToWorktree ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateToWorktree({ openClaudeTab: true });
                  }}
                  className="text-[10px] text-teal-400/70 hover:text-teal-400 transition-colors"
                >
                  {issueId}
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateToIssue();
                  }}
                  className="text-[10px] text-teal-400/70 hover:text-teal-400 transition-colors"
                >
                  {issueId}
                </button>
              )
            ) : issueId ? (
              <span className={`text-[10px] ${text.dimmed}`}>{issueId}</span>
            ) : null}
            {shouldShowWorktreeLink && event.worktreeId && onNavigateToWorktree ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateToWorktree({ openClaudeTab: claudeRelated });
                }}
                className="text-[10px] text-teal-400/70 hover:text-teal-400 transition-colors"
              >
                {event.worktreeId}
              </button>
            ) : shouldShowWorktreeLink && event.worktreeId ? (
              <span className={`text-[10px] ${text.dimmed}`}>{event.worktreeId}</span>
            ) : null}
          </div>

          {hasChildren && (
            <div className="mt-2 space-y-1.5 p-2.5">
              {items.map((item) => (
                <div key={item.key} className="flex items-center gap-2 text-[10px]">
                  <HookStatusIcon status={item.status} />
                  {item.itemType === "skill" ? (
                    <Sparkles className="w-3 h-3 text-pink-400/70 flex-shrink-0" />
                  ) : (
                    <Terminal className={`w-3 h-3 ${text.dimmed} flex-shrink-0`} />
                  )}
                  <span className={`font-medium ${text.secondary} truncate`}>{item.label}</span>
                  {item.detail && <span className={`${text.dimmed} truncate`}>{item.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {showUnreadDot && (
          <div className="flex-shrink-0 mt-2">
            <span className="block w-1.5 h-1.5 rounded-full bg-teal-400" />
          </div>
        )}
      </div>
    </div>
  );
}

interface ActivityBellProps {
  unreadCount: number;
  isOpen: boolean;
  onClick: () => void;
}

export function ActivityBell({ unreadCount, isOpen, onClick }: ActivityBellProps) {
  return (
    <button
      onClick={onClick}
      data-activity-bell="true"
      className={`p-1.5 rounded-md transition-colors duration-150 relative ${
        isOpen ? "bg-white/[0.08]" : "hover:bg-white/[0.06]"
      }`}
    >
      <Bell className={`w-4 h-4 ${isOpen ? "text-white" : text.muted}`} />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-teal-400 text-[8px] font-bold text-black px-0.5">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}
