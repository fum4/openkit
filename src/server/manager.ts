import { execFile as execFileCb, execFileSync, spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import { promisify } from "util";

const execFile = promisify(execFileCb);

import pc from "picocolors";
import { CONFIG_DIR_NAME } from "../constants";
import { copyEnvFiles } from "../core/env-files";
import { log } from "../logger";
import { generateBranchName } from "./branch-name";
import { getGitRoot, getWorktreeBranch, validateBranchName } from "../core/git";
import { GitHubManager } from "../integrations/github/github-manager";
import { loadJiraCredentials, loadJiraProjectConfig } from "../integrations/jira/credentials";
import {
  downloadAttachments,
  fetchIssue,
  resolveTaskKey,
  saveTaskData,
} from "../integrations/jira/api";
import { getApiBase, getAuthHeaders } from "../integrations/jira/auth";
import type { JiraTaskData } from "../integrations/jira/types";
import { loadLinearCredentials, loadLinearProjectConfig } from "../integrations/linear/credentials";
import {
  fetchIssue as fetchLinearIssue,
  fetchIssues as fetchLinearIssues,
  resolveIdentifier as resolveLinearIdentifier,
  saveTaskData as saveLinearTaskData,
} from "../integrations/linear/api";
import type { LinearTaskData } from "../integrations/linear/types";

import { ActivityLog } from "./activity-log";
import { ACTIVITY_TYPES } from "./activity-event";
import { NotesManager } from "./notes-manager";
import { PortManager } from "./port-manager";
import type { HooksInfo, PendingTaskContext } from "./task-context";
import { writeTaskMd, generateTaskMd } from "./task-context";
import type {
  WorktreeLifecycleHookTrigger,
  RunningProcess,
  WorktreeConfig,
  WorktreeCreateRequest,
  WorktreeInfo,
  WorktreeRenameRequest,
} from "./types";

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

export class WorktreeManager {
  private config: WorktreeConfig;

  private configDir: string;

  private configFilePath: string | null;

  private portManager: PortManager;

  private notesManager: NotesManager;

  private activityLog: ActivityLog;

  private runningProcesses: Map<string, RunningProcess> = new Map();

  private creatingWorktrees: Map<string, WorktreeInfo> = new Map();

  private githubManager: GitHubManager | null = null;

  private pendingWorktreeContext: Map<string, PendingTaskContext> = new Map();

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

  private worktreeLifecycleHookRunner:
    | ((
        trigger: WorktreeLifecycleHookTrigger,
        worktreeId: string,
        worktreePath: string,
      ) => Promise<void>)
    | null = null;

  private taskHooksProvider: ((worktreeId: string) => HooksInfo | null) | null = null;

  constructor(config: WorktreeConfig, configFilePath: string | null = null) {
    this.config = {
      ...config,
      activity: sanitizeActivityConfig(config.activity),
    };
    this.configFilePath = configFilePath;
    this.configDir = configFilePath ? path.dirname(path.dirname(configFilePath)) : process.cwd();
    this.portManager = new PortManager(config, configFilePath);
    this.notesManager = new NotesManager(this.configDir);
    this.activityLog = new ActivityLog(this.configDir, this.config.activity);

    const worktreesPath = this.getWorktreesAbsolutePath();
    if (!existsSync(worktreesPath)) {
      mkdirSync(worktreesPath, { recursive: true });
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
      this.config = {
        projectDir: fileConfig.projectDir ?? this.config.projectDir,
        startCommand: fileConfig.startCommand ?? this.config.startCommand,
        installCommand: fileConfig.installCommand ?? this.config.installCommand,
        baseBranch: fileConfig.baseBranch ?? this.config.baseBranch,
        ports: {
          discovered: fileConfig.ports?.discovered ?? this.config.ports.discovered,
          offsetStep: fileConfig.ports?.offsetStep ?? this.config.ports.offsetStep,
        },
        envMapping: fileConfig.envMapping ?? this.config.envMapping,
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
        activity: sanitizeActivityConfig(fileConfig.activity ?? this.config.activity),
      };

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
      log.error("Failed to reload config:", error);
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
        log.info(`GitHub: connected to ${status.repo}`);
      } else if (!status.installed) {
        log.warn("GitHub: gh CLI not found, GitHub features disabled");
      } else if (!status.authenticated) {
        log.warn('GitHub: not authenticated, run "gh auth login"');
      }
    } catch {
      log.warn("GitHub: initialization failed, features disabled");
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
    this.notificationListeners.forEach((listener) => listener({ message, level }));
  }

  subscribeHookUpdates(listener: (worktreeId: string) => void): () => void {
    this.hookUpdateListeners.add(listener);
    return () => this.hookUpdateListeners.delete(listener);
  }

  emitHookUpdate(worktreeId: string): void {
    this.hookUpdateListeners.forEach((listener) => listener(worktreeId));
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

  setTaskHooksProvider(provider: (worktreeId: string) => HooksInfo | null): void {
    this.taskHooksProvider = provider;
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

  setPendingWorktreeContext(id: string, ctx: PendingTaskContext): void {
    this.pendingWorktreeContext.set(id, ctx);
  }

  clearPendingWorktreeContext(id: string): void {
    this.pendingWorktreeContext.delete(id);
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
          // Read the local task.json for identifier and status
          const taskFile = path.join(issueDir, "task.json");
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
    if (this.runningProcesses.has(id)) {
      const info = this.runningProcesses.get(id)!;
      return { success: true, ports: info.ports, pid: info.pid };
    }

    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, id);
    if (!existsSync(worktreePath)) {
      return { success: false, error: `Worktree "${id}" not found` };
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
      const [cmd, ...args] = this.config.startCommand.split(" ");

      // Allocate a port offset for this worktree
      const offset = this.portManager.allocateOffset();
      const portEnv = this.portManager.getEnvForOffset(offset);
      const ports = this.portManager.getPortsForOffset(offset);

      const portsDisplay = ports.length > 0 ? ports.join(", ") : `offset=${offset}`;
      log.info(`Starting ${id} at ${workingDir} (ports: ${portsDisplay})`);

      const childProcess = spawn(cmd, args, {
        cwd: workingDir,
        env: { ...process.env, ...portEnv, FORCE_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
        detached: false,
      });

      const pid = childProcess.pid!;
      const logs: string[] = [];

      this.runningProcesses.set(id, {
        pid,
        ports,
        offset,
        process: childProcess,
        lastActivity: Date.now(),
        logs,
      });

      childProcess.on("exit", (code) => {
        log.info(`Worktree "${id}" exited with code ${code}`);
        const processInfo = this.runningProcesses.get(id);
        if (processInfo) {
          this.portManager.releaseOffset(processInfo.offset);
        }
        this.runningProcesses.delete(id);
        this.notifyListeners();

        // Emit crashed event if exit was unexpected (non-zero and not user-initiated stop)
        if (code !== null && code !== 0) {
          this.activityLog.addEvent({
            category: "worktree",
            type: "crashed",
            severity: "error",
            title: `Worktree "${id}" crashed (exit code ${code})`,
            worktreeId: id,
            projectName: this.activityProjectName(),
            metadata: { exitCode: code },
          });
        }
      });

      const wtColor = getWorktreeColor(id);
      const coloredName = pc.bold(wtColor(id));
      const linePrefix = `${pc.dim("[")}${coloredName}${pc.dim("]")}`;

      const scheduleLogNotify = () => {
        const info = this.runningProcesses.get(id);
        if (info) {
          if (info.logNotifyTimer) clearTimeout(info.logNotifyTimer);
          info.logNotifyTimer = setTimeout(() => {
            info.logNotifyTimer = undefined;
            this.notifyListeners();
          }, 250);
        }
      };

      childProcess.stdout?.on("data", (data) => {
        const lines = data
          .toString()
          .split("\n")
          .filter((l: string) => l.trim());
        lines.forEach((line: string) => process.stdout.write(`${linePrefix} ${line}\n`));
        const processInfo = this.runningProcesses.get(id);
        if (processInfo) {
          processInfo.logs.push(...lines);
          if (processInfo.logs.length > MAX_LOG_LINES) {
            processInfo.logs.splice(0, processInfo.logs.length - MAX_LOG_LINES);
          }
        }
        scheduleLogNotify();
      });

      childProcess.stderr?.on("data", (data) => {
        const lines = data
          .toString()
          .split("\n")
          .filter((l: string) => l.trim());
        lines.forEach((line: string) => process.stderr.write(`${linePrefix} ${line}\n`));
        const processInfo = this.runningProcesses.get(id);
        if (processInfo) {
          processInfo.logs.push(...lines);
          if (processInfo.logs.length > MAX_LOG_LINES) {
            processInfo.logs.splice(0, processInfo.logs.length - MAX_LOG_LINES);
          }
        }
        scheduleLogNotify();
      });

      this.notifyListeners();
      this.activityLog.addEvent({
        category: "worktree",
        type: "started",
        severity: "info",
        title: `Worktree "${id}" started`,
        worktreeId: id,
        projectName: this.activityProjectName(),
        metadata: { ports, pid },
      });
      return { success: true, ports, pid };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to start process",
      };
    }
  }

  async stopWorktree(id: string): Promise<{ success: boolean; error?: string }> {
    const processInfo = this.runningProcesses.get(id);
    if (!processInfo) {
      return { success: true };
    }

    this.portManager.releaseOffset(processInfo.offset);

    try {
      process.kill(-processInfo.pid, "SIGTERM");
    } catch {
      try {
        processInfo.process.kill("SIGTERM");
      } catch {
        // Process may have already exited
      }
    }

    this.runningProcesses.delete(id);
    this.notifyListeners();
    this.activityLog.addEvent({
      category: "worktree",
      type: "stopped",
      severity: "info",
      title: `Worktree "${id}" stopped`,
      worktreeId: id,
      projectName: this.activityProjectName(),
    });

    return { success: true };
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

    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, worktreeId);

    // Check if worktree directory exists OR if git has a stale worktree entry
    const gitRoot = this.getGitRoot();
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      // Ignore prune errors - existence checks below still provide guardrails.
    }
    const worktreeExistsOnDisk = existsSync(worktreePath);
    let gitWorktreeExists = false;

    try {
      const { stdout } = await execFile("git", ["worktree", "list", "--porcelain"], {
        cwd: gitRoot,
        encoding: "utf-8",
      });
      gitWorktreeExists = stdout.includes(worktreePath);
    } catch {
      // Ignore - assume no conflict
    }

    if (worktreeExistsOnDisk || gitWorktreeExists) {
      return {
        success: false,
        error: `Worktree "${worktreeId}" already exists`,
        code: "WORKTREE_EXISTS",
        worktreeId,
      };
    }

    if (this.creatingWorktrees.has(worktreeId)) {
      return {
        success: false,
        error: `Worktree "${worktreeId}" is already being created`,
      };
    }

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
        const fallbacks = ["main", "master", "HEAD"];
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
        // New branch from baseRef (e.g. origin/develop)
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

      // Write TASK.md if we have pending context for this worktree
      const pendingCtx = this.pendingWorktreeContext.get(worktreeId);
      if (pendingCtx) {
        try {
          const notes = this.notesManager.loadNotes(
            pendingCtx.data.source,
            pendingCtx.data.issueId,
          );
          const hooks = this.taskHooksProvider?.(worktreeId) ?? undefined;
          const content = generateTaskMd(pendingCtx.data, pendingCtx.aiContext, notes.todos, hooks);
          writeTaskMd(worktreePath, content);
        } catch {
          // Non-critical — don't fail worktree creation
        }
        this.pendingWorktreeContext.delete(worktreeId);
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
        title: `Worktree "${worktreeId}" created`,
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

      // Clean up pending context on error
      this.pendingWorktreeContext.delete(worktreeId);

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
    if (this.runningProcesses.has(currentId)) {
      return {
        success: false,
        error: "Cannot rename a running worktree. Stop it first.",
      };
    }

    const worktreesPath = this.getWorktreesAbsolutePath();
    const currentPath = path.join(worktreesPath, currentId);

    if (!existsSync(currentPath)) {
      return { success: false, error: `Worktree "${currentId}" not found` };
    }

    if (!request.name && !request.branch) {
      return { success: false, error: "Nothing to rename" };
    }

    try {
      const gitRoot = this.getGitRoot();

      // Rename directory (worktree name)
      if (request.name && request.name !== currentId) {
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
        const color = worktreeColorMap.get(currentId);
        if (color) {
          worktreeColorMap.delete(currentId);
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

  async removeWorktree(id: string): Promise<{ success: boolean; error?: string }> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 -]*$/.test(id)) {
      return {
        success: false,
        error:
          "Worktree name must start with a letter or number and contain only letters, numbers, spaces, and hyphens",
      };
    }

    await this.stopWorktree(id);

    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, id);
    if (!existsSync(worktreePath)) {
      this.notesManager.clearLinkedWorktreeId(id);
      this.clearAwaitingInputForWorktree(id);
      this.notifyListeners();
      return { success: true };
    }

    try {
      const gitRoot = this.getGitRoot();

      try {
        execFileSync("git", ["worktree", "remove", worktreePath, "--force"], {
          cwd: gitRoot,
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch {
        // Git doesn't recognize it as a worktree — remove the directory directly
        execFileSync("rm", ["-rf", worktreePath], {
          encoding: "utf-8",
          stdio: "pipe",
        });
        // Clean up any stale worktree references
        try {
          execFileSync("git", ["worktree", "prune"], {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: "pipe",
          });
        } catch {
          // Ignore prune failures
        }
      }

      this.notesManager.clearLinkedWorktreeId(id);
      this.notifyListeners();
      this.clearAwaitingInputForWorktree(id);
      await this.runWorktreeLifecycleHooks("worktree-removed", id, worktreePath);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to remove worktree",
      };
    }
  }

  async recoverWorktree(
    worktreeId: string,
    action: "reuse" | "recreate",
    branch?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, worktreeId);
    const gitRoot = this.getGitRoot();
    const branchName = branch || worktreeId;

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
        return this.createWorktree({ branch: branchName, name: worktreeId });
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
            error: `Failed to restore worktree: ${err instanceof Error ? err.message : String(err)}`,
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

  getLogs(id: string): string[] {
    const processInfo = this.runningProcesses.get(id);
    return processInfo?.logs ?? [];
  }

  async stopAll(): Promise<void> {
    this.githubManager?.stopPolling();
    const stopPromises = Array.from(this.runningProcesses.keys()).map((id) =>
      this.stopWorktree(id),
    );
    await Promise.all(stopPromises);
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
      log.warn(
        `Failed running ${trigger} hooks for "${worktreeId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
    return this.config;
  }

  getConfigDir(): string {
    return this.configDir;
  }

  updateConfig(partial: Partial<WorktreeConfig>): { success: boolean; error?: string } {
    const configPath = path.join(this.configDir, CONFIG_DIR_NAME, "config.json");

    try {
      let existing: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        existing = JSON.parse(readFileSync(configPath, "utf-8"));
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
        "allowAgentCommits",
        "allowAgentPushes",
        "allowAgentPRs",
      ] as const;

      for (const key of allowedKeys) {
        if (key in partial && partial[key] !== undefined) {
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
        const ports = (existing.ports ?? {}) as Record<string, unknown>;
        ports.offsetStep = partial.ports.offsetStep;
        existing.ports = ports;
        this.config.ports.offsetStep = partial.ports.offsetStep;
      }

      // Handle envMapping
      if (partial.envMapping !== undefined) {
        existing.envMapping = partial.envMapping;
        this.config.envMapping = partial.envMapping;
      }

      // Handle activity settings
      if (partial.activity !== undefined) {
        const mergedActivity = sanitizeActivityConfig({
          ...(existing.activity as Record<string, unknown>),
          ...partial.activity,
        } as WorktreeConfig["activity"]);
        existing.activity = (mergedActivity ?? {}) as Record<string, unknown>;
        this.config.activity = mergedActivity;
        this.activityLog.updateConfig(mergedActivity ?? {});
      }

      writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
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

    // Set pending context so TASK.md gets written after worktree creation
    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, resolvedKey);

    this.setPendingWorktreeContext(resolvedKey, {
      data: {
        source: "jira",
        issueId: resolvedKey,
        identifier: taskData.key,
        title: taskData.summary,
        description: taskData.description,
        status: taskData.status,
        url: taskData.url,
        comments: taskData.comments.slice(0, 10),
        attachments: taskData.attachments
          .filter((a) => a.localPath)
          .map((a) => ({
            filename: a.filename,
            localPath: a.localPath,
            mimeType: a.mimeType,
          })),
      },
      aiContext,
    });

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
        onSuccess: () => {
          // Link the worktree to the issue only after async creation succeeds
          this.notesManager.setLinkedWorktreeId("jira", resolvedKey, resolvedKey);
        },
      },
    );

    if (!result.success) {
      this.clearPendingWorktreeContext(resolvedKey);
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
      instructions: `Worktree is being created at ${worktreePath}. Once creation completes (check with list_worktrees), navigate to the worktree directory and start implementing the task. A TASK.md file with full context will be available in the worktree root.`,
    };
  }

  async createWorktreeFromLinear(
    identifier: string,
    branch?: string,
  ): Promise<{
    success: boolean;
    worktreeId?: string;
    worktreePath?: string;
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
    log.info(
      `[AUTO-CLAUDE][TEMP] createWorktreeFromLinear called (identifier=${identifier}, branch=${branch ?? "auto"})`,
    );
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

    // Set pending context so TASK.md gets written after worktree creation
    const worktreesPath = this.getWorktreesAbsolutePath();
    const worktreePath = path.join(worktreesPath, resolvedId);

    const linearComments = issueDetail.comments?.map((c) => ({
      author: c.author ?? "Unknown",
      body: c.body ?? "",
      created: c.createdAt,
    }));

    this.setPendingWorktreeContext(resolvedId, {
      data: {
        source: "linear",
        issueId: resolvedId,
        identifier: issueDetail.identifier,
        title: issueDetail.title,
        description: issueDetail.description ?? "",
        status: issueDetail.state.name,
        url: issueDetail.url,
        comments: linearComments,
        linkedResources: issueDetail.attachments.map((a) => ({
          title: a.title,
          url: a.url,
          sourceType: a.sourceType,
        })),
      },
      aiContext,
    });

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
        onSuccess: () => {
          // Link the worktree to the issue only after async creation succeeds
          this.notesManager.setLinkedWorktreeId("linear", resolvedId, resolvedId);
        },
      },
    );
    log.info(
      `[AUTO-CLAUDE][TEMP] createWorktreeFromLinear -> createWorktree result (identifier=${resolvedId}, success=${result.success}, code=${result.code ?? "none"}, worktreeId=${result.worktreeId ?? resolvedId})`,
    );

    if (!result.success) {
      this.clearPendingWorktreeContext(resolvedId);
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
      task: {
        identifier: issueDetail.identifier,
        title: issueDetail.title,
        description: issueDetail.description ?? "",
        status: issueDetail.state.name,
        url: issueDetail.url,
        comments: linearComments,
      },
      aiContext,
      instructions: `Worktree is being created at ${worktreePath}. Once creation completes (check with list_worktrees), navigate to the worktree directory and start implementing the task. A TASK.md file with full context will be available in the worktree root.`,
    };
  }
}
