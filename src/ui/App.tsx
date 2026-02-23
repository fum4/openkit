import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Download,
  GitBranch,
  Link2,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { APP_NAME } from "../constants";
import { AppSettingsModal } from "./components/AppSettingsModal";
import { ConfigurationPanel } from "./components/ConfigurationPanel";
import { CreateCustomTaskModal } from "./components/CreateCustomTaskModal";
import { CreateForm } from "./components/CreateForm";
import { LinkIssueModal } from "./components/LinkIssueModal";
import { CreateWorktreeModal } from "./components/CreateWorktreeModal";
import { CustomTaskDetailPanel } from "./components/detail/CustomTaskDetailPanel";
import type { CodingAgent } from "./components/detail/CodeAgentSplitButton";
import { DetailPanel } from "./components/detail/DetailPanel";
import { GitHubSetupModal } from "./components/GitHubSetupModal";
import { JiraDetailPanel } from "./components/detail/JiraDetailPanel";
import { LinearDetailPanel } from "./components/detail/LinearDetailPanel";
import { Header } from "./components/Header";
import { IntegrationsPanel } from "./components/IntegrationsPanel";
import { IssueList } from "./components/IssueList";
import { AgentsView } from "./components/AgentsView";
import { ProjectSetupScreen } from "./components/ProjectSetupScreen";
import { HooksPanel } from "./components/VerificationPanel";
import { ResizableHandle } from "./components/ResizableHandle";
import { SetupCommitModal } from "./components/SetupCommitModal";
import type { View } from "./components/NavBar";
import type { WorktreeInfo } from "./types";
import { TabBar } from "./components/TabBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { WorktreeList } from "./components/WorktreeList";
import { Modal } from "./components/Modal";
import { useServer } from "./contexts/ServerContext";
import { useApi } from "./hooks/useApi";
import { useConfig } from "./hooks/useConfig";
import { useCustomTasks } from "./hooks/useCustomTasks";
import { useJiraIssues } from "./hooks/useJiraIssues";
import { useLinearIssues } from "./hooks/useLinearIssues";
import {
  useGitHubStatus,
  useJiraStatus,
  useLinearStatus,
  useWorktrees,
} from "./hooks/useWorktrees";
import { button, errorBanner, input, surface, text } from "./theme";

type Selection =
  | { type: "worktree"; id: string }
  | { type: "issue"; key: string }
  | { type: "linear-issue"; identifier: string }
  | { type: "custom-task"; id: string }
  | null;

type ClaudeLaunchMode = "resume" | "start";

interface ClaudeLaunchIntent {
  worktreeId: string;
  mode: ClaudeLaunchMode;
  prompt?: string;
  tabLabel?: string;
  skipPermissions?: boolean;
  startInBackground?: boolean;
}

interface ClaudeLaunchRequest extends ClaudeLaunchIntent {
  requestId: number;
}

type AgentLaunchMode = "resume" | "start";

interface AgentLaunchIntentBase {
  worktreeId: string;
  mode: AgentLaunchMode;
  prompt?: string;
  tabLabel?: string;
  skipPermissions?: boolean;
}

type CodexLaunchIntent = AgentLaunchIntentBase;
type GeminiLaunchIntent = AgentLaunchIntentBase;
type OpenCodeLaunchIntent = AgentLaunchIntentBase;

interface AgentLaunchRequestBase extends AgentLaunchIntentBase {
  requestId: number;
}

type CodexLaunchRequest = AgentLaunchRequestBase;
type GeminiLaunchRequest = AgentLaunchRequestBase;
type OpenCodeLaunchRequest = AgentLaunchRequestBase;

interface NotificationTabRequest {
  worktreeId: string;
  tab: "hooks";
  requestId: number;
}

interface AgentLaunchOptions {
  focusOnLaunch?: boolean;
  skipCliCheck?: boolean;
}

interface AgentPermissionPromptState {
  agent: CodingAgent;
  intent: ClaudeLaunchIntent | CodexLaunchIntent | GeminiLaunchIntent | OpenCodeLaunchIntent;
  options?: AgentLaunchOptions;
}

type PendingAgentLaunch =
  | { agent: "claude"; intent: ClaudeLaunchIntent; options?: AgentLaunchOptions }
  | { agent: "codex"; intent: CodexLaunchIntent; options?: AgentLaunchOptions }
  | { agent: "gemini"; intent: GeminiLaunchIntent; options?: AgentLaunchOptions }
  | { agent: "opencode"; intent: OpenCodeLaunchIntent; options?: AgentLaunchOptions };

interface AgentCliPromptState {
  pendingLaunch: PendingAgentLaunch;
  command: string;
  brewPackage: string;
  error: string | null;
  isInstalling: boolean;
}

const AUTO_CLAUDE_DEBUG_PREFIX = "[AUTO-CLAUDE][TEMP]";
const CODING_AGENT_PREF_KEY = `${APP_NAME}:defaultCodingAgent`;
const AGENT_DISPLAY_NAMES: Record<CodingAgent, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
};
const AUTO_START_AGENT_NAMES: Record<CodingAgent, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
};
const AGENT_SKIP_PERMISSION_FLAGS: Record<CodingAgent, string> = {
  claude: "--dangerously-skip-permissions",
  codex: "--dangerously-bypass-approvals-and-sandbox",
  gemini: "--yolo",
  opencode: 'OPENCODE_PERMISSION=\'{"*":"allow"}\'',
};

function getAgentCliLabel(agent: CodingAgent): string {
  const base = AGENT_DISPLAY_NAMES[agent];
  return base.endsWith("CLI") ? base : `${base} CLI`;
}

function shellQuoteSingle(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildAgentStartupCommand(
  agent: CodingAgent,
  prompt: string,
  options?: { skipPermissions?: boolean },
): string {
  const trimmedPrompt = prompt.trim();
  const args: string[] = [];
  if (options?.skipPermissions && agent !== "opencode") {
    args.push(AGENT_SKIP_PERMISSION_FLAGS[agent]);
  }
  if (trimmedPrompt) {
    if (agent === "gemini") {
      args.push("-i", shellQuoteSingle(trimmedPrompt));
    } else if (agent === "opencode") {
      args.push("--prompt", shellQuoteSingle(trimmedPrompt));
    } else {
      args.push(shellQuoteSingle(trimmedPrompt));
    }
  }
  if (agent === "opencode") {
    const prefix = options?.skipPermissions ? `${AGENT_SKIP_PERMISSION_FLAGS[agent]} ` : "";
    const invocation =
      args.length > 0 ? `${prefix}opencode ${args.join(" ")}` : `${prefix}opencode`;
    return `exec ${invocation}`;
  }
  const invocation = args.length > 0 ? `${agent} ${args.join(" ")}` : agent;
  return `exec ${invocation}`;
}

function buildClaudeStartupCommand(
  prompt: string,
  options?: { skipPermissions?: boolean },
): string {
  return buildAgentStartupCommand("claude", prompt, options);
}

function buildCodexStartupCommand(prompt: string, options?: { skipPermissions?: boolean }): string {
  return buildAgentStartupCommand("codex", prompt, options);
}

function buildGeminiStartupCommand(
  prompt: string,
  options?: { skipPermissions?: boolean },
): string {
  return buildAgentStartupCommand("gemini", prompt, options);
}

function buildOpenCodeStartupCommand(
  prompt: string,
  options?: { skipPermissions?: boolean },
): string {
  return buildAgentStartupCommand("opencode", prompt, options);
}

function buildStartupCommandForAgent(
  agent: CodingAgent,
  prompt: string,
  options?: { skipPermissions?: boolean },
): string {
  if (agent === "claude") return buildClaudeStartupCommand(prompt, options);
  if (agent === "codex") return buildCodexStartupCommand(prompt, options);
  if (agent === "gemini") return buildGeminiStartupCommand(prompt, options);
  return buildOpenCodeStartupCommand(prompt, options);
}

function buildAgentLabel(agent: CodingAgent): string {
  return AUTO_START_AGENT_NAMES[agent];
}

function hasAutoStartAgent(value: unknown): value is "claude" | "codex" | "gemini" | "opencode" {
  return value === "claude" || value === "codex" || value === "gemini" || value === "opencode";
}

function resolveAutoStartAgent(value: unknown): CodingAgent {
  return hasAutoStartAgent(value) ? value : "claude";
}

function formatTaskNotificationDetail(issueId: string, title: string): string {
  const trimmedTitle = title.trim();
  return trimmedTitle ? `${issueId} - ${trimmedTitle}` : issueId;
}

export default function App() {
  const api = useApi();
  const {
    projects,
    activeProject,
    isElectron,
    projectsLoading,
    selectFolder,
    openProject,
    closeProject,
    switchProject,
    serverUrl,
  } = useServer();
  const [hookUpdateKey, setHookUpdateKey] = useState(0);
  const { worktrees, isConnected, error, refetch } = useWorktrees(
    undefined,
    useCallback(() => setHookUpdateKey((k) => k + 1), []),
  );
  const {
    config,
    projectName,
    hasBranchNameRule,
    isLoading: configLoading,
    refetch: refetchConfig,
  } = useConfig();
  const { jiraStatus, refetchJiraStatus } = useJiraStatus();
  const { linearStatus, refetchLinearStatus } = useLinearStatus();
  const githubStatus = useGitHubStatus();
  const {
    tasks: customTasks,
    isLoading: customTasksLoading,
    error: customTasksError,
    refetch: refetchCustomTasks,
  } = useCustomTasks();
  const localIssueLinkedIds = useMemo(
    () =>
      new Set<string>(
        customTasks.filter((t) => t.linkedWorktreeId).map((t) => t.linkedWorktreeId as string),
      ),
    [customTasks],
  );
  // Track if config existed when we first connected (to detect "deleted while open")
  const [hadConfigOnConnect, setHadConfigOnConnect] = useState<boolean | null>(null);
  const [isAutoInitializing, setIsAutoInitializing] = useState(false);

  // Track config state for setup screen logic
  useEffect(() => {
    if (configLoading || !serverUrl) return;

    // First time we see config status for this connection
    if (hadConfigOnConnect === null) {
      setHadConfigOnConnect(!!config);

      // If no config and this is Electron, check if we should auto-init
      if (!config && isElectron) {
        window.electronAPI?.getSetupPreference().then(async (pref) => {
          if (pref === "auto") {
            setIsAutoInitializing(true);
            try {
              const result = await api.initConfig({});
              if (result.success) {
                refetchConfig();
              }
            } finally {
              setIsAutoInitializing(false);
            }
          }
        });
      }
    }
  }, [configLoading, serverUrl, config, hadConfigOnConnect, isElectron]);

  // Reset hadConfigOnConnect when serverUrl changes (switching projects)
  useEffect(() => {
    setHadConfigOnConnect(null);
  }, [serverUrl]);

  // Show setup screen when:
  // - Config is missing AND we have a server connection (Electron mode)
  // - AND we're not auto-initializing
  // - AND (this is a new project without config OR config was deleted while open)
  const needsSetup = isElectron && serverUrl && !configLoading && !config && !isAutoInitializing;

  // In Electron mode with multi-project: show welcome when no projects
  // In web/single-project mode: show welcome when no config
  const showWelcomeScreen = isElectron
    ? !projectsLoading && projects.length === 0
    : !configLoading && !config;

  // Show error screen when active project failed to start
  const showErrorState = isElectron && activeProject?.status === "error";

  // Don't show main UI if we have projects but none running yet (still loading)
  const showLoadingState = isElectron && projects.length > 0 && !serverUrl && !showErrorState;

  const handleSetupComplete = () => {
    // Clear stale workspace state from a previous config
    if (serverUrl) {
      localStorage.removeItem(`OpenKit:wsSel:${serverUrl}`);
      localStorage.removeItem(`OpenKit:wsTab:${serverUrl}`);
      localStorage.removeItem(`OpenKit:view:${serverUrl}`);
    }
    setSelectionState(null);
    setActiveCreateTabState("branch");
    setActiveViewState("workspace");
    refetchConfig();
    refetchJiraStatus();
    refetchLinearStatus();
    refetch();
    refetchCustomTasks();
    setHadConfigOnConnect(true);
  };

  const handleRememberChoice = (choice: "auto" | "manual") => {
    window.electronAPI?.setSetupPreference(choice);
  };

  const handleImportProject = async () => {
    if (isElectron) {
      const folderPath = await selectFolder();
      if (folderPath) {
        await openProject(folderPath);
      }
    } else {
      // For web mode, redirect to init
      window.location.href = "/init";
    }
  };

  const [activeView, setActiveViewState] = useState<View>(() => {
    if (serverUrl) {
      const saved = localStorage.getItem(`OpenKit:view:${serverUrl}`);
      if (
        saved === "workspace" ||
        saved === "agents" ||
        saved === "hooks" ||
        saved === "configuration" ||
        saved === "integrations"
      ) {
        return saved;
      }
    }
    return "workspace";
  });

  const setActiveView = (view: View) => {
    setActiveViewState(view);
    if (serverUrl) {
      localStorage.setItem(`OpenKit:view:${serverUrl}`, view);
    }
  };

  // Restore view when switching projects
  useEffect(() => {
    if (!serverUrl) return;
    const saved = localStorage.getItem(`OpenKit:view:${serverUrl}`);
    if (
      saved === "workspace" ||
      saved === "agents" ||
      saved === "hooks" ||
      saved === "configuration" ||
      saved === "integrations"
    ) {
      setActiveViewState(saved);
    } else {
      setActiveViewState("workspace");
    }
  }, [serverUrl]);

  const [selection, setSelectionState] = useState<Selection>(() => {
    if (serverUrl) {
      try {
        const saved = localStorage.getItem(`OpenKit:wsSel:${serverUrl}`);
        if (saved) return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return null;
  });

  const setSelection = (sel: Selection) => {
    setSelectionState(sel);
    if (serverUrl) {
      localStorage.setItem(`OpenKit:wsSel:${serverUrl}`, JSON.stringify(sel));
    }
  };

  const [pendingNotificationNav, setPendingNotificationNav] = useState<{
    worktreeId: string;
    targetProjectId: string | null;
    openClaudeTab?: boolean;
    openHooksTab?: boolean;
  } | null>(null);
  const [pendingIssueNotificationNav, setPendingIssueNotificationNav] = useState<{
    source: "jira" | "linear";
    issueId: string;
    targetProjectId: string | null;
  } | null>(null);
  const claudeLaunchRequestIdRef = useRef(0);
  const codexLaunchRequestIdRef = useRef(0);
  const geminiLaunchRequestIdRef = useRef(0);
  const openCodeLaunchRequestIdRef = useRef(0);
  const notificationTabRequestIdRef = useRef(0);
  const jiraSeenIssueIdsRef = useRef<Set<string>>(new Set());
  const linearSeenIssueIdsRef = useRef<Set<string>>(new Set());
  const localSeenIssueIdsRef = useRef<Set<string>>(new Set());
  const jiraAutoLaunchArmedRef = useRef(false);
  const linearAutoLaunchArmedRef = useRef(false);
  const localAutoLaunchArmedRef = useRef(false);
  const autoLaunchQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [pendingClaudeLaunches, setPendingClaudeLaunches] = useState<ClaudeLaunchIntent[]>([]);
  const [pendingCodexLaunches, setPendingCodexLaunches] = useState<CodexLaunchIntent[]>([]);
  const [pendingGeminiLaunches, setPendingGeminiLaunches] = useState<GeminiLaunchIntent[]>([]);
  const [pendingOpenCodeLaunches, setPendingOpenCodeLaunches] = useState<OpenCodeLaunchIntent[]>(
    [],
  );
  const [claudeLaunchRequest, setClaudeLaunchRequest] = useState<ClaudeLaunchRequest | null>(null);
  const [codexLaunchRequest, setCodexLaunchRequest] = useState<CodexLaunchRequest | null>(null);
  const [geminiLaunchRequest, setGeminiLaunchRequest] = useState<GeminiLaunchRequest | null>(null);
  const [opencodeLaunchRequest, setOpenCodeLaunchRequest] = useState<OpenCodeLaunchRequest | null>(
    null,
  );
  const [agentPermissionPrompt, setAgentPermissionPrompt] =
    useState<AgentPermissionPromptState | null>(null);
  const [agentCliPrompt, setAgentCliPrompt] = useState<AgentCliPromptState | null>(null);
  const [notificationTabRequest, setNotificationTabRequest] =
    useState<NotificationTabRequest | null>(null);
  const logAutoClaude = useCallback((message: string, extra?: Record<string, unknown>) => {
    if (extra) {
      console.info(`${AUTO_CLAUDE_DEBUG_PREFIX} ${message}`, extra);
      return;
    }
    console.info(`${AUTO_CLAUDE_DEBUG_PREFIX} ${message}`);
  }, []);

  useEffect(() => {
    if (!pendingNotificationNav) return;
    if (
      pendingNotificationNav.targetProjectId &&
      activeProject?.id !== pendingNotificationNav.targetProjectId
    ) {
      return;
    }
    const sel: Selection = { type: "worktree", id: pendingNotificationNav.worktreeId };
    setSelectionState(sel);
    if (serverUrl) {
      localStorage.setItem(`OpenKit:wsSel:${serverUrl}`, JSON.stringify(sel));
    }
    if (pendingNotificationNav.openClaudeTab) {
      setPendingClaudeLaunches((prev) => [
        ...prev,
        { worktreeId: pendingNotificationNav.worktreeId, mode: "resume" },
      ]);
    }
    if (pendingNotificationNav.openHooksTab) {
      notificationTabRequestIdRef.current += 1;
      setNotificationTabRequest({
        worktreeId: pendingNotificationNav.worktreeId,
        tab: "hooks",
        requestId: notificationTabRequestIdRef.current,
      });
    }
    setPendingNotificationNav(null);
  }, [pendingNotificationNav, activeProject?.id, serverUrl]);

  useEffect(() => {
    if (!pendingIssueNotificationNav) return;
    if (
      pendingIssueNotificationNav.targetProjectId &&
      activeProject?.id !== pendingIssueNotificationNav.targetProjectId
    ) {
      return;
    }
    const sel: Selection =
      pendingIssueNotificationNav.source === "jira"
        ? { type: "issue", key: pendingIssueNotificationNav.issueId }
        : { type: "linear-issue", identifier: pendingIssueNotificationNav.issueId };
    setActiveCreateTabState("issues");
    if (serverUrl) {
      localStorage.setItem(`OpenKit:wsTab:${serverUrl}`, "issues");
    }
    setSelectionState(sel);
    if (serverUrl) {
      localStorage.setItem(`OpenKit:wsSel:${serverUrl}`, JSON.stringify(sel));
    }
    setPendingIssueNotificationNav(null);
  }, [pendingIssueNotificationNav, activeProject?.id, serverUrl]);

  const resolveProjectIdFromNotification = useCallback(
    (projectName?: string, sourceServerUrl?: string): string | null => {
      if (sourceServerUrl) {
        try {
          const sourcePort = Number(new URL(sourceServerUrl).port);
          if (Number.isFinite(sourcePort)) {
            const matchByPort = projects.find((project) => project.port === sourcePort);
            if (matchByPort) return matchByPort.id;
          }
        } catch {
          // Ignore URL parse errors.
        }
      }

      if (!projectName) return null;
      const normalized = projectName.trim().toLowerCase();
      if (!normalized) return null;
      const matchByName = projects.find(
        (project) => project.name.trim().toLowerCase() === normalized,
      );
      return matchByName?.id ?? null;
    },
    [projects],
  );

  useEffect(() => {
    if (!serverUrl) return;
    try {
      const saved = localStorage.getItem(`OpenKit:wsSel:${serverUrl}`);
      if (saved) setSelectionState(JSON.parse(saved));
      else setSelectionState(null);
    } catch {
      setSelectionState(null);
    }
  }, [serverUrl]);
  const [activeCreateTab, setActiveCreateTabState] = useState<"branch" | "issues">(() => {
    if (serverUrl) {
      const saved = localStorage.getItem(`OpenKit:wsTab:${serverUrl}`);
      if (saved === "branch" || saved === "issues") return saved;
    }
    return "branch";
  });

  const setActiveCreateTab = (tab: "branch" | "issues") => {
    setActiveCreateTabState(tab);
    if (serverUrl) {
      localStorage.setItem(`OpenKit:wsTab:${serverUrl}`, tab);
    }
  };

  useEffect(() => {
    if (!serverUrl) return;
    const saved = localStorage.getItem(`OpenKit:wsTab:${serverUrl}`);
    if (saved === "branch" || saved === "issues") {
      setActiveCreateTabState(saved);
    } else {
      setActiveCreateTabState("branch");
    }
  }, [serverUrl]);
  const [defaultCodingAgent, setDefaultCodingAgent] = useState<CodingAgent>(() => {
    const saved = localStorage.getItem(CODING_AGENT_PREF_KEY);
    return saved === "claude" || saved === "codex" || saved === "gemini" || saved === "opencode"
      ? saved
      : "claude";
  });
  useEffect(() => {
    localStorage.setItem(CODING_AGENT_PREF_KEY, defaultCodingAgent);
  }, [defaultCodingAgent]);
  const [worktreeFilter, setWorktreeFilter] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalMode, setCreateModalMode] = useState<"branch" | "jira" | "linear" | "custom">(
    "branch",
  );
  const [createTaskForWorktreeId, setCreateTaskForWorktreeId] = useState<string | null>(null);
  const [linkIssueForWorktreeId, setLinkIssueForWorktreeId] = useState<string | null>(null);

  // Sidebar width state with persistence
  const DEFAULT_SIDEBAR_WIDTH = 300;
  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 500;

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    // Try to load from localStorage first (works for both Electron and web)
    const saved = localStorage.getItem(`${APP_NAME}:sidebarWidth`);
    if (saved) {
      const width = parseInt(saved, 10);
      if (!isNaN(width) && width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH) {
        return width;
      }
    }
    return DEFAULT_SIDEBAR_WIDTH;
  });

  // Load sidebar width from Electron preferences (overrides localStorage)
  useEffect(() => {
    if (isElectron) {
      window.electronAPI?.getSidebarWidth().then((width) => {
        if (width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH) {
          setSidebarWidth(width);
        }
      });
    }
  }, [isElectron]);

  const handleSidebarResize = (delta: number) => {
    setSidebarWidth((prev) => {
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, prev + delta));
      return newWidth;
    });
  };

  const handleSidebarResizeEnd = () => {
    // Persist to localStorage (always)
    localStorage.setItem(`${APP_NAME}:sidebarWidth`, String(sidebarWidth));

    // Also persist to Electron preferences if available
    if (isElectron) {
      window.electronAPI?.setSidebarWidth(sidebarWidth);
    }
  };

  const WS_BANNER_KEY = `${APP_NAME}:workspaceBannerDismissed`;
  const [wsBannerDismissed, setWsBannerDismissed] = useState(
    () => localStorage.getItem(WS_BANNER_KEY) === "1",
  );
  const dismissWsBanner = () => {
    setWsBannerDismissed(true);
    localStorage.setItem(WS_BANNER_KEY, "1");
  };

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [showSetupCommitModal, setShowSetupCommitModal] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) {
      return;
    }

    const handlePreventRefreshShortcut = (event: KeyboardEvent) => {
      const isReloadChord = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r";
      const isF5 = event.key === "F5";
      if (isReloadChord || isF5) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handlePreventRefreshShortcut);
    return () => window.removeEventListener("keydown", handlePreventRefreshShortcut);
  }, []);

  const handleSetupCommit = async (message: string) => {
    await api.commitSetup(message);
    setShowSetupCommitModal(false);
  };

  const needsCommit = githubStatus?.hasCommits === false;
  const needsRepo = githubStatus?.installed && githubStatus?.authenticated && !githubStatus?.repo;

  const handleSetupNeeded = () => {
    setShowSetupModal(true);
  };

  const handleAutoSetup = async (options: { commitMessage: string; repoPrivate: boolean }) => {
    setShowSetupModal(false);
    setSetupError(null);

    try {
      // Step 1: Create initial commit if needed
      if (needsCommit) {
        const commitResult = await api.createInitialCommit();
        if (!commitResult.success) {
          setSetupError(commitResult.error ?? "Failed to create commit");
          return;
        }
      }

      // Step 2: Create repo if needed
      if (needsRepo || needsCommit) {
        const repoResult = await api.createGitHubRepo(options.repoPrivate);
        if (!repoResult.success) {
          setSetupError(repoResult.error ?? "Failed to create repository");
          return;
        }
      }

      // Refresh status after setup
      window.location.reload();
    } catch {
      setSetupError("Setup failed unexpectedly");
    }
  };

  const jiraEnabled = jiraStatus?.configured ?? false;
  const refreshIntervalMinutes = jiraStatus?.refreshIntervalMinutes ?? 5;
  const {
    issues: jiraIssues,
    isLoading: jiraIssuesLoading,
    isFetching: jiraIssuesFetching,
    error: jiraError,
    searchQuery: jiraSearchQuery,
    setSearchQuery: setJiraSearchQuery,
    refetch: refetchJiraIssues,
    dataUpdatedAt: jiraIssuesUpdatedAt,
  } = useJiraIssues(jiraEnabled, refreshIntervalMinutes);

  const linearEnabled = linearStatus?.configured ?? false;
  const linearRefreshIntervalMinutes = linearStatus?.refreshIntervalMinutes ?? 5;
  const {
    issues: linearIssues,
    isLoading: linearIssuesLoading,
    isFetching: linearIssuesFetching,
    error: linearError,
    setSearchQuery: setLinearSearchQuery,
    refetch: refetchLinearIssues,
    dataUpdatedAt: linearIssuesUpdatedAt,
  } = useLinearIssues(linearEnabled, linearRefreshIntervalMinutes);

  // Auto-select first worktree when nothing is selected, or fix stale worktree selection
  useEffect(() => {
    if (worktrees.length === 0) {
      if (selection?.type === "worktree") setSelection(null);
      return;
    }
    if (!selection) {
      setSelection({ type: "worktree", id: worktrees[0].id });
      return;
    }
    // Fix stale worktree selection (worktree was deleted)
    if (selection.type === "worktree" && !worktrees.find((w) => w.id === selection.id)) {
      setSelection({ type: "worktree", id: worktrees[0].id });
    }
  }, [worktrees, selection]);

  const selectedWorktree =
    selection?.type === "worktree" ? worktrees.find((w) => w.id === selection.id) || null : null;
  const activeWorktreeIds = useMemo(
    () => new Set(worktrees.map((worktree) => worktree.id)),
    [worktrees],
  );

  const startAgentSessionInBackground = useCallback(
    async (
      agent: CodingAgent,
      worktreeId: string,
      prompt: string,
      skipPermissions: boolean,
    ): Promise<boolean> => {
      const startupCommand = buildStartupCommandForAgent(agent, prompt, { skipPermissions });
      const sessionResult = await api.createTerminalSession(worktreeId, startupCommand, agent);
      logAutoClaude(`Background ${buildAgentLabel(agent)} session bootstrap result`, {
        agent,
        worktreeId,
        success: sessionResult.success,
        sessionId: sessionResult.sessionId,
        error: sessionResult.error,
        skipPermissions,
      });
      return sessionResult.success;
    },
    [api, logAutoClaude],
  );

  useEffect(() => {
    const pendingClaudeLaunch = pendingClaudeLaunches[0];
    if (!pendingClaudeLaunch) return;
    const target = worktrees.find((wt) => wt.id === pendingClaudeLaunch.worktreeId);
    if (!target) {
      logAutoClaude("Waiting for target worktree to appear before launching Claude", {
        worktreeId: pendingClaudeLaunch.worktreeId,
      });
      return;
    }
    if (target.status === "creating") {
      logAutoClaude("Target worktree exists but is still creating; waiting to launch Claude", {
        worktreeId: pendingClaudeLaunch.worktreeId,
        status: target.status,
      });
      return;
    }
    const intent = pendingClaudeLaunch;
    setPendingClaudeLaunches((prev) => prev.slice(1));

    void (async () => {
      if (intent.mode === "start") {
        logAutoClaude("Running pre-implementation hooks before Claude launch", {
          worktreeId: intent.worktreeId,
        });
        const preRun = await api.runHooks(intent.worktreeId, "pre-implementation");
        const failedCount = preRun.steps.filter((step) => step.status === "failed").length;
        logAutoClaude("Pre-implementation hooks finished", {
          worktreeId: intent.worktreeId,
          status: preRun.status,
          stepCount: preRun.steps.length,
          failedCount,
        });
      }

      let mode: ClaudeLaunchMode = intent.mode;
      if (intent.startInBackground && intent.prompt) {
        const started = await startAgentSessionInBackground(
          "claude",
          intent.worktreeId,
          intent.prompt,
          intent.skipPermissions ?? false,
        );
        if (started) {
          mode = "resume";
        }
      }

      claudeLaunchRequestIdRef.current += 1;
      setClaudeLaunchRequest({
        ...intent,
        mode,
        requestId: claudeLaunchRequestIdRef.current,
      });
      logAutoClaude("Promoted pending Claude launch to active request", {
        worktreeId: intent.worktreeId,
        mode,
        requestId: claudeLaunchRequestIdRef.current,
        tabLabel: intent.tabLabel,
        startInBackground: intent.startInBackground ?? false,
      });
    })();
  }, [api, logAutoClaude, pendingClaudeLaunches, startAgentSessionInBackground, worktrees]);

  useEffect(() => {
    const pendingCodexLaunch = pendingCodexLaunches[0];
    if (!pendingCodexLaunch) return;
    const target = worktrees.find((wt) => wt.id === pendingCodexLaunch.worktreeId);
    if (!target) {
      logAutoClaude("Waiting for target worktree to appear before launching Codex", {
        worktreeId: pendingCodexLaunch.worktreeId,
      });
      return;
    }
    if (target.status === "creating") {
      logAutoClaude("Target worktree exists but is still creating; waiting to launch Codex", {
        worktreeId: pendingCodexLaunch.worktreeId,
        status: target.status,
      });
      return;
    }
    const intent = pendingCodexLaunch;
    setPendingCodexLaunches((prev) => prev.slice(1));

    void (async () => {
      if (intent.mode === "start") {
        logAutoClaude("Running pre-implementation hooks before Codex launch", {
          worktreeId: intent.worktreeId,
        });
        const preRun = await api.runHooks(intent.worktreeId, "pre-implementation");
        const failedCount = preRun.steps.filter((step) => step.status === "failed").length;
        logAutoClaude("Pre-implementation hooks finished", {
          worktreeId: intent.worktreeId,
          status: preRun.status,
          stepCount: preRun.steps.length,
          failedCount,
        });
      }

      codexLaunchRequestIdRef.current += 1;
      setCodexLaunchRequest({
        ...intent,
        requestId: codexLaunchRequestIdRef.current,
      });
      logAutoClaude("Promoted pending Codex launch to active request", {
        worktreeId: intent.worktreeId,
        mode: intent.mode,
        requestId: codexLaunchRequestIdRef.current,
        tabLabel: intent.tabLabel,
      });
    })();
  }, [api, logAutoClaude, pendingCodexLaunches, worktrees]);

  useEffect(() => {
    const pendingGeminiLaunch = pendingGeminiLaunches[0];
    if (!pendingGeminiLaunch) return;
    const target = worktrees.find((wt) => wt.id === pendingGeminiLaunch.worktreeId);
    if (!target) {
      logAutoClaude("Waiting for target worktree to appear before launching Gemini", {
        worktreeId: pendingGeminiLaunch.worktreeId,
      });
      return;
    }
    if (target.status === "creating") {
      logAutoClaude("Target worktree exists but is still creating; waiting to launch Gemini", {
        worktreeId: pendingGeminiLaunch.worktreeId,
        status: target.status,
      });
      return;
    }
    const intent = pendingGeminiLaunch;
    setPendingGeminiLaunches((prev) => prev.slice(1));

    void (async () => {
      if (intent.mode === "start") {
        logAutoClaude("Running pre-implementation hooks before Gemini launch", {
          worktreeId: intent.worktreeId,
        });
        const preRun = await api.runHooks(intent.worktreeId, "pre-implementation");
        const failedCount = preRun.steps.filter((step) => step.status === "failed").length;
        logAutoClaude("Pre-implementation hooks finished", {
          worktreeId: intent.worktreeId,
          status: preRun.status,
          stepCount: preRun.steps.length,
          failedCount,
        });
      }

      geminiLaunchRequestIdRef.current += 1;
      setGeminiLaunchRequest({
        ...intent,
        requestId: geminiLaunchRequestIdRef.current,
      });
      logAutoClaude("Promoted pending Gemini launch to active request", {
        worktreeId: intent.worktreeId,
        mode: intent.mode,
        requestId: geminiLaunchRequestIdRef.current,
        tabLabel: intent.tabLabel,
      });
    })();
  }, [api, logAutoClaude, pendingGeminiLaunches, worktrees]);

  useEffect(() => {
    const pendingOpenCodeLaunch = pendingOpenCodeLaunches[0];
    if (!pendingOpenCodeLaunch) return;
    const target = worktrees.find((wt) => wt.id === pendingOpenCodeLaunch.worktreeId);
    if (!target) {
      logAutoClaude("Waiting for target worktree to appear before launching OpenCode", {
        worktreeId: pendingOpenCodeLaunch.worktreeId,
      });
      return;
    }
    if (target.status === "creating") {
      logAutoClaude("Target worktree exists but is still creating; waiting to launch OpenCode", {
        worktreeId: pendingOpenCodeLaunch.worktreeId,
        status: target.status,
      });
      return;
    }
    const intent = pendingOpenCodeLaunch;
    setPendingOpenCodeLaunches((prev) => prev.slice(1));

    void (async () => {
      if (intent.mode === "start") {
        logAutoClaude("Running pre-implementation hooks before OpenCode launch", {
          worktreeId: intent.worktreeId,
        });
        const preRun = await api.runHooks(intent.worktreeId, "pre-implementation");
        const failedCount = preRun.steps.filter((step) => step.status === "failed").length;
        logAutoClaude("Pre-implementation hooks finished", {
          worktreeId: intent.worktreeId,
          status: preRun.status,
          stepCount: preRun.steps.length,
          failedCount,
        });
      }

      openCodeLaunchRequestIdRef.current += 1;
      setOpenCodeLaunchRequest({
        ...intent,
        requestId: openCodeLaunchRequestIdRef.current,
      });
      logAutoClaude("Promoted pending OpenCode launch to active request", {
        worktreeId: intent.worktreeId,
        mode: intent.mode,
        requestId: openCodeLaunchRequestIdRef.current,
        tabLabel: intent.tabLabel,
      });
    })();
  }, [api, logAutoClaude, pendingOpenCodeLaunches, worktrees]);

  const handleDeleted = () => {
    setSelection(null);
  };

  const handleCreateWorktreeFromJira = () => {
    // Switch to worktree tab so user sees the newly created worktree
    setActiveCreateTab("branch");
    setSelection(null);
    refetch();
  };

  const handleViewWorktreeFromJira = (worktreeId: string) => {
    setActiveCreateTab("branch");
    setSelection({ type: "worktree", id: worktreeId });
  };

  const findLinkedJiraWorktree = (issueKey: string): WorktreeInfo | null => {
    const suffix = `/browse/${issueKey}`;
    const wt = worktrees.find((w) => w.jiraUrl?.endsWith(suffix));
    return wt ?? null;
  };

  const handleCreateWorktreeFromLinear = () => {
    setActiveCreateTab("branch");
    setSelection(null);
    refetch();
  };

  const handleViewWorktreeFromLinear = (worktreeId: string) => {
    setActiveCreateTab("branch");
    setSelection({ type: "worktree", id: worktreeId });
  };

  const findLinkedLinearWorktree = (identifier: string): WorktreeInfo | null => {
    const suffix = `/issue/${identifier}`;
    const wt = worktrees.find((w) => w.linearUrl?.includes(suffix));
    return wt ?? null;
  };

  const selectedJiraWorktree =
    selection?.type === "issue" ? findLinkedJiraWorktree(selection.key) : null;
  const selectedLinearWorktree =
    selection?.type === "linear-issue" ? findLinkedLinearWorktree(selection.identifier) : null;

  const handleCreateWorktreeFromCustomTask = () => {
    setActiveCreateTab("branch");
    setSelection(null);
    refetch();
    refetchCustomTasks();
  };

  const handleViewWorktreeFromCustomTask = (worktreeId: string) => {
    setActiveCreateTab("branch");
    setSelection({ type: "worktree", id: worktreeId });
  };

  const enqueueClaudeLaunch = useCallback(
    (intent: ClaudeLaunchIntent, options?: AgentLaunchOptions) => {
      logAutoClaude("Scheduling Claude launch intent", {
        worktreeId: intent.worktreeId,
        mode: intent.mode,
        tabLabel: intent.tabLabel,
        skipPermissions: intent.skipPermissions ?? false,
        focusOnLaunch: options?.focusOnLaunch ?? true,
      });
      if (options?.focusOnLaunch ?? true) {
        setActiveCreateTab("branch");
        setSelection({ type: "worktree", id: intent.worktreeId });
      }
      setPendingClaudeLaunches((prev) => [...prev, intent]);
      refetch();
    },
    [logAutoClaude, refetch],
  );

  const enqueueCodexLaunch = useCallback(
    (intent: CodexLaunchIntent, options?: AgentLaunchOptions) => {
      logAutoClaude("Scheduling Codex launch intent", {
        worktreeId: intent.worktreeId,
        mode: intent.mode,
        tabLabel: intent.tabLabel,
        focusOnLaunch: options?.focusOnLaunch ?? true,
      });
      if (options?.focusOnLaunch ?? true) {
        setActiveCreateTab("branch");
        setSelection({ type: "worktree", id: intent.worktreeId });
      }
      setPendingCodexLaunches((prev) => [...prev, intent]);
      refetch();
    },
    [logAutoClaude, refetch],
  );

  const enqueueGeminiLaunch = useCallback(
    (intent: GeminiLaunchIntent, options?: AgentLaunchOptions) => {
      logAutoClaude("Scheduling Gemini launch intent", {
        worktreeId: intent.worktreeId,
        mode: intent.mode,
        tabLabel: intent.tabLabel,
        focusOnLaunch: options?.focusOnLaunch ?? true,
      });
      if (options?.focusOnLaunch ?? true) {
        setActiveCreateTab("branch");
        setSelection({ type: "worktree", id: intent.worktreeId });
      }
      setPendingGeminiLaunches((prev) => [...prev, intent]);
      refetch();
    },
    [logAutoClaude, refetch],
  );

  const enqueueOpenCodeLaunch = useCallback(
    (intent: OpenCodeLaunchIntent, options?: AgentLaunchOptions) => {
      logAutoClaude("Scheduling OpenCode launch intent", {
        worktreeId: intent.worktreeId,
        mode: intent.mode,
        tabLabel: intent.tabLabel,
        focusOnLaunch: options?.focusOnLaunch ?? true,
      });
      if (options?.focusOnLaunch ?? true) {
        setActiveCreateTab("branch");
        setSelection({ type: "worktree", id: intent.worktreeId });
      }
      setPendingOpenCodeLaunches((prev) => [...prev, intent]);
      refetch();
    },
    [logAutoClaude, refetch],
  );

  const continueAgentLaunch = useCallback(
    (launch: PendingAgentLaunch) => {
      if (launch.intent.skipPermissions === undefined) {
        setAgentPermissionPrompt({
          agent: launch.agent,
          intent: launch.intent,
          options: launch.options,
        });
        return;
      }
      if (launch.agent === "claude") {
        enqueueClaudeLaunch(launch.intent, launch.options);
        return;
      }
      if (launch.agent === "codex") {
        enqueueCodexLaunch(launch.intent, launch.options);
        return;
      }
      if (launch.agent === "gemini") {
        enqueueGeminiLaunch(launch.intent, launch.options);
        return;
      }
      enqueueOpenCodeLaunch(launch.intent, launch.options);
    },
    [enqueueClaudeLaunch, enqueueCodexLaunch, enqueueGeminiLaunch, enqueueOpenCodeLaunch],
  );

  const openMissingCliPrompt = useCallback(
    (
      pendingLaunch: PendingAgentLaunch,
      statusResult?: {
        command?: string;
        brewPackage?: string;
        error?: string;
      },
    ) => {
      const command = statusResult?.command ?? pendingLaunch.agent;
      const brewPackage = statusResult?.brewPackage ?? pendingLaunch.agent;
      setAgentCliPrompt({
        pendingLaunch,
        command,
        brewPackage,
        error: statusResult?.error ?? null,
        isInstalling: false,
      });
    },
    [],
  );

  const ensureAgentCliInstalled = useCallback(
    async (launch: PendingAgentLaunch, options?: AgentLaunchOptions): Promise<boolean> => {
      if (options?.skipCliCheck) return true;

      const status = await api.fetchAgentCliStatus(launch.agent);
      if (!status.success || !status.installed) {
        openMissingCliPrompt(launch, {
          command: status.command,
          brewPackage: status.brewPackage,
          error: status.success ? undefined : status.error,
        });
        return false;
      }
      return true;
    },
    [api, openMissingCliPrompt],
  );

  const handleCodeWithClaude = useCallback(
    async (intent: ClaudeLaunchIntent, options?: AgentLaunchOptions) => {
      const launch: PendingAgentLaunch = { agent: "claude", intent, options };
      const canLaunch = await ensureAgentCliInstalled(launch, options);
      if (!canLaunch) {
        return;
      }
      continueAgentLaunch(launch);
    },
    [continueAgentLaunch, ensureAgentCliInstalled],
  );

  const handleCodeWithCodex = useCallback(
    async (intent: CodexLaunchIntent, options?: AgentLaunchOptions) => {
      const launch: PendingAgentLaunch = { agent: "codex", intent, options };
      const canLaunch = await ensureAgentCliInstalled(launch, options);
      if (!canLaunch) {
        return;
      }
      continueAgentLaunch(launch);
    },
    [continueAgentLaunch, ensureAgentCliInstalled],
  );

  const handleCodeWithGemini = useCallback(
    async (intent: GeminiLaunchIntent, options?: AgentLaunchOptions) => {
      const launch: PendingAgentLaunch = { agent: "gemini", intent, options };
      const canLaunch = await ensureAgentCliInstalled(launch, options);
      if (!canLaunch) {
        return;
      }
      continueAgentLaunch(launch);
    },
    [continueAgentLaunch, ensureAgentCliInstalled],
  );

  const handleCodeWithOpenCode = useCallback(
    async (intent: OpenCodeLaunchIntent, options?: AgentLaunchOptions) => {
      const launch: PendingAgentLaunch = { agent: "opencode", intent, options };
      const canLaunch = await ensureAgentCliInstalled(launch, options);
      if (!canLaunch) {
        return;
      }
      continueAgentLaunch(launch);
    },
    [continueAgentLaunch, ensureAgentCliInstalled],
  );

  const launchAgentFromAutoStart = useCallback(
    async (
      agent: CodingAgent,
      intent: {
        worktreeId: string;
        mode: AgentLaunchMode;
        prompt?: string;
        tabLabel?: string;
        skipPermissions?: boolean;
      },
      options?: AgentLaunchOptions,
    ) => {
      if (agent === "claude") {
        await handleCodeWithClaude(intent, options);
        return;
      }
      if (agent === "codex") {
        await handleCodeWithCodex(intent, options);
        return;
      }
      if (agent === "gemini") {
        await handleCodeWithGemini(intent, options);
        return;
      }
      await handleCodeWithOpenCode(intent, options);
    },
    [handleCodeWithClaude, handleCodeWithCodex, handleCodeWithGemini, handleCodeWithOpenCode],
  );

  const launchAutoStartAgent = useCallback(
    async (
      agent: CodingAgent,
      launch: {
        worktreeId: string;
        prompt: string;
        skipPermissions: boolean;
        focusTerminal: boolean;
      },
    ) => {
      let mode: AgentLaunchMode = "start";
      let focusOnLaunch = launch.focusTerminal;

      if (!launch.focusTerminal) {
        const startedInBackground = await startAgentSessionInBackground(
          agent,
          launch.worktreeId,
          launch.prompt,
          launch.skipPermissions,
        );
        if (startedInBackground) {
          mode = "resume";
        } else {
          // Fallback so launch request is consumed even without a background session.
          focusOnLaunch = true;
        }
      }

      await launchAgentFromAutoStart(
        agent,
        {
          worktreeId: launch.worktreeId,
          mode,
          prompt: launch.prompt,
          skipPermissions: launch.skipPermissions,
        },
        { focusOnLaunch, skipCliCheck: true },
      );
    },
    [launchAgentFromAutoStart, startAgentSessionInBackground],
  );

  const handleInstallAgentCli = useCallback(async () => {
    const prompt = agentCliPrompt;
    if (!prompt || prompt.isInstalling) return;

    setAgentCliPrompt((prev) =>
      prev
        ? {
            ...prev,
            isInstalling: true,
            error: null,
          }
        : prev,
    );

    const installResult = await api.installAgentCli(prompt.pendingLaunch.agent);
    if (!installResult.success) {
      setAgentCliPrompt((prev) =>
        prev
          ? {
              ...prev,
              isInstalling: false,
              error: installResult.error ?? "Failed to install CLI via Homebrew.",
            }
          : prev,
      );
      return;
    }

    const status = await api.fetchAgentCliStatus(prompt.pendingLaunch.agent);
    if (!status.success || !status.installed) {
      setAgentCliPrompt((prev) =>
        prev
          ? {
              ...prev,
              isInstalling: false,
              error:
                status.error ??
                `Install finished, but "${prompt.command}" is still unavailable in PATH.`,
            }
          : prev,
      );
      return;
    }

    setAgentCliPrompt(null);
    continueAgentLaunch(prompt.pendingLaunch);
  }, [agentCliPrompt, api, continueAgentLaunch]);

  const continueAgentLaunchWithPermission = useCallback(
    (prompt: AgentPermissionPromptState, skipPermissions: boolean) => {
      if (prompt.agent === "claude") {
        const nextIntent: ClaudeLaunchIntent = {
          ...(prompt.intent as ClaudeLaunchIntent),
          skipPermissions,
        };
        continueAgentLaunch({
          agent: "claude",
          intent: nextIntent,
          options: prompt.options,
        });
        return;
      }
      if (prompt.agent === "codex") {
        const nextIntent: CodexLaunchIntent = {
          ...(prompt.intent as CodexLaunchIntent),
          skipPermissions,
        };
        continueAgentLaunch({
          agent: "codex",
          intent: nextIntent,
          options: prompt.options,
        });
        return;
      }
      if (prompt.agent === "gemini") {
        const nextIntent: GeminiLaunchIntent = {
          ...(prompt.intent as GeminiLaunchIntent),
          skipPermissions,
        };
        continueAgentLaunch({
          agent: "gemini",
          intent: nextIntent,
          options: prompt.options,
        });
        return;
      }
      const nextIntent: OpenCodeLaunchIntent = {
        ...(prompt.intent as OpenCodeLaunchIntent),
        skipPermissions,
      };
      continueAgentLaunch({
        agent: "opencode",
        intent: nextIntent,
        options: prompt.options,
      });
    },
    [continueAgentLaunch],
  );

  const persistSeenIssueIds = useCallback(
    (source: "jira" | "linear" | "local", seen: Set<string>) => {
      if (!serverUrl) return;
      const key = `${APP_NAME}:auto-claude-seen:${source}:${serverUrl}`;
      const ids = Array.from(seen);
      const trimmedIds = ids.slice(Math.max(0, ids.length - 500));
      localStorage.setItem(key, JSON.stringify(trimmedIds));
    },
    [serverUrl],
  );

  useEffect(() => {
    jiraAutoLaunchArmedRef.current = false;
    linearAutoLaunchArmedRef.current = false;
    localAutoLaunchArmedRef.current = false;
    if (!serverUrl) {
      jiraSeenIssueIdsRef.current = new Set();
      linearSeenIssueIdsRef.current = new Set();
      localSeenIssueIdsRef.current = new Set();
      return;
    }

    const loadSeenIssues = (source: "jira" | "linear" | "local"): Set<string> => {
      try {
        const raw = localStorage.getItem(`${APP_NAME}:auto-claude-seen:${source}:${serverUrl}`);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((item): item is string => typeof item === "string"));
      } catch {
        return new Set();
      }
    };

    jiraSeenIssueIdsRef.current = loadSeenIssues("jira");
    linearSeenIssueIdsRef.current = loadSeenIssues("linear");
    localSeenIssueIdsRef.current = loadSeenIssues("local");
  }, [serverUrl]);

  const enqueueAutoLaunch = useCallback(
    (launch: () => Promise<void>) => {
      logAutoClaude("Queueing auto-launch task");
      autoLaunchQueueRef.current = autoLaunchQueueRef.current
        .then(launch)
        .catch((error) => console.error("Auto Claude launch failed:", error));
    },
    [logAutoClaude],
  );

  const publishTaskDetectedActivity = useCallback(
    async (task: { source: "jira" | "linear" | "local"; issueId: string; title: string }) => {
      const result = await api.createActivityEvent({
        category: "agent",
        type: "task_detected",
        severity: "info",
        title: "New task found",
        detail: formatTaskNotificationDetail(task.issueId, task.title),
        groupKey: `task-detected:${task.source}:${task.issueId}`,
        metadata: {
          source: task.source,
          issueId: task.issueId,
          issueTitle: task.title,
        },
      });
      logAutoClaude("Published task-detected activity event", {
        source: task.source,
        issueId: task.issueId,
        success: result.success,
        error: result.error,
      });
    },
    [api, logAutoClaude],
  );

  const launchJiraIssueWithAutoStartAgent = useCallback(
    async (issue: { key: string; summary: string }) => {
      const agent = resolveAutoStartAgent(jiraStatus?.autoStartAgent);
      const skipPermissions = jiraStatus?.autoStartClaudeSkipPermissions ?? true;
      const focusTerminal = jiraStatus?.autoStartClaudeFocusTerminal ?? true;
      const prompt = `Implement Jira issue ${issue.key}${issue.summary ? ` (${issue.summary})` : ""}. You are already in the correct worktree. Read TASK.md first, then execute the task using the normal OpenKit flow: run pre-implementation hooks before coding, run required custom hooks when conditions match, and run post-implementation hooks before finishing. Treat AI context and todo checklist as highest-priority instructions. If you need user approval or instructions, run openkit activity await-input before asking.`;
      logAutoClaude("Starting Jira auto-launch", { issueKey: issue.key, agent });
      const result = await api.createFromJira(issue.key);
      logAutoClaude("Jira create-from-issue response received", {
        issueKey: issue.key,
        agent,
        success: result.success,
        code: result.code,
        worktreeId: result.worktreeId,
        error: result.error,
      });
      if (!result.success && !(result.code === "WORKTREE_EXISTS" && result.worktreeId)) {
        console.error(
          `Failed to auto-launch Jira issue ${issue.key}: ${result.error ?? "unknown"}`,
        );
        return;
      }
      const worktreeId = result.worktreeId ?? issue.key;
      const activityResult = await api.createActivityEvent({
        category: "agent",
        type: "auto_task_claimed",
        severity: "info",
        title: `${buildAgentLabel(agent)} started working on ${issue.key}`,
        detail: formatTaskNotificationDetail(issue.key, issue.summary),
        worktreeId,
        groupKey: `auto-task-claimed:${issue.key}`,
        metadata: {
          source: "jira",
          issueId: issue.key,
          issueTitle: issue.summary,
          autoClaimed: true,
          agent,
        },
      });
      logAutoClaude("Published Jira auto-claim activity event", {
        issueKey: issue.key,
        agent,
        worktreeId,
        success: activityResult.success,
        error: activityResult.error,
      });
      await launchAutoStartAgent(agent, {
        worktreeId,
        prompt,
        skipPermissions,
        focusTerminal,
      });
    },
    [
      api,
      jiraStatus?.autoStartAgent,
      jiraStatus?.autoStartClaudeFocusTerminal,
      jiraStatus?.autoStartClaudeSkipPermissions,
      launchAutoStartAgent,
      logAutoClaude,
    ],
  );

  const launchLinearIssueWithAutoStartAgent = useCallback(
    async (issue: { identifier: string; title: string }) => {
      const agent = resolveAutoStartAgent(linearStatus?.autoStartAgent);
      const skipPermissions = linearStatus?.autoStartClaudeSkipPermissions ?? true;
      const focusTerminal = linearStatus?.autoStartClaudeFocusTerminal ?? true;
      const prompt = `Implement Linear issue ${issue.identifier}${issue.title ? ` (${issue.title})` : ""}. You are already in the correct worktree. Read TASK.md first, then execute the task using the normal OpenKit flow: run pre-implementation hooks before coding, run required custom hooks when conditions match, and run post-implementation hooks before finishing. Treat AI context and todo checklist as highest-priority instructions. If you need user approval or instructions, run openkit activity await-input before asking.`;
      logAutoClaude("Starting Linear auto-launch", { identifier: issue.identifier, agent });
      const result = await api.createFromLinear(issue.identifier);
      logAutoClaude("Linear create-from-issue response received", {
        identifier: issue.identifier,
        agent,
        success: result.success,
        code: result.code,
        worktreeId: result.worktreeId,
        error: result.error,
      });
      if (!result.success && !(result.code === "WORKTREE_EXISTS" && result.worktreeId)) {
        console.error(
          `Failed to auto-launch Linear issue ${issue.identifier}: ${result.error ?? "unknown"}`,
        );
        return;
      }
      const worktreeId = result.worktreeId ?? issue.identifier;
      const activityResult = await api.createActivityEvent({
        category: "agent",
        type: "auto_task_claimed",
        severity: "info",
        title: `${buildAgentLabel(agent)} started working on ${issue.identifier}`,
        detail: formatTaskNotificationDetail(issue.identifier, issue.title),
        worktreeId,
        groupKey: `auto-task-claimed:${issue.identifier}`,
        metadata: {
          source: "linear",
          issueId: issue.identifier,
          issueTitle: issue.title,
          autoClaimed: true,
          agent,
        },
      });
      logAutoClaude("Published Linear auto-claim activity event", {
        identifier: issue.identifier,
        agent,
        worktreeId,
        success: activityResult.success,
        error: activityResult.error,
      });
      await launchAutoStartAgent(agent, {
        worktreeId,
        prompt,
        skipPermissions,
        focusTerminal,
      });
    },
    [
      api,
      launchAutoStartAgent,
      linearStatus?.autoStartAgent,
      linearStatus?.autoStartClaudeFocusTerminal,
      linearStatus?.autoStartClaudeSkipPermissions,
      logAutoClaude,
    ],
  );

  const launchLocalTaskWithAutoStartAgent = useCallback(
    async (task: { id: string; title: string }) => {
      const agent = resolveAutoStartAgent(config?.localAutoStartAgent);
      const skipPermissions = config?.localAutoStartClaudeSkipPermissions ?? true;
      const focusTerminal = config?.localAutoStartClaudeFocusTerminal ?? true;
      const prompt = `Implement local task ${task.id}${task.title ? ` (${task.title})` : ""}. You are already in the correct worktree. Read TASK.md first, then execute the normal OpenKit flow: run pre-implementation hooks before coding, run required custom hooks when conditions match, and run post-implementation hooks before finishing. Treat AI context and todo checklist as highest-priority instructions. If you need user approval or instructions, run openkit activity await-input before asking.`;
      logAutoClaude("Starting local task auto-launch", { taskId: task.id, agent });
      const result = await api.createWorktreeFromCustomTask(task.id);
      logAutoClaude("Local task create-worktree response received", {
        taskId: task.id,
        agent,
        success: result.success,
        code: result.code,
        worktreeId: result.worktreeId,
        error: result.error,
      });
      if (!result.success && !(result.code === "WORKTREE_EXISTS" && result.worktreeId)) {
        console.error(`Failed to auto-launch local task ${task.id}: ${result.error ?? "unknown"}`);
        return;
      }

      const worktreeId = result.worktreeId ?? task.id;
      const activityResult = await api.createActivityEvent({
        category: "agent",
        type: "auto_task_claimed",
        severity: "info",
        title: `${buildAgentLabel(agent)} started working on ${task.id}`,
        detail: formatTaskNotificationDetail(task.id, task.title),
        worktreeId,
        groupKey: `auto-task-claimed:${task.id}`,
        metadata: {
          source: "local",
          issueId: task.id,
          issueTitle: task.title,
          autoClaimed: true,
          agent,
        },
      });
      logAutoClaude("Published local task auto-claim activity event", {
        taskId: task.id,
        agent,
        worktreeId,
        success: activityResult.success,
        error: activityResult.error,
      });
      await launchAutoStartAgent(agent, {
        worktreeId,
        prompt,
        skipPermissions,
        focusTerminal,
      });
    },
    [
      api,
      config?.localAutoStartAgent,
      config?.localAutoStartClaudeFocusTerminal,
      config?.localAutoStartClaudeSkipPermissions,
      launchAutoStartAgent,
      logAutoClaude,
    ],
  );

  useEffect(() => {
    if (!jiraEnabled) return;
    const seen = jiraSeenIssueIdsRef.current;
    const hadSeenIssues = seen.size > 0;
    const newlyFetched = jiraIssues.filter((issue) => !seen.has(issue.key));
    if (newlyFetched.length > 0) {
      logAutoClaude("Detected newly fetched Jira issues", {
        count: newlyFetched.length,
        issueKeys: newlyFetched.map((issue) => issue.key),
      });
      for (const issue of newlyFetched) {
        void publishTaskDetectedActivity({
          source: "jira",
          issueId: issue.key,
          title: issue.summary,
        });
      }
    }
    for (const issue of jiraIssues) seen.add(issue.key);
    persistSeenIssueIds("jira", seen);

    if (!jiraStatus?.autoStartClaudeOnNewIssue) {
      jiraAutoLaunchArmedRef.current = false;
      if (newlyFetched.length > 0) {
        logAutoClaude("Jira auto-start is disabled; skipping newly fetched issues", {
          count: newlyFetched.length,
        });
      }
      return;
    }
    if (!jiraAutoLaunchArmedRef.current) {
      jiraAutoLaunchArmedRef.current = true;
      if (!hadSeenIssues) {
        logAutoClaude(
          "Jira auto-start armed with baseline issue snapshot; not launching historical issues",
          { baselineCount: jiraIssues.length },
        );
        return;
      }
    }
    for (const issue of newlyFetched) {
      logAutoClaude("Queueing Jira issue for auto-launch", { issueKey: issue.key });
      enqueueAutoLaunch(() => launchJiraIssueWithAutoStartAgent(issue));
    }
  }, [
    enqueueAutoLaunch,
    jiraEnabled,
    jiraIssues,
    jiraIssuesUpdatedAt,
    jiraStatus?.autoStartClaudeOnNewIssue,
    launchJiraIssueWithAutoStartAgent,
    logAutoClaude,
    persistSeenIssueIds,
    publishTaskDetectedActivity,
  ]);

  useEffect(() => {
    if (!linearEnabled) return;
    const seen = linearSeenIssueIdsRef.current;
    const hadSeenIssues = seen.size > 0;
    const newlyFetched = linearIssues.filter((issue) => !seen.has(issue.identifier));
    if (newlyFetched.length > 0) {
      logAutoClaude("Detected newly fetched Linear issues", {
        count: newlyFetched.length,
        identifiers: newlyFetched.map((issue) => issue.identifier),
      });
      for (const issue of newlyFetched) {
        void publishTaskDetectedActivity({
          source: "linear",
          issueId: issue.identifier,
          title: issue.title,
        });
      }
    }
    for (const issue of linearIssues) seen.add(issue.identifier);
    persistSeenIssueIds("linear", seen);

    if (!linearStatus?.autoStartClaudeOnNewIssue) {
      linearAutoLaunchArmedRef.current = false;
      if (newlyFetched.length > 0) {
        logAutoClaude("Linear auto-start is disabled; skipping newly fetched issues", {
          count: newlyFetched.length,
        });
      }
      return;
    }
    if (!linearAutoLaunchArmedRef.current) {
      linearAutoLaunchArmedRef.current = true;
      if (!hadSeenIssues) {
        logAutoClaude(
          "Linear auto-start armed with baseline issue snapshot; not launching historical issues",
          { baselineCount: linearIssues.length },
        );
        return;
      }
    }
    for (const issue of newlyFetched) {
      logAutoClaude("Queueing Linear issue for auto-launch", { identifier: issue.identifier });
      enqueueAutoLaunch(() => launchLinearIssueWithAutoStartAgent(issue));
    }
  }, [
    enqueueAutoLaunch,
    linearEnabled,
    linearIssues,
    linearIssuesUpdatedAt,
    linearStatus?.autoStartClaudeOnNewIssue,
    launchLinearIssueWithAutoStartAgent,
    logAutoClaude,
    persistSeenIssueIds,
    publishTaskDetectedActivity,
  ]);

  useEffect(() => {
    if (customTasksLoading) return;
    const seen = localSeenIssueIdsRef.current;
    const hadSeenIssues = seen.size > 0;
    const newlyFetched = customTasks.filter((task) => !seen.has(task.id));
    if (newlyFetched.length > 0) {
      logAutoClaude("Detected newly fetched local tasks", {
        count: newlyFetched.length,
        taskIds: newlyFetched.map((task) => task.id),
      });
      for (const task of newlyFetched) {
        void publishTaskDetectedActivity({
          source: "local",
          issueId: task.id,
          title: task.title,
        });
      }
    }
    for (const task of customTasks) seen.add(task.id);
    persistSeenIssueIds("local", seen);

    if (!config?.localAutoStartClaudeOnNewIssue) {
      localAutoLaunchArmedRef.current = false;
      if (newlyFetched.length > 0) {
        logAutoClaude("Local auto-start is disabled; skipping newly fetched tasks", {
          count: newlyFetched.length,
        });
      }
      return;
    }
    if (!localAutoLaunchArmedRef.current) {
      localAutoLaunchArmedRef.current = true;
      if (!hadSeenIssues) {
        logAutoClaude(
          "Local auto-start armed with baseline task snapshot; not launching historical tasks",
          { baselineCount: customTasks.length },
        );
        return;
      }
    }
    for (const task of newlyFetched) {
      logAutoClaude("Queueing local task for auto-launch", { taskId: task.id });
      enqueueAutoLaunch(() => launchLocalTaskWithAutoStartAgent(task));
    }
  }, [
    config?.localAutoStartClaudeOnNewIssue,
    customTasks,
    customTasksLoading,
    enqueueAutoLaunch,
    launchLocalTaskWithAutoStartAgent,
    logAutoClaude,
    persistSeenIssueIds,
    publishTaskDetectedActivity,
  ]);

  // Show welcome screen when no config (web mode) or no projects (Electron mode)
  if (showWelcomeScreen) {
    return (
      <div className={`h-screen relative flex flex-col ${surface.page} ${text.body}`}>
        <WelcomeScreen onImportProject={handleImportProject} />
        <div className="absolute bottom-0 left-0 right-0">
          <TabBar onOpenSettings={() => setShowSettingsModal(true)} />
        </div>
      </div>
    );
  }

  // Show loading state when we have projects but server isn't ready yet
  if (showLoadingState) {
    return (
      <div className={`h-screen flex flex-col ${surface.page} ${text.body}`}>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-[#2dd4bf] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <span className={`text-sm ${text.muted}`}>
              Starting {activeProject?.name ?? "project"}...
            </span>
          </div>
        </div>
        <TabBar onOpenSettings={() => setShowSettingsModal(true)} />
      </div>
    );
  }

  // Show error screen when project failed to start
  if (showErrorState && activeProject) {
    return (
      <div className={`h-screen flex flex-col ${surface.page} ${text.body}`}>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div
              className={`w-14 h-14 rounded-2xl ${errorBanner.bg} flex items-center justify-center mx-auto mb-4`}
            >
              <AlertTriangle className="w-7 h-7 text-red-400" />
            </div>
            <h2 className={`text-lg font-semibold ${text.primary} mb-2`}>
              Failed to start {activeProject.name}
            </h2>
            {activeProject.error && (
              <p className={`text-sm ${text.muted} mb-6`}>{activeProject.error}</p>
            )}
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 ${button.primary}`}
                onClick={async () => {
                  const dir = activeProject.projectDir;
                  await closeProject(activeProject.id);
                  await openProject(dir);
                }}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
              <button
                type="button"
                className={`px-4 py-2 rounded-lg text-sm ${button.secondary}`}
                onClick={() => closeProject(activeProject.id)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
        <TabBar onOpenSettings={() => setShowSettingsModal(true)} />
      </div>
    );
  }

  // Show setup screen when config is missing (Electron only)
  if (needsSetup) {
    return (
      <div className={`h-screen flex flex-col ${surface.page} ${text.body}`}>
        <ProjectSetupScreen
          projectName={projectName ?? activeProject?.name ?? null}
          onSetupComplete={handleSetupComplete}
          onRememberChoice={handleRememberChoice}
        />
        <TabBar onOpenSettings={() => setShowSettingsModal(true)} />
      </div>
    );
  }

  // Show auto-init loading state
  if (isAutoInitializing) {
    return (
      <div className={`h-screen flex flex-col ${surface.page} ${text.body}`}>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-[#2dd4bf] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <span className={`text-sm ${text.muted}`}>
              Setting up {activeProject?.name ?? "project"}...
            </span>
          </div>
        </div>
        <TabBar onOpenSettings={() => setShowSettingsModal(true)} />
      </div>
    );
  }

  return (
    <div className={`h-screen flex flex-col ${surface.page} ${text.body} relative overflow-hidden`}>
      {/* Animated background blobs — settings/integrations/hooks only */}
      {(activeView === "configuration" ||
        activeView === "integrations" ||
        activeView === "hooks") && (
        <div className="fixed inset-0 pointer-events-none z-0">
          <div
            className="absolute w-[1400px] h-[1000px] rounded-full"
            style={{
              background: "radial-gradient(ellipse, rgba(45,212,191,0.045) 0%, transparent 55%)",
              top: "40%",
              left: "5%",
              animation: "blob-drift-1 14s ease-in-out infinite",
            }}
          />
          <div
            className="absolute w-[800px] h-[700px] rounded-full"
            style={{
              background: "radial-gradient(ellipse, rgba(139,92,246,0.045) 0%, transparent 55%)",
              top: "10%",
              left: "70%",
              animation: "blob-drift-2 16s ease-in-out infinite",
            }}
          />
          <div
            className="absolute w-[800px] h-[500px] rounded-full"
            style={{
              background: "radial-gradient(ellipse, rgba(59,130,246,0.035) 0%, transparent 55%)",
              top: "75%",
              left: "35%",
              animation: "blob-drift-3 15s ease-in-out infinite",
            }}
          />
          <div
            className="absolute w-[900px] h-[900px] rounded-full"
            style={{
              background: "radial-gradient(ellipse, rgba(236,72,153,0.035) 0%, transparent 55%)",
              top: "20%",
              left: "30%",
              animation: "blob-drift-4 18s ease-in-out infinite",
            }}
          />
          <div
            className="absolute w-[1000px] h-[800px] rounded-full"
            style={{
              background: "radial-gradient(ellipse, rgba(251,191,36,0.025) 0%, transparent 55%)",
              top: "60%",
              left: "75%",
              animation: "blob-drift-5 13s ease-in-out infinite",
            }}
          />
          <style>{`
            @keyframes blob-drift-1 {
              0% { transform: translate(0,0) scale(1) rotate(0deg); }
              17% { transform: translate(60px,25px) scale(1.04) rotate(5deg); }
              33% { transform: translate(80px,-30px) scale(1.07) rotate(10deg); }
              50% { transform: translate(20px,-70px) scale(1.02) rotate(6deg); }
              67% { transform: translate(-40px,-40px) scale(0.96) rotate(-2deg); }
              83% { transform: translate(-30px,20px) scale(0.98) rotate(-4deg); }
              100% { transform: translate(0,0) scale(1) rotate(0deg); }
            }
            @keyframes blob-drift-2 {
              0% { transform: translate(0,0) scale(1) rotate(0deg); }
              17% { transform: translate(-30px,-40px) scale(0.97) rotate(-4deg); }
              33% { transform: translate(-70px,-20px) scale(1.04) rotate(-8deg); }
              50% { transform: translate(-60px,40px) scale(1.06) rotate(-3deg); }
              67% { transform: translate(-10px,70px) scale(0.98) rotate(3deg); }
              83% { transform: translate(30px,30px) scale(1.02) rotate(6deg); }
              100% { transform: translate(0,0) scale(1) rotate(0deg); }
            }
            @keyframes blob-drift-3 {
              0% { transform: translate(0,0) scale(1) rotate(0deg); }
              17% { transform: translate(-25px,50px) scale(1.05) rotate(4deg); }
              33% { transform: translate(-65px,30px) scale(0.97) rotate(8deg); }
              50% { transform: translate(-50px,-30px) scale(1.03) rotate(3deg); }
              67% { transform: translate(10px,-60px) scale(0.95) rotate(-4deg); }
              83% { transform: translate(40px,-20px) scale(1.06) rotate(-7deg); }
              100% { transform: translate(0,0) scale(1) rotate(0deg); }
            }
            @keyframes blob-drift-4 {
              0% { transform: translate(0,0) scale(1) rotate(0deg); }
              17% { transform: translate(35px,-45px) scale(1.03) rotate(-5deg); }
              33% { transform: translate(70px,-15px) scale(0.96) rotate(-9deg); }
              50% { transform: translate(55px,45px) scale(1.05) rotate(-4deg); }
              67% { transform: translate(10px,65px) scale(0.98) rotate(2deg); }
              83% { transform: translate(-25px,25px) scale(1.04) rotate(6deg); }
              100% { transform: translate(0,0) scale(1) rotate(0deg); }
            }
            @keyframes blob-drift-5 {
              0% { transform: translate(0,0) scale(1) rotate(0deg); }
              17% { transform: translate(20px,45px) scale(0.97) rotate(5deg); }
              33% { transform: translate(-25px,70px) scale(1.04) rotate(8deg); }
              50% { transform: translate(-65px,35px) scale(1.06) rotate(4deg); }
              67% { transform: translate(-50px,-20px) scale(0.95) rotate(-3deg); }
              83% { transform: translate(-15px,-10px) scale(1.02) rotate(-5deg); }
              100% { transform: translate(0,0) scale(1) rotate(0deg); }
            }
          `}</style>
        </div>
      )}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}>
        <Header
          activeView={activeView}
          onChangeView={setActiveView}
          currentProjectName={projectName ?? activeProject?.name ?? null}
          disabledActivityEventTypes={config?.activity?.disabledEvents ?? []}
          onNavigateToWorktree={({
            worktreeId,
            projectName: navProjectName,
            sourceServerUrl,
            openClaudeTab,
            openHooksTab,
          }) => {
            setActiveView("workspace");
            const targetProjectId = resolveProjectIdFromNotification(
              navProjectName,
              sourceServerUrl,
            );
            if (targetProjectId && targetProjectId !== activeProject?.id) {
              setPendingNotificationNav({
                worktreeId,
                targetProjectId,
                openClaudeTab,
                openHooksTab,
              });
              switchProject(targetProjectId);
              return;
            }
            setSelection({ type: "worktree", id: worktreeId });
            if (openClaudeTab) {
              setPendingClaudeLaunches((prev) => [...prev, { worktreeId, mode: "resume" }]);
            }
            if (openHooksTab) {
              notificationTabRequestIdRef.current += 1;
              setNotificationTabRequest({
                worktreeId,
                tab: "hooks",
                requestId: notificationTabRequestIdRef.current,
              });
            }
          }}
          onNavigateToIssue={({
            source,
            issueId,
            projectName: navProjectName,
            sourceServerUrl,
          }) => {
            setActiveView("workspace");
            setActiveCreateTab("issues");
            const targetProjectId = resolveProjectIdFromNotification(
              navProjectName,
              sourceServerUrl,
            );
            if (targetProjectId && targetProjectId !== activeProject?.id) {
              setPendingIssueNotificationNav({ source, issueId, targetProjectId });
              switchProject(targetProjectId);
              return;
            }
            if (source === "jira") {
              setSelection({ type: "issue", key: issueId });
              return;
            }
            setSelection({ type: "linear-issue", identifier: issueId });
          }}
        />
      </motion.div>

      {error && (
        <div className={`flex-shrink-0 px-4 py-2 ${errorBanner.bg} ${text.errorBanner} text-xs`}>
          {error}
        </div>
      )}

      {(activeView === "workspace" || activeView === "agents") && (
        <div className="flex-1 min-h-0 relative">
          {activeView === "workspace" && (
            <div className="absolute inset-0 flex px-5 pb-16">
              {/* Left sidebar */}
              <aside
                style={{ width: sidebarWidth }}
                className={`flex-shrink-0 flex flex-col ${surface.panel} rounded-xl overflow-hidden`}
              >
                <CreateForm
                  jiraConfigured={jiraStatus?.configured ?? false}
                  linearConfigured={linearStatus?.configured ?? false}
                  activeTab={activeCreateTab}
                  onTabChange={setActiveCreateTab}
                  onCreateWorktree={() => {
                    setCreateModalMode("branch");
                    setShowCreateModal(true);
                  }}
                  onCreateFromJira={() => {
                    setCreateModalMode("jira");
                    setShowCreateModal(true);
                  }}
                  onCreateFromLinear={() => {
                    setCreateModalMode("linear");
                    setShowCreateModal(true);
                  }}
                  onCreateCustomTask={() => {
                    setCreateModalMode("custom");
                    setShowCreateModal(true);
                  }}
                  onNavigateToIntegrations={() => setActiveView("integrations")}
                />

                {/* Shared search bar */}
                <div className="px-3 pt-2 pb-3">
                  <div className="relative">
                    <Search
                      className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${text.dimmed}`}
                    />
                    <input
                      type="text"
                      value={activeCreateTab === "branch" ? worktreeFilter : jiraSearchQuery}
                      onChange={(e) => {
                        if (activeCreateTab === "branch") {
                          setWorktreeFilter(e.target.value);
                        } else {
                          setJiraSearchQuery(e.target.value);
                          setLinearSearchQuery(e.target.value);
                        }
                      }}
                      placeholder={
                        activeCreateTab === "branch" ? "Filter worktrees..." : "Search issues..."
                      }
                      className={`w-full pl-8 pr-2.5 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md ${input.text} placeholder-[#4b5563] text-xs focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.15] transition-all duration-150`}
                    />
                  </div>
                </div>

                <AnimatePresence mode="wait" initial={false}>
                  {activeCreateTab === "branch" ? (
                    <motion.div
                      key="worktree-list"
                      className="flex-1 min-h-0 flex flex-col"
                      initial={{ opacity: 0, x: -40 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -40 }}
                      transition={{ duration: 0.075, ease: "easeInOut" }}
                    >
                      <WorktreeList
                        worktrees={worktrees}
                        selectedId={selection?.type === "worktree" ? selection.id : null}
                        onSelect={(id) => setSelection({ type: "worktree", id })}
                        filter={worktreeFilter}
                        localIssueLinkedIds={localIssueLinkedIds}
                        onSelectJiraIssue={(key) => {
                          setActiveCreateTab("issues");
                          setSelection({ type: "issue", key });
                        }}
                        onSelectLinearIssue={(identifier) => {
                          setActiveCreateTab("issues");
                          setSelection({ type: "linear-issue", identifier });
                        }}
                        onSelectLocalIssue={(identifier) => {
                          const task = customTasks.find((t) => t.id === identifier);
                          if (task) {
                            setActiveCreateTab("issues");
                            setSelection({ type: "custom-task", id: task.id });
                          }
                        }}
                      />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="issue-list"
                      className="flex-1 min-h-0 flex flex-col"
                      initial={{ opacity: 0, x: 40 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 40 }}
                      transition={{ duration: 0.075, ease: "easeInOut" }}
                    >
                      <IssueList
                        issues={jiraIssues}
                        selectedKey={selection?.type === "issue" ? selection.key : null}
                        onSelect={(key) => setSelection({ type: "issue", key })}
                        isLoading={jiraIssuesLoading}
                        isFetching={jiraIssuesFetching}
                        error={jiraError}
                        onRefreshJira={() => refetchJiraIssues()}
                        jiraUpdatedAt={jiraIssuesUpdatedAt}
                        linearIssues={linearIssues}
                        linearConfigured={linearStatus?.configured ?? false}
                        linearLoading={linearIssuesLoading}
                        linearFetching={linearIssuesFetching}
                        linearError={linearError}
                        selectedLinearIdentifier={
                          selection?.type === "linear-issue" ? selection.identifier : null
                        }
                        onSelectLinear={(identifier) =>
                          setSelection({ type: "linear-issue", identifier })
                        }
                        onRefreshLinear={() => refetchLinearIssues()}
                        linearUpdatedAt={linearIssuesUpdatedAt}
                        customTasks={customTasks}
                        customTasksLoading={customTasksLoading}
                        customTasksError={customTasksError}
                        selectedCustomTaskId={
                          selection?.type === "custom-task" ? selection.id : null
                        }
                        onSelectCustomTask={(id) => setSelection({ type: "custom-task", id })}
                        worktrees={worktrees}
                        onViewWorktree={handleViewWorktreeFromJira}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </aside>

              {/* Resize handle */}
              <div className="px-[9px]">
                <ResizableHandle
                  onResize={handleSidebarResize}
                  onResizeEnd={handleSidebarResizeEnd}
                />
              </div>

              {/* Right panel */}
              <main
                className={`flex-1 min-w-0 flex flex-col ${surface.panel} rounded-xl overflow-hidden`}
              >
                {!wsBannerDismissed && (
                  <div className="flex-shrink-0 h-14 flex items-center gap-3 px-4 border-b border-teal-400/20 bg-teal-400/[0.04]">
                    <GitBranch className="w-4 h-4 text-teal-400 flex-shrink-0" />
                    <p className={`text-[11px] ${text.secondary} leading-relaxed flex-1`}>
                      Your local development workspace. Create worktrees from branches, issue
                      trackers, or local tasks. Connect integrations to pull issues directly into
                      your workflow.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveView("integrations")}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-teal-300 bg-teal-400/10 hover:bg-teal-400/20 border border-teal-400/20 rounded-lg transition-colors flex-shrink-0"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Add Integrations
                    </button>
                    <button
                      type="button"
                      onClick={dismissWsBanner}
                      className="p-1 rounded-md hover:bg-teal-400/10 text-teal-400/40 hover:text-teal-400/70 transition-colors flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {selection?.type === "issue" ? (
                  <JiraDetailPanel
                    issueKey={selection.key}
                    linkedWorktreeId={selectedJiraWorktree?.id ?? null}
                    linkedWorktreePrUrl={selectedJiraWorktree?.githubPrUrl ?? null}
                    activeWorktreeIds={activeWorktreeIds}
                    onCreateWorktree={handleCreateWorktreeFromJira}
                    onViewWorktree={handleViewWorktreeFromJira}
                    onCodeWithClaude={handleCodeWithClaude}
                    onCodeWithCodex={handleCodeWithCodex}
                    onCodeWithGemini={handleCodeWithGemini}
                    onCodeWithOpenCode={handleCodeWithOpenCode}
                    selectedCodingAgent={defaultCodingAgent}
                    onSelectCodingAgent={setDefaultCodingAgent}
                    refreshIntervalMinutes={refreshIntervalMinutes}
                    onSetupNeeded={handleSetupNeeded}
                  />
                ) : selection?.type === "linear-issue" ? (
                  <LinearDetailPanel
                    identifier={selection.identifier}
                    linkedWorktreeId={selectedLinearWorktree?.id ?? null}
                    linkedWorktreePrUrl={selectedLinearWorktree?.githubPrUrl ?? null}
                    activeWorktreeIds={activeWorktreeIds}
                    onCreateWorktree={handleCreateWorktreeFromLinear}
                    onViewWorktree={handleViewWorktreeFromLinear}
                    onCodeWithClaude={handleCodeWithClaude}
                    onCodeWithCodex={handleCodeWithCodex}
                    onCodeWithGemini={handleCodeWithGemini}
                    onCodeWithOpenCode={handleCodeWithOpenCode}
                    selectedCodingAgent={defaultCodingAgent}
                    onSelectCodingAgent={setDefaultCodingAgent}
                    refreshIntervalMinutes={linearRefreshIntervalMinutes}
                    onSetupNeeded={handleSetupNeeded}
                  />
                ) : selection?.type === "custom-task" ? (
                  <CustomTaskDetailPanel
                    taskId={selection.id}
                    activeWorktreeIds={activeWorktreeIds}
                    onDeleted={() => setSelection(null)}
                    onCreateWorktree={handleCreateWorktreeFromCustomTask}
                    onViewWorktree={handleViewWorktreeFromCustomTask}
                    onCodeWithClaude={handleCodeWithClaude}
                    onCodeWithCodex={handleCodeWithCodex}
                    onCodeWithGemini={handleCodeWithGemini}
                    onCodeWithOpenCode={handleCodeWithOpenCode}
                    selectedCodingAgent={defaultCodingAgent}
                    onSelectCodingAgent={setDefaultCodingAgent}
                  />
                ) : (
                  <DetailPanel
                    worktree={selectedWorktree}
                    onUpdate={refetch}
                    onDeleted={handleDeleted}
                    hookUpdateKey={hookUpdateKey}
                    onNavigateToIntegrations={() => setActiveView("integrations")}
                    onNavigateToHooks={() => setActiveView("hooks")}
                    onSelectJiraIssue={(key) => {
                      setActiveCreateTab("issues");
                      setSelection({ type: "issue", key });
                    }}
                    onSelectLinearIssue={(identifier) => {
                      setActiveCreateTab("issues");
                      setSelection({ type: "linear-issue", identifier });
                    }}
                    onSelectLocalIssue={(identifier) => {
                      const task = customTasks.find((t) => t.id === identifier);
                      if (task) {
                        setActiveCreateTab("issues");
                        setSelection({ type: "custom-task", id: task.id });
                      }
                    }}
                    onCreateTask={(worktreeId) => {
                      setCreateTaskForWorktreeId(worktreeId);
                      setCreateModalMode("custom");
                      setShowCreateModal(true);
                    }}
                    onLinkIssue={(worktreeId) => setLinkIssueForWorktreeId(worktreeId)}
                    claudeLaunchRequest={claudeLaunchRequest}
                    codexLaunchRequest={codexLaunchRequest}
                    geminiLaunchRequest={geminiLaunchRequest}
                    opencodeLaunchRequest={opencodeLaunchRequest}
                    notificationTabRequest={notificationTabRequest}
                  />
                )}
              </main>
            </div>
          )}

          {activeView === "agents" && <AgentsView />}
        </div>
      )}

      {(activeView === "configuration" ||
        activeView === "integrations" ||
        activeView === "hooks") && (
        <div className="flex-1 min-h-0 overflow-y-auto -mt-12 pt-12 pb-20">
          {activeView === "configuration" && (
            <ConfigurationPanel
              config={config}
              onSaved={refetchConfig}
              isConnected={isConnected}
              jiraConfigured={jiraStatus?.configured ?? false}
              linearConfigured={linearStatus?.configured ?? false}
              onNavigateToIntegrations={() => setActiveView("integrations")}
            />
          )}

          {activeView === "integrations" && (
            <IntegrationsPanel
              onJiraStatusChange={refetchJiraStatus}
              onLinearStatusChange={refetchLinearStatus}
            />
          )}

          {activeView === "hooks" && <HooksPanel />}
        </div>
      )}

      {/* Setup error banner */}
      {setupError && (
        <div
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 ${errorBanner.bg} ${text.errorBanner} text-xs rounded-lg shadow-lg`}
        >
          {setupError}
        </div>
      )}

      {/* GitHub setup modal */}
      {showSetupModal && (
        <GitHubSetupModal
          needsCommit={needsCommit ?? false}
          needsRepo={needsRepo ?? false}
          onAutoSetup={handleAutoSetup}
          onManual={() => setShowSetupModal(false)}
        />
      )}

      {/* Setup commit modal for OpenKit config files */}
      {showSetupCommitModal && (
        <SetupCommitModal
          onCommit={handleSetupCommit}
          onSkip={() => setShowSetupCommitModal(false)}
        />
      )}

      {/* Create worktree modal */}
      {showCreateModal && createModalMode !== "custom" && (
        <CreateWorktreeModal
          mode={createModalMode as "branch" | "jira" | "linear"}
          hasBranchNameRule={hasBranchNameRule}
          onCreated={refetch}
          onClose={() => setShowCreateModal(false)}
          onSetupNeeded={handleSetupNeeded}
        />
      )}

      {/* Create custom task modal */}
      {showCreateModal && createModalMode === "custom" && (
        <CreateCustomTaskModal
          onCreate={(data) => api.createCustomTask(data)}
          onUploadAttachment={(taskId, file) => api.uploadTaskAttachment(taskId, file)}
          linkedWorktreeId={createTaskForWorktreeId ?? undefined}
          onCreated={(taskId) => {
            refetchCustomTasks();
            refetch();
            setActiveCreateTab("issues");
            if (taskId) setSelection({ type: "custom-task", id: taskId });
          }}
          onClose={() => {
            setShowCreateModal(false);
            setCreateTaskForWorktreeId(null);
          }}
        />
      )}

      {/* Link issue modal */}
      {linkIssueForWorktreeId && (
        <LinkIssueModal
          jiraConfigured={jiraStatus?.configured ?? false}
          linearConfigured={linearStatus?.configured ?? false}
          onLink={async (source, issueId) => {
            const result = await api.linkWorktree(linkIssueForWorktreeId, source, issueId);
            if (result.success) {
              refetch();
              refetchCustomTasks();
            }
            return result;
          }}
          onClose={() => setLinkIssueForWorktreeId(null)}
        />
      )}

      {agentCliPrompt && (
        <Modal
          title={`${getAgentCliLabel(agentCliPrompt.pendingLaunch.agent)} Required`}
          icon={<Download className="w-4 h-4" />}
          width="sm"
          onClose={() => setAgentCliPrompt(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setAgentCliPrompt(null)}
                disabled={agentCliPrompt.isInstalling}
                className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleInstallAgentCli()}
                disabled={agentCliPrompt.isInstalling}
                className={`px-3 py-1.5 text-xs font-medium ${button.primary} rounded-lg transition-colors disabled:opacity-50`}
              >
                {agentCliPrompt.isInstalling ? "Installing..." : "Install"}
              </button>
            </>
          }
        >
          <p className={`text-xs ${text.secondary} leading-relaxed`}>
            {getAgentCliLabel(agentCliPrompt.pendingLaunch.agent)} is required in order to use this
            functionality.
          </p>
          {agentCliPrompt.error && (
            <p className={`text-[11px] ${text.error} mt-2 leading-relaxed`}>
              {agentCliPrompt.error}
            </p>
          )}
          <p className={`text-[11px] ${text.muted} mt-2 leading-relaxed`}>
            OpenKit will run{" "}
            <code className="inline-flex items-center rounded-sm border border-white/[0.12] bg-black/40 px-1.5 py-0.5 text-[11px] font-mono text-white">
              {`brew install ${agentCliPrompt.brewPackage}`}
            </code>{" "}
            automatically.
          </p>
        </Modal>
      )}

      {agentPermissionPrompt && (
        <Modal
          title={`${AGENT_DISPLAY_NAMES[agentPermissionPrompt.agent]} Permissions`}
          icon={<ShieldAlert className="w-4 h-4 text-amber-400" />}
          width="sm"
          onClose={() => setAgentPermissionPrompt(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setAgentPermissionPrompt(null)}
                className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!agentPermissionPrompt) return;
                  setAgentPermissionPrompt(null);
                  continueAgentLaunchWithPermission(agentPermissionPrompt, false);
                }}
                className={`px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors`}
              >
                Run Safely
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!agentPermissionPrompt) return;
                  setAgentPermissionPrompt(null);
                  continueAgentLaunchWithPermission(agentPermissionPrompt, true);
                }}
                className={`px-3 py-1.5 text-xs font-medium ${button.warning} rounded-lg transition-colors`}
              >
                Skip Permissions
              </button>
            </>
          }
        >
          <p className={`text-xs ${text.secondary} leading-relaxed`}>
            Run {AGENT_DISPLAY_NAMES[agentPermissionPrompt.agent]} with{" "}
            <code>{AGENT_SKIP_PERMISSION_FLAGS[agentPermissionPrompt.agent]}</code> for this launch?
          </p>
          <p className={`text-[11px] ${text.muted} mt-2 leading-relaxed`}>
            Use this only when you trust the task context and want{" "}
            {AGENT_DISPLAY_NAMES[agentPermissionPrompt.agent]} to run without approval prompts.
          </p>
        </Modal>
      )}

      {/* App settings modal (Electron only) */}
      {showSettingsModal && <AppSettingsModal onClose={() => setShowSettingsModal(false)} />}

      {/* Tab bar for multi-project (Electron only) */}
      <div className="absolute bottom-0 left-0 right-0 z-40">
        <TabBar onOpenSettings={() => setShowSettingsModal(true)} />
      </div>
    </div>
  );
}
