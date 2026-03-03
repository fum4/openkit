import { useMemo, useState } from "react";

import { text } from "../theme";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { ToggleSwitch } from "./ToggleSwitch";

interface DeployAgent {
  id: string;
  label: string;
}

interface DeployStatus {
  global?: boolean;
  project?: boolean;
}

interface DeployMatrixDialogProps {
  title: string;
  icon?: React.ReactNode;
  agents: DeployAgent[];
  status: Record<string, DeployStatus>;
  onApply: (desired: Record<string, DeployStatus>) => Promise<void | boolean>;
  onClose: () => void;
}

export function DeployMatrixDialog({
  title,
  icon,
  agents,
  status,
  onApply,
  onClose,
}: DeployMatrixDialogProps) {
  const [draft, setDraft] = useState<Record<string, DeployStatus>>(() => {
    const next: Record<string, DeployStatus> = {};
    for (const agent of agents) {
      const current = status[agent.id] ?? {};
      next[agent.id] = {
        ...(current.global ? { global: true } : {}),
        ...(current.project ? { project: true } : {}),
      };
    }
    return next;
  });
  const [applying, setApplying] = useState(false);

  const hasChanges = useMemo(
    () =>
      agents.some((agent) => {
        const current = status[agent.id] ?? {};
        const next = draft[agent.id] ?? {};
        return !!current.global !== !!next.global || !!current.project !== !!next.project;
      }),
    [agents, draft, status],
  );

  const toggle = (agentId: string, scope: "global" | "project") => {
    setDraft((prev) => {
      const next = { ...prev };
      const current = next[agentId] ?? {};
      const value = !current[scope];
      next[agentId] = {
        ...current,
        ...(value ? { [scope]: true } : { [scope]: undefined }),
      };
      return next;
    });
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const shouldClose = await onApply(draft);
      if (shouldClose !== false) {
        onClose();
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      title={title}
      icon={icon}
      width="md"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!hasChanges || applying}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              hasChanges && !applying
                ? "text-teal-400 bg-teal-900/30 hover:bg-teal-900/50"
                : "text-white/20 bg-white/[0.04] cursor-not-allowed"
            }`}
          >
            {applying ? <Spinner size="xs" className="text-teal-400" /> : "Apply"}
          </button>
        </div>
      }
    >
      <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] overflow-hidden">
        <div className="grid grid-cols-[1fr_84px_84px] px-3 py-2 border-b border-white/[0.06]">
          <span className={`text-[10px] font-medium ${text.dimmed}`}>Agent</span>
          <span className={`text-[10px] font-medium ${text.dimmed} text-center`}>Global</span>
          <span className={`text-[10px] font-medium ${text.dimmed} text-center`}>Project</span>
        </div>
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="grid grid-cols-[1fr_84px_84px] px-3 py-2 border-b last:border-b-0 border-white/[0.06] hover:bg-white/[0.02]"
          >
            <span className={`text-xs ${text.secondary}`}>{agent.label}</span>
            <div className="flex justify-center items-center">
              <ToggleSwitch
                checked={!!draft[agent.id]?.global}
                onToggle={() => toggle(agent.id, "global")}
                size="sm"
                disabled={applying}
              />
            </div>
            <div className="flex justify-center items-center">
              <ToggleSwitch
                checked={!!draft[agent.id]?.project}
                onToggle={() => toggle(agent.id, "project")}
                size="sm"
                disabled={applying}
              />
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
