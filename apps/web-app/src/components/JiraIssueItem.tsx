import { GitBranch } from "lucide-react";
import type { JiraIssueSummary } from "../types";
import { jiraPriority, jiraStatus, surface, text } from "../theme";
import { Tooltip } from "./Tooltip";

interface JiraIssueItemProps {
  issue: JiraIssueSummary;
  isSelected: boolean;
  onSelect: () => void;
  linkedWorktreeId?: string;
  onViewWorktree?: (worktreeId: string) => void;
  showPriority?: boolean;
  showStatus?: boolean;
}

export function JiraIssueItem({
  issue,
  isSelected,
  onSelect,
  linkedWorktreeId,
  onViewWorktree,
  showPriority = true,
  showStatus = true,
}: JiraIssueItemProps) {
  const statusLower = issue.status.toLowerCase();
  const statusClasses = jiraStatus[statusLower] ?? `${text.secondary} bg-white/[0.06]`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full px-3 py-2.5 text-left transition-colors duration-150 border-l-2 ${
        isSelected
          ? `${surface.panelSelected} border-blue-400/60`
          : `border-transparent hover:${surface.panelHover}`
      }`}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] font-semibold text-blue-400 flex-shrink-0`}>
              {issue.key}
            </span>
            {showStatus && (
              <span
                className={`ml-1 text-[9px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${statusClasses}`}
              >
                {issue.status}
              </span>
            )}
            {showPriority && (
              <span
                className={`text-[10px] ${jiraPriority[issue.priority.toLowerCase()] ?? text.muted}`}
              >
                {issue.priority}
              </span>
            )}
          </div>
          <div className={`text-xs ${text.primary} truncate mt-0.5`}>{issue.summary}</div>
        </div>
        {linkedWorktreeId && (
          <Tooltip position="right" text="View worktree">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onViewWorktree?.(linkedWorktreeId);
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
