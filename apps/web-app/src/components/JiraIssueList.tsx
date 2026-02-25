import type { JiraIssueSummary } from "../types";
import { text } from "../theme";
import { JiraIssueItem } from "./JiraIssueItem";
import { Spinner } from "./Spinner";

interface JiraIssueListProps {
  issues: JiraIssueSummary[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  linkedWorktrees?: Map<string, string>;
  onViewWorktree?: (worktreeId: string) => void;
  showPriority?: boolean;
  showStatus?: boolean;
}

export function JiraIssueList({
  issues,
  selectedKey,
  onSelect,
  isLoading,
  error,
  linkedWorktrees,
  onViewWorktree,
  showPriority = true,
  showStatus = true,
}: JiraIssueListProps) {
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
            <JiraIssueItem
              key={issue.key}
              issue={issue}
              isSelected={issue.key === selectedKey}
              onSelect={() => onSelect(issue.key)}
              linkedWorktreeId={linkedWorktrees?.get(issue.key)}
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
