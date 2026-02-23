import { useEffect, useRef, useState } from "react";
import { Plus, ScanSearch, Search, Server, Sparkles } from "lucide-react";

import { ClaudeIcon } from "../icons";
import { skill, input, integration, surface, text } from "../theme";

interface AgentsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onAddServer: () => void;
  onAddSkill: () => void;
  onAddPlugin: () => void;
  onScanImport: () => void;
  hasItems: boolean;
}

export function AgentsToolbar({
  search,
  onSearchChange,
  onAddServer,
  onAddSkill,
  onAddPlugin,
  onScanImport,
}: AgentsToolbarProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showAddMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAddMenu]);

  const handleToggleMenu = () => {
    if (!showAddMenu && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.top, left: rect.right + 4 });
    }
    setShowAddMenu(!showAddMenu);
  };

  const menuItemClass = `w-full flex items-center gap-2.5 px-3 py-2 text-xs ${text.secondary} hover:bg-white/[0.06] transition-colors`;

  return (
    <>
      <div className="flex-shrink-0 px-3 pt-3.5 pb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[#6b7280] ml-2">Agents</span>
        <button
          ref={buttonRef}
          type="button"
          onClick={handleToggleMenu}
          className={`p-1 rounded-md ${text.muted} hover:${text.secondary} hover:bg-white/[0.06] transition-colors duration-150`}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {showAddMenu && (
        <div
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left }}
          className={`fixed w-48 ${surface.panel} rounded-lg border border-white/[0.08] shadow-xl overflow-hidden z-50`}
        >
          <button
            type="button"
            onClick={() => {
              setShowAddMenu(false);
              onAddServer();
            }}
            className={menuItemClass}
          >
            <Server className={`w-4 h-4 ${integration.mcp}`} />
            MCP Server
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddMenu(false);
              onAddSkill();
            }}
            className={menuItemClass}
          >
            <Sparkles className={`w-4 h-4 ${skill.accent}`} />
            Skill
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddMenu(false);
              onAddPlugin();
            }}
            className={menuItemClass}
          >
            <ClaudeIcon className="w-4 h-4 text-[#D97757] [&>svg]:text-inherit" />
            Claude Plugin
          </button>
          <div className="border-t border-white/[0.06]" />
          <button
            type="button"
            onClick={() => {
              setShowAddMenu(false);
              onScanImport();
            }}
            className={menuItemClass}
          >
            <ScanSearch className="w-4 h-4 text-[#9ca3af]" />
            Scan & Import
          </button>
        </div>
      )}

      <div className="px-3 pt-2 pb-3">
        <div className="relative">
          <Search
            className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${text.dimmed}`}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter servers, skills, plugins..."
            className={`w-full pl-8 pr-2.5 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md ${input.text} placeholder-[#4b5563] text-xs focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.15] transition-all duration-150`}
          />
        </div>
      </div>
    </>
  );
}
