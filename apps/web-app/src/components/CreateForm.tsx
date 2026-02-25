import { useEffect, useRef, useState } from "react";
import { GitBranch, ListTodo, Plus } from "lucide-react";

import { integration, surface, tab, text } from "../theme";
import { JiraIcon, LinearIcon } from "../icons";

interface CreateFormProps {
  jiraConfigured: boolean;
  linearConfigured: boolean;
  activeTab: "branch" | "issues";
  onTabChange: (tab: "branch" | "issues") => void;
  onCreateWorktree: () => void;
  onCreateFromJira: () => void;
  onCreateFromLinear: () => void;
  onCreateCustomTask: () => void;
  onNavigateToIntegrations: () => void;
}

export function CreateForm({
  jiraConfigured,
  linearConfigured,
  activeTab,
  onTabChange,
  onCreateWorktree,
  onCreateFromJira,
  onCreateFromLinear,
  onCreateCustomTask,
  onNavigateToIntegrations,
}: CreateFormProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showMenu) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const handleToggleMenu = () => {
    if (!showMenu && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.top, left: rect.right + 4 });
    }
    setShowMenu(!showMenu);
  };

  const menuItemClass = `w-full flex items-center gap-2.5 px-3 py-2 text-xs ${text.secondary} hover:bg-white/[0.06] transition-colors`;

  return (
    <div className="px-3 pt-3.5 pb-2 flex items-center justify-between gap-2">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onTabChange("branch")}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors duration-150 ${
            activeTab === "branch" ? tab.active : tab.inactive
          }`}
        >
          Worktrees
        </button>
        <button
          type="button"
          onClick={() => onTabChange("issues")}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors duration-150 ${
            activeTab === "issues" ? tab.active : tab.inactive
          }`}
        >
          Issues
        </button>
      </div>

      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleMenu}
        className={`p-1 rounded-md ${text.muted} hover:${text.secondary} hover:bg-white/[0.06] transition-colors duration-150`}
      >
        <Plus className="w-4 h-4" />
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left }}
          className={`fixed w-48 ${surface.panel} rounded-lg border border-white/[0.08] shadow-xl overflow-hidden z-50`}
        >
          <button
            type="button"
            onClick={() => {
              setShowMenu(false);
              onCreateWorktree();
            }}
            className={menuItemClass}
          >
            <GitBranch className={`w-4 h-4 ${integration.worktree}`} />
            Create worktree
          </button>
          <button
            type="button"
            onClick={() => {
              setShowMenu(false);
              onCreateCustomTask();
            }}
            className={menuItemClass}
          >
            <ListTodo className={`w-4 h-4 ${integration.localIssue}`} />
            Create task
          </button>
          {(jiraConfigured || linearConfigured) && (
            <>
              {jiraConfigured && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    onCreateFromJira();
                  }}
                  className={menuItemClass}
                >
                  <JiraIcon className={`w-4 h-4 ${integration.jira}`} />
                  Pull from Jira
                </button>
              )}
              {linearConfigured && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    onCreateFromLinear();
                  }}
                  className={menuItemClass}
                >
                  <LinearIcon className={`w-4 h-4 ${integration.linear}`} />
                  Pull from Linear
                </button>
              )}
            </>
          )}
          {(!jiraConfigured || !linearConfigured) && (
            <>
              <div className="border-t border-white/[0.06]" />
              {!jiraConfigured && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    onNavigateToIntegrations();
                  }}
                  className={menuItemClass}
                >
                  <JiraIcon className={`w-4 h-4 ${integration.jira}`} />
                  Configure Jira
                </button>
              )}
              {!linearConfigured && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    onNavigateToIntegrations();
                  }}
                  className={menuItemClass}
                >
                  <LinearIcon className={`w-4 h-4 ${integration.linear}`} />
                  Configure Linear
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
