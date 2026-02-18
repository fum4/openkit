import { action, border, input } from "../../theme";
import { Spinner } from "../Spinner";

interface GitActionInputsProps {
  showCommitInput: boolean;
  showCreatePrInput: boolean;
  commitMessage: string;
  prTitle: string;
  isGitLoading: boolean;
  loadingAction?: "commit" | "push" | "pr" | null;
  onCommitMessageChange: (value: string) => void;
  onPrTitleChange: (value: string) => void;
  onCommit: () => void;
  onCreatePr: () => void;
  onHideCommit: () => void;
  onHidePr: () => void;
}

export function GitActionInputs({
  showCommitInput,
  showCreatePrInput,
  commitMessage,
  prTitle,
  isGitLoading,
  loadingAction = null,
  onCommitMessageChange,
  onPrTitleChange,
  onCommit,
  onCreatePr,
  onHideCommit,
  onHidePr,
}: GitActionInputsProps) {
  return (
    <>
      {showCommitInput && (
        <div
          className={`flex-shrink-0 px-5 py-2.5 border-b ${border.section} flex items-center gap-2`}
        >
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => onCommitMessageChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit();
              if (e.key === "Escape") onHideCommit();
            }}
            placeholder="Commit message..."
            className={`flex-1 px-2.5 py-1.5 ${input.bgDetail} border ${border.modal} rounded-lg ${input.text} text-xs focus:outline-none focus:${border.focusPrimary} focus-visible:ring-1 ${input.ring} transition-colors duration-150`}
            autoFocus
          />
          <button
            type="button"
            onClick={onCommit}
            disabled={isGitLoading || !commitMessage.trim()}
            className={`px-3 py-1.5 text-xs font-medium ${action.commit.textActive} ${action.commit.bgSubmit} rounded-md ${action.commit.bgSubmitHover} disabled:opacity-50 transition-colors duration-150 active:scale-[0.98]`}
          >
            {isGitLoading && loadingAction === "commit" ? (
              <span className="flex items-center gap-1.5">
                <Spinner size="xs" />
                Committing...
              </span>
            ) : (
              "Submit"
            )}
          </button>
          <button
            type="button"
            onClick={onHideCommit}
            className={`px-2.5 py-1.5 text-xs ${action.cancel.text} ${action.cancel.textHover} transition-colors duration-150`}
          >
            Cancel
          </button>
        </div>
      )}

      {showCreatePrInput && (
        <div
          className={`flex-shrink-0 px-5 py-2.5 border-b ${border.section} flex items-center gap-2`}
        >
          <input
            type="text"
            value={prTitle}
            onChange={(e) => onPrTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreatePr();
              if (e.key === "Escape") onHidePr();
            }}
            placeholder="PR title..."
            className={`flex-1 px-2.5 py-1.5 ${input.bgDetail} border ${border.modal} rounded-lg ${input.text} text-xs focus:outline-none focus:${border.focusPrimary} focus-visible:ring-1 ${input.ring} transition-colors duration-150`}
            autoFocus
          />
          <button
            type="button"
            onClick={onCreatePr}
            disabled={isGitLoading || !prTitle.trim()}
            className={`px-3 py-1.5 text-xs font-medium ${action.pr.textActive} ${action.pr.bgSubmit} rounded-md ${action.pr.bgSubmitHover} disabled:opacity-50 transition-colors duration-150 active:scale-[0.98]`}
          >
            {isGitLoading && loadingAction === "pr" ? (
              <span className="flex items-center gap-1.5">
                <Spinner size="xs" />
                Creating...
              </span>
            ) : (
              "Create PR"
            )}
          </button>
          <button
            type="button"
            onClick={onHidePr}
            className={`px-2.5 py-1.5 text-xs ${action.cancel.text} ${action.cancel.textHover} transition-colors duration-150`}
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
