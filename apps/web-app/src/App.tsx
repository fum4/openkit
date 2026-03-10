import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Download,
  GitBranch,
  Loader2,
  Link2,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { APP_NAME } from "@openkit/shared/constants";
import { AppSettingsModal } from "./components/AppSettingsModal";
import {
  OPENKIT_ERROR_TOAST_EVENT,
  reportDetailedErrorToast,
  reportPersistentErrorToast,
  showPersistentErrorToast,
  type ErrorToastEventDetail,
} from "./errorToasts";
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
import { ActivityPage } from "./components/ActivityPage";
import { ProjectSetupScreen } from "./components/ProjectSetupScreen";
import { HooksPanel } from "./components/VerificationPanel";
import { ResizableHandle } from "./components/ResizableHandle";
import { SetupCommitModal } from "./components/SetupCommitModal";
import type { View } from "./components/NavBar";
import type { WorktreeInfo } from "./types";
import { TabBar } from "./components/TabBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { SidebarConfigBar } from "./components/SidebarConfigBar";
import { WorktreeList } from "./components/WorktreeList";
import { Modal } from "./components/Modal";
import { useServer } from "./contexts/ServerContext";
import { createOpsLogEvent as createOpsLogEventRaw } from "./hooks/api";
import { useApi } from "./hooks/useApi";
import { useConfig } from "./hooks/useConfig";
import { useLocalConfig } from "./hooks/useLocalConfig";
import { useShortcuts } from "./hooks/useShortcuts";
import type { ShortcutEvent } from "./shortcuts";
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

type WorkspaceStorageSuffix = "wsSel" | "wsTab" | "view";

type AgentLaunchMode = "resume" | "resume-active" | "resume-history" | "start" | "start-new";

interface AgentLaunchIntentBase {
  worktreeId: string;
  mode: AgentLaunchMode;
  prompt?: string;
  tabLabel?: string;
  skipPermissions?: boolean;
  sessionId?: string;
}

interface ClaudeLaunchIntent extends AgentLaunchIntentBase {
  startInBackground?: boolean;
}

type ClaudeLaunchRequest = ClaudeLaunchIntent & {
  requestId: number;
};

type CodexLaunchIntent = AgentLaunchIntentBase;
type GeminiLaunchIntent = AgentLaunchIntentBase;
type OpenCodeLaunchIntent = AgentLaunchIntentBase;

type AgentLaunchRequestBase = AgentLaunchIntentBase & {
  requestId: number;
};

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

interface PendingNotificationNavState {
  worktreeId: string;
  targetProjectId: string | null;
  openClaudeTab?: boolean;
  openHooksTab?: boolean;
}

interface PendingIssueNotificationNavState {
  source: "jira" | "linear" | "local";
  issueId: string;
  targetProjectId: string | null;
}

interface RuntimeScopedState {
  pendingClaudeLaunches: ClaudeLaunchIntent[];
  pendingCodexLaunches: CodexLaunchIntent[];
  pendingGeminiLaunches: GeminiLaunchIntent[];
  pendingOpenCodeLaunches: OpenCodeLaunchIntent[];
  claudeLaunchRequest: ClaudeLaunchRequest | null;
  codexLaunchRequest: CodexLaunchRequest | null;
  geminiLaunchRequest: GeminiLaunchRequest | null;
  opencodeLaunchRequest: OpenCodeLaunchRequest | null;
  pendingNotificationNav: PendingNotificationNavState | null;
  pendingIssueNotificationNav: PendingIssueNotificationNavState | null;
  notificationTabRequest: NotificationTabRequest | null;
  agentPermissionPrompt: AgentPermissionPromptState | null;
  agentCliPrompt: AgentCliPromptState | null;
  claudeLaunchRequestIdCounter: number;
  codexLaunchRequestIdCounter: number;
  geminiLaunchRequestIdCounter: number;
  openCodeLaunchRequestIdCounter: number;
  notificationTabRequestIdCounter: number;
}

function createEmptyRuntimeScopedState(): RuntimeScopedState {
  return {
    pendingClaudeLaunches: [],
    pendingCodexLaunches: [],
    pendingGeminiLaunches: [],
    pendingOpenCodeLaunches: [],
    claudeLaunchRequest: null,
    codexLaunchRequest: null,
    geminiLaunchRequest: null,
    opencodeLaunchRequest: null,
    pendingNotificationNav: null,
    pendingIssueNotificationNav: null,
    notificationTabRequest: null,
    agentPermissionPrompt: null,
    agentCliPrompt: null,
    claudeLaunchRequestIdCounter: 0,
    codexLaunchRequestIdCounter: 0,
    geminiLaunchRequestIdCounter: 0,
    openCodeLaunchRequestIdCounter: 0,
    notificationTabRequestIdCounter: 0,
  };
}

const AUTO_CLAUDE_DEBUG_PREFIX = "[AUTO-CLAUDE][TEMP]";
const APP_DEBUG_PREFIX = "[app][TEMP]";
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
const LAUNCH_TARGET_WAIT_TIMEOUT_MS = 60_000;

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

function isStartLaunchMode(mode: AgentLaunchMode): boolean {
  return mode === "start" || mode === "start-new";
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
    useCallback((message: string, level: "error" | "info") => {
      if (level === "error") {
        showPersistentErrorToast(message, { scope: "sse:notification" });
      }
    }, []),
    useCallback(() => setHookUpdateKey((k) => k + 1), []),
  );

  useEffect(() => {
    const handleErrorToast = (event: Event) => {
      const detail = (event as CustomEvent<ErrorToastEventDetail>).detail;
      if (!detail || typeof detail.message !== "string") return;

      void createOpsLogEventRaw(
        {
          source: "ui.toast",
          action: "toast.error",
          level: "error",
          status: "failed",
          message: detail.message,
          metadata: {
            scope: detail.scope ?? null,
          },
        },
        serverUrl,
      );
    };

    window.addEventListener(OPENKIT_ERROR_TOAST_EVENT, handleErrorToast as EventListener);
    return () =>
      window.removeEventListener(OPENKIT_ERROR_TOAST_EVENT, handleErrorToast as EventListener);
  }, [serverUrl]);

  const {
    config,
    projectName,
    hasBranchNameRule,
    isLoading: configLoading,
    refetch: refetchConfig,
  } = useConfig();
  const { localConfig, refetch: refetchLocalConfig } = useLocalConfig();
  const { jiraStatus, refetchJiraStatus } = useJiraStatus();
  const { linearStatus, refetchLinearStatus } = useLinearStatus();
  const githubStatus = useGitHubStatus();
  const {
    tasks: customTasks,
    isLoading: customTasksLoading,
    isFetching: customTasksFetching,
    error: customTasksError,
    refetch: refetchCustomTasks,
    updatedAt: customTasksUpdatedAt,
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
        window.electronAPI
          ?.getSetupPreference()
          .then(async (pref) => {
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
          })
          .catch((error) => {
            reportPersistentErrorToast(error, "Failed to load setup preference", {
              scope: "app:setup-preference",
            });
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
    const scopedKeySource = isElectron ? activeProject?.id : serverUrl;
    if (scopedKeySource) {
      localStorage.removeItem(`OpenKit:wsSel:${scopedKeySource}`);
      localStorage.removeItem(`OpenKit:wsTab:${scopedKeySource}`);
      localStorage.removeItem(`OpenKit:view:${scopedKeySource}`);
    }
    if (isElectron && serverUrl) {
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

  const workspaceStorageScope = isElectron ? (activeProject?.id ?? null) : serverUrl;
  const runtimeScopeKey = isElectron
    ? `project:${activeProject?.id ?? "__none__"}`
    : `server:${serverUrl ?? "__relative__"}`;
  const workspaceStorageKey = useCallback(
    (suffix: WorkspaceStorageSuffix): string | null =>
      workspaceStorageScope ? `OpenKit:${suffix}:${workspaceStorageScope}` : null,
    [workspaceStorageScope],
  );
  const legacyServerWorkspaceKey = useCallback(
    (suffix: WorkspaceStorageSuffix): string | null =>
      serverUrl ? `OpenKit:${suffix}:${serverUrl}` : null,
    [serverUrl],
  );
  const readWorkspaceStorageValue = useCallback(
    (suffix: WorkspaceStorageSuffix): string | null => {
      const scopedKey = workspaceStorageKey(suffix);
      if (!scopedKey) return null;

      const scopedValue = localStorage.getItem(scopedKey);
      if (scopedValue !== null) return scopedValue;

      if (!isElectron || !activeProject?.id) return null;

      const legacyKey = legacyServerWorkspaceKey(suffix);
      if (!legacyKey) return null;
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue !== null) {
        localStorage.setItem(scopedKey, legacyValue);
      }
      return legacyValue;
    },
    [activeProject?.id, isElectron, legacyServerWorkspaceKey, workspaceStorageKey],
  );

  const [activeView, setActiveViewState] = useState<View>(() => {
    const saved = readWorkspaceStorageValue("view");
    if (
      saved === "workspace" ||
      saved === "agents" ||
      saved === "activity" ||
      saved === "hooks" ||
      saved === "configuration" ||
      saved === "integrations"
    ) {
      return saved;
    }
    return "workspace";
  });

  const setActiveView = (view: View) => {
    setActiveViewState(view);
    const storageKey = workspaceStorageKey("view");
    if (storageKey) {
      localStorage.setItem(storageKey, view);
    }
  };

  // Restore view when switching projects
  useEffect(() => {
    const saved = readWorkspaceStorageValue("view");
    if (
      saved === "workspace" ||
      saved === "agents" ||
      saved === "activity" ||
      saved === "hooks" ||
      saved === "configuration" ||
      saved === "integrations"
    ) {
      setActiveViewState(saved);
    } else {
      setActiveViewState("workspace");
    }
  }, [readWorkspaceStorageValue]);

  const [selection, setSelectionState] = useState<Selection>(() => {
    try {
      const saved = readWorkspaceStorageValue("wsSel");
      if (saved) return JSON.parse(saved);
    } catch {
      /* ignore */
    }
    return null;
  });

  const setSelection = (sel: Selection) => {
    setSelectionState(sel);
    const storageKey = workspaceStorageKey("wsSel");
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(sel));
    }
  };

  const [pendingNotificationNav, setPendingNotificationNav] =
    useState<PendingNotificationNavState | null>(null);
  const [pendingIssueNotificationNav, setPendingIssueNotificationNav] =
    useState<PendingIssueNotificationNavState | null>(null);
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
  const runtimeScopedStateRef = useRef<Map<string, RuntimeScopedState>>(new Map());
  const runtimeScopePreviousKeyRef = useRef<string | null>(null);
  const runtimeStateSnapshotRef = useRef<RuntimeScopedState>(createEmptyRuntimeScopedState());
  const launchMissingTargetSinceRef = useRef<Map<string, number>>(new Map());
  const logAutoClaude = useCallback((message: string, extra?: Record<string, unknown>) => {
    if (extra) {
      console.info(`${AUTO_CLAUDE_DEBUG_PREFIX} ${message}`, extra);
      return;
    }
    console.info(`${AUTO_CLAUDE_DEBUG_PREFIX} ${message}`);
  }, []);
  const logAppTemp = useCallback((message: string, extra?: Record<string, unknown>) => {
    if (extra) {
      console.info(`${APP_DEBUG_PREFIX} ${message}`, extra);
      return;
    }
    console.info(`${APP_DEBUG_PREFIX} ${message}`);
  }, []);

  useEffect(() => {
    runtimeStateSnapshotRef.current = {
      pendingClaudeLaunches: [...pendingClaudeLaunches],
      pendingCodexLaunches: [...pendingCodexLaunches],
      pendingGeminiLaunches: [...pendingGeminiLaunches],
      pendingOpenCodeLaunches: [...pendingOpenCodeLaunches],
      claudeLaunchRequest,
      codexLaunchRequest,
      geminiLaunchRequest,
      opencodeLaunchRequest,
      pendingNotificationNav,
      pendingIssueNotificationNav,
      notificationTabRequest,
      agentPermissionPrompt,
      agentCliPrompt,
      claudeLaunchRequestIdCounter: claudeLaunchRequestIdRef.current,
      codexLaunchRequestIdCounter: codexLaunchRequestIdRef.current,
      geminiLaunchRequestIdCounter: geminiLaunchRequestIdRef.current,
      openCodeLaunchRequestIdCounter: openCodeLaunchRequestIdRef.current,
      notificationTabRequestIdCounter: notificationTabRequestIdRef.current,
    };
  }, [
    agentCliPrompt,
    agentPermissionPrompt,
    claudeLaunchRequest,
    codexLaunchRequest,
    geminiLaunchRequest,
    notificationTabRequest,
    opencodeLaunchRequest,
    pendingClaudeLaunches,
    pendingCodexLaunches,
    pendingGeminiLaunches,
    pendingIssueNotificationNav,
    pendingNotificationNav,
    pendingOpenCodeLaunches,
  ]);

  useEffect(() => {
    const previousScopeKey = runtimeScopePreviousKeyRef.current;
    if (previousScopeKey && previousScopeKey !== runtimeScopeKey) {
      runtimeScopedStateRef.current.set(previousScopeKey, {
        ...runtimeStateSnapshotRef.current,
        pendingClaudeLaunches: [...runtimeStateSnapshotRef.current.pendingClaudeLaunches],
        pendingCodexLaunches: [...runtimeStateSnapshotRef.current.pendingCodexLaunches],
        pendingGeminiLaunches: [...runtimeStateSnapshotRef.current.pendingGeminiLaunches],
        pendingOpenCodeLaunches: [...runtimeStateSnapshotRef.current.pendingOpenCodeLaunches],
      });
      logAppTemp("scope state saved", { scopeKey: previousScopeKey });
    }

    const nextState =
      runtimeScopedStateRef.current.get(runtimeScopeKey) ?? createEmptyRuntimeScopedState();
    setPendingClaudeLaunches([...nextState.pendingClaudeLaunches]);
    setPendingCodexLaunches([...nextState.pendingCodexLaunches]);
    setPendingGeminiLaunches([...nextState.pendingGeminiLaunches]);
    setPendingOpenCodeLaunches([...nextState.pendingOpenCodeLaunches]);
    setClaudeLaunchRequest(nextState.claudeLaunchRequest);
    setCodexLaunchRequest(nextState.codexLaunchRequest);
    setGeminiLaunchRequest(nextState.geminiLaunchRequest);
    setOpenCodeLaunchRequest(nextState.opencodeLaunchRequest);
    setPendingNotificationNav(nextState.pendingNotificationNav);
    setPendingIssueNotificationNav(nextState.pendingIssueNotificationNav);
    setNotificationTabRequest(nextState.notificationTabRequest);
    setAgentPermissionPrompt(nextState.agentPermissionPrompt);
    setAgentCliPrompt(nextState.agentCliPrompt);
    claudeLaunchRequestIdRef.current = nextState.claudeLaunchRequestIdCounter;
    codexLaunchRequestIdRef.current = nextState.codexLaunchRequestIdCounter;
    geminiLaunchRequestIdRef.current = nextState.geminiLaunchRequestIdCounter;
    openCodeLaunchRequestIdRef.current = nextState.openCodeLaunchRequestIdCounter;
    notificationTabRequestIdRef.current = nextState.notificationTabRequestIdCounter;
    runtimeScopePreviousKeyRef.current = runtimeScopeKey;
    logAppTemp("scope state restored", { scopeKey: runtimeScopeKey });
  }, [logAppTemp, runtimeScopeKey]);

  const updateRuntimeScopeState = useCallback(
    (scopeKey: string, updater: (state: RuntimeScopedState) => RuntimeScopedState) => {
      const current =
        runtimeScopedStateRef.current.get(scopeKey) ?? createEmptyRuntimeScopedState();
      const next = updater({
        ...current,
        pendingClaudeLaunches: [...current.pendingClaudeLaunches],
        pendingCodexLaunches: [...current.pendingCodexLaunches],
        pendingGeminiLaunches: [...current.pendingGeminiLaunches],
        pendingOpenCodeLaunches: [...current.pendingOpenCodeLaunches],
      });
      runtimeScopedStateRef.current.set(scopeKey, next);
    },
    [],
  );

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
    const selectionKey = workspaceStorageKey("wsSel");
    if (selectionKey) {
      localStorage.setItem(selectionKey, JSON.stringify(sel));
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
  }, [pendingNotificationNav, activeProject?.id, workspaceStorageKey]);

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
        : pendingIssueNotificationNav.source === "linear"
          ? { type: "linear-issue", identifier: pendingIssueNotificationNav.issueId }
          : { type: "custom-task", id: pendingIssueNotificationNav.issueId };
    setActiveCreateTabState("issues");
    const tabKey = workspaceStorageKey("wsTab");
    if (tabKey) {
      localStorage.setItem(tabKey, "issues");
    }
    setSelectionState(sel);
    const selectionKey = workspaceStorageKey("wsSel");
    if (selectionKey) {
      localStorage.setItem(selectionKey, JSON.stringify(sel));
    }
    setPendingIssueNotificationNav(null);
  }, [pendingIssueNotificationNav, activeProject?.id, workspaceStorageKey]);

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
    if (!workspaceStorageScope) return;
    try {
      const saved = readWorkspaceStorageValue("wsSel");
      if (saved) setSelectionState(JSON.parse(saved));
      else setSelectionState(null);
    } catch (error) {
      reportPersistentErrorToast(error, "Failed to restore workspace selection", {
        scope: "app:restore-selection",
      });
      setSelectionState(null);
    }
  }, [readWorkspaceStorageValue, workspaceStorageScope]);
  const [activeCreateTab, setActiveCreateTabState] = useState<"branch" | "issues">(() => {
    const saved = readWorkspaceStorageValue("wsTab");
    if (saved === "branch" || saved === "issues") return saved;
    return "branch";
  });

  const setActiveCreateTab = (tab: "branch" | "issues") => {
    setActiveCreateTabState(tab);
    const storageKey = workspaceStorageKey("wsTab");
    if (storageKey) {
      localStorage.setItem(storageKey, tab);
    }
  };

  useEffect(() => {
    if (!workspaceStorageScope) return;
    const saved = readWorkspaceStorageValue("wsTab");
    if (saved === "branch" || saved === "issues") {
      setActiveCreateTabState(saved);
    } else {
      setActiveCreateTabState("branch");
    }
  }, [readWorkspaceStorageValue, workspaceStorageScope]);

  // Global keyboard shortcuts
  const handleShortcutAction = useCallback(
    (event: ShortcutEvent) => {
      if (event.action === "project-tab") {
        const project = projects[event.tabIndex];
        if (project) switchProject(project.id);
        return;
      }
      switch (event.action) {
        case "nav-worktrees":
          setActiveView("workspace");
          setActiveCreateTab("branch");
          break;
        case "nav-issues":
          setActiveView("workspace");
          setActiveCreateTab("issues");
          break;
        case "nav-agents":
          setActiveView("agents");
          break;
        case "nav-activity":
          setActiveView("activity");
          break;
        case "nav-integrations":
          setActiveView("integrations");
          break;
        case "nav-settings":
          setActiveView("configuration");
          break;
      }
    },
    [projects, switchProject, setActiveView, setActiveCreateTab],
  );

  useShortcuts({
    shortcuts: localConfig?.shortcuts,
    onAction: handleShortcutAction,
  });

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

  // Issue display settings (persisted in localStorage)
  const [issueShowPriority, setIssueShowPriority] = useState(() => {
    const saved = localStorage.getItem("OpenKit:issueShowPriority");
    return saved !== null ? saved === "1" : false;
  });
  const [issueShowStatus, setIssueShowStatus] = useState(() => {
    const saved = localStorage.getItem("OpenKit:issueShowStatus");
    return saved !== null ? saved === "1" : false;
  });

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
      window.electronAPI
        ?.getSidebarWidth()
        .then((width) => {
          if (width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH) {
            setSidebarWidth(width);
          }
        })
        .catch((error) => {
          reportPersistentErrorToast(error, "Failed to load sidebar width", {
            scope: "app:sidebar-width",
          });
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
  const [ngrokStatus, setNgrokStatus] = useState<Awaited<
    ReturnType<typeof api.fetchNgrokConnectStatus>
  > | null>(null);
  const [ngrokBusy, setNgrokBusy] = useState(false);
  const [showNgrokQrModal, setShowNgrokQrModal] = useState(false);
  const [ngrokPairing, setNgrokPairing] = useState<Awaited<
    ReturnType<typeof api.createNgrokPairingSession>
  > | null>(null);
  const [ngrokQrDataUrl, setNgrokQrDataUrl] = useState<string | null>(null);
  const [ngrokQrMessage, setNgrokQrMessage] = useState<string | null>(null);

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

  const refreshNgrokStatus = useCallback(async () => {
    if (!serverUrl) {
      setNgrokStatus(null);
      return;
    }
    const status = await api.fetchNgrokConnectStatus();
    setNgrokStatus(status);
  }, [api, serverUrl]);

  useEffect(() => {
    void refreshNgrokStatus();
  }, [refreshNgrokStatus]);

  const generateNgrokPairingQr = useCallback(
    async (regenerateUrl: boolean) => {
      if (!serverUrl || ngrokBusy) return false;
      setNgrokBusy(true);
      setNgrokQrMessage(null);

      const pairing = await api.createNgrokPairingSession(regenerateUrl, "/");
      if (!pairing.success || !pairing.pairUrl) {
        setNgrokPairing(pairing);
        setNgrokQrDataUrl(null);
        setNgrokQrMessage(pairing.error ?? "Failed to generate pairing QR.");
        setShowNgrokQrModal(true);
        setNgrokBusy(false);
        await refreshNgrokStatus();
        return false;
      }

      setNgrokPairing(pairing);
      try {
        const qrDataUrl = await QRCode.toDataURL(pairing.pairUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 240,
        });
        setNgrokQrDataUrl(qrDataUrl);
      } catch (error) {
        reportPersistentErrorToast(error, "Failed to generate QR code", {
          scope: "app:ngrok-qr",
        });
        setNgrokQrDataUrl(null);
      }

      setShowNgrokQrModal(true);
      setNgrokQrMessage("Scan this QR on your mobile device.");
      setNgrokBusy(false);
      await refreshNgrokStatus();
      return true;
    },
    [api, ngrokBusy, refreshNgrokStatus, serverUrl],
  );

  const handleToggleNgrokTunnel = useCallback(async () => {
    if (!serverUrl || ngrokBusy) return;
    setNgrokBusy(true);
    setNgrokQrMessage(null);

    const currentlyEnabled = ngrokStatus?.tunnel.enabled === true;
    const status = currentlyEnabled
      ? await api.disableNgrokTunnel()
      : await api.enableNgrokTunnel();
    setNgrokStatus(status);
    setNgrokBusy(false);

    if (!currentlyEnabled && status.success && status.tunnel.enabled) {
      const key = `${APP_NAME}:ngrok-first-qr-shown:${serverUrl}`;
      if (localStorage.getItem(key) !== "1") {
        const opened = await generateNgrokPairingQr(false);
        if (opened) {
          localStorage.setItem(key, "1");
        }
      }
    }
  }, [api, generateNgrokPairingQr, ngrokBusy, ngrokStatus?.tunnel.enabled, serverUrl]);

  const handleOpenNgrokQr = useCallback(async () => {
    if (!serverUrl) return;
    const regenerateUrl = ngrokStatus?.tunnel.enabled !== true;
    await generateNgrokPairingQr(regenerateUrl);
  }, [generateNgrokPairingQr, ngrokStatus?.tunnel.enabled, serverUrl]);

  const handleCopyNgrokPairingUrl = useCallback(async () => {
    if (!ngrokPairing?.pairUrl) return;
    try {
      await navigator.clipboard.writeText(ngrokPairing.pairUrl);
      setNgrokQrMessage("Pairing URL copied.");
    } catch (error) {
      reportPersistentErrorToast(error, "Could not copy pairing URL", {
        scope: "app:copy-pairing-url",
      });
      setNgrokQrMessage("Could not copy pairing URL.");
    }
  }, [ngrokPairing?.pairUrl]);

  const renderTabBar = () => (
    <TabBar
      onOpenSettings={() => setShowSettingsModal(true)}
      onToggleNgrok={handleToggleNgrokTunnel}
      onOpenNgrokQr={handleOpenNgrokQr}
      ngrokEnabled={ngrokStatus?.tunnel.enabled === true}
      ngrokBusy={ngrokBusy}
      ngrokQrDisabled={!serverUrl}
    />
  );

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
    } catch (error) {
      reportPersistentErrorToast(error, "Setup failed unexpectedly", {
        scope: "app:auto-setup",
      });
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

  useEffect(() => {
    const dropMissingLaunches = <T extends { worktreeId: string }>(pending: T[]): T[] => {
      const filtered = pending.filter((intent) => activeWorktreeIds.has(intent.worktreeId));
      return filtered.length === pending.length ? pending : filtered;
    };

    setPendingClaudeLaunches((prev) => dropMissingLaunches(prev));
    setPendingCodexLaunches((prev) => dropMissingLaunches(prev));
    setPendingGeminiLaunches((prev) => dropMissingLaunches(prev));
    setPendingOpenCodeLaunches((prev) => dropMissingLaunches(prev));

    setClaudeLaunchRequest((prev) =>
      prev && !activeWorktreeIds.has(prev.worktreeId) ? null : prev,
    );
    setCodexLaunchRequest((prev) =>
      prev && !activeWorktreeIds.has(prev.worktreeId) ? null : prev,
    );
    setGeminiLaunchRequest((prev) =>
      prev && !activeWorktreeIds.has(prev.worktreeId) ? null : prev,
    );
    setOpenCodeLaunchRequest((prev) =>
      prev && !activeWorktreeIds.has(prev.worktreeId) ? null : prev,
    );

    for (const waitKey of launchMissingTargetSinceRef.current.keys()) {
      if (!waitKey.startsWith(`${runtimeScopeKey}:`)) continue;
      const parts = waitKey.split(":");
      const worktreeId = parts[parts.length - 1];
      if (activeWorktreeIds.has(worktreeId)) continue;
      launchMissingTargetSinceRef.current.delete(waitKey);
    }
  }, [activeWorktreeIds, runtimeScopeKey]);

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

  const maybeDropStaleLaunchIntent = useCallback(
    (
      agent: CodingAgent,
      worktreeId: string,
      reason: "target-missing" | "target-creating",
      drop: () => void,
    ): boolean => {
      const waitKey = `${runtimeScopeKey}:${agent}:${worktreeId}`;
      const now = Date.now();
      const firstSeenAt = launchMissingTargetSinceRef.current.get(waitKey);
      if (!firstSeenAt) {
        launchMissingTargetSinceRef.current.set(waitKey, now);
        return false;
      }
      const elapsedMs = now - firstSeenAt;
      if (elapsedMs < LAUNCH_TARGET_WAIT_TIMEOUT_MS) {
        return false;
      }
      launchMissingTargetSinceRef.current.delete(waitKey);
      drop();
      logAppTemp("scope drop stale launch intent", {
        scopeKey: runtimeScopeKey,
        agent,
        worktreeId,
        reason,
        elapsedMs,
      });
      return true;
    },
    [logAppTemp, runtimeScopeKey],
  );

  useEffect(() => {
    const pendingClaudeLaunch = pendingClaudeLaunches[0];
    if (!pendingClaudeLaunch) return;
    const waitKey = `${runtimeScopeKey}:claude:${pendingClaudeLaunch.worktreeId}`;
    const target = worktrees.find((wt) => wt.id === pendingClaudeLaunch.worktreeId);
    if (!target) {
      logAutoClaude("Waiting for target worktree to appear before launching Claude", {
        worktreeId: pendingClaudeLaunch.worktreeId,
      });
      const dropped = maybeDropStaleLaunchIntent(
        "claude",
        pendingClaudeLaunch.worktreeId,
        "target-missing",
        () => {
          setPendingClaudeLaunches((prev) => prev.slice(1));
        },
      );
      if (dropped) return;
      return;
    }
    if (target.status === "creating") {
      logAutoClaude("Target worktree exists but is still creating; waiting to launch Claude", {
        worktreeId: pendingClaudeLaunch.worktreeId,
        status: target.status,
      });
      const dropped = maybeDropStaleLaunchIntent(
        "claude",
        pendingClaudeLaunch.worktreeId,
        "target-creating",
        () => {
          setPendingClaudeLaunches((prev) => prev.slice(1));
        },
      );
      if (dropped) return;
      return;
    }
    launchMissingTargetSinceRef.current.delete(waitKey);
    const intent = pendingClaudeLaunch;
    logAppTemp("scope dequeue launch intent", {
      scopeKey: runtimeScopeKey,
      agent: "claude",
      worktreeId: intent.worktreeId,
      mode: intent.mode,
    });
    setPendingClaudeLaunches((prev) => prev.slice(1));

    void (async () => {
      if (isStartLaunchMode(intent.mode)) {
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

      let mode: ClaudeLaunchIntent["mode"] = intent.mode;
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
  }, [
    api,
    logAppTemp,
    logAutoClaude,
    maybeDropStaleLaunchIntent,
    pendingClaudeLaunches,
    runtimeScopeKey,
    startAgentSessionInBackground,
    worktrees,
  ]);

  useEffect(() => {
    const pendingCodexLaunch = pendingCodexLaunches[0];
    if (!pendingCodexLaunch) return;
    const waitKey = `${runtimeScopeKey}:codex:${pendingCodexLaunch.worktreeId}`;
    const target = worktrees.find((wt) => wt.id === pendingCodexLaunch.worktreeId);
    if (!target) {
      logAutoClaude("Waiting for target worktree to appear before launching Codex", {
        worktreeId: pendingCodexLaunch.worktreeId,
      });
      const dropped = maybeDropStaleLaunchIntent(
        "codex",
        pendingCodexLaunch.worktreeId,
        "target-missing",
        () => {
          setPendingCodexLaunches((prev) => prev.slice(1));
        },
      );
      if (dropped) return;
      return;
    }
    if (target.status === "creating") {
      logAutoClaude("Target worktree exists but is still creating; waiting to launch Codex", {
        worktreeId: pendingCodexLaunch.worktreeId,
        status: target.status,
      });
      const dropped = maybeDropStaleLaunchIntent(
        "codex",
        pendingCodexLaunch.worktreeId,
        "target-creating",
        () => {
          setPendingCodexLaunches((prev) => prev.slice(1));
        },
      );
      if (dropped) return;
      return;
    }
    launchMissingTargetSinceRef.current.delete(waitKey);
    const intent = pendingCodexLaunch;
    logAppTemp("scope dequeue launch intent", {
      scopeKey: runtimeScopeKey,
      agent: "codex",
      worktreeId: intent.worktreeId,
      mode: intent.mode,
    });
    setPendingCodexLaunches((prev) => prev.slice(1));

    void (async () => {
      if (isStartLaunchMode(intent.mode)) {
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
  }, [
    api,
    logAppTemp,
    logAutoClaude,
    maybeDropStaleLaunchIntent,
    pendingCodexLaunches,
    runtimeScopeKey,
    worktrees,
  ]);

  useEffect(() => {
    const pendingGeminiLaunch = pendingGeminiLaunches[0];
    if (!pendingGeminiLaunch) return;
    const waitKey = `${runtimeScopeKey}:gemini:${pendingGeminiLaunch.worktreeId}`;
    const target = worktrees.find((wt) => wt.id === pendingGeminiLaunch.worktreeId);
    if (!target) {
      logAutoClaude("Waiting for target worktree to appear before launching Gemini", {
        worktreeId: pendingGeminiLaunch.worktreeId,
      });
      const dropped = maybeDropStaleLaunchIntent(
        "gemini",
        pendingGeminiLaunch.worktreeId,
        "target-missing",
        () => {
          setPendingGeminiLaunches((prev) => prev.slice(1));
        },
      );
      if (dropped) return;
      return;
    }
    if (target.status === "creating") {
      logAutoClaude("Target worktree exists but is still creating; waiting to launch Gemini", {
        worktreeId: pendingGeminiLaunch.worktreeId,
        status: target.status,
      });
      const dropped = maybeDropStaleLaunchIntent(
        "gemini",
        pendingGeminiLaunch.worktreeId,
        "target-creating",
        () => {
          setPendingGeminiLaunches((prev) => prev.slice(1));
        },
      );
      if (dropped) return;
      return;
    }
    launchMissingTargetSinceRef.current.delete(waitKey);
    const intent = pendingGeminiLaunch;
    logAppTemp("scope dequeue launch intent", {
      scopeKey: runtimeScopeKey,
      agent: "gemini",
      worktreeId: intent.worktreeId,
      mode: intent.mode,
    });
    setPendingGeminiLaunches((prev) => prev.slice(1));

    void (async () => {
      if (isStartLaunchMode(intent.mode)) {
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
  }, [
    api,
    logAppTemp,
    logAutoClaude,
    maybeDropStaleLaunchIntent,
    pendingGeminiLaunches,
    runtimeScopeKey,
    worktrees,
  ]);

  useEffect(() => {
    const pendingOpenCodeLaunch = pendingOpenCodeLaunches[0];
    if (!pendingOpenCodeLaunch) return;
    const waitKey = `${runtimeScopeKey}:opencode:${pendingOpenCodeLaunch.worktreeId}`;
    const target = worktrees.find((wt) => wt.id === pendingOpenCodeLaunch.worktreeId);
    if (!target) {
      logAutoClaude("Waiting for target worktree to appear before launching OpenCode", {
        worktreeId: pendingOpenCodeLaunch.worktreeId,
      });
      const dropped = maybeDropStaleLaunchIntent(
        "opencode",
        pendingOpenCodeLaunch.worktreeId,
        "target-missing",
        () => {
          setPendingOpenCodeLaunches((prev) => prev.slice(1));
        },
      );
      if (dropped) return;
      return;
    }
    if (target.status === "creating") {
      logAutoClaude("Target worktree exists but is still creating; waiting to launch OpenCode", {
        worktreeId: pendingOpenCodeLaunch.worktreeId,
        status: target.status,
      });
      const dropped = maybeDropStaleLaunchIntent(
        "opencode",
        pendingOpenCodeLaunch.worktreeId,
        "target-creating",
        () => {
          setPendingOpenCodeLaunches((prev) => prev.slice(1));
        },
      );
      if (dropped) return;
      return;
    }
    launchMissingTargetSinceRef.current.delete(waitKey);
    const intent = pendingOpenCodeLaunch;
    logAppTemp("scope dequeue launch intent", {
      scopeKey: runtimeScopeKey,
      agent: "opencode",
      worktreeId: intent.worktreeId,
      mode: intent.mode,
    });
    setPendingOpenCodeLaunches((prev) => prev.slice(1));

    void (async () => {
      if (isStartLaunchMode(intent.mode)) {
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
  }, [
    api,
    logAppTemp,
    logAutoClaude,
    maybeDropStaleLaunchIntent,
    pendingOpenCodeLaunches,
    runtimeScopeKey,
    worktrees,
  ]);

  const handleDeleted = () => {
    setSelection(null);
  };

  const focusWorktree = useCallback((worktreeId: string) => {
    setActiveCreateTab("branch");
    setSelection({ type: "worktree", id: worktreeId });
  }, []);

  const handleCreateWorktreeFromJira = (worktreeId: string) => {
    // Switch to worktree tab so user sees the newly created worktree
    focusWorktree(worktreeId);
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

  const handleCreateWorktreeFromLinear = (worktreeId: string) => {
    focusWorktree(worktreeId);
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

  const handleCreateWorktreeFromCustomTask = (worktreeId: string) => {
    focusWorktree(worktreeId);
    refetch();
    refetchCustomTasks();
  };

  const handleViewWorktreeFromCustomTask = (worktreeId: string) => {
    setActiveCreateTab("branch");
    setSelection({ type: "worktree", id: worktreeId });
  };

  const enqueueClaudeLaunch = useCallback(
    (intent: ClaudeLaunchIntent, options?: AgentLaunchOptions) => {
      logAppTemp("scope enqueue launch intent", {
        scopeKey: runtimeScopeKey,
        agent: "claude",
        worktreeId: intent.worktreeId,
        mode: intent.mode,
      });
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
    [logAppTemp, logAutoClaude, refetch, runtimeScopeKey],
  );

  const enqueueCodexLaunch = useCallback(
    (intent: CodexLaunchIntent, options?: AgentLaunchOptions) => {
      logAppTemp("scope enqueue launch intent", {
        scopeKey: runtimeScopeKey,
        agent: "codex",
        worktreeId: intent.worktreeId,
        mode: intent.mode,
      });
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
    [logAppTemp, logAutoClaude, refetch, runtimeScopeKey],
  );

  const enqueueGeminiLaunch = useCallback(
    (intent: GeminiLaunchIntent, options?: AgentLaunchOptions) => {
      logAppTemp("scope enqueue launch intent", {
        scopeKey: runtimeScopeKey,
        agent: "gemini",
        worktreeId: intent.worktreeId,
        mode: intent.mode,
      });
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
    [logAppTemp, logAutoClaude, refetch, runtimeScopeKey],
  );

  const enqueueOpenCodeLaunch = useCallback(
    (intent: OpenCodeLaunchIntent, options?: AgentLaunchOptions) => {
      logAppTemp("scope enqueue launch intent", {
        scopeKey: runtimeScopeKey,
        agent: "opencode",
        worktreeId: intent.worktreeId,
        mode: intent.mode,
      });
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
    [logAppTemp, logAutoClaude, refetch, runtimeScopeKey],
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
      } catch (error) {
        reportPersistentErrorToast(error, `Failed to restore auto-launch seen IDs for ${source}`, {
          scope: `auto-launch:seen-ids:${source}`,
        });
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
      autoLaunchQueueRef.current = autoLaunchQueueRef.current.then(launch).catch((launchError) => {
        reportDetailedErrorToast("Auto-launch queue failed", launchError, {
          scope: "auto-launch:queue",
        });
        console.error("Auto Claude launch failed:", launchError);
      });
    },
    [logAutoClaude],
  );

  const publishTaskDetectedActivity = useCallback(
    async (task: { source: "jira" | "linear" | "local"; issueId: string; title: string }) => {
      const result = await api.createActivityEvent({
        category: "agent",
        type: "task_detected",
        severity: "info",
        title: "New issue",
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
        const reason = result.error ?? "unknown";
        showPersistentErrorToast(
          {
            title: `Failed to auto-launch Jira issue ${issue.key}`,
            description: `Reason: ${reason}`,
          },
          { scope: "auto-launch:jira" },
        );
        console.error(`Failed to auto-launch Jira issue ${issue.key}: ${reason}`);
        return;
      }
      const worktreeId = result.worktreeId ?? issue.key;
      if (jiraStatus?.autoUpdateIssueStatusOnAgentStart && jiraStatus.autoUpdateIssueStatusName) {
        const statusResult = await api.updateJiraIssueStatus(
          issue.key,
          jiraStatus.autoUpdateIssueStatusName,
        );
        logAutoClaude("Jira auto status update attempted", {
          issueKey: issue.key,
          targetStatus: jiraStatus.autoUpdateIssueStatusName,
          success: statusResult.success,
          error: statusResult.error,
        });
      }
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
      jiraStatus?.autoUpdateIssueStatusOnAgentStart,
      jiraStatus?.autoUpdateIssueStatusName,
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
        const reason = result.error ?? "unknown";
        showPersistentErrorToast(
          {
            title: `Failed to auto-launch Linear issue ${issue.identifier}`,
            description: `Reason: ${reason}`,
          },
          { scope: "auto-launch:linear" },
        );
        console.error(`Failed to auto-launch Linear issue ${issue.identifier}: ${reason}`);
        return;
      }
      const worktreeId = result.worktreeId ?? issue.identifier;
      if (
        linearStatus?.autoUpdateIssueStatusOnAgentStart &&
        linearStatus.autoUpdateIssueStatusName
      ) {
        const statusResult = await api.updateLinearIssueStatus(
          issue.identifier,
          linearStatus.autoUpdateIssueStatusName,
        );
        logAutoClaude("Linear auto status update attempted", {
          identifier: issue.identifier,
          targetStatus: linearStatus.autoUpdateIssueStatusName,
          success: statusResult.success,
          error: statusResult.error,
        });
      }
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
      linearStatus?.autoUpdateIssueStatusOnAgentStart,
      linearStatus?.autoUpdateIssueStatusName,
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
        const reason = result.error ?? "unknown";
        showPersistentErrorToast(
          {
            title: `Failed to auto-launch local task ${task.id}`,
            description: `Reason: ${reason}`,
          },
          { scope: "auto-launch:local" },
        );
        console.error(`Failed to auto-launch local task ${task.id}: ${reason}`);
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
        <div className="absolute bottom-0 left-0 right-0">{renderTabBar()}</div>
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
        {renderTabBar()}
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
        {renderTabBar()}
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
        {renderTabBar()}
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
        {renderTabBar()}
      </div>
    );
  }

  const handleNavigateToWorktree = ({
    worktreeId,
    projectName: navProjectName,
    sourceServerUrl,
    openClaudeTab,
    openHooksTab,
  }: {
    worktreeId: string;
    projectName?: string;
    sourceServerUrl?: string;
    openClaudeTab?: boolean;
    openHooksTab?: boolean;
  }) => {
    setActiveView("workspace");
    const targetProjectId = resolveProjectIdFromNotification(navProjectName, sourceServerUrl);
    if (targetProjectId && targetProjectId !== activeProject?.id) {
      const targetScopeKey = `project:${targetProjectId}`;
      updateRuntimeScopeState(targetScopeKey, (state) => ({
        ...state,
        pendingNotificationNav: {
          worktreeId,
          targetProjectId,
          openClaudeTab,
          openHooksTab,
        },
      }));
      logAppTemp("scope enqueue notification navigation", {
        scopeKey: targetScopeKey,
        worktreeId,
        targetProjectId,
        openClaudeTab: openClaudeTab ?? false,
        openHooksTab: openHooksTab ?? false,
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
  };

  const handleNavigateToIssue = ({
    source,
    issueId,
    projectName: navProjectName,
    sourceServerUrl,
  }: {
    source: "jira" | "linear" | "local";
    issueId: string;
    projectName?: string;
    sourceServerUrl?: string;
  }) => {
    setActiveView("workspace");
    setActiveCreateTab("issues");
    const targetProjectId = resolveProjectIdFromNotification(navProjectName, sourceServerUrl);
    if (targetProjectId && targetProjectId !== activeProject?.id) {
      const targetScopeKey = `project:${targetProjectId}`;
      updateRuntimeScopeState(targetScopeKey, (state) => ({
        ...state,
        pendingIssueNotificationNav: { source, issueId, targetProjectId },
      }));
      logAppTemp("scope enqueue issue navigation", {
        scopeKey: targetScopeKey,
        source,
        issueId,
        targetProjectId,
      });
      switchProject(targetProjectId);
      return;
    }
    if (source === "jira") {
      setSelection({ type: "issue", key: issueId });
      return;
    }
    if (source === "linear") {
      setSelection({ type: "linear-issue", identifier: issueId });
      return;
    }
    setSelection({ type: "custom-task", id: issueId });
  };

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
          onNavigateToWorktree={handleNavigateToWorktree}
          onNavigateToIssue={handleNavigateToIssue}
        />
      </motion.div>

      {error && (
        <div className={`flex-shrink-0 px-4 py-2 ${errorBanner.bg} ${text.errorBanner} text-xs`}>
          {error}
        </div>
      )}

      {(activeView === "workspace" || activeView === "agents" || activeView === "activity") && (
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
                        showDiffStats={config?.showDiffStats !== false}
                        onSelectJiraIssue={(key) => {
                          setActiveCreateTab("issues");
                          setSelection({ type: "issue", key });
                        }}
                        onSelectLinearIssue={(identifier) => {
                          setActiveCreateTab("issues");
                          setSelection({ type: "linear-issue", identifier });
                        }}
                        onSelectLocalIssue={(identifier) => {
                          setActiveCreateTab("issues");
                          setSelection({ type: "custom-task", id: identifier });
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
                        customTasksFetching={customTasksFetching}
                        customTasksError={customTasksError}
                        onRefreshCustomTasks={() => refetchCustomTasks()}
                        customTasksUpdatedAt={customTasksUpdatedAt}
                        selectedCustomTaskId={
                          selection?.type === "custom-task" ? selection.id : null
                        }
                        onSelectCustomTask={(id) => setSelection({ type: "custom-task", id })}
                        showPriority={issueShowPriority}
                        showStatus={issueShowStatus}
                        worktrees={worktrees}
                        onViewWorktree={handleViewWorktreeFromJira}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <SidebarConfigBar
                  items={
                    activeCreateTab === "branch"
                      ? [
                          {
                            label: "Show diff stats",
                            checked: config?.showDiffStats !== false,
                            onToggle: async () => {
                              await api.saveConfig({
                                showDiffStats: !(config?.showDiffStats !== false),
                              });
                              refetchConfig();
                            },
                          },
                        ]
                      : [
                          {
                            label: "Show priority",
                            checked: issueShowPriority,
                            onToggle: () => {
                              const next = !issueShowPriority;
                              setIssueShowPriority(next);
                              localStorage.setItem("OpenKit:issueShowPriority", next ? "1" : "0");
                            },
                          },
                          {
                            label: "Show status",
                            checked: issueShowStatus,
                            onToggle: () => {
                              const next = !issueShowStatus;
                              setIssueShowStatus(next);
                              localStorage.setItem("OpenKit:issueShowStatus", next ? "1" : "0");
                            },
                          },
                        ]
                  }
                />
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
                    showDiffStats={config?.showDiffStats !== false}
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
                      setActiveCreateTab("issues");
                      setSelection({ type: "custom-task", id: identifier });
                    }}
                    onCreateTask={(worktreeId) => {
                      setCreateTaskForWorktreeId(worktreeId);
                      setCreateModalMode("custom");
                      setShowCreateModal(true);
                    }}
                    onLinkIssue={(worktreeId) => setLinkIssueForWorktreeId(worktreeId)}
                    onCodeWithClaude={handleCodeWithClaude}
                    onCodeWithCodex={handleCodeWithCodex}
                    onCodeWithGemini={handleCodeWithGemini}
                    onCodeWithOpenCode={handleCodeWithOpenCode}
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
          {activeView === "activity" && (
            <ActivityPage
              disabledActivityEventTypes={config?.activity?.disabledEvents ?? []}
              onNavigateToWorktree={handleNavigateToWorktree}
              onNavigateToIssue={handleNavigateToIssue}
            />
          )}
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
              shortcuts={localConfig?.shortcuts}
              onShortcutsSaved={refetchLocalConfig}
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
          onCreated={(worktreeId) => {
            setWorktreeFilter("");
            focusWorktree(worktreeId);
            refetch();
          }}
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

      {showNgrokQrModal && (
        <Modal
          title="Mobile Pairing QR"
          icon={<Link2 className="w-4 h-4" />}
          width="sm"
          onClose={() => setShowNgrokQrModal(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowNgrokQrModal(false)}
                className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void generateNgrokPairingQr(true)}
                disabled={ngrokBusy || !serverUrl}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ${button.secondary} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
              >
                {ngrokBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Regenerate
              </button>
            </>
          }
        >
          {ngrokQrDataUrl ? (
            <div className="flex justify-center">
              <img
                src={ngrokQrDataUrl}
                alt="Pairing QR"
                className="w-52 h-52 rounded-md border border-white/[0.08] bg-white p-2"
              />
            </div>
          ) : (
            <p className={`text-xs ${text.secondary} leading-relaxed`}>
              QR image could not be generated in-app. Use the URL below.
            </p>
          )}

          {ngrokPairing?.pairUrl && (
            <div className="mt-3 space-y-2">
              <div>
                <p className={`text-[11px] ${text.muted} mb-1`}>Pairing URL</p>
                <code className="block w-full overflow-x-auto rounded-md border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-white">
                  {ngrokPairing.pairUrl}
                </code>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyNgrokPairingUrl()}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md ${button.secondary} transition-colors`}
              >
                Copy URL
              </button>
            </div>
          )}

          {ngrokPairing?.gatewayApiBase && (
            <div className="mt-3">
              <p className={`text-[11px] ${text.muted} mb-1`}>Gateway API Base</p>
              <code className="block w-full overflow-x-auto rounded-md border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-white">
                {ngrokPairing.gatewayApiBase}
              </code>
            </div>
          )}

          {ngrokPairing?.expiresAt && (
            <p className={`text-[11px] ${text.muted} mt-3`}>
              Expires at {new Date(ngrokPairing.expiresAt).toLocaleString()}.
            </p>
          )}

          {(ngrokQrMessage || ngrokStatus?.tunnel.error || ngrokPairing?.error) && (
            <p
              className={`text-[11px] mt-3 leading-relaxed ${
                ngrokPairing?.success === false || ngrokStatus?.tunnel.error
                  ? text.error
                  : text.secondary
              }`}
            >
              {ngrokQrMessage ?? ngrokPairing?.error ?? ngrokStatus?.tunnel.error}
            </p>
          )}
        </Modal>
      )}

      {/* App settings modal (Electron only) */}
      {showSettingsModal && <AppSettingsModal onClose={() => setShowSettingsModal(false)} />}

      {/* Tab bar for multi-project (Electron only) */}
      <div className="absolute bottom-0 left-0 right-0 z-40">{renderTabBar()}</div>
    </div>
  );
}
