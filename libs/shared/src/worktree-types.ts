export type OpenProjectTarget =
  | "file-manager"
  | "cursor"
  | "vscode"
  | "zed"
  | "intellij"
  | "webstorm"
  | "terminal"
  | "warp"
  | "ghostty"
  | "neovim";

export interface PortConfig {
  /** Ports discovered by running the dev command and monitoring with lsof */
  discovered: number[];
  /** How much to increment ports per worktree instance (default: 1) */
  offsetStep: number;
}

export interface WorktreeConfig {
  /** Subdirectory to cd into before running command (e.g., "apps/storefront") */
  projectDir: string;
  /** Command to start dev server in each worktree */
  startCommand: string;
  /** Command to install dependencies in each worktree (e.g., "pnpm install", "yarn install") */
  installCommand: string;
  /** Base branch to create worktrees from (e.g., "develop", "main") */
  baseBranch: string;
  /** Port configuration for multi-port offset */
  ports: PortConfig;
  /** Env var templates with port references, e.g. { "VITE_API_URL": "http://localhost:${4000}" } */
  envMapping?: Record<string, string>;
  /** Whether to auto-install dependencies when creating a worktree (default: true) */
  autoInstall?: boolean;
  /** Prefix for local issue identifiers (default: "LOCAL") */
  localIssuePrefix?: string;
  /** Agent used for local auto-start (default: "claude") */
  localAutoStartAgent?: "claude" | "codex" | "gemini" | "opencode";
  /** Auto-start agent for newly discovered local tasks (default: false) */
  localAutoStartClaudeOnNewIssue?: boolean;
  /** Skip permission prompts for local auto-start (default: true) */
  localAutoStartClaudeSkipPermissions?: boolean;
  /** Focus agent terminal when local auto-start begins (default: true) */
  localAutoStartClaudeFocusTerminal?: boolean;
  /** Preferred app target for "Open project in" */
  openProjectTarget?: OpenProjectTarget;
  /** User preference: whether MCP agents are allowed to commit (default: false) */
  allowAgentCommits?: boolean;
  /** User preference: whether MCP agents are allowed to push (default: false) */
  allowAgentPushes?: boolean;
  /** User preference: whether MCP agents are allowed to create PRs (default: false) */
  allowAgentPRs?: boolean;
  /** Whether to use native (Zig) port hook for runtime-agnostic port resolution (default: false) */
  useNativePortHook?: boolean;
  /** Detected project framework for port defaults (auto-set during discovery) */
  framework?: "react-native" | "expo" | "generic";
  /** Whether to show diff stats (lines added/removed) in sidebar and detail view (default: true) */
  showDiffStats?: boolean;
  /** Activity feed configuration */
  activity?: {
    retentionDays?: number;
    maxSizeMB?: number;
    categories?: Record<string, boolean>;
    disabledEvents?: string[];
    toastEvents?: string[];
    osNotificationEvents?: string[];
  };
  /** Ops log (debug log) configuration */
  opsLog?: {
    retentionDays?: number;
    maxSizeMB?: number;
  };
  /** Auto-delete worktree when its PR is merged (default: false) */
  autoCleanupOnPrMerge?: boolean;
  /** Auto-delete worktree when its PR is closed without merge (default: false) */
  autoCleanupOnPrClose?: boolean;
}

/** Sentinel ID used for the root project entry in the worktree list. */
export const ROOT_WORKTREE_ID = "root";

export interface WorktreeInfo {
  /** Unique identifier (typically ticket ID like ADH-1234) */
  id: string;
  /** Absolute path to worktree directory */
  path: string;
  /** Git branch name */
  branch: string;
  /** Current status */
  status: "running" | "stopped" | "starting" | "creating";
  /** Whether this entry represents the root project (not a child worktree) */
  isRoot?: boolean;
  /** Status message for in-progress operations like creation */
  statusMessage?: string;
  /** All offset ports if running */
  ports: number[];
  /** Port offset applied to this worktree */
  offset: number | null;
  /** Process ID if running, null if stopped */
  pid: number | null;
  /** Last activity timestamp */
  lastActivity?: number;
  /** Output logs */
  logs?: string[];
  /** Jira issue URL if this worktree was created from a Jira task */
  jiraUrl?: string;
  /** Jira issue status (e.g. "In Progress", "To Do") */
  jiraStatus?: string;
  /** GitHub PR URL if one exists for this worktree's branch */
  githubPrUrl?: string;
  /** GitHub PR state: 'open', 'closed', 'merged', or 'draft' */
  githubPrState?: string;
  /** Linear issue URL if this worktree was created from a Linear issue */
  linearUrl?: string;
  /** Linear issue state name (e.g. "In Progress", "Todo") */
  linearStatus?: string;
  /** Local issue identifier if this worktree was created from a local issue */
  localIssueId?: string;
  /** Local issue status (e.g. "todo", "in-progress", "done") */
  localIssueStatus?: string;
  /** Whether there are uncommitted changes in the worktree */
  hasUncommitted?: boolean;
  /** Whether there are unpushed commits */
  hasUnpushed?: boolean;
  /** Number of commits ahead of upstream */
  commitsAhead?: number;
  /** Number of commits ahead of base branch (for PR eligibility) */
  commitsAheadOfBase?: number;
  /** Lines added vs base branch */
  linesAdded?: number;
  /** Lines removed vs base branch */
  linesRemoved?: number;
}

export interface WorktreeCreateRequest {
  /** Branch name to checkout */
  branch: string;
  /** Worktree ID (defaults to branch name sanitized) */
  id?: string;
  /** Explicit worktree name (display name / directory), falls back to sanitized branch */
  name?: string;
}

export interface WorktreeRenameRequest {
  /** New worktree name (renames directory) */
  name?: string;
  /** New branch name */
  branch?: string;
}

export interface WorktreeResponse {
  success: boolean;
  error?: string;
  worktree?: WorktreeInfo;
  ports?: number[];
  pid?: number;
}

export interface WorktreeListResponse {
  worktrees: WorktreeInfo[];
}

// Hooks Pipeline
export type HookTrigger =
  | "pre-implementation"
  | "post-implementation"
  | "on-demand"
  | "custom"
  | "worktree-created"
  | "worktree-removed";

export type WorktreeLifecycleHookTrigger = "worktree-created" | "worktree-removed";
export type HookStepKind = "command" | "prompt";

export interface HookStep {
  id: string;
  name: string;
  command: string;
  kind?: HookStepKind;
  prompt?: string;
  enabled?: boolean;
  trigger?: HookTrigger;
  condition?: string;
  conditionTitle?: string;
}

export interface HookSkillRef {
  skillName: string;
  enabled: boolean;
  trigger?: HookTrigger;
  condition?: string;
  conditionTitle?: string;
}

export interface HooksConfig {
  steps: HookStep[];
  skills: HookSkillRef[];
}

export interface SkillHookResult {
  skillName: string;
  trigger?: HookTrigger;
  status: "running" | "passed" | "failed";
  success?: boolean;
  summary?: string;
  content?: string;
  filePath?: string;
  reportedAt: string;
}

export interface StepResult {
  stepId: string;
  stepName: string;
  command: string;
  status: "pending" | "running" | "passed" | "failed";
  output?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface PipelineRun {
  id: string;
  worktreeId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  steps: StepResult[];
  skills?: SkillHookResult[];
}

// ─── Diff Viewer ────────────────────────────────────────────────

export interface DiffFileInfo {
  path: string;
  oldPath?: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  linesAdded: number;
  linesRemoved: number;
  isBinary: boolean;
}

export interface DiffListResponse {
  success: boolean;
  files: DiffFileInfo[];
  baseBranch: string;
  error?: string;
}

export interface PrDiffListResponse extends DiffListResponse {
  /** SHA of the PR base (e.g. the tip of main at merge time) */
  baseSha: string;
  /** SHA of the merge commit */
  mergeSha: string;
  /** SHA of the PR branch head when the PR was merged */
  headSha: string;
  /** SHA of the local worktree HEAD (for detecting post-merge commits) */
  localHeadSha: string;
}

export interface WorktreeSettings {
  /** Override global auto-delete-on-merge setting for this worktree */
  autoCleanupOnMerge?: boolean;
  /** Override global auto-delete-on-close setting for this worktree */
  autoCleanupOnClose?: boolean;
}

export interface DiffFileContentResponse {
  success: boolean;
  oldContent: string;
  newContent: string;
  error?: string;
}

export interface RunningProcess {
  pid: number;
  ports: number[];
  offset: number;
  /** Sends signal to the process. Works with both ChildProcess and node-pty IPty. */
  kill: (signal?: string) => void;
  lastActivity: number;
  logs: string[];
  logNotifyTimer?: ReturnType<typeof setTimeout>;
}
