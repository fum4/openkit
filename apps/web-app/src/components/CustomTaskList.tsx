import type { CustomTaskSummary } from "../types";
import { text } from "../theme";
import { CustomTaskItem } from "./CustomTaskItem";
import { Spinner } from "./Spinner";

interface CustomTaskListProps {
  tasks: CustomTaskSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  error: string | null;
  onViewWorktree?: (worktreeId: string) => void;
  showPriority?: boolean;
  showStatus?: boolean;
}

export function CustomTaskList({
  tasks,
  selectedId,
  onSelect,
  isLoading,
  error,
  onViewWorktree,
  showPriority = true,
  showStatus = true,
}: CustomTaskListProps) {
  return (
    <div className="flex flex-col">
      {isLoading && tasks.length === 0 ? (
        <div className="flex items-center justify-center gap-2 p-4">
          <Spinner size="xs" className={text.muted} />
          <p className={`${text.muted} text-xs`}>Loading tasks...</p>
        </div>
      ) : error && tasks.length === 0 ? (
        <div className="flex items-center justify-center p-4">
          <p className={`${text.error} text-xs text-center`}>{error}</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex items-center justify-center p-4">
          <p className={`${text.muted} text-xs`}>No custom tasks</p>
        </div>
      ) : (
        <div className="space-y-px">
          {tasks.map((task) => (
            <CustomTaskItem
              key={task.id}
              task={task}
              isSelected={task.id === selectedId}
              onSelect={() => onSelect(task.id)}
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
