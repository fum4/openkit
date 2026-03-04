import { Bot, Trash2 } from "lucide-react";

import type { ClaudeAgentSummary } from "../types";
import { surface, text } from "../theme";
import { ToggleSwitch } from "./ToggleSwitch";

interface AgentItemProps {
  agent: ClaudeAgentSummary;
  isSelected: boolean;
  onSelect: () => void;
  isEnabled?: boolean;
  onToggleEnabled?: () => void;
  onRemove?: () => void;
}

export function AgentItem({
  agent,
  isSelected,
  onSelect,
  isEnabled,
  onToggleEnabled,
  onRemove,
}: AgentItemProps) {
  const isCustom = agent.isCustom === true;
  const subtitle = isCustom
    ? "custom"
    : agent.marketplace && agent.marketplace !== "local"
      ? `${agent.pluginName} @ ${agent.marketplace}`
      : agent.pluginName;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleEnabled?.();
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.();
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full text-left px-3 py-2.5 transition-colors duration-150 border-l-2 ${
        isSelected
          ? `${surface.panelSelected} border-cyan-400/30`
          : `border-transparent hover:${surface.panelHover}`
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Bot
          className={`w-3.5 h-3.5 flex-shrink-0 transition-colors duration-150 ${
            isSelected ? "text-cyan-400" : `${text.muted} group-hover:text-cyan-400`
          }`}
        />
        <div className="flex-1 min-w-0">
          <span
            className={`text-xs font-medium truncate block ${
              isSelected ? text.primary : text.secondary
            }`}
          >
            {agent.name}
          </span>
          <span className={`text-[10px] ${text.dimmed} truncate block`}>{subtitle}</span>
        </div>

        <div className="flex-shrink-0 relative" style={{ width: 52, height: 16 }}>
          <div className="absolute inset-0 flex items-center justify-end group-hover:hidden">
            {(isCustom ? isEnabled : agent.pluginEnabled) && (
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0 mr-2" />
            )}
          </div>
          {onToggleEnabled ? (
            <div className="absolute inset-0 hidden group-hover:flex items-center justify-end gap-2.5 mr-[4px]">
              {onRemove && (
                <span
                  role="button"
                  onClick={handleRemove}
                  className="p-0.5 rounded text-white/30 hover:text-red-400 hover:bg-red-400/15 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </span>
              )}
              <ToggleSwitch checked={!!isEnabled} onToggle={handleToggle} size="sm" />
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}
