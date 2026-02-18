import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  Power,
  Unplug,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { APP_NAME } from "../../constants";
import { useApi } from "../hooks/useApi";
import {
  fetchGitHubStatus,
  fetchJiraStatus,
  fetchLinearStatus,
  verifyIntegrations,
} from "../hooks/api";
import { useGitHubStatus, useJiraStatus, useLinearStatus } from "../hooks/useWorktrees";
import { useServerUrlOptional } from "../contexts/ServerContext";
import type { DataLifecycleConfig, GitHubStatus, JiraStatus, LinearStatus } from "../types";
import { button, infoBanner, input, settings, surface, text } from "../theme";
import { GitHubSetupModal } from "./GitHubSetupModal";
import { GitHubIcon, JiraIcon, LinearIcon } from "./icons";
import { Spinner } from "./Spinner";

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
    <div className="border-t border-white/[0.06] pt-3 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 text-[11px] font-medium ${text.secondary} hover:text-white transition-colors duration-150 w-full`}
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
                <button
                  onClick={() =>
                    onChange({
                      ...dataLifecycle,
                      autoCleanup: { ...autoCleanup, enabled: !enabled },
                    })
                  }
                  className={`relative w-7 h-4 rounded-full transition-colors duration-200 flex-shrink-0 ${
                    enabled ? "bg-accent" : "bg-white/[0.12]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      enabled ? "left-[14px]" : "left-0.5"
                    }`}
                  />
                </button>
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
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleAutoSetup = async (options: { commitMessage: string; repoPrivate: boolean }) => {
    setShowSetupModal(false);
    setSettingUp(true);
    setFeedback(null);

    try {
      // Step 1: Create initial commit if needed
      if (needsCommit) {
        setFeedback({ type: "success", message: "Creating initial commit..." });
        const commitResult = await api.createInitialCommit();
        if (!commitResult.success) {
          setFeedback({ type: "error", message: commitResult.error ?? "Failed to create commit" });
          setSettingUp(false);
          return;
        }
      }

      // Step 2: Create repo if needed
      if (needsRepo || needsCommit) {
        setFeedback({ type: "success", message: "Creating GitHub repository..." });
        const repoResult = await api.createGitHubRepo(options.repoPrivate);
        if (!repoResult.success) {
          setFeedback({
            type: "error",
            message: repoResult.error ?? "Failed to create repository",
          });
          setSettingUp(false);
          onStatusChange();
          return;
        }
        setFeedback({ type: "success", message: `Created ${repoResult.repo}` });
      }

      onStatusChange();
      setTimeout(() => setFeedback(null), 4000);
    } catch {
      setFeedback({ type: "error", message: "Setup failed unexpectedly" });
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
      } catch {
        // ignore polling errors
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
    } catch {
      // Clipboard API not available
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
        setFeedback({
          type: "success",
          message: `Code ${result.code} copied! Paste it in your browser.`,
        });
        setWaitingForAuth(true);
      } else {
        setFeedback({ type: "success", message: "gh CLI installed" });
      }
      onStatusChange();
    } else {
      setFeedback({ type: "error", message: result.error ?? "Failed to install gh" });
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  const handleLogin = async () => {
    setFeedback(null);
    const result = await api.loginGitHub();
    if (result.success && result.code) {
      await copyToClipboard(result.code);
      setFeedback({
        type: "success",
        message: `Code ${result.code} copied! Paste it in your browser.`,
      });
      setWaitingForAuth(true);
    } else if (!result.success) {
      setFeedback({ type: "error", message: result.error ?? "Failed to start login" });
      setTimeout(() => setFeedback(null), 4000);
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

      {feedback && (
        <span className={`text-[11px] ${feedback.type === "success" ? "text-accent" : text.error}`}>
          {feedback.message}
        </span>
      )}

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
              setFeedback({ type: "error", message: result.error ?? "Failed to logout" });
              setTimeout(() => setFeedback(null), 4000);
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
    status?.configured,
  ]);

  // Auto-save config on change
  useEffect(() => {
    if (!configReadyRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const result = await api.updateJiraConfig(projectKey, refreshInterval, lifecycle);
      if (result.success) onStatusChange();
    }, 300);
    return () => clearTimeout(saveTimerRef.current);
  }, [projectKey, refreshInterval, lifecycle, api, onStatusChange]);

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
          <JiraIcon className={`w-4 h-4 ${isConfigured ? "text-blue-400" : text.muted}`} />
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

          <DataLifecycleSection dataLifecycle={lifecycle} onChange={setLifecycle} />

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
    status?.configured,
  ]);

  // Auto-save config on change
  useEffect(() => {
    if (!configReadyRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const result = await api.updateLinearConfig(teamKey, refreshInterval, lifecycle);
      if (result.success) onStatusChange();
    }, 300);
    return () => clearTimeout(saveTimerRef.current);
  }, [teamKey, refreshInterval, lifecycle, api, onStatusChange]);

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
          <LinearIcon className={`w-4 h-4 ${isConfigured ? "text-[#5E6AD2]" : text.muted}`} />
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

          <DataLifecycleSection dataLifecycle={lifecycle} onChange={setLifecycle} />

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

import { AGENT_CONFIGS, type AgentId, type McpScope } from "../agent-configs";

function CodingAgentsCard() {
  const api = useApi();
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("claude");
  const [scope, setScope] = useState<McpScope>("global");
  const [copied, setCopied] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, { global?: boolean; project?: boolean }>>(
    {},
  );
  const [settingUp, setSettingUp] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );

  const agent = AGENT_CONFIGS.find((a) => a.id === selectedAgent)!;
  const scopeConfig = agent[scope];
  const isConfigured = statuses[selectedAgent]?.[scope] === true;
  const hasGlobal = !!agent.global;
  const hasProject = !!agent.project;

  // Pick a valid scope when agent changes
  useEffect(() => {
    const a = AGENT_CONFIGS.find((c) => c.id === selectedAgent)!;
    if (!a[scope]) {
      setScope(a.global ? "global" : "project");
    }
  }, [selectedAgent, scope]);

  useEffect(() => {
    api.fetchMcpStatus().then((result) => {
      setStatuses(result.statuses);
    });
  }, [api]);

  const handleCopy = async () => {
    if (!scopeConfig) return;
    try {
      await navigator.clipboard.writeText(scopeConfig.config);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  const handleSetup = async () => {
    setSettingUp(true);
    setFeedback(null);
    const result = await api.setupMcpAgent(selectedAgent, scope);
    setSettingUp(false);
    if (result.success) {
      setStatuses((prev) => ({
        ...prev,
        [selectedAgent]: { ...prev[selectedAgent], [scope]: true },
      }));
      setFeedback({ type: "success", message: `Added to ${scopeConfig!.configPath}` });
      setTimeout(() => setFeedback(null), 4000);
    } else {
      setFeedback({ type: "error", message: result.error ?? "Setup failed" });
    }
  };

  const handleRemove = async () => {
    setSettingUp(true);
    setFeedback(null);
    const result = await api.removeMcpAgent(selectedAgent, scope);
    setSettingUp(false);
    if (result.success) {
      setStatuses((prev) => ({
        ...prev,
        [selectedAgent]: { ...prev[selectedAgent], [scope]: false },
      }));
      setFeedback({ type: "success", message: `Removed from ${scopeConfig!.configPath}` });
      setTimeout(() => setFeedback(null), 4000);
    } else {
      setFeedback({ type: "error", message: result.error ?? "Remove failed" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Card header with icon */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-500/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 text-purple-400"
          >
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
        </div>
        <div>
          <h3 className={`text-xs font-semibold ${text.primary}`}>Coding Agents</h3>
          <span className={`text-[10px] text-purple-400`}>MCP Integration</span>
        </div>
      </div>

      <p className={`text-[11px] ${text.dimmed} leading-relaxed`}>
        Connect your AI coding agents to manage issues & worktrees, start/stop dev servers, and
        more.
      </p>

      {/* Agent tabs */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">
          {AGENT_CONFIGS.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setSelectedAgent(a.id);
                setCopied(false);
                setFeedback(null);
              }}
              className={`relative px-2.5 py-1 rounded text-[10px] font-medium transition-colors duration-150 ${
                selectedAgent === a.id
                  ? "text-white bg-white/[0.08]"
                  : `${text.muted} hover:text-[#9ca3af]`
              }`}
            >
              {a.name}
              {(statuses[a.id]?.global || statuses[a.id]?.project) && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          ))}
        </div>

        {/* Scope toggle */}
        {hasGlobal && hasProject && <div className="border-t border-white/[0.06]" />}
        {hasGlobal && hasProject && (
          <div className="flex gap-1">
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setScope(s);
                  setCopied(false);
                  setFeedback(null);
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors duration-150 ${
                  scope === s ? "text-white bg-white/[0.08]" : `${text.muted} hover:text-[#9ca3af]`
                }`}
              >
                {s === "global" ? "Global" : "This project"}
                {statuses[selectedAgent]?.[s] && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 ml-1.5 align-middle" />
                )}
              </button>
            ))}
          </div>
        )}

        {scopeConfig && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] ${text.dimmed}`}>{scopeConfig.configPath}</span>
                {isConfigured && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                    <Check className="w-3 h-3" />
                    Active
                  </span>
                )}
              </div>
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1 text-[10px] ${copied ? "text-accent" : `${text.muted} hover:text-[#9ca3af]`} transition-colors duration-150`}
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <pre
              className={`text-[10px] font-mono ${text.secondary} bg-white/[0.04] border border-white/[0.06] rounded-md p-3 overflow-x-auto`}
            >
              {scopeConfig.config}
            </pre>

            <div className="flex items-center gap-4">
              {feedback && (
                <span
                  className={`text-[11px] ${feedback.type === "success" ? "text-accent" : text.error}`}
                >
                  {feedback.message}
                </span>
              )}
              <div className="flex items-center gap-4 ml-auto">
                {agent.docsUrl && (
                  <a
                    href={agent.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-1 text-[10px] ${text.muted} hover:text-[#9ca3af] transition-colors duration-150`}
                  >
                    View Docs
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {!isConfigured ? (
                  <button
                    onClick={handleSetup}
                    disabled={settingUp}
                    className={`text-[11px] px-3 py-1.5 rounded-md font-medium ${button.primary} disabled:opacity-50 transition-all duration-150 active:scale-[0.98]`}
                  >
                    {settingUp ? (
                      <span className="flex items-center gap-1.5">
                        <Spinner size="xs" />
                        Setting up...
                      </span>
                    ) : (
                      `Setup ${agent.name}`
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleRemove}
                    disabled={settingUp}
                    className={`flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-md font-medium ${button.secondary} disabled:opacity-50 transition-all duration-150 active:scale-[0.98]`}
                  >
                    <Unplug className="w-3 h-3" />
                    Remove
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1.5 pt-1">
        <span className={`text-[10px] font-medium ${settings.label}`}>Available Tools</span>
        <div className="flex flex-wrap gap-1.5">
          {[
            "list_worktrees",
            "create_worktree",
            "start",
            "stop",
            "commit",
            "push",
            "create_pr",
            "get_logs",
          ].map((tool) => (
            <span
              key={tool}
              className={`text-[9px] px-1.5 py-0.5 rounded ${text.secondary} bg-white/[0.06]`}
            >
              {tool}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

interface IntegrationsPanelProps {
  onJiraStatusChange?: () => void;
  onLinearStatusChange?: () => void;
}

const BANNER_DISMISSED_KEY = `${APP_NAME}-integrations-banner-dismissed`;

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
  const [showBanner, setShowBanner] = useState(() => {
    return localStorage.getItem(BANNER_DISMISSED_KEY) !== "true";
  });

  const [currentGithubStatus, setCurrentGithubStatus] = useState<GitHubStatus | null>(null);
  const [currentJiraStatus, setCurrentJiraStatus] = useState<JiraStatus | null>(null);
  const [currentLinearStatus, setCurrentLinearStatus] = useState<LinearStatus | null>(null);

  const dismissBanner = () => {
    setShowBanner(false);
    localStorage.setItem(BANNER_DISMISSED_KEY, "true");
  };

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
    verifyIntegrations(serverUrl).then((result) => {
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
    });
  }, [serverUrl]);

  useEffect(() => {
    if (githubRefreshKey === 0) return;
    fetchGitHubStatus(serverUrl)
      .then((d) => setCurrentGithubStatus(d))
      .catch(() => {});
  }, [githubRefreshKey, serverUrl]);

  useEffect(() => {
    if (jiraRefreshKey === 0) return;
    fetchJiraStatus(serverUrl)
      .then((d) => {
        setCurrentJiraStatus(d);
        onJiraStatusChange?.();
      })
      .catch(() => {});
  }, [jiraRefreshKey, onJiraStatusChange, serverUrl]);

  useEffect(() => {
    if (linearRefreshKey === 0) return;
    fetchLinearStatus(serverUrl)
      .then((d) => {
        setCurrentLinearStatus(d);
        onLinearStatusChange?.();
      })
      .catch(() => {});
  }, [linearRefreshKey, onLinearStatusChange, serverUrl]);

  return (
    <div>
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-8">
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
              <Link2 className={`w-3.5 h-3.5 ${infoBanner.textMuted} flex-shrink-0`} />
              <p className={`text-xs ${text.secondary} leading-relaxed`}>
                Connect external services to enhance your workflow.
              </p>
            </div>
          </div>
        )}
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
        <div className={`rounded-xl ${surface.panel} border border-white/[0.08] p-5`}>
          <CodingAgentsCard />
        </div>
      </div>
    </div>
  );
}
