import { Link, ListTodo, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { OpenProjectTarget, OpenProjectTargetOption } from "../../hooks/api";
import type { WorktreeInfo } from "../../types";
import { useApi } from "../../hooks/useApi";
import { action, border, detailTab, errorBanner, input, text } from "../../theme";
import { ConfirmDialog } from "../ConfirmDialog";
import { GitHubIcon } from "../../icons";
import { Modal } from "../Modal";
import { DetailHeader } from "./DetailHeader";
import { LogsViewer } from "./LogsViewer";
import { TerminalView } from "./TerminalView";
import { HooksTab } from "./HooksTab";

type WorktreeTab = "logs" | "terminal" | "claude" | "codex" | "gemini" | "opencode" | "hooks";

// Persists across unmount/remount (view switches)
const tabCache: Record<string, WorktreeTab> = {};
const openClaudeTabCache = new Set<string>();
const openCodexTabCache = new Set<string>();
const openGeminiTabCache = new Set<string>();
const openOpenCodeTabCache = new Set<string>();
const claudeTabLabelCache: Record<string, string> = {};
const codexTabLabelCache: Record<string, string> = {};
const geminiTabLabelCache: Record<string, string> = {};
const opencodeTabLabelCache: Record<string, string> = {};
let lastProcessedNotificationTabRequestId: number | null = null;
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
  mode: "resume" | "start";
  prompt?: string;
  tabLabel?: string;
  skipPermissions?: boolean;
  requestId: number;
}

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
  hookUpdateKey?: number;
  claudeLaunchRequest?: AgentLaunchRequest | null;
  codexLaunchRequest?: AgentLaunchRequest | null;
  geminiLaunchRequest?: AgentLaunchRequest | null;
  opencodeLaunchRequest?: AgentLaunchRequest | null;
  notificationTabRequest?: NotificationTabRequest | null;
}

const AUTO_CLAUDE_DEBUG_PREFIX = "[AUTO-CLAUDE][TEMP]";

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
  hookUpdateKey,
  claudeLaunchRequest,
  codexLaunchRequest,
  geminiLaunchRequest,
  opencodeLaunchRequest,
  notificationTabRequest,
}: DetailPanelProps) {
  const api = useApi();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [showCreatePrInput, setShowCreatePrInput] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [isGitLoading, setIsGitLoading] = useState(false);
  const [gitAction, setGitAction] = useState<"commit" | "push" | "pr" | null>(null);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [openTargetOptions, setOpenTargetOptions] = useState<OpenProjectTargetOption[]>([]);
  const [selectedOpenTarget, setSelectedOpenTarget] = useState<OpenProjectTarget | null>(null);
  const [tabPerWorktree, setTabPerWorktree] = useState<Record<string, WorktreeTab>>(() => ({
    ...tabCache,
  }));
  const [openTerminals, setOpenTerminals] = useState<Set<string>>(new Set());
  const [openClaudeTabs, setOpenClaudeTabs] = useState<Set<string>>(
    () => new Set(openClaudeTabCache),
  );
  const [openCodexTabs, setOpenCodexTabs] = useState<Set<string>>(() => new Set(openCodexTabCache));
  const [openGeminiTabs, setOpenGeminiTabs] = useState<Set<string>>(
    () => new Set(openGeminiTabCache),
  );
  const [openOpenCodeTabs, setOpenOpenCodeTabs] = useState<Set<string>>(
    () => new Set(openOpenCodeTabCache),
  );
  const [claudeTabLabelsByWorktree, setClaudeTabLabelsByWorktree] = useState<
    Record<string, string>
  >(() => ({ ...claudeTabLabelCache }));
  const [codexTabLabelsByWorktree, setCodexTabLabelsByWorktree] = useState<Record<string, string>>(
    () => ({ ...codexTabLabelCache }),
  );
  const [geminiTabLabelsByWorktree, setGeminiTabLabelsByWorktree] = useState<
    Record<string, string>
  >(() => ({ ...geminiTabLabelCache }));
  const [opencodeTabLabelsByWorktree, setOpenCodeTabLabelsByWorktree] = useState<
    Record<string, string>
  >(() => ({ ...opencodeTabLabelCache }));
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
    lastProcessedNotificationTabRequestId,
  );
  const localClaudeRequestIdRef = useRef(1_000_000);
  const localCodexRequestIdRef = useRef(2_000_000);
  const localGeminiRequestIdRef = useRef(3_000_000);
  const localOpenCodeRequestIdRef = useRef(4_000_000);
  const closeClaudeRequestIdRef = useRef(0);
  const closeCodexRequestIdRef = useRef(0);
  const closeGeminiRequestIdRef = useRef(0);
  const closeOpenCodeRequestIdRef = useRef(0);
  const logAutoClaude = useCallback((message: string, extra?: Record<string, unknown>) => {
    if (extra) {
      console.info(`${AUTO_CLAUDE_DEBUG_PREFIX} ${message}`, extra);
      return;
    }
    console.info(`${AUTO_CLAUDE_DEBUG_PREFIX} ${message}`);
  }, []);

  const activeTab = worktree ? (tabPerWorktree[worktree.id] ?? "logs") : "logs";

  const setTabForWorktree = useCallback((worktreeId: string, tab: WorktreeTab) => {
    tabCache[worktreeId] = tab;
    setTabPerWorktree((prev) => ({ ...prev, [worktreeId]: tab }));
  }, []);

  const setActiveTab = useCallback(
    (tab: WorktreeTab) => {
      if (!worktree) return;
      setTabForWorktree(worktree.id, tab);
    },
    [setTabForWorktree, worktree],
  );

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
      openClaudeTabCache.add(worktreeId);
      const label = "Claude";
      logAutoClaude("Ensuring Claude tab is mounted", { worktreeId, label });
      claudeTabLabelCache[worktreeId] = label;
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
    [logAutoClaude],
  );

  const ensureCodexTabMounted = useCallback(
    (worktreeId: string) => {
      openCodexTabCache.add(worktreeId);
      const label = "Codex";
      logAutoClaude("Ensuring Codex tab is mounted", { worktreeId, label });
      codexTabLabelCache[worktreeId] = label;
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
    [logAutoClaude],
  );

  const ensureGeminiTabMounted = useCallback(
    (worktreeId: string) => {
      openGeminiTabCache.add(worktreeId);
      const label = "Gemini";
      logAutoClaude("Ensuring Gemini tab is mounted", { worktreeId, label });
      geminiTabLabelCache[worktreeId] = label;
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
    [logAutoClaude],
  );

  const ensureOpenCodeTabMounted = useCallback(
    (worktreeId: string) => {
      openOpenCodeTabCache.add(worktreeId);
      const label = "OpenCode";
      logAutoClaude("Ensuring OpenCode tab is mounted", { worktreeId, label });
      opencodeTabLabelCache[worktreeId] = label;
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
    [logAutoClaude],
  );

  const closeClaudeTab = useCallback((worktreeId: string) => {
    openClaudeTabCache.delete(worktreeId);
    delete claudeTabLabelCache[worktreeId];
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
      tabCache[worktreeId] = "logs";
      return { ...prev, [worktreeId]: "logs" };
    });
  }, []);

  const closeCodexTab = useCallback((worktreeId: string) => {
    openCodexTabCache.delete(worktreeId);
    delete codexTabLabelCache[worktreeId];
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
      tabCache[worktreeId] = "logs";
      return { ...prev, [worktreeId]: "logs" };
    });
  }, []);

  const closeGeminiTab = useCallback((worktreeId: string) => {
    openGeminiTabCache.delete(worktreeId);
    delete geminiTabLabelCache[worktreeId];
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
      tabCache[worktreeId] = "logs";
      return { ...prev, [worktreeId]: "logs" };
    });
  }, []);

  const closeOpenCodeTab = useCallback((worktreeId: string) => {
    openOpenCodeTabCache.delete(worktreeId);
    delete opencodeTabLabelCache[worktreeId];
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
      tabCache[worktreeId] = "logs";
      return { ...prev, [worktreeId]: "logs" };
    });
  }, []);

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
      const claudeTabAlreadyOpen = openClaudeTabCache.has(request.worktreeId);
      setTabForWorktree(request.worktreeId, "claude");
      ensureClaudeTabMounted(request.worktreeId);
      setLaunchClaudeRequestId(claudeTabAlreadyOpen ? null : request.requestId);
    },
    [ensureClaudeTabMounted, logAutoClaude, setTabForWorktree],
  );

  const openCodexWithRequest = useCallback(
    (request: AgentLaunchRequest) => {
      logAutoClaude("Opening Codex tab with launch request", {
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
      const codexTabAlreadyOpen = openCodexTabCache.has(request.worktreeId);
      setTabForWorktree(request.worktreeId, "codex");
      ensureCodexTabMounted(request.worktreeId);
      setLaunchCodexRequestId(codexTabAlreadyOpen ? null : request.requestId);
    },
    [ensureCodexTabMounted, logAutoClaude, setTabForWorktree],
  );

  const openGeminiWithRequest = useCallback(
    (request: AgentLaunchRequest) => {
      logAutoClaude("Opening Gemini tab with launch request", {
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
      const geminiTabAlreadyOpen = openGeminiTabCache.has(request.worktreeId);
      setTabForWorktree(request.worktreeId, "gemini");
      ensureGeminiTabMounted(request.worktreeId);
      setLaunchGeminiRequestId(geminiTabAlreadyOpen ? null : request.requestId);
    },
    [ensureGeminiTabMounted, logAutoClaude, setTabForWorktree],
  );

  const openOpenCodeWithRequest = useCallback(
    (request: AgentLaunchRequest) => {
      logAutoClaude("Opening OpenCode tab with launch request", {
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
      const openCodeTabAlreadyOpen = openOpenCodeTabCache.has(request.worktreeId);
      setTabForWorktree(request.worktreeId, "opencode");
      ensureOpenCodeTabMounted(request.worktreeId);
      setLaunchOpenCodeRequestId(openCodeTabAlreadyOpen ? null : request.requestId);
    },
    [ensureOpenCodeTabMounted, logAutoClaude, setTabForWorktree],
  );

  const handleOpenClaudeTab = useCallback(() => {
    if (!worktree) return;
    localClaudeRequestIdRef.current += 1;
    openClaudeWithRequest({
      worktreeId: worktree.id,
      mode: "resume",
      requestId: localClaudeRequestIdRef.current,
    });
  }, [openClaudeWithRequest, worktree]);

  const requestCloseClaudeTab = useCallback((worktreeId: string) => {
    closeClaudeRequestIdRef.current += 1;
    const requestId = closeClaudeRequestIdRef.current;
    setCloseClaudeRequestIdByWorktree((prev) => ({ ...prev, [worktreeId]: requestId }));
  }, []);

  const handleOpenCodexTab = useCallback(() => {
    if (!worktree) return;
    localCodexRequestIdRef.current += 1;
    openCodexWithRequest({
      worktreeId: worktree.id,
      mode: "resume",
      requestId: localCodexRequestIdRef.current,
    });
  }, [openCodexWithRequest, worktree]);

  const requestCloseCodexTab = useCallback((worktreeId: string) => {
    closeCodexRequestIdRef.current += 1;
    const requestId = closeCodexRequestIdRef.current;
    setCloseCodexRequestIdByWorktree((prev) => ({ ...prev, [worktreeId]: requestId }));
  }, []);

  const handleOpenGeminiTab = useCallback(() => {
    if (!worktree) return;
    localGeminiRequestIdRef.current += 1;
    openGeminiWithRequest({
      worktreeId: worktree.id,
      mode: "resume",
      requestId: localGeminiRequestIdRef.current,
    });
  }, [openGeminiWithRequest, worktree]);

  const requestCloseGeminiTab = useCallback((worktreeId: string) => {
    closeGeminiRequestIdRef.current += 1;
    const requestId = closeGeminiRequestIdRef.current;
    setCloseGeminiRequestIdByWorktree((prev) => ({ ...prev, [worktreeId]: requestId }));
  }, []);

  const handleOpenOpenCodeTab = useCallback(() => {
    if (!worktree) return;
    localOpenCodeRequestIdRef.current += 1;
    openOpenCodeWithRequest({
      worktreeId: worktree.id,
      mode: "resume",
      requestId: localOpenCodeRequestIdRef.current,
    });
  }, [openOpenCodeWithRequest, worktree]);

  const requestCloseOpenCodeTab = useCallback((worktreeId: string) => {
    closeOpenCodeRequestIdRef.current += 1;
    const requestId = closeOpenCodeRequestIdRef.current;
    setCloseOpenCodeRequestIdByWorktree((prev) => ({ ...prev, [worktreeId]: requestId }));
  }, []);

  // Reset form state when worktree changes (but NOT tab or terminal state)
  useEffect(() => {
    setError(null);
    setShowCommitInput(false);
    setShowCreatePrInput(false);
    setCommitMessage("");
    setPrTitle("");
    setGitAction(null);
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
    lastProcessedNotificationTabRequestId = notificationTabRequest.requestId;
    if (notificationTabRequest.tab === "hooks") {
      setTabForWorktree(notificationTabRequest.worktreeId, "hooks");
    }
  }, [notificationTabRequest, setTabForWorktree]);

  // If terminal/agent tab is restored from cache on remount, ensure that view is mounted.
  useEffect(() => {
    if (!worktree) return;
    if (activeTab === "terminal") {
      ensureTerminalTabMounted(worktree.id);
      return;
    }
    if (activeTab === "claude") {
      if (openClaudeTabCache.has(worktree.id)) {
        ensureClaudeTabMounted(worktree.id);
        return;
      }
      setTabForWorktree(worktree.id, "logs");
      return;
    }
    if (activeTab === "codex") {
      if (openCodexTabCache.has(worktree.id)) {
        ensureCodexTabMounted(worktree.id);
        return;
      }
      setTabForWorktree(worktree.id, "logs");
      return;
    }
    if (activeTab === "gemini") {
      if (openGeminiTabCache.has(worktree.id)) {
        ensureGeminiTabMounted(worktree.id);
        return;
      }
      setTabForWorktree(worktree.id, "logs");
      return;
    }
    if (activeTab === "opencode") {
      if (openOpenCodeTabCache.has(worktree.id)) {
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
    setTabForWorktree,
    worktree,
  ]);

  if (!worktree) {
    return (
      <div className={`flex-1 flex items-center justify-center ${text.dimmed} text-sm`}>
        Select a worktree or create a new one
      </div>
    );
  }

  const isRunning = worktree.status === "running";
  const isCreating = worktree.status === "creating";

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

  const handleConfirmRemove = async () => {
    setShowRemoveModal(false);
    setError(null);
    const deletedId = worktree.id;

    // Clean up state for this worktree
    setOpenTerminals((prev) => {
      const next = new Set(prev);
      next.delete(deletedId);
      return next;
    });
    openClaudeTabCache.delete(deletedId);
    openCodexTabCache.delete(deletedId);
    openGeminiTabCache.delete(deletedId);
    openOpenCodeTabCache.delete(deletedId);
    delete claudeTabLabelCache[deletedId];
    delete codexTabLabelCache[deletedId];
    delete geminiTabLabelCache[deletedId];
    delete opencodeTabLabelCache[deletedId];
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
    delete tabCache[deletedId];
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

    // Switch away immediately so user isn't stuck on "deleting" screen
    onDeleted();

    // Delete in background - worktree will disappear from list via SSE update
    const result = await api.removeWorktree(deletedId);
    if (!result.success) {
      // Show error somewhere? For now just log it
      console.error("Failed to remove worktree:", result.error);
    }
    onUpdate();
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

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <DetailHeader
        worktree={worktree}
        isRunning={isRunning}
        isCreating={isCreating}
        isLoading={isLoading}
        onRename={handleRename}
        onStart={handleStart}
        onStop={handleStop}
        onRemove={handleRemove}
        openTargetOptions={openTargetOptions}
        selectedOpenTarget={selectedOpenTarget}
        onSelectOpenTarget={setSelectedOpenTarget}
        onOpenProjectIn={handleOpenProjectIn}
        onSelectJiraIssue={onSelectJiraIssue}
        onSelectLinearIssue={onSelectLinearIssue}
        onSelectLocalIssue={onSelectLocalIssue}
      />

      {error && (
        <div
          className={`flex-shrink-0 px-5 py-2 ${errorBanner.panelBg} border-b ${errorBanner.border} flex items-center justify-between`}
        >
          <p className={`${text.error} text-xs`}>{error}</p>
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
            {!openClaudeTabs.has(worktree.id) && (
              <button
                type="button"
                onClick={handleOpenClaudeTab}
                className="inline-flex items-center gap-1.5 pl-2 pr-3 py-1 text-xs font-medium rounded-md text-[#3f4651] hover:text-[#9ca3af] hover:bg-white/[0.06] transition-colors duration-150"
              >
                <Plus className="w-3 h-3" />
                Claude
              </button>
            )}
            {!openCodexTabs.has(worktree.id) && (
              <button
                type="button"
                onClick={handleOpenCodexTab}
                className="inline-flex items-center gap-1.5 pl-2 pr-3 py-1 text-xs font-medium rounded-md text-[#3f4651] hover:text-[#9ca3af] hover:bg-white/[0.06] transition-colors duration-150"
              >
                <Plus className="w-3 h-3" />
                Codex
              </button>
            )}
            {!openGeminiTabs.has(worktree.id) && (
              <button
                type="button"
                onClick={handleOpenGeminiTab}
                className="inline-flex items-center gap-1.5 pl-2 pr-3 py-1 text-xs font-medium rounded-md text-[#3f4651] hover:text-[#9ca3af] hover:bg-white/[0.06] transition-colors duration-150"
              >
                <Plus className="w-3 h-3" />
                Gemini
              </button>
            )}
            {!openOpenCodeTabs.has(worktree.id) && (
              <button
                type="button"
                onClick={handleOpenOpenCodeTab}
                className="inline-flex items-center gap-1.5 pl-2 pr-3 py-1 text-xs font-medium rounded-md text-[#3f4651] hover:text-[#9ca3af] hover:bg-white/[0.06] transition-colors duration-150"
              >
                <Plus className="w-3 h-3" />
                OpenCode
              </button>
            )}
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
                className={`h-7 px-2.5 text-[11px] font-medium ${action.commit.text} ${action.commit.hover} hover:text-white rounded-md disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
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
                className={`h-7 px-2.5 text-[11px] font-medium ${action.push.text} ${action.push.hover} hover:text-white rounded-md disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
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
                      : `${action.pr.text} ${action.pr.hover} hover:text-white`
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
                className={`group h-7 px-2.5 text-[11px] font-medium ${action.pr.text} ${action.pr.hover} hover:text-white rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
              >
                <GitHubIcon className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-white" />
                View PR
              </a>
            )}
            {!worktree.jiraUrl && !worktree.linearUrl && !worktree.localIssueId && (
              <>
                {onCreateTask && (
                  <button
                    type="button"
                    onClick={() => onCreateTask(worktree.id)}
                    className={`h-7 px-2.5 text-[11px] font-medium ${text.muted} hover:${text.secondary} hover:bg-white/[0.06] rounded-md transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
                  >
                    <ListTodo className="w-3.5 h-3.5" />
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
                {isGitLoading && gitAction === "commit" ? "Committing..." : "Commit"}
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
            className={`w-full px-3 py-2 ${input.bgDetail} border ${border.modal} rounded-lg ${input.text} text-xs placeholder-[#4b5563] focus:outline-none focus:${border.focusPrimary} focus-visible:ring-1 ${input.ring} transition-colors duration-150`}
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
            className={`w-full px-3 py-2 ${input.bgDetail} border ${border.modal} rounded-lg ${input.text} text-xs placeholder-[#4b5563] focus:outline-none focus:${border.focusPrimary} focus-visible:ring-1 ${input.ring} transition-colors duration-150`}
            autoFocus
          />
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
          key={wtId}
          worktreeId={wtId}
          visible={wtId === worktree.id && activeTab === "terminal" && !isCreating}
        />
      ))}
      {[...openClaudeTabs].map((wtId) => (
        <TerminalView
          key={`claude-${wtId}`}
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
          closeRequestId={closeClaudeRequestIdByWorktree[wtId] ?? null}
          onAgentExit={(exitCode) => handleClaudeExit(wtId, exitCode)}
        />
      ))}
      {[...openCodexTabs].map((wtId) => (
        <TerminalView
          key={`codex-${wtId}`}
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
          closeRequestId={closeCodexRequestIdByWorktree[wtId] ?? null}
          onAgentExit={(exitCode) => handleCodexExit(wtId, exitCode)}
        />
      ))}
      {[...openGeminiTabs].map((wtId) => (
        <TerminalView
          key={`gemini-${wtId}`}
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
          closeRequestId={closeGeminiRequestIdByWorktree[wtId] ?? null}
          onAgentExit={(exitCode) => handleGeminiExit(wtId, exitCode)}
        />
      ))}
      {[...openOpenCodeTabs].map((wtId) => (
        <TerminalView
          key={`opencode-${wtId}`}
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
          closeRequestId={closeOpenCodeRequestIdByWorktree[wtId] ?? null}
          onAgentExit={(exitCode) => handleOpenCodeExit(wtId, exitCode)}
        />
      ))}
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
          confirmLabel="Delete"
          onConfirm={handleConfirmRemove}
          onCancel={() => setShowRemoveModal(false)}
        >
          <p className={`text-xs ${text.secondary}`}>
            Delete "{worktree.id}"? This will delete the worktree directory.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
