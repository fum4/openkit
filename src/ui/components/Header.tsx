import { AnimatePresence } from "motion/react";
import { useState } from "react";

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
  onNavigateToWorktree?: (worktreeId: string) => void;
}

export function Header({ activeView, onChangeView, onNavigateToWorktree }: HeaderProps) {
  const [feedOpen, setFeedOpen] = useState(false);
  const { events, unreadCount, markAllRead, clearAll } = useActivityFeed();

  const handleToggleFeed = () => {
    setFeedOpen((prev) => {
      if (!prev) {
        setTimeout(() => markAllRead(), 500);
      }
      return !prev;
    });
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
        <div className="relative">
          <ActivityBell unreadCount={unreadCount} isOpen={feedOpen} onClick={handleToggleFeed} />
          <AnimatePresence>
            {feedOpen && (
              <ActivityFeed
                events={events}
                unreadCount={unreadCount}
                onMarkAllRead={markAllRead}
                onClearAll={clearAll}
                onClose={() => setFeedOpen(false)}
                onNavigateToWorktree={onNavigateToWorktree}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
