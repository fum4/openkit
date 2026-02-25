import { useState } from "react";
import { Upload } from "lucide-react";

import { APP_NAME, CONFIG_DIR_NAME } from "@openkit/shared/constants";
import { input, text } from "../theme";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface SetupCommitModalProps {
  onCommit: (message: string) => Promise<void>;
  onSkip: () => void;
}

export function SetupCommitModal({ onCommit, onSkip }: SetupCommitModalProps) {
  const [message, setMessage] = useState(`chore: add ${APP_NAME} configuration`);
  const [isPushing, setIsPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCommitAndPush = async () => {
    if (!message.trim()) return;
    setIsPushing(true);
    setError(null);
    try {
      await onCommit(message.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to commit and push");
      setIsPushing(false);
    }
  };

  const inputClass = `w-full px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.05] focus:border-white/[0.12] transition-all text-xs`;

  return (
    <Modal
      title="Push Configuration"
      icon={<Upload className="w-5 h-5 text-[#9ca3af]" />}
      onClose={onSkip}
      footer={
        <>
          <Button onClick={onSkip} disabled={isPushing}>
            Later
          </Button>
          <Button
            onClick={handleCommitAndPush}
            variant="primary"
            disabled={!message.trim()}
            loading={isPushing}
          >
            Commit & Push
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className={`text-xs ${text.secondary} leading-relaxed`}>
          Configuration must be pushed to remote so new worktrees include it.
        </p>

        <div>
          <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>Commit message</label>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={inputClass}
            placeholder="Enter commit message..."
            disabled={isPushing}
          />
        </div>

        <div className={`text-[11px] ${text.dimmed}`}>
          <p className="mb-1">Files to commit:</p>
          <p className="font-mono text-[10px]">
            {CONFIG_DIR_NAME}/config.json, {CONFIG_DIR_NAME}/.gitignore
          </p>
        </div>

        {error && <p className={`text-[11px] ${text.error}`}>{error}</p>}
      </div>
    </Modal>
  );
}
