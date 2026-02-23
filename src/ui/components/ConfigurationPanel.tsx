import Editor from "@monaco-editor/react";
import {
  Bell,
  ChevronDown,
  GitCommitHorizontal,
  GitBranch,
  ListTodo,
  Network,
  RotateCcw,
  Settings,
  Settings2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { APP_NAME } from "../../constants";
import { ACTIVITY_TYPES } from "../../server/activity-event";
import { type WorktreeConfig } from "../hooks/useConfig";
import { useApi } from "../hooks/useApi";
import { button, infoBanner, input, settings, surface, tab, text } from "../theme";
import { AgentModelDropdown } from "./AgentModelDropdown";
import { Spinner } from "./Spinner";
import { ToggleSwitch } from "./ToggleSwitch";
import { Tooltip } from "./Tooltip";

const SETTINGS_BANNER_DISMISSED_KEY = `${APP_NAME}-settings-banner-dismissed`;

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={`text-xs font-medium ${settings.label}`}>{label}</label>
      {description && <span className={`text-[11px] ${settings.description}`}>{description}</span>}
      {children}
    </div>
  );
}

const fieldInputBase = `px-2.5 py-1.5 rounded-md text-xs bg-white/[0.04] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.15] transition-all duration-150`;
const fieldInputClass = `w-full ${fieldInputBase}`;

const ACTIVITY_NOTIFICATION_GROUPS = [
  {
    category: "Worktree",
    events: [
      { key: ACTIVITY_TYPES.CREATION_STARTED, label: "Creation started" },
      { key: ACTIVITY_TYPES.CREATION_COMPLETED, label: "Created" },
      { key: ACTIVITY_TYPES.CREATION_FAILED, label: "Creation failed" },
      { key: ACTIVITY_TYPES.WORKTREE_STARTED, label: "Started" },
      { key: ACTIVITY_TYPES.WORKTREE_STOPPED, label: "Stopped" },
      { key: ACTIVITY_TYPES.WORKTREE_CRASHED, label: "Crashed" },
    ],
  },
  {
    category: "Agent",
    events: [
      { key: ACTIVITY_TYPES.AGENT_DISCONNECTED, label: "Disconnected" },
      { key: ACTIVITY_TYPES.NOTIFY, label: "Status update" },
      { key: ACTIVITY_TYPES.COMMIT_COMPLETED, label: "Commit" },
      { key: ACTIVITY_TYPES.COMMIT_FAILED, label: "Commit failed" },
      { key: ACTIVITY_TYPES.PUSH_COMPLETED, label: "Push" },
      { key: ACTIVITY_TYPES.PUSH_FAILED, label: "Push failed" },
      { key: ACTIVITY_TYPES.PR_CREATED, label: "PR created" },
      { key: ACTIVITY_TYPES.HOOKS_STARTED, label: "Hooks started" },
      { key: ACTIVITY_TYPES.HOOKS_RAN, label: "Hooks ran" },
      { key: ACTIVITY_TYPES.SKILL_STARTED, label: "Skill started" },
      { key: ACTIVITY_TYPES.SKILL_COMPLETED, label: "Skill completed" },
      { key: ACTIVITY_TYPES.SKILL_FAILED, label: "Skill failed" },
      { key: ACTIVITY_TYPES.AGENT_AWAITING_INPUT, label: "Awaiting input" },
      { key: ACTIVITY_TYPES.TASK_DETECTED, label: "Task detected" },
      { key: ACTIVITY_TYPES.AUTO_TASK_CLAIMED, label: "Agent started task" },
    ],
  },
  {
    category: "System",
    events: [
      { key: ACTIVITY_TYPES.CONNECTION_LOST, label: "Connection lost" },
      { key: ACTIVITY_TYPES.CONNECTION_RESTORED, label: "Connection restored" },
      { key: ACTIVITY_TYPES.CONFIG_NEEDS_PUSH, label: "Config needs push" },
    ],
  },
] as const;

type NotificationDeliveryMode = "off" | "in-app" | "in-app-desktop";
type NotificationGroupMode = NotificationDeliveryMode | "mixed";

const NOTIFICATION_DELIVERY_MODES: Array<{ key: NotificationDeliveryMode; label: string }> = [
  { key: "off", label: "Off" },
  { key: "in-app", label: "In-app" },
  { key: "in-app-desktop", label: "In-app + desktop" },
];
const GROUP_NOTIFICATION_DELIVERY_MODES: Array<{ key: NotificationGroupMode; label: string }> = [
  ...NOTIFICATION_DELIVERY_MODES,
  { key: "mixed", label: "Mixed" },
];

function uniqueEventTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized) continue;
    unique.add(normalized);
  }
  return [...unique];
}

function getNotificationDeliveryMode(
  eventType: string,
  activity: WorktreeConfig["activity"] | undefined,
): NotificationDeliveryMode {
  const disabled = new Set(uniqueEventTypes(activity?.disabledEvents));
  if (disabled.has(eventType)) return "off";

  // If desktop events were never configured, default to in-app + desktop.
  if (activity?.osNotificationEvents === undefined) {
    return "in-app-desktop";
  }

  const desktop = new Set(
    uniqueEventTypes(activity?.osNotificationEvents).filter((type) => !disabled.has(type)),
  );
  if (desktop.has(eventType)) return "in-app-desktop";

  return "in-app";
}

function applyNotificationDeliveryMode(
  eventType: string,
  mode: NotificationDeliveryMode,
  activity: WorktreeConfig["activity"] | undefined,
): WorktreeConfig["activity"] {
  const disabled = new Set(uniqueEventTypes(activity?.disabledEvents));
  const desktop = new Set(
    uniqueEventTypes(activity?.osNotificationEvents).filter((type) => !disabled.has(type)),
  );

  if (mode === "off") {
    disabled.add(eventType);
    desktop.delete(eventType);
  } else if (mode === "in-app") {
    disabled.delete(eventType);
    desktop.delete(eventType);
  } else {
    disabled.delete(eventType);
    desktop.add(eventType);
  }

  return {
    ...activity,
    disabledEvents: [...disabled],
    osNotificationEvents: [...desktop].filter((type) => !disabled.has(type)),
  };
}

function getGroupNotificationDeliveryMode(
  eventTypes: readonly string[],
  activity: WorktreeConfig["activity"] | undefined,
): NotificationGroupMode {
  const modes = new Set(
    eventTypes.map((eventType) => getNotificationDeliveryMode(eventType, activity)),
  );
  if (modes.size !== 1) return "mixed";
  return [...modes][0] as NotificationDeliveryMode;
}

function applyNotificationDeliveryModeToGroup(
  eventTypes: readonly string[],
  mode: NotificationDeliveryMode,
  activity: WorktreeConfig["activity"] | undefined,
): WorktreeConfig["activity"] {
  let next = activity;
  for (const eventType of eventTypes) {
    next = applyNotificationDeliveryMode(eventType, mode, next);
  }
  return next ?? {};
}

function TextInput({
  value,
  onChange,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={fieldInputClass}
    />
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      className={fieldInputClass}
    />
  );
}

function EnvMappingEditor({
  mapping,
  onChange,
}: {
  mapping: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
}) {
  const entries = Object.entries(mapping);

  const updateKey = (oldKey: string, newKey: string) => {
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(mapping)) {
      updated[k === oldKey ? newKey : k] = v;
    }
    onChange(updated);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...mapping, [key]: value });
  };

  const addRow = () => {
    onChange({ ...mapping, "": "" });
  };

  const removeRow = (key: string) => {
    const updated = { ...mapping };
    delete updated[key];
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([key, value], i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <input
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
            placeholder="ENV_VAR"
            className={`flex-1 ${fieldInputBase}`}
          />
          <span className={`text-xs ${text.muted}`}>=</span>
          <input
            value={value}
            onChange={(e) => updateValue(key, e.target.value)}
            placeholder="http://localhost:${4000}"
            className={`flex-[2] ${fieldInputBase}`}
          />
          <button
            onClick={() => removeRow(key)}
            className={`text-xs ${text.muted} hover:text-red-400 px-1 transition-colors duration-150`}
          >
            x
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        className={`text-xs ${text.muted} hover:text-[#9ca3af] text-left transition-colors duration-150`}
      >
        + Add mapping
      </button>
    </div>
  );
}

export function ConfigurationPanel({
  config,
  onSaved,
  isConnected,
  jiraConfigured,
  linearConfigured,
  onNavigateToIntegrations,
}: {
  config: WorktreeConfig | null;
  onSaved: () => void;
  isConnected: boolean;
  jiraConfigured: boolean;
  linearConfigured: boolean;
  onNavigateToIntegrations: () => void;
}) {
  const api = useApi();
  const [form, setForm] = useState<WorktreeConfig | null>(null);
  const [discovering, setDiscovering] = useState(false);

  // Branch name rule state — per-tab
  type BranchTab = "default" | "jira" | "linear" | "local";
  const BRANCH_TABS: { key: BranchTab; label: string; dotColor: string }[] = [
    { key: "default", label: "Default", dotColor: "" },
    { key: "jira", label: "Jira", dotColor: "bg-blue-400" },
    { key: "linear", label: "Linear", dotColor: "bg-[#5E6AD2]" },
    { key: "local", label: "Local", dotColor: "bg-amber-400" },
  ];
  const [branchTab, setBranchTab] = useState<BranchTab>("default");
  const [branchRules, setBranchRules] = useState<
    Record<string, { content: string; original: string }>
  >({});
  const [branchOverrides, setBranchOverrides] = useState<{
    jira: boolean;
    linear: boolean;
    local: boolean;
  }>({ jira: false, linear: false, local: false });
  const [branchRuleLoading, setBranchRuleLoading] = useState(true);
  const loadedTabs = useRef(new Set<string>());

  // Commit message rule state — per-tab (mirrors branch naming)
  type CommitTab = "default" | "jira" | "linear" | "local";
  const COMMIT_TABS: { key: CommitTab; label: string; dotColor: string }[] = [
    { key: "default", label: "Default", dotColor: "" },
    { key: "jira", label: "Jira", dotColor: "bg-blue-400" },
    { key: "linear", label: "Linear", dotColor: "bg-[#5E6AD2]" },
    { key: "local", label: "Local", dotColor: "bg-amber-400" },
  ];
  const [commitTab, setCommitTab] = useState<CommitTab>("default");
  const [commitRules, setCommitRules] = useState<
    Record<string, { content: string; original: string }>
  >({});
  const [commitOverrides, setCommitOverrides] = useState<{
    jira: boolean;
    linear: boolean;
    local: boolean;
  }>({ jira: false, linear: false, local: false });
  const [commitRuleLoading, setCommitRuleLoading] = useState(true);
  const commitLoadedTabs = useRef(new Set<string>());

  const [showBanner, setShowBanner] = useState(() => {
    return localStorage.getItem(SETTINGS_BANNER_DISMISSED_KEY) !== "true";
  });
  const [expandedNotificationGroups, setExpandedNotificationGroups] = useState<
    Record<string, boolean>
  >(() => Object.fromEntries(ACTIVITY_NOTIFICATION_GROUPS.map((group) => [group.category, false])));

  const dismissBanner = () => {
    setShowBanner(false);
    localStorage.setItem(SETTINGS_BANNER_DISMISSED_KEY, "true");
  };

  useEffect(() => {
    if (config) {
      setForm({ ...config, envMapping: { ...config.envMapping } });
    }
  }, [config]);

  // Auto-save config on form changes (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevFormJson = useRef<string>("");

  useEffect(() => {
    if (!form || !config) return;
    const json = JSON.stringify(form);
    // Skip initial load and no-change scenarios
    if (!prevFormJson.current) {
      prevFormJson.current = json;
      return;
    }
    if (json === prevFormJson.current) return;
    prevFormJson.current = json;

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await api.saveConfig(form as unknown as Record<string, unknown>);
      onSaved();
    }, 500);

    return () => clearTimeout(saveTimer.current);
  }, [form]);

  // Auto-save branch rules (debounced)
  const branchSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const saveBranchRule = useCallback(
    (tabKey: string, content: string) => {
      clearTimeout(branchSaveTimer.current);
      branchSaveTimer.current = setTimeout(async () => {
        const source = tabKey === "default" ? undefined : tabKey;
        await api.saveBranchNameRule(content.trim() || null, source);
        // Refresh override status
        const status = await api.fetchBranchRuleStatus();
        setBranchOverrides(status.overrides);
      }, 800);
    },
    [api],
  );

  // Load a specific branch tab's content
  const loadBranchTab = useCallback(
    async (tabKey: BranchTab) => {
      if (loadedTabs.current.has(tabKey)) return;
      loadedTabs.current.add(tabKey);
      const source = tabKey === "default" ? undefined : tabKey;
      const data = await api.fetchBranchNameRule(source);
      const content = data.content ?? "";
      setBranchRules((prev) => ({ ...prev, [tabKey]: { content, original: content } }));
    },
    [api],
  );

  // Load default tab + override status on mount
  useEffect(() => {
    setBranchRuleLoading(true);
    Promise.all([loadBranchTab("default"), api.fetchBranchRuleStatus()]).then(([, status]) => {
      setBranchOverrides(status.overrides);
      setBranchRuleLoading(false);
    });
  }, []);

  // Lazy-load tab content when switching
  useEffect(() => {
    loadBranchTab(branchTab);
  }, [branchTab, loadBranchTab]);

  // Auto-save commit message rules (debounced)
  const commitSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const saveCommitRule = useCallback(
    (tabKey: string, content: string) => {
      clearTimeout(commitSaveTimer.current);
      commitSaveTimer.current = setTimeout(async () => {
        const source = tabKey === "default" ? undefined : tabKey;
        await api.saveCommitMessageRule(content.trim() || null, source);
        const status = await api.fetchCommitRuleStatus();
        setCommitOverrides(status.overrides);
      }, 800);
    },
    [api],
  );

  const loadCommitTab = useCallback(
    async (tabKey: CommitTab) => {
      if (commitLoadedTabs.current.has(tabKey)) return;
      commitLoadedTabs.current.add(tabKey);
      const source = tabKey === "default" ? undefined : tabKey;
      const data = await api.fetchCommitMessageRule(source);
      const content = data.content ?? "";
      setCommitRules((prev) => ({ ...prev, [tabKey]: { content, original: content } }));
    },
    [api],
  );

  // Load default commit tab + override status on mount
  useEffect(() => {
    setCommitRuleLoading(true);
    Promise.all([loadCommitTab("default"), api.fetchCommitRuleStatus()]).then(([, status]) => {
      setCommitOverrides(status.overrides);
      setCommitRuleLoading(false);
    });
  }, []);

  // Lazy-load commit tab content when switching
  useEffect(() => {
    loadCommitTab(commitTab);
  }, [commitTab, loadCommitTab]);

  if (!form) {
    return (
      <div className={`flex-1 flex items-center justify-center gap-2 ${text.muted} text-sm`}>
        <Spinner size="sm" />
        Loading configuration...
      </div>
    );
  }

  const handleDiscover = async () => {
    setDiscovering(true);
    const result = await api.discoverPorts();
    setDiscovering(false);
    if (result.success && result.ports.length > 0) {
      setForm({
        ...form!,
        ports: { ...form!.ports, discovered: result.ports },
      });
    }
  };

  return (
    <div>
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-8">
        {/* Banner */}
        {showBanner && (
          <div
            className={`relative p-4 pl-5 pr-10 rounded-xl ${infoBanner.bg} border ${infoBanner.border}`}
          >
            <button
              onClick={dismissBanner}
              className={`absolute top-1/2 -translate-y-1/2 right-4 p-1 rounded-md ${infoBanner.textMuted} hover:${infoBanner.text} ${infoBanner.hoverBg} transition-colors`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-2.5">
              <Settings className={`w-3.5 h-3.5 ${infoBanner.textMuted} flex-shrink-0`} />
              <p className={`text-xs ${text.secondary} leading-relaxed`}>
                Configure your project's dev commands, port settings, and environment mappings.
              </p>
            </div>
          </div>
        )}

        {/* Project Configuration Card */}
        <div className={`rounded-xl ${surface.panel} border border-white/[0.08] p-5`}>
          <h3 className={`text-xs font-semibold ${text.primary} mb-4 flex items-center gap-2`}>
            <Settings2 className={`w-3.5 h-3.5 ${text.muted}`} />
            Project Configuration
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Command" description="Command to start dev server">
              <TextInput
                value={form.startCommand}
                onChange={(v) => setForm({ ...form, startCommand: v })}
              />
            </Field>
            <Field label="Install Command" description="Command to install dependencies">
              <TextInput
                value={form.installCommand}
                onChange={(v) => setForm({ ...form, installCommand: v })}
              />
            </Field>
            <Field label="Base Branch" description="Branch to create worktrees from">
              <TextInput
                value={form.baseBranch}
                onChange={(v) => setForm({ ...form, baseBranch: v })}
              />
            </Field>
            <Field label="Project Directory" description="Subdirectory to cd into before running">
              <TextInput
                value={form.projectDir}
                onChange={(v) => setForm({ ...form, projectDir: v })}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/[0.06]">
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs font-medium ${settings.label}`}>
                Auto-install dependencies
              </span>
              <span className={`text-[11px] ${settings.description}`}>
                Run install command when creating a new worktree
              </span>
            </div>
            <ToggleSwitch
              checked={form.autoInstall !== false}
              onToggle={() => setForm({ ...form, autoInstall: !(form.autoInstall !== false) })}
            />
          </div>
        </div>

        {/* Local Issues Card */}
        <div className={`rounded-xl ${surface.panel} border border-white/[0.08] p-5`}>
          <h3 className={`text-xs font-semibold ${text.primary} mb-4 flex items-center gap-2`}>
            <ListTodo className={`w-3.5 h-3.5 ${text.muted}`} />
            Local Issues
          </h3>
          <div className="flex flex-col gap-4">
            <Field
              label="Local Issue Prefix"
              description="Prefix for local issue identifiers (leave empty for number only)"
            >
              <TextInput
                value={form.localIssuePrefix ?? "LOCAL"}
                onChange={(v) =>
                  setForm({ ...form, localIssuePrefix: v.toUpperCase().replace(/[^A-Z0-9]/g, "") })
                }
              />
            </Field>

            <div className="border-t border-white/[0.06] pt-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className={`text-xs font-medium ${settings.label}`}>
                    Auto-start on new issue
                  </span>
                  <span className={`text-[11px] ${settings.description}`}>
                    Create a new worktree and launch the selected agent automatically.
                  </span>
                </div>
                <ToggleSwitch
                  checked={form.localAutoStartClaudeOnNewIssue === true}
                  onToggle={() =>
                    setForm({
                      ...form,
                      localAutoStartClaudeOnNewIssue: !form.localAutoStartClaudeOnNewIssue,
                    })
                  }
                />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`text-xs font-medium ${
                      form.localAutoStartClaudeOnNewIssue ? settings.label : text.dimmed
                    }`}
                  >
                    Agent
                  </span>
                  <span className={`text-[11px] ${settings.description}`}>
                    Agent used when auto-start runs.
                  </span>
                </div>
                <AgentModelDropdown
                  value={form.localAutoStartAgent ?? "claude"}
                  onChange={(agent) =>
                    setForm({
                      ...form,
                      localAutoStartAgent: agent,
                    })
                  }
                  className="mt-0.5"
                  disabled={!form.localAutoStartClaudeOnNewIssue}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`text-xs font-medium ${
                      form.localAutoStartClaudeOnNewIssue ? settings.label : text.dimmed
                    }`}
                  >
                    Skip permission prompts
                  </span>
                  <span className={`text-[11px] ${settings.description}`}>
                    Runs with the selected agent's skip-permissions mode.
                  </span>
                </div>
                <ToggleSwitch
                  checked={form.localAutoStartClaudeSkipPermissions !== false}
                  disabled={!form.localAutoStartClaudeOnNewIssue}
                  onToggle={() =>
                    setForm({
                      ...form,
                      localAutoStartClaudeSkipPermissions: !(
                        form.localAutoStartClaudeSkipPermissions !== false
                      ),
                    })
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`text-xs font-medium ${
                      form.localAutoStartClaudeOnNewIssue ? settings.label : text.dimmed
                    }`}
                  >
                    Focus terminal on auto-start
                  </span>
                  <span className={`text-[11px] ${settings.description}`}>
                    Redirect to the worktree agent terminal when auto-start begins.
                  </span>
                </div>
                <ToggleSwitch
                  checked={form.localAutoStartClaudeFocusTerminal !== false}
                  disabled={!form.localAutoStartClaudeOnNewIssue}
                  onToggle={() =>
                    setForm({
                      ...form,
                      localAutoStartClaudeFocusTerminal: !(
                        form.localAutoStartClaudeFocusTerminal !== false
                      ),
                    })
                  }
                />
              </div>
            </div>
          </div>
        </div>

        {/* Port Configuration Card */}
        <div className={`rounded-xl ${surface.panel} border border-white/[0.08] p-5`}>
          <h3 className={`text-xs font-semibold ${text.primary} mb-4 flex items-center gap-2`}>
            <Network className={`w-3.5 h-3.5 ${text.muted}`} />
            Port Configuration
          </h3>
          <div className="flex flex-col gap-6">
            <Field label="Port Offset Step" description="Increment per worktree instance">
              <NumberInput
                value={form.ports.offsetStep}
                onChange={(v) => setForm({ ...form, ports: { ...form.ports, offsetStep: v } })}
              />
            </Field>
            <Field label="Discovered Ports" description="Ports detected from your dev server">
              <div className="flex items-center gap-2">
                <span className={`text-xs ${text.secondary}`}>
                  {form.ports.discovered.length > 0
                    ? form.ports.discovered.join(", ")
                    : "None discovered"}
                </span>
                <button
                  onClick={handleDiscover}
                  disabled={discovering}
                  className={`text-xs px-2.5 py-1 rounded-md ${button.secondary} disabled:opacity-50 transition-colors duration-150`}
                >
                  {discovering ? "Discovering..." : "Discover"}
                </button>
              </div>
            </Field>
            <Field
              label="Env Mapping"
              description="Environment variable templates with port references (e.g. http://localhost:${4000})"
            >
              <EnvMappingEditor
                mapping={form.envMapping ?? {}}
                onChange={(m) => setForm({ ...form, envMapping: m })}
              />
            </Field>
          </div>
        </div>

        {/* Branches Card */}
        <div className={`rounded-xl ${surface.panel} border border-white/[0.08] p-5`}>
          <h3 className={`text-xs font-semibold ${text.primary} mb-4 flex items-center gap-2`}>
            <GitBranch className={`w-3.5 h-3.5 ${text.muted}`} />
            Branches
          </h3>

          <div className="flex items-center justify-between mb-3">
            <h4 className={`text-[11px] font-medium ${text.secondary}`}>Branch naming</h4>
            <div className="flex gap-1">
              {BRANCH_TABS.map((t) => {
                const isActive = branchTab === t.key;
                const hasOverride =
                  t.key !== "default" && branchOverrides[t.key as keyof typeof branchOverrides];
                return (
                  <button
                    key={t.key}
                    onClick={() => setBranchTab(t.key)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors duration-150 flex items-center gap-1.5 ${
                      isActive ? tab.active : tab.inactive
                    }`}
                  >
                    {t.label}
                    {hasOverride && <span className={`w-1.5 h-1.5 rounded-full ${t.dotColor}`} />}
                  </button>
                );
              })}
            </div>
          </div>
          {branchRuleLoading ? (
            <div className={`flex items-center gap-2 ${text.muted} text-xs`}>
              <Spinner size="sm" />
              Loading...
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className={`text-[11px] ${text.dimmed} leading-relaxed`}>
                {branchTab === "default" ? (
                  <>
                    JavaScript function that generates branch names from issue details.
                    <br />
                    Receives{" "}
                    <code className="text-[10px] bg-white/[0.06] px-1 py-0.5 rounded">
                      {"{ issueId, name, type }"}
                    </code>{" "}
                    and should return a branch name string.
                  </>
                ) : (
                  <>
                    Override for <span className="font-medium capitalize">{branchTab}</span> issues.
                    Leave empty to use the default rule.
                  </>
                )}
              </p>
              {((branchTab === "jira" && !jiraConfigured) ||
                (branchTab === "linear" && !linearConfigured)) && (
                <div className="flex items-center justify-between px-3 py-2 rounded-md bg-amber-500/[0.08] border border-amber-500/20">
                  <span className={`text-[11px] text-amber-400/90`}>
                    {branchTab === "jira" ? "Jira" : "Linear"} is not connected.
                  </span>
                  <button
                    onClick={onNavigateToIntegrations}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md text-amber-400 bg-amber-500/[0.12] hover:bg-amber-500/[0.20] transition-colors duration-150 shrink-0"
                  >
                    Setup {branchTab === "jira" ? "Jira" : "Linear"}
                  </button>
                </div>
              )}
              <div className="relative rounded-md border border-white/[0.06]">
                {branchRules[branchTab] &&
                  branchRules[branchTab].content !== branchRules[branchTab].original && (
                    <Tooltip text="Reset to saved">
                      <button
                        type="button"
                        onClick={() => {
                          const original = branchRules[branchTab].original;
                          setBranchRules((prev) => ({
                            ...prev,
                            [branchTab]: { ...prev[branchTab], content: original },
                          }));
                          saveBranchRule(branchTab, original);
                        }}
                        className={`absolute top-1.5 right-1.5 z-10 p-1 rounded ${text.dimmed} hover:${text.muted} hover:bg-white/[0.06] transition-colors`}
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </Tooltip>
                  )}
                <Editor
                  height="160px"
                  defaultLanguage="javascript"
                  value={branchRules[branchTab]?.content ?? ""}
                  onChange={(value) => {
                    const content = value ?? "";
                    setBranchRules((prev) => ({
                      ...prev,
                      [branchTab]: { ...prev[branchTab], content },
                    }));
                    saveBranchRule(branchTab, content);
                  }}
                  theme="vs-dark"
                  options={{
                    fixedOverflowWidgets: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 12,
                    lineNumbers: "off",
                    glyphMargin: false,
                    folding: false,
                    lineDecorationsWidth: 8,
                    lineNumbersMinChars: 0,
                    padding: { top: 8, bottom: 8 },
                    overviewRulerLanes: 0,
                    hideCursorInOverviewRuler: true,
                    overviewRulerBorder: false,
                    scrollbar: { vertical: "hidden", horizontal: "auto" },
                    renderLineHighlight: "none",
                    tabSize: 2,
                  }}
                />
                {branchTab !== "default" && !branchRules[branchTab]?.content && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className={`text-[11px] ${text.dimmed}`}>
                      Using default rule. Edit to override for {branchTab} issues.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Commits Card */}
        <div className={`rounded-xl ${surface.panel} border border-white/[0.08] p-5`}>
          <h3 className={`text-xs font-semibold ${text.primary} mb-5 flex items-center gap-2`}>
            <GitCommitHorizontal className={`w-3.5 h-3.5 ${text.muted}`} />
            Commits
          </h3>

          <div className="mb-5">
            <h4 className={`text-[11px] font-medium ${text.secondary} mb-1`}>Agent git policy</h4>
            <p className={`text-[11px] ${text.dimmed} leading-relaxed mb-3`}>
              Allow or deny agents from performing git actions on worktrees.
            </p>
            <div className="flex items-center gap-1.5">
              {(["allowAgentCommits", "allowAgentPushes", "allowAgentPRs"] as const).map((key) => {
                const label =
                  key === "allowAgentCommits"
                    ? "Commit"
                    : key === "allowAgentPushes"
                      ? "Push"
                      : "PR";
                const enabled = config?.[key] ?? false;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={async () => {
                      await api.saveConfig({ [key]: !enabled });
                      onSaved();
                    }}
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

          <div className="border-t border-white/[0.06] mt-1 mb-4" />

          <div className="flex items-center justify-between mb-3">
            <h4 className={`text-[11px] font-medium ${text.secondary}`}>Commit message</h4>
            <div className="flex gap-1">
              {COMMIT_TABS.map((t) => {
                const isActive = commitTab === t.key;
                const hasOverride =
                  t.key !== "default" && commitOverrides[t.key as keyof typeof commitOverrides];
                return (
                  <button
                    key={t.key}
                    onClick={() => setCommitTab(t.key)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors duration-150 flex items-center gap-1.5 ${
                      isActive ? tab.active : tab.inactive
                    }`}
                  >
                    {t.label}
                    {hasOverride && <span className={`w-1.5 h-1.5 rounded-full ${t.dotColor}`} />}
                  </button>
                );
              })}
            </div>
          </div>

          {commitRuleLoading ? (
            <div className={`flex items-center gap-2 ${text.muted} text-xs`}>
              <Spinner size="sm" />
              Loading...
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className={`text-[11px] ${text.dimmed} leading-relaxed`}>
                {commitTab === "default" ? (
                  <>
                    JavaScript function that formats commit messages from issue details.
                    <br />
                    Receives{" "}
                    <code className="text-[10px] bg-white/[0.06] px-1 py-0.5 rounded">
                      {"{ issueId, message, source }"}
                    </code>{" "}
                    and should return a formatted commit message.
                  </>
                ) : (
                  <>
                    Override for <span className="font-medium capitalize">{commitTab}</span> issues.
                    Leave empty to use the default rule.
                  </>
                )}
              </p>
              {((commitTab === "jira" && !jiraConfigured) ||
                (commitTab === "linear" && !linearConfigured)) && (
                <div className="flex items-center justify-between px-3 py-2 rounded-md bg-amber-500/[0.08] border border-amber-500/20">
                  <span className={`text-[11px] text-amber-400/90`}>
                    {commitTab === "jira" ? "Jira" : "Linear"} is not connected.
                  </span>
                  <button
                    onClick={onNavigateToIntegrations}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md text-amber-400 bg-amber-500/[0.12] hover:bg-amber-500/[0.20] transition-colors duration-150 shrink-0"
                  >
                    Setup {commitTab === "jira" ? "Jira" : "Linear"}
                  </button>
                </div>
              )}
              <div className="relative rounded-md border border-white/[0.06]">
                {commitRules[commitTab] &&
                  commitRules[commitTab].content !== commitRules[commitTab].original && (
                    <Tooltip text="Reset to saved">
                      <button
                        type="button"
                        onClick={() => {
                          const original = commitRules[commitTab].original;
                          setCommitRules((prev) => ({
                            ...prev,
                            [commitTab]: { ...prev[commitTab], content: original },
                          }));
                          saveCommitRule(commitTab, original);
                        }}
                        className={`absolute top-1.5 right-1.5 z-10 p-1 rounded ${text.dimmed} hover:${text.muted} hover:bg-white/[0.06] transition-colors`}
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </Tooltip>
                  )}
                <Editor
                  height="160px"
                  defaultLanguage="javascript"
                  value={commitRules[commitTab]?.content ?? ""}
                  onChange={(value) => {
                    const content = value ?? "";
                    setCommitRules((prev) => ({
                      ...prev,
                      [commitTab]: { ...prev[commitTab], content },
                    }));
                    saveCommitRule(commitTab, content);
                  }}
                  theme="vs-dark"
                  options={{
                    fixedOverflowWidgets: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 12,
                    lineNumbers: "off",
                    glyphMargin: false,
                    folding: false,
                    lineDecorationsWidth: 8,
                    lineNumbersMinChars: 0,
                    padding: { top: 8, bottom: 8 },
                    overviewRulerLanes: 0,
                    hideCursorInOverviewRuler: true,
                    overviewRulerBorder: false,
                    scrollbar: { vertical: "hidden", horizontal: "auto" },
                    renderLineHighlight: "none",
                    tabSize: 2,
                  }}
                />
                {commitTab !== "default" && !commitRules[commitTab]?.content && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className={`text-[11px] ${text.dimmed}`}>
                      Using default rule. Edit to override for {commitTab} issues.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Notifications Card */}
        <div className={`rounded-xl ${surface.panel} border border-white/[0.08] p-5`}>
          <h3 className={`text-xs font-semibold ${text.primary} mb-4 flex items-center gap-2`}>
            <Bell className={`w-3.5 h-3.5 ${text.muted}`} />
            Notifications
          </h3>
          <p className={`text-[11px] ${text.dimmed} leading-relaxed mb-3`}>
            Choose how each activity type is delivered: off, in-app only, or in-app plus desktop.
            Desktop delivery always implies in-app delivery.
          </p>
          <div className="flex flex-col gap-4">
            {ACTIVITY_NOTIFICATION_GROUPS.map((group) => {
              const eventTypes = group.events.map((event) => event.key);
              const groupMode = getGroupNotificationDeliveryMode(eventTypes, config?.activity);
              const expanded = expandedNotificationGroups[group.category] ?? false;

              return (
                <div
                  key={group.category}
                  className={`rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 ${expanded ? "" : "cursor-pointer"}`}
                  onClick={() => {
                    if (expanded) return;
                    setExpandedNotificationGroups((prev) => ({
                      ...prev,
                      [group.category]: true,
                    }));
                  }}
                  role={!expanded ? "button" : undefined}
                  tabIndex={!expanded ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (expanded) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setExpandedNotificationGroups((prev) => ({
                      ...prev,
                      [group.category]: true,
                    }));
                  }}
                  aria-expanded={expanded}
                >
                  <div
                    className={`flex items-center justify-between gap-2 pr-2.5 min-h-7 ${expanded ? "mb-1" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedNotificationGroups((prev) => ({
                          ...prev,
                          [group.category]: !expanded,
                        }));
                      }}
                      className={`inline-flex h-6 flex-1 items-center justify-start gap-1 text-xs font-medium ${text.secondary} hover:text-white transition-colors leading-none`}
                    >
                      <ChevronDown
                        className={`w-3 h-3 transition-transform duration-150 ${expanded ? "" : "-rotate-90"}`}
                      />
                      {group.category}
                    </button>
                    <div
                      className="inline-flex self-center shrink-0 items-center rounded-md border border-white/[0.08] bg-[#0f1217] p-0.5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {GROUP_NOTIFICATION_DELIVERY_MODES.map((modeOption) => {
                        const active = groupMode === modeOption.key;
                        const isActionable = modeOption.key !== "mixed";
                        const cursor =
                          modeOption.key === "mixed"
                            ? active
                              ? "default"
                              : "not-allowed"
                            : active
                              ? "default"
                              : "pointer";
                        const activeClass =
                          modeOption.key === "off"
                            ? "bg-red-500/20 text-red-300"
                            : modeOption.key === "mixed"
                              ? "bg-white/[0.10] text-white/75"
                              : "bg-accent/15 text-accent";
                        return (
                          <button
                            key={modeOption.key}
                            type="button"
                            onClick={async (event) => {
                              event.stopPropagation();
                              if (modeOption.key === "mixed" || active) return;
                              const activity = applyNotificationDeliveryModeToGroup(
                                eventTypes,
                                modeOption.key,
                                config?.activity,
                              );
                              await api.saveConfig({ activity });
                              onSaved();
                            }}
                            aria-disabled={!isActionable}
                            style={{ cursor }}
                            className={`px-2 py-1 text-[10px] rounded transition-colors duration-150 ${
                              active
                                ? activeClass
                                : isActionable
                                  ? `${text.dimmed} hover:text-white/70 hover:bg-white/[0.04]`
                                  : `${text.dimmed} opacity-60`
                            }`}
                          >
                            {modeOption.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-[6px] mx-[-10px] border-t border-white/[0.08]">
                      <div className="pt-2 px-2.5 flex flex-col gap-1.5">
                        {group.events.map(({ key: eventType, label }) => {
                          const mode = getNotificationDeliveryMode(eventType, config?.activity);
                          return (
                            <div
                              key={eventType}
                              className="flex items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 transition-colors hover:bg-white/[0.04]"
                            >
                              <span className="text-[10px]">{label}</span>
                              <div className="inline-flex items-center rounded-md border border-white/[0.08] bg-[#0f1217] p-0.5">
                                {NOTIFICATION_DELIVERY_MODES.map((modeOption) => {
                                  const active = modeOption.key === mode;
                                  const activeClass =
                                    modeOption.key === "off"
                                      ? "bg-red-500/20 text-red-300"
                                      : "bg-accent/15 text-accent";
                                  return (
                                    <button
                                      key={modeOption.key}
                                      type="button"
                                      onClick={async () => {
                                        if (active) return;
                                        const activity = applyNotificationDeliveryMode(
                                          eventType,
                                          modeOption.key,
                                          config?.activity,
                                        );
                                        await api.saveConfig({ activity });
                                        onSaved();
                                      }}
                                      className={`px-2 py-1 text-[10px] rounded transition-colors duration-150 ${
                                        active
                                          ? activeClass
                                          : `${text.dimmed} hover:text-white/70 hover:bg-white/[0.04]`
                                      }`}
                                    >
                                      {modeOption.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-2 ml-3">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]" : "bg-[#4b5563]"
            }`}
          />
          <span className={`text-xs ${text.muted}`}>
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>
    </div>
  );
}
