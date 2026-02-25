import { GitBranch, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { useApi } from "../hooks/useApi";
import { border, surface, text } from "../theme";
import { Spinner } from "./Spinner";

interface WorktreeExistsModalProps {
  worktreeId: string;
  branch: string;
  onResolved: () => void;
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

  const handleReuse = async () => {
    setIsLoading("reuse");
    setError(null);
    const result = await api.recoverWorktree(worktreeId, "reuse");
    setIsLoading(null);
    if (result.success) {
      onResolved();
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
      onResolved();
    } else {
      setError(result.error || "Failed to recreate worktree");
    }
  };

  const busy = isLoading !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        className={`relative ${surface.modal} border ${border.modal} rounded-2xl max-w-sm w-full mx-4 shadow-2xl overflow-hidden`}
      >
        {/* Header with icon */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/[0.12] flex items-center justify-center flex-shrink-0">
              <GitBranch className="w-4.5 h-4.5 text-amber-400" />
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${text.primary}`}>Worktree exists</h3>
              <p className={`text-[11px] ${text.muted} mt-0.5`}>
                <span className="font-medium text-white/80">{worktreeId}</span> already has a
                worktree
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className={`text-[11px] ${text.error}`}>{error}</p>
          </div>
        )}

        {/* Options */}
        <div className="px-5 pb-3 space-y-2">
          <button
            onClick={handleReuse}
            disabled={busy}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-teal-400/30 bg-white/[0.02] hover:bg-teal-400/[0.04] disabled:opacity-50 transition-all duration-150 text-left group`}
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
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-red-400/30 bg-white/[0.02] hover:bg-red-400/[0.03] disabled:opacity-50 transition-all duration-150 text-left group`}
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

        {/* Cancel */}
        <div className={`px-5 py-3 border-t ${border.subtle}`}>
          <button
            onClick={onCancel}
            disabled={busy}
            className={`w-full px-3 py-1.5 text-xs ${text.muted} hover:${text.secondary} rounded-lg transition-colors duration-150 disabled:opacity-50`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
