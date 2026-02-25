import { useEffect, useMemo, useRef, useState } from "react";
import { Settings } from "lucide-react";

import type {
  CustomTaskSummary,
  JiraIssueSummary,
  LinearIssueSummary,
  WorktreeInfo,
} from "../types";
import { border, text } from "../theme";
import { Tooltip } from "./Tooltip";
import { CustomTaskList } from "./CustomTaskList";
import { JiraIssueList } from "./JiraIssueList";
import { LinearIssueList } from "./LinearIssueList";

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`w-3 h-3 ${text.muted} transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
    >
      <path
        fillRule="evenodd"
        d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function RefreshIcon({
  spinning,
  onClick,
  tooltip,
}: {
  spinning: boolean;
  onClick: () => void;
  tooltip: string;
}) {
  return (
    <Tooltip position="right" text={tooltip}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={`ml-auto -mr-1 p-1 rounded-md ${text.muted} hover:text-white transition-colors duration-150`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`w-3 h-3 ${spinning ? "animate-spin" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.681.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-.908l.84.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44.908l-.84-.84v1.456a.75.75 0 0 1-1.5 0V9.341a.75.75 0 0 1 .75-.75h3.182a.75.75 0 0 1 0 1.5h-1.37l.84.841a4.5 4.5 0 0 0 7.08-.681.75.75 0 0 1 1.024-.274Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </Tooltip>
  );
}

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

interface IssueListProps {
  // Jira
  issues: JiraIssueSummary[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  onRefreshJira: () => void;
  jiraUpdatedAt: number;
  // Linear
  linearIssues: LinearIssueSummary[];
  linearConfigured: boolean;
  linearLoading: boolean;
  linearFetching: boolean;
  linearError: string | null;
  selectedLinearIdentifier: string | null;
  onSelectLinear: (identifier: string) => void;
  onRefreshLinear: () => void;
  linearUpdatedAt: number;
  // Custom tasks
  customTasks: CustomTaskSummary[];
  customTasksLoading: boolean;
  customTasksError: string | null;
  selectedCustomTaskId: string | null;
  onSelectCustomTask: (id: string) => void;
  // Shared
  worktrees: WorktreeInfo[];
  onViewWorktree: (worktreeId: string) => void;
}

export function IssueList({
  issues,
  selectedKey,
  onSelect,
  isLoading,
  isFetching,
  error,
  onRefreshJira,
  jiraUpdatedAt,
  linearIssues,
  linearConfigured,
  linearLoading,
  linearFetching,
  linearError,
  selectedLinearIdentifier,
  onSelectLinear,
  onRefreshLinear,
  linearUpdatedAt,
  customTasks,
  customTasksLoading,
  customTasksError,
  selectedCustomTaskId,
  onSelectCustomTask,
  worktrees,
  onViewWorktree,
}: IssueListProps) {
  const [linkedCollapsed, setLinkedCollapsed] = useState(false);
  const [jiraCollapsed, setJiraCollapsed] = useState(false);
  const [linearCollapsed, setLinearCollapsed] = useState(false);
  const [customCollapsed, setCustomCollapsed] = useState(false);
  const [showPriority, setShowPriority] = useState(() => {
    const saved = localStorage.getItem("OpenKit:issueShowPriority");
    return saved !== null ? saved === "1" : true;
  });
  const [showStatus, setShowStatus] = useState(() => {
    const saved = localStorage.getItem("OpenKit:issueShowStatus");
    return saved !== null ? saved === "1" : true;
  });
  const [configOpen, setConfigOpen] = useState(false);
  const configRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!configOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (configRef.current && !configRef.current.contains(e.target as Node)) {
        setConfigOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [configOpen]);

  useEffect(() => {
    localStorage.setItem("OpenKit:issueShowPriority", showPriority ? "1" : "0");
  }, [showPriority]);

  useEffect(() => {
    localStorage.setItem("OpenKit:issueShowStatus", showStatus ? "1" : "0");
  }, [showStatus]);

  // Build map of issueKey -> worktreeId (Jira)
  const linkedJiraWorktrees = useMemo(() => {
    const map = new Map<string, string>();
    for (const wt of worktrees) {
      if (wt.jiraUrl) {
        const match = wt.jiraUrl.match(/\/browse\/([A-Z]+-\d+)/);
        if (match) map.set(match[1], wt.id);
      }
    }
    return map;
  }, [worktrees]);

  // Build map of identifier -> worktreeId (Linear)
  const linkedLinearWorktrees = useMemo(() => {
    const map = new Map<string, string>();
    for (const wt of worktrees) {
      if (wt.linearUrl) {
        // Linear URLs look like https://linear.app/team/issue/ENG-123
        const match = wt.linearUrl.match(/\/issue\/([A-Z]+-\d+)/);
        if (match) map.set(match[1], wt.id);
      }
    }
    return map;
  }, [worktrees]);

  // Split Jira issues into linked and unlinked
  const linkedJiraIssues = useMemo(
    () => issues.filter((i) => linkedJiraWorktrees.has(i.key)),
    [issues, linkedJiraWorktrees],
  );
  const unlinkedJiraIssues = useMemo(
    () => issues.filter((i) => !linkedJiraWorktrees.has(i.key)),
    [issues, linkedJiraWorktrees],
  );

  // Split Linear issues into linked and unlinked
  const linkedLinearIssues = useMemo(
    () => linearIssues.filter((i) => linkedLinearWorktrees.has(i.identifier)),
    [linearIssues, linkedLinearWorktrees],
  );
  const unlinkedLinearIssues = useMemo(
    () => linearIssues.filter((i) => !linkedLinearWorktrees.has(i.identifier)),
    [linearIssues, linkedLinearWorktrees],
  );

  const linkedCustomTasks = useMemo(
    () => customTasks.filter((t) => t.linkedWorktreeId !== null),
    [customTasks],
  );
  const unlinkedCustomTasks = useMemo(
    () => customTasks.filter((t) => t.linkedWorktreeId === null),
    [customTasks],
  );

  const allLinkedCount =
    linkedJiraIssues.length + linkedLinearIssues.length + linkedCustomTasks.length;

  const jiraEmpty = unlinkedJiraIssues.length === 0 && !isLoading && !error;
  const linearEmpty = unlinkedLinearIssues.length === 0 && !linearLoading && !linearError;
  const customEmpty = unlinkedCustomTasks.length === 0 && !customTasksLoading && !customTasksError;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0 space-y-8">
        {/* With Worktrees section */}
        {allLinkedCount > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setLinkedCollapsed(!linkedCollapsed)}
              className="w-full px-3 py-1.5 mb-px flex items-center gap-2 transition-colors duration-150 hover:bg-white/[0.04]"
            >
              <ChevronIcon collapsed={linkedCollapsed} />
              <span className={`text-[11px] font-medium ${text.secondary}`}>With Worktrees</span>
              <span
                className={`text-[10px] ${text.muted} bg-white/[0.06] px-1.5 py-0.5 rounded-full`}
              >
                {allLinkedCount}
              </span>
            </button>

            {!linkedCollapsed && (
              <div className="space-y-px">
                {linkedJiraIssues.length > 0 && (
                  <JiraIssueList
                    issues={linkedJiraIssues}
                    selectedKey={selectedKey}
                    onSelect={onSelect}
                    isLoading={false}
                    isFetching={false}
                    error={null}
                    linkedWorktrees={linkedJiraWorktrees}
                    onViewWorktree={onViewWorktree}
                    showPriority={showPriority}
                    showStatus={showStatus}
                  />
                )}
                {linkedLinearIssues.length > 0 && (
                  <LinearIssueList
                    issues={linkedLinearIssues}
                    selectedIdentifier={selectedLinearIdentifier}
                    onSelect={onSelectLinear}
                    isLoading={false}
                    isFetching={false}
                    error={null}
                    linkedWorktrees={linkedLinearWorktrees}
                    onViewWorktree={onViewWorktree}
                    showPriority={showPriority}
                    showStatus={showStatus}
                  />
                )}
                {linkedCustomTasks.length > 0 && (
                  <CustomTaskList
                    tasks={linkedCustomTasks}
                    selectedId={selectedCustomTaskId}
                    onSelect={onSelectCustomTask}
                    isLoading={false}
                    error={null}
                    onViewWorktree={onViewWorktree}
                    showPriority={showPriority}
                    showStatus={showStatus}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Jira section */}
        {issues.length > 0 && (
          <div>
            <div
              className={`w-full pl-3 pr-4 py-1.5 mb-px flex items-center gap-2 transition-colors duration-150 ${
                jiraEmpty ? "" : "cursor-pointer"
              } hover:bg-white/[0.04]`}
              onClick={jiraEmpty ? undefined : () => setJiraCollapsed(!jiraCollapsed)}
            >
              {jiraEmpty ? (
                <span className={`w-3 h-3 flex items-center justify-center ${text.dimmed}`}>–</span>
              ) : (
                <ChevronIcon collapsed={jiraCollapsed} />
              )}
              <span className={`text-[11px] font-medium ${text.secondary}`}>Jira</span>
              {!isLoading && (
                <span
                  className={`text-[10px] ${text.muted} bg-white/[0.06] px-1.5 py-0.5 rounded-full`}
                >
                  {unlinkedJiraIssues.length}
                </span>
              )}

              <RefreshIcon
                spinning={isFetching && issues.length > 0}
                onClick={onRefreshJira}
                tooltip={
                  jiraUpdatedAt ? `Last refreshed: ${formatTimeAgo(jiraUpdatedAt)}` : "Refresh"
                }
              />
            </div>

            {!jiraEmpty && !jiraCollapsed && (
              <JiraIssueList
                issues={unlinkedJiraIssues}
                selectedKey={selectedKey}
                onSelect={onSelect}
                isLoading={isLoading}
                isFetching={isFetching}
                error={error}
                linkedWorktrees={linkedJiraWorktrees}
                onViewWorktree={onViewWorktree}
                showPriority={showPriority}
                showStatus={showStatus}
              />
            )}
          </div>
        )}

        {/* Show Jira loading/error states even when no issues yet */}
        {issues.length === 0 && (isLoading || error) && (
          <div>
            <div
              className={`w-full px-3 py-1.5 mb-px flex items-center gap-2 transition-colors duration-150 cursor-pointer hover:bg-white/[0.04]`}
              onClick={() => setJiraCollapsed(!jiraCollapsed)}
            >
              <ChevronIcon collapsed={jiraCollapsed} />
              <span className={`text-[11px] font-medium ${text.secondary}`}>Jira</span>

              <RefreshIcon
                spinning={isFetching}
                onClick={onRefreshJira}
                tooltip={
                  jiraUpdatedAt ? `Last refreshed: ${formatTimeAgo(jiraUpdatedAt)}` : "Refresh"
                }
              />
            </div>

            {!jiraCollapsed && (
              <JiraIssueList
                issues={[]}
                selectedKey={selectedKey}
                onSelect={onSelect}
                isLoading={isLoading}
                isFetching={isFetching}
                error={error}
                onViewWorktree={onViewWorktree}
                showPriority={showPriority}
                showStatus={showStatus}
              />
            )}
          </div>
        )}

        {/* Linear section */}
        {linearConfigured && (
          <div>
            <div
              className={`w-full pl-3 pr-4 py-1.5 mb-px flex items-center gap-2 transition-colors duration-150 ${
                linearEmpty ? "" : "cursor-pointer"
              } hover:bg-white/[0.04]`}
              onClick={linearEmpty ? undefined : () => setLinearCollapsed(!linearCollapsed)}
            >
              {linearEmpty ? (
                <span className={`w-3 h-3 flex items-center justify-center ${text.dimmed}`}>–</span>
              ) : (
                <ChevronIcon collapsed={linearCollapsed} />
              )}
              <span className={`text-[11px] font-medium ${text.secondary}`}>Linear</span>
              {!linearLoading && (
                <span
                  className={`text-[10px] ${text.muted} bg-white/[0.06] px-1.5 py-0.5 rounded-full`}
                >
                  {unlinkedLinearIssues.length}
                </span>
              )}

              <RefreshIcon
                spinning={linearFetching && linearIssues.length > 0}
                onClick={onRefreshLinear}
                tooltip={
                  linearUpdatedAt ? `Last refreshed: ${formatTimeAgo(linearUpdatedAt)}` : "Refresh"
                }
              />
            </div>

            {!linearEmpty && !linearCollapsed && (
              <LinearIssueList
                issues={unlinkedLinearIssues}
                selectedIdentifier={selectedLinearIdentifier}
                onSelect={onSelectLinear}
                isLoading={linearLoading}
                isFetching={linearFetching}
                error={linearError}
                linkedWorktrees={linkedLinearWorktrees}
                onViewWorktree={onViewWorktree}
                showPriority={showPriority}
                showStatus={showStatus}
              />
            )}
          </div>
        )}

        {/* Custom tasks section */}
        <div>
          <div
            className={`w-full px-3 py-1.5 mb-px flex items-center gap-2 transition-colors duration-150 ${
              customEmpty ? "" : "cursor-pointer"
            } hover:bg-white/[0.04]`}
            onClick={customEmpty ? undefined : () => setCustomCollapsed(!customCollapsed)}
          >
            {customEmpty ? (
              <span className={`w-3 h-3 flex items-center justify-center ${text.dimmed}`}>–</span>
            ) : (
              <ChevronIcon collapsed={customCollapsed} />
            )}
            <span className={`text-[11px] font-medium ${text.secondary}`}>Local</span>
            {!customTasksLoading && (
              <span
                className={`text-[10px] ${text.muted} bg-white/[0.06] px-1.5 py-0.5 rounded-full`}
              >
                {unlinkedCustomTasks.length}
              </span>
            )}
          </div>

          {!customEmpty && !customCollapsed && (
            <CustomTaskList
              tasks={unlinkedCustomTasks}
              selectedId={selectedCustomTaskId}
              onSelect={onSelectCustomTask}
              isLoading={customTasksLoading}
              error={customTasksError}
              onViewWorktree={onViewWorktree}
              showPriority={showPriority}
              showStatus={showStatus}
            />
          )}
        </div>
      </div>

      {/* Config bar */}
      <div className={`flex-shrink-0 border-t ${border.subtle} px-2 py-2`}>
        <div className="relative" ref={configRef}>
          <button
            type="button"
            onClick={() => setConfigOpen(!configOpen)}
            className={`p-1 rounded transition-colors duration-150 ${
              configOpen
                ? `${text.secondary} bg-white/[0.06]`
                : `${text.dimmed} hover:${text.secondary} hover:bg-white/[0.06]`
            }`}
          >
            <Settings className="w-[18px] h-[18px]" />
          </button>

          {configOpen && (
            <div className="absolute bottom-full left-0 mb-1 w-44 rounded-lg bg-[#1a1d24] border border-white/[0.08] shadow-xl py-1 z-50">
              <button
                type="button"
                onClick={() => setShowPriority(!showPriority)}
                className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-[11px] ${text.secondary} hover:bg-white/[0.04] transition-colors duration-150`}
              >
                <span
                  className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${
                    showPriority ? "bg-accent/20 border-accent/40" : "border-white/[0.15]"
                  }`}
                >
                  {showPriority && (
                    <svg
                      className="w-2 h-2 text-accent"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  )}
                </span>
                Show priority
              </button>
              <button
                type="button"
                onClick={() => setShowStatus(!showStatus)}
                className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-[11px] ${text.secondary} hover:bg-white/[0.04] transition-colors duration-150`}
              >
                <span
                  className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${
                    showStatus ? "bg-accent/20 border-accent/40" : "border-white/[0.15]"
                  }`}
                >
                  {showStatus && (
                    <svg
                      className="w-2 h-2 text-accent"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  )}
                </span>
                Show status
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
