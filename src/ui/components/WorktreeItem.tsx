import { ListTodo } from "lucide-react";

import type { WorktreeInfo } from "../types";
import { border, status, surface, text } from "../theme";
import { JiraIcon, LinearIcon } from "./icons";
import { Tooltip } from "./Tooltip";

interface WorktreeItemProps {
  worktree: WorktreeInfo;
  isSelected: boolean;
  onSelect: () => void;
  hasLocalIssue?: boolean;
  onSelectJiraIssue?: (key: string) => void;
  onSelectLinearIssue?: (identifier: string) => void;
  onSelectLocalIssue?: (identifier: string) => void;
}

export function WorktreeItem({
  worktree,
  isSelected,
  onSelect,
  hasLocalIssue,
  onSelectJiraIssue,
  onSelectLinearIssue,
  onSelectLocalIssue,
}: WorktreeItemProps) {
  const isRunning = worktree.status === "running";
  const isCreating = worktree.status === "creating";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-left transition-colors duration-150 border-l ${
        isSelected
          ? `${surface.panelSelected} ${border.accent}`
          : `border-transparent hover:${surface.panelHover}`
      }`}
    >
      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isCreating
            ? `${status.creating.dot} animate-pulse`
            : isRunning
              ? `${status.running.dot} ${status.running.glow}`
              : status.stopped.dot
        }`}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-semibold ${text.primary} truncate`}>{worktree.id}</span>
          {worktree.hasUncommitted && (
            <Tooltip position="right" text="Uncommitted changes">
              <span
                className={`w-1.5 h-1.5 rounded-full ${status.uncommitted.dot} flex-shrink-0`}
              />
            </Tooltip>
          )}
        </div>
        <div className={`text-[11px] ${text.muted} truncate mt-0.5`}>
          {isCreating ? worktree.statusMessage || "Creating..." : worktree.branch}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {worktree.jiraUrl &&
          (() => {
            const key = worktree.jiraUrl!.match(/\/browse\/([A-Z]+-\d+)/)?.[1];
            return (
              <Tooltip position="right" text="View issue">
                <span
                  className="cursor-pointer p-1 -m-1 rounded text-[#6b7280] hover:text-blue-400 hover:bg-blue-400/10 transition-colors duration-150"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (key) onSelectJiraIssue?.(key);
                  }}
                >
                  <JiraIcon className="w-3.5 h-3.5" />
                </span>
              </Tooltip>
            );
          })()}
        {worktree.linearUrl &&
          (() => {
            const id = worktree.linearUrl!.match(/\/issue\/([A-Z]+-\d+)/)?.[1];
            return (
              <Tooltip position="right" text="View issue">
                <span
                  className="cursor-pointer p-1 -m-1 rounded text-[#6b7280] hover:text-[#5E6AD2] hover:bg-[#5E6AD2]/10 transition-colors duration-150"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (id) onSelectLinearIssue?.(id);
                  }}
                >
                  <LinearIcon className="w-3.5 h-3.5" />
                </span>
              </Tooltip>
            );
          })()}
        {hasLocalIssue && worktree.localIssueId && (
          <Tooltip position="right" text="View issue">
            <span
              className="cursor-pointer p-1 -m-1 rounded text-[#6b7280] hover:text-amber-400 hover:bg-amber-400/10 transition-colors duration-150"
              onClick={(e) => {
                e.stopPropagation();
                onSelectLocalIssue?.(worktree.localIssueId!);
              }}
            >
              <ListTodo className="w-3.5 h-3.5" />
            </span>
          </Tooltip>
        )}
        {worktree.githubPrUrl && (
          <Tooltip position="right" text={`PR: ${worktree.githubPrState}`}>
            <span
              className={`${
                worktree.githubPrState === "merged"
                  ? "text-purple-400"
                  : worktree.githubPrState === "open"
                    ? "text-emerald-400"
                    : text.secondary
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-3.5 h-3.5"
              >
                <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
              </svg>
            </span>
          </Tooltip>
        )}
        {worktree.hasUnpushed && (
          <Tooltip position="right" text={`${worktree.commitsAhead || ""} unpushed`}>
            <span className={`text-[10px] font-medium ${text.primary}`}>
              {worktree.commitsAhead ? `↑${worktree.commitsAhead}` : "↑"}
            </span>
          </Tooltip>
        )}
      </div>
    </button>
  );
}
