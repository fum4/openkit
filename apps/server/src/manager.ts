import { execFile as execFileCb, execFileSync, spawn } from "child_process";
import { randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "fs";
import type { FSWatcher } from "fs";
import path from "path";
import { promisify } from "util";

const execFile = promisify(execFileCb);

import pc from "picocolors";
import { CONFIG_DIR_NAME } from "@openkit/shared/constants";
import { toErrorMessage } from "@openkit/shared/errors";
import { copyEnvFiles } from "@openkit/shared/env-files";
import { log } from "./logger";
import { generateBranchName } from "./branch-name";
import { getGitRoot, getWorktreeBranch, validateBranchName } from "@openkit/shared/git";
import { GitHubManager } from "@openkit/integrations/github/github-manager";
import { loadJiraCredentials, loadJiraProjectConfig } from "@openkit/integrations/jira/credentials";
import {
  downloadAttachments,
  fetchIssue,
  resolveTaskKey,
  saveTaskData,
} from "@openkit/integrations/jira/api";
import { getApiBase, getAuthHeaders } from "@openkit/integrations/jira/auth";
import type { JiraTaskData } from "@openkit/integrations/jira/types";
import {
  loadLinearCredentials,
  loadLinearProjectConfig,
} from "@openkit/integrations/linear/credentials";
import {
  fetchIssue as fetchLinearIssue,
  fetchIssues as fetchLinearIssues,
  resolveIdentifier as resolveLinearIdentifier,
  saveTaskData as saveLinearTaskData,
} from "@openkit/integrations/linear/api";
import type { LinearTaskData } from "@openkit/integrations/linear/types";

import { resolveNodePtyModule } from "./pty";
import { ActivityLog } from "./activity-log";
import { ACTIVITY_TYPES } from "./activity-event";
import { loadLocalConfig, loadLocalGitPolicyConfig, updateLocalConfig } from "./local-config";
import { NotesManager } from "./notes-manager";
import { OpsLog } from "./ops-log";
import { PortManager } from "@openkit/port-offset/port-manager";
import type {
  WorktreeLifecycleHookTrigger,
  RunningProcess,
  WorktreeConfig,
  WorktreeCreateRequest,
  WorktreeInfo,
  WorktreeRenameRequest,
} from "./types";

const portLog = log.get("port");
const worktreeLog = log.get("worktree");
const linearLog = log.get("linear");

export type FileChangeCategory =
  | "config"
  | "local-config"
  | "hooks"
  | "branch-rules"
  | "commit-rules"
  | "agent-rules";

const MAX_LOG_LINES = 100;

// Distinct color functions for worktree names (bright, easy to distinguish)
const WORKTREE_COLORS: Array<(s: string) => string> = [
  pc.cyan,
  pc.yellow,
  pc.magenta,
  pc.green,
  pc.blue,
  (s: string) => pc.red(pc.bold(s)), // bright red
  (s: string) => pc.cyan(pc.bold(s)), // bright cyan
  (s: string) => pc.yellow(pc.bold(s)), // bright yellow
  (s: string) => pc.magenta(pc.bold(s)), // bright magenta
  (s: string) => pc.green(pc.bold(s)), // bright green
];

let worktreeColorIndex = 0;
const worktreeColorMap = new Map<string, (s: string) => string>();

const OPEN_PROJECT_TARGETS = new Set<NonNullable<WorktreeConfig["openProjectTarget"]>>([
  "file-manager",
  "cursor",
  "vscode",
  "zed",
  "intellij",
  "webstorm",
  "terminal",
  "warp",
  "ghostty",
  "neovim",
]);

const AGENT_GIT_POLICY_KEYS = ["allowAgentCommits", "allowAgentPushes", "allowAgentPRs"] as const;
const LOCAL_CONFIG_KEYS = [
  ...AGENT_GIT_POLICY_KEYS,
  "useNativePortHook",
  "autoCleanupOnPrMerge",
  "autoCleanupOnPrClose",
] as const;

function isConfiguredOpenProjectTarget(
  value: unknown,
): value is NonNullable<WorktreeConfig["openProjectTarget"]> {
  return (
    typeof value === "string" &&
    OPEN_PROJECT_TARGETS.has(value as NonNullable<WorktreeConfig["openProjectTarget"]>)
  );
}

function normalizeEventTypeList(value: unknown): string[] {
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

function sanitizeActivityConfig(
  activity: WorktreeConfig["activity"] | undefined,
): WorktreeConfig["activity"] | undefined {
  if (!activity) return activity;

  const disabledEvents = normalizeEventTypeList(activity.disabledEvents);
  const disabledSet = new Set(disabledEvents);
  const toastEvents = normalizeEventTypeList(activity.toastEvents);
  const osNotificationEvents = normalizeEventTypeList(activity.osNotificationEvents).filter(
    (eventType) => !disabledSet.has(eventType),
  );

  return {
    ...activity,
    disabledEvents,
    toastEvents,
    osNotificationEvents,
  };
}

function getWorktreeColor(id: string): (s: string) => string {
  let color = worktreeColorMap.get(id);
  if (!color) {
    color = WORKTREE_COLORS[worktreeColorIndex % WORKTREE_COLORS.length];
    worktreeColorIndex++;
    worktreeColorMap.set(id, color);
  }
  return color;
}

type WorktreeResolutionCode = "WORKTREE_NOT_FOUND" | "WORKTREE_ID_AMBIGUOUS";

type WorktreeIdResolutionResult =
  | { success: true; worktreeId: string }
  | { success: false; code: WorktreeResolutionCode; error: string; matches?: string[] };

type RemoveWorktreeErrorCode =
  | WorktreeResolutionCode
  | "INVALID_WORKTREE_ID"
  | "WORKTREE_REMOVE_FAILED";

interface RemoveWorktreeOptions {
  deleteOpId?: string;
  destroyTerminalsForWorktree?: (worktreeId: string) => number;
}

interface RemoveWorktreeResult {
  success: boolean;
  error?: string;
  code?: RemoveWorktreeErrorCode;
  worktreeId?: string;
  removedTerminalSessions?: number;
  removedRunningProcess?: boolean;
  clearedLinks?: number;
  deleteOpId?: string;
}

export class WorktreeManager {
  private config: WorktreeConfig;

  private configDir: string;

  private configFilePath: string | null;

  private portManager: PortManager;

  private notesManager: NotesManager;

  private activityLog: ActivityLog;

  private opsLog: OpsLog;

  private runningProcesses: Map<string, RunningProcess> = new Map();

  private creatingWorktrees: Map<string, WorktreeInfo> = new Map();

  private githubManager: GitHubManager | null = null;

  private worktreeCallbacks: Map<
    string,
    {
      onSuccess?: (worktreeId: string) => void;
      onFailure?: (worktreeId: string, error: string) => void;
    }
  > = new Map();

  private eventListeners: Set<(worktrees: WorktreeInfo[]) => void> = new Set();

  private notificationListeners: Set<
    (notification: { message: string; level: "error" | "info" }) => void
  > = new Set();

  private hookUpdateListeners: Set<(worktreeId: string) => void> = new Set();

  private fileChangeListeners: Set<(category: FileChangeCategory) => void> = new Set();

  private fileWatchers: FSWatcher[] = [];

  /** Categories currently suppressed (set when we write files ourselves). */
  private suppressedFileChangeCategories: Set<FileChangeCategory> = new Set();

  /** Debounce timers for file-change notifications, cleared on shutdown. */
  private fileChangeDebounceTimers = new Map<FileChangeCategory, ReturnType<typeof setTimeout>>();

  private worktreeLifecycleHookRunner:
    | ((
        trigger: WorktreeLifecycleHookTrigger,
        worktreeId: string,
        worktreePath: string,
      ) => Promise<void>)
    | null = null;

  private startupCwd: string | null = null;

  private readAgentGitPolicyConfig(): {
    allowAgentCommits: boolean;
    allowAgentPushes: boolean;
    allowAgentPRs: boolean;
  } {
    return loadLocalGitPolicyConfig(this.configDir);
  }

  private withLocalConfig(config: WorktreeConfig): WorktreeConfig {
    const policy = this.readAgentGitPolicyConfig();
    const local = loadLocalConfig(this.configDir);
    return {
      ...config,
      allowAgentCommits: policy.allowAgentCommits,
      allowAgentPushes: policy.allowAgentPushes,
      allowAgentPRs: policy.allowAgentPRs,
      useNativePortHook: local.useNativePortHook === true,
      autoCleanupOnPrMerge: local.autoCleanupOnPrMerge ?? config.autoCleanupOnPrMerge,
      autoCleanupOnPrClose: local.autoCleanupOnPrClose ?? config.autoCleanupOnPrClose,
    };
  }

  constructor(config: WorktreeConfig, configFilePath: string | null = null) {
    this.configFilePath = configFilePath;
    this.configDir = configFilePath ? path.dirname(path.dirname(configFilePath)) : process.cwd();
    this.config = {
      ...config,
      activity: sanitizeActivityConfig(config.activity),
    };
    this.config = this.withLocalConfig(this.config);
    this.portManager = new PortManager(config, configFilePath);
    this.portManager.useNativeHook = this.config.useNativePortHook !== false;
    this.notesManager = new NotesManager(this.configDir);
    this.activityLog = new ActivityLog(this.configDir, this.config.activity);
    this.opsLog = new OpsLog(this.configDir, this.config.opsLog);
    this.portManager.setDebugLogger((event) => {
      const level = event.level ?? (event.status === "failed" ? "error" : "info");
      const status = event.status ?? "info";
      const context = {
        domain: "port",
        action: event.action,
        status,
        projectName: this.getProjectName() ?? undefined,
        ...event.metadata,
      };
      if (level === "error") {
        portLog.error(event.message, context);
      } else {
        portLog.info(event.message, context);
      }
    });

    const worktreesPath = this.getWorktreesAbsolutePath();
    if (!existsSync(worktreesPath)) {
      mkdirSync(worktreesPath, { recursive: true });
    }

    this.watchProjectFiles();
  }

  private watchProjectFiles(): void {
    const configDir = path.join(this.configDir, CONFIG_DIR_NAME);
    const debouncedEmit = (category: FileChangeCategory, action?: () => void) => {
      const existing = this.fileChangeDebounceTimers.get(category);
      if (existing) clearTimeout(existing);
      this.fileChangeDebounceTimers.set(
        category,
        setTimeout(() => {
          this.fileChangeDebounceTimers.delete(category);
          if (this.suppressedFileChangeCategories.delete(category)) return;
          log.info(`File changed externally: ${category}`, { domain: "file-watch" });
          action?.();
          this.emitFileChange(category);
        }, 200),
      );
    };

    const classifyOpenkitFile = (filename: string): FileChangeCategory | null => {
      if (filename === "config.json") return "config";
      if (filename === "config.local.json") return "local-config";
      if (filename === "hooks.json") return "hooks";
      if (filename.startsWith("branch-name")) return "branch-rules";
      if (filename.startsWith("commit-message")) return "commit-rules";
      return null;
    };

    // Watch .openkit/ directory recursively (Node 19+ on macOS supports recursive)
    if (existsSync(configDir)) {
      try {
        const watcher = watch(configDir, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          const basename = path.basename(filename);
          const category = classifyOpenkitFile(basename);
          if (!category) return;
          debouncedEmit(category, category === "config" ? () => this.reloadConfig() : undefined);
        });
        this.fileWatchers.push(watcher);
      } catch (error) {
        log.warn("Failed to watch .openkit directory", { domain: "file-watch", error });
      }
    }

    // Watch CLAUDE.md and AGENTS.md in project root
    for (const filename of ["CLAUDE.md", "AGENTS.md"]) {
      const filePath = path.join(this.configDir, filename);
      if (!existsSync(filePath)) continue;
      try {
        const watcher = watch(filePath, () => {
          debouncedEmit("agent-rules");
        });
        this.fileWatchers.push(watcher);
      } catch (error) {
        log.warn(`Failed to watch ${filename}`, { domain: "file-watch", error });
      }
    }
  }

  // Reload config from disk (after initialization via UI)
  reloadConfig(): void {
    // Determine the config file path
    const configPath =
      this.configFilePath ?? path.join(this.configDir, CONFIG_DIR_NAME, "config.json");

    if (!existsSync(configPath)) {
      return;
    }

    try {
      const content = readFileSync(configPath, "utf-8");
      const fileConfig = JSON.parse(content);

      // Update the config
      this.config = this.withLocalConfig({
        projectDir: fileConfig.projectDir ?? this.config.projectDir,
        startCommand: fileConfig.startCommand ?? this.config.startCommand,
        installCommand: fileConfig.installCommand ?? this.config.installCommand,
        baseBranch: fileConfig.baseBranch ?? this.config.baseBranch,
        ports: {
          discovered: fileConfig.ports?.discovered ?? this.config.ports.discovered,
          offsetStep: fileConfig.ports?.offsetStep ?? this.config.ports.offsetStep,
        },
        envMapping: fileConfig.envMapping ?? this.config.envMapping,
        framework: fileConfig.framework ?? this.config.framework,
        autoInstall: fileConfig.autoInstall,
        localIssuePrefix: fileConfig.localIssuePrefix,
        localAutoStartAgent:
          fileConfig.localAutoStartAgent ?? this.config.localAutoStartAgent ?? "claude",
        localAutoStartClaudeOnNewIssue:
          fileConfig.localAutoStartClaudeOnNewIssue ?? this.config.localAutoStartClaudeOnNewIssue,
        localAutoStartClaudeSkipPermissions:
          fileConfig.localAutoStartClaudeSkipPermissions ??
          this.config.localAutoStartClaudeSkipPermissions,
        localAutoStartClaudeFocusTerminal:
          fileConfig.localAutoStartClaudeFocusTerminal ??
          this.config.localAutoStartClaudeFocusTerminal,
        openProjectTarget: isConfiguredOpenProjectTarget(fileConfig.openProjectTarget)
          ? fileConfig.openProjectTarget
          : this.config.openProjectTarget,
        showDiffStats: fileConfig.showDiffStats ?? this.config.showDiffStats,
        autoCleanupOnPrMerge: fileConfig.autoCleanupOnPrMerge ?? this.config.autoCleanupOnPrMerge,
        autoCleanupOnPrClose: fileConfig.autoCleanupOnPrClose ?? this.config.autoCleanupOnPrClose,
        activity: sanitizeActivityConfig(fileConfig.activity ?? this.config.activity),
      });

      // Update the config file path for future reloads
      this.configFilePath = configPath;

      // Recreate port manager with new config
      this.portManager = new PortManager(this.config, configPath);
      this.activityLog.updateConfig(this.config.activity ?? {});

      // Ensure worktrees directory exists
      const worktreesPath = this.getWorktreesAbsolutePath();
      if (!existsSync(worktreesPath)) {
        mkdirSync(worktreesPath, { recursive: true });
      }
    } catch (error) {
      log.error("Failed to reload config", { domain: "config", error });
    }
  }

  private getWorktreesAbsolutePath(): string {
    return path.join(this.configDir, CONFIG_DIR_NAME, "worktrees");
  }

  getPortManager(): PortManager {
    return this.portManager;
  }

  getGitHubManager(): GitHubManager | null {
    return this.githubManager;
  }

  async initGitHub(): Promise<void> {
    this.githubManager = new GitHubManager();
    try {
      await this.githubManager.initialize(this.getGitRoot());
      this.githubManager.startPolling(
        () => this.getWorktrees(),
        () => this.notifyListeners(),
      );
      const status = this.githubManager.getStatus();
      if (status.repo) {
        log.info(`Connected to ${status.repo}`, { domain: "GitHub" });
      } else if (!status.installed) {
        log.warn("gh CLI not found, GitHub features disabled", { domain: "GitHub" });
      } else if (!status.authenticated) {
        log.warn('Not authenticated, run "gh auth login"', { domain: "GitHub" });
      }
    } catch {
      log.warn("Initialization failed, features disabled", { domain: "GitHub" });
      this.githubManager = null;
    }
  }

  subscribe(listener: (worktrees: WorktreeInfo[]) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  subscribeNotifications(
    listener: (notification: { message: string; level: "error" | "info" }) => void,
  ): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  private emitNotification(message: string, level: "error" | "info" = "error"): void {
    const notificationLog = log.get("notification");
    const context = {
      domain: "notification",
      action: "notification.emit",
      projectName: this.getProjectName() ?? undefined,
    };
    if (level === "error") {
      notificationLog.error(message, context);
    } else {
      notificationLog.info(message, context);
    }
    this.notificationListeners.forEach((listener) => listener({ message, level }));
  }

  subscribeHookUpdates(listener: (worktreeId: string) => void): () => void {
    this.hookUpdateListeners.add(listener);
    return () => this.hookUpdateListeners.delete(listener);
  }

  emitHookUpdate(worktreeId: string): void {
    this.hookUpdateListeners.forEach((listener) => listener(worktreeId));
  }

  subscribeFileChange(listener: (category: FileChangeCategory) => void): () => void {
    this.fileChangeListeners.add(listener);
    return () => this.fileChangeListeners.delete(listener);
  }

  private emitFileChange(category: FileChangeCategory): void {
    this.fileChangeListeners.forEach((listener) => listener(category));
  }

  setWorktreeLifecycleHookRunner(
    runner: (
      trigger: WorktreeLifecycleHookTrigger,
      worktreeId: string,
      worktreePath: string,
    ) => Promise<void>,
  ): void {
    this.worktreeLifecycleHookRunner = runner;
  }

  private notifyListeners(): void {
    const worktrees = this.getWorktrees();
    this.eventListeners.forEach((listener) => listener(worktrees));
  }

  getGitRoot(): string {
    return getGitRoot(this.getWorktreesAbsolutePath());
  }

  getNotesManager(): NotesManager {
    return this.notesManager;
  }

  getActivityLog(): ActivityLog {
    return this.activityLog;
  }

  getOpsLog(): OpsLog {
    return this.opsLog;
  }

  private listWorktreeDirectoryIds(): string[] {
    const worktreesPath = this.getWorktreesAbsolutePath();
    if (!existsSync(worktreesPath)) return [];

    return readdirSync(worktreesPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  private resolveIdFromCandidates(
    requestedId: string,
    candidateIds: Iterable<string>,
  ):
    | { kind: "resolved"; id: string }
    | { kind: "not-found" }
    | { kind: "ambiguous"; ids: string[] } {
    const uniqueIds = [...new Set([...candidateIds].filter(Boolean))];
    if (uniqueIds.length === 0) return { kind: "not-found" };

    const exact = uniqueIds.find((id) => id === requestedId);
    if (exact) return { kind: "resolved", id: exact };

    const requestedLower = requestedId.toLowerCase();
    const caseInsensitiveMatches = uniqueIds.filter((id) => id.toLowerCase() === requestedLower);
    if (caseInsensitiveMatches.length === 1) {
      return { kind: "resolved", id: caseInsensitiveMatches[0] };
    }
    if (caseInsensitiveMatches.length > 1) {
      return { kind: "ambiguous", ids: caseInsensitiveMatches.sort((a, b) => a.localeCompare(b)) };
    }
    return { kind: "not-found" };
  }

  private getWorktreeResolutionCandidates(): string[] {
    const candidates = new Set<string>();
    for (const id of this.listWorktreeDirectoryIds()) candidates.add(id);
    for (const id of this.runningProcesses.keys()) candidates.add(id);
    for (const id of this.creatingWorktrees.keys()) candidates.add(id);
    for (const worktree of this.getWorktrees()) candidates.add(worktree.id);
    return [...candidates];
  }

  resolveWorktreeId(requestedId: string): WorktreeIdResolutionResult {
    const resolved = this.resolveIdFromCandidates(
      requestedId,
      this.getWorktreeResolutionCandidates(),
    );
    if (resolved.kind === "resolved") {
      return { success: true, worktreeId: resolved.id };
    }
    if (resolved.kind === "ambiguous") {
      return {
        success: false,
        code: "WORKTREE_ID_AMBIGUOUS",
        error: `Worktree "${requestedId}" is ambiguous. Matches: ${resolved.ids.join(", ")}`,
        matches: resolved.ids,
      };
    }
    return {
      success: false,
      code: "WORKTREE_NOT_FOUND",
      error: `Worktree "${requestedId}" not found`,
    };
  }

  resolveWorktree(
    requestedId: string,
  ):
    | { success: true; worktreeId: string; worktree: WorktreeInfo }
    | { success: false; code: WorktreeResolutionCode; error: string; matches?: string[] } {
    const idResolution = this.resolveWorktreeId(requestedId);
    if (!idResolution.success) return idResolution;

    const worktree = this.getWorktrees().find((item) => item.id === idResolution.worktreeId);
    if (!worktree) {
      return {
        success: false,
        code: "WORKTREE_NOT_FOUND",
        error: `Worktree "${requestedId}" not found`,
      };
    }
    return { success: true, worktreeId: idResolution.worktreeId, worktree };
  }

  private async listGitManagedWorktreeIds(): Promise<string[]> {
    const gitRoot = this.getGitRoot();
    const worktreesPath = path.resolve(this.getWorktreesAbsolutePath());
    const worktreesPathLower = worktreesPath.toLowerCase();
    const ids = new Set<string>();

    try {
      const { stdout } = await execFile("git", ["worktree", "list", "--porcelain"], {
        cwd: gitRoot,
        encoding: "utf-8",
      });

      for (const line of stdout.split("\n")) {
        if (!line.startsWith("worktree ")) continue;
        const listedPath = path.resolve(line.slice("worktree ".length).trim());
        const parentDir = path.dirname(listedPath);
        const matchesManagedRoot =
          parentDir === worktreesPath || parentDir.toLowerCase() === worktreesPathLower;
        if (!matchesManagedRoot) continue;
        const id = path.basename(listedPath);
        if (id) ids.add(id);
      }
    } catch {
      // Ignore parse/list errors and rely on filesystem/running maps.
    }

    return [...ids];
  }

  private clearTransientWorktreeState(worktreeId: string): void {
    this.creatingWorktrees.delete(worktreeId);
    this.worktreeCallbacks.delete(worktreeId);
  }

  private pruneGitWorktreeMetadata(gitRoot: string): void {
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      // Ignore prune failures.
    }
  }

  getWorktrees(): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const worktreesPath = this.getWorktreesAbsolutePath();

    if (!existsSync(worktreesPath)) {
      return worktrees;
    }

    // Build a map of worktreeId → issue info from notes.json files
    const linkMap = this.notesManager.buildWorktreeLinkMap();

    const entries = readdirSync(worktreesPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const worktreePath = path.join(worktreesPath, entry.name);
      const gitPath = path.join(worktreePath, ".git");

      if (!existsSync(gitPath)) continue;

      // Skip entries that are still being created (they appear via creatingWorktrees)
      if (this.creatingWorktrees.has(entry.name)) continue;

      const branch = getWorktreeBranch(worktreePath);
      const runningInfo = this.runningProcesses.get(entry.name);

      const info: WorktreeInfo = {
        id: entry.name,
        path: worktreePath,
        branch: branch || "unknown",
        status: runningInfo ? "running" : "stopped",
        ports: runningInfo?.ports ?? [],
        offset: runningInfo?.offset ?? null,
        pid: runningInfo?.pid ?? null,
        lastActivity: runningInfo?.lastActivity,
        logs: runningInfo?.logs ?? [],
        // Default to unpushed - will be overwritten if we have git status
        hasUnpushed: true,
      };

      // Check for linked issue via notes.json
      const linked = linkMap.get(entry.name);
      if (linked) {
        const issueDir = this.notesManager.getIssueDir(linked.source, linked.issueId);
        if (linked.source === "local") {
          // Read the local issue.json for identifier and status (fall back to task.json for migration)
          const issueFile = path.join(issueDir, "issue.json");
          const legacyFile = path.join(issueDir, "task.json");
          const taskFile = existsSync(issueFile) ? issueFile : legacyFile;
          if (existsSync(taskFile)) {
            try {
              const taskData = JSON.parse(readFileSync(taskFile, "utf-8"));
              if (taskData.id) info.localIssueId = taskData.id;
              if (taskData.status) info.localIssueStatus = taskData.status;
            } catch {
              /* ignore */
            }
          }
        } else if (linked.source === "linear") {
          const issueFile = path.join(issueDir, "issue.json");
          if (existsSync(issueFile)) {
            try {
              const issueData = JSON.parse(readFileSync(issueFile, "utf-8"));
              if (issueData.url) info.linearUrl = issueData.url;
              if (issueData.status) info.linearStatus = issueData.status;
            } catch {
              /* ignore */
            }
          }
        } else if (linked.source === "jira") {
          const issueFile = path.join(issueDir, "issue.json");
          if (existsSync(issueFile)) {
            try {
              const issueData = JSON.parse(readFileSync(issueFile, "utf-8"));
              if (issueData.url) info.jiraUrl = issueData.url;
              if (issueData.status) info.jiraStatus = issueData.status;
            } catch {
              /* ignore */
            }
          }
        }
      }

      // Populate GitHub info from cache
      if (this.githubManager) {
        const pr = this.githubManager.getCachedPR(entry.name);
        if (pr) {
          info.githubPrUrl = pr.url;
          info.githubPrState = pr.isDraft ? "draft" : pr.state;
        }
        const git = this.githubManager.getCachedGitStatus(entry.name);
        if (git) {
          info.hasUncommitted = git.hasUncommitted;
          info.hasUnpushed = git.ahead > 0 || git.noUpstream;
          info.commitsAhead = git.noUpstream ? 0 : git.ahead;
          // -1 means we couldn't determine, treat as having commits (safer)
          info.commitsAheadOfBase = git.aheadOfBase === -1 ? undefined : git.aheadOfBase;
          info.linesAdded = git.linesAdded;
          info.linesRemoved = git.linesRemoved;
        }
      }

      worktrees.push(info);
    }

    // Append in-progress creations
    for (const creating of this.creatingWorktrees.values()) {
      worktrees.push(creating);
    }

    return worktrees;
  }

  private copyWorktreeEnvFiles(worktreePath: string): void {
    copyEnvFiles(this.configDir, worktreePath, this.getWorktreesAbsolutePath());
  }

  async startWorktree(id: string): Promise<{
    success: boolean;
    ports?: number[];
    pid?: number;
    error?: string;
  }> {
    const resolved = this.resolveWorktreeId(id);
    if (!resolved.success) {
      return { success: false, error: resolved.error };
    }
    const worktreeId = resolved.worktreeId;

    if (this.runningProcesses.has(worktreeId)) {
      const info = this.runningProcesses.get(worktreeId)!;
      return { success: true, ports: info.ports, pid: info.pid };
    }

    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, worktreeId);
    if (!existsSync(worktreePath)) {
      return { success: false, error: `Worktree "${worktreeId}" not found` };
    }

    const workingDir =
      this.config.projectDir && this.config.projectDir !== "."
        ? path.join(worktreePath, this.config.projectDir)
        : worktreePath;

    if (!existsSync(workingDir)) {
      return {
        success: false,
        error: `Project directory "${this.config.projectDir}" not found in worktree`,
      };
    }

    try {
      // Allocate a port offset and build the full spawn environment
      const offset = this.portManager.allocateOffset();
      const offsetEnv = this.portManager.buildOffsetEnvironment(offset, this.config.startCommand);
      const ports = offsetEnv.ports;

      const [cmd, ...baseArgs] = this.config.startCommand.split(" ");
      const args = [...baseArgs, ...offsetEnv.extraArgs];

      const portsDisplay = ports.length > 0 ? ports.join(", ") : `offset=${offset}`;
      log.info(`Starting ${worktreeId} at ${workingDir} (ports: ${portsDisplay})`);

      const wtColor = getWorktreeColor(worktreeId);
      const coloredName = pc.bold(wtColor(worktreeId));
      const linePrefix = `${pc.dim("[")}${coloredName}${pc.dim("]")}`;
      const logs: string[] = [];

      const scheduleLogNotify = () => {
        const info = this.runningProcesses.get(worktreeId);
        if (info) {
          if (info.logNotifyTimer) clearTimeout(info.logNotifyTimer);
          info.logNotifyTimer = setTimeout(() => {
            info.logNotifyTimer = undefined;
            this.notifyListeners();
          }, 250);
        }
      };

      const pushLogLines = (data: string) => {
        const lines = data.split("\n").filter((l: string) => l.trim());
        lines.forEach((line: string) => process.stdout.write(`${linePrefix} ${line}\n`));
        const processInfo = this.runningProcesses.get(worktreeId);
        if (processInfo) {
          processInfo.logs.push(...lines);
          if (processInfo.logs.length > MAX_LOG_LINES) {
            processInfo.logs.splice(0, processInfo.logs.length - MAX_LOG_LINES);
          }
        }
        scheduleLogNotify();
      };

      const handleExit = (code: number | null) => {
        log.info(`Worktree "${worktreeId}" exited with code ${code}`);
        const processInfo = this.runningProcesses.get(worktreeId);
        if (processInfo) {
          this.portManager.releaseOffset(processInfo.offset);
        }
        this.runningProcesses.delete(worktreeId);
        this.notifyListeners();

        // Emit crashed event if exit was unexpected (non-zero and not user-initiated stop)
        if (code !== null && code !== 0) {
          this.activityLog.addEvent({
            category: "worktree",
            type: "crashed",
            severity: "error",
            title: `Worktree "${worktreeId}" crashed (exit code ${code})`,
            worktreeId,
            projectName: this.activityProjectName(),
            metadata: { exitCode: code },
          });
        }
      };

      const spawnEnv = { ...process.env, ...offsetEnv.env, FORCE_COLOR: "1" };
      let pid: number;
      let killFn: (signal?: string) => void;

      if (offsetEnv.needsPty) {
        // Adapter-driven PTY spawn (e.g. RN/Expo needs a real TTY for Metro QR code).
        // Pass cmd + args directly to node-pty (no shell -lc wrapping) to avoid
        // shell metacharacter interpretation in startCommand.
        const pty = resolveNodePtyModule();

        // spawnOnlyEnv contains adapter-scoped env vars (e.g. CI=0, EXPO_OFFLINE=0
        // for Expo) that should not leak into other tools in the process tree.
        const ptyEnv: Record<string, string> = {
          ...spawnEnv,
          ...offsetEnv.spawnOnlyEnv,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        };

        const ptyProcess = pty.spawn(cmd, args, {
          name: "xterm-256color",
          cols: 120,
          rows: 40,
          cwd: workingDir,
          env: ptyEnv,
        });

        pid = ptyProcess.pid;
        // node-pty's kill() sends SIGTERM by default; avoid passing string signals
        // as some platforms expect numeric values
        killFn = () => ptyProcess.kill();
        ptyProcess.onData((data) => pushLogLines(data));
        ptyProcess.onExit(({ exitCode }) => handleExit(exitCode));
      } else {
        // Generic: spawn with piped stdio.
        // shell: true is required because startCommand is a user-configured string
        // that may contain shell constructs (env prefixes, pipes, &&).
        // startCommand comes from the project's .openkit/config.json — same trust model
        // as npm scripts in package.json (user-controlled, not external input).
        const childProcess = spawn(cmd, args, {
          cwd: workingDir,
          env: spawnEnv,
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
          detached: false,
        });

        pid = childProcess.pid!;
        killFn = (signal) => childProcess.kill(signal as NodeJS.Signals);
        childProcess.on("exit", (code) => handleExit(code));
        childProcess.stdout?.on("data", (data) => pushLogLines(data.toString()));
        childProcess.stderr?.on("data", (data) => pushLogLines(data.toString()));
      }

      this.runningProcesses.set(worktreeId, {
        pid,
        ports,
        offset,
        kill: killFn,
        lastActivity: Date.now(),
        logs,
      });

      this.notifyListeners();
      this.activityLog.addEvent({
        category: "worktree",
        type: "started",
        severity: "info",
        title: `Worktree "${worktreeId}" started`,
        worktreeId,
        projectName: this.activityProjectName(),
        metadata: { ports, pid },
      });

      // Best-effort: set up adb reverse (adapter-driven, e.g. RN/Expo)
      if (offsetEnv.needsAdbReverse) {
        this.runAdbReverse(ports);
      }

      return { success: true, ports, pid };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start process";
      log.error(`Failed to start worktree "${worktreeId}": ${message}`, {
        domain: "worktree",
      });
      return {
        success: false,
        error: message,
      };
    }
  }

  async stopWorktree(id: string): Promise<{ success: boolean; error?: string }> {
    const resolved = this.resolveWorktreeId(id);
    const worktreeId = resolved.success ? resolved.worktreeId : id;

    const processInfo = this.runningProcesses.get(worktreeId);
    if (!processInfo) {
      return { success: true };
    }

    this.portManager.releaseOffset(processInfo.offset);

    // Kill the process tree: try process group first, then walk the tree with pgrep,
    // and finally fall back to direct kill. PTY processes (node-pty) may not be process
    // group leaders, so the group kill can fail — the tree walk ensures child processes
    // (e.g. Metro's bundler workers) are also terminated.
    try {
      process.kill(-processInfo.pid, "SIGTERM");
    } catch {
      // Process group kill failed — walk the process tree and kill children individually
      const childPids = this.getChildPids(processInfo.pid);
      for (const childPid of childPids) {
        try {
          process.kill(childPid, "SIGTERM");
        } catch {
          // Child may have already exited
        }
      }
      try {
        processInfo.kill();
      } catch (innerErr) {
        log.debug(
          `Direct kill failed for ${worktreeId} (pid ${processInfo.pid}), process may have already exited: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`,
          { domain: "worktree" },
        );
      }
    }

    this.runningProcesses.delete(worktreeId);
    this.notifyListeners();
    this.activityLog.addEvent({
      category: "worktree",
      type: "stopped",
      severity: "info",
      title: `Worktree "${worktreeId}" stopped`,
      worktreeId,
      projectName: this.activityProjectName(),
    });

    return { success: true };
  }

  private getChildPids(parentPid: number): number[] {
    try {
      const output = execFileSync("pgrep", ["-P", String(parentPid)], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (!output) return [];
      return output
        .split("\n")
        .map((line) => parseInt(line.trim(), 10))
        .filter((pid) => !isNaN(pid));
    } catch {
      // pgrep returns non-zero when no children found
      return [];
    }
  }

  private runAdbReverse(ports: number[]): void {
    for (const port of ports) {
      try {
        execFileSync("adb", ["reverse", `tcp:${port}`, `tcp:${port}`], {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 5000,
        });
        log.debug(`Set adb reverse tcp:${port}`, { domain: "port-mapping" });
      } catch (err) {
        log.debug(
          `adb reverse tcp:${port} failed (best-effort): ${err instanceof Error ? err.message : String(err)}`,
          { domain: "port-mapping" },
        );
      }
    }
  }

  private branchExistsLocally(branch: string, gitRoot: string): boolean {
    try {
      execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  }

  private findLocalBranchHierarchyConflict(
    branch: string,
    gitRoot: string,
  ): { conflictingBranch: string; relation: "ancestor" | "descendant" } | null {
    const parts = branch.split("/").filter(Boolean);
    if (parts.length > 1) {
      for (let idx = 1; idx < parts.length; idx++) {
        const ancestor = parts.slice(0, idx).join("/");
        if (this.branchExistsLocally(ancestor, gitRoot)) {
          return { conflictingBranch: ancestor, relation: "ancestor" };
        }
      }
    }

    try {
      const descendants = execFileSync(
        "git",
        ["for-each-ref", "--format=%(refname:short)", `refs/heads/${branch}/*`],
        {
          cwd: gitRoot,
          encoding: "utf-8",
          stdio: "pipe",
        },
      )
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (descendants.length > 0) {
        return { conflictingBranch: descendants[0], relation: "descendant" };
      }
    } catch {
      // Ignore lookup failures and continue with normal creation flow.
    }

    return null;
  }

  async createWorktree(
    request: WorktreeCreateRequest,
    callbacks?: {
      onSuccess?: (worktreeId: string) => void;
      onFailure?: (worktreeId: string, error: string) => void;
    },
  ): Promise<{
    success: boolean;
    worktree?: WorktreeInfo;
    error?: string;
    code?: string;
    worktreeId?: string;
  }> {
    const { branch, id } = request;

    if (!validateBranchName(branch)) {
      return { success: false, error: "Invalid branch name" };
    }

    const worktreeId =
      request.name?.trim() ||
      id ||
      branch.replace(/^(feature|fix|chore)\//, "").replace(/[^a-zA-Z0-9- ]/g, "-");

    if (!/^[a-zA-Z0-9][a-zA-Z0-9 -]*$/.test(worktreeId)) {
      return {
        success: false,
        error:
          "Worktree name must start with a letter or number and contain only letters, numbers, spaces, and hyphens",
      };
    }

    const gitRoot = this.getGitRoot();
    const branchHierarchyConflict = this.findLocalBranchHierarchyConflict(branch, gitRoot);
    if (branchHierarchyConflict) {
      const recoveryWorktreeId =
        branchHierarchyConflict.relation === "ancestor"
          ? branchHierarchyConflict.conflictingBranch
          : worktreeId;
      return {
        success: false,
        error: `Cannot create branch "${branch}" because "${branchHierarchyConflict.conflictingBranch}" already exists. Reuse that worktree or recreate it from scratch.`,
        code: "WORKTREE_RECOVERY_REQUIRED",
        worktreeId: recoveryWorktreeId,
      };
    }
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      // Ignore prune errors - conflict checks below still provide guardrails.
    }

    const gitManagedIds = await this.listGitManagedWorktreeIds();
    const conflictCandidates = new Set<string>([
      ...this.getWorktreeResolutionCandidates(),
      ...gitManagedIds,
    ]);
    const conflict = this.resolveIdFromCandidates(worktreeId, conflictCandidates);
    if (conflict.kind === "resolved") {
      return {
        success: false,
        error: `Worktree "${conflict.id}" already exists`,
        code: "WORKTREE_EXISTS",
        worktreeId: conflict.id,
      };
    }
    if (conflict.kind === "ambiguous") {
      return {
        success: false,
        error: `Worktree "${worktreeId}" is ambiguous. Matches: ${conflict.ids.join(", ")}`,
        code: "WORKTREE_ID_AMBIGUOUS",
      };
    }

    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, worktreeId);

    // Check if repo has any commits BEFORE starting async creation
    // This allows the frontend to show the setup modal
    try {
      execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      return {
        success: false,
        error:
          'Repository has no commits yet. Create an initial commit from the Integrations panel or run: git add . && git commit -m "Initial commit"',
      };
    }

    // Create placeholder entry for immediate UI feedback
    const placeholder: WorktreeInfo = {
      id: worktreeId,
      path: worktreePath,
      branch,
      status: "creating",
      statusMessage: "Fetching branch...",
      ports: [],
      offset: null,
      pid: null,
      // New branches haven't been pushed yet
      hasUnpushed: true,
    };

    this.creatingWorktrees.set(worktreeId, placeholder);
    if (callbacks) {
      this.worktreeCallbacks.set(worktreeId, callbacks);
    }
    this.notifyListeners();
    this.activityLog.addEvent({
      category: "worktree",
      type: "creation_started",
      severity: "info",
      title: `Creating worktree "${worktreeId}"`,
      worktreeId,
      projectName: this.activityProjectName(),
      groupKey: `worktree-creation:${worktreeId}`,
      metadata: { branch },
    });

    // Run the actual creation async — don't block the HTTP response
    this.runCreateWorktree(worktreeId, branch, worktreePath).catch(() => {
      // Error handling is done inside runCreateWorktree
    });

    return { success: true, worktree: placeholder };
  }

  private async runCreateWorktree(
    worktreeId: string,
    branch: string,
    worktreePath: string,
  ): Promise<void> {
    const updateStatus = (statusMessage: string) => {
      const entry = this.creatingWorktrees.get(worktreeId);
      if (entry) {
        entry.statusMessage = statusMessage;
        this.notifyListeners();
      }
    };

    try {
      const gitRoot = this.getGitRoot();

      // Step 1: Fetch
      try {
        await execFile("git", ["fetch", "origin", branch], {
          cwd: gitRoot,
          encoding: "utf-8",
        });
      } catch {
        // Branch might not exist on remote
      }

      // Step 2: Create worktree
      updateStatus("Creating worktree...");

      // Determine the best base ref to use
      let baseRef = this.config.baseBranch;
      let baseRefValid = false;
      try {
        // Check if configured baseBranch exists
        await execFile("git", ["rev-parse", "--verify", baseRef], {
          cwd: gitRoot,
          encoding: "utf-8",
        });
        baseRefValid = true;
      } catch {
        // baseBranch doesn't exist - try fallbacks
      }

      if (!baseRefValid) {
        const fallbacks = ["develop", "main", "master", "HEAD"];
        for (const fallback of fallbacks) {
          try {
            await execFile("git", ["rev-parse", "--verify", fallback], {
              cwd: gitRoot,
              encoding: "utf-8",
            });
            baseRef = fallback;
            baseRefValid = true;
            break;
          } catch {
            // Try next fallback
          }
        }
      }

      if (!baseRefValid) {
        throw new Error(`No valid base branch found. Configure baseBranch in settings.`);
      }

      // Prune stale worktree references before creating
      try {
        await execFile("git", ["worktree", "prune"], { cwd: gitRoot, encoding: "utf-8" });
      } catch {
        // Ignore prune errors - not critical
      }

      // Try to create the worktree with various strategies
      try {
        // New branch from baseRef (e.g. develop)
        await execFile("git", ["worktree", "add", worktreePath, "-b", branch, baseRef], {
          cwd: gitRoot,
          encoding: "utf-8",
        });
      } catch {
        try {
          // Branch already exists locally — check it out
          await execFile("git", ["worktree", "add", worktreePath, branch], {
            cwd: gitRoot,
            encoding: "utf-8",
          });
        } catch {
          // Branch exists but is conflicting — force-reset from baseRef
          await execFile("git", ["worktree", "add", worktreePath, "-B", branch, baseRef], {
            cwd: gitRoot,
            encoding: "utf-8",
          });
        }
      }

      // Step 2.5: Copy .env* files from main project to worktree
      this.copyWorktreeEnvFiles(worktreePath);

      // Step 3: Install dependencies (unless disabled)
      if (this.config.autoInstall !== false) {
        updateStatus("Installing dependencies...");
        log.info(`Installing dependencies in ${worktreeId}...`);
        const [installCmd, ...installArgs] = this.config.installCommand.split(" ");
        await execFile(installCmd, installArgs, {
          cwd: worktreePath,
          encoding: "utf-8",
        });
      }

      updateStatus("Running worktree-created hooks...");
      await this.runWorktreeLifecycleHooks("worktree-created", worktreeId, worktreePath);

      // Done — remove from creating map; getWorktrees() will pick it up from filesystem
      this.creatingWorktrees.delete(worktreeId);
      this.notifyListeners();
      this.activityLog.addEvent({
        category: "worktree",
        type: "creation_completed",
        severity: "success",
        title: "Worktree created",
        worktreeId,
        projectName: this.activityProjectName(),
        groupKey: `worktree-creation:${worktreeId}`,
        metadata: { branch },
      });

      // Call success callback (e.g. to link worktree to issue)
      const callbacks = this.worktreeCallbacks.get(worktreeId);
      if (callbacks?.onSuccess) {
        try {
          callbacks.onSuccess(worktreeId);
        } catch {
          /* ignore */
        }
      }
      this.worktreeCallbacks.delete(worktreeId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create worktree";
      log.error(`Failed to create ${worktreeId}: ${message}`);
      updateStatus(`Error: ${message}`);

      // Call failure callback (e.g. to NOT link worktree)
      const callbacks = this.worktreeCallbacks.get(worktreeId);
      if (callbacks?.onFailure) {
        try {
          callbacks.onFailure(worktreeId, message);
        } catch {
          /* ignore */
        }
      }
      this.worktreeCallbacks.delete(worktreeId);

      // Emit notification so the frontend can show a toast
      this.emitNotification(`Failed to create worktree "${worktreeId}": ${message}`);
      this.activityLog.addEvent({
        category: "worktree",
        type: "creation_failed",
        severity: "error",
        title: `Worktree "${worktreeId}" creation failed`,
        detail: message,
        worktreeId,
        projectName: this.activityProjectName(),
        groupKey: `worktree-creation:${worktreeId}`,
      });

      // Remove after a delay so the user can see the error
      setTimeout(() => {
        this.creatingWorktrees.delete(worktreeId);
        this.notifyListeners();
      }, 5000);
    }
  }

  async renameWorktree(
    currentId: string,
    request: WorktreeRenameRequest,
  ): Promise<{ success: boolean; error?: string }> {
    const resolved = this.resolveWorktreeId(currentId);
    if (!resolved.success) {
      return { success: false, error: resolved.error };
    }
    const canonicalId = resolved.worktreeId;

    if (this.runningProcesses.has(canonicalId)) {
      return {
        success: false,
        error: "Cannot rename a running worktree. Stop it first.",
      };
    }

    const worktreesPath = this.getWorktreesAbsolutePath();
    const currentPath = path.join(worktreesPath, canonicalId);

    if (!existsSync(currentPath)) {
      return { success: false, error: `Worktree "${canonicalId}" not found` };
    }

    if (!request.name && !request.branch) {
      return { success: false, error: "Nothing to rename" };
    }

    try {
      const gitRoot = this.getGitRoot();

      // Rename directory (worktree name)
      if (request.name && request.name !== canonicalId) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9 -]*$/.test(request.name.trim())) {
          return {
            success: false,
            error:
              "Worktree name must start with a letter or number and contain only letters, numbers, spaces, and hyphens",
          };
        }

        const newPath = path.join(worktreesPath, request.name);
        if (existsSync(newPath)) {
          return {
            success: false,
            error: `Worktree "${request.name}" already exists`,
          };
        }

        execFileSync("git", ["worktree", "move", currentPath, newPath], {
          cwd: gitRoot,
          encoding: "utf-8",
          stdio: "pipe",
        });

        // Update color map
        const color = worktreeColorMap.get(canonicalId);
        if (color) {
          worktreeColorMap.delete(canonicalId);
          worktreeColorMap.set(request.name, color);
        }
      }

      // Rename branch
      if (request.branch) {
        if (!validateBranchName(request.branch)) {
          return { success: false, error: "Invalid branch name" };
        }

        const worktreeCwd = request.name ? path.join(worktreesPath, request.name) : currentPath;

        const currentBranch = getWorktreeBranch(worktreeCwd);
        if (currentBranch && currentBranch !== request.branch) {
          execFileSync("git", ["branch", "-m", currentBranch, request.branch], {
            cwd: worktreeCwd,
            encoding: "utf-8",
            stdio: "pipe",
          });
        }
      }

      this.notifyListeners();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to rename worktree",
      };
    }
  }

  async removeWorktree(
    id: string,
    options: RemoveWorktreeOptions = {},
  ): Promise<RemoveWorktreeResult> {
    const deleteOpId = options.deleteOpId ?? randomUUID();
    const startedAt = Date.now();
    const projectName = this.getProjectName() ?? undefined;
    const logDeletePhase = (
      phase: string,
      result: "start" | "success" | "failure",
      extra: Record<string, unknown> = {},
    ) => {
      const context = {
        domain: "worktree",
        action: "worktree.delete.phase",
        status: result === "failure" ? "failed" : "info",
        projectName,
        deleteOpId,
        phase,
        result,
        targetId: id,
        ...extra,
      };
      if (result === "failure") {
        worktreeLog.error(`Worktree delete ${result}: ${phase}`, context);
      } else {
        worktreeLog.info(`Worktree delete ${result}: ${phase}`, context);
      }
    };
    const finalize = (finalResult: RemoveWorktreeResult): RemoveWorktreeResult => {
      const context = {
        domain: "worktree",
        action: "worktree.delete.complete",
        status: finalResult.success ? "success" : "failed",
        projectName,
        worktreeId: finalResult.worktreeId,
        deleteOpId,
        durationMs: Date.now() - startedAt,
        targetId: id,
        code: finalResult.code ?? null,
        error: finalResult.error ?? null,
        removedTerminalSessions: finalResult.removedTerminalSessions ?? 0,
        removedRunningProcess: finalResult.removedRunningProcess ?? false,
        clearedLinks: finalResult.clearedLinks ?? 0,
      };
      if (finalResult.success) {
        worktreeLog.success("Worktree delete completed", context);
      } else {
        worktreeLog.error("Worktree delete failed", context);
      }
      return { ...finalResult, deleteOpId };
    };

    logDeletePhase("validate", "start");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 -]*$/.test(id)) {
      return finalize({
        success: false,
        code: "INVALID_WORKTREE_ID",
        error:
          "Worktree name must start with a letter or number and contain only letters, numbers, spaces, and hyphens",
      });
    }

    const resolved = this.resolveWorktreeId(id);
    if (!resolved.success) {
      logDeletePhase("validate", "failure", { code: resolved.code, error: resolved.error });
      return finalize({
        success: false,
        code: resolved.code,
        error: resolved.error,
      });
    }
    const worktreeId = resolved.worktreeId;
    const removedRunningProcess = this.runningProcesses.has(worktreeId);
    logDeletePhase("validate", "success", { canonicalWorktreeId: worktreeId });

    logDeletePhase("graceful-stop-worktree-process", "start", { worktreeId });
    await this.stopWorktree(worktreeId);
    logDeletePhase("graceful-stop-worktree-process", "success", {
      worktreeId,
      removedRunningProcess,
    });

    let removedTerminalSessions = 0;
    if (options.destroyTerminalsForWorktree) {
      logDeletePhase("destroy-terminals-for-target-worktree-only", "start", { worktreeId });
      try {
        removedTerminalSessions = options.destroyTerminalsForWorktree(worktreeId);
      } catch (error) {
        logDeletePhase("destroy-terminals-for-target-worktree-only", "failure", {
          worktreeId,
          error,
        });
        return finalize({
          success: false,
          code: "WORKTREE_REMOVE_FAILED",
          error: error instanceof Error ? error.message : "Failed to destroy worktree terminals",
          worktreeId,
          removedRunningProcess,
          removedTerminalSessions,
        });
      }
      logDeletePhase("destroy-terminals-for-target-worktree-only", "success", {
        worktreeId,
        removedTerminalSessions,
      });
    }

    // Always clear transient in-memory state so a removed worktree id can be recreated immediately.
    this.clearTransientWorktreeState(worktreeId);

    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, worktreeId);
    const gitRoot = this.getGitRoot();
    if (!existsSync(worktreePath)) {
      this.pruneGitWorktreeMetadata(gitRoot);
      const clearedLinks = this.notesManager.clearLinkedWorktreeId(worktreeId);
      this.clearAwaitingInputForWorktree(worktreeId);
      this.notifyListeners();
      return finalize({
        success: true,
        worktreeId,
        removedRunningProcess,
        removedTerminalSessions,
        clearedLinks,
      });
    }

    try {
      logDeletePhase("remove-worktree-from-git/filesystem", "start", { worktreeId, worktreePath });

      try {
        execFileSync("git", ["worktree", "remove", worktreePath, "--force"], {
          cwd: gitRoot,
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch {
        execFileSync("rm", ["-rf", worktreePath], {
          encoding: "utf-8",
          stdio: "pipe",
        });
      }
      this.pruneGitWorktreeMetadata(gitRoot);
      logDeletePhase("remove-worktree-from-git/filesystem", "success", {
        worktreeId,
        worktreePath,
      });

      logDeletePhase("clear-links-for-target-worktree-only", "start", { worktreeId });
      const clearedLinks = this.notesManager.clearLinkedWorktreeId(worktreeId);
      logDeletePhase("clear-links-for-target-worktree-only", "success", {
        worktreeId,
        clearedLinks,
      });

      this.clearAwaitingInputForWorktree(worktreeId);
      logDeletePhase("run worktree-removed hooks", "start", { worktreeId });
      await this.runWorktreeLifecycleHooks("worktree-removed", worktreeId, worktreePath);
      logDeletePhase("run worktree-removed hooks", "success", { worktreeId });

      logDeletePhase("notifyListeners", "start", { worktreeId });
      this.notifyListeners();
      logDeletePhase("notifyListeners", "success", { worktreeId });

      return finalize({
        success: true,
        worktreeId,
        removedRunningProcess,
        removedTerminalSessions,
        clearedLinks,
      });
    } catch (error) {
      logDeletePhase("remove-worktree-from-git/filesystem", "failure", {
        worktreeId,
        error,
      });
      return finalize({
        success: false,
        code: "WORKTREE_REMOVE_FAILED",
        error: error instanceof Error ? error.message : "Failed to remove worktree",
        worktreeId,
        removedRunningProcess,
        removedTerminalSessions,
      });
    }
  }

  async recoverWorktree(
    worktreeId: string,
    action: "reuse" | "recreate",
    branch?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const resolved = this.resolveWorktreeId(worktreeId);
    if (!resolved.success && resolved.code === "WORKTREE_ID_AMBIGUOUS") {
      return { success: false, error: resolved.error };
    }
    const canonicalId = resolved.success ? resolved.worktreeId : worktreeId;

    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, canonicalId);
    const gitRoot = this.getGitRoot();
    const branchName = branch || canonicalId;

    try {
      if (action === "recreate") {
        // First, forcefully remove the existing worktree
        try {
          execFileSync("git", ["worktree", "remove", worktreePath, "--force"], {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: "pipe",
          });
        } catch {
          // Directory might not exist in git's view, try direct removal
        }

        // Remove the directory if it still exists
        if (existsSync(worktreePath)) {
          execFileSync("rm", ["-rf", worktreePath], {
            encoding: "utf-8",
            stdio: "pipe",
          });
        }

        // Prune stale worktree entries
        try {
          execFileSync("git", ["worktree", "prune"], {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: "pipe",
          });
        } catch {
          // Ignore prune failures
        }

        // Delete the branch if it exists (start completely fresh)
        try {
          execFileSync("git", ["branch", "-D", branchName], {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: "pipe",
          });
        } catch {
          // Branch might not exist, that's fine
        }

        // Now create the worktree fresh
        return this.createWorktree({ branch: branchName, name: canonicalId });
      } else {
        // Reuse: preserve existing branch and its commits

        // Prune stale worktree entries first
        try {
          execFileSync("git", ["worktree", "prune"], {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: "pipe",
          });
        } catch {
          // Ignore prune failures
        }

        // Check if the directory already exists and is valid
        if (existsSync(worktreePath)) {
          try {
            execFileSync("git", ["rev-parse", "--git-dir"], {
              cwd: worktreePath,
              encoding: "utf-8",
              stdio: "pipe",
            });
            // Directory exists and is valid, just notify and return
            this.notifyListeners();
            return { success: true };
          } catch {
            // Directory exists but is not a valid worktree, remove it
            execFileSync("rm", ["-rf", worktreePath], {
              encoding: "utf-8",
              stdio: "pipe",
            });
          }
        }

        // Directory doesn't exist - check if branch exists so we can restore
        let branchExists = false;
        try {
          execFileSync("git", ["rev-parse", "--verify", branchName], {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: "pipe",
          });
          branchExists = true;
        } catch {
          branchExists = false;
        }

        if (!branchExists) {
          return {
            success: false,
            error: `Branch "${branchName}" does not exist. Choose "Recreate" to create a new branch.`,
          };
        }

        // Branch exists - create worktree directory pointing to it
        try {
          execFileSync("git", ["worktree", "add", worktreePath, branchName], {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: "pipe",
          });
        } catch (err) {
          return {
            success: false,
            error: `Failed to restore worktree: ${toErrorMessage(err)}`,
          };
        }

        this.notifyListeners();
        return { success: true };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to recover worktree",
      };
    }
  }

  getRunningProcessPids(): Map<
    string,
    { pid: number; branch: string; ports: number[]; path: string }
  > {
    const result = new Map<
      string,
      { pid: number; branch: string; ports: number[]; path: string }
    >();
    const worktreesPath = this.getWorktreesAbsolutePath();

    for (const [id, proc] of this.runningProcesses) {
      const worktreePath = path.join(worktreesPath, id);
      const branch = getWorktreeBranch(worktreePath) || "unknown";
      result.set(id, { pid: proc.pid, branch, ports: proc.ports, path: worktreePath });
    }

    return result;
  }

  getAllWorktreePaths(): Map<string, { path: string; branch: string }> {
    const result = new Map<string, { path: string; branch: string }>();
    const worktreesPath = this.getWorktreesAbsolutePath();
    if (!existsSync(worktreesPath)) return result;

    for (const entry of readdirSync(worktreesPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const worktreePath = path.join(worktreesPath, entry.name);
      if (!existsSync(path.join(worktreePath, ".git"))) continue;
      if (this.creatingWorktrees.has(entry.name)) continue;
      const branch = getWorktreeBranch(worktreePath) || "unknown";
      result.set(entry.name, { path: worktreePath, branch });
    }

    return result;
  }

  getLogs(id: string): string[] {
    const resolved = this.resolveWorktreeId(id);
    const worktreeId = resolved.success ? resolved.worktreeId : id;
    const processInfo = this.runningProcesses.get(worktreeId);
    return processInfo?.logs ?? [];
  }

  async stopAll(): Promise<void> {
    this.githubManager?.stopPolling();
    for (const watcher of this.fileWatchers) watcher.close();
    this.fileWatchers = [];
    for (const timer of this.fileChangeDebounceTimers.values()) clearTimeout(timer);
    this.fileChangeDebounceTimers.clear();
    const stopPromises = Array.from(this.runningProcesses.keys()).map((id) =>
      this.stopWorktree(id),
    );
    await Promise.all(stopPromises);
    this.activityLog.dispose();
    this.opsLog.dispose();
  }

  async cleanupIssueData(
    source: "jira" | "linear",
    issueId: string,
    actions: { issueData: boolean; attachments: boolean; notes: boolean; linkedWorktree: boolean },
  ): Promise<void> {
    const issueDir = this.notesManager.getIssueDir(source, issueId);
    if (!existsSync(issueDir)) return;

    // If linkedWorktree action: find linked worktree, stop and remove it
    if (actions.linkedWorktree) {
      const notes = this.notesManager.loadNotes(source, issueId);
      if (notes.linkedWorktreeId) {
        await this.stopWorktree(notes.linkedWorktreeId);
        await this.removeWorktree(notes.linkedWorktreeId);
      }
    }

    if (actions.issueData) {
      const issueFile = path.join(issueDir, "issue.json");
      if (existsSync(issueFile)) unlinkSync(issueFile);
    }

    if (actions.attachments) {
      const attachDir = path.join(issueDir, "attachments");
      if (existsSync(attachDir)) rmSync(attachDir, { recursive: true });
    }

    if (actions.notes) {
      const notesFile = path.join(issueDir, "notes.json");
      if (existsSync(notesFile)) unlinkSync(notesFile);
    }

    // Remove empty issue directory
    try {
      const remaining = readdirSync(issueDir);
      if (remaining.length === 0) rmSync(issueDir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  getProjectName(): string | null {
    try {
      const pkgPath = path.join(this.configDir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return pkg.name || null;
    } catch {
      return null;
    }
  }

  private activityProjectName(): string | undefined {
    return this.getProjectName() ?? undefined;
  }

  private async runWorktreeLifecycleHooks(
    trigger: WorktreeLifecycleHookTrigger,
    worktreeId: string,
    worktreePath: string,
  ): Promise<void> {
    if (!this.worktreeLifecycleHookRunner) return;
    try {
      log.info(`[hooks] Running ${trigger} hooks for "${worktreeId}"`);
      await this.worktreeLifecycleHookRunner(trigger, worktreeId, worktreePath);
      log.info(`[hooks] Finished ${trigger} hooks for "${worktreeId}"`);
    } catch (error) {
      log.warn(`Failed running ${trigger} hooks for "${worktreeId}": ${toErrorMessage(error)}`);
    }
  }

  private clearAwaitingInputForWorktree(worktreeId: string): void {
    this.activityLog.addEvent({
      // Keep the agent-awaiting-input group key so pending-input state is cleared,
      // but present this as a worktree lifecycle notification in the activity feed.
      category: "worktree",
      type: ACTIVITY_TYPES.NOTIFY,
      severity: "info",
      title: "Worktree removed",
      detail: `Worktree "${worktreeId}" has been removed.`,
      worktreeId,
      projectName: this.activityProjectName(),
      groupKey: `agent-awaiting-input:${worktreeId}`,
      metadata: {
        requiresUserAction: false,
        awaitingUserInput: false,
        cleared: true,
        clearedReason: "worktree-removed",
      },
    });
  }

  getConfig(): WorktreeConfig {
    return this.withLocalConfig(this.config);
  }

  getConfigDir(): string {
    return this.configDir;
  }

  setStartupCwd(cwd: string): void {
    this.startupCwd = cwd;
  }

  getStartupCwd(): string {
    return this.startupCwd ?? this.configDir;
  }

  suppressFileChangeNotification(category: FileChangeCategory): void {
    this.suppressedFileChangeCategories.add(category);
  }

  updateConfig(partial: Partial<WorktreeConfig>): { success: boolean; error?: string } {
    const configPath = path.join(this.configDir, CONFIG_DIR_NAME, "config.json");

    try {
      const configExists = existsSync(configPath);
      let existing: Record<string, unknown> = {};
      if (configExists) {
        existing = JSON.parse(readFileSync(configPath, "utf-8"));
      }

      const localConfigUpdates: Partial<{
        allowAgentCommits: boolean;
        allowAgentPushes: boolean;
        allowAgentPRs: boolean;
        useNativePortHook: boolean;
        autoCleanupOnPrMerge: boolean;
        autoCleanupOnPrClose: boolean;
      }> = {};

      for (const key of LOCAL_CONFIG_KEYS) {
        if (!(key in partial) || partial[key] === undefined) continue;
        if (typeof partial[key] !== "boolean") {
          return { success: false, error: `Invalid value for ${key}` };
        }
        localConfigUpdates[key] = partial[key];
      }

      if (Object.keys(localConfigUpdates).length > 0) {
        updateLocalConfig(this.configDir, localConfigUpdates);
      }

      // Merge allowed top-level fields
      const allowedKeys = [
        "startCommand",
        "installCommand",
        "baseBranch",
        "projectDir",
        "autoInstall",
        "localIssuePrefix",
        "localAutoStartAgent",
        "localAutoStartClaudeOnNewIssue",
        "localAutoStartClaudeSkipPermissions",
        "localAutoStartClaudeFocusTerminal",
        "openProjectTarget",
      ] as const;

      let hasConfigUpdates = false;
      for (const key of allowedKeys) {
        if (key in partial && partial[key] !== undefined) {
          hasConfigUpdates = true;
          if (
            key === "openProjectTarget" &&
            !isConfiguredOpenProjectTarget(partial.openProjectTarget)
          ) {
            return { success: false, error: "Invalid open project target" };
          }
          if (
            key === "localAutoStartAgent" &&
            partial.localAutoStartAgent !== "claude" &&
            partial.localAutoStartAgent !== "codex" &&
            partial.localAutoStartAgent !== "gemini" &&
            partial.localAutoStartAgent !== "opencode"
          ) {
            return { success: false, error: "Invalid local auto-start agent" };
          }
          existing[key] = partial[key];
          (this.config as unknown as Record<string, unknown>)[key] = partial[key];
        }
      }

      // Handle nested ports.offsetStep
      if (partial.ports?.offsetStep !== undefined) {
        hasConfigUpdates = true;
        const ports = (existing.ports ?? {}) as Record<string, unknown>;
        ports.offsetStep = partial.ports.offsetStep;
        existing.ports = ports;
        this.config.ports.offsetStep = partial.ports.offsetStep;
      }

      // Handle envMapping
      if (partial.envMapping !== undefined) {
        hasConfigUpdates = true;
        existing.envMapping = partial.envMapping;
        this.config.envMapping = partial.envMapping;
      }

      // Handle showDiffStats
      if (partial.showDiffStats !== undefined) {
        hasConfigUpdates = true;
        existing.showDiffStats = partial.showDiffStats;
        this.config.showDiffStats = partial.showDiffStats;
      }

      // Handle activity settings
      if (partial.activity !== undefined) {
        hasConfigUpdates = true;
        const mergedActivity = sanitizeActivityConfig({
          ...(existing.activity as Record<string, unknown>),
          ...partial.activity,
        } as WorktreeConfig["activity"]);
        existing.activity = (mergedActivity ?? {}) as Record<string, unknown>;
        this.config.activity = mergedActivity;
        this.activityLog.updateConfig(mergedActivity ?? {});
      }

      // Handle ops log settings
      if (partial.opsLog !== undefined) {
        hasConfigUpdates = true;
        const mergedOpsLog = {
          ...(existing.opsLog as Record<string, unknown>),
          ...partial.opsLog,
        };
        existing.opsLog = mergedOpsLog;
        this.config.opsLog = partial.opsLog;
        this.opsLog.updateConfig(partial.opsLog ?? {});
      }

      for (const key of LOCAL_CONFIG_KEYS) {
        delete existing[key];
      }

      if (configExists || hasConfigUpdates) {
        this.suppressedFileChangeCategories.add("config");
        writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
      }

      this.config = this.withLocalConfig(this.config);
      this.portManager.useNativeHook = this.config.useNativePortHook !== false;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update config",
      };
    }
  }

  async listJiraIssues(query?: string): Promise<{
    issues: Array<{
      key: string;
      summary: string;
      status: string;
      type: string;
      priority: string;
      assignee: string | null;
      url: string;
    }>;
    error?: string;
  }> {
    const creds = loadJiraCredentials(this.configDir);
    if (!creds) return { issues: [], error: "Jira not configured" };

    const apiBase = getApiBase(creds);
    const headers = await getAuthHeaders(creds, this.configDir);

    let jql = "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
    if (query) {
      jql = `assignee = currentUser() AND resolution = Unresolved AND text ~ "${query}" ORDER BY updated DESC`;
    }

    const params = new URLSearchParams({
      jql,
      fields: "summary,status,priority,issuetype,assignee,updated,labels",
      maxResults: "50",
    });

    const resp = await fetch(`${apiBase}/search/jql?${params}`, { headers });
    if (!resp.ok) {
      const body = await resp.text();
      return { issues: [], error: `Jira API error: ${resp.status} ${body}` };
    }

    const data = (await resp.json()) as {
      issues: Array<{
        key: string;
        fields: {
          summary: string;
          status: { name: string };
          priority: { name: string };
          issuetype: { name: string };
          assignee: { displayName: string } | null;
        };
      }>;
    };

    let siteUrl: string;
    if (creds.authMethod === "oauth") {
      siteUrl = creds.oauth.siteUrl;
    } else {
      siteUrl = creds.apiToken.baseUrl;
    }
    const baseUrl = siteUrl.replace(/\/$/, "");

    return {
      issues: data.issues.map((issue) => ({
        key: issue.key,
        summary: issue.fields.summary ?? "",
        status: issue.fields.status?.name ?? "Unknown",
        type: issue.fields.issuetype?.name ?? "Unknown",
        priority: issue.fields.priority?.name ?? "None",
        assignee: issue.fields.assignee?.displayName ?? null,
        url: `${baseUrl}/browse/${issue.key}`,
      })),
    };
  }

  async getJiraIssue(issueKey: string): Promise<{
    issue?: {
      key: string;
      summary: string;
      description: string;
      status: string;
      type: string;
      priority: string;
      assignee: string | null;
      url: string;
      comments: Array<{ author: string; body: string }>;
    };
    error?: string;
  }> {
    const creds = loadJiraCredentials(this.configDir);
    if (!creds) return { error: "Jira not configured" };

    let resolvedKey: string;
    try {
      resolvedKey = resolveTaskKey(issueKey, loadJiraProjectConfig(this.configDir));
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Invalid issue key" };
    }

    const taskData = await fetchIssue(resolvedKey, creds, this.configDir);
    return {
      issue: {
        key: taskData.key,
        summary: taskData.summary,
        description: taskData.description,
        status: taskData.status,
        type: taskData.type,
        priority: taskData.priority,
        assignee: taskData.assignee,
        url: taskData.url,
        comments: taskData.comments.slice(0, 10),
      },
    };
  }

  async listLinearIssues(query?: string): Promise<{
    issues: Array<{
      identifier: string;
      title: string;
      status: string;
      priority: number;
      assignee: string | null;
      url: string;
    }>;
    error?: string;
  }> {
    const creds = loadLinearCredentials(this.configDir);
    if (!creds) return { issues: [], error: "Linear not configured" };

    const projectConfig = loadLinearProjectConfig(this.configDir);
    const issues = await fetchLinearIssues(creds, projectConfig.defaultTeamKey, query);
    return {
      issues: issues.map((i) => ({
        identifier: i.identifier,
        title: i.title,
        status: i.state.name,
        priority: i.priority,
        assignee: i.assignee,
        url: i.url,
      })),
    };
  }

  async getLinearIssue(identifier: string): Promise<{
    issue?: {
      identifier: string;
      title: string;
      description: string;
      status: string;
      priority: number;
      assignee: string | null;
      url: string;
    };
    error?: string;
  }> {
    const creds = loadLinearCredentials(this.configDir);
    if (!creds) return { error: "Linear not configured" };

    const projectConfig = loadLinearProjectConfig(this.configDir);
    let resolvedId: string;
    try {
      resolvedId = resolveLinearIdentifier(identifier, projectConfig);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Invalid identifier" };
    }

    const issueDetail = await fetchLinearIssue(resolvedId, creds);
    return {
      issue: {
        identifier: issueDetail.identifier,
        title: issueDetail.title,
        description: issueDetail.description ?? "",
        status: issueDetail.state.name,
        priority: issueDetail.priority,
        assignee: issueDetail.assignee,
        url: issueDetail.url,
      },
    };
  }

  async createWorktreeFromJira(
    issueKey: string,
    branch?: string,
  ): Promise<{
    success: boolean;
    worktreeId?: string;
    worktreePath?: string;
    reusedExisting?: boolean;
    task?: {
      key: string;
      summary: string;
      description: string;
      status: string;
      type: string;
      url: string;
      comments: Array<{ author: string; body: string }>;
    };
    aiContext?: string | null;
    instructions?: string;
    error?: string;
    code?: string;
  }> {
    const creds = loadJiraCredentials(this.configDir);
    if (!creds) {
      return { success: false, error: "Jira credentials not configured" };
    }

    const projectConfig = loadJiraProjectConfig(this.configDir);
    let resolvedKey: string;
    try {
      resolvedKey = resolveTaskKey(issueKey, projectConfig);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Invalid task key",
      };
    }

    let taskData: JiraTaskData;
    try {
      taskData = await fetchIssue(resolvedKey, creds, this.configDir);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to fetch issue",
      };
    }

    // Save issue data locally unless saveOn is 'never'
    const saveOn = projectConfig.dataLifecycle?.saveOn ?? "view";
    if (saveOn !== "never") {
      const tasksDir = path.join(this.configDir, CONFIG_DIR_NAME, "tasks");
      saveTaskData(taskData, tasksDir);

      // Download attachments in background
      if (taskData.attachments.length > 0) {
        const issueDir = path.join(this.configDir, CONFIG_DIR_NAME, "issues", "jira", taskData.key);
        const attachDir = path.join(issueDir, "attachments");
        downloadAttachments(
          taskData.attachments
            .filter((a) => a.contentUrl)
            .map((a) => ({
              filename: a.filename,
              content: a.contentUrl!,
              mimeType: a.mimeType,
              size: a.size,
            })),
          attachDir,
          creds,
          this.configDir,
        )
          .then((downloaded) => {
            if (downloaded.length > 0) {
              for (const dl of downloaded) {
                const att = taskData.attachments.find((a) => a.filename === dl.filename);
                if (att) att.localPath = dl.localPath;
              }
              saveTaskData(taskData, path.join(this.configDir, CONFIG_DIR_NAME, "tasks"));
            }
          })
          .catch(() => {
            /* non-critical */
          });
      }
    }

    // Load AI context notes
    const notes = this.notesManager.loadNotes("jira", resolvedKey);
    const aiContext = notes.aiContext?.content ?? null;

    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, resolvedKey);

    // Create worktree using custom branch or generated name from rule
    const worktreeBranch =
      branch?.trim() ||
      (await generateBranchName(this.configDir, {
        issueId: resolvedKey,
        name: taskData.summary,
        type: "jira",
      }));
    const result = await this.createWorktree(
      { branch: worktreeBranch, name: resolvedKey },
      {
        onSuccess: (createdWorktreeId) => {
          // Link the worktree to the issue only after async creation succeeds
          this.notesManager.setLinkedWorktreeId("jira", resolvedKey, createdWorktreeId);
        },
      },
    );

    if (!result.success) {
      if (result.code === "WORKTREE_EXISTS" && result.worktreeId) {
        const canonicalWorktreeId = result.worktreeId;
        this.notesManager.setLinkedWorktreeId("jira", resolvedKey, canonicalWorktreeId);
        return {
          success: true,
          worktreeId: canonicalWorktreeId,
          worktreePath: path.join(worktreesPath, canonicalWorktreeId),
          reusedExisting: true,
          task: {
            key: taskData.key,
            summary: taskData.summary,
            description: taskData.description,
            status: taskData.status,
            type: taskData.type,
            url: taskData.url,
            comments: taskData.comments.slice(0, 10),
          },
          aiContext,
          instructions: `Reused existing worktree at ${path.join(worktreesPath, canonicalWorktreeId)}.`,
        };
      }
      return {
        success: false,
        error: result.error,
        code: result.code,
        worktreeId: result.worktreeId,
      };
    }

    return {
      success: true,
      worktreeId: resolvedKey,
      worktreePath,
      reusedExisting: false,
      task: {
        key: taskData.key,
        summary: taskData.summary,
        description: taskData.description,
        status: taskData.status,
        type: taskData.type,
        url: taskData.url,
        comments: taskData.comments.slice(0, 10),
      },
      aiContext,
      instructions: `Worktree is being created at ${worktreePath}. Once creation completes (check with list_worktrees), navigate to the worktree directory and start implementing the task. Run \`openkit task context\` in the worktree to get full task details.`,
    };
  }

  async createWorktreeFromLinear(
    identifier: string,
    branch?: string,
  ): Promise<{
    success: boolean;
    worktreeId?: string;
    worktreePath?: string;
    reusedExisting?: boolean;
    task?: {
      identifier: string;
      title: string;
      description: string;
      status: string;
      url: string;
      comments?: Array<{ author: string; body: string; created?: string }>;
    };
    aiContext?: string | null;
    instructions?: string;
    error?: string;
    code?: string;
  }> {
    linearLog.info(`Create worktree requested from Linear issue ${identifier}`, {
      domain: "linear",
      action: "linear.worktree.create",
      projectName: this.getProjectName() ?? undefined,
      identifier,
      hasBranchOverride: Boolean(branch?.trim()),
    });
    const creds = loadLinearCredentials(this.configDir);
    if (!creds) {
      return { success: false, error: "Linear credentials not configured" };
    }

    const projectConfig = loadLinearProjectConfig(this.configDir);
    let resolvedId: string;
    try {
      resolvedId = resolveLinearIdentifier(identifier, projectConfig);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Invalid identifier",
      };
    }

    let issueDetail;
    try {
      issueDetail = await fetchLinearIssue(resolvedId, creds);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to fetch issue",
      };
    }

    // Save issue data locally unless saveOn is 'never'
    const linearSaveOn = projectConfig.dataLifecycle?.saveOn ?? "view";
    if (linearSaveOn !== "never") {
      const tasksDir = path.join(this.configDir, CONFIG_DIR_NAME, "tasks");
      const taskData: LinearTaskData = {
        source: "linear",
        identifier: issueDetail.identifier,
        title: issueDetail.title,
        description: issueDetail.description,
        status: issueDetail.state.name,
        priority: issueDetail.priority,
        assignee: issueDetail.assignee,
        labels: issueDetail.labels,
        createdAt: issueDetail.createdAt,
        updatedAt: issueDetail.updatedAt,
        comments: issueDetail.comments,
        attachments: issueDetail.attachments,
        linkedWorktree: null,
        fetchedAt: new Date().toISOString(),
        url: issueDetail.url,
      };
      saveLinearTaskData(taskData, tasksDir);
    }

    // Load AI context notes
    const notes = this.notesManager.loadNotes("linear", resolvedId);
    const aiContext = notes.aiContext?.content ?? null;

    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, resolvedId);

    const linearComments = issueDetail.comments?.map((c) => ({
      author: c.author ?? "Unknown",
      body: c.body ?? "",
      created: c.createdAt,
    }));

    // Create worktree using custom branch or generated name from rule
    const worktreeBranch =
      branch?.trim() ||
      (await generateBranchName(this.configDir, {
        issueId: resolvedId,
        name: issueDetail.title,
        type: "linear",
      }));
    const result = await this.createWorktree(
      { branch: worktreeBranch, name: resolvedId },
      {
        onSuccess: (createdWorktreeId) => {
          // Link the worktree to the issue only after async creation succeeds
          this.notesManager.setLinkedWorktreeId("linear", resolvedId, createdWorktreeId);
        },
      },
    );
    if (result.success) {
      linearLog.success(`Created worktree from Linear issue ${resolvedId}`, {
        domain: "linear",
        action: "linear.worktree.create",
        worktreeId: result.worktreeId,
        projectName: this.getProjectName() ?? undefined,
        identifier: resolvedId,
        success: result.success,
        code: result.code ?? null,
        error: result.error ?? null,
      });
    } else {
      linearLog.error(`Failed to create worktree from Linear issue ${resolvedId}`, {
        domain: "linear",
        action: "linear.worktree.create",
        status: "failed",
        worktreeId: result.worktreeId,
        projectName: this.getProjectName() ?? undefined,
        identifier: resolvedId,
        success: result.success,
        code: result.code ?? null,
        error: result.error ?? null,
      });
    }

    if (!result.success) {
      if (result.code === "WORKTREE_EXISTS" && result.worktreeId) {
        const canonicalWorktreeId = result.worktreeId;
        this.notesManager.setLinkedWorktreeId("linear", resolvedId, canonicalWorktreeId);
        return {
          success: true,
          worktreeId: canonicalWorktreeId,
          worktreePath: path.join(worktreesPath, canonicalWorktreeId),
          reusedExisting: true,
          task: {
            identifier: issueDetail.identifier,
            title: issueDetail.title,
            description: issueDetail.description ?? "",
            status: issueDetail.state.name,
            url: issueDetail.url,
            comments: linearComments,
          },
          aiContext,
          instructions: `Reused existing worktree at ${path.join(worktreesPath, canonicalWorktreeId)}.`,
        };
      }
      return {
        success: false,
        error: result.error,
        code: result.code,
        worktreeId: result.worktreeId,
      };
    }

    return {
      success: true,
      worktreeId: resolvedId,
      worktreePath,
      reusedExisting: false,
      task: {
        identifier: issueDetail.identifier,
        title: issueDetail.title,
        description: issueDetail.description ?? "",
        status: issueDetail.state.name,
        url: issueDetail.url,
        comments: linearComments,
      },
      aiContext,
      instructions: `Worktree is being created at ${worktreePath}. Once creation completes (check with list_worktrees), navigate to the worktree directory and start implementing the task. Run \`openkit task context\` in the worktree to get full task details.`,
    };
  }
}
