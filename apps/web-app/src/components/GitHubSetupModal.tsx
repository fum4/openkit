import { useEffect, useRef, useState } from "react";

import { border, button, input, surface, text } from "../theme";

interface GitHubSetupModalProps {
  needsCommit: boolean;
  needsRepo: boolean;
  onAutoSetup: (options: { commitMessage: string; repoPrivate: boolean }) => void;
  onManual: () => void;
}

export function GitHubSetupModal({
  needsCommit,
  needsRepo,
  onAutoSetup,
  onManual,
}: GitHubSetupModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [commitMessage, setCommitMessage] = useState("Initial commit");
  const [repoPrivate, setRepoPrivate] = useState(true);

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onManual();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onManual]);

  const steps: { label: string; detail: string }[] = [];
  if (needsCommit) {
    steps.push({
      label: "Create initial commit",
      detail: `All files will be staged and committed with message: "${commitMessage}"`,
    });
  }
  if (needsRepo) {
    steps.push({
      label: "Create GitHub repository",
      detail: `A new ${repoPrivate ? "private" : "public"} repository will be created and linked`,
    });
    steps.push({
      label: "Push to remote",
      detail: "Your code will be pushed to the new repository",
    });
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${surface.overlay}`}
      onClick={onManual}
    >
      <div
        className={`${surface.modal} border ${border.modal} rounded-xl p-5 max-w-md w-full mx-4 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={`${text.primary} font-semibold text-sm mb-1`}>Repository Setup</h3>
        <p className={`${text.muted} text-[11px] mb-4`}>
          Your project needs some setup before you can create worktrees.
        </p>

        {/* Steps that will be performed */}
        <div className="mb-4">
          <span className={`text-[10px] font-medium ${text.secondary} uppercase tracking-wide`}>
            What will happen
          </span>
          <div className="mt-2 space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex gap-2 items-baseline">
                <span className={`text-xs ${text.muted} flex-shrink-0 w-4`}>{i + 1}.</span>
                <div>
                  <span className={`text-xs ${text.primary}`}>{step.label}</span>
                  <p className={`text-[10px] ${text.dimmed} mt-0.5`}>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="space-y-3 mb-5">
          {needsCommit && (
            <div>
              <label className={`text-[10px] font-medium ${text.secondary} block mb-1`}>
                Commit Message
              </label>
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                className={`w-full px-2.5 py-1.5 text-xs rounded-md ${input.bg} border ${border.input} ${input.text} focus:outline-none focus:${border.focusPrimary} transition-colors`}
              />
            </div>
          )}

          {needsRepo && (
            <div>
              <label className={`text-[10px] font-medium ${text.secondary} block mb-1.5`}>
                Repository Visibility
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRepoPrivate(true)}
                  className={`flex-1 px-3 py-1.5 text-[11px] rounded-md border transition-colors ${
                    repoPrivate
                      ? `${border.accent} text-accent bg-accent/10`
                      : `${border.input} ${text.muted} hover:${text.secondary}`
                  }`}
                >
                  Private
                </button>
                <button
                  type="button"
                  onClick={() => setRepoPrivate(false)}
                  className={`flex-1 px-3 py-1.5 text-[11px] rounded-md border transition-colors ${
                    !repoPrivate
                      ? `${border.accent} text-accent bg-accent/10`
                      : `${border.input} ${text.muted} hover:${text.secondary}`
                  }`}
                >
                  Public
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onAutoSetup({ commitMessage, repoPrivate })}
            disabled={needsCommit && !commitMessage.trim()}
            className={`w-full px-3 py-2 text-xs font-medium ${button.primary} rounded-lg disabled:opacity-50 transition-colors duration-150 active:scale-[0.98]`}
          >
            Set Up Automatically
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onManual}
            className={`w-full px-3 py-2 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150 active:scale-[0.98]`}
          >
            I'll handle it myself
          </button>
        </div>
      </div>
    </div>
  );
}
