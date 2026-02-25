// -- Config types (stored in integrations.json) --

export interface DataLifecycleConfig {
  saveOn: "view" | "worktree-creation" | "never";
  autoCleanup: {
    enabled: boolean;
    statusTriggers: string[];
    actions: {
      issueData: boolean;
      attachments: boolean;
      notes: boolean;
      linkedWorktree: boolean;
    };
  };
}

export interface LinearProjectConfig {
  defaultTeamKey?: string;
  refreshIntervalMinutes?: number;
  dataLifecycle?: DataLifecycleConfig;
  autoStartAgent?: "claude" | "codex" | "gemini" | "opencode";
  autoStartClaudeOnNewIssue?: boolean;
  autoStartClaudeSkipPermissions?: boolean;
  autoStartClaudeFocusTerminal?: boolean;
}

export interface LinearCredentials {
  apiKey: string;
  displayName?: string;
}

// -- Data types --

export interface LinearState {
  name: string;
  type: string;
  color: string;
}

export interface LinearLabel {
  name: string;
  color: string;
}

export interface LinearComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface LinearAttachment {
  title: string;
  subtitle: string | null;
  url: string;
  sourceType: string | null;
}

export interface LinearIssueSummary {
  identifier: string;
  title: string;
  state: LinearState;
  priority: number;
  assignee: string | null;
  updatedAt: string;
  labels: LinearLabel[];
  url: string;
}

export interface LinearIssueDetail extends LinearIssueSummary {
  description: string | null;
  createdAt: string;
  comments: LinearComment[];
  attachments: LinearAttachment[];
}

export interface LinearTaskData {
  source: "linear";
  identifier: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  assignee: string | null;
  labels: LinearLabel[];
  createdAt: string;
  updatedAt: string;
  comments: LinearComment[];
  attachments: LinearAttachment[];
  linkedWorktree: string | null;
  fetchedAt: string;
  url: string;
}
