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

export interface JiraProjectConfig {
  defaultProjectKey?: string;
  refreshIntervalMinutes?: number;
  dataLifecycle?: DataLifecycleConfig;
  autoStartAgent?: "claude" | "codex" | "gemini" | "opencode";
  autoStartClaudeOnNewIssue?: boolean;
  autoStartClaudeSkipPermissions?: boolean;
  autoStartClaudeFocusTerminal?: boolean;
}

export interface JiraOAuthCredentials {
  authMethod: "oauth";
  oauth: {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    cloudId: string;
    siteUrl: string;
  };
}

export interface JiraApiTokenCredentials {
  authMethod: "api-token";
  apiToken: {
    baseUrl: string;
    email: string;
    token: string;
  };
}

export type JiraCredentials = JiraOAuthCredentials | JiraApiTokenCredentials;

// -- Data types --

export interface JiraComment {
  author: string;
  body: string;
  created: string;
}

export interface JiraAttachment {
  filename: string;
  localPath: string;
  mimeType: string;
  size: number;
  contentUrl?: string;
  thumbnail?: string | null;
}

export interface JiraTaskData {
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  type: string;
  assignee: string | null;
  reporter: string | null;
  labels: string[];
  created: string;
  updated: string;
  comments: JiraComment[];
  attachments: JiraAttachment[];
  linkedWorktree: string | null;
  fetchedAt: string;
  url: string;
}
