import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, Download, Filter, Puzzle, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useAvailablePlugins } from "../hooks/useSkills";
import { useApi } from "../hooks/useApi";
import type { AvailablePlugin, MarketplaceSummary } from "../types";
import { border, button, text } from "../theme";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

interface PluginInstallModalProps {
  onInstalled: () => void;
  onClose: () => void;
}

export function PluginInstallModal({ onInstalled, onClose }: PluginInstallModalProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { available, isLoading, error, refetch } = useAvailablePlugins(true);

  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"user" | "project" | "local">("user");
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [justInstalled, setJustInstalled] = useState<Set<string>>(new Set());

  // Snapshot available plugins so refetches don't remove entries
  const [snapshot, setSnapshot] = useState<AvailablePlugin[]>([]);
  useEffect(() => {
    if (available.length > 0 && snapshot.length === 0) {
      setSnapshot(available);
    } else if (available.length > 0) {
      // Update snapshot: keep all existing entries, add any new ones, update installed status
      setSnapshot((prev) => {
        const byId = new Map(available.map((p) => [p.pluginId, p]));
        const updated = prev.map((p) => byId.get(p.pluginId) ?? p);
        const existingIds = new Set(prev.map((p) => p.pluginId));
        const newPlugins = available.filter((p) => !existingIds.has(p.pluginId));
        return newPlugins.length > 0 ? [...updated, ...newPlugins] : updated;
      });
    }
  }, [available]);

  // Marketplace filter
  const [hiddenMarketplaces, setHiddenMarketplaces] = useState<Set<string>>(() => {
    const saved = localStorage.getItem("OpenKit:hiddenPluginMarketplaces");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("OpenKit:hiddenPluginMarketplaces", JSON.stringify([...hiddenMarketplaces]));
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

  const marketplaceNames = [
    ...new Set(snapshot.map((p) => p.marketplaceName).filter(Boolean)),
  ].sort();

  const toggleMarketplace = (name: string) => {
    setHiddenMarketplaces((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Marketplace management
  const [showMarketplaces, setShowMarketplaces] = useState(false);
  const [marketplaces, setMarketplaces] = useState<MarketplaceSummary[]>([]);
  const [marketplacesLoading, setMarketplacesLoading] = useState(false);
  const [newMarketplaceSource, setNewMarketplaceSource] = useState("");
  const [addingMarketplace, setAddingMarketplace] = useState(false);

  // Collapsed marketplace sections (reset each time modal opens)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = (name: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const filtered = snapshot
    .filter((p) => !p.marketplaceName || !hiddenMarketplaces.has(p.marketplaceName))
    .filter(
      (p) =>
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase()),
    );

  // Group by marketplace
  const grouped = new Map<string, AvailablePlugin[]>();
  for (const p of filtered) {
    const key = p.marketplaceName || "Other";
    const list = grouped.get(key);
    if (list) list.push(p);
    else grouped.set(key, [p]);
  }

  const handleInstall = async (plugin: AvailablePlugin) => {
    setInstalling(plugin.pluginId);
    setInstallError(null);
    const result = await api.installClaudePlugin(plugin.pluginId, scope);
    setInstalling(null);
    if (!result.success) {
      setInstallError(result.error ?? "Install failed");
      return;
    }
    setJustInstalled((prev) => new Set(prev).add(plugin.pluginId));
    queryClient.invalidateQueries({ queryKey: ["claudePlugins"] });
    refetch();
    onInstalled();
  };

  const handleUninstall = async (plugin: AvailablePlugin) => {
    setUninstalling(plugin.pluginId);
    await api.uninstallClaudePlugin(plugin.pluginId);
    setUninstalling(null);
    setJustInstalled((prev) => {
      const next = new Set(prev);
      next.delete(plugin.pluginId);
      return next;
    });
    queryClient.invalidateQueries({ queryKey: ["claudePlugins"] });
    refetch();
  };

  const loadMarketplaces = async () => {
    setMarketplacesLoading(true);
    try {
      const result = await api.fetchPluginMarketplaces();
      setMarketplaces(result.marketplaces ?? []);
    } catch {
      setMarketplaces([]);
    }
    setMarketplacesLoading(false);
  };

  const handleToggleMarketplaces = () => {
    if (!showMarketplaces) loadMarketplaces();
    setShowMarketplaces(!showMarketplaces);
  };

  const handleAddMarketplace = async () => {
    if (!newMarketplaceSource.trim()) return;
    setAddingMarketplace(true);
    await api.addPluginMarketplace(newMarketplaceSource.trim());
    setNewMarketplaceSource("");
    setAddingMarketplace(false);
    await loadMarketplaces();
    refetch();
  };

  const handleRemoveMarketplace = async (name: string) => {
    await api.removePluginMarketplace(name);
    await loadMarketplaces();
    refetch();
  };

  return (
    <Modal
      title="Install Plugin"
      icon={<Puzzle className="w-4 h-4 text-[#D4A574]" />}
      onClose={onClose}
      width="lg"
    >
      <div className="space-y-4">
        {/* Search + Filter */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search available plugins..."
            className={`flex-1 px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs ${text.primary} placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15]`}
            autoFocus
          />
          {marketplaceNames.length > 1 && (
            <div className="relative" ref={filterRef}>
              <button
                type="button"
                onClick={() => setFilterOpen(!filterOpen)}
                className={`p-2 rounded-lg border transition-colors ${
                  hiddenMarketplaces.size > 0
                    ? "text-teal-400 border-teal-400/30 bg-teal-400/10 hover:bg-teal-400/15"
                    : `${text.dimmed} border-white/[0.08] bg-white/[0.04] hover:${text.muted} hover:bg-white/[0.06]`
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
              </button>
              {filterOpen && (
                <div className="absolute right-0 top-full mt-1 w-52 rounded-lg bg-[#1a1d24] border border-white/[0.08] shadow-xl py-1 z-50">
                  {marketplaceNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleMarketplace(name)}
                      className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-[11px] ${text.secondary} hover:bg-white/[0.04] transition-colors duration-150`}
                    >
                      <span
                        className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${
                          !hiddenMarketplaces.has(name)
                            ? "bg-teal-400/20 border-teal-400/40"
                            : "border-white/[0.15]"
                        }`}
                      >
                        {!hiddenMarketplaces.has(name) && (
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
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scope selector */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] ${text.dimmed}`}>Install scope:</span>
            <div className="flex items-center bg-white/[0.04] rounded-lg p-0.5">
              {(["user", "project", "local"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                    scope === s
                      ? "text-[#d1d5db] bg-white/[0.06]"
                      : `${text.dimmed} hover:${text.muted}`
                  }`}
                >
                  {s === "user" ? "User" : s === "project" ? "Project" : "Local"}
                </button>
              ))}
            </div>
          </div>
          <p className={`text-[10px] ${text.dimmed}`}>
            {scope === "user"
              ? "Global — applies to all your projects"
              : scope === "project"
                ? "Per-project — committed to git, shared with your team"
                : "Per-project — gitignored, private to you"}
          </p>
        </div>

        {/* Error */}
        {installError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/20 border border-red-900/30">
            <span className={`text-xs text-red-400`}>{installError}</span>
            <button
              type="button"
              onClick={() => setInstallError(null)}
              className="ml-auto text-red-400/60 hover:text-red-400"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Plugin list */}
        <div className={`border ${border.subtle} rounded-lg max-h-72 overflow-y-auto`}>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Spinner size="sm" className={text.muted} />
              <span className={`text-xs ${text.muted}`}>Loading available plugins...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-8">
              <p className={`text-xs ${text.error}`}>{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className={`text-xs ${text.dimmed}`}>
                {search ? "No plugins match your search" : "No available plugins found"}
              </p>
            </div>
          ) : (
            <div>
              {[...grouped.entries()].map(([marketplace, plugins]) => {
                const isCollapsed = collapsedSections.has(marketplace);
                return (
                  <div key={marketplace}>
                    <button
                      type="button"
                      onClick={() => toggleSection(marketplace)}
                      className="w-full flex items-center gap-2 px-3 py-2 bg-[#1a1d24] hover:bg-[#1e2128] transition-colors sticky top-0 z-10 border-b border-white/[0.04]"
                    >
                      {isCollapsed ? (
                        <ChevronRight className={`w-3 h-3 ${text.muted}`} />
                      ) : (
                        <ChevronDown className={`w-3 h-3 ${text.muted}`} />
                      )}
                      <span className={`text-[11px] font-medium ${text.secondary}`}>
                        {marketplace}
                      </span>
                      <span
                        className={`text-[10px] ${text.dimmed} bg-white/[0.06] px-1.5 py-0.5 rounded-full`}
                      >
                        {plugins.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="divide-y divide-white/[0.04]">
                        {plugins.map((plugin) => (
                          <div
                            key={plugin.pluginId}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
                          >
                            <Puzzle className="w-4 h-4 flex-shrink-0 text-[#D4A574]" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium ${text.primary}`}>
                                  {plugin.name}
                                </span>
                                {plugin.version && (
                                  <span className={`text-[9px] ${text.dimmed}`}>
                                    v{plugin.version}
                                  </span>
                                )}
                              </div>
                              {plugin.description && (
                                <p className={`text-[10px] ${text.dimmed} truncate mt-0.5`}>
                                  {plugin.description}
                                </p>
                              )}
                            </div>
                            <div className="flex-shrink-0 w-[76px] flex items-center justify-center">
                              {plugin.installed || justInstalled.has(plugin.pluginId) ? (
                                uninstalling === plugin.pluginId ? (
                                  <Spinner size="xs" className="text-red-400" />
                                ) : (
                                  <div className="group/inst flex items-center justify-center">
                                    <span
                                      className={`text-[10px] ${text.dimmed} group-hover/inst:hidden`}
                                    >
                                      Installed
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleUninstall(plugin)}
                                      className={`hidden group-hover/inst:flex items-center gap-0.5 text-[10px] text-red-400/70 hover:text-red-400 transition-colors`}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                )
                              ) : installing === plugin.pluginId ? (
                                <Spinner size="xs" className={text.muted} />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleInstall(plugin)}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] bg-teal-400/15 text-teal-400 hover:bg-teal-400/25 font-medium transition-colors"
                                >
                                  <Download className="w-3 h-3" />
                                  Install
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Marketplace management */}
        <div>
          <button
            type="button"
            onClick={handleToggleMarketplaces}
            className={`flex items-center gap-1.5 text-[11px] ${text.muted} hover:${text.secondary} transition-colors`}
          >
            {showMarketplaces ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Manage Marketplaces
          </button>

          {showMarketplaces && (
            <div className="mt-2 space-y-2">
              {marketplacesLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <Spinner size="xs" className={text.muted} />
                  <span className={`text-[10px] ${text.muted}`}>Loading...</span>
                </div>
              ) : (
                <>
                  {marketplaces.map((mp) => (
                    <div
                      key={mp.name}
                      className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.02] rounded-lg"
                    >
                      <span className={`text-xs ${text.secondary} flex-1 truncate`}>{mp.name}</span>
                      <span className={`text-[10px] ${text.dimmed} truncate max-w-48`}>
                        {mp.source}
                      </span>
                      <Tooltip text="Remove marketplace" position="right">
                        <button
                          type="button"
                          onClick={() => handleRemoveMarketplace(mp.name)}
                          className={`p-1 ${text.dimmed} hover:text-red-400 transition-colors`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newMarketplaceSource}
                      onChange={(e) => setNewMarketplaceSource(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddMarketplace();
                      }}
                      placeholder="Marketplace source URL or path..."
                      className={`flex-1 px-2.5 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[11px] ${text.primary} placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15]`}
                    />
                    <button
                      type="button"
                      onClick={handleAddMarketplace}
                      disabled={!newMarketplaceSource.trim() || addingMarketplace}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] ${button.secondary} transition-colors disabled:opacity-40`}
                    >
                      {addingMarketplace ? <Spinner size="xs" /> : "Add"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
