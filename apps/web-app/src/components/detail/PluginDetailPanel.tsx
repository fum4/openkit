import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw, Repeat2, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useClaudePluginDetail } from "../../hooks/useSkills";
import { useApi } from "../../hooks/useApi";
import { border, plugin as pluginTheme, text } from "../../theme";
import { ConfirmDialog } from "../ConfirmDialog";
import { MarkdownContent } from "../MarkdownContent";
import { Modal } from "../Modal";
import { Spinner } from "../Spinner";
import { ToggleSwitch } from "../ToggleSwitch";
import { Tooltip } from "../Tooltip";

interface PluginDetailPanelProps {
  pluginId: string;
  onDeleted: () => void;
  pluginActing?: boolean;
  onPluginActingChange?: (acting: boolean) => void;
}

export function PluginDetailPanel({
  pluginId,
  onDeleted,
  pluginActing,
  onPluginActingChange,
}: PluginDetailPanelProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { plugin, isLoading, error, refetch } = useClaudePluginDetail(pluginId);

  const [acting, setActing] = useState<string | null>(null);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [showScopePicker, setShowScopePicker] = useState(false);
  const [scopeSelection, setScopeSelection] = useState<string>("");

  // Track current pluginId so async operations can check if we're still viewing the same plugin
  const currentPluginIdRef = useRef(pluginId);
  useEffect(() => {
    currentPluginIdRef.current = pluginId;
  }, [pluginId]);

  const isDisabled = !!acting || !!pluginActing;

  const invalidatePlugins = () => queryClient.invalidateQueries({ queryKey: ["claudePlugins"] });

  const withActing = async (key: string, fn: () => Promise<void>) => {
    setActing(key);
    onPluginActingChange?.(true);
    try {
      await fn();
    } finally {
      setActing(null);
      onPluginActingChange?.(false);
    }
  };

  const handleToggleEnabled = () =>
    withActing("toggle", async () => {
      if (!plugin) return;
      if (plugin.enabled) {
        await api.disableClaudePlugin(plugin.id, plugin.scope);
      } else {
        await api.enableClaudePlugin(plugin.id, plugin.scope);
      }
      await Promise.all([invalidatePlugins(), refetch()]);
    });

  const handleUpdate = () =>
    withActing("update", async () => {
      if (!plugin) return;
      await api.updateClaudePlugin(plugin.id);
      await Promise.all([invalidatePlugins(), refetch()]);
    });

  const handleChangeScope = (newScope: string) => {
    if (!plugin || newScope === plugin.scope) return;
    setShowScopePicker(false);
    withActing("scope", async () => {
      await api.uninstallClaudePlugin(plugin!.id, plugin!.scope);
      await api.installClaudePlugin(plugin!.id, newScope);
      await Promise.all([invalidatePlugins(), refetch()]);
    });
  };

  const handleUninstall = () =>
    withActing("uninstall", async () => {
      if (!plugin) return;
      setShowUninstallConfirm(false);
      await api.uninstallClaudePlugin(plugin.id, plugin.scope);
      await queryClient.invalidateQueries({ queryKey: ["claudePlugins"] });
      // Only redirect if still viewing the plugin that was deleted
      if (currentPluginIdRef.current === plugin.id) {
        onDeleted();
      }
    });

  // Redirect when source is deleted / not found
  useEffect(() => {
    if (!isLoading && (error || !plugin)) onDeleted();
  }, [isLoading, error, plugin]);

  if (isLoading || error || !plugin) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2">
        <Spinner size="sm" className={text.muted} />
        <p className={`${text.muted} text-sm`}>Loading plugin...</p>
      </div>
    );
  }

  const scopeLabel =
    plugin.scope === "user" ? "User" : plugin.scope === "project" ? "Project" : "Local";

  // Parse name: strip marketplace suffix if present
  const displayName = plugin.marketplace
    ? plugin.name.replace(/@.*$/, "")
    : plugin.name.includes("@")
      ? plugin.name.split("@", 2)[0]
      : plugin.name;
  const displayMarketplace =
    plugin.marketplace || (plugin.name.includes("@") ? plugin.name.split("@", 2)[1] : "");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className={`flex-shrink-0 px-5 py-4 border-b ${border.section}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[11px] font-mono ${pluginTheme.accent}`}>{plugin.id}</span>
              {plugin.version && (
                <span className={`text-[11px] px-2.5 py-0.5 rounded-full ${pluginTheme.badge}`}>
                  v{plugin.version}
                </span>
              )}
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full ${pluginTheme.badge}`}>
                {scopeLabel}
              </span>
              {acting === "scope" ? (
                <Spinner size="xs" className={text.dimmed} />
              ) : (
                <Tooltip text="Change scope" position="top">
                  <button
                    type="button"
                    onClick={() => {
                      setScopeSelection(plugin.scope);
                      setShowScopePicker(true);
                    }}
                    disabled={isDisabled}
                    className={`p-1 rounded text-[#D4A574]/60 hover:text-[#D4A574] hover:bg-white/[0.06] transition-colors disabled:opacity-50`}
                  >
                    <Repeat2 className="w-4 h-4" />
                  </button>
                </Tooltip>
              )}
            </div>
            <h2 className={`text-[15px] font-semibold ${text.primary} leading-snug`}>
              {displayName}
            </h2>
            {displayMarketplace && (
              <p className={`text-[11px] ${text.muted} mt-0.5`}>{displayMarketplace}</p>
            )}
          </div>
          <div className="flex-shrink-0 pt-1 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <DeployToggle
                active={plugin.enabled}
                onToggle={handleToggleEnabled}
                disabled={isDisabled}
                title={plugin.enabled ? "Disable" : "Enable"}
                accent={plugin.error ? "red" : plugin.warning ? "yellow" : undefined}
              />
              <span className={`text-[10px] ${text.dimmed} w-10`}>
                {plugin.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <Tooltip text="Update plugin">
              <button
                type="button"
                onClick={handleUpdate}
                disabled={isDisabled}
                className={`p-1.5 rounded-lg ${text.muted} hover:${text.secondary} hover:bg-white/[0.06] transition-colors disabled:opacity-50 disabled:pointer-events-none`}
              >
                <RefreshCw className={`w-4 h-4 ${acting === "update" ? "animate-spin" : ""}`} />
              </button>
            </Tooltip>
            {acting === "uninstall" ? (
              <div className="p-1.5">
                <Spinner size="sm" className="text-red-400" />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowUninstallConfirm(true)}
                disabled={isDisabled}
                className={`p-1.5 rounded-lg ${text.muted} hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:pointer-events-none`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error / warning banner */}
      {plugin.error && (
        <div className="flex-shrink-0 mx-5 mt-4 px-3 py-2 rounded-lg bg-red-900/20 border border-red-500/20 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <span className="text-[11px] text-red-300">{plugin.error}</span>
        </div>
      )}
      {!plugin.error && plugin.warning && (
        <div className="flex-shrink-0 mx-5 mt-4 px-3 py-2 rounded-lg bg-yellow-900/20 border border-yellow-500/20 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
          <span className="text-[11px] text-yellow-300">{plugin.warning}</span>
        </div>
      )}

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5 flex flex-col min-h-0">
        {/* Description */}
        {plugin.description && (
          <section
            className={`flex flex-col mb-8 min-h-0 ${plugin.readme ? "flex-shrink-0" : "flex-1"}`}
          >
            <h3 className={`text-[11px] font-medium ${text.muted} mb-2 flex-shrink-0`}>
              Description
            </h3>
            <div
              className={`rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2 overflow-y-auto ${plugin.readme ? "" : "flex-1"}`}
            >
              <MarkdownContent content={plugin.description} />
            </div>
          </section>
        )}

        {/* Info, Components */}
        <div className="flex-shrink-0 space-y-8">
          <section>
            <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>Info</h3>
            <div className="space-y-2">
              {plugin.author && (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${text.dimmed} w-24 flex-shrink-0`}>Author</span>
                  <span className={`text-xs ${text.secondary}`}>{plugin.author}</span>
                </div>
              )}
              {plugin.homepage && (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${text.dimmed} w-24 flex-shrink-0`}>Homepage</span>
                  <a
                    href={plugin.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs ${pluginTheme.accent} hover:underline flex items-center gap-1`}
                  >
                    {plugin.homepage}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
              {plugin.repository && (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${text.dimmed} w-24 flex-shrink-0`}>
                    Repository
                  </span>
                  <a
                    href={plugin.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs ${pluginTheme.accent} hover:underline flex items-center gap-1`}
                  >
                    {plugin.repository}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
              {plugin.license && (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${text.dimmed} w-24 flex-shrink-0`}>License</span>
                  <span className={`text-xs ${text.secondary}`}>{plugin.license}</span>
                </div>
              )}
              {plugin.keywords && plugin.keywords.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className={`text-[10px] ${text.dimmed} w-24 flex-shrink-0 pt-0.5`}>
                    Keywords
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {plugin.keywords.map((kw) => (
                      <span
                        key={kw}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] ${text.muted}`}
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {plugin.installPath && (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${text.dimmed} w-24 flex-shrink-0`}>Path</span>
                  <span className={`text-[10px] font-mono ${text.dimmed} truncate`}>
                    {plugin.installPath}
                  </span>
                </div>
              )}
            </div>
          </section>

          {hasComponents(plugin.components) && (
            <section>
              <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>Components</h3>
              <div className="flex flex-wrap gap-1.5">
                {plugin.components.commands.map((cmd) => (
                  <ComponentChip key={`cmd-${cmd}`} label={cmd} type="Command" />
                ))}
                {plugin.components.agents.map((agent) => (
                  <ComponentChip key={`agent-${agent}`} label={agent} type="Agent" />
                ))}
                {plugin.components.skills.map((skill) => (
                  <ComponentChip key={`skill-${skill}`} label={skill} type="Skill" />
                ))}
                {plugin.components.mcpServers.map((srv) => (
                  <ComponentChip key={`mcp-${srv}`} label={srv} type="MCP Server" />
                ))}
                {plugin.components.hasHooks && <ComponentChip label="hooks" type="Hooks" />}
                {plugin.components.hasLsp && <ComponentChip label="LSP" type="LSP" />}
              </div>
            </section>
          )}
        </div>

        {/* README — fills remaining space */}
        {plugin.readme && (
          <section className="flex-1 flex flex-col mt-8 min-h-0">
            <h3 className={`text-[11px] font-medium ${text.muted} mb-2 flex-shrink-0`}>README</h3>
            <div className="flex-1 rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2 overflow-y-auto">
              <MarkdownContent content={plugin.readme} />
            </div>
          </section>
        )}
      </div>

      {/* Uninstall confirmation */}
      {showUninstallConfirm && (
        <ConfirmDialog
          title="Uninstall plugin?"
          confirmLabel="Uninstall"
          onConfirm={handleUninstall}
          onCancel={() => setShowUninstallConfirm(false)}
        >
          <p className={`text-xs ${text.secondary}`}>
            The plugin "{plugin.name}" will be uninstalled from {scopeLabel.toLowerCase()} scope.
          </p>
        </ConfirmDialog>
      )}

      {/* Scope picker */}
      {showScopePicker && (
        <Modal
          title="Change scope"
          icon={<Repeat2 className="w-4 h-4 text-[#D4A574]" />}
          width="sm"
          onClose={() => setShowScopePicker(false)}
          footer={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowScopePicker(false)}
                className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleChangeScope(scopeSelection)}
                disabled={scopeSelection === plugin.scope}
                className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  scopeSelection !== plugin.scope
                    ? "text-[#D4A574] bg-[#D4A574]/15 hover:bg-[#D4A574]/25"
                    : "text-white/20 bg-white/[0.04] cursor-not-allowed"
                }`}
              >
                Change scope
              </button>
            </div>
          }
        >
          <p className={`text-[11px] ${text.muted} mb-3`}>
            This will reinstall the plugin in the selected scope.
          </p>
          <div className="space-y-2">
            {(["user", "project", "local"] as const).map((scope) => {
              const label = scope === "user" ? "Global" : scope === "project" ? "Project" : "Local";
              const isCurrent = scope === plugin.scope;
              const isSelected = scopeSelection === scope;
              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setScopeSelection(scope)}
                  className={`w-full text-left px-3 py-2.5 flex items-center justify-between text-xs rounded-lg border transition-colors ${
                    isSelected
                      ? `bg-white/[0.04] border-white/[0.15] ${text.primary}`
                      : `bg-transparent border-white/[0.06] hover:border-white/[0.10] hover:bg-white/[0.02] ${text.secondary}`
                  }`}
                >
                  <span>{label}</span>
                  {isCurrent && <span className={`text-[10px] ${text.dimmed}`}>current</span>}
                </button>
              );
            })}
          </div>
          <p className={`text-[10px] ${text.dimmed} mt-3`}>
            {scopeSelection === "user"
              ? "Global — applies to all your projects"
              : scopeSelection === "project"
                ? "Per-project — committed to git, shared with your team"
                : "Per-project — gitignored, private to you"}
          </p>
        </Modal>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

const accentColors = {
  teal: { track: "bg-accent/35", thumb: "bg-accent" },
  red: { track: "bg-red-400/35", thumb: "bg-red-400" },
  yellow: { track: "bg-yellow-400/35", thumb: "bg-yellow-400" },
};

function DeployToggle({
  active,
  onToggle,
  disabled,
  title,
  accent,
}: {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
  title: string;
  accent?: "red" | "yellow";
}) {
  const colors = accentColors[accent ?? "teal"];
  return (
    <ToggleSwitch
      checked={active}
      disabled={disabled}
      onToggle={onToggle}
      title={title}
      checkedTrackClassName={colors.track}
      checkedThumbClassName={colors.thumb}
    />
  );
}

function hasComponents(components: {
  commands: string[];
  agents: string[];
  skills: string[];
  mcpServers: string[];
  hasHooks: boolean;
  hasLsp: boolean;
}): boolean {
  return (
    components.commands.length > 0 ||
    components.agents.length > 0 ||
    components.skills.length > 0 ||
    components.mcpServers.length > 0 ||
    components.hasHooks ||
    components.hasLsp
  );
}

const typeColors: Record<string, string> = {
  Command: "text-blue-300 bg-blue-900/30",
  Agent: "text-emerald-300 bg-emerald-900/30",
  Skill: "text-amber-300 bg-amber-900/30",
  "MCP Server": "text-purple-300 bg-purple-900/30",
  Hooks: "text-rose-300 bg-rose-900/30",
  LSP: "text-cyan-300 bg-cyan-900/30",
};

function ComponentChip({ label, type }: { label: string; type: string }) {
  const colors = typeColors[type] ?? `${text.muted} bg-white/[0.06]`;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${colors}`}
    >
      <span className="opacity-60">{type}:</span>
      {label}
    </span>
  );
}
