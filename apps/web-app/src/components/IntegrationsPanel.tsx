import { motion } from "motion/react";
import { ChevronDown, Link2, Plus, Power, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { reportPersistentErrorToast } from "../errorToasts";
import { useApi } from "../hooks/useApi";
import {
  type CodingAgent,
  fetchGitHubStatus,
  fetchJiraStatus,
  fetchLinearStatus,
  verifyIntegrations,
} from "../hooks/api";
import { useGitHubStatus, useJiraStatus, useLinearStatus } from "../hooks/useWorktrees";
import { useServerUrlOptional } from "../contexts/ServerContext";
import type { DataLifecycleConfig, GitHubStatus, JiraStatus, LinearStatus } from "../types";
import { button, input, settings, surface, text } from "../theme";
import { InfoBanner } from "./InfoBanner";
import { GitHubSetupModal } from "./GitHubSetupModal";
import { GitHubIcon, JiraIcon, LinearIcon } from "../icons";
import { AgentModelDropdown } from "./AgentModelDropdown";
import { Spinner } from "./Spinner";
import { ToggleSwitch } from "./ToggleSwitch";

const integrationInput = `px-2.5 py-1.5 rounded-md text-xs bg-white/[0.04] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.15] transition-all duration-150`;

const DEFAULT_LIFECYCLE: DataLifecycleConfig = {
  saveOn: "view",
  autoCleanup: {
    enabled: false,
    statusTriggers: [],
    actions: { issueData: true, attachments: true, notes: false, linkedWorktree: false },
  },
};

function DataLifecycleSection({
  dataLifecycle,
  onChange,
}: {
  dataLifecycle: DataLifecycleConfig;
  onChange: (config: DataLifecycleConfig) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingTrigger, setAddingTrigger] = useState(false);
  const [triggerInput, setTriggerInput] = useState("");
  const triggerInputRef = useRef<HTMLInputElement>(null);

  const { saveOn, autoCleanup } = dataLifecycle;
  const { enabled, statusTriggers, actions } = autoCleanup;

  const commitTrigger = () => {
    const trimmed = triggerInput.trim();
    if (trimmed && !statusTriggers.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      onChange({
        ...dataLifecycle,
        autoCleanup: { ...autoCleanup, statusTriggers: [...statusTriggers, trimmed] },
      });
    }
    setTriggerInput("");
    setAddingTrigger(false);
  };

  const removeTrigger = (index: number) => {
    onChange({
      ...dataLifecycle,
      autoCleanup: { ...autoCleanup, statusTriggers: statusTriggers.filter((_, i) => i !== index) },
    });
  };

  const toggleAction = (key: keyof typeof actions) => {
    onChange({
      ...dataLifecycle,
      autoCleanup: { ...autoCleanup, actions: { ...actions, [key]: !actions[key] } },
    });
  };

  const saveOnOptions = [
    { value: "view" as const, label: "When viewing" },
    { value: "worktree-creation" as const, label: "On worktree creation" },
    { value: "never" as const, label: "Never" },
  ];

  return (
    <div className="border-t border-white/[0.06] pt-2 mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 py-1 text-[11px] font-medium ${text.secondary} hover:text-white transition-colors duration-150 w-full`}
      >
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-150 ${expanded ? "" : "-rotate-90"}`}
        />
        Local Storage
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 mt-4 pl-0.5">
          {/* Save On toggle */}
          <div className="flex flex-col gap-1.5">
            <label className={`text-[10px] ${settings.label}`}>Save issue data to disk</label>
            <div className="flex gap-0.5 bg-white/[0.04] rounded-md p-0.5 self-start">
              {saveOnOptions.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => onChange({ ...dataLifecycle, saveOn: value })}
                  className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors duration-150 ${
                    saveOn === value
                      ? "text-white bg-white/[0.10]"
                      : `${text.muted} hover:text-[#9ca3af]`
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className={`text-[10px] ${text.dimmed} leading-relaxed`}>
              {saveOn === "view"
                ? "Issue details, comments, and attachments are saved locally when you open an issue."
                : saveOn === "worktree-creation"
                  ? "Nothing is saved until you create a worktree from the issue."
                  : "Issue data is never saved to disk. Disables auto-deletion."}
            </span>
          </div>

          {saveOn !== "never" && (
            <>
              {/* Auto-delete toggle */}
              <div className="flex items-center gap-3">
                <ToggleSwitch
                  checked={enabled}
                  onToggle={() =>
                    onChange({
                      ...dataLifecycle,
                      autoCleanup: { ...autoCleanup, enabled: !enabled },
                    })
                  }
                />
                <div className="flex flex-col gap-0.5">
                  <label className={`text-[10px] ${settings.label}`}>
                    Delete local data on status change
                  </label>
                  <span className={`text-[10px] ${text.dimmed}`}>
                    Remove cached files when an issue is closed or done
                  </span>
                </div>
              </div>

              {enabled && (
                <>
                  {/* Status triggers */}
                  <div className="flex flex-col gap-1.5 mt-1">
                    <label className={`text-[10px] ${settings.label}`}>Trigger on status</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {statusTriggers.map((trigger, i) => (
                        <span
                          key={i}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] ${text.secondary} bg-white/[0.06]`}
                        >
                          {trigger}
                          <button
                            onClick={() => removeTrigger(i)}
                            className={`${text.muted} hover:text-white transition-colors`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {addingTrigger ? (
                        <input
                          ref={triggerInputRef}
                          autoFocus
                          value={triggerInput}
                          onChange={(e) => setTriggerInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitTrigger();
                            if (e.key === "Escape") {
                              setTriggerInput("");
                              setAddingTrigger(false);
                            }
                          }}
                          onBlur={commitTrigger}
                          placeholder="e.g. Done"
                          className={`${integrationInput} w-28 !py-[3px] !px-2.5 text-[11px]`}
                        />
                      ) : (
                        <button
                          onClick={() => setAddingTrigger(true)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] ${text.muted} hover:text-[#9ca3af] hover:bg-white/[0.04] transition-colors`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </button>
                      )}
                    </div>
                  </div>

                  {/* What to delete */}
                  <div className="flex flex-col gap-2.5">
                    <label className={`text-[10px] ${settings.label}`}>What to delete</label>
                    <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                      {(
                        [
                          ["issueData", "Cached issue data"],
                          ["attachments", "Downloaded attachments"],
                          ["notes", "Notes & todos"],
                          ["linkedWorktree", "Linked worktree"],
                        ] as const
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className={`flex items-center gap-1.5 text-[10px] ${text.secondary} cursor-pointer`}
                        >
                          <input
                            type="checkbox"
                            checked={actions[key]}
                            onChange={() => toggleAction(key)}
                            className="w-3 h-3 rounded border-white/20 bg-white/[0.04] accent-accent"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AutoStartAgentSection({
  autoStartAgent,
  autoStartEnabled,
  skipPermissions,
  focusTerminal,
  autoUpdateIssueStatusOnAgentStart,
  autoUpdateIssueStatusName,
  statusOptions,
  onSelectAutoStartAgent,
  onToggleAutoStart,
  onToggleSkipPermissions,
  onToggleFocusTerminal,
  onToggleAutoUpdateIssueStatusOnAgentStart,
  onSelectAutoUpdateIssueStatusName,
}: {
  autoStartAgent: CodingAgent;
  autoStartEnabled: boolean;
  skipPermissions: boolean;
  focusTerminal: boolean;
  autoUpdateIssueStatusOnAgentStart: boolean;
  autoUpdateIssueStatusName: string | null;
  statusOptions: string[];
  onSelectAutoStartAgent: (agent: CodingAgent) => void;
  onToggleAutoStart: () => void;
  onToggleSkipPermissions: () => void;
  onToggleFocusTerminal: () => void;
  onToggleAutoUpdateIssueStatusOnAgentStart: () => void;
  onSelectAutoUpdateIssueStatusName: (status: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const renderToggle = (
    checked: boolean,
    onToggle: () => void,
    options?: { disabled?: boolean },
  ) => <ToggleSwitch checked={checked} onToggle={onToggle} disabled={options?.disabled} />;

  return (
    <div className="border-t border-white/[0.06] pt-2 mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 py-1 text-[11px] font-medium ${text.secondary} hover:text-white transition-colors duration-150 w-full`}
      >
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-150 ${expanded ? "" : "-rotate-90"}`}
        />
        Auto-start agent
      </button>

      {expanded && (
        <div className="flex flex-col gap-2.5 mt-2.5 pl-0.5">
          <div className="flex items-center gap-3">
            {renderToggle(autoStartEnabled, onToggleAutoStart)}
            <div className="flex flex-col gap-0.5">
              <label className={`text-[10px] ${settings.label}`}>Auto-start on new issue</label>
              <span className={`text-[10px] ${text.dimmed}`}>
                Create a new worktree and launch the selected agent automatically.
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <AgentModelDropdown
              value={autoStartAgent}
              onChange={onSelectAutoStartAgent}
              className="mt-0.5"
              triggerVariant="icon"
              iconSize="sm"
              disabled={!autoStartEnabled}
            />
            <div className="flex flex-col gap-0.5">
              <label className={`text-[10px] ${autoStartEnabled ? settings.label : text.dimmed}`}>
                Agent
              </label>
              <span className={`text-[10px] ${text.dimmed}`}>Agent used when auto-start runs.</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {renderToggle(skipPermissions, onToggleSkipPermissions, {
              disabled: !autoStartEnabled,
            })}
            <div className="flex flex-col gap-0.5">
              <label className={`text-[10px] ${!autoStartEnabled ? text.dimmed : settings.label}`}>
                Skip permission prompts
              </label>
              <span className={`text-[10px] ${text.dimmed}`}>
                Runs with the selected agent's skip-permissions mode. Enabled by default.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {renderToggle(focusTerminal, onToggleFocusTerminal, {
              disabled: !autoStartEnabled,
            })}
            <div className="flex flex-col gap-0.5">
              <label className={`text-[10px] ${!autoStartEnabled ? text.dimmed : settings.label}`}>
                Focus terminal on auto-start
              </label>
              <span className={`text-[10px] ${text.dimmed}`}>
                Redirects you to the worktree agent terminal when auto-start begins.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {renderToggle(
              autoUpdateIssueStatusOnAgentStart,
              onToggleAutoUpdateIssueStatusOnAgentStart,
              {
                disabled: !autoStartEnabled,
              },
            )}
            <div className="flex flex-col gap-0.5">
              <label className={`text-[10px] ${!autoStartEnabled ? text.dimmed : settings.label}`}>
                Update issue status on agent start
              </label>
              <span className={`text-[10px] ${text.dimmed}`}>
                Automatically transition the issue when auto-started agents begin work.
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 pl-8">
            <label
              className={`text-[10px] ${
                !autoStartEnabled || !autoUpdateIssueStatusOnAgentStart
                  ? text.dimmed
                  : settings.label
              }`}
            >
              Status to set
            </label>
            <select
              value={autoUpdateIssueStatusName ?? ""}
              onChange={(event) => onSelectAutoUpdateIssueStatusName(event.target.value)}
              disabled={!autoStartEnabled || !autoUpdateIssueStatusOnAgentStart}
              className={`${integrationInput} w-full disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <option value="">Select status...</option>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]" : "bg-[#4b5563]"}`}
    />
  );
}

function StatusRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <StatusDot active={ok} />
      <span className={`text-[11px] ${text.dimmed} w-10`}>{label}</span>
      <span className={`text-[11px] ${ok ? text.secondary : text.muted}`}>{value}</span>
    </div>
  );
}

function GitHubCard({
  status,
  onStatusChange,
}: {
  status: GitHubStatus | null;
  onStatusChange: (status?: GitHubStatus) => void;
}) {
  const api = useApi();
  const serverUrl = useServerUrlOptional();
  const isReady = status?.installed && status?.authenticated && status?.repo;
  const needsRepo =
    status?.installed && status?.authenticated && !status?.repo && status?.hasCommits;
  const needsCommit = status?.hasCommits === false;
  const needsSetup = needsCommit || needsRepo;
  const [loading, setLoading] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [waitingForAuth, setWaitingForAuth] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleAutoSetup = async (options: { commitMessage: string; repoPrivate: boolean }) => {
    setShowSetupModal(false);
    setSettingUp(true);
    setFeedback(null);

    try {
      // Step 1: Create initial commit if needed
      if (needsCommit) {
        setFeedback("Creating initial commit...");
        const commitResult = await api.createInitialCommit();
        if (!commitResult.success) {
          setFeedback(null);
          setSettingUp(false);
          return;
        }
      }

      // Step 2: Create repo if needed
      if (needsRepo || needsCommit) {
        setFeedback("Creating GitHub repository...");
        const repoResult = await api.createGitHubRepo(options.repoPrivate);
        if (!repoResult.success) {
          setFeedback(null);
          setSettingUp(false);
          onStatusChange();
          return;
        }
        setFeedback(`Created ${repoResult.repo}`);
      }

      onStatusChange();
      setTimeout(() => setFeedback(null), 4000);
    } catch (error) {
      reportPersistentErrorToast(error, "GitHub setup failed unexpectedly", {
        scope: "integrations:github-setup",
      });
      setFeedback(null);
    }
    setSettingUp(false);
  };

  useEffect(() => {
    if (!waitingForAuth) return;
    pollRef.current = setInterval(async () => {
      try {
        const data = await fetchGitHubStatus(serverUrl);
        if (data?.authenticated) {
          setWaitingForAuth(false);
          setFeedback(null);
          onStatusChange(data);
        }
      } catch (error) {
        reportPersistentErrorToast(error, "Failed to poll GitHub auth status", {
          scope: "integrations:github-poll",
        });
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [waitingForAuth, onStatusChange, serverUrl]);

  useEffect(() => {
    if (status?.authenticated && waitingForAuth) {
      setWaitingForAuth(false);
    }
  }, [status?.authenticated, waitingForAuth]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      reportPersistentErrorToast(error, "Could not copy text to clipboard", {
        scope: "integrations:clipboard",
      });
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    setFeedback(null);
    const result = await api.installGitHubCli();
    setLoading(false);
    if (result.success) {
      if (result.code) {
        await copyToClipboard(result.code);
        setFeedback(`Code ${result.code} copied! Paste it in your browser.`);
      } else {
        setFeedback("Continue authentication in your browser if prompted.");
      }
      const data = await fetchGitHubStatus(serverUrl);
      onStatusChange(data ?? undefined);
      setWaitingForAuth(!(data?.authenticated ?? false));
    } else {
      setFeedback(null);
    }
  };

  const handleLogin = async () => {
    setFeedback(null);
    const result = await api.loginGitHub();
    if (result.success) {
      if (result.code) {
        await copyToClipboard(result.code);
        setFeedback(`Code ${result.code} copied! Paste it in your browser.`);
      } else {
        setFeedback("Authentication started. Finish sign-in in your browser.");
      }
      const data = await fetchGitHubStatus(serverUrl);
      onStatusChange(data ?? undefined);
      setWaitingForAuth(!(data?.authenticated ?? false));
    } else {
      setFeedback(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Card header with icon */}
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${isReady ? "bg-white/[0.05]" : "bg-white/[0.04]"}`}
        >
          <GitHubIcon className={`w-4 h-4 ${isReady ? "text-white" : text.muted}`} />
        </div>
        <div>
          <h3 className={`text-xs font-semibold ${text.primary}`}>GitHub</h3>
          <span className={`text-[10px] ${isReady ? "text-white" : text.dimmed}`}>
            {isReady ? "Connected" : "Not connected"}
          </span>
        </div>
      </div>

      {/* Status rows */}
      {status === null ? (
        <span className={`flex items-center gap-2 text-xs ${text.muted}`}>
          <Spinner size="xs" />
          Loading...
        </span>
      ) : (
        <div className="flex flex-col gap-1.5">
          <StatusRow
            label="CLI"
            ok={status.installed}
            value={status.installed ? "Installed" : "Not installed"}
          />
          <StatusRow
            label="Auth"
            ok={status.authenticated}
            value={
              status.authenticated ? (status.username ?? "Authenticated") : "Not authenticated"
            }
          />
          <StatusRow
            label="Repo"
            ok={!!status.repo}
            value={status.repo ?? (status.authenticated ? "Not linked" : "—")}
          />
        </div>
      )}

      {/* Help text */}
      {status && !isReady && !needsSetup && (
        <p className={`text-[11px] ${text.dimmed} leading-relaxed`}>
          {!status.installed
            ? "Install the GitHub CLI to enable commits, pushes, and pull requests."
            : "Authenticate with GitHub to enable git operations."}
        </p>
      )}

      {/* Repository setup needed */}
      {needsSetup && status?.authenticated && (
        <div className="flex flex-col gap-2">
          <p className={`text-[11px] text-orange-400 leading-relaxed`}>
            {needsCommit && needsRepo
              ? "This project needs an initial commit and GitHub repository to enable worktrees."
              : needsCommit
                ? "This repository has no commits yet. Create an initial commit to enable worktrees."
                : "This project is not linked to a GitHub repository."}
          </p>
          {!settingUp && (
            <button
              onClick={() => setShowSetupModal(true)}
              className={`text-[11px] px-3 py-1.5 rounded-md font-medium ${button.primary} self-start transition-all duration-150 active:scale-[0.98]`}
            >
              Set Up Repository
            </button>
          )}
          {settingUp && (
            <span className={`flex items-center gap-2 text-[11px] ${text.muted}`}>
              <Spinner size="xs" />
              Setting up...
            </span>
          )}
        </div>
      )}

      {feedback && <span className="text-[11px] text-accent">{feedback}</span>}

      {/* Actions */}
      {status && !status.installed && !waitingForAuth && (
        <button
          onClick={handleConnect}
          disabled={loading}
          className={`text-[11px] px-3 py-1.5 rounded-md font-medium ${button.primary} disabled:opacity-50 self-start transition-all duration-150 active:scale-[0.98]`}
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <Spinner size="xs" />
              Installing...
            </span>
          ) : (
            "Install & Connect"
          )}
        </button>
      )}

      {status && status.installed && !status.authenticated && !waitingForAuth && (
        <button
          onClick={handleLogin}
          disabled={waitingForAuth}
          className={`text-[11px] px-3 py-1.5 rounded-md font-medium ${button.primary} disabled:opacity-50 self-start transition-all duration-150 active:scale-[0.98]`}
        >
          Authenticate
        </button>
      )}

      {/* Disconnect option */}
      {status?.authenticated && !waitingForAuth && !settingUp && (
        <button
          onClick={async () => {
            setLoading(true);
            setFeedback(null);
            const result = await api.logoutGitHub();
            setLoading(false);
            if (result.success) {
              onStatusChange();
            } else {
              setFeedback(null);
            }
          }}
          disabled={loading}
          className={`flex items-center gap-1 text-[11px] ${text.muted} hover:text-red-400 disabled:opacity-50 transition-colors duration-150 self-start mt-3`}
        >
          <Power className="w-3 h-3" />
          Disconnect
        </button>
      )}

      {/* Setup modal */}
      {showSetupModal && (
        <GitHubSetupModal
          needsCommit={needsCommit ?? false}
          needsRepo={!status?.repo}
          onAutoSetup={handleAutoSetup}
          onManual={() => setShowSetupModal(false)}
        />
      )}
    </div>
  );
}

function JiraCard({
  status,
  onStatusChange,
}: {
  status: JiraStatus | null;
  onStatusChange: () => void;
}) {
  const api = useApi();
  const [showSetup, setShowSetup] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [lifecycle, setLifecycle] = useState<DataLifecycleConfig>(DEFAULT_LIFECYCLE);
  const [autoStartAgent, setAutoStartAgent] = useState<CodingAgent>("claude");
  const [autoStartClaudeOnNewIssue, setAutoStartClaudeOnNewIssue] = useState(false);
  const [autoStartClaudeSkipPermissions, setAutoStartClaudeSkipPermissions] = useState(true);
  const [autoStartClaudeFocusTerminal, setAutoStartClaudeFocusTerminal] = useState(true);
  const [autoUpdateIssueStatusOnAgentStart, setAutoUpdateIssueStatusOnAgentStart] = useState(false);
  const [autoUpdateIssueStatusName, setAutoUpdateIssueStatusName] = useState<string | null>(null);
  const [issueStatusOptions, setIssueStatusOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );
  const configReadyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (status?.defaultProjectKey) {
      setProjectKey(status.defaultProjectKey);
    }
    if (status?.refreshIntervalMinutes) {
      setRefreshInterval(status.refreshIntervalMinutes);
    }
    if (status?.dataLifecycle) {
      setLifecycle(status.dataLifecycle);
    }
    if (status?.autoStartAgent) {
      setAutoStartAgent(status.autoStartAgent);
    }
    if (status?.autoStartClaudeOnNewIssue !== undefined) {
      setAutoStartClaudeOnNewIssue(status.autoStartClaudeOnNewIssue);
    }
    if (status?.autoStartClaudeSkipPermissions !== undefined) {
      setAutoStartClaudeSkipPermissions(status.autoStartClaudeSkipPermissions);
    }
    if (status?.autoStartClaudeFocusTerminal !== undefined) {
      setAutoStartClaudeFocusTerminal(status.autoStartClaudeFocusTerminal);
    }
    if (status?.autoUpdateIssueStatusOnAgentStart !== undefined) {
      setAutoUpdateIssueStatusOnAgentStart(status.autoUpdateIssueStatusOnAgentStart);
    }
    if (status?.autoUpdateIssueStatusName !== undefined) {
      setAutoUpdateIssueStatusName(status.autoUpdateIssueStatusName);
    }
    if (status?.configured) {
      const t = setTimeout(() => {
        configReadyRef.current = true;
      }, 50);
      return () => clearTimeout(t);
    }
  }, [
    status?.defaultProjectKey,
    status?.refreshIntervalMinutes,
    status?.dataLifecycle,
    status?.autoStartAgent,
    status?.autoStartClaudeOnNewIssue,
    status?.autoStartClaudeSkipPermissions,
    status?.autoStartClaudeFocusTerminal,
    status?.autoUpdateIssueStatusOnAgentStart,
    status?.autoUpdateIssueStatusName,
    status?.configured,
  ]);

  useEffect(() => {
    if (!status?.configured) {
      setIssueStatusOptions([]);
      return;
    }
    let active = true;
    void api.fetchJiraStatusOptions().then((result) => {
      if (!active) return;
      setIssueStatusOptions((result.options ?? []).map((option) => option.name));
    });
    return () => {
      active = false;
    };
  }, [api, status?.configured]);

  // Auto-save config on change
  useEffect(() => {
    if (!configReadyRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const result = await api.updateJiraConfig(
        projectKey,
        refreshInterval,
        lifecycle,
        autoStartClaudeOnNewIssue,
        autoStartClaudeSkipPermissions,
        autoStartClaudeFocusTerminal,
        autoStartAgent,
        autoUpdateIssueStatusOnAgentStart,
        autoUpdateIssueStatusName,
      );
      if (result.success) onStatusChange();
    }, 300);
    return () => clearTimeout(saveTimerRef.current);
  }, [
    projectKey,
    refreshInterval,
    lifecycle,
    autoStartAgent,
    autoStartClaudeOnNewIssue,
    autoStartClaudeSkipPermissions,
    autoStartClaudeFocusTerminal,
    autoUpdateIssueStatusOnAgentStart,
    autoUpdateIssueStatusName,
    api,
    onStatusChange,
  ]);

  const handleConnect = async () => {
    if (!baseUrl || !email || !token) return;
    setSaving(true);
    setFeedback(null);
    const result = await api.setupJira(baseUrl, email, token);
    setSaving(false);
    if (result.success) {
      setShowSetup(false);
      setBaseUrl("");
      setEmail("");
      setToken("");
      onStatusChange();
    } else {
      setFeedback({ type: "error", message: result.error ?? "Failed to connect" });
    }
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleDisconnect = async () => {
    setSaving(true);
    const result = await api.disconnectJira();
    setSaving(false);
    if (result.success) {
      onStatusChange();
    }
  };

  const isConfigured = status?.configured ?? false;

  return (
    <div className="flex flex-col gap-4">
      {/* Card header with icon */}
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${isConfigured ? "bg-blue-500/10" : "bg-white/[0.04]"}`}
        >
          <JiraIcon
            className={`w-4 h-4 [&>svg]:text-inherit ${isConfigured ? "text-blue-400" : text.muted}`}
          />
        </div>
        <div>
          <h3 className={`text-xs font-semibold ${text.primary}`}>Jira</h3>
          <span className={`text-[10px] ${isConfigured ? "text-blue-400" : text.dimmed}`}>
            {isConfigured ? "Connected" : "Not connected"}
          </span>
        </div>
      </div>

      {status === null ? (
        <span className={`flex items-center gap-2 text-xs ${text.muted}`}>
          <Spinner size="xs" />
          Loading...
        </span>
      ) : isConfigured ? (
        <div className="flex flex-col gap-3">
          {status.domain && <StatusRow label="Domain" ok={true} value={status.domain} />}
          {status.email && <StatusRow label="Email" ok={true} value={status.email} />}

          <div className="flex gap-3 items-end mt-2">
            <div className="flex flex-col gap-1.5 w-28">
              <label className={`text-[10px] ${settings.label}`}>Project Key</label>
              <input
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                placeholder="PROJ"
                className={integrationInput}
              />
            </div>
            <div className="flex flex-col gap-1.5 w-28">
              <label className={`text-[10px] ${settings.label}`}>Refresh (min)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={refreshInterval}
                onChange={(e) =>
                  setRefreshInterval(Math.max(1, Math.min(60, Number(e.target.value) || 1)))
                }
                className={integrationInput}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <AutoStartAgentSection
              autoStartAgent={autoStartAgent}
              autoStartEnabled={autoStartClaudeOnNewIssue}
              skipPermissions={autoStartClaudeSkipPermissions}
              focusTerminal={autoStartClaudeFocusTerminal}
              autoUpdateIssueStatusOnAgentStart={autoUpdateIssueStatusOnAgentStart}
              autoUpdateIssueStatusName={autoUpdateIssueStatusName}
              statusOptions={issueStatusOptions}
              onSelectAutoStartAgent={setAutoStartAgent}
              onToggleAutoStart={() => setAutoStartClaudeOnNewIssue((prev) => !prev)}
              onToggleSkipPermissions={() => setAutoStartClaudeSkipPermissions((prev) => !prev)}
              onToggleFocusTerminal={() => setAutoStartClaudeFocusTerminal((prev) => !prev)}
              onToggleAutoUpdateIssueStatusOnAgentStart={() =>
                setAutoUpdateIssueStatusOnAgentStart((prev) => !prev)
              }
              onSelectAutoUpdateIssueStatusName={(nextStatus) =>
                setAutoUpdateIssueStatusName(nextStatus || null)
              }
            />

            <DataLifecycleSection dataLifecycle={lifecycle} onChange={setLifecycle} />
          </div>

          <button
            onClick={handleDisconnect}
            disabled={saving}
            className={`flex items-center gap-1 text-[11px] ${text.muted} hover:text-red-400 disabled:opacity-50 transition-colors duration-150 self-start mt-4`}
          >
            <Power className="w-3 h-3" />
            Disconnect
          </button>
        </div>
      ) : showSetup ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] ${settings.label}`}>Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://your-org.atlassian.net"
              className={integrationInput}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] ${settings.label}`}>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className={integrationInput}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] ${settings.label}`}>API Token</label>
            <div className="relative">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Your Jira API token"
                className={`${integrationInput} w-full pr-16`}
              />
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] font-medium bg-white/[0.06] text-[#9ca3af] hover:bg-white/[0.10] hover:text-white rounded transition-colors"
              >
                Create
              </a>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConnect}
              disabled={saving || !baseUrl || !email || !token}
              className={`text-[11px] px-3 py-1.5 rounded-md font-medium ${button.primary} disabled:opacity-50 transition-all duration-150 active:scale-[0.98]`}
            >
              {saving ? (
                <span className="flex items-center gap-1.5">
                  <Spinner size="xs" />
                  Connecting...
                </span>
              ) : (
                "Connect"
              )}
            </button>
            <button
              onClick={() => setShowSetup(false)}
              className={`text-[11px] px-3 py-1.5 rounded-md ${button.secondary} transition-colors duration-150`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className={`text-[11px] ${text.dimmed} leading-relaxed`}>
            Connect Jira to create worktrees directly from issues and track status.
          </p>
          <button
            onClick={() => setShowSetup(true)}
            className={`text-[11px] px-3 py-1.5 rounded-md font-medium ${button.primary} self-start transition-all duration-150 active:scale-[0.98]`}
          >
            Set up Jira
          </button>
        </div>
      )}

      {feedback && (
        <span className={`text-[11px] ${feedback.type === "success" ? "text-accent" : text.error}`}>
          {feedback.message}
        </span>
      )}
    </div>
  );
}

function LinearCard({
  status,
  onStatusChange,
}: {
  status: LinearStatus | null;
  onStatusChange: () => void;
}) {
  const api = useApi();
  const [showSetup, setShowSetup] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [teamKey, setTeamKey] = useState("");
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [lifecycle, setLifecycle] = useState<DataLifecycleConfig>(DEFAULT_LIFECYCLE);
  const [autoStartAgent, setAutoStartAgent] = useState<CodingAgent>("claude");
  const [autoStartClaudeOnNewIssue, setAutoStartClaudeOnNewIssue] = useState(false);
  const [autoStartClaudeSkipPermissions, setAutoStartClaudeSkipPermissions] = useState(true);
  const [autoStartClaudeFocusTerminal, setAutoStartClaudeFocusTerminal] = useState(true);
  const [autoUpdateIssueStatusOnAgentStart, setAutoUpdateIssueStatusOnAgentStart] = useState(false);
  const [autoUpdateIssueStatusName, setAutoUpdateIssueStatusName] = useState<string | null>(null);
  const [issueStatusOptions, setIssueStatusOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );
  const configReadyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (status?.defaultTeamKey) {
      setTeamKey(status.defaultTeamKey);
    }
    if (status?.refreshIntervalMinutes) {
      setRefreshInterval(status.refreshIntervalMinutes);
    }
    if (status?.dataLifecycle) {
      setLifecycle(status.dataLifecycle);
    }
    if (status?.autoStartAgent) {
      setAutoStartAgent(status.autoStartAgent);
    }
    if (status?.autoStartClaudeOnNewIssue !== undefined) {
      setAutoStartClaudeOnNewIssue(status.autoStartClaudeOnNewIssue);
    }
    if (status?.autoStartClaudeSkipPermissions !== undefined) {
      setAutoStartClaudeSkipPermissions(status.autoStartClaudeSkipPermissions);
    }
    if (status?.autoStartClaudeFocusTerminal !== undefined) {
      setAutoStartClaudeFocusTerminal(status.autoStartClaudeFocusTerminal);
    }
    if (status?.autoUpdateIssueStatusOnAgentStart !== undefined) {
      setAutoUpdateIssueStatusOnAgentStart(status.autoUpdateIssueStatusOnAgentStart);
    }
    if (status?.autoUpdateIssueStatusName !== undefined) {
      setAutoUpdateIssueStatusName(status.autoUpdateIssueStatusName);
    }
    if (status?.configured) {
      const t = setTimeout(() => {
        configReadyRef.current = true;
      }, 50);
      return () => clearTimeout(t);
    }
  }, [
    status?.defaultTeamKey,
    status?.refreshIntervalMinutes,
    status?.dataLifecycle,
    status?.autoStartAgent,
    status?.autoStartClaudeOnNewIssue,
    status?.autoStartClaudeSkipPermissions,
    status?.autoStartClaudeFocusTerminal,
    status?.autoUpdateIssueStatusOnAgentStart,
    status?.autoUpdateIssueStatusName,
    status?.configured,
  ]);

  useEffect(() => {
    if (!status?.configured) {
      setIssueStatusOptions([]);
      return;
    }
    let active = true;
    void api.fetchLinearStatusOptions().then((result) => {
      if (!active) return;
      setIssueStatusOptions((result.options ?? []).map((option) => option.name));
    });
    return () => {
      active = false;
    };
  }, [api, status?.configured]);

  // Auto-save config on change
  useEffect(() => {
    if (!configReadyRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const result = await api.updateLinearConfig(
        teamKey,
        refreshInterval,
        lifecycle,
        autoStartClaudeOnNewIssue,
        autoStartClaudeSkipPermissions,
        autoStartClaudeFocusTerminal,
        autoStartAgent,
        autoUpdateIssueStatusOnAgentStart,
        autoUpdateIssueStatusName,
      );
      if (result.success) onStatusChange();
    }, 300);
    return () => clearTimeout(saveTimerRef.current);
  }, [
    teamKey,
    refreshInterval,
    lifecycle,
    autoStartAgent,
    autoStartClaudeOnNewIssue,
    autoStartClaudeSkipPermissions,
    autoStartClaudeFocusTerminal,
    autoUpdateIssueStatusOnAgentStart,
    autoUpdateIssueStatusName,
    api,
    onStatusChange,
  ]);

  const handleConnect = async () => {
    if (!apiKey) return;
    setSaving(true);
    setFeedback(null);
    const result = await api.setupLinear(apiKey);
    setSaving(false);
    if (result.success) {
      setShowSetup(false);
      setApiKey("");
      onStatusChange();
    } else {
      setFeedback({ type: "error", message: result.error ?? "Failed to connect" });
    }
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleDisconnect = async () => {
    setSaving(true);
    const result = await api.disconnectLinear();
    setSaving(false);
    if (result.success) {
      onStatusChange();
    }
  };

  const isConfigured = status?.configured ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${isConfigured ? "bg-[#5E6AD2]/10" : "bg-white/[0.04]"}`}
        >
          <LinearIcon
            className={`w-4 h-4 [&>svg]:text-inherit ${isConfigured ? "text-[#5E6AD2]" : text.muted}`}
          />
        </div>
        <div>
          <h3 className={`text-xs font-semibold ${text.primary}`}>Linear</h3>
          <span className={`text-[10px] ${isConfigured ? "text-[#5E6AD2]" : text.dimmed}`}>
            {isConfigured ? "Connected" : "Not connected"}
          </span>
        </div>
      </div>

      {status === null ? (
        <span className={`flex items-center gap-2 text-xs ${text.muted}`}>
          <Spinner size="xs" />
          Loading...
        </span>
      ) : isConfigured ? (
        <div className="flex flex-col gap-3">
          {status.displayName && <StatusRow label="User" ok={true} value={status.displayName} />}

          <div className="flex gap-3 items-end mt-2">
            <div className="flex flex-col gap-1.5 w-28">
              <label className={`text-[10px] ${settings.label}`}>Team Key</label>
              <input
                value={teamKey}
                onChange={(e) => setTeamKey(e.target.value.toUpperCase())}
                placeholder="ENG"
                className={integrationInput}
              />
            </div>
            <div className="flex flex-col gap-1.5 w-28">
              <label className={`text-[10px] ${settings.label}`}>Refresh (min)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={refreshInterval}
                onChange={(e) =>
                  setRefreshInterval(Math.max(1, Math.min(60, Number(e.target.value) || 1)))
                }
                className={integrationInput}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <AutoStartAgentSection
              autoStartAgent={autoStartAgent}
              autoStartEnabled={autoStartClaudeOnNewIssue}
              skipPermissions={autoStartClaudeSkipPermissions}
              focusTerminal={autoStartClaudeFocusTerminal}
              autoUpdateIssueStatusOnAgentStart={autoUpdateIssueStatusOnAgentStart}
              autoUpdateIssueStatusName={autoUpdateIssueStatusName}
              statusOptions={issueStatusOptions}
              onSelectAutoStartAgent={setAutoStartAgent}
              onToggleAutoStart={() => setAutoStartClaudeOnNewIssue((prev) => !prev)}
              onToggleSkipPermissions={() => setAutoStartClaudeSkipPermissions((prev) => !prev)}
              onToggleFocusTerminal={() => setAutoStartClaudeFocusTerminal((prev) => !prev)}
              onToggleAutoUpdateIssueStatusOnAgentStart={() =>
                setAutoUpdateIssueStatusOnAgentStart((prev) => !prev)
              }
              onSelectAutoUpdateIssueStatusName={(nextStatus) =>
                setAutoUpdateIssueStatusName(nextStatus || null)
              }
            />

            <DataLifecycleSection dataLifecycle={lifecycle} onChange={setLifecycle} />
          </div>

          <button
            onClick={handleDisconnect}
            disabled={saving}
            className={`flex items-center gap-1 text-[11px] ${text.muted} hover:text-red-400 disabled:opacity-50 transition-colors duration-150 self-start mt-4`}
          >
            <Power className="w-3 h-3" />
            Disconnect
          </button>
        </div>
      ) : showSetup ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] ${settings.label}`}>API Key</label>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="lin_api_..."
                className={`${integrationInput} w-full pr-16`}
              />
              <a
                href="https://linear.app/settings/account/security/api-keys/new"
                target="_blank"
                rel="noopener noreferrer"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] font-medium bg-white/[0.06] text-[#9ca3af] hover:bg-white/[0.10] hover:text-white rounded transition-colors"
              >
                Create
              </a>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConnect}
              disabled={saving || !apiKey}
              className={`text-[11px] px-3 py-1.5 rounded-md font-medium ${button.primary} disabled:opacity-50 transition-all duration-150 active:scale-[0.98]`}
            >
              {saving ? (
                <span className="flex items-center gap-1.5">
                  <Spinner size="xs" />
                  Connecting...
                </span>
              ) : (
                "Connect"
              )}
            </button>
            <button
              onClick={() => setShowSetup(false)}
              className={`text-[11px] px-3 py-1.5 rounded-md ${button.secondary} transition-colors duration-150`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className={`text-[11px] ${text.dimmed} leading-relaxed`}>
            Connect Linear to create worktrees directly from issues and track status.
          </p>
          <button
            onClick={() => setShowSetup(true)}
            className={`text-[11px] px-3 py-1.5 rounded-md font-medium ${button.primary} self-start transition-all duration-150 active:scale-[0.98]`}
          >
            Set up Linear
          </button>
        </div>
      )}

      {feedback && (
        <span className={`text-[11px] ${feedback.type === "success" ? "text-accent" : text.error}`}>
          {feedback.message}
        </span>
      )}
    </div>
  );
}

interface IntegrationsPanelProps {
  onJiraStatusChange?: () => void;
  onLinearStatusChange?: () => void;
}

export function IntegrationsPanel({
  onJiraStatusChange,
  onLinearStatusChange,
}: IntegrationsPanelProps) {
  const serverUrl = useServerUrlOptional();
  const githubStatus = useGitHubStatus();
  const { jiraStatus } = useJiraStatus();
  const { linearStatus } = useLinearStatus();
  const [githubRefreshKey, setGithubRefreshKey] = useState(0);
  const [jiraRefreshKey, setJiraRefreshKey] = useState(0);
  const [linearRefreshKey, setLinearRefreshKey] = useState(0);
  const [currentGithubStatus, setCurrentGithubStatus] = useState<GitHubStatus | null>(null);
  const [currentJiraStatus, setCurrentJiraStatus] = useState<JiraStatus | null>(null);
  const [currentLinearStatus, setCurrentLinearStatus] = useState<LinearStatus | null>(null);
  useEffect(() => {
    setCurrentGithubStatus(githubStatus);
  }, [githubStatus]);

  useEffect(() => {
    setCurrentJiraStatus(jiraStatus);
  }, [jiraStatus]);

  useEffect(() => {
    setCurrentLinearStatus(linearStatus);
  }, [linearStatus]);

  // Background-verify all configured integrations on mount
  useEffect(() => {
    if (serverUrl === null) return;
    verifyIntegrations(serverUrl)
      .then((result) => {
        if (!result) return;
        if (result.github?.ok === false) {
          setCurrentGithubStatus((prev) => (prev ? { ...prev, authenticated: false } : prev));
        }
        if (result.jira?.ok === false) {
          setCurrentJiraStatus((prev) => (prev ? { ...prev, configured: false } : prev));
        }
        if (result.linear?.ok === false) {
          setCurrentLinearStatus((prev) => (prev ? { ...prev, configured: false } : prev));
        }
      })
      .catch((error) => {
        reportPersistentErrorToast(error, "Integration verification failed", {
          scope: "integrations:verify",
        });
      });
  }, [serverUrl]);

  useEffect(() => {
    if (githubRefreshKey === 0) return;
    fetchGitHubStatus(serverUrl)
      .then((d) => setCurrentGithubStatus(d))
      .catch((error) => {
        reportPersistentErrorToast(error, "Failed to refresh GitHub status", {
          scope: "integrations:refresh-github",
        });
      });
  }, [githubRefreshKey, serverUrl]);

  useEffect(() => {
    if (jiraRefreshKey === 0) return;
    fetchJiraStatus(serverUrl)
      .then((d) => {
        setCurrentJiraStatus(d);
        onJiraStatusChange?.();
      })
      .catch((error) => {
        reportPersistentErrorToast(error, "Failed to refresh Jira status", {
          scope: "integrations:refresh-jira",
        });
      });
  }, [jiraRefreshKey, onJiraStatusChange, serverUrl]);

  useEffect(() => {
    if (linearRefreshKey === 0) return;
    fetchLinearStatus(serverUrl)
      .then((d) => {
        setCurrentLinearStatus(d);
        onLinearStatusChange?.();
      })
      .catch((error) => {
        reportPersistentErrorToast(error, "Failed to refresh Linear status", {
          scope: "integrations:refresh-linear",
        });
      });
  }, [linearRefreshKey, onLinearStatusChange, serverUrl]);

  return (
    <div>
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center">
              <Link2 className="w-4 h-4 text-blue-400" />
            </div>
            <h1 className="text-base font-medium text-[#f0f2f5]">Integrations</h1>
          </div>

          <InfoBanner storageKey="OpenKit:integrationsBannerDismissed" color="blue">
            Connect external services like GitHub, Jira, and Linear to sync issues, track branches,
            and streamline your development workflow across tools.
          </InfoBanner>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="flex flex-col gap-8"
        >
          <div className={`rounded-xl ${surface.panel} border border-white/[0.08] p-5`}>
            <GitHubCard
              status={currentGithubStatus}
              onStatusChange={(status) => {
                if (status) setCurrentGithubStatus(status);
                setGithubRefreshKey((k) => k + 1);
              }}
            />
          </div>
          <div className={`rounded-xl ${surface.panel} border border-white/[0.08] p-5`}>
            <JiraCard
              status={currentJiraStatus}
              onStatusChange={() => setJiraRefreshKey((k) => k + 1)}
            />
          </div>
          <div className={`rounded-xl ${surface.panel} border border-white/[0.08] p-5`}>
            <LinearCard
              status={currentLinearStatus}
              onStatusChange={() => setLinearRefreshKey((k) => k + 1)}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
