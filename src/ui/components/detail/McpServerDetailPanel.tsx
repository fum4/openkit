import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Info, Plus, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import type { McpServerSummary } from "../../types";
import { useMcpServerDetail, useMcpDeploymentStatus } from "../../hooks/useMcpServers";
import { useApi } from "../../hooks/useApi";
import { border, mcpServer, text } from "../../theme";
import { ConfirmDialog } from "../ConfirmDialog";
import { Spinner } from "../Spinner";
import { ToggleSwitch } from "../ToggleSwitch";

interface McpServerDetailPanelProps {
  serverId: string;
  builtInServer?: McpServerSummary;
  onDeleted: () => void;
}

const TOOLS = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "vscode", label: "VS Code" },
  { id: "codex", label: "Codex" },
] as const;

const SCOPES = ["global", "project"] as const;

export function McpServerDetailPanel({
  serverId,
  builtInServer,
  onDeleted,
}: McpServerDetailPanelProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const isBuiltIn = !!builtInServer;
  const {
    server: fetchedServer,
    isLoading,
    error,
    refetch,
  } = useMcpServerDetail(isBuiltIn ? null : serverId);
  const { status: deploymentStatus, refetch: refetchDeployment } = useMcpDeploymentStatus();

  const server = builtInServer ?? fetchedServer;

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editingCommand, setEditingCommand] = useState(false);
  const [commandDraft, setCommandDraft] = useState("");
  const [editingArgs, setEditingArgs] = useState(false);
  const [argsDraft, setArgsDraft] = useState("");
  const [showEnv, setShowEnv] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteUndeploy, setDeleteUndeploy] = useState(true);
  const [deploying, setDeploying] = useState<string | null>(null);

  // Per-project env state
  const [projectEnv, setProjectEnv] = useState<Record<string, string>>({});
  const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null);
  const [envValueDraft, setEnvValueDraft] = useState("");
  const [editingEnvName, setEditingEnvName] = useState<string | null>(null);
  const [envNameDraft, setEnvNameDraft] = useState("");
  const [addingEnvKey, setAddingEnvKey] = useState(false);
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");

  // Fetch per-project env
  const fetchEnv = useCallback(async () => {
    const result = await api.fetchMcpServerEnv(serverId);
    setProjectEnv(result.env);
  }, [serverId, api]);

  useEffect(() => {
    fetchEnv();
  }, [fetchEnv]);

  const saveEnv = async (env: Record<string, string>) => {
    setProjectEnv(env);
    await api.updateMcpServerEnv(serverId, env);
  };

  const update = async (updates: Record<string, unknown>) => {
    if (isBuiltIn) return;
    await api.updateMcpServer(serverId, updates);
    refetch();
    queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
  };

  const handleDelete = async () => {
    if (isBuiltIn) return;
    if (deleteUndeploy) {
      const serverStatus = deploymentStatus[serverId] ?? {};
      for (const [tool, scopes] of Object.entries(serverStatus)) {
        if (scopes.global) await api.undeployMcpServer(serverId, tool, "global");
        if (scopes.project) await api.undeployMcpServer(serverId, tool, "project");
      }
    }
    await api.deleteMcpServer(serverId);
    queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
    queryClient.invalidateQueries({ queryKey: ["mcpDeploymentStatus"] });
    onDeleted();
  };

  const handleDeploy = async (tool: string, scope: string, deployed: boolean) => {
    const key = `${tool}-${scope}`;
    setDeploying(key);
    if (deployed) {
      await api.undeployMcpServer(serverId, tool, scope);
    } else {
      await api.deployMcpServer(serverId, tool, scope);
    }
    setDeploying(null);
    refetchDeployment();
  };

  const handleEnvValueUpdate = async (key: string, value: string) => {
    await saveEnv({ ...projectEnv, [key]: value });
    setEditingEnvKey(null);
  };

  const handleEnvKeyRename = async (oldKey: string, newName: string) => {
    setEditingEnvName(null);
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldKey) return;
    const updated = { ...projectEnv };
    const value = updated[oldKey] ?? "";
    delete updated[oldKey];
    updated[trimmed] = value;
    await saveEnv(updated);
  };

  const handleEnvDelete = async (key: string) => {
    const updated = { ...projectEnv };
    delete updated[key];
    await saveEnv(updated);
  };

  const handleEnvAdd = async () => {
    if (!newEnvKey.trim()) return;
    await saveEnv({ ...projectEnv, [newEnvKey.trim()]: newEnvValue });
    setAddingEnvKey(false);
    setNewEnvKey("");
    setNewEnvValue("");
  };

  // Redirect when source is deleted / not found
  useEffect(() => {
    if (!isBuiltIn && !isLoading && (error || !server)) onDeleted();
  }, [isBuiltIn, isLoading, error, server]);

  if (!isBuiltIn && (isLoading || error || !server)) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2">
        <Spinner size="sm" className={text.muted} />
        <p className={`${text.muted} text-sm`}>Loading server...</p>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className={`${text.muted} text-sm`}>Select a server to view details</p>
      </div>
    );
  }

  const serverDeployment = deploymentStatus[serverId] ?? {};
  const isDeployedAnywhere = Object.values(serverDeployment).some(
    (scopes) => scopes.global || scopes.project,
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className={`flex-shrink-0 px-5 py-4 border-b ${border.section}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[11px] font-mono ${mcpServer.accent}`}>{server.id}</span>
              {server.tags
                .filter((tag) => tag !== "built-in")
                .map((tag) => (
                  <span
                    key={tag}
                    className={`text-[11px] ${mcpServer.badge} px-2.5 py-0.5 rounded`}
                  >
                    {tag}
                  </span>
                ))}
              {isDeployedAnywhere && (
                <span className={`text-[11px] px-2.5 py-0.5 rounded-full ${mcpServer.badge}`}>
                  Deployed
                </span>
              )}
            </div>
            {!isBuiltIn && editingName ? (
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={async () => {
                  if (nameDraft.trim() && nameDraft.trim() !== server.name) {
                    await update({ name: nameDraft.trim() });
                  }
                  setEditingName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className={`w-full text-[15px] font-semibold ${text.primary} bg-white/[0.04] border ${mcpServer.accentBorder} rounded-md px-2 py-1 focus:outline-none`}
                autoFocus
              />
            ) : (
              <h2
                className={`text-[15px] font-semibold ${text.primary} leading-snug ${!isBuiltIn ? "cursor-pointer hover:bg-white/[0.04]" : ""} rounded-md px-2 py-1 -mx-2 -my-1 transition-colors`}
                onClick={
                  !isBuiltIn
                    ? () => {
                        setNameDraft(server.name);
                        setEditingName(true);
                      }
                    : undefined
                }
                title={!isBuiltIn ? "Click to edit" : undefined}
              >
                {server.name}
              </h2>
            )}
          </div>
          {!isBuiltIn && (
            <div className="flex-shrink-0 pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className={`p-1.5 rounded-lg ${text.muted} hover:text-red-400 hover:bg-red-900/20 transition-colors`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-12">
        {/* Description */}
        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>Description</h3>
          {!isBuiltIn && editingDescription ? (
            <textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onBlur={async () => {
                if (descriptionDraft !== server.description) {
                  await update({ description: descriptionDraft });
                }
                setEditingDescription(false);
              }}
              className={`w-full px-3 py-2 bg-white/[0.02] border border-white/[0.08] rounded-lg text-xs ${text.primary} focus:outline-none resize-none`}
              rows={3}
              autoFocus
            />
          ) : (
            <div
              className={`rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2 ${!isBuiltIn ? "cursor-pointer hover:border-white/[0.08]" : ""} transition-colors min-h-[40px]`}
              onClick={
                !isBuiltIn
                  ? () => {
                      setDescriptionDraft(server.description);
                      setEditingDescription(true);
                    }
                  : undefined
              }
              title={!isBuiltIn ? "Click to edit" : undefined}
            >
              {server.description ? (
                <p className={`text-xs ${text.secondary}`}>{server.description}</p>
              ) : (
                <p className={`text-xs ${text.dimmed} italic`}>
                  {isBuiltIn ? "No description" : "Click to add a description..."}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Command & Args */}
        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>Configuration</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${text.dimmed} w-16`}>Command</span>
              {!isBuiltIn && editingCommand ? (
                <input
                  type="text"
                  value={commandDraft}
                  onChange={(e) => setCommandDraft(e.target.value)}
                  onBlur={async () => {
                    if (commandDraft.trim() && commandDraft.trim() !== server.command) {
                      await update({ command: commandDraft.trim() });
                    }
                    setEditingCommand(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingCommand(false);
                  }}
                  className={`flex-1 px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded text-xs font-mono ${text.primary} focus:outline-none`}
                  autoFocus
                />
              ) : (
                <span
                  className={`text-xs font-mono ${text.primary} ${!isBuiltIn ? "cursor-pointer hover:bg-white/[0.04]" : ""} px-2 py-1 -mx-2 rounded transition-colors`}
                  onClick={
                    !isBuiltIn
                      ? () => {
                          setCommandDraft(server.command);
                          setEditingCommand(true);
                        }
                      : undefined
                  }
                  title={!isBuiltIn ? "Click to edit" : undefined}
                >
                  {server.command}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${text.dimmed} w-16`}>Args</span>
              {!isBuiltIn && editingArgs ? (
                <input
                  type="text"
                  value={argsDraft}
                  onChange={(e) => setArgsDraft(e.target.value)}
                  onBlur={async () => {
                    const newArgs = argsDraft.trim() ? argsDraft.split(/\s+/) : [];
                    if (JSON.stringify(newArgs) !== JSON.stringify(server.args)) {
                      await update({ args: newArgs });
                    }
                    setEditingArgs(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingArgs(false);
                  }}
                  className={`flex-1 px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded text-xs font-mono ${text.primary} focus:outline-none`}
                  autoFocus
                />
              ) : (
                <span
                  className={`text-xs font-mono ${text.secondary} ${!isBuiltIn ? "cursor-pointer hover:bg-white/[0.04]" : ""} px-2 py-1 -mx-2 rounded transition-colors`}
                  onClick={
                    !isBuiltIn
                      ? () => {
                          setArgsDraft(server.args.join(" "));
                          setEditingArgs(true);
                        }
                      : undefined
                  }
                  title={!isBuiltIn ? "Click to edit" : undefined}
                >
                  {server.args.length > 0 ? (
                    server.args.join(" ")
                  ) : (
                    <span className={text.dimmed}>none</span>
                  )}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Environment Variables (per-project) */}
        {!isBuiltIn && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <h3 className={`text-[11px] font-medium ${text.muted}`}>Environment Variables</h3>
              <div className="relative group">
                <Info className={`w-3 h-3 ${text.dimmed} cursor-help`} />
                <div
                  className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-[#1a1d24] border border-white/[0.10] shadow-xl text-[10px] ${text.secondary} whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50`}
                >
                  Environment variables are saved per project
                </div>
              </div>
              {Object.keys(projectEnv).length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowEnv(!showEnv)}
                  className={`p-0.5 rounded ${text.dimmed} hover:${text.muted} transition-colors`}
                  title={showEnv ? "Hide values" : "Show values"}
                >
                  {showEnv ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>

            {Object.keys(projectEnv).length > 0 ? (
              <div className="space-y-1">
                {Object.entries(projectEnv).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 group/env">
                    {editingEnvName === key ? (
                      <input
                        type="text"
                        value={envNameDraft}
                        onChange={(e) => setEnvNameDraft(e.target.value)}
                        onBlur={() => handleEnvKeyRename(key, envNameDraft)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingEnvName(null);
                        }}
                        className={`w-28 px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] font-mono ${text.primary} focus:outline-none flex-shrink-0`}
                        autoFocus
                      />
                    ) : (
                      <span
                        className={`text-[11px] font-mono ${text.secondary} flex-shrink-0 cursor-pointer hover:bg-white/[0.04] px-1.5 py-0.5 -mx-1.5 rounded transition-colors`}
                        onClick={() => {
                          setEditingEnvName(key);
                          setEnvNameDraft(key);
                        }}
                      >
                        {key}
                      </span>
                    )}
                    <span className={`text-[11px] ${text.dimmed}`}>=</span>
                    {editingEnvKey === key ? (
                      <input
                        type="text"
                        value={envValueDraft}
                        onChange={(e) => setEnvValueDraft(e.target.value)}
                        onBlur={() => handleEnvValueUpdate(key, envValueDraft)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingEnvKey(null);
                        }}
                        className={`flex-1 min-w-0 px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] font-mono ${text.primary} focus:outline-none`}
                        autoFocus
                      />
                    ) : (
                      <span
                        className={`text-[11px] font-mono ${text.secondary} cursor-pointer hover:bg-white/[0.04] px-1.5 py-0.5 -mx-1.5 rounded transition-colors truncate`}
                        onClick={() => {
                          setEditingEnvKey(key);
                          setEnvValueDraft(value);
                        }}
                      >
                        {showEnv ? value : "••••••••"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleEnvDelete(key)}
                      className={`flex-shrink-0 p-0.5 rounded opacity-0 group-hover/env:opacity-100 ${text.dimmed} hover:text-red-400 transition-all`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : !addingEnvKey ? (
              <p className={`text-[11px] ${text.dimmed} italic`}>No environment variables</p>
            ) : null}

            {addingEnvKey ? (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  value={newEnvKey}
                  onChange={(e) => setNewEnvKey(e.target.value)}
                  placeholder="KEY"
                  className={`w-28 px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] font-mono ${text.primary} focus:outline-none placeholder:${text.dimmed}`}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAddingEnvKey(false);
                  }}
                />
                <span className={`text-[11px] ${text.dimmed}`}>=</span>
                <input
                  type="text"
                  value={newEnvValue}
                  onChange={(e) => setNewEnvValue(e.target.value)}
                  placeholder="value"
                  className={`flex-1 min-w-0 px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] font-mono ${text.primary} focus:outline-none placeholder:${text.dimmed}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEnvAdd();
                    if (e.key === "Escape") setAddingEnvKey(false);
                  }}
                />
                <button
                  type="button"
                  onClick={handleEnvAdd}
                  disabled={!newEnvKey.trim()}
                  className={`text-[10px] font-medium px-2 py-0.5 rounded ${newEnvKey.trim() ? `${mcpServer.button}` : `${text.dimmed} bg-white/[0.02]`} transition-colors`}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setAddingEnvKey(false)}
                  className={`p-0.5 rounded ${text.dimmed} hover:${text.muted} transition-colors`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddingEnvKey(true);
                  setNewEnvKey("");
                  setNewEnvValue("");
                }}
                className={`flex items-center gap-1.5 mt-2 px-2 py-1 rounded-md text-[11px] ${text.dimmed} hover:${text.muted} hover:bg-white/[0.04] transition-colors`}
              >
                <Plus className="w-3 h-3" />
                Add variable
              </button>
            )}
          </section>
        )}

        {/* Deploy Matrix */}
        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-3`}>Deployment</h3>
          <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] overflow-hidden">
            {/* Header row */}
            <div className={`grid grid-cols-[1fr_80px_80px] px-3 py-2 border-b ${border.subtle}`}>
              <span className={`text-[10px] font-medium ${text.dimmed}`}>Tool</span>
              <span className={`text-[10px] font-medium ${text.dimmed} text-center`}>Global</span>
              <span className={`text-[10px] font-medium ${text.dimmed} text-center`}>Project</span>
            </div>

            {/* Tool rows */}
            {TOOLS.map((tool) => {
              const agentStatus = serverDeployment[tool.id] ?? {};
              return (
                <div
                  key={tool.id}
                  className={`grid grid-cols-[1fr_80px_80px] px-3 py-2 border-b last:border-b-0 ${border.subtle} hover:bg-white/[0.02]`}
                >
                  <span className={`text-xs ${text.secondary}`}>{tool.label}</span>
                  {SCOPES.map((scope) => {
                    const isDeployed = agentStatus[scope];
                    const isToggling = deploying === `${tool.id}-${scope}`;
                    const isAvailable = agentStatus[scope] !== undefined;

                    if (!isAvailable) {
                      return (
                        <div key={scope} className="flex justify-center items-center">
                          <span className={`text-[10px] ${text.dimmed}`}>-</span>
                        </div>
                      );
                    }

                    return (
                      <div key={scope} className="flex justify-center items-center">
                        {isToggling ? (
                          <Spinner size="xs" className={text.dimmed} />
                        ) : (
                          <ToggleSwitch
                            checked={!!isDeployed}
                            onToggle={() => handleDeploy(tool.id, scope, !!isDeployed)}
                            title={
                              isDeployed
                                ? `Remove from ${tool.label} (${scope})`
                                : `Deploy to ${tool.label} (${scope})`
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Delete confirmation */}
      {!isBuiltIn && showDeleteConfirm && (
        <ConfirmDialog
          title="Delete MCP server?"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        >
          <p className={`text-xs ${text.secondary} mb-3`}>
            This will remove "{server.name}" from the registry.
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteUndeploy}
              onChange={(e) => setDeleteUndeploy(e.target.checked)}
              className="accent-red-400"
            />
            <span className={`text-xs ${text.secondary}`}>
              Also remove server from all agents that use it
            </span>
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}
