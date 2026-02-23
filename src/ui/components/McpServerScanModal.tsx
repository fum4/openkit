import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, FolderSearch, HardDrive, ScanSearch, Settings2 } from "lucide-react";

import { useServer } from "../contexts/ServerContext";
import { useApi } from "../hooks/useApi";
import type { McpScanResult, PluginSummary, SkillScanResult } from "../types";
import { Modal } from "./Modal";
import { input, text } from "../theme";
import { Spinner } from "./Spinner";

type ScanMode = "project" | "folder" | "device";
type ResultTab = "servers" | "skills" | "plugins";

interface McpServerScanModalProps {
  onImported: () => void;
  onClose: () => void;
  plugins?: PluginSummary[];
  pluginsLoading?: boolean;
  autoScanMode?: ScanMode | null;
  prefilledResults?: {
    mcpResults: McpScanResult[];
    skillResults: SkillScanResult[];
  } | null;
}

const MODES: { id: ScanMode; label: string; description: string; icon: typeof ScanSearch }[] = [
  {
    id: "project",
    label: "Current Project",
    description: "Scan this project for configs",
    icon: Settings2,
  },
  {
    id: "folder",
    label: "Specific Folder",
    description: "Recursively search a directory",
    icon: FolderSearch,
  },
  {
    id: "device",
    label: "Entire Device",
    description: "Search common locations on this machine",
    icon: HardDrive,
  },
];

export function McpServerScanModal({
  onImported,
  onClose,
  plugins = [],
  pluginsLoading = false,
  autoScanMode = null,
  prefilledResults = null,
}: McpServerScanModalProps) {
  const api = useApi();
  const { isElectron, selectFolder } = useServer();
  const [mode, setMode] = useState<ScanMode>(autoScanMode ?? "project");
  const [scanPath, setScanPath] = useState("");
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState<ResultTab>("servers");

  // Results — null = not scanned yet, [] = scanned but nothing new
  const [mcpResults, setMcpResults] = useState<McpScanResult[] | null>(null);
  const [skillResults, setSkillResults] = useState<SkillScanResult[] | null>(null);
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(new Set());
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const autoScanTriggered = useRef(false);

  const applyResults = useCallback((mcps: McpScanResult[], skills: SkillScanResult[]) => {
    setError(null);
    setMcpResults(mcps);
    setSkillResults(skills);
    setSelectedMcps(new Set(mcps.map((r) => r.key)));
    setSelectedSkills(new Set(skills.map((r) => r.name)));
    if (mcps.length > 0) setTab("servers");
    else if (skills.length > 0) setTab("skills");
  }, []);

  const handleScanWithMode = useCallback(
    async (scanMode: ScanMode) => {
      if (scanMode === "folder" && !scanPath.trim()) return;

      setScanning(true);
      setError(null);
      setMcpResults(null);
      setSkillResults(null);

      const options: { mode: ScanMode; scanPath?: string } = { mode: scanMode };
      if (scanMode === "folder") options.scanPath = scanPath.trim();

      const [mcpRes, skillRes] = await Promise.all([
        api.scanMcpServers(options),
        api.scanSkills(options),
      ]);

      setScanning(false);

      if (mcpRes.error && skillRes.error) {
        setError(mcpRes.error);
        return;
      }

      // Filter: hide already-imported items
      const newMcps = (mcpRes.discovered ?? []).filter((r) => !r.alreadyInRegistry);
      const newSkills = (skillRes.discovered ?? []).filter((r) => !r.alreadyInRegistry);

      applyResults(newMcps, newSkills);
    },
    [api, applyResults, scanPath],
  );

  useEffect(() => {
    if (!prefilledResults) return;
    applyResults(prefilledResults.mcpResults, prefilledResults.skillResults);
  }, [applyResults, prefilledResults]);

  const handleScan = () => handleScanWithMode(mode);

  useEffect(() => {
    if (!autoScanMode || autoScanTriggered.current || prefilledResults) return;
    autoScanTriggered.current = true;
    setMode(autoScanMode);
    void handleScanWithMode(autoScanMode);
  }, [autoScanMode, handleScanWithMode, prefilledResults]);

  const toggleMcp = (key: string) => {
    setSelectedMcps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSkill = (name: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const totalSelected = selectedMcps.size + selectedSkills.size;

  const handleImport = async () => {
    setImporting(true);
    setError(null);

    const promises: Promise<unknown>[] = [];

    if (selectedMcps.size > 0 && mcpResults) {
      const toImport = mcpResults
        .filter((r) => selectedMcps.has(r.key))
        .map((r) => ({
          key: r.key,
          name: r.key,
          command: r.command,
          args: r.args,
          env: r.env,
          source: r.foundIn[0]?.configPath,
        }));
      if (toImport.length > 0) {
        promises.push(api.importMcpServers(toImport));
      }
    }

    if (selectedSkills.size > 0 && skillResults) {
      const toImport = skillResults
        .filter((r) => selectedSkills.has(r.name))
        .map((r) => ({ name: r.name, skillPath: r.skillPath }));
      if (toImport.length > 0) {
        promises.push(api.importSkills(toImport));
      }
    }

    await Promise.all(promises);
    setImporting(false);
    onImported();
    onClose();
  };

  const showResults = mcpResults !== null || skillResults !== null;
  const mcpCount = mcpResults?.length ?? 0;
  const skillCount = skillResults?.length ?? 0;

  return (
    <Modal
      title="Scan & Import"
      icon={<ScanSearch className="w-4 h-4 text-[#9ca3af]" />}
      onClose={onClose}
      width="lg"
      footer={
        showResults ? (
          <>
            <button
              type="button"
              onClick={() => {
                setMcpResults(null);
                setSkillResults(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={totalSelected === 0 || importing}
              className="px-4 py-1.5 text-xs font-medium text-teal-400 bg-teal-400/15 hover:bg-teal-400/25 rounded-lg disabled:opacity-50 disabled:pointer-events-none transition-colors duration-150"
            >
              {importing
                ? "Importing..."
                : `Import ${totalSelected} item${totalSelected !== 1 ? "s" : ""}`}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning || (mode === "folder" && !scanPath.trim())}
              className="px-4 py-1.5 text-xs font-medium text-teal-400 bg-teal-400/15 hover:bg-teal-400/25 rounded-lg disabled:opacity-50 disabled:pointer-events-none transition-colors duration-150"
            >
              {scanning ? "Scanning..." : "Scan"}
            </button>
          </>
        )
      }
    >
      {scanning ? (
        <div className="flex items-center justify-center gap-2 py-12">
          <Spinner size="sm" className={text.muted} />
          <span className={`text-xs ${text.muted}`}>Scanning for MCP servers and skills...</span>
        </div>
      ) : showResults ? (
        /* Results view */
        <div>
          {/* Tabs */}
          <div className="flex items-center gap-1 mb-3 border-b border-white/[0.06] pb-2">
            <button
              type="button"
              onClick={() => setTab("servers")}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                tab === "servers"
                  ? "text-[#d1d5db] bg-white/[0.06]"
                  : `${text.dimmed} hover:${text.muted}`
              }`}
            >
              MCP Servers{mcpCount > 0 ? ` (${mcpCount})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setTab("skills")}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                tab === "skills"
                  ? "text-[#d1d5db] bg-white/[0.06]"
                  : `${text.dimmed} hover:${text.muted}`
              }`}
            >
              Skills{skillCount > 0 ? ` (${skillCount})` : ""}
            </button>
            {(pluginsLoading || plugins.length > 0) && (
              <button
                type="button"
                disabled={pluginsLoading}
                onClick={() => setTab("plugins")}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  tab === "plugins"
                    ? "text-[#d1d5db] bg-white/[0.06]"
                    : `${text.dimmed} hover:${text.muted}`
                } ${pluginsLoading ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {pluginsLoading ? (
                  <>
                    <Spinner size="xs" className={text.muted} />
                    Claude Plugins
                  </>
                ) : (
                  <>Claude Plugins ({plugins.length})</>
                )}
              </button>
            )}
          </div>

          {tab === "servers" ? (
            <div key="servers-tab">
              {mcpCount === 0 ? (
                <p className={`${text.muted} text-xs py-6 text-center`}>
                  No new MCP servers found.
                </p>
              ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {mcpResults!.map((r) => (
                    <label
                      key={r.key}
                      className="flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedMcps.has(r.key)}
                        onChange={() => toggleMcp(r.key)}
                        className="mt-[7px] accent-teal-400"
                      />
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-medium ${text.primary}`}>{r.key}</span>
                        <div className={`text-[11px] ${text.muted} font-mono`}>
                          {r.command} {r.args.join(" ")}
                        </div>
                        <div className={`text-[10px] ${text.dimmed} mt-0.5`}>
                          {r.foundIn.map((f) => (
                            <div key={f.configPath} className="truncate">
                              {f.configPath}
                            </div>
                          ))}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : tab === "skills" ? (
            <div key="skills-tab">
              {skillCount === 0 ? (
                <p className={`${text.muted} text-xs py-6 text-center`}>No new skills found.</p>
              ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {skillResults!.map((r) => (
                    <label
                      key={r.name}
                      className="flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSkills.has(r.name)}
                        onChange={() => toggleSkill(r.name)}
                        className="mt-[7px] accent-teal-400"
                      />
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-medium ${text.primary}`}>
                          {r.displayName}
                        </span>
                        {r.description && (
                          <div className={`text-[11px] ${text.muted}`}>{r.description}</div>
                        )}
                        <div className={`text-[10px] ${text.dimmed} mt-0.5 font-mono truncate`}>
                          {r.skillPath}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div key="plugins-tab">
              <p className={`${text.dimmed} text-[11px] mb-3`}>
                Claude Plugins are managed by Claude CLI and appear automatically in the sidebar. No
                import needed.
              </p>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {plugins.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02]"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.enabled ? "bg-teal-400" : "bg-white/20"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-medium ${text.primary}`}>
                        {p.name.replace(/@.*$/, "")}
                      </span>
                      {p.description && (
                        <div className={`text-[11px] ${text.muted} truncate`}>{p.description}</div>
                      )}
                    </div>
                    <span className={`text-[10px] ${text.dimmed} flex-shrink-0`}>
                      {p.enabled ? "enabled" : "disabled"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className={`${text.error} text-[11px] px-3 pt-2`}>{error}</p>}
        </div>
      ) : (
        /* Mode selection */
        <div className="space-y-3">
          {MODES.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  if (m.id !== "folder") handleScanWithMode(m.id);
                }}
                className={`w-full text-left flex items-center gap-3 px-3 py-3 rounded-lg border transition-colors ${
                  isActive
                    ? "bg-white/[0.04] border-white/[0.15]"
                    : "bg-transparent border-white/[0.06] hover:border-white/[0.10] hover:bg-white/[0.02]"
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? text.primary : text.muted}`} />
                <div>
                  <div
                    className={`text-xs font-medium ${isActive ? text.primary : text.secondary}`}
                  >
                    {m.label}
                  </div>
                  <div className={`text-[10px] ${text.dimmed}`}>{m.description}</div>
                </div>
              </button>
            );
          })}

          {mode === "folder" && (
            <div className="pt-1">
              <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
                Folder Path
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={scanPath}
                  onChange={(e) => setScanPath(e.target.value)}
                  placeholder="/path/to/scan"
                  className={`flex-1 px-2.5 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md ${input.text} placeholder-[#4b5563] text-xs focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.15] transition-all duration-150`}
                  autoFocus
                />
                {isElectron && (
                  <button
                    type="button"
                    onClick={async () => {
                      const folder = await selectFolder();
                      if (folder) setScanPath(folder);
                    }}
                    className={`px-2 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md ${text.muted} hover:bg-white/[0.08] hover:${text.secondary} transition-colors`}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {error && <p className={`${text.error} text-[11px]`}>{error}</p>}
        </div>
      )}
    </Modal>
  );
}
