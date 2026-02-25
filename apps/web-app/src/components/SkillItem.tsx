import { Sparkles, Trash2 } from "lucide-react";

import type { SkillSummary } from "../types";
import { skill as skillTheme, surface, text } from "../theme";
import { ToggleSwitch } from "./ToggleSwitch";

interface SkillItemProps {
  skill: SkillSummary;
  isSelected: boolean;
  onSelect: () => void;
  isDeployed?: boolean;
  onDeploy: () => void;
  onRemove: () => void;
}

export function SkillItem({
  skill,
  isSelected,
  onSelect,
  isDeployed,
  onDeploy,
  onRemove,
}: SkillItemProps) {
  const handleDeploy = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeploy();
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove();
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full text-left px-3 py-2.5 transition-colors duration-150 border-l-2 ${
        isSelected
          ? `${surface.panelSelected} ${skillTheme.accentBorder}`
          : `border-transparent hover:${surface.panelHover}`
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Sparkles
          className={`w-3.5 h-3.5 flex-shrink-0 transition-colors duration-150 ${isSelected ? "text-pink-400" : `${text.muted} group-hover:text-pink-400`}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium truncate ${isSelected ? text.primary : text.secondary}`}
            >
              {skill.displayName}
            </span>
          </div>
          {skill.description && (
            <div className={`text-[10px] ${text.dimmed} truncate mt-0.5`}>{skill.description}</div>
          )}
        </div>

        {/* Status dot / Actions — fixed-height wrapper prevents reflow on hover */}
        <div className="flex-shrink-0 relative" style={{ width: 52, height: 16 }}>
          <div className="absolute inset-0 flex items-center justify-end group-hover:hidden">
            {isDeployed && (
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mr-2 bg-teal-400" />
            )}
          </div>
          <div className="absolute inset-0 hidden group-hover:flex items-center justify-end gap-2.5 mr-[4px]">
            <span
              role="button"
              onClick={handleRemove}
              className="p-0.5 rounded text-white/30 hover:text-red-400 hover:bg-red-400/15 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
            </span>
            <ToggleSwitch checked={!!isDeployed} onToggle={handleDeploy} size="sm" />
          </div>
        </div>
      </div>
    </button>
  );
}
