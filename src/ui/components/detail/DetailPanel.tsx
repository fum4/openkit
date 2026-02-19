import { Link, ListTodo, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WorktreeInfo } from "../../types";
import { useApi } from "../../hooks/useApi";
import { action, border, detailTab, errorBanner, input, text } from "../../theme";
import { ConfirmDialog } from "../ConfirmDialog";
import { GitHubIcon } from "../icons";
import { Modal } from "../Modal";
import { DetailHeader } from "./DetailHeader";
import { LogsViewer } from "./LogsViewer";
import { TerminalView } from "./TerminalView";
import { HooksTab } from "./HooksTab";

type WorktreeTab = "logs" | "terminal" | "claude" | "hooks";

// Persists across unmount/remount (view switches)
const tabCache: Record<string, WorktreeTab> = {};
const openClaudeTabCache = new Set<string>();

interface ClaudeLaunchRequest {
  worktreeId: string;
  mode: "resume" | "start";
  prompt?: string;
  requestId: number;
}

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
  claudeLaunchRequest?: ClaudeLaunchRequest | null;
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
  claudeLaunchRequest,
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
  const [tabPerWorktree, setTabPerWorktree] = useState<Record<string, WorktreeTab>>(
    () => ({ ...tabCache }),
  );
  const [openTerminals, setOpenTerminals] = useState<Set<string>>(new Set());
  const [openClaudeTabs, setOpenClaudeTabs] = useState<Set<string>>(
    () => new Set(openClaudeTabCache),
  );
  const [currentClaudeLaunchRequest, setCurrentClaudeLaunchRequest] =
    useState<ClaudeLaunchRequest | null>(null);
  const [launchClaudeRequestId, setLaunchClaudeRequestId] = useState<number | null>(null);
  const [closeClaudeRequestIdByWorktree, setCloseClaudeRequestIdByWorktree] = useState<
    Record<string, number>
  >({});
  const processedClaudeRequestIdRef = useRef<number | null>(null);
  const localClaudeRequestIdRef = useRef(1_000_000);
  const closeClaudeRequestIdRef = useRef(0);

  const activeTab = worktree ? (tabPerWorktree[worktree.id] ?? "logs") : "logs";
  const isTerminalTabActive = activeTab === "terminal" || activeTab === "claude";

  const setTabForWorktree = useCallback((worktreeId: string, tab: WorktreeTab) => {
    tabCache[worktreeId] = tab;
    setTabPerWorktree((prev) => ({ ...prev, [worktreeId]: tab }));
  }, []);

  const setActiveTab = useCallback(
    (tab: WorktreeTab) => {
      if (!worktree) return;
      setTabForWorktree(worktree.id, tab);
    },
    [setTabForWorktree, worktree],
  );

  const ensureTerminalTabMounted = useCallback((worktreeId: string) => {
    setOpenTerminals((prev) => {
      if (prev.has(worktreeId)) return prev;
      const next = new Set(prev);
      next.add(worktreeId);
      return next;
    });
  }, []);

  const ensureClaudeTabMounted = useCallback((worktreeId: string) => {
    openClaudeTabCache.add(worktreeId);
    setOpenClaudeTabs((prev) => {
      if (prev.has(worktreeId)) return prev;
      const next = new Set(prev);
      next.add(worktreeId);
      return next;
    });
  }, []);

  const closeClaudeTab = useCallback(
    (worktreeId: string) => {
      openClaudeTabCache.delete(worktreeId);
      setOpenClaudeTabs((prev) => {
        if (!prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.delete(worktreeId);
        return next;
      });
      setLaunchClaudeRequestId(null);
      setCurrentClaudeLaunchRequest((prev) => (prev?.worktreeId === worktreeId ? null : prev));
      setCloseClaudeRequestIdByWorktree((prev) => {
        if (!(worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[worktreeId];
        return next;
      });
      setTabPerWorktree((prev) => {
        if (prev[worktreeId] !== "claude") return prev;
        tabCache[worktreeId] = "logs";
        return { ...prev, [worktreeId]: "logs" };
      });
    },
    [],
  );

  const openClaudeWithRequest = useCallback(
    (request: ClaudeLaunchRequest) => {
      if (!worktree || request.worktreeId !== worktree.id) return;
      setCurrentClaudeLaunchRequest(request);
      setCloseClaudeRequestIdByWorktree((prev) => {
        if (!(request.worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[request.worktreeId];
        return next;
      });
      const claudeTabAlreadyOpen = openClaudeTabCache.has(worktree.id);
      setActiveTab("claude");
      ensureClaudeTabMounted(worktree.id);
      setLaunchClaudeRequestId(claudeTabAlreadyOpen ? null : request.requestId);
    },
    [ensureClaudeTabMounted, setActiveTab, worktree],
  );

  const handleOpenClaudeTab = useCallback(() => {
    if (!worktree) return;
    localClaudeRequestIdRef.current += 1;
    openClaudeWithRequest({
      worktreeId: worktree.id,
      mode: "resume",
      requestId: localClaudeRequestIdRef.current,
    });
  }, [openClaudeWithRequest, worktree]);

  const requestCloseClaudeTab = useCallback((worktreeId: string) => {
    closeClaudeRequestIdRef.current += 1;
    const requestId = closeClaudeRequestIdRef.current;
    setCloseClaudeRequestIdByWorktree((prev) => ({ ...prev, [worktreeId]: requestId }));
  }, []);

  // Reset form state when worktree changes (but NOT tab or terminal state)
  useEffect(() => {
    setError(null);
    setShowCommitInput(false);
    setShowCreatePrInput(false);
    setCommitMessage("");
    setPrTitle("");
    setGitAction(null);
  }, [worktree?.id]);

  useEffect(() => {
    if (!worktree || !claudeLaunchRequest || claudeLaunchRequest.worktreeId !== worktree.id) {
      return;
    }
    if (processedClaudeRequestIdRef.current === claudeLaunchRequest.requestId) return;
    processedClaudeRequestIdRef.current = claudeLaunchRequest.requestId;
    openClaudeWithRequest(claudeLaunchRequest);
  }, [claudeLaunchRequest, openClaudeWithRequest, worktree]);

  // If terminal/claude tab is restored from cache on remount, ensure that view is mounted.
  useEffect(() => {
    if (!worktree) return;
    if (activeTab === "terminal") {
      ensureTerminalTabMounted(worktree.id);
      return;
    }
    if (activeTab === "claude") {
      if (openClaudeTabCache.has(worktree.id)) {
        ensureClaudeTabMounted(worktree.id);
        return;
      }
      setTabForWorktree(worktree.id, "logs");
    }
  }, [activeTab, ensureClaudeTabMounted, ensureTerminalTabMounted, setTabForWorktree, worktree]);

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
    openClaudeTabCache.delete(deletedId);
    setOpenClaudeTabs((prev) => {
      const next = new Set(prev);
      next.delete(deletedId);
      return next;
    });
    setTabPerWorktree((prev) => {
      const { [deletedId]: _, ...rest } = prev;
      return rest;
    });
    delete tabCache[deletedId];
    setLaunchClaudeRequestId((prev) =>
      currentClaudeLaunchRequest?.worktreeId === deletedId ? null : prev,
    );
    setCurrentClaudeLaunchRequest((prev) => (prev?.worktreeId === deletedId ? null : prev));
    setCloseClaudeRequestIdByWorktree((prev) => {
      if (!(deletedId in prev)) return prev;
      const next = { ...prev };
      delete next[deletedId];
      return next;
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
          className={`flex-shrink-0 h-11 flex items-center justify-between px-4 border-b ${
            isTerminalTabActive ? "border-transparent" : border.section
          }`}
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
                ensureTerminalTabMounted(worktree.id);
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
            {openClaudeTabs.has(worktree.id) && (
              <div
                className={`inline-flex items-center rounded-md transition-colors duration-150 ${
                  activeTab === "claude" ? detailTab.active : detailTab.inactive
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab("claude")}
                  className="pl-3 pr-1.5 py-1 text-xs font-medium"
                >
                  Claude
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseClaudeTab(worktree.id);
                  }}
                  className={`mr-1.5 p-0.5 rounded-sm transition-colors duration-150 ${
                    activeTab === "claude"
                      ? "text-white/70 hover:text-white hover:bg-white/10"
                      : "text-[#6b7280] hover:text-[#9ca3af] hover:bg-white/[0.06]"
                  }`}
                  aria-label="Close Claude tab"
                  title="Close Claude tab"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {!openClaudeTabs.has(worktree.id) && (
              <button
                type="button"
                onClick={handleOpenClaudeTab}
                className="inline-flex items-center gap-1.5 pl-2 pr-3 py-1 text-xs font-medium rounded-md text-[#3f4651] hover:text-[#9ca3af] hover:bg-white/[0.06] transition-colors duration-150"
              >
                <Plus className="w-3 h-3" />
                Claude
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-end ml-3">
            {worktree.hasUncommitted && (
              <button
                type="button"
                onClick={() => {
                  setShowCommitInput(true);
                  setShowCreatePrInput(false);
                }}
                disabled={isGitLoading}
                className={`h-7 px-2.5 text-[11px] font-medium ${action.commit.text} ${action.commit.hover} hover:text-white rounded-md disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
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
                className={`h-7 px-2.5 text-[11px] font-medium ${action.push.text} ${action.push.hover} hover:text-white rounded-md disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
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
                    setShowCreatePrInput(true);
                    setShowCommitInput(false);
                  }}
                  disabled={isGitLoading}
                  className={`h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5 ${
                    showCreatePrInput
                      ? `${action.pr.textActive} ${action.pr.bgActive}`
                      : `${action.pr.text} ${action.pr.hover} hover:text-white`
                  } disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="w-3.5 h-3.5"
                  >
                    <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
                  </svg>
                  Open PR
                </button>
              )}
            {worktree.githubPrUrl && (
              <a
                href={worktree.githubPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`group h-7 px-2.5 text-[11px] font-medium ${action.pr.text} ${action.pr.hover} hover:text-white rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
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
          </div>
        </div>
      )}

      {showCommitInput && (
        <Modal
          title="Commit Changes"
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4 text-white"
            >
              <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
              <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25h5a.75.75 0 0 0 0-1.5h-5A2.75 2.75 0 0 0 2 5.75v8.5A2.75 2.75 0 0 0 4.75 17h8.5A2.75 2.75 0 0 0 16 14.25v-5a.75.75 0 0 0-1.5 0v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" />
            </svg>
          }
          width="md"
          onClose={() => setShowCommitInput(false)}
          onSubmit={(e) => {
            e.preventDefault();
            void handleCommit();
          }}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowCommitInput(false)}
                className={`px-3 py-1.5 text-xs rounded-lg ${action.cancel.text} ${action.cancel.textHover} transition-colors`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isGitLoading || !commitMessage.trim()}
                className={`px-3 py-1.5 text-xs font-medium ${action.commit.textActive} ${action.commit.bgSubmit} ${action.commit.bgSubmitHover} rounded-lg disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98]`}
              >
                {isGitLoading && gitAction === "commit" ? "Committing..." : "Commit"}
              </button>
            </>
          }
        >
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowCommitInput(false);
            }}
            placeholder="Commit message..."
            className={`w-full px-3 py-2 ${input.bgDetail} border ${border.modal} rounded-lg ${input.text} text-xs placeholder-[#4b5563] focus:outline-none focus:${border.focusPrimary} focus-visible:ring-1 ${input.ring} transition-colors duration-150`}
            autoFocus
          />
        </Modal>
      )}

      {showCreatePrInput && (
        <Modal
          title="Open Pull Request"
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="w-4 h-4 text-white"
            >
              <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
            </svg>
          }
          width="md"
          onClose={() => setShowCreatePrInput(false)}
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreatePr();
          }}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowCreatePrInput(false)}
                className={`px-3 py-1.5 text-xs rounded-lg ${action.cancel.text} ${action.cancel.textHover} transition-colors`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isGitLoading || !prTitle.trim()}
                className={`px-3 py-1.5 text-xs font-medium ${action.pr.textActive} ${action.pr.bgSubmit} ${action.pr.bgSubmitHover} rounded-lg disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98]`}
              >
                {isGitLoading && gitAction === "pr" ? "Creating..." : "Open PR"}
              </button>
            </>
          }
        >
          <input
            type="text"
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowCreatePrInput(false);
            }}
            placeholder="PR title..."
            className={`w-full px-3 py-2 ${input.bgDetail} border ${border.modal} rounded-lg ${input.text} text-xs placeholder-[#4b5563] focus:outline-none focus:${border.focusPrimary} focus-visible:ring-1 ${input.ring} transition-colors duration-150`}
            autoFocus
          />
        </Modal>
      )}

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
      {[...openClaudeTabs].map((wtId) => (
        <TerminalView
          key={`claude-${wtId}`}
          worktreeId={wtId}
          variant="claude"
          visible={wtId === worktree.id && activeTab === "claude" && !isCreating}
          claudeLaunchRequest={
            currentClaudeLaunchRequest &&
            launchClaudeRequestId === currentClaudeLaunchRequest.requestId &&
            currentClaudeLaunchRequest.worktreeId === wtId
              ? currentClaudeLaunchRequest
              : null
          }
          closeRequestId={closeClaudeRequestIdByWorktree[wtId] ?? null}
          onClaudeExit={() => closeClaudeTab(wtId)}
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
