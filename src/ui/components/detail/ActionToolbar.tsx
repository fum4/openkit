import type { WorktreeInfo } from "../../types";
import { action } from "../../theme";

interface ActionToolbarProps {
  worktree: WorktreeInfo;
  isRunning: boolean;
  isLoading: boolean;
  isGitLoading: boolean;
  showCommitInput: boolean;
  showCreatePrInput: boolean;
  onStart: () => void;
  onStop: () => void;
  onRemove: () => void;
  onToggleCommit: () => void;
  onPush: () => void;
  onTogglePr: () => void;
}

export function ActionToolbar({
  worktree,
  isRunning,
  isLoading,
  isGitLoading,
  showCommitInput,
  showCreatePrInput,
  onStart,
  onStop,
  onRemove,
  onToggleCommit,
  onPush,
  onTogglePr,
}: ActionToolbarProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1 -ml-2">
        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            disabled={isLoading}
            className={`h-7 px-2.5 text-[11px] font-medium ${action.stop.text} ${action.stop.hover} rounded-md disabled:opacity-50 transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-3.5 h-3.5"
            >
              <path
                fillRule="evenodd"
                d="M2 10a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm5-2.25A.75.75 0 0 1 7.75 7h4.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-4.5Z"
                clipRule="evenodd"
              />
            </svg>
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={isLoading}
            className={`h-7 px-2.5 text-[11px] font-medium ${action.start.text} ${action.start.hover} rounded-md disabled:opacity-50 transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
          >
            {isLoading ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3.5 h-3.5 animate-spin"
              >
                <path
                  fillRule="evenodd"
                  d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H4.598a.75.75 0 0 0-.75.75v3.634a.75.75 0 0 0 1.5 0v-2.033l.312.311a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.06-7.19a.75.75 0 0 0-1.5 0v2.033l-.312-.312a7 7 0 0 0-11.712 3.138.75.75 0 0 0 1.449.39 5.5 5.5 0 0 1 9.201-2.466l.312.312H11.58a.75.75 0 1 0 0 1.5h3.634a.75.75 0 0 0 .75-.75V4.234Z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3.5 h-3.5"
              >
                <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" />
              </svg>
            )}
            Run
          </button>
        )}

        <div className="w-px h-3.5 bg-white/[0.08] mx-0.5" />

        <button
          type="button"
          onClick={onRemove}
          disabled={isLoading}
          className={`h-7 w-7 inline-flex items-center justify-center text-[11px] font-medium ${action.delete.text} ${action.delete.hover} rounded-md disabled:opacity-50 transition-colors duration-150`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-3.5 h-3.5"
          >
            <path
              fillRule="evenodd"
              d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-1">
        {worktree.hasUncommitted && (
          <button
            type="button"
            onClick={onToggleCommit}
            disabled={isGitLoading}
            className={`h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5 ${
              showCommitInput
                ? `${action.commit.textActive} ${action.commit.bgActive}`
                : `${action.commit.text} ${action.commit.hover}`
            } disabled:opacity-50`}
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
            onClick={onPush}
            disabled={isGitLoading}
            className={`h-7 px-2.5 text-[11px] font-medium ${action.push.text} ${action.push.hover} rounded-md disabled:opacity-50 transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
            title={`Push ${worktree.commitsAhead || ""} commit(s)`}
          >
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
          </button>
        )}
        {!worktree.githubPrUrl && !worktree.hasUnpushed && worktree.commitsAheadOfBase !== 0 && (
          <button
            type="button"
            onClick={onTogglePr}
            disabled={isGitLoading}
            className={`h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5 ${
              showCreatePrInput
                ? `${action.pr.textActive} ${action.pr.bgActive}`
                : `${action.pr.text} ${action.pr.hover}`
            } disabled:opacity-50`}
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
      </div>
    </div>
  );
}
