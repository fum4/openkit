import { useState } from "react";
import { Bot } from "lucide-react";

import { useApi } from "../hooks/useApi";
import { input, text } from "../theme";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";

interface AgentCreateModalProps {
  onCreated: (agentId: string) => void;
  onClose: () => void;
}

const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "vscode", label: "VS Code" },
  { id: "codex", label: "Codex" },
] as const;

export function AgentCreateModal({ onCreated, onClose }: AgentCreateModalProps) {
  const api = useApi();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tools, setTools] = useState("");
  const [model, setModel] = useState("");
  const [scope, setScope] = useState<"global" | "project">("project");
  const [deployAgents, setDeployAgents] = useState<string[]>(AGENTS.map((agent) => agent.id));
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0;
  const inputClass = `w-full px-2.5 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md ${input.text} placeholder-[#4b5563] text-xs focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.15] transition-all duration-150`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    const result = await api.createCustomClaudeAgent({
      name: name.trim(),
      description: description.trim() || undefined,
      tools: tools.trim() || undefined,
      model: model.trim() || undefined,
      instructions: instructions.trim() || undefined,
      scope,
      deployAgents,
    });

    setSubmitting(false);
    if (!result.success || !result.agent) {
      setError(result.error ?? "Failed to create agent");
      return;
    }

    onCreated(result.agent.id);
    onClose();
  };

  return (
    <Modal
      title="Create Agent"
      icon={<Bot className="w-4 h-4 text-cyan-400" />}
      onClose={onClose}
      onSubmit={handleSubmit}
      width="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cyan-400/15 text-cyan-400 hover:bg-cyan-400/25 disabled:opacity-50 transition-colors duration-150 flex items-center gap-1.5"
          >
            {submitting && <Spinner size="xs" />}
            {submitting ? "Creating..." : "Create Agent"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. reviewer"
            className={inputClass}
            autoFocus
          />
        </div>

        <div>
          <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Scope</label>
          <div className="flex items-center bg-white/[0.04] rounded-lg p-0.5 w-fit">
            {(["project", "global"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                  scope === s
                    ? "text-[#d1d5db] bg-white/[0.06]"
                    : `${text.dimmed} hover:${text.muted}`
                }`}
              >
                {s === "global" ? "Global" : "Project"}
              </button>
            ))}
          </div>
          <p className={`text-[10px] ${text.dimmed} mt-1`}>Deployment scope for selected tools</p>
        </div>

        <div>
          <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Deploy to</label>
          <div className="flex flex-wrap gap-2">
            {AGENTS.map((agent) => {
              const selected = deployAgents.includes(agent.id);
              return (
                <label key={agent.id} className="flex items-center gap-1.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      setDeployAgents((prev) =>
                        prev.includes(agent.id)
                          ? prev.filter((id) => id !== agent.id)
                          : [...prev, agent.id],
                      );
                    }}
                    className="accent-cyan-400"
                  />
                  <span
                    className={`text-[11px] ${selected ? text.secondary : text.dimmed} group-hover:${text.secondary} transition-colors`}
                  >
                    {agent.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this agent is specialized for"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Tools</label>
            <input
              type="text"
              value={tools}
              onChange={(e) => setTools(e.target.value)}
              placeholder="e.g. Read, Write, Bash(git:*)"
              className={inputClass}
            />
          </div>
          <div>
            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="optional, e.g. sonnet / gpt-5"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Instructions</label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Markdown instructions for this agent..."
            rows={6}
            className={`${inputClass} resize-none`}
          />
        </div>

        {error && <p className={`${text.error} text-[11px]`}>{error}</p>}
      </div>
    </Modal>
  );
}
