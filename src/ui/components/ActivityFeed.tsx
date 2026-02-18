import { motion } from "motion/react";
import { Bell, Bot, Check, GitBranch, Link, Monitor, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ActivityEvent } from "../hooks/api";
import type { ActivityCategory } from "../hooks/useActivityFeed";
import { activity, text } from "../theme";

const CATEGORY_ICONS: Record<string, typeof Bot> = {
  agent: Bot,
  worktree: GitBranch,
  git: GitBranch,
  integration: Link,
  system: Monitor,
};

const FILTER_OPTIONS: { id: ActivityCategory | null; label: string }[] = [
  { id: null, label: "All" },
  { id: "agent", label: "Agent" },
  { id: "worktree", label: "Worktree" },
];

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

interface ActivityFeedProps {
  events: ActivityEvent[];
  unreadCount: number;
  filter: ActivityCategory | null;
  onFilterChange: (filter: ActivityCategory | null) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onClose: () => void;
  onNavigateToWorktree?: (worktreeId: string) => void;
}

export function ActivityFeed({
  events,
  unreadCount,
  filter,
  onFilterChange,
  onMarkAllRead,
  onClearAll,
  onClose,
  onNavigateToWorktree,
}: ActivityFeedProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay adding the listener so the current click doesn't immediately close it
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="absolute right-0 top-full mt-2 w-[420px] max-h-[500px] rounded-xl bg-[#12151a] border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden z-50"
    >
      {/* Header */}
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

      {/* Filter chips */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.06] overflow-x-auto">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            onClick={() => onFilterChange(opt.id)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors whitespace-nowrap ${
              filter === opt.id
                ? "bg-white/[0.10] text-white"
                : `${text.muted} hover:text-[#9ca3af] hover:bg-white/[0.04]`
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Bell className={`w-8 h-8 ${text.dimmed} mb-2`} />
            <p className={`text-xs ${text.dimmed}`}>No activity yet</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {events.map((event) => {
              const Icon = CATEGORY_ICONS[event.category] ?? Monitor;
              const categoryColor = activity.categoryColor[event.category] ?? "text-[#6b7280]";
              const categoryBg = activity.categoryBg[event.category] ?? "bg-white/[0.06]";
              const severityDot =
                event.severity !== "info" ? activity.severityDot[event.severity] : null;

              return (
                <div
                  key={event.id}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
                >
                  {/* Category icon */}
                  <div
                    className={`flex-shrink-0 w-7 h-7 rounded-lg ${categoryBg} flex items-center justify-center mt-0.5`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${categoryColor}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs ${text.primary} leading-relaxed`}>{event.title}</p>
                    {event.detail && (
                      <p className={`text-[10px] ${text.muted} mt-0.5 truncate`}>{event.detail}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] ${text.dimmed}`}>
                        {formatRelativeTime(event.timestamp)}
                      </span>
                      {event.projectName && (
                        <span className={`text-[10px] ${text.dimmed}`}>{event.projectName}</span>
                      )}
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
                  </div>

                  {/* Severity dot */}
                  {severityDot && (
                    <div className="flex-shrink-0 mt-2">
                      <span className={`block w-1.5 h-1.5 rounded-full ${severityDot}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
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
