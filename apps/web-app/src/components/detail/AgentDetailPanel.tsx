import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useClaudeAgentDetail } from "../../hooks/useSkills";
import { border, text } from "../../theme";
import { useApi } from "../../hooks/useApi";
import { MarkdownContent } from "../MarkdownContent";
import { Spinner } from "../Spinner";
import { ConfirmDialog } from "../ConfirmDialog";
import { ToggleSwitch } from "../ToggleSwitch";
import { EditableTextareaCard } from "../EditableTextareaCard";

interface AgentDetailPanelProps {
  agentId: string;
  onMissing: () => void;
  onDeleted: () => void;
}

type AgentDeploymentState = { global?: boolean; project?: boolean };

const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "vscode", label: "VS Code" },
  { id: "codex", label: "Codex" },
] as const;

const SCOPES = ["global", "project"] as const;

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function getScopeLabel(scope: "user" | "project" | "local"): string {
  if (scope === "user") return "Global";
  if (scope === "project") return "Project";
  return "Local";
}

function getDeploymentMap(deployments: unknown): Record<string, AgentDeploymentState> {
  if (!deployments || typeof deployments !== "object") return {};

  const normalized: Record<string, AgentDeploymentState> = {};
  for (const [agentId, raw] of Object.entries(deployments)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const deployment = raw as AgentDeploymentState;
    normalized[agentId] = {
      ...(deployment.global === true ? { global: true } : {}),
      ...(deployment.project === true ? { project: true } : {}),
    };
  }

  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/[\n:#]/.test(trimmed)) {
    return JSON.stringify(trimmed);
  }
  return trimmed;
}

function upsertFrontmatterField(content: string, field: string, value: string): string {
  const trimmed = value.trim();
  const match = content.match(FRONTMATTER_RE);

  if (!match) {
    if (!trimmed) return content;
    return `---\n${field}: ${formatFrontmatterValue(trimmed)}\n---\n\n${content}`;
  }

  const existingFrontmatter = match[1];
  const rest = content.slice(match[0].length);
  const fieldRegex = new RegExp(`^\\s*${escapeRegExp(field)}\\s*:`);

  let found = false;
  const lines = existingFrontmatter.split("\n");
  const nextLines: string[] = [];

  for (const line of lines) {
    if (fieldRegex.test(line)) {
      found = true;
      if (trimmed) {
        nextLines.push(`${field}: ${formatFrontmatterValue(trimmed)}`);
      }
      continue;
    }
    nextLines.push(line);
  }

  if (!found && trimmed) {
    nextLines.push(`${field}: ${formatFrontmatterValue(trimmed)}`);
  }

  const normalizedFrontmatter = nextLines.join("\n").trimEnd();
  return `---\n${normalizedFrontmatter}\n---\n\n${rest}`;
}

function getPluginScopeLabel(scope: "user" | "project" | "local"): string {
  if (scope === "user") return "global";
  if (scope === "project") return "project";
  return "local";
}

export function AgentDetailPanel({ agentId, onMissing, onDeleted }: AgentDetailPanelProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { agent, isLoading, error } = useClaudeAgentDetail(agentId);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPluginToggleConfirm, setShowPluginToggleConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [enabledError, setEnabledError] = useState<string | null>(null);

  const isCustom = agent?.isCustom === true;
  const deploymentMap = getDeploymentMap(agent?.deployments);
  const agentContent = typeof agent?.content === "string" ? agent.content : "";
  const agentDescription = typeof agent?.description === "string" ? agent.description : "";
  const isEnabled = isCustom
    ? Object.values(deploymentMap).some((value) => value.global || value.project)
    : agent?.pluginEnabled === true;

  useEffect(() => {
    if (!isLoading && (error || !agent)) onMissing();
  }, [isLoading, error, agent, onMissing]);

  const saveDefinition = useCallback(
    async (content: string) => {
      if (!agent?.id || !isCustom) return false;

      const result = await api.updateCustomClaudeAgent(agent.id, { content });
      if (!result.success) {
        throw new Error(result.error ?? "Failed to save definition");
      }

      void queryClient.invalidateQueries({ queryKey: ["claudeAgents"] });
      void queryClient.invalidateQueries({ queryKey: ["claudeAgent"] });
      return true;
    },
    [agent?.id, api, isCustom, queryClient],
  );

  useEffect(() => {
    setEnabledError(null);
    setShowPluginToggleConfirm(false);
  }, [agent?.id]);

  const handleDelete = async () => {
    if (!agent || !isCustom) return;

    setDeleting(true);
    const result = await api.deleteCustomClaudeAgent(agent.id);
    setDeleting(false);

    if (result.success) {
      void queryClient.invalidateQueries({ queryKey: ["claudeAgents"] });
      onDeleted();
    }
  };

  const handleCustomEnabledToggle = async () => {
    if (!agent || !isCustom) return;

    setEnabledError(null);
    setTogglingEnabled(true);

    try {
      if (isEnabled) {
        for (const [targetAgentId, scopes] of Object.entries(deploymentMap)) {
          if (scopes.global) {
            await api.undeployCustomClaudeAgent(agent.id, targetAgentId, "global");
          }
          if (scopes.project) {
            await api.undeployCustomClaudeAgent(agent.id, targetAgentId, "project");
          }
        }
      } else {
        await api.deployCustomClaudeAgent(agent.id, "claude", "project");
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["claudeAgents"] }),
        queryClient.invalidateQueries({ queryKey: ["claudeAgent"] }),
      ]);
    } catch (err) {
      setEnabledError(err instanceof Error ? err.message : "Failed to update enabled state");
    } finally {
      setTogglingEnabled(false);
    }
  };

  const handlePluginEnabledToggle = async () => {
    if (!agent || isCustom) return;

    setEnabledError(null);
    setTogglingEnabled(true);

    try {
      if (isEnabled) {
        await api.disableClaudePlugin(agent.pluginId, agent.pluginScope);
      } else {
        await api.enableClaudePlugin(agent.pluginId, agent.pluginScope);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["claudePlugins"] }),
        queryClient.invalidateQueries({ queryKey: ["claudeAgents"] }),
        queryClient.invalidateQueries({ queryKey: ["claudeAgent"] }),
      ]);
    } catch (err) {
      setEnabledError(err instanceof Error ? err.message : "Failed to update plugin state");
    } finally {
      setTogglingEnabled(false);
    }
  };

  const handleEnabledToggle = () => {
    if (!agent) return;
    if (isCustom) {
      void handleCustomEnabledToggle();
      return;
    }
    setShowPluginToggleConfirm(true);
  };

  const handleDeployToggle = async (
    targetAgent: string,
    scope: "global" | "project",
    isDeployed: boolean,
  ) => {
    if (!agent || !isCustom) return;

    const key = `${targetAgent}-${scope}`;
    setDeploying(key);

    if (isDeployed) {
      await api.undeployCustomClaudeAgent(agent.id, targetAgent, scope);
    } else {
      await api.deployCustomClaudeAgent(agent.id, targetAgent, scope);
    }

    setDeploying(null);
    void queryClient.invalidateQueries({ queryKey: ["claudeAgents"] });
    void queryClient.invalidateQueries({ queryKey: ["claudeAgent"] });
  };

  const handleSaveDescription = async (nextDescription: string): Promise<boolean> => {
    if (!agent || !isCustom) return true;
    const contentWithDescription = upsertFrontmatterField(
      agentContent,
      "description",
      nextDescription,
    );
    return saveDefinition(contentWithDescription);
  };

  if (isLoading || !agent) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2">
        <Spinner size="sm" className={text.muted} />
        <p className={`${text.muted} text-sm`}>Loading agent...</p>
      </div>
    );
  }

  const scopeLabel = getScopeLabel(agent.pluginScope);
  const subtitle = isCustom
    ? "Custom agent"
    : agent.marketplace && agent.marketplace !== "local"
      ? `${agent.pluginName} @ ${agent.marketplace}`
      : agent.pluginName;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={`flex-shrink-0 px-5 py-4 border-b ${border.section}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-mono text-cyan-400">{agent.id}</span>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full text-cyan-300 bg-cyan-900/30">
                {scopeLabel}
              </span>
              {isCustom ? (
                <span className="text-[11px] px-2.5 py-0.5 rounded-full text-cyan-300 bg-cyan-900/30">
                  Custom
                </span>
              ) : agent.pluginEnabled ? (
                <span className="text-[11px] px-2.5 py-0.5 rounded-full text-teal-300 bg-teal-900/30">
                  Enabled
                </span>
              ) : (
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full ${text.dimmed} bg-white/[0.06]`}
                >
                  Plugin disabled
                </span>
              )}
            </div>
            <h2 className={`text-[15px] font-semibold ${text.primary} leading-snug`}>
              {agent.name}
            </h2>
            <p className={`text-[11px] ${text.muted} mt-0.5`}>{subtitle}</p>
          </div>
          <div className="flex items-center gap-1">
            {isCustom && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className={`p-1.5 rounded-lg ${text.muted} hover:text-red-400 hover:bg-red-900/20 transition-colors`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-10">
        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>Description</h3>
          <EditableTextareaCard
            value={agentDescription}
            onSave={handleSaveDescription}
            editable={isCustom}
            rows={3}
            renderPreview={(value) => <p className={`text-xs ${text.secondary}`}>{value}</p>}
            emptyPlaceholder={
              isCustom ? undefined : (
                <p className={`text-xs ${text.dimmed} italic`}>No description</p>
              )
            }
            showClickHint={isCustom}
            contentPaddingClassName="px-3 py-2 min-h-[40px]"
            hintClassName="text-[10px] mt-2"
          />
        </section>

        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>Source</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${text.dimmed} w-24 flex-shrink-0`}>
                {isCustom ? "Type" : "Plugin"}
              </span>
              <span className={`text-xs ${text.secondary}`}>
                {isCustom ? "Custom markdown agent" : agent.pluginName}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${text.dimmed} w-24 flex-shrink-0`}>Install Path</span>
              <span className={`text-[10px] font-mono ${text.dimmed} truncate`}>
                {agent.installPath}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${text.dimmed} w-24 flex-shrink-0`}>Agent File</span>
              <span className={`text-[10px] font-mono ${text.dimmed} truncate`}>
                {agent.agentPath}
              </span>
            </div>
          </div>
        </section>

        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>Enabled</h3>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`text-xs ${text.secondary}`}>
                {isEnabled ? "Enabled" : "Disabled"}
              </span>
              {togglingEnabled ? (
                <Spinner size="xs" className={text.muted} />
              ) : (
                <ToggleSwitch checked={isEnabled} onToggle={handleEnabledToggle} />
              )}
            </div>
            {!isCustom && (
              <p className={`text-[10px] ${text.dimmed}`}>
                This agent is provided by a plugin. Toggling this will enable or disable the entire
                plugin.
              </p>
            )}
            {enabledError && <p className={`text-[10px] ${text.error}`}>{enabledError}</p>}
          </div>
        </section>

        {isCustom && (
          <section>
            <h3 className={`text-[11px] font-medium ${text.muted} mb-3`}>Deployment</h3>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] overflow-hidden">
              <div className={`grid grid-cols-[1fr_80px_80px] px-3 py-2 border-b ${border.subtle}`}>
                <span className={`text-[10px] font-medium ${text.dimmed}`}>Agent</span>
                <span className={`text-[10px] font-medium ${text.dimmed} text-center`}>Global</span>
                <span className={`text-[10px] font-medium ${text.dimmed} text-center`}>
                  Project
                </span>
              </div>
              {AGENTS.map((targetAgent) => {
                const status = deploymentMap[targetAgent.id] ?? {};
                return (
                  <div
                    key={targetAgent.id}
                    className={`grid grid-cols-[1fr_80px_80px] px-3 py-2 border-b last:border-b-0 ${border.subtle} hover:bg-white/[0.02]`}
                  >
                    <span className={`text-xs ${text.secondary}`}>{targetAgent.label}</span>
                    {SCOPES.map((scope) => {
                      const isDeployed = !!status[scope];
                      const isToggling = deploying === `${targetAgent.id}-${scope}`;
                      return (
                        <div key={scope} className="flex justify-center items-center">
                          {isToggling ? (
                            <Spinner size="xs" className={text.dimmed} />
                          ) : (
                            <ToggleSwitch
                              checked={isDeployed}
                              onToggle={() =>
                                void handleDeployToggle(targetAgent.id, scope, isDeployed)
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
        )}

        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>Definition</h3>
          <EditableTextareaCard
            value={agentContent}
            onSave={saveDefinition}
            editable={isCustom}
            rows={16}
            monospace
            pathAnnotation={{
              text: `${isCustom ? "Registry file" : "Agent file"}: ${agent.agentPath}`,
              title: agent.agentPath,
            }}
            renderPreview={(value) => <MarkdownContent content={value} />}
            showClickHint={isCustom}
            hintClassName="text-[10px] mt-2"
          />
        </section>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete custom agent?"
          confirmLabel={deleting ? "Deleting..." : "Delete"}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        >
          <p className={`text-xs ${text.secondary}`}>
            This will remove <span className="font-mono">{agent.agentPath}</span>.
          </p>
        </ConfirmDialog>
      )}

      {showPluginToggleConfirm && (
        <ConfirmDialog
          title={`${isEnabled ? "Disable" : "Enable"} plugin "${agent.pluginName}"?`}
          confirmLabel={isEnabled ? "Disable plugin" : "Enable plugin"}
          onConfirm={() => {
            setShowPluginToggleConfirm(false);
            void handlePluginEnabledToggle();
          }}
          onCancel={() => setShowPluginToggleConfirm(false)}
        >
          <p className={`text-xs ${text.secondary}`}>
            This agent belongs to a Claude plugin. This action will{" "}
            <span className="font-medium">{isEnabled ? "disable" : "enable"}</span> the entire
            plugin in the{" "}
            <span className="font-medium">{getPluginScopeLabel(agent.pluginScope)}</span> scope.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
