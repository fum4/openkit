import { useState, useRef, useEffect } from "react";
import { FileCode, Filter, Plus, Server, Settings, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import type { McpServerSummary, SkillSummary, PluginSummary } from "../types";
import { useApi } from "../hooks/useApi";
import { useAgentRule } from "../hooks/useAgentRules";
import { agentRule, border, mcpServer, surface, text } from "../theme";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeployDialog } from "./DeployDialog";
import { McpServerItem } from "./McpServerItem";
import { SkillItem } from "./SkillItem";
import { PluginItem } from "./PluginItem";
import { Spinner } from "./Spinner";
import { ToggleSwitch } from "./ToggleSwitch";

export const OPENKIT_SERVER: McpServerSummary = {
  id: "OpenKit",
  name: "OpenKit",
  description: "Worktree management, issue tracking, and more",
  tags: ["built-in"],
  command: "openkit",
  args: ["mcp"],
  env: {},
  source: "built-in",
  createdAt: "",
  updatedAt: "",
};

type AgentSelection =
  | { type: "agent-rule"; fileId: string }
  | { type: "mcp-server"; id: string }
  | { type: "skill"; name: string }
  | { type: "plugin"; id: string }
  | null;

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`w-3 h-3 ${text.muted} transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
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
  servers: McpServerSummary[];
  serversLoading: boolean;
  deploymentStatus: Record<string, Record<string, { global?: boolean; project?: boolean }>>;
  skills: SkillSummary[];
  skillsLoading: boolean;
  skillDeploymentStatus: Record<
    string,
    { inRegistry: boolean; agents: Record<string, { global?: boolean; project?: boolean }> }
  >;
  plugins: PluginSummary[];
  pluginsLoading: boolean;
  selection: AgentSelection;
  onSelect: (selection: AgentSelection) => void;
  search: string;
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
    type: "mcp" | "skill";
    id: string;
    name: string;
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

  // Filter servers (exclude OpenKit duplicates — handled as built-in item)
  const filteredServers = servers.filter(
    (s) =>
      s.id !== OPENKIT_SERVER.id &&
      !(
        s.name === "OpenKit" &&
        (s.command === "openkit" || s.command === "OpenKit") &&
        Array.isArray(s.args) &&
        s.args[0] === "mcp"
      ),
  );

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

  const OpenKitSeen =
    typeof localStorage !== "undefined" && localStorage.getItem("OpenKit:mcpWork3Seen") === "1";
  const isWork3New = !OpenKitSeen;

  const handleSelectWork3 = () => {
    if (isWork3New) localStorage.setItem("OpenKit:mcpWork3Seen", "1");
    onSelect({ type: "mcp-server", id: OPENKIT_SERVER.id });
  };

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

        {/* MCP Servers Section */}
        <div>
          <div className="relative mb-px group">
            <button
              type="button"
              onClick={() => setMcpCollapsed(!mcpCollapsed)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.03] cursor-pointer transition-colors duration-150"
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
                    {filteredServers.length + 1}
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={onAddServer}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${text.dimmed} hover:${text.muted} hover:bg-white/[0.06] transition-colors z-10`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {!mcpCollapsed && (
            <div className="space-y-px">
              {serversLoading ? (
                <Work3Item
                  isSelected={selection?.type === "mcp-server" && selection.id === OPENKIT_SERVER.id}
                  onSelect={handleSelectWork3}
                  isNew={isWork3New}
                  isActive={Object.values(deploymentStatus[OPENKIT_SERVER.id] ?? {}).some(
                    (v) => v.global || v.project,
                  )}
                  onDeploy={() =>
                    setDeployDialog({ type: "mcp", id: OPENKIT_SERVER.id, name: "OpenKit" })
                  }
                />
              ) : (
                (() => {
                  const OpenKitStatus = deploymentStatus[OPENKIT_SERVER.id] ?? {};
                  const OpenKitActive = Object.values(OpenKitStatus).some((v) => v.global || v.project);

                  type SortEntry = { type: "server"; server: McpServerSummary } | { type: "OpenKit" };
                  const entries: SortEntry[] = [
                    ...(isServerVisible(OPENKIT_SERVER.id) ? [{ type: "OpenKit" as const }] : []),
                    ...filteredServers
                      .filter((s) => isServerVisible(s.id))
                      .map((s) => ({ type: "server" as const, server: s })),
                  ];

                  const isActive = (e: SortEntry) => {
                    if (e.type === "OpenKit") return OpenKitActive;
                    const st = deploymentStatus[e.server.id] ?? {};
                    return Object.values(st).some((v) => v.global || v.project);
                  };
                  const getName = (e: SortEntry) => (e.type === "OpenKit" ? "OpenKit" : e.server.name);

                  entries.sort((a, b) => {
                    const aAct = isActive(a);
                    const bAct = isActive(b);
                    if (aAct !== bAct) return aAct ? -1 : 1;
                    return getName(a).localeCompare(getName(b));
                  });

                  return entries.map((entry) => {
                    if (entry.type === "OpenKit") {
                      return (
                        <Work3Item
                          key={OPENKIT_SERVER.id}
                          isSelected={
                            selection?.type === "mcp-server" && selection.id === OPENKIT_SERVER.id
                          }
                          onSelect={handleSelectWork3}
                          isNew={isWork3New}
                          isActive={OpenKitActive}
                          onDeploy={() =>
                            setDeployDialog({ type: "mcp", id: OPENKIT_SERVER.id, name: "OpenKit" })
                          }
                        />
                      );
                    }
                    const server = entry.server;
                    const status = deploymentStatus[server.id] ?? {};
                    const agents = Object.entries(status)
                      .filter(([, v]) => v.global || v.project)
                      .map(([name]) => name);
                    return (
                      <McpServerItem
                        key={server.id}
                        server={server}
                        isSelected={selection?.type === "mcp-server" && selection.id === server.id}
                        onSelect={() => onSelect({ type: "mcp-server", id: server.id })}
                        isActive={agents.length > 0}
                        onDeploy={() =>
                          setDeployDialog({ type: "mcp", id: server.id, name: server.name })
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
                              await queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
                              await queryClient.invalidateQueries({
                                queryKey: ["mcpDeploymentStatus"],
                              });
                              if (selection?.type === "mcp-server" && selection.id === server.id) {
                                onSelect(null as unknown as AgentSelection);
                              }
                            },
                          });
                        }}
                      />
                    );
                  });
                })()
              )}
            </div>
          )}
        </div>

        {/* Skills Section */}
        <div>
          <div className="relative mb-px group">
            <button
              type="button"
              onClick={() => setSkillsCollapsed(!skillsCollapsed)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.03] cursor-pointer transition-colors duration-150"
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
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${text.dimmed} hover:${text.muted} hover:bg-white/[0.06] transition-colors z-10`}
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
                                await queryClient.invalidateQueries({ queryKey: ["skills"] });
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
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.03] cursor-pointer transition-colors duration-150"
            >
              <ChevronIcon collapsed={pluginsCollapsed} />
              <span className={`text-[11px] font-medium ${text.secondary}`}>Plugins</span>
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
                className={`p-1 rounded ${text.dimmed} hover:${text.muted} hover:bg-white/[0.06] transition-colors`}
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
                          queryClient.invalidateQueries({ queryKey: ["claudePlugins"] }),
                          queryClient.invalidateQueries({ queryKey: ["claudePlugin"] }),
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
                          await queryClient.invalidateQueries({ queryKey: ["claudePlugins"] });
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

      {deployDialog && (
        <DeployDialog
          title={`Deploy ${deployDialog.name}`}
          icon={
            deployDialog.type === "mcp" ? (
              <Server className="w-4 h-4 text-purple-400" />
            ) : (
              <Sparkles className="w-4 h-4 text-pink-400" />
            )
          }
          scopes={(() => {
            if (deployDialog.type === "mcp") {
              return [
                {
                  key: "global",
                  label: "Global",
                  active: !!deploymentStatus[deployDialog.id]?.claude?.global,
                },
                {
                  key: "project",
                  label: "Project",
                  active: !!deploymentStatus[deployDialog.id]?.claude?.project,
                },
              ];
            }
            const claudeAgent = skillDeploymentStatus[deployDialog.id]?.agents?.claude ?? {};
            return [
              { key: "global", label: "Global", active: !!claudeAgent.global },
              { key: "project", label: "Project", active: !!claudeAgent.project },
            ];
          })()}
          onApply={async (desired) => {
            if (deployDialog.type === "mcp") {
              const current = deploymentStatus[deployDialog.id]?.claude ?? {};
              for (const scope of ["global", "project"] as const) {
                if (current[scope] && !desired[scope]) {
                  await api.undeployMcpServer(deployDialog.id, "claude", scope);
                }
              }
              for (const scope of ["global", "project"] as const) {
                if (!current[scope] && desired[scope]) {
                  await api.deployMcpServer(deployDialog.id, "claude", scope);
                }
              }
              await queryClient.invalidateQueries({ queryKey: ["mcpDeploymentStatus"] });
            } else {
              const current = skillDeploymentStatus[deployDialog.id]?.agents?.claude ?? {};
              for (const scope of ["global", "project"] as const) {
                if (current[scope] && !desired[scope]) {
                  await api.undeploySkill(deployDialog.id, "claude", scope);
                }
              }
              for (const scope of ["global", "project"] as const) {
                if (!current[scope] && desired[scope]) {
                  await api.deploySkill(deployDialog.id, "claude", scope);
                }
              }
              await queryClient.invalidateQueries({ queryKey: ["skillDeploymentStatus"] });
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
            isSelected ? "text-cyan-400" : `${text.muted} group-hover:text-cyan-400`
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

// ─── Work3 built-in item ─────────────────────────────────────────

function Work3Item({
  isSelected,
  onSelect,
  isNew,
  isActive,
  onDeploy,
}: {
  isSelected: boolean;
  onSelect: () => void;
  isNew: boolean;
  isActive?: boolean;
  onDeploy: () => void;
}) {
  const handleDeploy = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeploy();
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full text-left px-3 py-3.5 transition-colors duration-150 border-l-2 ${
        isSelected
          ? `${surface.panelSelected} ${mcpServer.accentBorder}`
          : `border-transparent hover:${surface.panelHover}`
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Server
          className={`w-3.5 h-3.5 flex-shrink-0 transition-colors duration-150 ${isSelected ? "text-purple-400" : `${text.muted} group-hover:text-purple-400`}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium truncate ${isSelected ? text.primary : text.secondary}`}
            >
              OpenKit
            </span>
            {isNew && (
              <span className="relative flex-shrink-0">
                <span className="absolute inset-0 rounded-full bg-purple-400/40 animate-ping" />
                <span className="relative block w-2 h-2 rounded-full bg-purple-400" />
              </span>
            )}
          </div>
        </div>

        {/* Status dot / Actions — fixed-height wrapper prevents reflow on hover */}
        <div className="flex-shrink-0 relative" style={{ width: 52, height: 16 }}>
          <div className="absolute inset-0 flex items-center justify-end group-hover:hidden">
            {isActive && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${mcpServer.deployed} flex-shrink-0 mr-2`}
              />
            )}
          </div>
          <div className="absolute inset-0 hidden group-hover:flex items-center justify-end mr-[4px]">
            <ToggleSwitch checked={!!isActive} onToggle={handleDeploy} size="sm" />
          </div>
        </div>
      </div>
    </button>
  );
}

export type { AgentSelection };
