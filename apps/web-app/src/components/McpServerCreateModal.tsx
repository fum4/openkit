import { useState } from "react";
import { Server } from "lucide-react";

import { useApi } from "../hooks/useApi";
import { useErrorToast } from "../hooks/useErrorToast";
import { Modal } from "./Modal";
import { input, mcpServer, text } from "../theme";

interface McpServerCreateModalProps {
  onCreated: () => void;
  onClose: () => void;
}

export function McpServerCreateModal({ onCreated, onClose }: McpServerCreateModalProps) {
  const api = useApi();
  const [mode, setMode] = useState<"form" | "json">("form");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [envText, setEnvText] = useState("");
  const [jsonName, setJsonName] = useState("");
  const [jsonConfig, setJsonConfig] = useState("");
  const [error, setError] = useState<string | null>(null);
  useErrorToast(error, "mcp-server-create-modal");
  const [creating, setCreating] = useState(false);

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

  const isServerEntry = (value: unknown): value is Record<string, unknown> => {
    if (!isRecord(value)) return false;
    return typeof value.command === "string" || typeof value.url === "string";
  };

  const normalizeServerEntry = (id: string, entry: Record<string, unknown>) => {
    const entryType: "http" | "sse" | undefined =
      entry.type === "http" || entry.type === "sse" ? entry.type : undefined;

    return {
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
      description: typeof entry.description === "string" ? entry.description.trim() : "",
      tags: Array.isArray(entry.tags)
        ? entry.tags
            .map(String)
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
      command: typeof entry.command === "string" ? entry.command.trim() : undefined,
      args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      type: entryType,
      url: typeof entry.url === "string" ? entry.url.trim() : undefined,
      env: isRecord(entry.env)
        ? Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [key, String(value)]))
        : {},
    };
  };

  const parseServerFromJson = (raw: string) => {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) throw new Error("JSON must be an object");
    if (isRecord(parsed.mcpServers) || (isRecord(parsed.mcp) && isRecord(parsed.mcp.servers))) {
      throw new Error('Paste only the server object, not the wrapping "mcpServers" structure');
    }
    if (!isServerEntry(parsed)) {
      throw new Error("JSON must contain a server object with command or url");
    }
    const id = jsonName.trim() || "mcp-server";
    const normalized = normalizeServerEntry(id, parsed);
    if (!normalized.command && !normalized.url) {
      throw new Error("Server JSON must include command or url");
    }
    if (!jsonName.trim() && !normalized.name.trim()) {
      throw new Error("Server name is required");
    }
    return {
      ...normalized,
      id: jsonName.trim() || normalized.id,
      name: jsonName.trim() || normalized.name,
    };
  };

  const createServerFromJson = async () => {
    const server = parseServerFromJson(jsonConfig.trim());
    const result = await api.createMcpServer(server);
    if (!result.success) {
      setError(result.error ?? `Failed to create server "${server.name}"`);
      return false;
    }
    return true;
  };

  const createServerFromForm = async () => {
    if (!name.trim() || !command.trim()) return false;

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
    if (!result.success) {
      setError(result.error ?? "Failed to create server");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "form" && (!name.trim() || !command.trim())) return;
    if (mode === "json" && (!jsonName.trim() || !jsonConfig.trim())) return;

    setCreating(true);
    setError(null);

    try {
      const ok = mode === "json" ? await createServerFromJson() : await createServerFromForm();
      if (!ok) return;
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse JSON");
    } finally {
      setCreating(false);
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
            disabled={
              creating ||
              (mode === "form"
                ? !name.trim() || !command.trim()
                : !jsonName.trim() || !jsonConfig.trim())
            }
            className={`px-4 py-1.5 text-xs font-medium ${mcpServer.button} rounded-lg disabled:opacity-50 transition-colors duration-150`}
          >
            {creating ? "Adding..." : "Add Server"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="inline-flex gap-0.5 bg-white/[0.04] rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => {
              setMode("form");
              setError(null);
            }}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
              mode === "form" ? "text-white bg-white/[0.08]" : `${text.dimmed} hover:${text.muted}`
            }`}
          >
            Form
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("json");
              setError(null);
            }}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
              mode === "json" ? "text-white bg-white/[0.08]" : `${text.dimmed} hover:${text.muted}`
            }`}
          >
            JSON
          </button>
        </div>

        {mode === "form" ? (
          <>
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
              <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
                Command *
              </label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g. npx, uvx, node"
                className={inputClass}
              />
            </div>

            <div>
              <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
                Arguments
              </label>
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
              <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
                Description
              </label>
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
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Name *</label>
              <input
                type="text"
                value={jsonName}
                onChange={(e) => setJsonName(e.target.value)}
                placeholder="e.g. context7"
                className={inputClass}
                autoFocus
              />
            </div>

            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
              MCP JSON Config
            </label>
            <textarea
              value={jsonConfig}
              onChange={(e) => setJsonConfig(e.target.value)}
              placeholder={`{\n  "command": "npx",\n  "args": ["-y", "@upstash/context7-mcp"],\n  "env": {\n    "API_KEY": "..." \n  }\n}`}
              rows={11}
              className={`${inputClass} font-mono resize-y`}
            />
            <p className={`text-[10px] ${text.dimmed} mt-0.5`}>
              Paste only the server object. Do not include wrapping{" "}
              <code className="font-mono">mcpServers</code> /{" "}
              <code className="font-mono">mcp.servers</code>.
            </p>
          </div>
        )}

        {error && <p className={`${text.error} text-[11px]`}>{error}</p>}
      </div>
    </Modal>
  );
}
