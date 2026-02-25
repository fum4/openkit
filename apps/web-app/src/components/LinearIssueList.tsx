import type { LinearIssueSummary } from "../types";
import { text } from "../theme";
import { LinearIssueItem } from "./LinearIssueItem";
import { Spinner } from "./Spinner";

interface LinearIssueListProps {
  issues: LinearIssueSummary[];
  selectedIdentifier: string | null;
  onSelect: (identifier: string) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  linkedWorktrees?: Map<string, string>;
  onViewWorktree?: (worktreeId: string) => void;
  showPriority?: boolean;
  showStatus?: boolean;
}

export function LinearIssueList({
  issues,
  selectedIdentifier,
  onSelect,
  isLoading,
  error,
  linkedWorktrees,
  onViewWorktree,
  showPriority = true,
  showStatus = true,
}: LinearIssueListProps) {
  return (
    <div className="flex flex-col">
      {isLoading && issues.length === 0 ? (
        <div className="flex items-center justify-center gap-2 p-4">
          <Spinner size="xs" className={text.muted} />
          <p className={`${text.muted} text-xs`}>Loading issues...</p>
        </div>
      ) : error && issues.length === 0 ? (
        <div className="flex items-center justify-center p-4">
          <p className={`${text.error} text-xs text-center`}>{error}</p>
        </div>
      ) : issues.length === 0 ? (
        <div className="flex items-center justify-center p-4">
          <div className="text-center">
            <p className={`${text.muted} text-xs`}>No issues found</p>
          </div>
        </div>
      ) : (
        <div className="space-y-px">
          {issues.map((issue) => (
            <LinearIssueItem
              key={issue.identifier}
              issue={issue}
              isSelected={issue.identifier === selectedIdentifier}
              onSelect={() => onSelect(issue.identifier)}
              linkedWorktreeId={linkedWorktrees?.get(issue.identifier)}
              onViewWorktree={onViewWorktree}
              showPriority={showPriority}
              showStatus={showStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
}
