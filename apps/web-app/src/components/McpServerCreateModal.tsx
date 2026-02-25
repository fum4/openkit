import { useState } from "react";
import { Server } from "lucide-react";

import { useApi } from "../hooks/useApi";
import { Modal } from "./Modal";
import { input, mcpServer, text } from "../theme";

interface McpServerCreateModalProps {
  onCreated: () => void;
  onClose: () => void;
}

export function McpServerCreateModal({ onCreated, onClose }: McpServerCreateModalProps) {
  const api = useApi();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [envText, setEnvText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !command.trim()) return;

    setCreating(true);
    setError(null);

    // Parse env from KEY=VALUE lines
    const env: Record<string, string> = {};
    if (envText.trim()) {
      for (const line of envText.split("\n")) {
        const eqIdx = line.indexOf("=");
        if (eqIdx > 0) {
          env[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
        }
      }
    }

    const result = await api.createMcpServer({
      name: name.trim(),
      command: command.trim(),
      args: args.trim() ? args.split(/\s+/) : [],
      description: description.trim(),
      tags: tags.trim()
        ? tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      env,
    });

    setCreating(false);

    if (result.success) {
      onCreated();
      onClose();
    } else {
      setError(result.error ?? "Failed to create server");
    }
  };

  const inputClass = `w-full px-2.5 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md ${input.text} placeholder-[#4b5563] text-xs focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.15] transition-all duration-150`;

  return (
    <Modal
      title="Add MCP Server"
      icon={<Server className="w-4 h-4 text-purple-400" />}
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
            disabled={!name.trim() || !command.trim() || creating}
            className={`px-4 py-1.5 text-xs font-medium ${mcpServer.button} rounded-lg disabled:opacity-50 transition-colors duration-150`}
          >
            {creating ? "Adding..." : "Add Server"}
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
            placeholder="e.g. Context7"
            className={inputClass}
            autoFocus
          />
        </div>

        <div>
          <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Command *</label>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g. npx, uvx, node"
            className={inputClass}
          />
        </div>

        <div>
          <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Arguments</label>
          <input
            type="text"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="e.g. -y @context7/mcp"
            className={inputClass}
          />
          <p className={`text-[10px] ${text.dimmed} mt-0.5`}>Space-separated arguments</p>
        </div>

        <div>
          <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this server do?"
            className={inputClass}
          />
        </div>

        <div>
          <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Tags</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. docs, search, code"
            className={inputClass}
          />
          <p className={`text-[10px] ${text.dimmed} mt-0.5`}>Comma-separated tags</p>
        </div>

        <div>
          <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
            Environment Variables
          </label>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder={"KEY=value\nANOTHER_KEY=value"}
            rows={3}
            className={`${inputClass} resize-none`}
          />
          <p className={`text-[10px] ${text.dimmed} mt-0.5`}>One KEY=value per line</p>
        </div>

        {error && <p className={`${text.error} text-[11px]`}>{error}</p>}
      </div>
    </Modal>
  );
}
