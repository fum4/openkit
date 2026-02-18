import { motion } from "motion/react";
import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  FishingHook,
  GitBranch,
  Link,
  Loader2,
  Monitor,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ActivityEvent } from "../hooks/api";
import type { HookFeedItem } from "../hooks/useActivityFeed";
import { activity, text } from "../theme";

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
  return event.metadata?.requiresUserAction === true;
}

function hookItems(event: ActivityEvent): HookFeedItem[] {
  const items = event.metadata?.hookItems as HookFeedItem[] | undefined;
  return Array.isArray(items) ? items : [];
}

function HookStatusIcon({ status }: { status: HookFeedItem["status"] }) {
  if (status === "running") return <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
  if (status === "failed") return <X className="w-3.5 h-3.5 text-red-400" />;
  return <Check className="w-3.5 h-3.5 text-emerald-400" />;
}

interface ActivityFeedProps {
  events: ActivityEvent[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onClose: () => void;
  onNavigateToWorktree?: (worktreeId: string) => void;
}

export function ActivityFeed({
  events,
  unreadCount,
  onMarkAllRead,
  onClearAll,
  onClose,
  onNavigateToWorktree,
}: ActivityFeedProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [expandedHookGroups, setExpandedHookGroups] = useState<Set<string>>(new Set());

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

  const actionRequiredEvents = useMemo(() => events.filter(isActionRequired), [events]);
  const regularEvents = useMemo(() => events.filter((event) => !isActionRequired(event)), [events]);

  const toggleHookExpanded = (eventId: string) => {
    setExpandedHookGroups((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

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
        <h3 className={`text-sm font-medium ${text.primary}`}>Activity</h3>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Bell className={`w-8 h-8 ${text.dimmed} mb-2`} />
            <p className={`text-xs ${text.dimmed}`}>No activity yet</p>
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
                    onNavigateToWorktree={onNavigateToWorktree}
                    isHookExpanded={expandedHookGroups.has(event.id)}
                    onToggleHookExpanded={() => toggleHookExpanded(event.id)}
                  />
                ))}
              </div>
            )}

            {regularEvents.map((event) => (
              <ActivityRow
                key={event.id}
                event={event}
                onNavigateToWorktree={onNavigateToWorktree}
                isHookExpanded={expandedHookGroups.has(event.id)}
                onToggleHookExpanded={() => toggleHookExpanded(event.id)}
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
  onNavigateToWorktree,
  isHookExpanded,
  onToggleHookExpanded,
}: {
  event: ActivityEvent;
  onNavigateToWorktree?: (worktreeId: string) => void;
  isHookExpanded: boolean;
  onToggleHookExpanded: () => void;
}) {
  const hookEvent = isHookEvent(event);
  const Icon = hookEvent ? FishingHook : CATEGORY_ICONS[event.category] ?? Monitor;
  const categoryColor = hookEvent
    ? "text-emerald-300"
    : activity.categoryColor[event.category] ?? "text-[#6b7280]";
  const categoryBg = hookEvent
    ? "bg-emerald-500/10"
    : activity.categoryBg[event.category] ?? "bg-white/[0.06]";
  const severityDot = event.severity !== "info" ? activity.severityDot[event.severity] : null;
  const items = hookItems(event);
  const hasChildren = hookEvent && items.length > 0;

  return (
    <div className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-start gap-3">
        <div
          className={`flex-shrink-0 w-7 h-7 rounded-lg ${categoryBg} flex items-center justify-center mt-0.5`}
        >
          <Icon className={`w-3.5 h-3.5 ${categoryColor}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-xs ${text.primary} leading-relaxed`}>{event.title}</p>
            {hasChildren && (
              <button
                onClick={onToggleHookExpanded}
                className={`p-0.5 rounded ${text.dimmed} hover:text-white hover:bg-white/[0.06] transition-colors`}
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${isHookExpanded ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </div>
          {event.detail && <p className={`text-[10px] ${text.muted} mt-0.5`}>{event.detail}</p>}
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] ${text.dimmed}`}>{formatRelativeTime(event.timestamp)}</span>
            {event.projectName && <span className={`text-[10px] ${text.dimmed}`}>{event.projectName}</span>}
            {event.worktreeId && onNavigateToWorktree ? (
              <button
                onClick={() => onNavigateToWorktree(event.worktreeId!)}
                className="text-[10px] text-teal-400/70 hover:text-teal-400 transition-colors"
              >
                {event.worktreeId}
              </button>
            ) : event.worktreeId ? (
              <span className={`text-[10px] ${text.dimmed}`}>{event.worktreeId}</span>
            ) : null}
          </div>

          {hasChildren && isHookExpanded && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
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

        {severityDot && (
          <div className="flex-shrink-0 mt-2">
            <span className={`block w-1.5 h-1.5 rounded-full ${severityDot}`} />
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
