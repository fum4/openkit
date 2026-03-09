import { GitBranch, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { useApi } from "../hooks/useApi";
import { useErrorToast } from "../hooks/useErrorToast";
import { text } from "../theme";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";

interface WorktreeExistsModalProps {
  worktreeId: string;
  branch: string;
  onResolved: (action: "reuse" | "recreate") => void;
  onCancel: () => void;
}

export function WorktreeExistsModal({
  worktreeId,
  branch,
  onResolved,
  onCancel,
}: WorktreeExistsModalProps) {
  const api = useApi();
  const [isLoading, setIsLoading] = useState<"reuse" | "recreate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useErrorToast(error, "worktree-exists-modal");

  const handleReuse = async () => {
    setIsLoading("reuse");
    setError(null);
    const result = await api.recoverWorktree(worktreeId, "reuse");
    setIsLoading(null);
    if (result.success) {
      onResolved("reuse");
    } else {
      setError(result.error || "Failed to reuse worktree");
    }
  };

  const handleRecreate = async () => {
    setIsLoading("recreate");
    setError(null);
    const result = await api.recoverWorktree(worktreeId, "recreate", branch);
    setIsLoading(null);
    if (result.success) {
      onResolved("recreate");
    } else {
      setError(result.error || "Failed to recreate worktree");
    }
  };

  const busy = isLoading !== null;

  return (
    <Modal
      title="Worktree exists"
      icon={<GitBranch className="w-4 h-4 text-accent" />}
      onClose={onCancel}
      width="sm"
      contentClassName="px-5 py-4"
      footer={
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-xs text-white/75 hover:text-white rounded-lg transition-colors duration-150 disabled:opacity-50"
        >
          Cancel
        </button>
      }
    >
      <p className={`text-xs ${text.muted} mb-3`}>
        <span className="font-medium text-white/80">{worktreeId}</span> already has a worktree.
      </p>
      <div className="space-y-2">
        <button
          onClick={handleReuse}
          disabled={busy}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-teal-400/30 bg-white/[0.02] hover:bg-teal-400/[0.04] disabled:opacity-50 transition-all duration-150 text-left group"
        >
          <div className="w-8 h-8 rounded-lg bg-teal-400/[0.08] group-hover:bg-teal-400/[0.15] flex items-center justify-center flex-shrink-0 transition-colors">
            {isLoading === "reuse" ? (
              <Spinner size="xs" className="text-teal-400" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 text-teal-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-medium ${text.primary}`}>Reuse existing</div>
            <div className={`text-[10px] ${text.muted} mt-0.5`}>
              Keep current files and continue where you left off
            </div>
          </div>
        </button>

        <button
          onClick={handleRecreate}
          disabled={busy}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-red-400/30 bg-white/[0.02] hover:bg-red-400/[0.03] disabled:opacity-50 transition-all duration-150 text-left group"
        >
          <div className="w-8 h-8 rounded-lg bg-red-400/[0.08] group-hover:bg-red-400/[0.15] flex items-center justify-center flex-shrink-0 transition-colors">
            {isLoading === "recreate" ? (
              <Spinner size="xs" className="text-red-400" />
            ) : (
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-medium ${text.primary}`}>Delete and recreate</div>
            <div className={`text-[10px] ${text.muted} mt-0.5`}>
              Remove everything and start fresh from the branch
            </div>
          </div>
        </button>
      </div>
    </Modal>
  );
}
