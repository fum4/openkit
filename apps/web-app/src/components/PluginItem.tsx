import { useState } from "react";
import { Trash2 } from "lucide-react";

import type { PluginSummary } from "../types";
import { surface, text } from "../theme";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";
import { ClaudeIcon } from "../icons";
import { ToggleSwitch } from "./ToggleSwitch";

interface PluginItemProps {
  plugin: PluginSummary;
  isSelected: boolean;
  onSelect: () => void;
  onToggleEnabled: () => Promise<void>;
  onRemove: () => void;
  disabled?: boolean;
}

function parsePluginName(plugin: PluginSummary): { name: string; marketplace: string } {
  if (plugin.marketplace) {
    const name = plugin.name.replace(/@.*$/, "");
    return { name, marketplace: plugin.marketplace };
  }
  if (plugin.name.includes("@")) {
    const [name, marketplace] = plugin.name.split("@", 2);
    return { name, marketplace };
  }
  return { name: plugin.name, marketplace: "" };
}

export function PluginItem({
  plugin,
  isSelected,
  onSelect,
  onToggleEnabled,
  onRemove,
  disabled,
}: PluginItemProps) {
  const { name, marketplace } = parsePluginName(plugin);
  const [acting, setActing] = useState<string | null>(null);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActing("toggle");
    await onToggleEnabled();
    setActing(null);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove();
  };

  const badgeDot = plugin.error ? (
    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mr-2 bg-red-400" />
  ) : plugin.warning ? (
    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mr-2 bg-yellow-400" />
  ) : plugin.enabled ? (
    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mr-2 bg-teal-400" />
  ) : null;

  const tooltipText = plugin.error || plugin.warning;
  const tooltipDotColor = plugin.error ? "bg-red-400" : "bg-yellow-400";

  const item = (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full text-left px-3 py-2.5 transition-colors duration-150 border-l-2 ${
        isSelected
          ? `${surface.panelSelected} border-[#D4A574]/30`
          : `border-transparent hover:${surface.panelHover}`
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <ClaudeIcon
          className={`w-3.5 h-3.5 flex-shrink-0 transition-colors duration-150 [&>svg]:text-inherit ${isSelected ? "text-[#D97757]" : `${text.muted} group-hover:text-[#D97757]`}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium truncate ${isSelected ? text.primary : text.secondary}`}
            >
              {name}
            </span>
          </div>
          {marketplace && (
            <div className={`text-[10px] ${text.dimmed} truncate mt-0.5`}>{marketplace}</div>
          )}
        </div>

        {/* Status dot / Actions — fixed-height wrapper prevents reflow on hover */}
        <div className="flex-shrink-0 relative" style={{ width: 52, height: 16 }}>
          {acting ? (
            <div className="absolute inset-0 mr-[5px] flex items-center justify-end">
              <Spinner size="xs" className={acting === "remove" ? "text-red-400" : text.muted} />
            </div>
          ) : (
            <>
              <div className="absolute inset-0 flex items-center justify-end group-hover:hidden">
                {badgeDot}
              </div>
              <div className="absolute inset-0 hidden group-hover:flex items-center justify-end gap-2.5 mr-[4px]">
                <span
                  role="button"
                  onClick={disabled ? undefined : handleRemove}
                  className={`p-0.5 rounded transition-colors ${disabled ? "text-white/15 cursor-default" : "text-white/30 hover:text-red-400 hover:bg-red-400/15 cursor-pointer"}`}
                >
                  <Trash2 className="w-3 h-3" />
                </span>
                <ToggleSwitch
                  checked={plugin.enabled}
                  onToggle={handleToggle}
                  disabled={disabled}
                  size="sm"
                  checkedTrackClassName={
                    plugin.error
                      ? "bg-red-400/35"
                      : plugin.warning
                        ? "bg-yellow-400/35"
                        : "bg-accent/35"
                  }
                  checkedThumbClassName={
                    plugin.error ? "bg-red-400" : plugin.warning ? "bg-yellow-400" : "bg-accent"
                  }
                />
              </div>
            </>
          )}
        </div>
      </div>
    </button>
  );

  if (tooltipText) {
    return (
      <Tooltip
        text={
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tooltipDotColor}`} />
            {tooltipText}
          </span>
        }
        position="right"
      >
        {item}
      </Tooltip>
    );
  }

  return item;
}
