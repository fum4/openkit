import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Info, Loader2, X, XCircle } from "lucide-react";

import { useToast } from "../contexts/ToastContext";
import type { ToastChild } from "../contexts/ToastContext";

interface ToastContainerProps {
  onNavigateToWorktree?: (worktreeId: string) => void;
}

export function ToastContainer({ onNavigateToWorktree }: ToastContainerProps) {
  const { toasts, removeToast, toggleToastExpanded } = useToast();

  return (
    <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={`pointer-events-auto rounded-xl shadow-2xl border backdrop-blur-md max-w-[420px] min-w-[300px] ${
              toast.isLoading
                ? "bg-amber-950/80 border-amber-500/30 text-amber-200"
                : toast.level === "error"
                  ? "bg-red-950/80 border-red-500/30 text-red-200"
                  : toast.level === "success"
                    ? "bg-emerald-950/80 border-emerald-500/30 text-emerald-200"
                    : "bg-[#1a2332]/80 border-teal-500/30 text-teal-200"
            }`}
          >
            <div className="flex items-start gap-2.5 px-4 py-3">
              <div className="flex-shrink-0 mt-0.5">
                {toast.isLoading ? (
                  <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                ) : toast.level === "error" ? (
                  <XCircle className="w-4 h-4 text-red-400" />
                ) : toast.level === "success" ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Info className="w-4 h-4 text-teal-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                {toast.projectName && (
                  <span className="text-[9px] opacity-60 block mb-0.5">{toast.projectName}</span>
                )}
                <p className="text-xs leading-relaxed">{toast.message}</p>
                {toast.worktreeId && onNavigateToWorktree && (
                  <button
                    onClick={() => onNavigateToWorktree(toast.worktreeId!)}
                    className="text-[10px] text-teal-400/70 hover:text-teal-400 transition-colors mt-1"
                  >
                    Go to worktree &rarr;
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {toast.children && toast.children.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleToastExpanded(toast.id)}
                    className={`p-0.5 rounded-md transition-colors ${
                      toast.isLoading
                        ? "hover:bg-amber-500/20 text-amber-400/60 hover:text-amber-300"
                        : toast.level === "error"
                          ? "hover:bg-red-500/20 text-red-400/60 hover:text-red-300"
                          : toast.level === "success"
                            ? "hover:bg-emerald-500/20 text-emerald-400/60 hover:text-emerald-300"
                            : "hover:bg-teal-500/20 text-teal-400/60 hover:text-teal-300"
                    }`}
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${toast.isExpanded ? "rotate-180" : ""}`}
                    />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeToast(toast.id)}
                  className={`p-0.5 rounded-md transition-colors ${
                    toast.isLoading
                      ? "hover:bg-amber-500/20 text-amber-400/60 hover:text-amber-300"
                      : toast.level === "error"
                        ? "hover:bg-red-500/20 text-red-400/60 hover:text-red-300"
                        : toast.level === "success"
                          ? "hover:bg-emerald-500/20 text-emerald-400/60 hover:text-emerald-300"
                          : "hover:bg-teal-500/20 text-teal-400/60 hover:text-teal-300"
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {/* Expanded children */}
            {toast.isExpanded && toast.children && toast.children.length > 0 && (
              <div className="px-4 pb-3 pt-0.5 space-y-1.5">
                {toast.children.map((child) => (
                  <ToastChildRow key={child.key} child={child} />
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastChildRow({ child }: { child: ToastChild }) {
  return (
    <div className="flex items-center gap-2 text-[10px] opacity-80">
      <div className="flex-shrink-0">
        {child.status === "loading" ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : child.status === "error" ? (
          <XCircle className="w-3 h-3 text-red-400" />
        ) : (
          <Check className="w-3 h-3 text-emerald-400" />
        )}
      </div>
      <span className="flex-1 truncate">{child.message}</span>
    </div>
  );
}
