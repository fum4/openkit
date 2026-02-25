import type { WorktreeInfo } from "../types";
import { text } from "../theme";
import { WorktreeItem } from "./WorktreeItem";

interface WorktreeListProps {
  worktrees: WorktreeInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter?: string;
  localIssueLinkedIds?: Set<string>;
  onSelectJiraIssue?: (key: string) => void;
  onSelectLinearIssue?: (identifier: string) => void;
  onSelectLocalIssue?: (identifier: string) => void;
}

export function WorktreeList({
  worktrees,
  selectedId,
  onSelect,
  filter = "",
  localIssueLinkedIds,
  onSelectJiraIssue,
  onSelectLinearIssue,
  onSelectLocalIssue,
}: WorktreeListProps) {
  const filtered = filter
    ? worktrees.filter((w) => {
        const q = filter.toLowerCase();
        return w.id.toLowerCase().includes(q) || w.branch.toLowerCase().includes(q);
      })
    : worktrees;

  if (worktrees.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center">
          <p className={`${text.muted} text-xs`}>No worktrees yet</p>
          <p className={`${text.dimmed} text-[11px] mt-1`}>Create one to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <p className={`${text.muted} text-xs`}>No matches</p>
          </div>
        ) : (
          <div className="space-y-px">
            {filtered.map((worktree) => (
              <WorktreeItem
                key={worktree.id}
                worktree={worktree}
                isSelected={worktree.id === selectedId}
                onSelect={() => onSelect(worktree.id)}
                hasLocalIssue={localIssueLinkedIds?.has(worktree.id)}
                onSelectJiraIssue={onSelectJiraIssue}
                onSelectLinearIssue={onSelectLinearIssue}
                onSelectLocalIssue={onSelectLocalIssue}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
