import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Download, Radar, RefreshCw, X } from "lucide-react";

import { APP_NAME } from "../../constants";
import { useServer } from "../contexts/ServerContext";
import { useApi } from "../hooks/useApi";
import { useConfig } from "../hooks/useConfig";
import { useMcpServers, useMcpDeploymentStatus } from "../hooks/useMcpServers";
import { useSkills, useSkillDeploymentStatus, useClaudePlugins } from "../hooks/useSkills";
import type { McpScanResult, SkillScanResult } from "../types";
import { surface } from "../theme";
import { AgentsSidebar, type AgentSelection } from "./AgentsSidebar";
import { AgentsToolbar } from "./AgentsToolbar";
import { AgentRuleDetailPanel } from "./detail/AgentRuleDetailPanel";
import { McpServerDetailPanel } from "./detail/McpServerDetailPanel";
import { SkillDetailPanel } from "./detail/SkillDetailPanel";
import { PluginDetailPanel } from "./detail/PluginDetailPanel";
import { McpServerCreateModal } from "./McpServerCreateModal";
import { McpServerScanModal } from "./McpServerScanModal";
import { SkillCreateModal } from "./SkillCreateModal";
import { PluginInstallModal } from "./PluginInstallModal";
import { ResizableHandle } from "./ResizableHandle";
import { OPENKIT_SERVER } from "./AgentsSidebar";
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
  const [showCreateSkillModal, setShowCreateSkillModal] = useState(false);
  const [showInstallPluginModal, setShowInstallPluginModal] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanModalAutoMode, setScanModalAutoMode] = useState<"device" | null>(null);
  const [scanModalPrefillResults, setScanModalPrefillResults] = useState<{
    mcpResults: McpScanResult[];
    skillResults: SkillScanResult[];
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

  // Auto-select OpenKit built-in if nothing selected
  useEffect(() => {
    if (!selection) {
      setSelection({ type: "mcp-server", id: OPENKIT_SERVER.id });
    } else if (selection.type === "mcp-server" && selection.id !== OPENKIT_SERVER.id) {
      // Check if selected server still exists
      if (!serversLoading && servers.length > 0 && !servers.find((s) => s.id === selection.id)) {
        setSelection({ type: "mcp-server", id: OPENKIT_SERVER.id });
      }
    }
  }, [servers, serversLoading, selection]);

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
  };

  const handleImported = () => {
    refetchServers();
    refetchDeployment();
    refetchSkills();
    refetchSkillDeployment();
    dismissDiscovery();
  };

  const hasItems = servers.length > 0 || skills.length > 0;

  const [infoBannerDismissed, setInfoBannerDismissed] = useState(
    () => localStorage.getItem(BANNER_DISMISSED_KEY) === "1",
  );
  const dismissInfoBanner = () => {
    setInfoBannerDismissed(true);
    localStorage.setItem(BANNER_DISMISSED_KEY, "1");
  };

  // Discovery banner: always scan on mount, re-scan on revisit
  const api = useApi();
  const [discoveryDismissed, setDiscoveryDismissed] = useState(
    () => localStorage.getItem(DISCOVERY_DISMISSED_KEY) === "1",
  );
  const [discoveryCounts, setDiscoveryCountsRaw] = useState<{
    servers: number;
    skills: number;
  } | null>(() => {
    try {
      const saved = localStorage.getItem(DISCOVERY_COUNTS_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const setDiscoveryCounts = (counts: { servers: number; skills: number } | null) => {
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
  } | null>(() => {
    try {
      const saved = localStorage.getItem(DISCOVERY_RESULTS_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const setPersistedDiscoveryResults = (
    results: {
      mcpResults: McpScanResult[];
      skillResults: SkillScanResult[];
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
    Promise.all([api.scanMcpServers(options), api.scanSkills(options)])
      .then(([mcpRes, skillRes]) => {
        const mcpResults = (mcpRes.discovered ?? []).filter(
          (r) => !r.alreadyInRegistry && r.key !== "OpenKit",
        );
        const skillResults = (skillRes.discovered ?? []).filter((r) => !r.alreadyInRegistry);
        setPersistedDiscoveryResults({ mcpResults, skillResults });
        setDiscoveryCounts({ servers: mcpResults.length, skills: skillResults.length });
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
    discoveryCounts !== null && (discoveryCounts.servers > 0 || discoveryCounts.skills > 0);
  const displayDiscoveryCounts = discoveryCounts ?? { servers: 0, skills: 0 };
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
                  {displayDiscoveryCounts.servers > 0
                    ? ` ${displayDiscoveryCounts.servers} MCP server${displayDiscoveryCounts.servers !== 1 ? "s" : ""}`
                    : ""}
                  {displayDiscoveryCounts.servers > 0 && displayDiscoveryCounts.skills > 0
                    ? " and"
                    : ""}
                  {displayDiscoveryCounts.skills > 0
                    ? ` ${displayDiscoveryCounts.skills} skill${displayDiscoveryCounts.skills !== 1 ? "s" : ""}`
                    : ""}{" "}
                  on this device.
                </>
              ) : discoveryScanning ? (
                "Scanning for MCP servers and skills on this device..."
              ) : (
                "No new MCP servers or skills found on this device."
              )}
            </p>
            <button
              type="button"
              onClick={runDiscoveryScan}
              disabled={discoveryScanning}
              className={`text-[11px] font-medium transition-colors flex-shrink-0 flex items-center gap-1 ${discoveryScanning ? "text-purple-300/30 cursor-not-allowed" : "text-purple-300/60 hover:text-purple-300"}`}
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
              Manage all your agent tooling in one place. Import your MCP servers, skills and Claude
              plugins, then enable or disable them globally or per project.
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
        {selection?.type === "agent-rule" ? (
          <AgentRuleDetailPanel fileId={selection.fileId} />
        ) : selection?.type === "mcp-server" && selection.id !== OPENKIT_SERVER.id ? (
          <McpServerDetailPanel
            serverId={selection.id}
            onDeleted={() => {
              setSelection(null);
              refetchServers();
              refetchDeployment();
            }}
          />
        ) : selection?.type === "mcp-server" && selection.id === OPENKIT_SERVER.id ? (
          <McpServerDetailPanel
            serverId={OPENKIT_SERVER.id}
            builtInServer={OPENKIT_SERVER}
            onDeleted={() => setSelection(null)}
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
      </main>

      {/* Modals */}
      {showCreateServerModal && (
        <McpServerCreateModal
          onCreated={handleCreated}
          onClose={() => setShowCreateServerModal(false)}
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
