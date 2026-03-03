import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Download, Radar, RefreshCw, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { APP_NAME } from "@openkit/shared/constants";
import { useServer } from "../contexts/ServerContext";
import { useApi } from "../hooks/useApi";
import { useConfig } from "../hooks/useConfig";
import { useMcpServers, useMcpDeploymentStatus } from "../hooks/useMcpServers";
import {
  useSkills,
  useSkillDeploymentStatus,
  useClaudeAgents,
  useClaudePlugins,
} from "../hooks/useSkills";
import type { ClaudeAgentScanResult, McpScanResult, SkillScanResult } from "../types";
import { surface } from "../theme";
import { AgentsSidebar, type AgentSelection } from "./AgentsSidebar";
import { AgentsToolbar } from "./AgentsToolbar";
import { AgentRuleDetailPanel } from "./detail/AgentRuleDetailPanel";
import { AgentDetailPanel } from "./detail/AgentDetailPanel";
import { McpServerDetailPanel } from "./detail/McpServerDetailPanel";
import { SkillDetailPanel } from "./detail/SkillDetailPanel";
import { PluginDetailPanel } from "./detail/PluginDetailPanel";
import { McpServerCreateModal } from "./McpServerCreateModal";
import { McpServerScanModal } from "./McpServerScanModal";
import { SkillCreateModal } from "./SkillCreateModal";
import { PluginInstallModal } from "./PluginInstallModal";
import { AgentCreateModal } from "./AgentCreateModal";
import { ResizableHandle } from "./ResizableHandle";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import { text } from "../theme";

const BANNER_DISMISSED_KEY = `${APP_NAME}:agentsBannerDismissed`;
const DISCOVERY_DISMISSED_KEY = `${APP_NAME}:agentsDiscoveryDismissed`;
const DISCOVERY_COUNTS_KEY = `${APP_NAME}:agentsDiscoveryCounts`;
const DISCOVERY_RESULTS_KEY = `${APP_NAME}:agentsDiscoveryResults`;

const STORAGE_KEY = `${APP_NAME}:agentsSidebarWidth`;
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

export function AgentsView() {
  const { serverUrl } = useServer();
  const api = useApi();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selection, setSelectionState] = useState<AgentSelection>(() => {
    if (serverUrl) {
      try {
        const saved = localStorage.getItem(`OpenKit:agentSel:${serverUrl}`);
        if (saved) return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return null;
  });

  const setSelection = (sel: AgentSelection) => {
    setSelectionState(sel);
    if (serverUrl) {
      localStorage.setItem(`OpenKit:agentSel:${serverUrl}`, JSON.stringify(sel));
    }
  };
  const [showCreateServerModal, setShowCreateServerModal] = useState(false);
  const [showCreateAgentModal, setShowCreateAgentModal] = useState(false);
  const [showCreateSkillModal, setShowCreateSkillModal] = useState(false);
  const [showInstallPluginModal, setShowInstallPluginModal] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanModalAutoMode, setScanModalAutoMode] = useState<"device" | null>(null);
  const [scanModalPrefillResults, setScanModalPrefillResults] = useState<{
    mcpResults: McpScanResult[];
    skillResults: SkillScanResult[];
    agentResults: ClaudeAgentScanResult[];
  } | null>(null);

  const { config, refetch: refetchConfig } = useConfig();

  const handleTogglePolicy = async (
    key: "allowAgentCommits" | "allowAgentPushes" | "allowAgentPRs",
  ) => {
    await api.saveConfig({ [key]: !config?.[key] });
    refetchConfig();
  };

  const {
    servers,
    isLoading: serversLoading,
    refetch: refetchServers,
  } = useMcpServers(search || undefined);
  const { status: deploymentStatus, refetch: refetchDeployment } = useMcpDeploymentStatus();
  const { skills, isLoading: skillsLoading, refetch: refetchSkills } = useSkills();
  const { status: skillDeploymentStatus, refetch: refetchSkillDeployment } =
    useSkillDeploymentStatus();
  const {
    agents,
    isLoading: agentsLoading,
    isFetching: agentsFetching,
    refetch: refetchAgents,
  } = useClaudeAgents();
  const { plugins, isLoading: pluginsLoading, refetch: refetchPlugins } = useClaudePlugins();
  const [pluginActing, setPluginActing] = useState(false);

  // Sidebar width
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (!isNaN(w) && w >= MIN_WIDTH && w <= MAX_WIDTH) return w;
    }
    return DEFAULT_WIDTH;
  });

  const handleSidebarResize = (delta: number) => {
    setSidebarWidth((prev) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, prev + delta)));
  };

  const handleSidebarResizeEnd = () => {
    localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
  };

  // Clear stale selection when selected MCP server no longer exists
  useEffect(() => {
    if (
      selection?.type === "mcp-server" &&
      !serversLoading &&
      !servers.find((s) => s.id === selection.id)
    ) {
      setSelection(null);
    }
  }, [servers, serversLoading, selection]);

  // Clear stale selection when selected agent no longer exists
  useEffect(() => {
    if (
      selection?.type === "agent" &&
      !agentsLoading &&
      !agents.find((agent) => agent.id === selection.id)
    ) {
      setSelection(null);
    }
  }, [agents, agentsLoading, selection]);

  const handleCreated = () => {
    refetchServers();
    refetchDeployment();
  };

  const handleSkillCreated = (skillName: string) => {
    refetchSkills();
    refetchSkillDeployment();
    setSelection({ type: "skill", name: skillName });
  };

  const handleSkillInstalled = (skillNames: string[]) => {
    refetchSkills();
    refetchSkillDeployment();
    if (skillNames.length > 0) {
      setSelection({ type: "skill", name: skillNames[0] });
    }
  };

  const handlePluginInstalled = () => {
    refetchPlugins();
    refetchAgents();
  };

  const handleAgentCreated = (agentId: string) => {
    refetchAgents();
    setSelection({ type: "agent", id: agentId });
  };

  const handleImported = () => {
    setSearch("");
    void queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
    void queryClient.invalidateQueries({ queryKey: ["mcpDeploymentStatus"] });
    refetchServers();
    refetchDeployment();
    refetchSkills();
    refetchSkillDeployment();
    refetchAgents();
    dismissDiscovery();
  };

  const hasItems = servers.length > 0 || skills.length > 0 || agents.length > 0;

  const [infoBannerDismissed, setInfoBannerDismissed] = useState(
    () => localStorage.getItem(BANNER_DISMISSED_KEY) === "1",
  );
  const dismissInfoBanner = () => {
    setInfoBannerDismissed(true);
    localStorage.setItem(BANNER_DISMISSED_KEY, "1");
  };

  // Discovery banner: always scan on mount, re-scan on revisit
  const [discoveryDismissed, setDiscoveryDismissed] = useState(
    () => localStorage.getItem(DISCOVERY_DISMISSED_KEY) === "1",
  );
  const [discoveryCounts, setDiscoveryCountsRaw] = useState<{
    servers: number;
    skills: number;
    agents: number;
  } | null>(() => {
    try {
      const saved = localStorage.getItem(DISCOVERY_COUNTS_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const setDiscoveryCounts = (
    counts: { servers: number; skills: number; agents: number } | null,
  ) => {
    setDiscoveryCountsRaw(counts);
    if (counts) {
      localStorage.setItem(DISCOVERY_COUNTS_KEY, JSON.stringify(counts));
    } else {
      localStorage.removeItem(DISCOVERY_COUNTS_KEY);
    }
  };
  const [discoveryScanning, setDiscoveryScanning] = useState(false);
  const [discoveryScanResults, setDiscoveryScanResults] = useState<{
    mcpResults: McpScanResult[];
    skillResults: SkillScanResult[];
    agentResults: ClaudeAgentScanResult[];
  } | null>(() => {
    try {
      const saved = localStorage.getItem(DISCOVERY_RESULTS_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved) as {
        mcpResults?: McpScanResult[];
        skillResults?: SkillScanResult[];
        agentResults?: ClaudeAgentScanResult[];
      };
      return {
        mcpResults: Array.isArray(parsed.mcpResults) ? parsed.mcpResults : [],
        skillResults: Array.isArray(parsed.skillResults) ? parsed.skillResults : [],
        agentResults: Array.isArray(parsed.agentResults) ? parsed.agentResults : [],
      };
    } catch {
      return null;
    }
  });
  const setPersistedDiscoveryResults = (
    results: {
      mcpResults: McpScanResult[];
      skillResults: SkillScanResult[];
      agentResults: ClaudeAgentScanResult[];
    } | null,
  ) => {
    setDiscoveryScanResults(results);
    if (results) {
      localStorage.setItem(DISCOVERY_RESULTS_KEY, JSON.stringify(results));
    } else {
      localStorage.removeItem(DISCOVERY_RESULTS_KEY);
    }
  };

  const runDiscoveryScan = useCallback(() => {
    setDiscoveryScanning(true);
    const options = { mode: "device" as const };
    Promise.all([
      api.scanMcpServers(options),
      api.scanSkills(options),
      api.scanClaudeAgents(options),
    ])
      .then(([mcpRes, skillRes, agentRes]) => {
        const mcpResults = (mcpRes.discovered ?? []).filter((r) => {
          if (r.alreadyInRegistry) return false;
          const command = typeof r.command === "string" ? r.command.trim() : "";
          const url = typeof r.url === "string" ? r.url.trim() : "";
          return command.length > 0 || url.length > 0;
        });
        const skillResults = (skillRes.discovered ?? []).filter((r) => !r.alreadyInRegistry);
        const agentResults = (agentRes.discovered ?? []).filter((r) => !r.alreadyInRegistry);
        setPersistedDiscoveryResults({ mcpResults, skillResults, agentResults });
        setDiscoveryCounts({
          servers: mcpResults.length,
          skills: skillResults.length,
          agents: agentResults.length,
        });
      })
      .catch(() => {})
      .finally(() => setDiscoveryScanning(false));
  }, [api]);

  // Run scan on every mount (re-scans on revisit since component remounts)
  const scanInitiated = useRef(false);
  useEffect(() => {
    if (scanInitiated.current) return;
    scanInitiated.current = true;
    runDiscoveryScan();
  }, [runDiscoveryScan]);

  const dismissDiscovery = () => {
    setPersistedDiscoveryResults(null);
    setDiscoveryCounts(null);
    setDiscoveryDismissed(true);
    localStorage.setItem(DISCOVERY_DISMISSED_KEY, "1");
  };

  const hasDiscoveryResults =
    discoveryCounts !== null &&
    (discoveryCounts.servers > 0 || discoveryCounts.skills > 0 || discoveryCounts.agents > 0);
  const displayDiscoveryCounts = discoveryCounts ?? {
    servers: 0,
    skills: 0,
    agents: 0,
  };
  const normalizedDiscoveryCounts = {
    servers: displayDiscoveryCounts.servers ?? 0,
    skills: displayDiscoveryCounts.skills ?? 0,
    agents: displayDiscoveryCounts.agents ?? 0,
  };
  const selectionKey =
    selection?.type === "agent-rule"
      ? `agent-rule:${selection.fileId}`
      : selection?.type === "agent"
        ? `agent:${selection.id}`
        : selection?.type === "mcp-server"
          ? `mcp:${selection.id}`
          : selection?.type === "skill"
            ? `skill:${selection.name}`
            : selection?.type === "plugin"
              ? `plugin:${selection.id}`
              : "none";
  const showDiscoveryBanner = discoveryScanning || hasDiscoveryResults || !discoveryDismissed;

  return (
    <div className="absolute inset-0 flex px-5 pb-16">
      {/* Left sidebar */}
      <aside
        style={{ width: sidebarWidth }}
        className={`flex-shrink-0 flex flex-col ${surface.panel} rounded-xl overflow-hidden`}
      >
        <AgentsToolbar
          search={search}
          onSearchChange={setSearch}
          onAddAgent={() => setShowCreateAgentModal(true)}
          onAddServer={() => setShowCreateServerModal(true)}
          onAddSkill={() => setShowCreateSkillModal(true)}
          onAddPlugin={() => setShowInstallPluginModal(true)}
          onScanImport={() => {
            setScanModalAutoMode(null);
            setScanModalPrefillResults(null);
            setShowScanModal(true);
          }}
          hasItems={hasItems}
        />
        <AgentsSidebar
          agents={agents}
          agentsLoading={agentsLoading}
          agentsFetching={agentsFetching}
          servers={servers}
          serversLoading={serversLoading}
          deploymentStatus={deploymentStatus}
          skills={skills}
          skillsLoading={skillsLoading}
          skillDeploymentStatus={skillDeploymentStatus}
          plugins={plugins}
          pluginsLoading={pluginsLoading}
          selection={selection}
          onSelect={setSelection}
          search={search}
          onAddAgent={() => setShowCreateAgentModal(true)}
          onAddServer={() => setShowCreateServerModal(true)}
          onAddSkill={() => setShowCreateSkillModal(true)}
          onAddPlugin={() => setShowInstallPluginModal(true)}
          pluginActing={pluginActing}
          onPluginActingChange={setPluginActing}
          allowAgentCommits={config?.allowAgentCommits}
          allowAgentPushes={config?.allowAgentPushes}
          allowAgentPRs={config?.allowAgentPRs}
          onTogglePolicy={handleTogglePolicy}
        />
      </aside>

      {/* Resize handle */}
      <div className="px-[9px]">
        <ResizableHandle onResize={handleSidebarResize} onResizeEnd={handleSidebarResizeEnd} />
      </div>

      {/* Right panel */}
      <main className={`flex-1 min-w-0 flex flex-col ${surface.panel} rounded-xl overflow-hidden`}>
        {showDiscoveryBanner ? (
          <div className="flex-shrink-0 h-14 flex items-center gap-3 px-4 border-b border-purple-400/20 bg-purple-400/[0.04]">
            <Radar className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <p className={`text-[11px] ${text.secondary} leading-relaxed flex-1`}>
              {hasDiscoveryResults ? (
                <>
                  Found
                  {normalizedDiscoveryCounts.servers > 0
                    ? ` ${normalizedDiscoveryCounts.servers} MCP server${
                        normalizedDiscoveryCounts.servers !== 1 ? "s" : ""
                      }`
                    : ""}
                  {normalizedDiscoveryCounts.servers > 0 &&
                  (normalizedDiscoveryCounts.skills > 0 || normalizedDiscoveryCounts.agents > 0)
                    ? ","
                    : ""}
                  {normalizedDiscoveryCounts.skills > 0
                    ? ` ${normalizedDiscoveryCounts.skills} skill${
                        normalizedDiscoveryCounts.skills !== 1 ? "s" : ""
                      }`
                    : ""}{" "}
                  {normalizedDiscoveryCounts.skills > 0 && normalizedDiscoveryCounts.agents > 0
                    ? "and"
                    : ""}
                  {normalizedDiscoveryCounts.agents > 0
                    ? ` ${normalizedDiscoveryCounts.agents} custom agent${
                        normalizedDiscoveryCounts.agents !== 1 ? "s" : ""
                      }`
                    : ""}{" "}
                  on this device.
                </>
              ) : discoveryScanning ? (
                "Scanning for MCP servers, skills, and custom agents on this device..."
              ) : (
                "No new MCP servers, skills, or custom agents found on this device."
              )}
            </p>
            <button
              type="button"
              onClick={runDiscoveryScan}
              disabled={discoveryScanning}
              className={`text-[11px] font-medium transition-colors flex-shrink-0 flex items-center gap-1 ${
                discoveryScanning
                  ? "text-purple-300/30 cursor-not-allowed"
                  : "text-purple-300/60 hover:text-purple-300"
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${discoveryScanning ? "animate-spin" : ""}`} />
              Scan again
            </button>
            {hasDiscoveryResults && (
              <button
                type="button"
                onClick={() => {
                  if (discoveryScanResults) {
                    setScanModalAutoMode(null);
                    setScanModalPrefillResults(discoveryScanResults);
                  } else {
                    setScanModalAutoMode("device");
                    setScanModalPrefillResults(null);
                  }
                  setShowScanModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 ml-2 text-[11px] font-medium text-purple-300 bg-purple-400/10 hover:bg-purple-400/20 border border-purple-400/20 rounded-lg transition-colors flex-shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Import
              </button>
            )}
            <button
              type="button"
              onClick={dismissDiscovery}
              className="p-1 rounded-md hover:bg-purple-400/10 text-purple-400/40 hover:text-purple-400/70 transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : !infoBannerDismissed ? (
          <div className="flex-shrink-0 h-14 flex items-center gap-3 px-4 border-b border-purple-400/20 bg-purple-400/[0.04]">
            <Bot className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <p className={`text-[11px] ${text.secondary} leading-relaxed flex-1`}>
              Manage all your agent tooling in one place. Browse plugin subagents, create custom
              agents, import MCP servers and skills, and manage Claude plugins globally or per
              project.
            </p>
            <button
              type="button"
              onClick={dismissInfoBanner}
              className="p-1 rounded-md hover:bg-purple-400/10 text-purple-400/40 hover:text-purple-400/70 transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : null}
        <PanelErrorBoundary resetKey={selectionKey} label="agents detail">
          {selection?.type === "agent-rule" ? (
            <AgentRuleDetailPanel fileId={selection.fileId} />
          ) : selection?.type === "agent" ? (
            <AgentDetailPanel
              agentId={selection.id}
              onMissing={() => setSelection(null)}
              onDeleted={() => {
                setSelection(null);
                refetchAgents();
              }}
            />
          ) : selection?.type === "mcp-server" ? (
            <McpServerDetailPanel
              serverId={selection.id}
              onDeleted={() => {
                setSelection(null);
                refetchServers();
                refetchDeployment();
              }}
            />
          ) : selection?.type === "skill" ? (
            <SkillDetailPanel
              skillName={selection.name}
              onDeleted={() => {
                setSelection(null);
                refetchSkills();
                refetchSkillDeployment();
              }}
            />
          ) : selection?.type === "plugin" ? (
            <PluginDetailPanel
              pluginId={selection.id}
              pluginActing={pluginActing}
              onPluginActingChange={setPluginActing}
              onDeleted={() => {
                setSelection(null);
                refetchPlugins();
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className={`text-xs ${text.dimmed}`}>Select an agent to view details</p>
            </div>
          )}
        </PanelErrorBoundary>
      </main>

      {/* Modals */}
      {showCreateServerModal && (
        <McpServerCreateModal
          onCreated={handleCreated}
          onClose={() => setShowCreateServerModal(false)}
        />
      )}
      {showCreateAgentModal && (
        <AgentCreateModal
          onCreated={handleAgentCreated}
          onClose={() => setShowCreateAgentModal(false)}
        />
      )}
      {showCreateSkillModal && (
        <SkillCreateModal
          onCreated={handleSkillCreated}
          onInstalled={handleSkillInstalled}
          onClose={() => setShowCreateSkillModal(false)}
        />
      )}
      {showInstallPluginModal && (
        <PluginInstallModal
          onInstalled={handlePluginInstalled}
          onClose={() => setShowInstallPluginModal(false)}
        />
      )}
      {showScanModal && (
        <McpServerScanModal
          onImported={handleImported}
          onClose={() => {
            setShowScanModal(false);
            setScanModalAutoMode(null);
            setScanModalPrefillResults(null);
          }}
          plugins={plugins}
          pluginsLoading={pluginsLoading}
          autoScanMode={scanModalAutoMode}
          prefilledResults={scanModalPrefillResults}
        />
      )}
    </div>
  );
}
