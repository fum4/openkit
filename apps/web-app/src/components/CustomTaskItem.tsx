import { GitBranch } from "lucide-react";

import type { CustomTaskSummary } from "../types";
import { customTask, surface, text } from "../theme";
import { Tooltip } from "./Tooltip";

interface CustomTaskItemProps {
  task: CustomTaskSummary;
  isSelected: boolean;
  onSelect: () => void;
  onViewWorktree?: (worktreeId: string) => void;
  showPriority?: boolean;
  showStatus?: boolean;
}

export function CustomTaskItem({
  task,
  isSelected,
  onSelect,
  onViewWorktree,
  showPriority = true,
  showStatus = true,
}: CustomTaskItemProps) {
  const statusClasses = customTask.status[task.status] ?? customTask.status.todo;

  const statusLabel =
    task.status === "in-progress" ? "In Progress" : task.status === "todo" ? "Todo" : "Done";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full px-3 py-2.5 text-left transition-colors duration-150 border-l-2 ${
        isSelected
          ? `${surface.panelSelected} border-amber-400/60`
          : `border-transparent hover:${surface.panelHover}`
      }`}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] font-semibold text-amber-500 flex-shrink-0`}>
              {task.id}
            </span>
            {showStatus && (
              <span
                className={`text-[9px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${statusClasses}`}
              >
                {statusLabel}
              </span>
            )}
            {showPriority && (
              <span className={`text-[10px] ${customTask.priority[task.priority] ?? text.muted}`}>
                {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
              </span>
            )}
          </div>
          <div className={`text-xs ${text.primary} truncate mt-0.5`}>{task.title}</div>
        </div>
        {task.linkedWorktreeId && (
          <Tooltip position="right" text="View worktree">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onViewWorktree?.(task.linkedWorktreeId!);
              }}
              className="flex-shrink-0 p-0.5 rounded text-[#6b7280] hover:text-teal-400 hover:bg-teal-400/10 transition-colors duration-150 self-center"
            >
              <GitBranch className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
    </button>
  );
}
