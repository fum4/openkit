import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  GitCommit,
  Link,
  Loader2,
  LogIn,
  Plug,
  Settings,
  Sparkles,
} from "lucide-react";

import { APP_NAME, CONFIG_DIR_NAME } from "../../constants";
import { useApi } from "../hooks/useApi";
import type { DetectedConfig } from "../hooks/api";
import { fetchGitHubStatus, fetchJiraStatus, fetchLinearStatus } from "../hooks/api";
import { useServerUrlOptional } from "../contexts/ServerContext";
import type { GitHubStatus, JiraStatus, LinearStatus } from "../types";
import { button, input, surface, text } from "../theme";
import { AGENT_CONFIGS, type AgentId, type McpScope } from "../agent-configs";
import { GitHubIcon, JiraIcon, LinearIcon } from "../icons";

interface ProjectSetupScreenProps {
  projectName: string | null;
  onSetupComplete: () => void;
  onRememberChoice?: (choice: "auto" | "manual") => void;
}

type SetupMode =
  | "choice"
  | "manual"
  | "agents"
  | "commit-prompt"
  | "integrations"
  | "getting-started";

const ONBOARDING_SKILL_NAME = "work-on-task";
const SKILL_SETUP_SUPPORTED_AGENTS = new Set<AgentId>([
  "claude",
  "codex",
  "cursor",
  "gemini",
  "vscode",
]);

export function ProjectSetupScreen({
  projectName,
  onSetupComplete,
  onRememberChoice,
}: ProjectSetupScreenProps) {
  const api = useApi();
  const serverUrl = useServerUrlOptional();
  const [mode, setMode] = useState<SetupMode>("choice");
  const [rememberChoice, setRememberChoice] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GitHub status for commit-prompt step
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null);
  const [ghLoading, setGhLoading] = useState(false);
  const [ghWaitingForAuth, setGhWaitingForAuth] = useState(false);
  const ghPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch GitHub status when entering commit-prompt
  useEffect(() => {
    if (mode !== "commit-prompt") return;
    fetchGitHubStatus(serverUrl).then(setGhStatus);
  }, [mode, serverUrl]);

  // Poll for auth completion
  useEffect(() => {
    if (!ghWaitingForAuth) {
      if (ghPollRef.current) clearInterval(ghPollRef.current);
      return;
    }
    ghPollRef.current = setInterval(async () => {
      const data = await fetchGitHubStatus(serverUrl);
      if (data?.authenticated && data.username) {
        setGhWaitingForAuth(false);
        setGhStatus(data);
      }
    }, 2000);
    return () => {
      if (ghPollRef.current) clearInterval(ghPollRef.current);
    };
  }, [ghWaitingForAuth, serverUrl]);

  const handleInstallGh = useCallback(async () => {
    setGhLoading(true);
    setError(null);
    const result = await api.installGitHubCli();
    setGhLoading(false);
    if (result.success) {
      if (result.code) {
        try {
          await navigator.clipboard.writeText(result.code);
        } catch {
          /* ignore */
        }
        setError(
          `Code ${result.code} copied to clipboard! Paste it in your browser to authenticate.`,
        );
        setGhWaitingForAuth(true);
      }
      // Refresh status
      const data = await fetchGitHubStatus(serverUrl);
      setGhStatus(data);
    } else {
      setError(result.error ?? "Failed to install gh CLI");
    }
  }, [api, serverUrl]);

  const handleLoginGh = useCallback(async () => {
    setGhLoading(true);
    setError(null);
    const result = await api.loginGitHub();
    setGhLoading(false);
    if (result.success && result.code) {
      try {
        await navigator.clipboard.writeText(result.code);
      } catch {
        /* ignore */
      }
      setError(
        `Code ${result.code} copied to clipboard! Paste it in your browser to authenticate.`,
      );
      setGhWaitingForAuth(true);
    } else if (!result.success) {
      setError(result.error ?? "Failed to authenticate");
    }
  }, [api]);

  // Form values for manual setup
  const [detectedConfig, setDetectedConfig] = useState<DetectedConfig | null>(null);
  const [formValues, setFormValues] = useState<DetectedConfig>({
    baseBranch: "origin/main",
    startCommand: "npm run dev",
    installCommand: "npm install",
  });
  const [showAll, setShowAll] = useState(false);
  const [extraValues, setExtraValues] = useState({
    projectDir: "",
    autoInstall: true,
    localIssuePrefix: "LOCAL",
  });

  // Commit message for the commit prompt
  const [commitMessage, setCommitMessage] = useState(`chore: initialize ${APP_NAME} configuration`);

  // Agents step state
  const [agentStatuses, setAgentStatuses] = useState<
    Record<string, { global?: boolean; project?: boolean }>
  >({});
  const [agentDesired, setAgentDesired] = useState<
    Record<string, { global: boolean; project: boolean }>
  >({});
  const [agentsApplying, setAgentsApplying] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const hasAnyAgentSelected = useMemo(() => {
    return AGENT_CONFIGS.some((agent) => {
      const desired = agentDesired[agent.id];
      return desired?.global || desired?.project;
    });
  }, [agentDesired]);

  // Integrations step state
  const [expandedIntegration, setExpandedIntegration] = useState<
    "github" | "jira" | "linear" | null
  >(null);
  const [intJiraStatus, setIntJiraStatus] = useState<JiraStatus | null>(null);
  const [intLinearStatus, setIntLinearStatus] = useState<LinearStatus | null>(null);
  const [intGhStatus, setIntGhStatus] = useState<GitHubStatus | null>(null);
  const [intGhWaiting, setIntGhWaiting] = useState(false);
  const intGhPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Jira setup form
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraSaving, setJiraSaving] = useState(false);
  const [jiraFeedback, setJiraFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  // Linear setup form
  const [linearApiKey, setLinearApiKey] = useState("");
  const [linearSaving, setLinearSaving] = useState(false);
  const [linearFeedback, setLinearFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  // GitHub setup in integrations
  const [intGhLoading, setIntGhLoading] = useState(false);
  const [intGhFeedback, setIntGhFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Fetch all integration statuses when entering integrations step
  useEffect(() => {
    if (mode !== "integrations") return;
    fetchGitHubStatus(serverUrl).then(setIntGhStatus);
    fetchJiraStatus(serverUrl).then(setIntJiraStatus);
    fetchLinearStatus(serverUrl).then(setIntLinearStatus);
  }, [mode, serverUrl]);

  // Poll for GitHub auth in integrations step
  useEffect(() => {
    if (!intGhWaiting) {
      if (intGhPollRef.current) clearInterval(intGhPollRef.current);
      return;
    }
    intGhPollRef.current = setInterval(async () => {
      const data = await fetchGitHubStatus(serverUrl);
      if (data?.authenticated && data.username) {
        setIntGhWaiting(false);
        setIntGhStatus(data);
        setIntGhFeedback(null);
        setTimeout(() => setIntGhFeedback(null), 4000);
      }
    }, 2000);
    return () => {
      if (intGhPollRef.current) clearInterval(intGhPollRef.current);
    };
  }, [intGhWaiting, serverUrl]);

  const handleIntGhConnect = useCallback(async () => {
    setIntGhLoading(true);
    setIntGhFeedback(null);
    const result = await api.installGitHubCli();
    setIntGhLoading(false);
    if (result.success) {
      if (result.code) {
        try {
          await navigator.clipboard.writeText(result.code);
        } catch {
          /* ignore */
        }
        setIntGhFeedback({
          type: "success",
          message: `Code ${result.code} copied! Paste it in your browser.`,
        });
        setIntGhWaiting(true);
      }
      const data = await fetchGitHubStatus(serverUrl);
      setIntGhStatus(data);
    } else {
      setIntGhFeedback({ type: "error", message: result.error ?? "Failed to install gh CLI" });
    }
  }, [api, serverUrl]);

  const handleIntGhLogin = useCallback(async () => {
    setIntGhLoading(true);
    setIntGhFeedback(null);
    const result = await api.loginGitHub();
    setIntGhLoading(false);
    if (result.success && result.code) {
      try {
        await navigator.clipboard.writeText(result.code);
      } catch {
        /* ignore */
      }
      setIntGhFeedback({
        type: "success",
        message: `Code ${result.code} copied! Paste it in your browser.`,
      });
      setIntGhWaiting(true);
    } else if (!result.success) {
      setIntGhFeedback({ type: "error", message: result.error ?? "Failed to start login" });
    }
  }, [api]);

  const handleJiraConnect = useCallback(async () => {
    if (!jiraBaseUrl || !jiraEmail || !jiraToken) return;
    setJiraSaving(true);
    setJiraFeedback(null);
    const result = await api.setupJira(jiraBaseUrl, jiraEmail, jiraToken);
    setJiraSaving(false);
    if (result.success) {
      setJiraFeedback(null);
      setJiraBaseUrl("");
      setJiraEmail("");
      setJiraToken("");
      fetchJiraStatus(serverUrl).then(setIntJiraStatus);
    } else {
      setJiraFeedback({ type: "error", message: result.error ?? "Failed to connect" });
    }
    setTimeout(() => setJiraFeedback(null), 4000);
  }, [api, jiraBaseUrl, jiraEmail, jiraToken, serverUrl]);

  const handleLinearConnect = useCallback(async () => {
    if (!linearApiKey) return;
    setLinearSaving(true);
    setLinearFeedback(null);
    const result = await api.setupLinear(linearApiKey);
    setLinearSaving(false);
    if (result.success) {
      setLinearFeedback(null);
      setLinearApiKey("");
      fetchLinearStatus(serverUrl).then(setIntLinearStatus);
    } else {
      setLinearFeedback({ type: "error", message: result.error ?? "Failed to connect" });
    }
    setTimeout(() => setLinearFeedback(null), 4000);
  }, [api, linearApiKey, serverUrl]);

  // Load detected config on mount
  useEffect(() => {
    api.detectConfig().then((result) => {
      if (result.success && result.config) {
        setDetectedConfig(result.config);
        setFormValues(result.config);
      }
    });
  }, []);

  // Fetch current work-on-task skill deployment status when entering agents step
  useEffect(() => {
    if (mode === "agents") {
      api.fetchSkillDeploymentStatus().then((result) => {
        const skillStatus = result.status?.[ONBOARDING_SKILL_NAME];
        const desired: Record<string, { global: boolean; project: boolean }> = {};
        for (const agent of AGENT_CONFIGS) {
          const status = skillStatus?.agents?.[agent.id];
          desired[agent.id] = {
            global: status?.global === true,
            project: status?.project === true,
          };
        }
        setAgentStatuses(desired);
        setAgentDesired(desired);
      });
    }
  }, [mode]);

  const handleAutoSetup = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await api.initConfig({ force: true });
      if (result.success) {
        if (rememberChoice) {
          onRememberChoice?.("auto");
        }
        setMode("agents");
      } else {
        setError(result.error ?? "Failed to initialize config");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to initialize config");
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualSetup = () => {
    setMode("manual");
  };

  const handleManualSubmit = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await api.initConfig({ ...formValues, ...extraValues, force: true });
      if (result.success) {
        if (rememberChoice) {
          onRememberChoice?.("manual");
        }
        setMode("agents");
      } else {
        setError(result.error ?? "Failed to initialize config");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to initialize config");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setMode("choice");
    setError(null);
  };

  const handleBackTo = (nextMode: SetupMode) => {
    setMode(nextMode);
    setError(null);
  };

  const handleAgentsSetup = async () => {
    const changes: { agentId: AgentId; scope: McpScope; action: "setup" | "remove" }[] = [];

    for (const agent of AGENT_CONFIGS) {
      if (!SKILL_SETUP_SUPPORTED_AGENTS.has(agent.id)) continue;
      const desired = agentDesired[agent.id];
      const current = agentStatuses[agent.id];
      if (!desired) continue;

      for (const scope of ["global", "project"] as McpScope[]) {
        const wantEnabled = desired[scope];
        const isEnabled = current?.[scope] === true;
        if (wantEnabled && !isEnabled) changes.push({ agentId: agent.id, scope, action: "setup" });
        if (!wantEnabled && isEnabled) changes.push({ agentId: agent.id, scope, action: "remove" });
      }
    }

    if (changes.length === 0) {
      setMode("commit-prompt");
      return;
    }

    setAgentsApplying(true);
    setAgentsError(null);

    const errors: string[] = [];
    for (const { agentId, scope, action } of changes) {
      // Legacy MCP onboarding path kept intentionally; do not run here.
      // const result =
      //   action === "setup"
      //     ? await api.setupMcpAgent(agentId, scope)
      //     : await api.removeMcpAgent(agentId, scope);
      const result =
        action === "setup"
          ? await api.deploySkill(ONBOARDING_SKILL_NAME, agentId, scope)
          : await api.undeploySkill(ONBOARDING_SKILL_NAME, agentId, scope);
      if (!result.success) {
        const agent = AGENT_CONFIGS.find((a) => a.id === agentId)!;
        errors.push(`${agent.name} (${scope}): ${result.error ?? "failed"}`);
      }
    }

    setAgentsApplying(false);

    if (errors.length > 0) {
      setAgentsError(errors.join(", "));
    } else {
      setMode("commit-prompt");
    }
  };

  const handleCommitConfig = async () => {
    if (!commitMessage.trim()) {
      setError("Commit message is required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.commitSetup(commitMessage.trim());
      if (result.success) {
        setMode("integrations");
      } else {
        setError(result.error ?? "Failed to commit config");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to commit config");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkipCommit = () => {
    setMode("integrations");
  };

  if (mode === "integrations") {
    const integrationInput = `w-full px-2.5 py-1.5 rounded-md text-xs bg-white/[0.03] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.05] focus:border-white/[0.12] transition-all`;
    const ghReady = intGhStatus?.installed && intGhStatus?.authenticated;
    const ghNeedsInstall = intGhStatus && !intGhStatus.installed;
    const ghNeedsAuth = intGhStatus && intGhStatus.installed && !intGhStatus.authenticated;
    const jiraConfigured = intJiraStatus?.configured ?? false;
    const linearConfigured = intLinearStatus?.configured ?? false;

    const connectedCount = [ghReady, jiraConfigured, linearConfigured].filter(Boolean).length;

    const integrations: {
      id: "github" | "jira" | "linear";
      name: string;
      description: string;
      color: string;
      colorBg: string;
      borderColor: string;
      connected: boolean;
      connectedLabel?: string;
      icon: React.ReactNode;
    }[] = [
      {
        id: "github",
        name: "GitHub",
        description: "Commits, pushes, and pull requests",
        color: "text-[#2dd4bf]",
        colorBg: "bg-[#2dd4bf]/10",
        borderColor: "border-[#2dd4bf]/30",
        connected: !!ghReady,
        connectedLabel: intGhStatus?.username ? `@${intGhStatus.username}` : undefined,
        icon: <GitHubIcon className="w-[18px] h-[18px]" />,
      },
      {
        id: "jira",
        name: "Jira",
        description: "Create worktrees from Jira issues",
        color: "text-blue-400",
        colorBg: "bg-blue-500/10",
        borderColor: "border-blue-400/30",
        connected: jiraConfigured,
        connectedLabel: intJiraStatus?.domain ?? undefined,
        icon: <JiraIcon className="w-[18px] h-[18px]" />,
      },
      {
        id: "linear",
        name: "Linear",
        description: "Create worktrees from Linear issues",
        color: "text-[#5E6AD2]",
        colorBg: "bg-[#5E6AD2]/10",
        borderColor: "border-[#5E6AD2]/30",
        connected: linearConfigured,
        connectedLabel: intLinearStatus?.displayName ?? undefined,
        icon: <LinearIcon className="w-[18px] h-[18px]" />,
      },
    ];

    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-lg w-full">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-[#5E6AD2]/10 mb-4">
              <Link className="w-8 h-8 text-blue-400" />
            </div>
            <h1 className={`text-xl font-semibold ${text.primary} mb-2`}>Connect Integrations</h1>
            <p className={`text-sm ${text.secondary} leading-relaxed`}>
              Link your tools to create worktrees directly from issues
              <br />
              and enable git operations.
            </p>
          </div>

          <div className="space-y-3 mb-6">
            {integrations.map((integration) => {
              const isExpanded = expandedIntegration === integration.id;
              const isConnected = integration.connected;

              return (
                <div
                  key={integration.id}
                  className={`rounded-xl ${surface.panel} border transition-all duration-200 overflow-hidden ${
                    isExpanded
                      ? "border-white/[0.12]"
                      : isConnected
                        ? "border-white/[0.08]"
                        : "border-white/[0.08] hover:border-white/[0.12]"
                  }`}
                >
                  {/* Card header — always visible */}
                  <button
                    onClick={() => setExpandedIntegration(isExpanded ? null : integration.id)}
                    className="flex items-center gap-3.5 w-full p-4 text-left group"
                  >
                    <div
                      className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${isConnected ? integration.colorBg : "bg-white/[0.04]"} transition-colors`}
                    >
                      <span className={isConnected ? integration.color : text.muted}>
                        {integration.icon}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className={`text-sm font-medium ${text.primary}`}>
                          {integration.name}
                        </h3>
                        {isConnected && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                            <Check className="w-3 h-3" />
                            Connected
                          </span>
                        )}
                      </div>
                      <p className={`text-xs ${text.muted} leading-relaxed truncate`}>
                        {isConnected && integration.connectedLabel
                          ? integration.connectedLabel
                          : integration.description}
                      </p>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 ${text.dimmed} transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {/* Expanded setup form */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0">
                      <div className="border-t border-white/[0.06] pt-4">
                        {/* GitHub */}
                        {integration.id === "github" && (
                          <>
                            {isConnected ? (
                              <div className="flex flex-col gap-2 text-left">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
                                  <span className={`text-xs ${text.secondary}`}>
                                    Authenticated as{" "}
                                    <span className="font-medium text-white">
                                      {intGhStatus?.username}
                                    </span>
                                  </span>
                                </div>
                                {intGhStatus?.repo && (
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
                                    <span className={`text-xs ${text.secondary}`}>
                                      {intGhStatus.repo}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : ghNeedsInstall ? (
                              <div className="flex flex-col gap-3 text-left">
                                <p className={`text-xs ${text.muted} leading-relaxed`}>
                                  Install the GitHub CLI to enable commits, pushes, and pull
                                  requests.
                                </p>
                                <button
                                  onClick={handleIntGhConnect}
                                  disabled={intGhLoading}
                                  className={`text-xs px-3.5 py-2 rounded-lg font-medium ${button.primary} disabled:opacity-50 self-start transition-all flex items-center gap-2`}
                                >
                                  {intGhLoading ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      Installing...
                                    </>
                                  ) : (
                                    <>
                                      <Download className="w-3.5 h-3.5" />
                                      Install & Connect
                                    </>
                                  )}
                                </button>
                              </div>
                            ) : ghNeedsAuth ? (
                              <div className="flex flex-col gap-3 text-left">
                                <p className={`text-xs ${text.muted} leading-relaxed`}>
                                  Authenticate with GitHub to enable git operations.
                                </p>
                                <button
                                  onClick={handleIntGhLogin}
                                  disabled={intGhLoading}
                                  className={`text-xs px-3.5 py-2 rounded-lg font-medium ${button.primary} disabled:opacity-50 self-start transition-all flex items-center gap-2`}
                                >
                                  {intGhLoading ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      Authenticating...
                                    </>
                                  ) : (
                                    <>
                                      <LogIn className="w-3.5 h-3.5" />
                                      Authenticate
                                    </>
                                  )}
                                </button>
                              </div>
                            ) : intGhWaiting ? (
                              <div className="flex items-center justify-center gap-2 py-2">
                                <Loader2 className="w-4 h-4 animate-spin text-[#2dd4bf]" />
                                <span className={`text-xs ${text.secondary}`}>
                                  Waiting for authentication...
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-2 py-2">
                                <Loader2 className="w-4 h-4 animate-spin text-[#2dd4bf]" />
                                <span className={`text-xs ${text.muted}`}>Loading...</span>
                              </div>
                            )}
                            {intGhFeedback && (
                              <p
                                className={`mt-2 text-xs ${intGhFeedback.type === "success" ? "text-[#2dd4bf]" : text.error}`}
                              >
                                {intGhFeedback.message}
                              </p>
                            )}
                          </>
                        )}

                        {/* Jira */}
                        {integration.id === "jira" && (
                          <>
                            {isConnected ? (
                              <div className="flex flex-col gap-2 text-left">
                                {intJiraStatus?.domain && (
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
                                    <span className={`text-xs ${text.secondary}`}>
                                      {intJiraStatus.domain}
                                    </span>
                                  </div>
                                )}
                                {intJiraStatus?.email && (
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
                                    <span className={`text-xs ${text.secondary}`}>
                                      {intJiraStatus.email}
                                    </span>
                                  </div>
                                )}
                                <p className={`text-[11px] ${text.dimmed} mt-1`}>
                                  You can configure project key and refresh settings in the
                                  Integrations panel later.
                                </p>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-3 text-left">
                                <div className="flex flex-col gap-1.5">
                                  <label className={`text-[10px] font-medium ${text.muted}`}>
                                    Base URL
                                  </label>
                                  <input
                                    value={jiraBaseUrl}
                                    onChange={(e) => setJiraBaseUrl(e.target.value)}
                                    placeholder="https://your-org.atlassian.net"
                                    className={integrationInput}
                                  />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <label className={`text-[10px] font-medium ${text.muted}`}>
                                    Email
                                  </label>
                                  <input
                                    value={jiraEmail}
                                    onChange={(e) => setJiraEmail(e.target.value)}
                                    placeholder="you@company.com"
                                    className={integrationInput}
                                  />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <label className={`text-[10px] font-medium ${text.muted}`}>
                                    API Token
                                  </label>
                                  <div className="relative">
                                    <input
                                      type="password"
                                      value={jiraToken}
                                      onChange={(e) => setJiraToken(e.target.value)}
                                      placeholder="Your Jira API token"
                                      className={`${integrationInput} pr-16`}
                                    />
                                    <a
                                      href="https://id.atlassian.com/manage-profile/security/api-tokens"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={`absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] font-medium bg-white/[0.06] ${text.muted} hover:bg-white/[0.10] hover:text-white rounded transition-colors`}
                                    >
                                      Create
                                    </a>
                                  </div>
                                </div>
                                <button
                                  onClick={handleJiraConnect}
                                  disabled={jiraSaving || !jiraBaseUrl || !jiraEmail || !jiraToken}
                                  className={`text-xs px-3.5 py-2 rounded-lg font-medium ${button.primary} disabled:opacity-50 self-start transition-all flex items-center gap-2`}
                                >
                                  {jiraSaving ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      Connecting...
                                    </>
                                  ) : (
                                    "Connect"
                                  )}
                                </button>
                              </div>
                            )}
                            {jiraFeedback && (
                              <p
                                className={`mt-2 text-xs ${jiraFeedback.type === "success" ? "text-blue-400" : text.error}`}
                              >
                                {jiraFeedback.message}
                              </p>
                            )}
                          </>
                        )}

                        {/* Linear */}
                        {integration.id === "linear" && (
                          <>
                            {isConnected ? (
                              <div className="flex flex-col gap-2 text-left">
                                {intLinearStatus?.displayName && (
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
                                    <span className={`text-xs ${text.secondary}`}>
                                      {intLinearStatus.displayName}
                                    </span>
                                  </div>
                                )}
                                <p className={`text-[11px] ${text.dimmed} mt-1`}>
                                  You can configure team key and refresh settings in the
                                  Integrations panel later.
                                </p>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-3 text-left">
                                <div className="flex flex-col gap-1.5">
                                  <label className={`text-[10px] font-medium ${text.muted}`}>
                                    API Key
                                  </label>
                                  <div className="relative">
                                    <input
                                      type="password"
                                      value={linearApiKey}
                                      onChange={(e) => setLinearApiKey(e.target.value)}
                                      placeholder="lin_api_..."
                                      className={`${integrationInput} pr-16`}
                                    />
                                    <a
                                      href="https://linear.app/settings/account/security/api-keys/new"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={`absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] font-medium bg-white/[0.06] ${text.muted} hover:bg-white/[0.10] hover:text-white rounded transition-colors`}
                                    >
                                      Create
                                    </a>
                                  </div>
                                </div>
                                <button
                                  onClick={handleLinearConnect}
                                  disabled={linearSaving || !linearApiKey}
                                  className={`text-xs px-3.5 py-2 rounded-lg font-medium ${button.primary} disabled:opacity-50 self-start transition-all flex items-center gap-2`}
                                >
                                  {linearSaving ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      Connecting...
                                    </>
                                  ) : (
                                    "Connect"
                                  )}
                                </button>
                              </div>
                            )}
                            {linearFeedback && (
                              <p
                                className={`mt-2 text-xs ${linearFeedback.type === "success" ? "text-[#5E6AD2]" : text.error}`}
                              >
                                {linearFeedback.message}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

            <div className="space-y-3">
            <button
              onClick={() => setMode("getting-started")}
              className={`group w-full px-4 py-2.5 text-sm font-medium ${button.primary} rounded-xl transition-colors flex items-center justify-center`}
            >
              <AnimatedContinuePrimaryLabel
                label={connectedCount > 0 ? "Continue" : "Continue without integrations"}
              />
            </button>
            {connectedCount === 0 && (
              <p className={`text-[11px] ${text.dimmed}`}>
                You can always connect integrations later from the Integrations panel.
              </p>
            )}
              <button
                onClick={() => handleBackTo("commit-prompt")}
                className="w-full"
              >
                <AnimatedBackLabel />
              </button>
            </div>
        </div>
      </div>
    );
  }

  if (mode === "getting-started") {
    // Build a summary of what was configured during setup
    const configuredItems: { label: string; color: string }[] = [];
    if (intGhStatus?.authenticated)
      configuredItems.push({ label: "GitHub", color: "text-[#2dd4bf]" });
    if (intJiraStatus?.configured) configuredItems.push({ label: "Jira", color: "text-blue-400" });
    if (intLinearStatus?.configured)
      configuredItems.push({ label: "Linear", color: "text-[#5E6AD2]" });

    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md w-full">
          <div className="mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-[#2dd4bf]/20 to-[#2dd4bf]/5 mb-5">
              <Check className="w-10 h-10 text-[#2dd4bf]" />
            </div>
            <h1 className={`text-2xl font-semibold ${text.primary} mb-2`}>You're all set!</h1>
            <p className={`text-sm ${text.secondary} leading-relaxed`}>
              Your project is configured and ready to go.
            </p>
          </div>

          {configuredItems.length > 0 && (
            <div className="mb-8">
              <p className={`text-xs font-medium ${text.muted} mb-3`}>Connected integrations</p>
              <div className="flex items-center justify-center gap-2">
                {configuredItems.map((item) => (
                  <span
                    key={item.label}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${item.color} bg-white/[0.06]`}
                  >
                    <Check className="w-3 h-3" />
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onSetupComplete}
            className={`group w-full py-3 rounded-xl text-sm font-medium ${button.primary} transition-colors flex items-center justify-center`}
          >
            <AnimatedContinuePrimaryLabel label="Go to workspace" />
          </button>
          <button
            onClick={() => handleBackTo("integrations")}
            className="w-full mt-3"
          >
            <AnimatedBackLabel />
          </button>
        </div>
      </div>
    );
  }

  if (mode === "agents") {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md w-full">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-500/5 mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-8 h-8 text-purple-400"
              >
                <path d="M12 8V4H8" />
                <rect width="16" height="12" x="4" y="8" rx="2" />
                <path d="M2 14h2" />
                <path d="M20 14h2" />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
              </svg>
            </div>
            <h1 className={`text-xl font-semibold ${text.primary} mb-2`}>Connect Coding Agents</h1>
            <p className={`text-sm ${text.secondary} leading-relaxed`}>
              Enable the <span className="font-mono">{ONBOARDING_SKILL_NAME}</span> skill so your agents can
              <br />
              run the openkit task workflow automatically.
            </p>
          </div>

          <div className="space-y-2 mb-6">
            {AGENT_CONFIGS.map((agent) => {
              const desired = agentDesired[agent.id];
              const globalOn = desired?.global ?? false;
              const projectOn = desired?.project ?? false;

              return (
                <div
                  key={agent.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg ${surface.panel} border border-white/[0.08]`}
                >
                  <span className={`text-xs font-medium ${text.primary} flex-1 text-left`}>
                    {agent.name}
                  </span>
                  <button
                    onClick={() =>
                      setAgentDesired((prev) => ({
                        ...prev,
                        [agent.id]: { ...prev[agent.id], global: !globalOn },
                      }))
                    }
                    disabled={
                      agentsApplying ||
                      !agent.global ||
                      !SKILL_SETUP_SUPPORTED_AGENTS.has(agent.id)
                    }
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      globalOn
                        ? "bg-[#2dd4bf]/10 hover:bg-[#2dd4bf]/15"
                        : "bg-white/[0.03] hover:bg-white/[0.06]"
                    } disabled:opacity-40`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${globalOn ? "bg-[#2dd4bf]" : "bg-white/[0.15]"}`}
                    />
                    <span className={globalOn ? "text-[#2dd4bf]" : text.dimmed}>Global</span>
                  </button>
                  <button
                    onClick={() =>
                      setAgentDesired((prev) => ({
                        ...prev,
                        [agent.id]: { ...prev[agent.id], project: !projectOn },
                      }))
                    }
                    disabled={
                      agentsApplying ||
                      !agent.project ||
                      !SKILL_SETUP_SUPPORTED_AGENTS.has(agent.id)
                    }
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      projectOn
                        ? "bg-[#2dd4bf]/10 hover:bg-[#2dd4bf]/15"
                        : "bg-white/[0.03] hover:bg-white/[0.06]"
                    } disabled:opacity-40`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${projectOn ? "bg-[#2dd4bf]" : "bg-white/[0.15]"}`}
                    />
                    <span className={projectOn ? "text-[#2dd4bf]" : text.dimmed}>Project</span>
                  </button>
                </div>
              );
            })}
          </div>

          {agentsError && <p className={`mb-4 text-xs ${text.error}`}>{agentsError}</p>}

          <div className="space-y-3">
            <button
              onClick={handleAgentsSetup}
              disabled={agentsApplying || !hasAnyAgentSelected}
              className={`group w-full px-4 py-2.5 text-sm font-medium ${button.primary} rounded-lg disabled:opacity-50 transition-colors flex items-center justify-center`}
            >
              {agentsApplying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enabling...
                </>
              ) : (
                <AnimatedConnectPrimaryLabel />
              )}
            </button>
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={() => setMode("commit-prompt")}
                disabled={agentsApplying}
                className="px-4 py-2"
              >
                <AnimatedSkipLabel />
              </button>
              <button
                onClick={() => handleBackTo("choice")}
                disabled={agentsApplying}
                className="px-4 py-2"
              >
                <AnimatedBackLabel />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "commit-prompt") {
    const needsGhInstall = ghStatus && !ghStatus.installed;
    const needsGhAuth = ghStatus && ghStatus.installed && !ghStatus.authenticated;
    const ghReady = ghStatus?.installed && ghStatus?.authenticated;

    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#2dd4bf]/20 to-[#2dd4bf]/5 mb-4">
              <Check className="w-8 h-8 text-[#2dd4bf]" />
            </div>
            <h1 className={`text-xl font-semibold ${text.primary} mb-2`}>Configuration Created</h1>
            <p className={`text-sm ${text.secondary} leading-relaxed`}>
              Your project is now configured. Commit and push the configuration
              <br />
              so it's available in all worktrees.
            </p>
          </div>

          {/* GitHub CLI not installed */}
          {needsGhInstall && !ghWaitingForAuth && (
            <div
              className={`${surface.panel} rounded-xl border border-white/[0.08] p-5 mb-6 text-left`}
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-orange-400/10">
                  <Download className="w-5 h-5 text-orange-400" />
                </div>
                <div className="flex-1">
                  <h3 className={`text-sm font-medium ${text.primary} mb-1`}>
                    GitHub CLI required
                  </h3>
                  <p className={`text-xs ${text.muted} leading-relaxed`}>
                    The GitHub CLI is needed to commit and push your configuration. It will be
                    installed via Homebrew.
                  </p>
                </div>
              </div>
              <button
                onClick={handleInstallGh}
                disabled={ghLoading}
                className={`w-full mt-4 px-4 py-2.5 text-sm font-medium ${button.primary} rounded-lg disabled:opacity-50 transition-colors flex items-center justify-center gap-2`}
              >
                {ghLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Install & Connect
                  </>
                )}
              </button>
            </div>
          )}

          {/* GitHub CLI installed but not authenticated */}
          {needsGhAuth && !ghWaitingForAuth && (
            <div
              className={`${surface.panel} rounded-xl border border-white/[0.08] p-5 mb-6 text-left`}
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-orange-400/10">
                  <LogIn className="w-5 h-5 text-orange-400" />
                </div>
                <div className="flex-1">
                  <h3 className={`text-sm font-medium ${text.primary} mb-1`}>
                    GitHub authentication needed
                  </h3>
                  <p className={`text-xs ${text.muted} leading-relaxed`}>
                    Authenticate with GitHub to enable commits, pushes, and pull requests.
                  </p>
                </div>
              </div>
              <button
                onClick={handleLoginGh}
                disabled={ghLoading}
                className={`w-full mt-4 px-4 py-2.5 text-sm font-medium ${button.primary} rounded-lg disabled:opacity-50 transition-colors flex items-center justify-center gap-2`}
              >
                {ghLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Authenticate
                  </>
                )}
              </button>
            </div>
          )}

          {/* Waiting for auth callback */}
          {ghWaitingForAuth && (
            <div className={`${surface.panel} rounded-xl border border-white/[0.08] p-5 mb-6`}>
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-[#2dd4bf]" />
                <span className={`text-xs ${text.secondary}`}>Waiting for authentication...</span>
              </div>
              {error && <p className="mt-2 text-xs text-[#2dd4bf]">{error}</p>}
            </div>
          )}

          {/* Ready to commit */}
          {ghReady && !ghWaitingForAuth && (
            <>
              <div
                className={`${surface.panel} rounded-xl border border-white/[0.08] p-4 mb-4 text-left`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <GitCommit className="w-4 h-4 text-[#2dd4bf]" />
                  <span className={`text-xs font-medium ${text.primary}`}>Files to commit:</span>
                </div>
                <div className={`text-xs ${text.muted} font-mono space-y-1`}>
                  <div>{CONFIG_DIR_NAME}/config.json</div>
                  <div>{CONFIG_DIR_NAME}/.gitignore</div>
                </div>
              </div>

              <div className="mb-6 text-left">
                <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>
                  Commit message
                </label>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && commitMessage.trim()) handleCommitConfig();
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.05] focus:border-white/[0.12] transition-all text-xs`}
                />
              </div>
            </>
          )}

          {/* Error (non-auth) */}
          {error && !ghWaitingForAuth && <p className={`mb-4 text-xs ${text.error}`}>{error}</p>}

          <div className="space-y-3">
            {ghReady && !ghWaitingForAuth && (
              <button
                onClick={handleCommitConfig}
                disabled={isLoading || !commitMessage.trim()}
                className={`group w-full px-4 py-2.5 text-sm font-medium ${button.primary} rounded-lg disabled:opacity-50 transition-colors flex items-center justify-center`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Pushing...
                  </>
                ) : (
                  <AnimatedCommitPrimaryLabel />
                )}
              </button>
            )}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={handleSkipCommit}
                disabled={isLoading}
                className="px-4 py-2"
              >
                <AnimatedSkipLabel />
              </button>
              <button
                onClick={() => handleBackTo("agents")}
                disabled={isLoading}
                className="px-4 py-2"
              >
                <AnimatedBackLabel />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "manual") {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div
          className={`w-full max-w-lg ${surface.panel} rounded-xl shadow-2xl border border-white/[0.08] overflow-hidden`}
        >
          {/* Header */}
          <div className="flex items-center px-6 py-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white/[0.06]">
                <Settings className="w-5 h-5 text-[#9ca3af]" />
              </div>
              <h2 className={`text-sm font-medium ${text.primary}`}>Configure Project</h2>
            </div>
          </div>

          {/* Form */}
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>
                Base branch
              </label>
              <input
                type="text"
                value={formValues.baseBranch}
                onChange={(e) => setFormValues({ ...formValues, baseBranch: e.target.value })}
                className={`w-full px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.05] focus:border-white/[0.12] transition-all text-xs`}
                placeholder="origin/main"
              />
              <p className={`mt-1 text-[11px] ${text.dimmed}`}>
                New worktrees will be created from this branch
              </p>
            </div>

            <div>
              <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>
                Start command
              </label>
              <input
                type="text"
                value={formValues.startCommand}
                onChange={(e) => setFormValues({ ...formValues, startCommand: e.target.value })}
                className={`w-full px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.05] focus:border-white/[0.12] transition-all text-xs`}
                placeholder="npm run dev"
              />
              <p className={`mt-1 text-[11px] ${text.dimmed}`}>Command to start the dev server</p>
            </div>

            <div>
              <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>
                Install command
              </label>
              <input
                type="text"
                value={formValues.installCommand}
                onChange={(e) => setFormValues({ ...formValues, installCommand: e.target.value })}
                className={`w-full px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.05] focus:border-white/[0.12] transition-all text-xs`}
                placeholder="npm install"
              />
              <p className={`mt-1 text-[11px] ${text.dimmed}`}>
                Command to install dependencies in new worktrees
              </p>
            </div>

            {/* Show all toggle */}
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className={`flex items-center gap-1.5 text-[11px] ${text.muted} hover:${text.secondary} transition-colors`}
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-150 ${showAll ? "rotate-180" : ""}`}
              />
              {showAll ? "Show less" : "Show all options"}
            </button>

            {showAll && (
              <>
                <div>
                  <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>
                    Project directory
                  </label>
                  <input
                    type="text"
                    value={extraValues.projectDir}
                    onChange={(e) => setExtraValues({ ...extraValues, projectDir: e.target.value })}
                    className={`w-full px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.05] focus:border-white/[0.12] transition-all text-xs`}
                    placeholder="(root)"
                  />
                  <p className={`mt-1 text-[11px] ${text.dimmed}`}>
                    Subdirectory to run commands in (leave empty for project root)
                  </p>
                </div>

                <div>
                  <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>
                    Local issue prefix
                  </label>
                  <input
                    type="text"
                    value={extraValues.localIssuePrefix}
                    onChange={(e) =>
                      setExtraValues({ ...extraValues, localIssuePrefix: e.target.value })
                    }
                    className={`w-full px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.05] focus:border-white/[0.12] transition-all text-xs`}
                    placeholder="LOCAL"
                  />
                  <p className={`mt-1 text-[11px] ${text.dimmed}`}>
                    Prefix for local issue identifiers (e.g. LOCAL-1). Leave empty for number only.
                  </p>
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer group py-1">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={extraValues.autoInstall}
                      onChange={(e) =>
                        setExtraValues({ ...extraValues, autoInstall: e.target.checked })
                      }
                      className="sr-only"
                    />
                    <div
                      className={`
                      w-4 h-4 rounded border transition-all duration-150
                      ${
                        extraValues.autoInstall
                          ? "bg-[#2dd4bf]/20 border-[#2dd4bf]/50"
                          : "bg-white/[0.04] border-white/[0.1] group-hover:border-white/[0.2]"
                      }
                    `}
                    >
                      {extraValues.autoInstall && (
                        <svg
                          className="w-4 h-4 text-[#2dd4bf]"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 8l3 3 5-6" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div>
                    <span
                      className={`text-xs font-medium ${text.muted} group-hover:${text.secondary} transition-colors`}
                    >
                      Auto-install dependencies
                    </span>
                    <p className={`text-[11px] ${text.dimmed}`}>
                      Automatically run install command when creating worktrees
                    </p>
                  </div>
                </label>
              </>
            )}

            {error && <p className={`text-[11px] ${text.error}`}>{error}</p>}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/[0.06]">
            <button
              onClick={handleBack}
              className="px-3 py-1.5 rounded-lg hover:bg-white/[0.04]"
              disabled={isLoading}
            >
              <AnimatedBackLabel />
            </button>
            <button
              onClick={handleManualSubmit}
              disabled={isLoading}
              className={`px-3 py-1.5 text-xs font-medium ${button.primary} rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Initialize
                </>
              ) : (
                "Initialize"
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Choice mode - show two options
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#2dd4bf]/20 to-[#2dd4bf]/5 mb-4">
            <Settings className="w-8 h-8 text-[#2dd4bf]" />
          </div>
          <h1 className={`text-xl font-semibold ${text.primary} mb-2`}>
            Set up {projectName ?? "this project"}
          </h1>
          <p className={`text-sm ${text.secondary} leading-relaxed`}>
            This project is not configured yet.
            <br />
            Choose how you'd like to set it up.
          </p>
        </div>

        <div className="space-y-3 mb-6">
          {/* Auto-detect option */}
          <button
            onClick={handleAutoSetup}
            disabled={isLoading}
            className={`w-full h-[120px] p-4 rounded-xl ${surface.panel} border border-white/[0.08] hover:border-[#2dd4bf]/30 hover:bg-white/[0.04] transition-all text-left group`}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[#2dd4bf]/10 group-hover:bg-[#2dd4bf]/20 transition-colors">
                <Sparkles className="w-5 h-5 text-[#2dd4bf]" />
              </div>
              <div className="flex-1">
                <h3 className={`text-sm font-medium ${text.primary} mb-1`}>Auto-detect settings</h3>
                <p className={`text-xs ${text.muted} leading-relaxed`}>
                  Automatically detect package manager, commands, and base branch
                </p>
                <div className="mt-1 h-[32px] flex items-center">
                  {detectedConfig ? (
                    <span className="text-[#2dd4bf]/70 text-[11px]">
                      {detectedConfig.startCommand}, {detectedConfig.installCommand},{" "}
                      {detectedConfig.baseBranch}
                    </span>
                  ) : (
                    <span className={`inline-flex items-center gap-1.5 text-[11px] ${text.dimmed}`}>
                      <Loader2 className="w-3 h-3 animate-spin text-[#2dd4bf]/80" />
                      Detecting...
                    </span>
                  )}
                </div>
              </div>
              {isLoading && <Loader2 className="w-5 h-5 text-[#2dd4bf] animate-spin" />}
            </div>
          </button>

          {/* Manual setup option */}
          <button
            onClick={handleManualSetup}
            disabled={isLoading}
            className={`w-full p-4 rounded-xl ${surface.panel} border border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.04] transition-all text-left group`}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-white/[0.06] group-hover:bg-white/[0.1] transition-colors">
                <Settings className="w-5 h-5 text-[#9ca3af]" />
              </div>
              <div className="flex-1">
                <h3 className={`text-sm font-medium ${text.primary} mb-1`}>Manual setup</h3>
                <p className={`text-xs ${text.muted} leading-relaxed`}>
                  Review and customize settings before initialization
                </p>
              </div>
            </div>
          </button>
        </div>

        {/* Remember choice checkbox */}
        {onRememberChoice && (
          <button
            type="button"
            onClick={() => setRememberChoice(!rememberChoice)}
            className="mx-auto flex items-center justify-center gap-2 cursor-pointer group"
          >
            <div
              className={`
              w-4 h-4 rounded border transition-all duration-150
              ${
                rememberChoice
                  ? "bg-[#2dd4bf]/20 border-[#2dd4bf]/50"
                  : "bg-white/[0.04] border-white/[0.1] group-hover:border-white/[0.2]"
              }
            `}
            >
              {rememberChoice && (
                <svg
                  className="w-4 h-4 text-[#2dd4bf]"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 8l3 3 5-6" />
                </svg>
              )}
            </div>
            <span
              className={`text-xs ${text.muted} group-hover:${text.secondary} transition-colors`}
            >
              Remember my choice for future projects
            </span>
          </button>
        )}

        {error && <p className={`mt-4 text-xs ${text.error}`}>{error}</p>}
      </div>
    </div>
  );
}

function AnimatedBackLabel() {
  return (
    <span className={`group inline-flex items-center text-xs ${text.muted} hover:${text.secondary}`}>
      <span className="relative inline-flex items-center">
        <ChevronLeft className="w-3.5 h-3.5 absolute -left-3 opacity-0 -translate-x-0.5 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0" />
        <span className="transition-transform duration-300 ease-out group-hover:translate-x-1.5">Back</span>
      </span>
    </span>
  );
}

function AnimatedSkipLabel() {
  return (
    <span className={`group inline-flex items-center text-xs ${text.muted} hover:${text.secondary}`}>
      <span className="relative inline-flex items-center">
        <span className="transition-transform duration-300 ease-out group-hover:-translate-x-1.5">
          Skip for now
        </span>
        <ChevronRight className="w-3.5 h-3.5 absolute -right-3 opacity-0 translate-x-0.5 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0" />
      </span>
    </span>
  );
}

function AnimatedContinuePrimaryLabel({ label }: { label: string }) {
  return (
    <span className="relative inline-flex items-center">
      <span className="transition-all duration-300 ease-out group-hover:pr-5">{label}</span>
      <ArrowRight className="w-4 h-4 absolute right-0 opacity-0 -translate-x-1 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0" />
    </span>
  );
}

function AnimatedConnectPrimaryLabel() {
  return (
    <span className="relative inline-flex items-center">
      <Plug className="w-4 h-4 rotate-90 absolute left-0 opacity-0 translate-x-4 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0" />
      <span className="transition-all duration-300 ease-out group-hover:pl-[22px]">
        Connect Agents
      </span>
    </span>
  );
}

function AnimatedCommitPrimaryLabel() {
  return (
    <span className="relative inline-flex items-center">
      <GitCommit className="w-4 h-4 absolute left-0 opacity-0 translate-x-4 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0" />
      <span className="transition-all duration-300 ease-out group-hover:pl-5">Commit & Push</span>
    </span>
  );
}
