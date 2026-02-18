import { Link, ListTodo } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { WorktreeInfo } from "../../types";
import { useApi } from "../../hooks/useApi";
import { action, border, detailTab, errorBanner, input, text } from "../../theme";
import { ConfirmDialog } from "../ConfirmDialog";
import { GitHubIcon } from "../icons";
import { DetailHeader } from "./DetailHeader";
import { GitActionInputs } from "./GitActionInputs";
import { LogsViewer } from "./LogsViewer";
import { TerminalView } from "./TerminalView";
import { HooksTab } from "./HooksTab";

// Persists across unmount/remount (view switches)
const tabCache: Record<string, "logs" | "terminal" | "hooks"> = {};

interface DetailPanelProps {
  worktree: WorktreeInfo | null;
  onUpdate: () => void;
  onDeleted: () => void;
  onNavigateToIntegrations?: () => void;
  onNavigateToHooks?: () => void;
  onSelectJiraIssue?: (key: string) => void;
  onSelectLinearIssue?: (identifier: string) => void;
  onSelectLocalIssue?: (identifier: string) => void;
  onCreateTask?: (worktreeId: string) => void;
  onLinkIssue?: (worktreeId: string) => void;
  hookUpdateKey?: number;
}

export function DetailPanel({
  worktree,
  onUpdate,
  onDeleted,
  onNavigateToIntegrations,
  onNavigateToHooks,
  onSelectJiraIssue,
  onSelectLinearIssue,
  onSelectLocalIssue,
  onCreateTask,
  onLinkIssue,
  hookUpdateKey,
}: DetailPanelProps) {
  const api = useApi();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [showCreatePrInput, setShowCreatePrInput] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [isGitLoading, setIsGitLoading] = useState(false);
  const [gitAction, setGitAction] = useState<"commit" | "push" | "pr" | null>(null);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [tabPerWorktree, setTabPerWorktree] = useState<
    Record<string, "logs" | "terminal" | "hooks">
  >(() => ({ ...tabCache }));
  const [openTerminals, setOpenTerminals] = useState<Set<string>>(new Set());

  const activeTab = worktree ? (tabPerWorktree[worktree.id] ?? "logs") : "logs";

  const setActiveTab = useCallback(
    (tab: "logs" | "terminal" | "hooks") => {
      if (!worktree) return;
      tabCache[worktree.id] = tab;
      setTabPerWorktree((prev) => ({ ...prev, [worktree.id]: tab }));
    },
    [worktree],
  );

  // Reset form state when worktree changes (but NOT tab or terminal state)
  useEffect(() => {
    setError(null);
    setShowCommitInput(false);
    setShowCreatePrInput(false);
    setCommitMessage("");
    setPrTitle("");
    setGitAction(null);
  }, [worktree?.id]);

  if (!worktree) {
    return (
      <div className={`flex-1 flex items-center justify-center ${text.dimmed} text-sm`}>
        Select a worktree or create a new one
      </div>
    );
  }

  const isRunning = worktree.status === "running";
  const isCreating = worktree.status === "creating";

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    const result = await api.startWorktree(worktree.id);
    setIsLoading(false);
    if (!result.success) setError(result.error || "Failed to start");
    onUpdate();
  };

  const handleStop = async () => {
    setIsLoading(true);
    setError(null);
    const result = await api.stopWorktree(worktree.id);
    setIsLoading(false);
    if (!result.success) setError(result.error || "Failed to stop");
    onUpdate();
  };

  const handleRemove = () => setShowRemoveModal(true);

  const handleConfirmRemove = async () => {
    setShowRemoveModal(false);
    setError(null);
    const deletedId = worktree.id;

    // Clean up state for this worktree
    setOpenTerminals((prev) => {
      const next = new Set(prev);
      next.delete(deletedId);
      return next;
    });
    setTabPerWorktree((prev) => {
      const { [deletedId]: _, ...rest } = prev;
      return rest;
    });

    // Switch away immediately so user isn't stuck on "deleting" screen
    onDeleted();

    // Delete in background - worktree will disappear from list via SSE update
    const result = await api.removeWorktree(deletedId);
    if (!result.success) {
      // Show error somewhere? For now just log it
      console.error("Failed to remove worktree:", result.error);
    }
    onUpdate();
  };

  const handleRename = async (changes: { name?: string; branch?: string }): Promise<boolean> => {
    setError(null);
    const result = await api.renameWorktree(worktree.id, changes);
    if (!result.success) setError(result.error || "Failed to rename");
    onUpdate();
    return result.success;
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setIsGitLoading(true);
    setGitAction("commit");
    setError(null);
    try {
      const result = await api.commitChanges(worktree.id, commitMessage.trim());
      if (result.success) {
        setShowCommitInput(false);
        setCommitMessage("");
      } else {
        setError(result.error || "Failed to commit");
      }
      onUpdate();
    } finally {
      setIsGitLoading(false);
      setGitAction(null);
    }
  };

  const handlePush = async () => {
    setIsGitLoading(true);
    setGitAction("push");
    setError(null);
    try {
      const result = await api.pushChanges(worktree.id);
      if (!result.success) setError(result.error || "Failed to push");
      onUpdate();
    } finally {
      setIsGitLoading(false);
      setGitAction(null);
    }
  };

  const handleCreatePr = async () => {
    if (!prTitle.trim()) return;
    setIsGitLoading(true);
    setGitAction("pr");
    setError(null);
    try {
      const result = await api.createPullRequest(worktree.id, prTitle.trim());
      if (result.success) {
        setShowCreatePrInput(false);
        setPrTitle("");
      } else {
        setError(result.error || "Failed to create PR");
      }
      onUpdate();
    } finally {
      setIsGitLoading(false);
      setGitAction(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <DetailHeader
        worktree={worktree}
        isRunning={isRunning}
        isCreating={isCreating}
        isLoading={isLoading}
        onRename={handleRename}
        onStart={handleStart}
        onStop={handleStop}
        onRemove={handleRemove}
        onSelectJiraIssue={onSelectJiraIssue}
        onSelectLinearIssue={onSelectLinearIssue}
        onSelectLocalIssue={onSelectLocalIssue}
      />

      {error && (
        <div
          className={`flex-shrink-0 px-5 py-2 ${errorBanner.panelBg} border-b ${errorBanner.border} flex items-center justify-between`}
        >
          <p className={`${text.error} text-xs`}>{error}</p>
          {error.includes("integration not available") && onNavigateToIntegrations && (
            <button
              type="button"
              onClick={onNavigateToIntegrations}
              className="px-2 py-0.5 text-[11px] font-medium text-accent hover:text-accent-muted transition-colors duration-150 flex-shrink-0"
            >
              Configure
            </button>
          )}
        </div>
      )}

      {!isCreating && (
        <div
          className={`flex-shrink-0 h-11 flex items-center justify-between px-4 border-b ${border.section}`}
        >
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("logs")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 ${
                activeTab === "logs" ? detailTab.active : detailTab.inactive
              }`}
            >
              Logs
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("terminal");
                if (!openTerminals.has(worktree.id)) {
                  setOpenTerminals((prev) => new Set(prev).add(worktree.id));
                }
              }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 ${
                activeTab === "terminal" ? detailTab.active : detailTab.inactive
              }`}
            >
              Terminal
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("hooks")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 ${
                activeTab === "hooks" ? detailTab.active : detailTab.inactive
              }`}
            >
              Hooks
            </button>
          </div>

          <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-end ml-3">
            {showCommitInput ? (
              <>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCommit();
                    if (e.key === "Escape") setShowCommitInput(false);
                  }}
                  placeholder="Commit message..."
                  className={`w-72 h-7 px-2.5 bg-white/[0.04] border border-white/[0.08] rounded-md ${input.text} placeholder-[#4b5563] text-xs focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.15] transition-all duration-150`}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowCommitInput(false)}
                  className={`h-7 px-2 text-[11px] font-medium ${action.cancel.text} ${action.cancel.textHover} rounded-md transition-colors duration-150 flex-shrink-0`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={isGitLoading || !commitMessage.trim()}
                  className={`h-7 px-2.5 text-[11px] font-medium ${action.commit.textActive} ${action.commit.bgSubmit} ${action.commit.bgSubmitHover} rounded-md disabled:opacity-50 transition-colors duration-150 active:scale-[0.98] flex-shrink-0`}
                >
                  {isGitLoading && gitAction === "commit" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        className="w-3.5 h-3.5 animate-spin"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="2"
                          opacity="0.3"
                        />
                        <path
                          d="M22 12a10 10 0 0 0-10-10"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                      Committing...
                    </span>
                  ) : (
                    "Commit"
                  )}
                </button>
              </>
            ) : (
              <>
                {worktree.hasUncommitted && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowCommitInput(true);
                      setShowCreatePrInput(false);
                    }}
                    disabled={isGitLoading}
                    className={`h-7 px-2.5 text-[11px] font-medium ${action.commit.text} ${action.commit.hover} rounded-md disabled:opacity-50 transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-3.5 h-3.5"
                    >
                      <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                      <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25h5a.75.75 0 0 0 0-1.5h-5A2.75 2.75 0 0 0 2 5.75v8.5A2.75 2.75 0 0 0 4.75 17h8.5A2.75 2.75 0 0 0 16 14.25v-5a.75.75 0 0 0-1.5 0v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" />
                    </svg>
                    Commit
                  </button>
                )}
                {worktree.hasUnpushed && (
                  <button
                    type="button"
                    onClick={handlePush}
                    disabled={isGitLoading}
                    className={`h-7 px-2.5 text-[11px] font-medium ${action.push.text} ${action.push.hover} rounded-md disabled:opacity-50 transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
                  >
                    {isGitLoading && gitAction === "push" ? (
                      <>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          className="w-3.5 h-3.5 animate-spin"
                        >
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="2"
                            opacity="0.3"
                          />
                          <path
                            d="M22 12a10 10 0 0 0-10-10"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                        Pushing...
                      </>
                    ) : (
                      <>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="w-3.5 h-3.5"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 17a.75.75 0 0 1-.75-.75V5.612L5.29 9.77a.75.75 0 0 1-1.08-1.04l5.25-5.5a.75.75 0 0 1 1.08 0l5.25 5.5a.75.75 0 1 1-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0 1 10 17Z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Push{worktree.commitsAhead ? ` (${worktree.commitsAhead})` : ""}
                      </>
                    )}
                  </button>
                )}
                {!worktree.githubPrUrl &&
                  !worktree.hasUnpushed &&
                  worktree.commitsAheadOfBase !== 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreatePrInput((v) => !v);
                        setShowCommitInput(false);
                      }}
                      disabled={isGitLoading}
                      className={`h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5 ${
                        showCreatePrInput
                          ? `${action.pr.textActive} ${action.pr.bgActive}`
                          : `${action.pr.text} ${action.pr.hover}`
                      } disabled:opacity-50`}
                    >
                      {isGitLoading && gitAction === "pr" ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          className="w-3.5 h-3.5 animate-spin"
                        >
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="2"
                            opacity="0.3"
                          />
                          <path
                            d="M22 12a10 10 0 0 0-10-10"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          className="w-3.5 h-3.5"
                        >
                          <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
                        </svg>
                      )}
                      {isGitLoading && gitAction === "pr" ? "Creating..." : "PR"}
                    </button>
                  )}
                {worktree.githubPrUrl && (
                  <a
                    href={worktree.githubPrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group h-7 px-2.5 text-[11px] font-medium ${action.pr.text} ${action.pr.hover} rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
                  >
                    <GitHubIcon className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-white" />
                    View PR
                  </a>
                )}
                {!worktree.jiraUrl && !worktree.linearUrl && !worktree.localIssueId && (
                  <>
                    {onCreateTask && (
                      <button
                        type="button"
                        onClick={() => onCreateTask(worktree.id)}
                        className={`h-7 px-2.5 text-[11px] font-medium ${text.muted} hover:${text.secondary} hover:bg-white/[0.06] rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
                      >
                        <ListTodo className="w-3.5 h-3.5" />
                        Create Task
                      </button>
                    )}
                    {onLinkIssue && (
                      <button
                        type="button"
                        onClick={() => onLinkIssue(worktree.id)}
                        className={`h-7 px-2.5 text-[11px] font-medium ${text.muted} hover:${text.secondary} hover:bg-white/[0.06] rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
                      >
                        <Link className="w-3.5 h-3.5" />
                        Link Issue
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <GitActionInputs
        showCommitInput={false}
        showCreatePrInput={showCreatePrInput}
        commitMessage={commitMessage}
        prTitle={prTitle}
        isGitLoading={isGitLoading}
        loadingAction={gitAction}
        onCommitMessageChange={setCommitMessage}
        onPrTitleChange={setPrTitle}
        onCommit={handleCommit}
        onCreatePr={handleCreatePr}
        onHideCommit={() => setShowCommitInput(false)}
        onHidePr={() => setShowCreatePrInput(false)}
      />

      <LogsViewer
        worktree={worktree}
        isRunning={isRunning}
        isCreating={isCreating}
        visible={isCreating || activeTab === "logs"}
      />
      {[...openTerminals].map((wtId) => (
        <TerminalView
          key={wtId}
          worktreeId={wtId}
          visible={wtId === worktree.id && activeTab === "terminal" && !isCreating}
        />
      ))}
      <HooksTab
        worktreeId={worktree.id}
        visible={activeTab === "hooks" && !isCreating}
        hookUpdateKey={hookUpdateKey}
        hasLinkedIssue={!!(worktree.jiraUrl || worktree.linearUrl || worktree.localIssueId)}
        onNavigateToIssue={() => {
          if (worktree.localIssueId && onSelectLocalIssue) {
            onSelectLocalIssue(worktree.localIssueId);
          } else if (worktree.jiraUrl && onSelectJiraIssue) {
            const jiraKey = worktree.jiraUrl.match(/\/browse\/([A-Z]+-\d+)/)?.[1];
            if (jiraKey) onSelectJiraIssue(jiraKey);
          } else if (worktree.linearUrl && onSelectLinearIssue) {
            const linearId = worktree.linearUrl.match(/\/issue\/([A-Z]+-\d+)/)?.[1];
            if (linearId) onSelectLinearIssue(linearId);
          }
        }}
        onCreateTask={onCreateTask ? () => onCreateTask(worktree.id) : undefined}
        onNavigateToHooks={onNavigateToHooks}
      />

      {showRemoveModal && (
        <ConfirmDialog
          title="Delete worktree?"
          confirmLabel="Delete"
          onConfirm={handleConfirmRemove}
          onCancel={() => setShowRemoveModal(false)}
        >
          <p className={`text-xs ${text.secondary}`}>
            Delete "{worktree.id}"? This will delete the worktree directory.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
