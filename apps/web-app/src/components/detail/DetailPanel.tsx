import { FileText, GitBranch, Link, MessageCircle, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { OpenProjectTarget, OpenProjectTargetOption } from "../../hooks/api";
import type { AgentHistoryMatch, CodingAgent, RestorableAgent } from "../../hooks/api";
import type { WorktreeInfo } from "../../types";
import { useErrorToast } from "../../hooks/useErrorToast";
import { useApi } from "../../hooks/useApi";
import { clearTerminalSessionCacheForRuntimeWorktree } from "../../hooks/useTerminal";
import { useServer, useServerUrlOptional } from "../../contexts/ServerContext";
import { action, button, detailTab, errorBanner, input, text } from "../../theme";
import { ConfirmDialog } from "../ConfirmDialog";
import { GitHubIcon } from "../../icons";
import { Modal } from "../Modal";
import { DetailHeader } from "./DetailHeader";
import { DiffViewerTab } from "./DiffViewerTab";
import { LogsViewer } from "./LogsViewer";
import { TerminalView } from "./TerminalView";
import { HooksTab } from "./HooksTab";
import { log } from "../../logger";

type WorktreeTab =
  | "logs"
  | "terminal"
  | "changes"
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "hooks";

interface DetailPanelScopeCache {
  tabCache: Record<string, WorktreeTab>;
  openClaudeTabs: Set<string>;
  openCodexTabs: Set<string>;
  openGeminiTabs: Set<string>;
  openOpenCodeTabs: Set<string>;
  claudeTabLabels: Record<string, string>;
  codexTabLabels: Record<string, string>;
  geminiTabLabels: Record<string, string>;
  opencodeTabLabels: Record<string, string>;
  lastProcessedNotificationTabRequestId: number | null;
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const days = Math.floor(hr / 24);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  return `${days}d ago`;
}

// Persists across unmount/remount (view switches) and is scoped per project/server.
const detailPanelScopeCaches = new Map<string, DetailPanelScopeCache>();

function getDetailPanelScopeCache(scopeKey: string): DetailPanelScopeCache {
  const existing = detailPanelScopeCaches.get(scopeKey);
  if (existing) return existing;
  const created: DetailPanelScopeCache = {
    tabCache: {},
    openClaudeTabs: new Set<string>(),
    openCodexTabs: new Set<string>(),
    openGeminiTabs: new Set<string>(),
    openOpenCodeTabs: new Set<string>(),
    claudeTabLabels: {},
    codexTabLabels: {},
    geminiTabLabels: {},
    opencodeTabLabels: {},
    lastProcessedNotificationTabRequestId: null,
  };
  detailPanelScopeCaches.set(scopeKey, created);
  return created;
}
const OPEN_TARGET_SELECTION_PRIORITY: OpenProjectTarget[] = [
  "cursor",
  "vscode",
  "zed",
  "intellij",
  "webstorm",
  "terminal",
  "warp",
  "ghostty",
  "neovim",
  "file-manager",
];

function pickDefaultOpenTarget(
  targets: OpenProjectTargetOption[],
  selectedFromServer?: OpenProjectTarget | null,
): OpenProjectTarget | null {
  const available = new Set(targets.map((target) => target.target));
  if (selectedFromServer && available.has(selectedFromServer)) return selectedFromServer;
  for (const target of OPEN_TARGET_SELECTION_PRIORITY) {
    if (available.has(target)) return target;
  }
  return null;
}

interface AgentLaunchRequest {
  worktreeId: string;
  mode: "resume" | "resume-active" | "resume-history" | "start" | "start-new";
  prompt?: string;
  tabLabel?: string;
  skipPermissions?: boolean;
  sessionId?: string;
  requestId: number;
}

type AgentLaunchOutcome = "reattached" | "started" | "failed";

interface NotificationTabRequest {
  worktreeId: string;
  tab: "hooks";
  requestId: number;
}

interface DetailPanelProps {
  worktree: WorktreeInfo | null;
  onUpdate: () => void;
  onDeleted: () => void;
  onNavigateToIntegrations?: () => void;
  onNavigateToHooks?: () => void;
  onSelectJiraIssue?: (key: string) => void;
  onSelectLinearIssue?: (identifier: string) => void;
  onSelectLocalIssue?: (identifier: string) => void;
  onCreateTask?: (worktreeId: string) => void;
  onLinkIssue?: (worktreeId: string) => void;
  onCodeWithClaude?: (intent: {
    worktreeId: string;
    mode: "resume" | "resume-active" | "resume-history" | "start" | "start-new";
    prompt?: string;
    tabLabel?: string;
    skipPermissions?: boolean;
    sessionId?: string;
  }) => void;
  onCodeWithCodex?: (intent: {
    worktreeId: string;
    mode: "resume" | "resume-active" | "resume-history" | "start" | "start-new";
    prompt?: string;
    tabLabel?: string;
    skipPermissions?: boolean;
    sessionId?: string;
  }) => void;
  onCodeWithGemini?: (intent: {
    worktreeId: string;
    mode: "resume" | "start";
    prompt?: string;
    tabLabel?: string;
  }) => void;
  onCodeWithOpenCode?: (intent: {
    worktreeId: string;
    mode: "resume" | "start";
    prompt?: string;
    tabLabel?: string;
  }) => void;
  showDiffStats?: boolean;
  hookUpdateKey?: number;
  claudeLaunchRequest?: AgentLaunchRequest | null;
  codexLaunchRequest?: AgentLaunchRequest | null;
  geminiLaunchRequest?: AgentLaunchRequest | null;
  opencodeLaunchRequest?: AgentLaunchRequest | null;
  notificationTabRequest?: NotificationTabRequest | null;
}

interface AgentRestoreModalState {
  agent: RestorableAgent;
  matches: AgentHistoryMatch[];
  selectedSessionId: string | null;
}

const AGENT_OPTIONS: { id: CodingAgent; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
  { id: "opencode", label: "OpenCode" },
];

function AddAgentDropdown({
  worktreeId,
  installedAgents,
  openClaudeTabs,
  openCodexTabs,
  openGeminiTabs,
  openOpenCodeTabs,
  isResolvingAgentRestore,
  onOpenAgent,
}: {
  worktreeId: string;
  installedAgents: Set<CodingAgent> | null;
  openClaudeTabs: Set<string>;
  openCodexTabs: Set<string>;
  openGeminiTabs: Set<string>;
  openOpenCodeTabs: Set<string>;
  isResolvingAgentRestore: CodingAgent | null;
  onOpenAgent: (agent: CodingAgent) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const availableAgents = useMemo(() => {
    const openSets: Record<CodingAgent, Set<string>> = {
      claude: openClaudeTabs,
      codex: openCodexTabs,
      gemini: openGeminiTabs,
      opencode: openOpenCodeTabs,
    };
    return AGENT_OPTIONS.filter(
      (option) =>
        !openSets[option.id].has(worktreeId) &&
        (installedAgents === null || installedAgents.has(option.id)),
    );
  }, [
    worktreeId,
    installedAgents,
    openClaudeTabs,
    openCodexTabs,
    openGeminiTabs,
    openOpenCodeTabs,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  if (availableAgents.length === 0) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={isResolvingAgentRestore !== null}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-1 pl-2 pr-2 py-1 text-xs font-medium rounded-md transition-colors duration-150 ${
          isOpen ? detailTab.active : "text-[#3f4651] hover:text-[#9ca3af] hover:bg-white/[0.06]"
        } disabled:opacity-50`}
      >
        <Plus className="w-3 h-3" />
        Agent
      </button>
      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 w-36 rounded-lg border border-white/[0.08] bg-[#11151d] shadow-xl p-1 z-20"
        >
          {availableAgents.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onOpenAgent(option.id);
              }}
              className="w-full text-left px-2.5 py-1.5 text-[11px] rounded-md text-[#9ca3af] hover:text-white hover:bg-white/[0.06] transition-colors duration-150"
            >
              {isResolvingAgentRestore === option.id ? "Restoring..." : option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DetailPanel({
  worktree,
  onUpdate,
  onDeleted,
  onNavigateToIntegrations,
  onNavigateToHooks,
  onSelectJiraIssue,
  onSelectLinearIssue,
  onSelectLocalIssue,
  onCreateTask,
  onLinkIssue,
  onCodeWithClaude,
  onCodeWithCodex,
  onCodeWithGemini,
  onCodeWithOpenCode,
  showDiffStats,
  hookUpdateKey,
  claudeLaunchRequest,
  codexLaunchRequest,
  geminiLaunchRequest,
  opencodeLaunchRequest,
  notificationTabRequest,
}: DetailPanelProps) {
  const api = useApi();
  const { activeProject, isElectron } = useServer();
  const serverUrl = useServerUrlOptional();
  const detailScopeKey = isElectron
    ? `project:${activeProject?.id ?? "__none__"}`
    : `server:${serverUrl ?? "__relative__"}`;
  const initialScopeCache = getDetailPanelScopeCache(detailScopeKey);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useErrorToast(error, "detail-panel");
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [pushAfterCommit, setPushAfterCommit] = useState(false);
  const [showCreatePrInput, setShowCreatePrInput] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [showMoveToWorktreeInput, setShowMoveToWorktreeInput] = useState(false);
  const [moveToWorktreeBranch, setMoveToWorktreeBranch] = useState("");
  const [isGitLoading, setIsGitLoading] = useState(false);
  const [isRecoveringLocalTask, setIsRecoveringLocalTask] = useState(false);
  const [gitAction, setGitAction] = useState<"commit" | "push" | "pr" | null>(null);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [isDeletingWorktree, setIsDeletingWorktree] = useState(false);
  const [installedAgents, setInstalledAgents] = useState<Set<CodingAgent> | null>(null);
  const [isResolvingAgentRestore, setIsResolvingAgentRestore] = useState<RestorableAgent | null>(
    null,
  );
  const [agentRestoreModal, setAgentRestoreModal] = useState<AgentRestoreModalState | null>(null);
  const [openTargetOptions, setOpenTargetOptions] = useState<OpenProjectTargetOption[]>([]);
  const [selectedOpenTarget, setSelectedOpenTarget] = useState<OpenProjectTarget | null>(null);
  const [tabPerWorktree, setTabPerWorktree] = useState<Record<string, WorktreeTab>>(() => ({
    ...initialScopeCache.tabCache,
  }));
  const [openTerminals, setOpenTerminals] = useState<Set<string>>(new Set());
  const [openClaudeTabs, setOpenClaudeTabs] = useState<Set<string>>(
    () => new Set(initialScopeCache.openClaudeTabs),
  );
  const [openCodexTabs, setOpenCodexTabs] = useState<Set<string>>(
    () => new Set(initialScopeCache.openCodexTabs),
  );
  const [openGeminiTabs, setOpenGeminiTabs] = useState<Set<string>>(
    () => new Set(initialScopeCache.openGeminiTabs),
  );
  const [openOpenCodeTabs, setOpenOpenCodeTabs] = useState<Set<string>>(
    () => new Set(initialScopeCache.openOpenCodeTabs),
  );
  const [claudeTabLabelsByWorktree, setClaudeTabLabelsByWorktree] = useState<
    Record<string, string>
  >(() => ({ ...initialScopeCache.claudeTabLabels }));
  const [codexTabLabelsByWorktree, setCodexTabLabelsByWorktree] = useState<Record<string, string>>(
    () => ({ ...initialScopeCache.codexTabLabels }),
  );
  const [geminiTabLabelsByWorktree, setGeminiTabLabelsByWorktree] = useState<
    Record<string, string>
  >(() => ({ ...initialScopeCache.geminiTabLabels }));
  const [opencodeTabLabelsByWorktree, setOpenCodeTabLabelsByWorktree] = useState<
    Record<string, string>
  >(() => ({ ...initialScopeCache.opencodeTabLabels }));
  const [currentClaudeLaunchRequest, setCurrentClaudeLaunchRequest] =
    useState<AgentLaunchRequest | null>(null);
  const [currentCodexLaunchRequest, setCurrentCodexLaunchRequest] =
    useState<AgentLaunchRequest | null>(null);
  const [currentGeminiLaunchRequest, setCurrentGeminiLaunchRequest] =
    useState<AgentLaunchRequest | null>(null);
  const [currentOpenCodeLaunchRequest, setCurrentOpenCodeLaunchRequest] =
    useState<AgentLaunchRequest | null>(null);
  const [launchClaudeRequestId, setLaunchClaudeRequestId] = useState<number | null>(null);
  const [launchCodexRequestId, setLaunchCodexRequestId] = useState<number | null>(null);
  const [launchGeminiRequestId, setLaunchGeminiRequestId] = useState<number | null>(null);
  const [launchOpenCodeRequestId, setLaunchOpenCodeRequestId] = useState<number | null>(null);
  const [closeClaudeRequestIdByWorktree, setCloseClaudeRequestIdByWorktree] = useState<
    Record<string, number>
  >({});
  const [closeCodexRequestIdByWorktree, setCloseCodexRequestIdByWorktree] = useState<
    Record<string, number>
  >({});
  const [closeGeminiRequestIdByWorktree, setCloseGeminiRequestIdByWorktree] = useState<
    Record<string, number>
  >({});
  const [closeOpenCodeRequestIdByWorktree, setCloseOpenCodeRequestIdByWorktree] = useState<
    Record<string, number>
  >({});
  const processedClaudeRequestIdRef = useRef<number | null>(null);
  const processedCodexRequestIdRef = useRef<number | null>(null);
  const processedGeminiRequestIdRef = useRef<number | null>(null);
  const processedOpenCodeRequestIdRef = useRef<number | null>(null);
  const processedNotificationTabRequestIdRef = useRef<number | null>(
    initialScopeCache.lastProcessedNotificationTabRequestId,
  );
  const closeClaudeRequestIdRef = useRef(0);
  const closeCodexRequestIdRef = useRef(0);
  const closeGeminiRequestIdRef = useRef(0);
  const closeOpenCodeRequestIdRef = useRef(0);
  const restoreWorktreeIdRef = useRef<string | null>(null);

  // Keep stale-response guard aligned with the currently selected worktree.
  // Without this, switching worktrees without triggering a new restore could
  // let a stale response from the previous worktree apply to the new one.
  useEffect(() => {
    restoreWorktreeIdRef.current = worktree?.id ?? null;
  }, [worktree?.id]);

  const logAutoClaude = useCallback((message: string, extra?: Record<string, unknown>) => {
    log.debug(message, { domain: "auto-launch", ...extra });
  }, []);

  const getScopeCache = useCallback(
    () => getDetailPanelScopeCache(detailScopeKey),
    [detailScopeKey],
  );

  const AGENT_TABS = new Set<WorktreeTab>(["claude", "codex", "gemini", "opencode"]);
  const agentTabOpenSets: Record<string, Set<string>> = {
    claude: openClaudeTabs,
    codex: openCodexTabs,
    gemini: openGeminiTabs,
    opencode: openOpenCodeTabs,
  };

  const resolveTab = (tab: WorktreeTab | undefined, wId: string): WorktreeTab => {
    if (!tab) {
      // Try persisted preference
      try {
        const stored = localStorage.getItem("openkit:detail-tab") as WorktreeTab | null;
        if (stored && !AGENT_TABS.has(stored)) return stored;
      } catch {}
      return "changes";
    }
    // If the stored tab is an agent tab, check if it's open for this worktree
    if (AGENT_TABS.has(tab) && !agentTabOpenSets[tab]?.has(wId)) {
      return "changes";
    }
    return tab;
  };

  const activeTab = worktree ? resolveTab(tabPerWorktree[worktree.id], worktree.id) : "changes";
  const terminalProjectScopeKey = detailScopeKey;

  const setTabForWorktree = useCallback(
    (worktreeId: string, tab: WorktreeTab) => {
      const scopeCache = getScopeCache();
      scopeCache.tabCache[worktreeId] = tab;
      setTabPerWorktree((prev) => ({ ...prev, [worktreeId]: tab }));
    },
    [getScopeCache],
  );

  const setActiveTab = useCallback(
    (tab: WorktreeTab) => {
      if (!worktree) return;
      setTabForWorktree(worktree.id, tab);
      // Persist non-agent tabs globally so new worktrees open to the same tab
      if (!AGENT_TABS.has(tab)) {
        try {
          localStorage.setItem("openkit:detail-tab", tab);
        } catch {}
      }
    },
    [setTabForWorktree, worktree],
  );

  useEffect(() => {
    const scopeCache = getScopeCache();
    log.debug("DetailPanel scope cache reset", {
      domain: "project-switch",
      detailScopeKey,
      claudeTabsFromCache: [...scopeCache.openClaudeTabs],
      codexTabsFromCache: [...scopeCache.openCodexTabs],
    });
    setTabPerWorktree({ ...scopeCache.tabCache });
    setOpenTerminals(new Set());
    setOpenClaudeTabs(new Set(scopeCache.openClaudeTabs));
    setOpenCodexTabs(new Set(scopeCache.openCodexTabs));
    setOpenGeminiTabs(new Set(scopeCache.openGeminiTabs));
    setOpenOpenCodeTabs(new Set(scopeCache.openOpenCodeTabs));
    setClaudeTabLabelsByWorktree({ ...scopeCache.claudeTabLabels });
    setCodexTabLabelsByWorktree({ ...scopeCache.codexTabLabels });
    setGeminiTabLabelsByWorktree({ ...scopeCache.geminiTabLabels });
    setOpenCodeTabLabelsByWorktree({ ...scopeCache.opencodeTabLabels });
    processedNotificationTabRequestIdRef.current = scopeCache.lastProcessedNotificationTabRequestId;
    setLaunchClaudeRequestId(null);
    setLaunchCodexRequestId(null);
    setLaunchGeminiRequestId(null);
    setLaunchOpenCodeRequestId(null);
    processedClaudeRequestIdRef.current = null;
    processedCodexRequestIdRef.current = null;
    processedGeminiRequestIdRef.current = null;
    processedOpenCodeRequestIdRef.current = null;
  }, [getScopeCache]);

  const ensureTerminalTabMounted = useCallback((worktreeId: string) => {
    setOpenTerminals((prev) => {
      if (prev.has(worktreeId)) return prev;
      const next = new Set(prev);
      next.add(worktreeId);
      return next;
    });
  }, []);

  const ensureClaudeTabMounted = useCallback(
    (worktreeId: string) => {
      const scopeCache = getScopeCache();
      scopeCache.openClaudeTabs.add(worktreeId);
      const label = "Claude";
      logAutoClaude("Ensuring Claude tab is mounted", { worktreeId, label });
      scopeCache.claudeTabLabels[worktreeId] = label;
      setOpenClaudeTabs((prev) => {
        if (prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.add(worktreeId);
        return next;
      });
      setClaudeTabLabelsByWorktree((prev) => {
        if (prev[worktreeId] === label) return prev;
        return { ...prev, [worktreeId]: label };
      });
    },
    [getScopeCache, logAutoClaude],
  );

  const ensureCodexTabMounted = useCallback(
    (worktreeId: string) => {
      const scopeCache = getScopeCache();
      scopeCache.openCodexTabs.add(worktreeId);
      const label = "Codex";
      logAutoClaude("Ensuring Codex tab is mounted", { worktreeId, label });
      scopeCache.codexTabLabels[worktreeId] = label;
      setOpenCodexTabs((prev) => {
        if (prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.add(worktreeId);
        return next;
      });
      setCodexTabLabelsByWorktree((prev) => {
        if (prev[worktreeId] === label) return prev;
        return { ...prev, [worktreeId]: label };
      });
    },
    [getScopeCache, logAutoClaude],
  );

  const ensureGeminiTabMounted = useCallback(
    (worktreeId: string) => {
      const scopeCache = getScopeCache();
      scopeCache.openGeminiTabs.add(worktreeId);
      const label = "Gemini";
      logAutoClaude("Ensuring Gemini tab is mounted", { worktreeId, label });
      scopeCache.geminiTabLabels[worktreeId] = label;
      setOpenGeminiTabs((prev) => {
        if (prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.add(worktreeId);
        return next;
      });
      setGeminiTabLabelsByWorktree((prev) => {
        if (prev[worktreeId] === label) return prev;
        return { ...prev, [worktreeId]: label };
      });
    },
    [getScopeCache, logAutoClaude],
  );

  const ensureOpenCodeTabMounted = useCallback(
    (worktreeId: string) => {
      const scopeCache = getScopeCache();
      scopeCache.openOpenCodeTabs.add(worktreeId);
      const label = "OpenCode";
      logAutoClaude("Ensuring OpenCode tab is mounted", { worktreeId, label });
      scopeCache.opencodeTabLabels[worktreeId] = label;
      setOpenOpenCodeTabs((prev) => {
        if (prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.add(worktreeId);
        return next;
      });
      setOpenCodeTabLabelsByWorktree((prev) => {
        if (prev[worktreeId] === label) return prev;
        return { ...prev, [worktreeId]: label };
      });
    },
    [getScopeCache, logAutoClaude],
  );

  const closeClaudeTab = useCallback(
    (worktreeId: string) => {
      const scopeCache = getScopeCache();
      scopeCache.openClaudeTabs.delete(worktreeId);
      delete scopeCache.claudeTabLabels[worktreeId];
      setOpenClaudeTabs((prev) => {
        if (!prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.delete(worktreeId);
        return next;
      });
      setClaudeTabLabelsByWorktree((prev) => {
        if (!(worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[worktreeId];
        return next;
      });
      setLaunchClaudeRequestId(null);
      setCurrentClaudeLaunchRequest((prev) => (prev?.worktreeId === worktreeId ? null : prev));
      setCloseClaudeRequestIdByWorktree((prev) => {
        if (!(worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[worktreeId];
        return next;
      });
      setTabPerWorktree((prev) => {
        if (prev[worktreeId] !== "claude") return prev;
        scopeCache.tabCache[worktreeId] = "logs";
        return { ...prev, [worktreeId]: "logs" };
      });
    },
    [getScopeCache],
  );

  const closeCodexTab = useCallback(
    (worktreeId: string) => {
      const scopeCache = getScopeCache();
      scopeCache.openCodexTabs.delete(worktreeId);
      delete scopeCache.codexTabLabels[worktreeId];
      setOpenCodexTabs((prev) => {
        if (!prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.delete(worktreeId);
        return next;
      });
      setCodexTabLabelsByWorktree((prev) => {
        if (!(worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[worktreeId];
        return next;
      });
      setLaunchCodexRequestId(null);
      setCurrentCodexLaunchRequest((prev) => (prev?.worktreeId === worktreeId ? null : prev));
      setCloseCodexRequestIdByWorktree((prev) => {
        if (!(worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[worktreeId];
        return next;
      });
      setTabPerWorktree((prev) => {
        if (prev[worktreeId] !== "codex") return prev;
        scopeCache.tabCache[worktreeId] = "logs";
        return { ...prev, [worktreeId]: "logs" };
      });
    },
    [getScopeCache],
  );

  const closeGeminiTab = useCallback(
    (worktreeId: string) => {
      const scopeCache = getScopeCache();
      scopeCache.openGeminiTabs.delete(worktreeId);
      delete scopeCache.geminiTabLabels[worktreeId];
      setOpenGeminiTabs((prev) => {
        if (!prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.delete(worktreeId);
        return next;
      });
      setGeminiTabLabelsByWorktree((prev) => {
        if (!(worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[worktreeId];
        return next;
      });
      setLaunchGeminiRequestId(null);
      setCurrentGeminiLaunchRequest((prev) => (prev?.worktreeId === worktreeId ? null : prev));
      setCloseGeminiRequestIdByWorktree((prev) => {
        if (!(worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[worktreeId];
        return next;
      });
      setTabPerWorktree((prev) => {
        if (prev[worktreeId] !== "gemini") return prev;
        scopeCache.tabCache[worktreeId] = "logs";
        return { ...prev, [worktreeId]: "logs" };
      });
    },
    [getScopeCache],
  );

  const closeOpenCodeTab = useCallback(
    (worktreeId: string) => {
      const scopeCache = getScopeCache();
      scopeCache.openOpenCodeTabs.delete(worktreeId);
      delete scopeCache.opencodeTabLabels[worktreeId];
      setOpenOpenCodeTabs((prev) => {
        if (!prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.delete(worktreeId);
        return next;
      });
      setOpenCodeTabLabelsByWorktree((prev) => {
        if (!(worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[worktreeId];
        return next;
      });
      setLaunchOpenCodeRequestId(null);
      setCurrentOpenCodeLaunchRequest((prev) => (prev?.worktreeId === worktreeId ? null : prev));
      setCloseOpenCodeRequestIdByWorktree((prev) => {
        if (!(worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[worktreeId];
        return next;
      });
      setTabPerWorktree((prev) => {
        if (prev[worktreeId] !== "opencode") return prev;
        scopeCache.tabCache[worktreeId] = "logs";
        return { ...prev, [worktreeId]: "logs" };
      });
    },
    [getScopeCache],
  );

  const handleClaudeExit = useCallback(
    (worktreeId: string, exitCode?: number) => {
      closeClaudeTab(worktreeId);
      if (exitCode !== 0) return;
      void (async () => {
        logAutoClaude("Running post-implementation hooks after Claude exit", {
          worktreeId,
          exitCode,
        });
        const run = await api.runHooks(worktreeId, "post-implementation");
        const failedCount = run.steps.filter((step) => step.status === "failed").length;
        logAutoClaude("Post-implementation hooks finished", {
          worktreeId,
          status: run.status,
          stepCount: run.steps.length,
          failedCount,
        });
      })();
    },
    [api, closeClaudeTab, logAutoClaude],
  );

  const handleCodexExit = useCallback(
    (worktreeId: string, exitCode?: number) => {
      closeCodexTab(worktreeId);
      if (exitCode !== 0) return;
      void (async () => {
        logAutoClaude("Running post-implementation hooks after Codex exit", {
          worktreeId,
          exitCode,
        });
        const run = await api.runHooks(worktreeId, "post-implementation");
        const failedCount = run.steps.filter((step) => step.status === "failed").length;
        logAutoClaude("Post-implementation hooks finished", {
          worktreeId,
          status: run.status,
          stepCount: run.steps.length,
          failedCount,
        });
      })();
    },
    [api, closeCodexTab, logAutoClaude],
  );

  const handleGeminiExit = useCallback(
    (worktreeId: string, exitCode?: number) => {
      closeGeminiTab(worktreeId);
      if (exitCode !== 0) return;
      void (async () => {
        logAutoClaude("Running post-implementation hooks after Gemini exit", {
          worktreeId,
          exitCode,
        });
        const run = await api.runHooks(worktreeId, "post-implementation");
        const failedCount = run.steps.filter((step) => step.status === "failed").length;
        logAutoClaude("Post-implementation hooks finished", {
          worktreeId,
          status: run.status,
          stepCount: run.steps.length,
          failedCount,
        });
      })();
    },
    [api, closeGeminiTab, logAutoClaude],
  );

  const handleOpenCodeExit = useCallback(
    (worktreeId: string, exitCode?: number) => {
      closeOpenCodeTab(worktreeId);
      if (exitCode !== 0) return;
      void (async () => {
        logAutoClaude("Running post-implementation hooks after OpenCode exit", {
          worktreeId,
          exitCode,
        });
        const run = await api.runHooks(worktreeId, "post-implementation");
        const failedCount = run.steps.filter((step) => step.status === "failed").length;
        logAutoClaude("Post-implementation hooks finished", {
          worktreeId,
          status: run.status,
          stepCount: run.steps.length,
          failedCount,
        });
      })();
    },
    [api, closeOpenCodeTab, logAutoClaude],
  );

  const openClaudeWithRequest = useCallback(
    (request: AgentLaunchRequest) => {
      logAutoClaude("Opening Claude tab with launch request", {
        scopeKey: detailScopeKey,
        worktreeId: request.worktreeId,
        requestId: request.requestId,
        mode: request.mode,
        tabLabel: request.tabLabel,
      });
      setCurrentClaudeLaunchRequest(request);
      setCloseClaudeRequestIdByWorktree((prev) => {
        if (!(request.worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[request.worktreeId];
        return next;
      });
      setTabForWorktree(request.worktreeId, "claude");
      ensureClaudeTabMounted(request.worktreeId);
      setLaunchClaudeRequestId(request.requestId);
    },
    [detailScopeKey, ensureClaudeTabMounted, logAutoClaude, setTabForWorktree],
  );

  const openCodexWithRequest = useCallback(
    (request: AgentLaunchRequest) => {
      logAutoClaude("Opening Codex tab with launch request", {
        scopeKey: detailScopeKey,
        worktreeId: request.worktreeId,
        requestId: request.requestId,
        mode: request.mode,
        tabLabel: request.tabLabel,
      });
      setCurrentCodexLaunchRequest(request);
      setCloseCodexRequestIdByWorktree((prev) => {
        if (!(request.worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[request.worktreeId];
        return next;
      });
      setTabForWorktree(request.worktreeId, "codex");
      ensureCodexTabMounted(request.worktreeId);
      setLaunchCodexRequestId(request.requestId);
    },
    [detailScopeKey, ensureCodexTabMounted, logAutoClaude, setTabForWorktree],
  );

  const openGeminiWithRequest = useCallback(
    (request: AgentLaunchRequest) => {
      logAutoClaude("Opening Gemini tab with launch request", {
        scopeKey: detailScopeKey,
        worktreeId: request.worktreeId,
        requestId: request.requestId,
        mode: request.mode,
        tabLabel: request.tabLabel,
      });
      setCurrentGeminiLaunchRequest(request);
      setCloseGeminiRequestIdByWorktree((prev) => {
        if (!(request.worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[request.worktreeId];
        return next;
      });
      setTabForWorktree(request.worktreeId, "gemini");
      ensureGeminiTabMounted(request.worktreeId);
      setLaunchGeminiRequestId(request.requestId);
    },
    [detailScopeKey, ensureGeminiTabMounted, logAutoClaude, setTabForWorktree],
  );

  const openOpenCodeWithRequest = useCallback(
    (request: AgentLaunchRequest) => {
      logAutoClaude("Opening OpenCode tab with launch request", {
        scopeKey: detailScopeKey,
        worktreeId: request.worktreeId,
        requestId: request.requestId,
        mode: request.mode,
        tabLabel: request.tabLabel,
      });
      setCurrentOpenCodeLaunchRequest(request);
      setCloseOpenCodeRequestIdByWorktree((prev) => {
        if (!(request.worktreeId in prev)) return prev;
        const next = { ...prev };
        delete next[request.worktreeId];
        return next;
      });
      setTabForWorktree(request.worktreeId, "opencode");
      ensureOpenCodeTabMounted(request.worktreeId);
      setLaunchOpenCodeRequestId(request.requestId);
    },
    [detailScopeKey, ensureOpenCodeTabMounted, logAutoClaude, setTabForWorktree],
  );

  const handleLaunchRequestHandled = useCallback(
    (
      agent: "claude" | "codex" | "gemini" | "opencode",
      requestId: number,
      outcome: AgentLaunchOutcome,
    ) => {
      logAutoClaude(`${agent} launch request handled`, {
        scopeKey: detailScopeKey,
        worktreeId: worktree?.id ?? null,
        requestId,
        outcome,
      });
      if (agent === "claude") {
        setLaunchClaudeRequestId((prev) => (prev === requestId ? null : prev));
        return;
      }
      if (agent === "codex") {
        setLaunchCodexRequestId((prev) => (prev === requestId ? null : prev));
        return;
      }
      if (agent === "gemini") {
        setLaunchGeminiRequestId((prev) => (prev === requestId ? null : prev));
        return;
      }
      setLaunchOpenCodeRequestId((prev) => (prev === requestId ? null : prev));
    },
    [detailScopeKey, logAutoClaude, worktree?.id],
  );

  const getAgentTabLabel = useCallback((agent: "claude" | "codex" | "gemini" | "opencode") => {
    if (agent === "claude") return "Claude";
    if (agent === "codex") return "Codex";
    if (agent === "gemini") return "Gemini";
    return "OpenCode";
  }, []);

  const launchAgentIntent = useCallback(
    (
      agent: "claude" | "codex" | "gemini" | "opencode",
      intent: {
        worktreeId: string;
        mode: "resume" | "resume-active" | "resume-history" | "start" | "start-new";
        prompt?: string;
        tabLabel?: string;
        skipPermissions?: boolean;
        sessionId?: string;
      },
    ) => {
      if (agent === "claude") {
        onCodeWithClaude?.(intent);
        return;
      }
      if (agent === "codex") {
        onCodeWithCodex?.(intent);
        return;
      }
      if (agent === "gemini") {
        onCodeWithGemini?.(
          intent as {
            worktreeId: string;
            mode: "resume" | "start";
            prompt?: string;
            tabLabel?: string;
          },
        );
        return;
      }
      onCodeWithOpenCode?.(
        intent as {
          worktreeId: string;
          mode: "resume" | "start";
          prompt?: string;
          tabLabel?: string;
        },
      );
    },
    [onCodeWithClaude, onCodeWithCodex, onCodeWithGemini, onCodeWithOpenCode],
  );

  const launchWorktreeAgent = useCallback(
    async (agent: "claude" | "codex" | "gemini" | "opencode") => {
      if (!worktree) return;

      const session = await api.fetchActiveTerminalSession(worktree.id, agent);
      if (!session.success) {
        setError(session.error || `Failed to prepare ${agent} launch`);
        return;
      }

      const mode: "resume" | "start" = session.sessionId ? "resume" : "start";
      logAutoClaude("Launching worktree agent from detail panel", {
        scopeKey: detailScopeKey,
        worktreeId: worktree.id,
        agent,
        mode,
        existingSessionId: session.sessionId,
      });

      const intent = {
        worktreeId: worktree.id,
        mode,
        tabLabel: getAgentTabLabel(agent),
      };
      launchAgentIntent(agent, intent);
    },
    [api, detailScopeKey, getAgentTabLabel, logAutoClaude, launchAgentIntent, worktree],
  );

  const handleStartNewConversation = useCallback(
    (agent: RestorableAgent) => {
      if (!worktree) return;
      launchAgentIntent(agent, {
        worktreeId: worktree.id,
        mode: "start-new",
        tabLabel: getAgentTabLabel(agent),
      });
      setAgentRestoreModal(null);
    },
    [getAgentTabLabel, launchAgentIntent, worktree],
  );

  const handleOpenClaudeTab = useCallback(() => {
    if (!worktree || isResolvingAgentRestore) return;

    const requestWorktreeId = worktree.id;
    restoreWorktreeIdRef.current = requestWorktreeId;

    void (async () => {
      setIsResolvingAgentRestore("claude");
      setAgentRestoreModal(null);

      const restore = await api.fetchRestorableAgentSessions(requestWorktreeId, "claude");

      // Bail out if the user switched worktrees while the request was in flight
      if (restoreWorktreeIdRef.current !== requestWorktreeId) {
        log.debug("Ignoring stale Claude restore response", {
          domain: "agent-restore",
          agent: "claude",
          requestWorktreeId,
          currentWorktreeId: restoreWorktreeIdRef.current,
        });
        setIsResolvingAgentRestore((prev) => (prev === "claude" ? null : prev));
        return;
      }

      setIsResolvingAgentRestore((prev) => (prev === "claude" ? null : prev));
      if (!restore.success) {
        setError(restore.error || "Failed to restore Claude conversation");
        return;
      }

      if (restore.activeSessionId) {
        launchAgentIntent("claude", {
          worktreeId: requestWorktreeId,
          mode: "resume-active",
          tabLabel: getAgentTabLabel("claude"),
        });
        return;
      }

      if (restore.historyMatches.length === 1) {
        launchAgentIntent("claude", {
          worktreeId: requestWorktreeId,
          mode: "resume-history",
          sessionId: restore.historyMatches[0].sessionId,
          tabLabel: getAgentTabLabel("claude"),
        });
        return;
      }

      if (restore.historyMatches.length > 1) {
        setAgentRestoreModal({
          agent: "claude",
          matches: restore.historyMatches,
          selectedSessionId: restore.historyMatches[0]?.sessionId ?? null,
        });
        return;
      }

      handleStartNewConversation("claude");
    })();
  }, [
    api,
    getAgentTabLabel,
    handleStartNewConversation,
    isResolvingAgentRestore,
    launchAgentIntent,
    worktree,
  ]);

  const requestCloseClaudeTab = useCallback((worktreeId: string) => {
    closeClaudeRequestIdRef.current += 1;
    const requestId = closeClaudeRequestIdRef.current;
    setCloseClaudeRequestIdByWorktree((prev) => ({ ...prev, [worktreeId]: requestId }));
  }, []);

  const handleOpenCodexTab = useCallback(() => {
    if (!worktree || isResolvingAgentRestore) return;

    const requestWorktreeId = worktree.id;
    restoreWorktreeIdRef.current = requestWorktreeId;

    void (async () => {
      setIsResolvingAgentRestore("codex");
      setAgentRestoreModal(null);

      const restore = await api.fetchRestorableAgentSessions(requestWorktreeId, "codex");

      // Bail out if the user switched worktrees while the request was in flight
      if (restoreWorktreeIdRef.current !== requestWorktreeId) {
        log.debug("Ignoring stale Codex restore response", {
          domain: "agent-restore",
          agent: "codex",
          requestWorktreeId,
          currentWorktreeId: restoreWorktreeIdRef.current,
        });
        setIsResolvingAgentRestore((prev) => (prev === "codex" ? null : prev));
        return;
      }

      setIsResolvingAgentRestore((prev) => (prev === "codex" ? null : prev));
      if (!restore.success) {
        setError(restore.error || "Failed to restore Codex conversation");
        return;
      }

      if (restore.activeSessionId) {
        launchAgentIntent("codex", {
          worktreeId: requestWorktreeId,
          mode: "resume-active",
          tabLabel: getAgentTabLabel("codex"),
        });
        return;
      }

      if (restore.historyMatches.length === 1) {
        launchAgentIntent("codex", {
          worktreeId: requestWorktreeId,
          mode: "resume-history",
          sessionId: restore.historyMatches[0].sessionId,
          tabLabel: getAgentTabLabel("codex"),
        });
        return;
      }

      if (restore.historyMatches.length > 1) {
        setAgentRestoreModal({
          agent: "codex",
          matches: restore.historyMatches,
          selectedSessionId: restore.historyMatches[0]?.sessionId ?? null,
        });
        return;
      }

      handleStartNewConversation("codex");
    })();
  }, [
    api,
    getAgentTabLabel,
    handleStartNewConversation,
    isResolvingAgentRestore,
    launchAgentIntent,
    worktree,
  ]);

  const requestCloseCodexTab = useCallback((worktreeId: string) => {
    closeCodexRequestIdRef.current += 1;
    const requestId = closeCodexRequestIdRef.current;
    setCloseCodexRequestIdByWorktree((prev) => ({ ...prev, [worktreeId]: requestId }));
  }, []);

  const handleRestoreSelectedConversation = useCallback(() => {
    if (!worktree || !agentRestoreModal?.selectedSessionId) return;
    launchAgentIntent(agentRestoreModal.agent, {
      worktreeId: worktree.id,
      mode: "resume-history",
      sessionId: agentRestoreModal.selectedSessionId,
      tabLabel: getAgentTabLabel(agentRestoreModal.agent),
    });
    setAgentRestoreModal(null);
  }, [agentRestoreModal, getAgentTabLabel, launchAgentIntent, worktree]);

  const handleOpenGeminiTab = useCallback(() => {
    void launchWorktreeAgent("gemini");
  }, [launchWorktreeAgent]);

  const requestCloseGeminiTab = useCallback((worktreeId: string) => {
    closeGeminiRequestIdRef.current += 1;
    const requestId = closeGeminiRequestIdRef.current;
    setCloseGeminiRequestIdByWorktree((prev) => ({ ...prev, [worktreeId]: requestId }));
  }, []);

  const handleOpenOpenCodeTab = useCallback(() => {
    void launchWorktreeAgent("opencode");
  }, [launchWorktreeAgent]);

  const requestCloseOpenCodeTab = useCallback((worktreeId: string) => {
    closeOpenCodeRequestIdRef.current += 1;
    const requestId = closeOpenCodeRequestIdRef.current;
    setCloseOpenCodeRequestIdByWorktree((prev) => ({ ...prev, [worktreeId]: requestId }));
  }, []);

  const handleOpenAgentTab = useCallback(
    (agent: CodingAgent) => {
      if (agent === "claude") handleOpenClaudeTab();
      else if (agent === "codex") handleOpenCodexTab();
      else if (agent === "gemini") handleOpenGeminiTab();
      else if (agent === "opencode") handleOpenOpenCodeTab();
    },
    [handleOpenClaudeTab, handleOpenCodexTab, handleOpenGeminiTab, handleOpenOpenCodeTab],
  );

  useEffect(() => {
    void (async () => {
      let installed: CodingAgent[];

      if (window.electronAPI) {
        // Electron: check via IPC — no project server needed
        const agents = await window.electronAPI.getInstalledAgents();
        installed = agents.filter((id): id is CodingAgent =>
          AGENT_OPTIONS.some((opt) => opt.id === id),
        );
      } else {
        // Browser mode: fall back to project server API
        if (!serverUrl) return;
        const results = await Promise.all(
          AGENT_OPTIONS.map(async (option) => {
            const status = await api.fetchAgentCliStatus(option.id);
            return status.success && status.installed ? option.id : null;
          }),
        );
        installed = results.filter((id): id is CodingAgent => id !== null);
      }

      setInstalledAgents(new Set(installed));
    })();
  }, [api, serverUrl]);

  // Reset form state when worktree changes (but NOT tab or terminal state)
  useEffect(() => {
    setError(null);
    setShowCommitInput(false);
    setShowCreatePrInput(false);
    setCommitMessage("");
    setPrTitle("");
    setGitAction(null);
    setIsResolvingAgentRestore(null);
    setAgentRestoreModal(null);
  }, [worktree?.id]);

  useEffect(() => {
    if (!worktree) {
      setOpenTargetOptions([]);
      setSelectedOpenTarget(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const result = await api.fetchOpenProjectTargets(worktree.id);
      if (cancelled) return;
      if (!result.success) {
        setOpenTargetOptions([]);
        setSelectedOpenTarget(null);
        return;
      }

      const targets = result.targets ?? [];
      setOpenTargetOptions(targets);
      setSelectedOpenTarget(pickDefaultOpenTarget(targets, result.selectedTarget));
    })();

    return () => {
      cancelled = true;
    };
  }, [api, worktree?.id]);

  useEffect(() => {
    if (!worktree) return;
    let cancelled = false;

    void (async () => {
      const claudeResult = await api.fetchActiveTerminalSession(worktree.id, "claude");
      if (cancelled) return;
      if (claudeResult.success && claudeResult.sessionId) {
        ensureClaudeTabMounted(worktree.id);
      }

      const codexResult = await api.fetchActiveTerminalSession(worktree.id, "codex");
      if (cancelled) return;
      if (codexResult.success && codexResult.sessionId) {
        ensureCodexTabMounted(worktree.id);
      }

      const geminiResult = await api.fetchActiveTerminalSession(worktree.id, "gemini");
      if (cancelled) return;
      if (geminiResult.success && geminiResult.sessionId) {
        ensureGeminiTabMounted(worktree.id);
      }

      const opencodeResult = await api.fetchActiveTerminalSession(worktree.id, "opencode");
      if (cancelled) return;
      if (opencodeResult.success && opencodeResult.sessionId) {
        ensureOpenCodeTabMounted(worktree.id);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    api,
    ensureClaudeTabMounted,
    ensureCodexTabMounted,
    ensureGeminiTabMounted,
    ensureOpenCodeTabMounted,
    worktree?.id,
  ]);

  useEffect(() => {
    if (!claudeLaunchRequest) return;
    if (processedClaudeRequestIdRef.current === claudeLaunchRequest.requestId) return;
    processedClaudeRequestIdRef.current = claudeLaunchRequest.requestId;
    openClaudeWithRequest(claudeLaunchRequest);
  }, [claudeLaunchRequest, openClaudeWithRequest]);

  useEffect(() => {
    if (!codexLaunchRequest) return;
    if (processedCodexRequestIdRef.current === codexLaunchRequest.requestId) return;
    processedCodexRequestIdRef.current = codexLaunchRequest.requestId;
    openCodexWithRequest(codexLaunchRequest);
  }, [codexLaunchRequest, openCodexWithRequest]);

  useEffect(() => {
    if (!geminiLaunchRequest) return;
    if (processedGeminiRequestIdRef.current === geminiLaunchRequest.requestId) return;
    processedGeminiRequestIdRef.current = geminiLaunchRequest.requestId;
    openGeminiWithRequest(geminiLaunchRequest);
  }, [geminiLaunchRequest, openGeminiWithRequest]);

  useEffect(() => {
    if (!opencodeLaunchRequest) return;
    if (processedOpenCodeRequestIdRef.current === opencodeLaunchRequest.requestId) return;
    processedOpenCodeRequestIdRef.current = opencodeLaunchRequest.requestId;
    openOpenCodeWithRequest(opencodeLaunchRequest);
  }, [opencodeLaunchRequest, openOpenCodeWithRequest]);

  useEffect(() => {
    if (!notificationTabRequest) return;
    if (processedNotificationTabRequestIdRef.current === notificationTabRequest.requestId) return;
    processedNotificationTabRequestIdRef.current = notificationTabRequest.requestId;
    getScopeCache().lastProcessedNotificationTabRequestId = notificationTabRequest.requestId;
    if (notificationTabRequest.tab === "hooks") {
      setTabForWorktree(notificationTabRequest.worktreeId, "hooks");
    }
  }, [getScopeCache, notificationTabRequest, setTabForWorktree]);

  // If terminal/agent tab is restored from cache on remount, ensure that view is mounted.
  useEffect(() => {
    if (!worktree) return;
    const scopeCache = getScopeCache();
    if (activeTab === "terminal") {
      ensureTerminalTabMounted(worktree.id);
      return;
    }
    if (activeTab === "claude") {
      if (scopeCache.openClaudeTabs.has(worktree.id)) {
        ensureClaudeTabMounted(worktree.id);
        return;
      }
      setTabForWorktree(worktree.id, "logs");
      return;
    }
    if (activeTab === "codex") {
      if (scopeCache.openCodexTabs.has(worktree.id)) {
        ensureCodexTabMounted(worktree.id);
        return;
      }
      setTabForWorktree(worktree.id, "logs");
      return;
    }
    if (activeTab === "gemini") {
      if (scopeCache.openGeminiTabs.has(worktree.id)) {
        ensureGeminiTabMounted(worktree.id);
        return;
      }
      setTabForWorktree(worktree.id, "logs");
      return;
    }
    if (activeTab === "opencode") {
      if (scopeCache.openOpenCodeTabs.has(worktree.id)) {
        ensureOpenCodeTabMounted(worktree.id);
        return;
      }
      setTabForWorktree(worktree.id, "logs");
    }
  }, [
    activeTab,
    ensureClaudeTabMounted,
    ensureCodexTabMounted,
    ensureGeminiTabMounted,
    ensureOpenCodeTabMounted,
    ensureTerminalTabMounted,
    getScopeCache,
    setTabForWorktree,
    worktree,
  ]);

  // Keep all hooks above this guard; adding hooks below it breaks hook ordering between renders.
  if (!worktree) {
    log.debug("DetailPanel returning early (worktree=null)", {
      domain: "project-switch",
      detailScopeKey,
      openClaudeTabCount: openClaudeTabs.size,
      openClaudeTabIds: [...openClaudeTabs],
      openTerminalCount: openTerminals.size,
    });
    return (
      <div className={`flex-1 flex items-center justify-center ${text.dimmed} text-sm`}>
        Select a worktree or create a new one
      </div>
    );
  }

  const isRunning = worktree.status === "running";
  const isCreating = worktree.status === "creating";
  const canRecoverLocalTask =
    !worktree.jiraUrl &&
    !worktree.linearUrl &&
    !worktree.localIssueId &&
    /^LOCAL-\d+$/i.test(worktree.id);

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    const result = await api.startWorktree(worktree.id);
    setIsLoading(false);
    if (!result.success) setError(result.error || "Failed to start");
    onUpdate();
  };

  const handleStop = async () => {
    setIsLoading(true);
    setError(null);
    const result = await api.stopWorktree(worktree.id);
    setIsLoading(false);
    if (!result.success) setError(result.error || "Failed to stop");
    onUpdate();
  };

  const handleRemove = () => setShowRemoveModal(true);

  const pruneDeletedWorktreeUiState = (deletedId: string) => {
    const scopeCache = getScopeCache();
    clearTerminalSessionCacheForRuntimeWorktree(detailScopeKey, deletedId);
    // Clean up state for this worktree
    setOpenTerminals((prev) => {
      const next = new Set(prev);
      next.delete(deletedId);
      return next;
    });
    scopeCache.openClaudeTabs.delete(deletedId);
    scopeCache.openCodexTabs.delete(deletedId);
    scopeCache.openGeminiTabs.delete(deletedId);
    scopeCache.openOpenCodeTabs.delete(deletedId);
    delete scopeCache.claudeTabLabels[deletedId];
    delete scopeCache.codexTabLabels[deletedId];
    delete scopeCache.geminiTabLabels[deletedId];
    delete scopeCache.opencodeTabLabels[deletedId];
    setOpenClaudeTabs((prev) => {
      const next = new Set(prev);
      next.delete(deletedId);
      return next;
    });
    setOpenCodexTabs((prev) => {
      const next = new Set(prev);
      next.delete(deletedId);
      return next;
    });
    setOpenGeminiTabs((prev) => {
      const next = new Set(prev);
      next.delete(deletedId);
      return next;
    });
    setOpenOpenCodeTabs((prev) => {
      const next = new Set(prev);
      next.delete(deletedId);
      return next;
    });
    setClaudeTabLabelsByWorktree((prev) => {
      if (!(deletedId in prev)) return prev;
      const next = { ...prev };
      delete next[deletedId];
      return next;
    });
    setCodexTabLabelsByWorktree((prev) => {
      if (!(deletedId in prev)) return prev;
      const next = { ...prev };
      delete next[deletedId];
      return next;
    });
    setGeminiTabLabelsByWorktree((prev) => {
      if (!(deletedId in prev)) return prev;
      const next = { ...prev };
      delete next[deletedId];
      return next;
    });
    setOpenCodeTabLabelsByWorktree((prev) => {
      if (!(deletedId in prev)) return prev;
      const next = { ...prev };
      delete next[deletedId];
      return next;
    });
    setTabPerWorktree((prev) => {
      const { [deletedId]: _, ...rest } = prev;
      return rest;
    });
    delete scopeCache.tabCache[deletedId];
    setLaunchClaudeRequestId((prev) =>
      currentClaudeLaunchRequest?.worktreeId === deletedId ? null : prev,
    );
    setLaunchCodexRequestId((prev) =>
      currentCodexLaunchRequest?.worktreeId === deletedId ? null : prev,
    );
    setLaunchGeminiRequestId((prev) =>
      currentGeminiLaunchRequest?.worktreeId === deletedId ? null : prev,
    );
    setLaunchOpenCodeRequestId((prev) =>
      currentOpenCodeLaunchRequest?.worktreeId === deletedId ? null : prev,
    );
    setCurrentClaudeLaunchRequest((prev) => (prev?.worktreeId === deletedId ? null : prev));
    setCurrentCodexLaunchRequest((prev) => (prev?.worktreeId === deletedId ? null : prev));
    setCurrentGeminiLaunchRequest((prev) => (prev?.worktreeId === deletedId ? null : prev));
    setCurrentOpenCodeLaunchRequest((prev) => (prev?.worktreeId === deletedId ? null : prev));
    setCloseClaudeRequestIdByWorktree((prev) => {
      if (!(deletedId in prev)) return prev;
      const next = { ...prev };
      delete next[deletedId];
      return next;
    });
    setCloseCodexRequestIdByWorktree((prev) => {
      if (!(deletedId in prev)) return prev;
      const next = { ...prev };
      delete next[deletedId];
      return next;
    });
    setCloseGeminiRequestIdByWorktree((prev) => {
      if (!(deletedId in prev)) return prev;
      const next = { ...prev };
      delete next[deletedId];
      return next;
    });
    setCloseOpenCodeRequestIdByWorktree((prev) => {
      if (!(deletedId in prev)) return prev;
      const next = { ...prev };
      delete next[deletedId];
      return next;
    });
  };

  const handleConfirmRemove = async () => {
    if (isDeletingWorktree) return;
    setError(null);
    setIsDeletingWorktree(true);
    const deletedId = worktree.id;
    try {
      const result = await api.removeWorktree(deletedId);
      if (!result.success) {
        setError(result.error || "Failed to remove worktree");
        return;
      }

      setShowRemoveModal(false);
      pruneDeletedWorktreeUiState(result.worktreeId ?? deletedId);
      onDeleted();
      onUpdate();
    } finally {
      setIsDeletingWorktree(false);
    }
  };

  const handleRename = async (changes: { name?: string; branch?: string }): Promise<boolean> => {
    setError(null);
    const result = await api.renameWorktree(worktree.id, changes);
    if (!result.success) setError(result.error || "Failed to rename");
    onUpdate();
    return result.success;
  };

  const handleOpenProjectIn = async (target: OpenProjectTarget) => {
    setSelectedOpenTarget(target);
    setError(null);
    const result = await api.openWorktreeIn(worktree.id, target);
    if (!result.success) setError(result.error || "Failed to open project");
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setIsGitLoading(true);
    setGitAction("commit");
    setError(null);
    try {
      const result = await api.commitChanges(worktree.id, commitMessage.trim());
      if (result.success) {
        setShowCommitInput(false);
        setCommitMessage("");

        if (pushAfterCommit) {
          setGitAction("push");
          const pushResult = await api.pushChanges(worktree.id);
          if (!pushResult.success) {
            setError(pushResult.error || "Committed successfully, but failed to push");
          }
        }
      } else {
        setError(result.error || "Failed to commit");
      }
      onUpdate();
    } finally {
      setIsGitLoading(false);
      setGitAction(null);
    }
  };

  const handlePush = async () => {
    setIsGitLoading(true);
    setGitAction("push");
    setError(null);
    try {
      const result = await api.pushChanges(worktree.id);
      if (!result.success) setError(result.error || "Failed to push");
      onUpdate();
    } finally {
      setIsGitLoading(false);
      setGitAction(null);
    }
  };

  const handleCreatePr = async () => {
    if (!prTitle.trim()) return;
    setIsGitLoading(true);
    setGitAction("pr");
    setError(null);
    try {
      const result = await api.createPullRequest(worktree.id, prTitle.trim());
      if (result.success) {
        setShowCreatePrInput(false);
        setPrTitle("");
      } else {
        setError(result.error || "Failed to create PR");
      }
      onUpdate();
    } finally {
      setIsGitLoading(false);
      setGitAction(null);
    }
  };

  const handleMoveToWorktree = async () => {
    if (!moveToWorktreeBranch.trim()) return;
    setIsGitLoading(true);
    setError(null);
    try {
      const result = await api.moveToWorktree(moveToWorktreeBranch.trim());
      if (result.success) {
        setShowMoveToWorktreeInput(false);
        setMoveToWorktreeBranch("");
      } else {
        setError(result.error || "Failed to move changes to worktree");
      }
      onUpdate();
    } finally {
      setIsGitLoading(false);
    }
  };

  const handleRecoverLocalTask = async () => {
    setIsRecoveringLocalTask(true);
    setError(null);
    const result = await api.recoverLocalTask({
      taskId: worktree.id,
      title: `Recovered task ${worktree.id}`,
    });
    setIsRecoveringLocalTask(false);
    if (!result.success || !result.task) {
      setError(result.error || "Failed to recover local task");
      return;
    }
    if (onSelectLocalIssue) {
      onSelectLocalIssue(result.task.id);
    }
    onUpdate();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <DetailHeader
        worktree={worktree}
        isRunning={isRunning}
        isCreating={isCreating}
        isLoading={isLoading || isDeletingWorktree}
        onRename={handleRename}
        onStart={handleStart}
        onStop={handleStop}
        onRemove={handleRemove}
        onMoveToWorktree={() => setShowMoveToWorktreeInput(true)}
        openTargetOptions={openTargetOptions}
        selectedOpenTarget={selectedOpenTarget}
        onSelectOpenTarget={setSelectedOpenTarget}
        onOpenProjectIn={handleOpenProjectIn}
        showDiffStats={showDiffStats}
        onSelectJiraIssue={onSelectJiraIssue}
        onSelectLinearIssue={onSelectLinearIssue}
        onSelectLocalIssue={onSelectLocalIssue}
      />

      {error && (
        <div
          className={`flex-shrink-0 px-5 py-2 ${errorBanner.panelBg} border-b ${errorBanner.border} flex items-center justify-between`}
        >
          <p className={`${text.error} text-xs break-all min-w-0`}>{error}</p>
          {error.includes("integration not available") && onNavigateToIntegrations && (
            <button
              type="button"
              onClick={onNavigateToIntegrations}
              className="px-2 py-0.5 text-[11px] font-medium text-accent hover:text-accent-muted transition-colors duration-150 flex-shrink-0"
            >
              Configure
            </button>
          )}
        </div>
      )}

      {!isCreating && (
        <div className="flex-shrink-0 h-11 flex items-center justify-between px-4 -mt-1 mb-1">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("changes")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 ${
                activeTab === "changes" ? detailTab.active : detailTab.inactive
              }`}
            >
              Changes
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("logs")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 ${
                activeTab === "logs" ? detailTab.active : detailTab.inactive
              }`}
            >
              Logs
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("terminal");
                ensureTerminalTabMounted(worktree.id);
              }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 ${
                activeTab === "terminal" ? detailTab.active : detailTab.inactive
              }`}
            >
              Terminal
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("hooks")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 ${
                activeTab === "hooks" ? detailTab.active : detailTab.inactive
              }`}
            >
              Hooks
            </button>
            {openClaudeTabs.has(worktree.id) && (
              <div
                className={`inline-flex items-center rounded-md transition-colors duration-150 ${
                  activeTab === "claude" ? detailTab.active : detailTab.inactive
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab("claude")}
                  className="pl-3 pr-1.5 py-1 text-xs font-medium"
                >
                  {claudeTabLabelsByWorktree[worktree.id] ?? "Claude"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseClaudeTab(worktree.id);
                  }}
                  className={`mr-1.5 p-0.5 rounded-sm transition-colors duration-150 ${
                    activeTab === "claude"
                      ? "text-white/70 hover:text-white hover:bg-white/10"
                      : "text-[#6b7280] hover:text-[#9ca3af] hover:bg-white/[0.06]"
                  }`}
                  aria-label="Close Claude tab"
                  title="Close Claude tab"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {openCodexTabs.has(worktree.id) && (
              <div
                className={`inline-flex items-center rounded-md transition-colors duration-150 ${
                  activeTab === "codex" ? detailTab.active : detailTab.inactive
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab("codex")}
                  className="pl-3 pr-1.5 py-1 text-xs font-medium"
                >
                  {codexTabLabelsByWorktree[worktree.id] ?? "Codex"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseCodexTab(worktree.id);
                  }}
                  className={`mr-1.5 p-0.5 rounded-sm transition-colors duration-150 ${
                    activeTab === "codex"
                      ? "text-white/70 hover:text-white hover:bg-white/10"
                      : "text-[#6b7280] hover:text-[#9ca3af] hover:bg-white/[0.06]"
                  }`}
                  aria-label="Close Codex tab"
                  title="Close Codex tab"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {openGeminiTabs.has(worktree.id) && (
              <div
                className={`inline-flex items-center rounded-md transition-colors duration-150 ${
                  activeTab === "gemini" ? detailTab.active : detailTab.inactive
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab("gemini")}
                  className="pl-3 pr-1.5 py-1 text-xs font-medium"
                >
                  {geminiTabLabelsByWorktree[worktree.id] ?? "Gemini"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseGeminiTab(worktree.id);
                  }}
                  className={`mr-1.5 p-0.5 rounded-sm transition-colors duration-150 ${
                    activeTab === "gemini"
                      ? "text-white/70 hover:text-white hover:bg-white/10"
                      : "text-[#6b7280] hover:text-[#9ca3af] hover:bg-white/[0.06]"
                  }`}
                  aria-label="Close Gemini tab"
                  title="Close Gemini tab"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {openOpenCodeTabs.has(worktree.id) && (
              <div
                className={`inline-flex items-center rounded-md transition-colors duration-150 ${
                  activeTab === "opencode" ? detailTab.active : detailTab.inactive
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab("opencode")}
                  className="pl-3 pr-1.5 py-1 text-xs font-medium"
                >
                  {opencodeTabLabelsByWorktree[worktree.id] ?? "OpenCode"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseOpenCodeTab(worktree.id);
                  }}
                  className={`mr-1.5 p-0.5 rounded-sm transition-colors duration-150 ${
                    activeTab === "opencode"
                      ? "text-white/70 hover:text-white hover:bg-white/10"
                      : "text-[#6b7280] hover:text-[#9ca3af] hover:bg-white/[0.06]"
                  }`}
                  aria-label="Close OpenCode tab"
                  title="Close OpenCode tab"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <AddAgentDropdown
              worktreeId={worktree.id}
              installedAgents={installedAgents}
              openClaudeTabs={openClaudeTabs}
              openCodexTabs={openCodexTabs}
              openGeminiTabs={openGeminiTabs}
              openOpenCodeTabs={openOpenCodeTabs}
              isResolvingAgentRestore={isResolvingAgentRestore}
              onOpenAgent={handleOpenAgentTab}
            />
          </div>

          <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-end ml-3">
            {worktree.hasUncommitted && (
              <button
                type="button"
                onClick={() => {
                  setShowCommitInput(true);
                  setShowCreatePrInput(false);
                }}
                disabled={isGitLoading}
                className={`h-7 px-2.5 text-[11px] font-medium ${action.commit.text} ${action.commit.hover} hover:${text.secondary} rounded-md disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-3.5 h-3.5"
                >
                  <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                  <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25h5a.75.75 0 0 0 0-1.5h-5A2.75 2.75 0 0 0 2 5.75v8.5A2.75 2.75 0 0 0 4.75 17h8.5A2.75 2.75 0 0 0 16 14.25v-5a.75.75 0 0 0-1.5 0v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" />
                </svg>
                Commit
              </button>
            )}
            {worktree.hasUnpushed && (
              <button
                type="button"
                onClick={handlePush}
                disabled={isGitLoading}
                className={`h-7 px-2.5 text-[11px] font-medium ${action.push.text} ${action.push.hover} hover:${text.secondary} rounded-md disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
              >
                {isGitLoading && gitAction === "push" ? (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="w-3.5 h-3.5 animate-spin"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2"
                        opacity="0.3"
                      />
                      <path
                        d="M22 12a10 10 0 0 0-10-10"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                    Pushing...
                  </>
                ) : (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-3.5 h-3.5"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 17a.75.75 0 0 1-.75-.75V5.612L5.29 9.77a.75.75 0 0 1-1.08-1.04l5.25-5.5a.75.75 0 0 1 1.08 0l5.25 5.5a.75.75 0 1 1-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0 1 10 17Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Push{worktree.commitsAhead ? ` (${worktree.commitsAhead})` : ""}
                  </>
                )}
              </button>
            )}
            {!worktree.githubPrUrl &&
              !worktree.hasUnpushed &&
              worktree.commitsAheadOfBase !== 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCreatePrInput(true);
                    setShowCommitInput(false);
                  }}
                  disabled={isGitLoading}
                  className={`h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5 ${
                    showCreatePrInput
                      ? `${action.pr.textActive} ${action.pr.bgActive}`
                      : `${action.pr.text} ${action.pr.hover} hover:${text.secondary}`
                  } disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="w-3.5 h-3.5"
                  >
                    <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
                  </svg>
                  Open PR
                </button>
              )}
            {worktree.githubPrUrl && (
              <a
                href={worktree.githubPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`group h-7 px-2.5 text-[11px] font-medium ${action.pr.text} ${action.pr.hover} hover:${text.secondary} rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
              >
                <GitHubIcon className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-white" />
                View PR
              </a>
            )}
            {!worktree.jiraUrl && !worktree.linearUrl && !worktree.localIssueId && (
              <>
                {canRecoverLocalTask && (
                  <button
                    type="button"
                    onClick={handleRecoverLocalTask}
                    disabled={isRecoveringLocalTask}
                    className={`h-7 px-2.5 text-[11px] font-medium ${text.muted} hover:${text.secondary} hover:bg-white/[0.06] rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {isRecoveringLocalTask ? "Recovering..." : "Recover Task"}
                  </button>
                )}
                {onCreateTask && (
                  <button
                    type="button"
                    onClick={() => onCreateTask(worktree.id)}
                    className={`h-7 px-2.5 text-[11px] font-medium ${text.muted} hover:${text.secondary} hover:bg-white/[0.06] rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Create Task
                  </button>
                )}
                {onLinkIssue && (
                  <button
                    type="button"
                    onClick={() => onLinkIssue(worktree.id)}
                    className={`h-7 px-2.5 text-[11px] font-medium ${text.muted} hover:${text.secondary} hover:bg-white/[0.06] rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
                  >
                    <Link className="w-3.5 h-3.5" />
                    Link Issue
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showCommitInput && (
        <Modal
          title="Commit Changes"
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4 text-white"
            >
              <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
              <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25h5a.75.75 0 0 0 0-1.5h-5A2.75 2.75 0 0 0 2 5.75v8.5A2.75 2.75 0 0 0 4.75 17h8.5A2.75 2.75 0 0 0 16 14.25v-5a.75.75 0 0 0-1.5 0v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" />
            </svg>
          }
          width="md"
          onClose={() => setShowCommitInput(false)}
          onSubmit={(e) => {
            e.preventDefault();
            void handleCommit();
          }}
          footer={
            <>
              <label className="flex items-center gap-2 cursor-pointer mr-auto select-none">
                <button
                  type="button"
                  role="switch"
                  aria-checked={pushAfterCommit}
                  onClick={() => setPushAfterCommit((v) => !v)}
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-150 ${
                    pushAfterCommit ? "bg-accent" : "bg-white/[0.12]"
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white transition-transform duration-150 ${
                      pushAfterCommit ? "translate-x-3.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <span className="text-[11px] text-[#9ca3af]">Push after commit</span>
              </label>
              <button
                type="button"
                onClick={() => setShowCommitInput(false)}
                className={`px-3 py-1.5 text-xs rounded-lg ${action.cancel.text} ${action.cancel.textHover} transition-colors`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isGitLoading || !commitMessage.trim()}
                className={`px-3 py-1.5 text-xs font-medium ${action.commit.textActive} ${action.commit.bgSubmit} ${action.commit.bgSubmitHover} rounded-lg disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98]`}
              >
                {isGitLoading && gitAction === "commit"
                  ? "Committing..."
                  : isGitLoading && gitAction === "push"
                    ? "Pushing..."
                    : pushAfterCommit
                      ? "Commit & Push"
                      : "Commit"}
              </button>
            </>
          }
        >
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowCommitInput(false);
            }}
            placeholder="Commit message..."
            className={`w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg ${input.text} text-xs placeholder-[#4b5563] outline-none focus:border-white/[0.15] transition-colors duration-150`}
            autoFocus
          />
        </Modal>
      )}

      {showCreatePrInput && (
        <Modal
          title="Open Pull Request"
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="w-4 h-4 text-white"
            >
              <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
            </svg>
          }
          width="md"
          onClose={() => setShowCreatePrInput(false)}
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreatePr();
          }}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowCreatePrInput(false)}
                className={`px-3 py-1.5 text-xs rounded-lg ${action.cancel.text} ${action.cancel.textHover} transition-colors`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isGitLoading || !prTitle.trim()}
                className={`px-3 py-1.5 text-xs font-medium ${action.pr.textActive} ${action.pr.bgSubmit} ${action.pr.bgSubmitHover} rounded-lg disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98]`}
              >
                {isGitLoading && gitAction === "pr" ? "Creating..." : "Open PR"}
              </button>
            </>
          }
        >
          <input
            type="text"
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowCreatePrInput(false);
            }}
            placeholder="PR title..."
            className={`w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg ${input.text} text-xs placeholder-[#4b5563] outline-none focus:border-white/[0.15] transition-colors duration-150`}
            autoFocus
          />
        </Modal>
      )}

      {showMoveToWorktreeInput && (
        <Modal
          title="Move to Worktree"
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4 text-white"
            >
              <path
                fillRule="evenodd"
                d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm12.25 4a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0v-1.5h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5a.75.75 0 0 1 .75-.75Z"
                clipRule="evenodd"
              />
            </svg>
          }
          width="md"
          onClose={() => setShowMoveToWorktreeInput(false)}
          onSubmit={(e) => {
            e.preventDefault();
            void handleMoveToWorktree();
          }}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowMoveToWorktreeInput(false)}
                className={`px-3 py-1.5 text-xs rounded-lg ${action.cancel.text} ${action.cancel.textHover} transition-colors`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isGitLoading || !moveToWorktreeBranch.trim()}
                className={`px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20 rounded-lg disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98]`}
              >
                {isGitLoading ? "Moving..." : "Move"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className={`text-[11px] ${text.muted}`}>
              Creates a new worktree and moves all uncommitted changes and unpushed commits from the
              root to it.
            </p>
            <input
              type="text"
              value={moveToWorktreeBranch}
              onChange={(e) => setMoveToWorktreeBranch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowMoveToWorktreeInput(false);
              }}
              placeholder="Branch name..."
              className={`w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg ${input.text} text-xs placeholder-[#4b5563] outline-none focus:border-white/[0.15] transition-colors duration-150`}
              autoFocus
            />
          </div>
        </Modal>
      )}

      <LogsViewer
        worktree={worktree}
        isRunning={isRunning}
        isCreating={isCreating}
        visible={isCreating || activeTab === "logs"}
      />
      {[...openTerminals].map((wtId) => (
        <TerminalView
          key={`terminal-${terminalProjectScopeKey}-${wtId}`}
          worktreeId={wtId}
          visible={wtId === worktree.id && activeTab === "terminal" && !isCreating}
        />
      ))}
      {[...openClaudeTabs].map((wtId) => (
        <TerminalView
          key={`claude-${terminalProjectScopeKey}-${wtId}`}
          worktreeId={wtId}
          variant="claude"
          visible={wtId === worktree.id && activeTab === "claude" && !isCreating}
          launchRequest={
            currentClaudeLaunchRequest &&
            launchClaudeRequestId === currentClaudeLaunchRequest.requestId &&
            currentClaudeLaunchRequest.worktreeId === wtId
              ? currentClaudeLaunchRequest
              : null
          }
          onLaunchRequestHandled={(requestId, outcome) => {
            handleLaunchRequestHandled("claude", requestId, outcome);
          }}
          closeRequestId={closeClaudeRequestIdByWorktree[wtId] ?? null}
          onAgentExit={(exitCode) => handleClaudeExit(wtId, exitCode)}
        />
      ))}
      {[...openCodexTabs].map((wtId) => (
        <TerminalView
          key={`codex-${terminalProjectScopeKey}-${wtId}`}
          worktreeId={wtId}
          variant="codex"
          visible={wtId === worktree.id && activeTab === "codex" && !isCreating}
          launchRequest={
            currentCodexLaunchRequest &&
            launchCodexRequestId === currentCodexLaunchRequest.requestId &&
            currentCodexLaunchRequest.worktreeId === wtId
              ? currentCodexLaunchRequest
              : null
          }
          onLaunchRequestHandled={(requestId, outcome) => {
            handleLaunchRequestHandled("codex", requestId, outcome);
          }}
          closeRequestId={closeCodexRequestIdByWorktree[wtId] ?? null}
          onAgentExit={(exitCode) => handleCodexExit(wtId, exitCode)}
        />
      ))}
      {[...openGeminiTabs].map((wtId) => (
        <TerminalView
          key={`gemini-${terminalProjectScopeKey}-${wtId}`}
          worktreeId={wtId}
          variant="gemini"
          visible={wtId === worktree.id && activeTab === "gemini" && !isCreating}
          launchRequest={
            currentGeminiLaunchRequest &&
            launchGeminiRequestId === currentGeminiLaunchRequest.requestId &&
            currentGeminiLaunchRequest.worktreeId === wtId
              ? currentGeminiLaunchRequest
              : null
          }
          onLaunchRequestHandled={(requestId, outcome) => {
            handleLaunchRequestHandled("gemini", requestId, outcome);
          }}
          closeRequestId={closeGeminiRequestIdByWorktree[wtId] ?? null}
          onAgentExit={(exitCode) => handleGeminiExit(wtId, exitCode)}
        />
      ))}
      {[...openOpenCodeTabs].map((wtId) => (
        <TerminalView
          key={`opencode-${terminalProjectScopeKey}-${wtId}`}
          worktreeId={wtId}
          variant="opencode"
          visible={wtId === worktree.id && activeTab === "opencode" && !isCreating}
          launchRequest={
            currentOpenCodeLaunchRequest &&
            launchOpenCodeRequestId === currentOpenCodeLaunchRequest.requestId &&
            currentOpenCodeLaunchRequest.worktreeId === wtId
              ? currentOpenCodeLaunchRequest
              : null
          }
          onLaunchRequestHandled={(requestId, outcome) => {
            handleLaunchRequestHandled("opencode", requestId, outcome);
          }}
          closeRequestId={closeOpenCodeRequestIdByWorktree[wtId] ?? null}
          onAgentExit={(exitCode) => handleOpenCodeExit(wtId, exitCode)}
        />
      ))}
      <DiffViewerTab worktree={worktree} visible={activeTab === "changes" && !isCreating} />
      <HooksTab
        worktreeId={worktree.id}
        visible={activeTab === "hooks" && !isCreating}
        hookUpdateKey={hookUpdateKey}
        hasLinkedIssue={!!(worktree.jiraUrl || worktree.linearUrl || worktree.localIssueId)}
        onNavigateToIssue={() => {
          if (worktree.localIssueId && onSelectLocalIssue) {
            onSelectLocalIssue(worktree.localIssueId);
          } else if (worktree.jiraUrl && onSelectJiraIssue) {
            const jiraKey = worktree.jiraUrl.match(/\/browse\/([A-Z]+-\d+)/)?.[1];
            if (jiraKey) onSelectJiraIssue(jiraKey);
          } else if (worktree.linearUrl && onSelectLinearIssue) {
            const linearId = worktree.linearUrl.match(/\/issue\/([A-Z]+-\d+)/)?.[1];
            if (linearId) onSelectLinearIssue(linearId);
          }
        }}
        onCreateTask={onCreateTask ? () => onCreateTask(worktree.id) : undefined}
        onNavigateToHooks={onNavigateToHooks}
      />

      {showRemoveModal && (
        <ConfirmDialog
          title="Delete worktree?"
          icon={<GitBranch className="w-4 h-4 text-accent" />}
          confirmLabel="Delete"
          loadingConfirmLabel="Deleting..."
          isLoading={isDeletingWorktree}
          showCancelButton={!isDeletingWorktree}
          showCloseButton={!isDeletingWorktree}
          closeOnBackdrop={!isDeletingWorktree}
          onConfirm={handleConfirmRemove}
          onCancel={() => {
            if (isDeletingWorktree) return;
            setShowRemoveModal(false);
          }}
        >
          <p className={`text-xs ${text.secondary}`}>
            Delete "{worktree.id}"? This will delete the worktree directory.
          </p>
        </ConfirmDialog>
      )}

      {agentRestoreModal && (
        <Modal
          title={`Choose ${agentRestoreModal.agent === "claude" ? "Claude" : "Codex"} Conversation`}
          icon={<MessageCircle className="w-4 h-4 text-[#9ca3af]" />}
          width="lg"
          onClose={() => setAgentRestoreModal(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setAgentRestoreModal(null)}
                className={`px-3 py-1.5 text-xs rounded-lg ${action.cancel.text} ${action.cancel.textHover} transition-colors`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleStartNewConversation(agentRestoreModal.agent)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${button.secondary} transition-colors`}
              >
                Start New Conversation
              </button>
              <button
                type="button"
                onClick={handleRestoreSelectedConversation}
                disabled={!agentRestoreModal.selectedSessionId}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${button.primary} disabled:opacity-50 transition-colors`}
              >
                Restore Conversation
              </button>
            </>
          }
        >
          <p className={`text-xs ${text.secondary} leading-relaxed`}>
            Multiple saved conversations match this worktree. Choose which one to resume.
            {activeProject?.name && (
              <span className={`ml-1 ${text.muted}`}>Project: {activeProject.name}</span>
            )}
          </p>
          <div className="mt-4 space-y-3 max-h-[320px] overflow-y-auto">
            {agentRestoreModal.matches.map((match) => {
              const selected = agentRestoreModal.selectedSessionId === match.sessionId;
              const timeAgo = formatRelativeTime(new Date(match.updatedAt));
              return (
                <button
                  key={match.sessionId}
                  type="button"
                  onClick={() =>
                    setAgentRestoreModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            selectedSessionId: match.sessionId,
                          }
                        : prev,
                    )
                  }
                  className={`w-full text-left flex items-start gap-3 px-3 py-3 rounded-lg border transition-colors ${
                    selected
                      ? "bg-white/[0.04] border-white/[0.15]"
                      : "bg-transparent border-white/[0.06] hover:border-white/[0.10] hover:bg-white/[0.02]"
                  }`}
                >
                  <MessageCircle
                    className={`w-4 h-4 flex-shrink-0 mt-0.5 ${selected ? text.primary : text.muted}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-xs font-medium truncate ${selected ? text.primary : text.secondary}`}
                    >
                      {match.title}
                    </div>
                    {match.gitBranch && (
                      <div className={`mt-0.5 text-[10px] ${text.muted}`}>
                        Branch: {match.gitBranch}
                      </div>
                    )}
                    {match.preview && match.preview.length > match.title.length && (
                      <div
                        className={`text-[11px] ${text.dimmed} mt-0.5 leading-relaxed`}
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {match.preview}
                      </div>
                    )}
                    <div className={`text-[10px] ${text.dimmed} mt-1 font-mono`}>
                      {timeAgo}
                      <span className="mx-1.5">·</span>
                      {match.sessionId.slice(0, 8)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}
