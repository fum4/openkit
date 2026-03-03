import { useState, useRef, useEffect } from "react";
import { Bot, FileCode, Filter, Plus, Server, Settings, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import type { ClaudeAgentSummary, McpServerSummary, SkillSummary, PluginSummary } from "../types";
import { useApi } from "../hooks/useApi";
import { useAgentRule } from "../hooks/useAgentRules";
import { agentRule, border, surface, text } from "../theme";
import { AgentItem } from "./AgentItem";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeployMatrixDialog } from "./DeployMatrixDialog";
import { McpServerItem } from "./McpServerItem";
import { SkillItem } from "./SkillItem";
import { PluginItem } from "./PluginItem";
import { Spinner } from "./Spinner";
import { ToggleSwitch } from "./ToggleSwitch";

type AgentSelection =
  | { type: "agent-rule"; fileId: string }
  | { type: "agent"; id: string }
  | { type: "mcp-server"; id: string }
  | { type: "skill"; name: string }
  | { type: "plugin"; id: string }
  | null;

type AgentDeploymentState = { global?: boolean; project?: boolean };
type DeploymentScope = "global" | "project";

const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "vscode", label: "VS Code" },
  { id: "codex", label: "Codex" },
] as const;
const SCOPES: DeploymentScope[] = ["global", "project"];

function getSearchValue(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function getAgentDeploymentEntries(
  deployments: ClaudeAgentSummary["deployments"],
): AgentDeploymentState[] {
  if (!deployments || typeof deployments !== "object") return [];
  return Object.values(deployments).filter(
    (value): value is AgentDeploymentState =>
      !!value && typeof value === "object" && !Array.isArray(value),
  );
}

function hasAgentDeploymentScope(
  deployments: ClaudeAgentSummary["deployments"],
  scope: "global" | "project",
): boolean {
  return getAgentDeploymentEntries(deployments).some((value) => value[scope] === true);
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`w-3 h-3 ${text.muted} transition-transform duration-150 ${
        collapsed ? "" : "rotate-90"
      }`}
    >
      <path
        fillRule="evenodd"
        d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

interface AgentsSidebarProps {
  agents: ClaudeAgentSummary[];
  agentsLoading: boolean;
  agentsFetching?: boolean;
  servers: McpServerSummary[];
  serversLoading: boolean;
  deploymentStatus: Record<string, Record<string, { global?: boolean; project?: boolean }>>;
  skills: SkillSummary[];
  skillsLoading: boolean;
  skillDeploymentStatus: Record<
    string,
    {
      inRegistry: boolean;
      agents: Record<string, { global?: boolean; project?: boolean }>;
    }
  >;
  plugins: PluginSummary[];
  pluginsLoading: boolean;
  selection: AgentSelection;
  onSelect: (selection: AgentSelection) => void;
  search: string;
  onAddAgent: () => void;
  onAddServer: () => void;
  onAddSkill: () => void;
  onAddPlugin: () => void;
  pluginActing?: boolean;
  onPluginActingChange?: (acting: boolean) => void;
  allowAgentCommits?: boolean;
  allowAgentPushes?: boolean;
  allowAgentPRs?: boolean;
  onTogglePolicy: (key: "allowAgentCommits" | "allowAgentPushes" | "allowAgentPRs") => void;
}

export function AgentsSidebar({
  agents,
  agentsLoading,
  agentsFetching,
  servers,
  serversLoading,
  deploymentStatus,
  skills,
  skillsLoading,
  skillDeploymentStatus,
  plugins,
  pluginsLoading,
  selection,
  onSelect,
  search,
  onAddAgent,
  onAddServer,
  onAddSkill,
  onAddPlugin,
  pluginActing,
  onPluginActingChange,
  allowAgentCommits,
  allowAgentPushes,
  allowAgentPRs,
  onTogglePolicy,
}: AgentsSidebarProps) {
  const api = useApi();
  const queryClient = useQueryClient();

  const [rulesCollapsed, setRulesCollapsed] = useState(
    () => localStorage.getItem("OpenKit:agentsRulesCollapsed") === "1",
  );
  const [mcpCollapsed, setMcpCollapsed] = useState(
    () => localStorage.getItem("OpenKit:agentsMcpCollapsed") === "1",
  );
  const [agentsCollapsed, setAgentsCollapsed] = useState(
    () => localStorage.getItem("OpenKit:agentsListCollapsed") === "1",
  );
  const [skillsCollapsed, setSkillsCollapsed] = useState(
    () => localStorage.getItem("OpenKit:agentsSkillsCollapsed") === "1",
  );
  const [pluginsCollapsed, setPluginsCollapsed] = useState(
    () => localStorage.getItem("OpenKit:agentsPluginsCollapsed") === "1",
  );

  const [showGlobal, setShowGlobal] = useState(() => {
    const saved = localStorage.getItem("OpenKit:agentsShowGlobal");
    return saved !== null ? saved === "1" : true;
  });
  const [showProject, setShowProject] = useState(() => {
    const saved = localStorage.getItem("OpenKit:agentsShowProject");
    return saved !== null ? saved === "1" : true;
  });
  const [configOpen, setConfigOpen] = useState(false);
  const configRef = useRef<HTMLDivElement>(null);

  const [pendingRemove, setPendingRemove] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);
  const [deployDialog, setDeployDialog] = useState<{
    type: "mcp" | "skill" | "agent";
    id: string;
    name: string;
  } | null>(null);
  const [pendingAgentDisableConfirm, setPendingAgentDisableConfirm] = useState<{
    agent: ClaudeAgentSummary;
    apply: () => Promise<void>;
  } | null>(null);

  const [hiddenMarketplaces, setHiddenMarketplaces] = useState<Set<string>>(() => {
    const saved = localStorage.getItem("OpenKit:hiddenMarketplaces");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("OpenKit:agentsRulesCollapsed", rulesCollapsed ? "1" : "0");
  }, [rulesCollapsed]);
  useEffect(() => {
    localStorage.setItem("OpenKit:agentsMcpCollapsed", mcpCollapsed ? "1" : "0");
  }, [mcpCollapsed]);
  useEffect(() => {
    localStorage.setItem("OpenKit:agentsListCollapsed", agentsCollapsed ? "1" : "0");
  }, [agentsCollapsed]);
  useEffect(() => {
    localStorage.setItem("OpenKit:agentsSkillsCollapsed", skillsCollapsed ? "1" : "0");
  }, [skillsCollapsed]);
  useEffect(() => {
    localStorage.setItem("OpenKit:agentsPluginsCollapsed", pluginsCollapsed ? "1" : "0");
  }, [pluginsCollapsed]);
  useEffect(() => {
    localStorage.setItem("OpenKit:agentsShowGlobal", showGlobal ? "1" : "0");
  }, [showGlobal]);
  useEffect(() => {
    localStorage.setItem("OpenKit:agentsShowProject", showProject ? "1" : "0");
  }, [showProject]);
  useEffect(() => {
    if (!configOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (configRef.current && !configRef.current.contains(e.target as Node)) {
        setConfigOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [configOpen]);
  useEffect(() => {
    localStorage.setItem("OpenKit:hiddenMarketplaces", JSON.stringify([...hiddenMarketplaces]));
  }, [hiddenMarketplaces]);
  useEffect(() => {
    if (!filterOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [filterOpen]);

  const filteredServers = servers;

  const loweredSearch = search.toLowerCase();
  const filteredAgents = search
    ? agents.filter((agent) => {
        return (
          getSearchValue(agent.name).includes(loweredSearch) ||
          getSearchValue(agent.pluginName).includes(loweredSearch) ||
          getSearchValue(agent.pluginId).includes(loweredSearch) ||
          getSearchValue(agent.description).includes(loweredSearch)
        );
      })
    : agents;

  const filteredSkills = search
    ? skills.filter(
        (s) =>
          s.displayName.toLowerCase().includes(search.toLowerCase()) ||
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase()),
      )
    : skills;

  const filteredPlugins = search
    ? plugins.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.description.toLowerCase().includes(search.toLowerCase()),
      )
    : plugins;

  // Filter helpers
  const isServerVisible = (serverId: string) => {
    if (showGlobal && showProject) return true;
    const st = deploymentStatus[serverId] ?? {};
    const hasGlobal = Object.values(st).some((v) => v.global);
    const hasProj = Object.values(st).some((v) => v.project);
    const isActive = hasGlobal || hasProj;
    if (!isActive) return true; // inactive items always show
    if (showGlobal && hasGlobal) return true;
    if (showProject && hasProj) return true;
    return false;
  };

  const isSkillVisible = (skillName: string) => {
    if (showGlobal && showProject) return true;
    const st = skillDeploymentStatus[skillName];
    if (!st) return true;
    const agents = st.agents ?? {};
    const hasGlobal = Object.values(agents).some((v) => v.global);
    const hasProj = Object.values(agents).some((v) => v.project);
    const isActive = hasGlobal || hasProj;
    if (!isActive) return true;
    if (showGlobal && hasGlobal) return true;
    if (showProject && hasProj) return true;
    return false;
  };

  const isAgentVisible = (agent: ClaudeAgentSummary) => {
    if (showGlobal && showProject) return true;
    const hasGlobal = hasAgentDeploymentScope(agent.deployments, "global");
    const hasProject = hasAgentDeploymentScope(agent.deployments, "project");
    if (!hasGlobal && !hasProject) return true;
    if (showGlobal && hasGlobal) return true;
    if (showProject && hasProject) return true;
    return false;
  };

  const isAgentEnabled = (agent: ClaudeAgentSummary) => {
    const hasAnyDeployment =
      hasAgentDeploymentScope(agent.deployments, "global") ||
      hasAgentDeploymentScope(agent.deployments, "project");
    return hasAnyDeployment || agent.pluginEnabled;
  };

  const isPluginVisible = (plugin: PluginSummary) => {
    if (showGlobal && showProject) return true;
    if (plugin.scope === "user") return showGlobal;
    if (plugin.scope === "project" || plugin.scope === "local") return showProject;
    return true;
  };

  // Sort plugins: errors first, then warnings, then enabled, then disabled; alphabetical within each group
  const pluginSortPriority = (p: PluginSummary) => {
    if (p.error) return 0;
    if (p.warning) return 1;
    if (p.enabled) return 2;
    return 3;
  };
  const marketplaceNames = [...new Set(plugins.map((p) => p.marketplace).filter(Boolean))].sort();

  const toggleMarketplace = (name: string) => {
    setHiddenMarketplaces((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const sortedPlugins = [...filteredPlugins]
    .filter((p) => isPluginVisible(p) && (!p.marketplace || !hiddenMarketplaces.has(p.marketplace)))
    .sort((a, b) => {
      const pa = pluginSortPriority(a);
      const pb = pluginSortPriority(b);
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-8">
        {/* Rules Section */}
        <div>
          <div className="relative mb-px group">
            <button
              type="button"
              onClick={() => setRulesCollapsed(!rulesCollapsed)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.03] cursor-pointer transition-colors duration-150"
            >
              <ChevronIcon collapsed={rulesCollapsed} />
              <span className={`text-[11px] font-medium ${text.secondary}`}>Rules</span>
              <span
                className={`text-[10px] ${text.muted} bg-white/[0.06] px-1.5 py-0.5 rounded-full`}
              >
                2
              </span>
            </button>
          </div>

          {!rulesCollapsed && (
            <div className="space-y-px">
              {(
                [
                  { fileId: "claude-md", label: "CLAUDE.md" },
                  { fileId: "agents-md", label: "AGENTS.md" },
                ] as const
              ).map((item) => (
                <RuleItem
                  key={item.fileId}
                  fileId={item.fileId}
                  label={item.label}
                  isSelected={selection?.type === "agent-rule" && selection.fileId === item.fileId}
                  onSelect={() => onSelect({ type: "agent-rule", fileId: item.fileId })}
                  onRequestDelete={setPendingRemove}
                />
              ))}
            </div>
          )}
        </div>

        {/* Agents Section */}
        <div>
          <div className="relative mb-px group">
            <button
              type="button"
              onClick={() => setAgentsCollapsed(!agentsCollapsed)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.03] group-hover:bg-white/[0.03] cursor-pointer transition-colors duration-150"
            >
              <ChevronIcon collapsed={agentsCollapsed} />
              <span className={`text-[11px] font-medium ${text.secondary}`}>Agents</span>
              <span className="inline-flex items-center h-[18px]">
                {agentsLoading || agentsFetching ? (
                  <Spinner size="xs" className={`${text.muted} ml-0.5`} />
                ) : (
                  <span
                    className={`text-[10px] ${text.muted} bg-white/[0.06] px-1.5 py-0.5 rounded-full`}
                  >
                    {filteredAgents.filter((agent) => isAgentVisible(agent)).length}
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={onAddAgent}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${text.dimmed} hover:text-white transition-colors z-10`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {!agentsCollapsed && (
            <div className="space-y-px">
              {[...filteredAgents]
                .filter((agent) => isAgentVisible(agent))
                .sort((a, b) => {
                  const aEnabled = isAgentEnabled(a);
                  const bEnabled = isAgentEnabled(b);
                  if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
                  const pluginCmp = a.pluginName.localeCompare(b.pluginName);
                  if (pluginCmp !== 0) return pluginCmp;
                  return a.name.localeCompare(b.name);
                })
                .map((agent) => {
                  return (
                    <AgentItem
                      key={agent.id}
                      agent={agent}
                      isEnabled={isAgentEnabled(agent)}
                      isSelected={selection?.type === "agent" && selection.id === agent.id}
                      onSelect={() => onSelect({ type: "agent", id: agent.id })}
                      onToggleEnabled={() => {
                        setDeployDialog({
                          type: "agent",
                          id: agent.id,
                          name: agent.name,
                        });
                      }}
                      onRemove={
                        agent.isCustom
                          ? () => {
                              setPendingRemove({
                                title: "Delete custom agent?",
                                message: `This will delete "${agent.name}" from your custom agents registry.`,
                                confirmLabel: "Delete",
                                action: async () => {
                                  await api.deleteCustomClaudeAgent(agent.id);
                                  await queryClient.invalidateQueries({
                                    queryKey: ["claudeAgents"],
                                  });
                                  if (selection?.type === "agent" && selection.id === agent.id) {
                                    onSelect(null as unknown as AgentSelection);
                                  }
                                },
                              });
                            }
                          : undefined
                      }
                    />
                  );
                })}
              {!agentsLoading &&
                filteredAgents.filter((agent) => isAgentVisible(agent)).length === 0 && (
                  <div className="flex justify-center py-4">
                    <p className={`text-xs ${text.dimmed}`}>No agents found</p>
                  </div>
                )}
            </div>
          )}
        </div>

        {/* MCP Servers Section */}
        <div>
          <div className="relative mb-px group">
            <button
              type="button"
              onClick={() => setMcpCollapsed(!mcpCollapsed)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.03] group-hover:bg-white/[0.03] cursor-pointer transition-colors duration-150"
            >
              <ChevronIcon collapsed={mcpCollapsed} />
              <span className={`text-[11px] font-medium ${text.secondary}`}>MCP Servers</span>
              <span className="inline-flex items-center h-[18px]">
                {serversLoading ? (
                  <Spinner size="xs" className={`${text.muted} ml-0.5`} />
                ) : (
                  <span
                    className={`text-[10px] ${text.muted} bg-white/[0.06] px-1.5 py-0.5 rounded-full`}
                  >
                    {filteredServers.filter((server) => isServerVisible(server.id)).length}
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={onAddServer}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${text.dimmed} hover:text-white transition-colors z-10`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {!mcpCollapsed && (
            <div className="space-y-px">
              {serversLoading
                ? null
                : [...filteredServers]
                    .filter((server) => isServerVisible(server.id))
                    .sort((a, b) => {
                      const statusA = deploymentStatus[a.id] ?? {};
                      const statusB = deploymentStatus[b.id] ?? {};
                      const activeA = Object.values(statusA).some(
                        (value) => value.global || value.project,
                      );
                      const activeB = Object.values(statusB).some(
                        (value) => value.global || value.project,
                      );
                      if (activeA !== activeB) return activeA ? -1 : 1;
                      return a.name.localeCompare(b.name);
                    })
                    .map((server) => {
                      const status = deploymentStatus[server.id] ?? {};
                      const agents = Object.entries(status)
                        .filter(([, value]) => value.global || value.project)
                        .map(([name]) => name);
                      return (
                        <McpServerItem
                          key={server.id}
                          server={server}
                          isSelected={
                            selection?.type === "mcp-server" && selection.id === server.id
                          }
                          onSelect={() => onSelect({ type: "mcp-server", id: server.id })}
                          isActive={agents.length > 0}
                          onDeploy={() =>
                            setDeployDialog({
                              type: "mcp",
                              id: server.id,
                              name: server.name,
                            })
                          }
                          onRemove={() => {
                            setPendingRemove({
                              title: "Delete MCP server?",
                              message: `This will remove "${server.name}" from the registry.`,
                              confirmLabel: "Delete",
                              action: async () => {
                                for (const [tool, scopes] of Object.entries(status)) {
                                  if (scopes.global)
                                    await api.undeployMcpServer(server.id, tool, "global");
                                  if (scopes.project)
                                    await api.undeployMcpServer(server.id, tool, "project");
                                }
                                await api.deleteMcpServer(server.id);
                                await queryClient.invalidateQueries({
                                  queryKey: ["mcpServers"],
                                });
                                await queryClient.invalidateQueries({
                                  queryKey: ["mcpDeploymentStatus"],
                                });
                                if (
                                  selection?.type === "mcp-server" &&
                                  selection.id === server.id
                                ) {
                                  onSelect(null as unknown as AgentSelection);
                                }
                              },
                            });
                          }}
                        />
                      );
                    })}
            </div>
          )}
        </div>

        {/* Skills Section */}
        <div>
          <div className="relative mb-px group">
            <button
              type="button"
              onClick={() => setSkillsCollapsed(!skillsCollapsed)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.03] group-hover:bg-white/[0.03] cursor-pointer transition-colors duration-150"
            >
              <ChevronIcon collapsed={skillsCollapsed} />
              <span className={`text-[11px] font-medium ${text.secondary}`}>Skills</span>
              <span className="inline-flex items-center h-[18px]">
                {skillsLoading ? (
                  <Spinner size="xs" className={`${text.muted} ml-0.5`} />
                ) : (
                  <span
                    className={`text-[10px] ${text.muted} bg-white/[0.06] px-1.5 py-0.5 rounded-full`}
                  >
                    {filteredSkills.filter((s) => isSkillVisible(s.name)).length}
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={onAddSkill}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${text.dimmed} hover:text-white transition-colors z-10`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {!skillsCollapsed && (
            <div className="space-y-px">
              {skillsLoading ? null : (
                <>
                  {[...filteredSkills]
                    .filter((s) => isSkillVisible(s.name))
                    .sort((a, b) => {
                      const aAgents = skillDeploymentStatus[a.name]?.agents ?? {};
                      const bAgents = skillDeploymentStatus[b.name]?.agents ?? {};
                      const aActive = Object.values(aAgents).some((v) => v.global || v.project);
                      const bActive = Object.values(bAgents).some((v) => v.global || v.project);
                      if (aActive !== bActive) return aActive ? -1 : 1;
                      return a.displayName.localeCompare(b.displayName);
                    })
                    .map((skill) => {
                      const agents = skillDeploymentStatus[skill.name]?.agents ?? {};
                      const isDeployed = Object.values(agents).some((v) => v.global || v.project);

                      return (
                        <SkillItem
                          key={skill.name}
                          skill={skill}
                          isSelected={selection?.type === "skill" && selection.name === skill.name}
                          onSelect={() => onSelect({ type: "skill", name: skill.name })}
                          isDeployed={isDeployed}
                          onDeploy={() =>
                            setDeployDialog({
                              type: "skill",
                              id: skill.name,
                              name: skill.displayName,
                            })
                          }
                          onRemove={() => {
                            setPendingRemove({
                              title: "Delete skill?",
                              message: `The skill "${skill.displayName}" will be deleted.`,
                              confirmLabel: "Delete",
                              action: async () => {
                                await api.deleteSkill(skill.name);
                                await queryClient.invalidateQueries({
                                  queryKey: ["skills"],
                                });
                                await queryClient.invalidateQueries({
                                  queryKey: ["skillDeploymentStatus"],
                                });
                                if (selection?.type === "skill" && selection.name === skill.name) {
                                  onSelect(null as unknown as AgentSelection);
                                }
                              },
                            });
                          }}
                        />
                      );
                    })}
                  {filteredSkills.filter((s) => isSkillVisible(s.name)).length === 0 && (
                    <div className="flex justify-center py-4">
                      <p className={`text-xs ${text.dimmed}`}>No skills yet</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Plugins Section */}
        <div>
          <div className="relative mb-px group">
            <button
              type="button"
              onClick={() => setPluginsCollapsed(!pluginsCollapsed)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.03] group-hover:bg-white/[0.03] cursor-pointer transition-colors duration-150"
            >
              <ChevronIcon collapsed={pluginsCollapsed} />
              <span className={`text-[11px] font-medium ${text.secondary}`}>Claude Plugins</span>
              <span className="inline-flex items-center h-[18px]">
                {pluginsLoading ? (
                  <Spinner size="xs" className={`${text.muted} ml-0.5`} />
                ) : (
                  <span
                    className={`text-[10px] ${text.muted} bg-white/[0.06] px-1.5 py-0.5 rounded-full`}
                  >
                    {sortedPlugins.length}
                  </span>
                )}
              </span>
            </button>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 z-10">
              {marketplaceNames.length > 1 && (
                <div className="relative" ref={filterRef}>
                  <button
                    type="button"
                    onClick={() => setFilterOpen(!filterOpen)}
                    className={`p-1 rounded transition-colors duration-150 ${
                      hiddenMarketplaces.size > 0
                        ? "text-teal-400 hover:text-teal-300 hover:bg-white/[0.06]"
                        : `${text.dimmed} hover:${text.muted} hover:bg-white/[0.06]`
                    }`}
                  >
                    <Filter className="w-3 h-3" />
                  </button>
                  {filterOpen && (
                    <div className="absolute right-0 top-full mt-1 w-48 rounded-lg bg-[#1a1d24] border border-white/[0.08] shadow-xl py-1 z-50">
                      {marketplaceNames.map((name) => (
                        <SettingsToggle
                          key={name}
                          label={name}
                          checked={!hiddenMarketplaces.has(name)}
                          onToggle={() => toggleMarketplace(name)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={onAddPlugin}
                className={`p-1 rounded ${text.dimmed} hover:text-white transition-colors`}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {!pluginsCollapsed && (
            <div className="space-y-px">
              {pluginsLoading ? null : sortedPlugins.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-4">
                  <p className={`text-xs ${text.dimmed}`}>No plugins yet</p>
                </div>
              ) : (
                sortedPlugins.map((plugin) => (
                  <PluginItem
                    key={plugin.id}
                    plugin={plugin}
                    isSelected={selection?.type === "plugin" && selection.id === plugin.id}
                    onSelect={() => onSelect({ type: "plugin", id: plugin.id })}
                    disabled={pluginActing}
                    onToggleEnabled={async () => {
                      onPluginActingChange?.(true);
                      try {
                        if (plugin.enabled) {
                          await api.disableClaudePlugin(plugin.id, plugin.scope);
                        } else {
                          await api.enableClaudePlugin(plugin.id, plugin.scope);
                        }
                        await Promise.all([
                          queryClient.invalidateQueries({
                            queryKey: ["claudePlugins"],
                          }),
                          queryClient.invalidateQueries({
                            queryKey: ["claudePlugin"],
                          }),
                          queryClient.invalidateQueries({
                            queryKey: ["claudeAgents"],
                          }),
                        ]);
                      } finally {
                        onPluginActingChange?.(false);
                      }
                    }}
                    onRemove={() => {
                      const displayName = plugin.name.replace(/@.*$/, "");
                      setPendingRemove({
                        title: "Uninstall plugin?",
                        message: `The plugin "${displayName}" will be uninstalled.`,
                        confirmLabel: "Uninstall",
                        action: async () => {
                          await api.uninstallClaudePlugin(plugin.id, plugin.scope);
                          await queryClient.invalidateQueries({
                            queryKey: ["claudePlugins"],
                          });
                          await queryClient.invalidateQueries({
                            queryKey: ["claudeAgents"],
                          });
                          if (selection?.type === "plugin" && selection.id === plugin.id) {
                            onSelect(null as unknown as AgentSelection);
                          }
                        },
                      });
                    }}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Settings bar with Git Policy */}
      <div
        className={`flex-shrink-0 border-t ${border.subtle} px-2 py-2 flex items-center justify-between`}
      >
        <div className="relative" ref={configRef}>
          <button
            type="button"
            onClick={() => setConfigOpen(!configOpen)}
            className={`p-1 rounded transition-colors duration-150 ${
              configOpen
                ? `${text.secondary} bg-white/[0.06]`
                : `${text.dimmed} hover:${text.secondary} hover:bg-white/[0.06]`
            }`}
          >
            <Settings className="w-[18px] h-[18px]" />
          </button>

          {configOpen && (
            <div className="absolute bottom-full left-0 mb-1 w-44 rounded-lg bg-[#1a1d24] border border-white/[0.08] shadow-xl py-1 z-50">
              <SettingsToggle
                label="Show global"
                checked={showGlobal}
                onToggle={() => setShowGlobal(!showGlobal)}
              />
              <SettingsToggle
                label="Show project"
                checked={showProject}
                onToggle={() => setShowProject(!showProject)}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {(["allowAgentCommits", "allowAgentPushes", "allowAgentPRs"] as const).map((key) => {
            const label =
              key === "allowAgentCommits"
                ? "Commits"
                : key === "allowAgentPushes"
                  ? "Pushes"
                  : "PRs";
            const enabled =
              key === "allowAgentCommits"
                ? allowAgentCommits
                : key === "allowAgentPushes"
                  ? allowAgentPushes
                  : allowAgentPRs;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onTogglePolicy(key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors duration-150 ${
                  enabled
                    ? "bg-teal-500/[0.15] text-teal-300"
                    : `bg-white/[0.06] ${text.dimmed} hover:${text.muted}`
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${enabled ? "bg-teal-400" : "bg-white/20"}`}
                />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Remove confirmation dialog */}
      {pendingRemove && (
        <ConfirmDialog
          title={pendingRemove.title}
          confirmLabel={pendingRemove.confirmLabel}
          onConfirm={() => {
            const { action } = pendingRemove;
            setPendingRemove(null);
            action();
          }}
          onCancel={() => setPendingRemove(null)}
        >
          <p className={`text-xs ${text.secondary}`}>{pendingRemove.message}</p>
        </ConfirmDialog>
      )}

      {pendingAgentDisableConfirm && (
        <ConfirmDialog
          title={`Disable plugin "${pendingAgentDisableConfirm.agent.pluginName}"?`}
          confirmLabel="Disable plugin"
          onConfirm={() => {
            const pending = pendingAgentDisableConfirm;
            setPendingAgentDisableConfirm(null);
            if (!pending) return;
            void pending.apply();
          }}
          onCancel={() => setPendingAgentDisableConfirm(null)}
        >
          <p className={`text-xs ${text.secondary}`}>
            This agent is provided by a Claude plugin. Disabling Claude deployment will disable the
            entire plugin for the{" "}
            <span className="font-medium">
              {pendingAgentDisableConfirm.agent.pluginScope === "user"
                ? "global"
                : pendingAgentDisableConfirm.agent.pluginScope}
            </span>{" "}
            scope.
          </p>
        </ConfirmDialog>
      )}

      {deployDialog && (
        <DeployMatrixDialog
          title={`Deploy ${deployDialog.name}`}
          icon={
            deployDialog.type === "mcp" ? (
              <Server className="w-4 h-4 text-purple-400" />
            ) : deployDialog.type === "skill" ? (
              <Sparkles className="w-4 h-4 text-pink-400" />
            ) : (
              <Bot className="w-4 h-4 text-cyan-400" />
            )
          }
          agents={AGENTS.map((agent) => ({ id: agent.id, label: agent.label }))}
          status={AGENTS.reduce<Record<string, AgentDeploymentState>>((acc, agent) => {
            if (deployDialog.type === "mcp") {
              acc[agent.id] = deploymentStatus[deployDialog.id]?.[agent.id] ?? {};
            } else if (deployDialog.type === "skill") {
              acc[agent.id] = skillDeploymentStatus[deployDialog.id]?.agents?.[agent.id] ?? {};
            } else {
              const selectedAgent = agents.find((candidate) => candidate.id === deployDialog.id);
              acc[agent.id] =
                (selectedAgent?.deployments?.[agent.id] as AgentDeploymentState) ?? {};
            }
            return acc;
          }, {})}
          onApply={async (desired) => {
            const targetAgent =
              deployDialog.type === "agent"
                ? (agents.find((candidate) => candidate.id === deployDialog.id) ?? null)
                : null;
            const currentByAgent = AGENTS.reduce<Record<string, AgentDeploymentState>>(
              (acc, agent) => {
                if (deployDialog.type === "mcp") {
                  acc[agent.id] = deploymentStatus[deployDialog.id]?.[agent.id] ?? {};
                } else if (deployDialog.type === "skill") {
                  acc[agent.id] = skillDeploymentStatus[deployDialog.id]?.agents?.[agent.id] ?? {};
                } else {
                  acc[agent.id] =
                    (targetAgent?.deployments?.[agent.id] as AgentDeploymentState) ?? {};
                }
                return acc;
              },
              {},
            );

            const runApply = async () => {
              for (const agent of AGENTS) {
                const current = currentByAgent[agent.id] ?? {};
                const next = desired[agent.id] ?? {};
                for (const scope of SCOPES) {
                  const isCurrent = !!current[scope];
                  const isNext = !!next[scope];
                  if (isCurrent === isNext) continue;

                  if (deployDialog.type === "mcp") {
                    if (isNext) await api.deployMcpServer(deployDialog.id, agent.id, scope);
                    else await api.undeployMcpServer(deployDialog.id, agent.id, scope);
                  } else if (deployDialog.type === "skill") {
                    if (isNext) await api.deploySkill(deployDialog.id, agent.id, scope);
                    else await api.undeploySkill(deployDialog.id, agent.id, scope);
                  } else if (targetAgent?.isCustom) {
                    if (isNext) {
                      await api.deployCustomClaudeAgent(deployDialog.id, agent.id, scope);
                    } else {
                      await api.undeployCustomClaudeAgent(deployDialog.id, agent.id, scope);
                    }
                  } else {
                    if (isNext) {
                      await api.deployPluginClaudeAgent(deployDialog.id, agent.id, scope);
                    } else {
                      await api.undeployPluginClaudeAgent(deployDialog.id, agent.id, scope);
                    }
                  }
                }
              }

              if (deployDialog.type === "mcp") {
                await queryClient.invalidateQueries({ queryKey: ["mcpDeploymentStatus"] });
              } else if (deployDialog.type === "skill") {
                await queryClient.invalidateQueries({ queryKey: ["skillDeploymentStatus"] });
              } else {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["claudePlugins"] }),
                  queryClient.invalidateQueries({ queryKey: ["claudeAgents"] }),
                  queryClient.invalidateQueries({ queryKey: ["claudeAgent"] }),
                ]);
              }
            };

            if (
              deployDialog.type === "agent" &&
              targetAgent &&
              !targetAgent.isCustom &&
              currentByAgent.claude?.[targetAgent.pluginScope === "user" ? "global" : "project"] &&
              !desired.claude?.[targetAgent.pluginScope === "user" ? "global" : "project"]
            ) {
              setPendingAgentDisableConfirm({
                agent: targetAgent,
                apply: async () => {
                  onPluginActingChange?.(true);
                  try {
                    await runApply();
                    setDeployDialog(null);
                  } finally {
                    onPluginActingChange?.(false);
                  }
                },
              });
              return false;
            }

            onPluginActingChange?.(true);
            try {
              await runApply();
            } finally {
              onPluginActingChange?.(false);
            }
          }}
          onClose={() => setDeployDialog(null)}
        />
      )}
    </>
  );
}

function SettingsToggle({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-[11px] ${text.secondary} hover:bg-white/[0.04] transition-colors duration-150`}
    >
      <span
        className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${
          checked ? "bg-teal-400/20 border-teal-400/40" : "border-white/[0.15]"
        }`}
      >
        {checked && (
          <svg
            className="w-2 h-2 text-teal-400"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}

// ─── Rule item ──────────────────────────────────────────────────

const RULE_INITIAL: Record<string, string> = {
  "claude-md": "# CLAUDE.md\n\n",
  "agents-md": "# AGENTS.md\n\n",
};

function RuleItem({
  fileId,
  label,
  isSelected,
  onSelect,
  onRequestDelete,
}: {
  fileId: string;
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  onRequestDelete: (opts: {
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  }) => void;
}) {
  const api = useApi();
  const { exists, refetch } = useAgentRule(fileId);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (exists) {
      onRequestDelete({
        title: `Delete ${label}?`,
        message: `This will delete ${label} from disk.`,
        confirmLabel: "Delete",
        action: async () => {
          await api.deleteAgentRule(fileId);
          await refetch();
        },
      });
    } else {
      await api.saveAgentRule(fileId, RULE_INITIAL[fileId]);
      await refetch();
    }
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full text-left px-3 py-3.5 transition-colors duration-150 border-l-2 ${
        isSelected
          ? `${surface.panelSelected} ${agentRule.accentBorder}`
          : `border-transparent hover:${surface.panelHover}`
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <FileCode
          className={`w-3.5 h-3.5 flex-shrink-0 transition-colors duration-150 ${
            isSelected ? "text-white" : `${text.muted} group-hover:text-white`
          }`}
        />
        <span
          className={`text-xs font-medium truncate flex-1 ${
            isSelected ? text.primary : text.secondary
          }`}
        >
          {label}
        </span>

        {/* Status dot / Toggle */}
        <div className="flex-shrink-0 relative" style={{ width: 52, height: 16 }}>
          <div className="absolute inset-0 flex items-center justify-end group-hover:hidden">
            {exists && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0 mr-2" />}
          </div>
          <div className="absolute inset-0 hidden group-hover:flex items-center justify-end mr-[4px]">
            <ToggleSwitch checked={exists} onToggle={handleToggle} size="sm" />
          </div>
        </div>
      </div>
    </button>
  );
}

export type { AgentSelection };
