/**
 * System boundary mocks: 3rd-party integrations + native modules.
 *
 * Mocks Jira, Linear, GitHub integration modules and node-pty
 * so the real server routes can execute without external API calls.
 */
import { vi } from "vitest";

// ─── Server runtime monitors (patch Node internals — must be mocked) ──

vi.mock("@openkit/server/runtime/install-command-monitor", () => ({}));

vi.mock("@openkit/server/runtime/command-monitor", () => ({
  setCommandMonitorSink: vi.fn(),
}));

vi.mock("@openkit/server/runtime/fetch-monitor", () => ({
  setFetchMonitorSink: vi.fn(),
}));

// ─── node-pty (native module, used by TerminalManager) ─────────

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 99999,
  })),
}));

// ─── @hono/node-ws (WebSocket, not needed in tests) ───────────

vi.mock("@hono/node-ws", () => ({
  createNodeWebSocket: vi.fn(() => ({
    upgradeWebSocket: vi.fn(() => vi.fn()),
    injectWebSocket: vi.fn(),
  })),
}));

// ─── @hono/node-server (not needed in test — we call app.fetch directly) ──

vi.mock("@hono/node-server", () => ({
  createAdaptorServer: vi.fn(),
}));

// ─── Bundled skills & agents lib (writes to ~/.openkit/skills — skip) ──

vi.mock("@openkit/server/verification-skills", () => ({
  ensureBundledSkills: vi.fn(),
}));

vi.mock("@openkit/agents", () => ({
  BUNDLED_SKILLS: [],
  CLAUDE_SKILL: "",
  CURSOR_RULE: "",
  VSCODE_PROMPT: "",
}));

// ─── Jira integration ─────────────────────────────────────────

const jiraCredentialsMock = {
  loadJiraCredentials: vi.fn(() => null),
  saveJiraCredentials: vi.fn(),
  loadJiraProjectConfig: vi.fn(() => null),
  saveJiraProjectConfig: vi.fn(),
  deleteJiraCredentials: vi.fn(),
};

vi.mock("@openkit/integrations/jira/credentials", () => jiraCredentialsMock);

const jiraAuthMock = {
  testConnection: vi.fn(async () => true),
  getApiBase: vi.fn(() => "https://jira.example.com"),
  getAuthHeaders: vi.fn(() => ({ Authorization: "Bearer test-token" })),
};

vi.mock("@openkit/integrations/jira/auth", () => jiraAuthMock);

const jiraApiMock = {
  fetchIssue: vi.fn(async () => null),
  fetchIssues: vi.fn(async () => []),
  resolveTaskKey: vi.fn((key: string) => key),
  saveTaskData: vi.fn(),
  downloadAttachments: vi.fn(async () => []),
};

vi.mock("@openkit/integrations/jira/api", () => jiraApiMock);

// ─── Linear integration ───────────────────────────────────────

const linearCredentialsMock = {
  loadLinearCredentials: vi.fn(() => null),
  saveLinearCredentials: vi.fn(),
  loadLinearProjectConfig: vi.fn(() => null),
  saveLinearProjectConfig: vi.fn(),
  deleteLinearCredentials: vi.fn(),
};

vi.mock("@openkit/integrations/linear/credentials", () => linearCredentialsMock);

const linearApiMock = {
  fetchIssue: vi.fn(async () => null),
  fetchIssues: vi.fn(async () => []),
  resolveIdentifier: vi.fn((id: string) => id),
  saveTaskData: vi.fn(),
  testConnection: vi.fn(async () => true),
  fetchStatusOptions: vi.fn(async () => []),
  fetchIssueStatusOptions: vi.fn(async () => []),
  fetchPriorityOptions: vi.fn(async () => []),
  updateIssueStatus: vi.fn(async () => ({})),
  updateIssuePriority: vi.fn(async () => ({})),
  updateIssueDescription: vi.fn(async () => ({})),
  updateIssueTitle: vi.fn(async () => ({})),
  addIssueComment: vi.fn(async () => ({})),
  updateIssueComment: vi.fn(async () => ({})),
  deleteIssueComment: vi.fn(async () => ({})),
};

vi.mock("@openkit/integrations/linear/api", () => linearApiMock);

// ─── GitHub integration ───────────────────────────────────────

const githubManagerMock = {
  GitHubManager: vi.fn().mockImplementation(() => ({
    getStatus: vi.fn(() => ({
      installed: false,
      authenticated: false,
      username: null,
      repo: null,
      hasRemote: false,
      hasCommits: false,
    })),
    initGitHub: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    commitAll: vi.fn(async () => ({ success: true })),
    pushBranch: vi.fn(async () => ({ success: true })),
    createPR: vi.fn(async () => ({ success: true })),
    createInitialCommit: vi.fn(async () => ({ success: true })),
    createRepo: vi.fn(async () => ({ success: true })),
    refreshPrStatus: vi.fn(async () => {}),
  })),
};

vi.mock("@openkit/integrations/github/github-manager", () => githubManagerMock);

const ghClientMock = {
  checkGhAuth: vi.fn(async () => false),
  configureGitUser: vi.fn(async () => {}),
  isGhInstalled: vi.fn(() => false),
};

vi.mock("@openkit/integrations/github/gh-client", () => ghClientMock);

// ─── Helper functions for tests ───────────────────────────────

export function mockJiraConfigured(config?: {
  defaultProjectKey?: string;
  refreshIntervalMinutes?: number;
}) {
  jiraCredentialsMock.loadJiraCredentials.mockReturnValue({
    type: "api-token",
    baseUrl: "https://jira.example.com",
    email: "test@example.com",
    token: "test-token",
  } as any);
  jiraCredentialsMock.loadJiraProjectConfig.mockReturnValue({
    defaultProjectKey: config?.defaultProjectKey ?? "TEST",
    refreshIntervalMinutes: config?.refreshIntervalMinutes ?? 5,
  } as any);
}

export function mockJiraIssues(
  issues: Array<{
    key: string;
    summary: string;
    status?: string;
    priority?: string;
    assignee?: string;
  }>,
) {
  jiraApiMock.fetchIssues.mockResolvedValue(
    issues.map((i) => ({
      key: i.key,
      summary: i.summary,
      status: i.status ?? "To Do",
      priority: i.priority ?? "Medium",
      assignee: i.assignee ?? "Test User",
      issueType: "Task",
    })) as any,
  );
}

export function mockJiraIssueDetail(issue: {
  key: string;
  summary: string;
  description?: string;
  status?: string;
  priority?: string;
  comments?: Array<{ id: string; body: string; author: string }>;
}) {
  jiraApiMock.fetchIssue.mockResolvedValue({
    key: issue.key,
    summary: issue.summary,
    description: issue.description ?? "",
    status: issue.status ?? "To Do",
    priority: issue.priority ?? "Medium",
    issueType: "Task",
    assignee: "Test User",
    comments: issue.comments ?? [],
    attachments: [],
  } as any);
}

export function mockLinearConfigured(config?: {
  defaultTeamKey?: string;
  refreshIntervalMinutes?: number;
}) {
  linearCredentialsMock.loadLinearCredentials.mockReturnValue({
    apiKey: "lin_test_key",
  } as any);
  linearCredentialsMock.loadLinearProjectConfig.mockReturnValue({
    defaultTeamKey: config?.defaultTeamKey ?? "ENG",
    refreshIntervalMinutes: config?.refreshIntervalMinutes ?? 5,
  } as any);
}

export function mockLinearIssues(
  issues: Array<{
    identifier: string;
    title: string;
    status?: string;
    priority?: number;
  }>,
) {
  linearApiMock.fetchIssues.mockResolvedValue(
    issues.map((i) => ({
      identifier: i.identifier,
      title: i.title,
      status: i.status ?? "Todo",
      priority: i.priority ?? 2,
      assignee: "Test User",
    })) as any,
  );
}

export function mockGitHubAuthenticated() {
  ghClientMock.checkGhAuth.mockResolvedValue(true);
  ghClientMock.isGhInstalled.mockReturnValue(true);
  githubManagerMock.GitHubManager.mockImplementation(() => ({
    getStatus: vi.fn(() => ({
      installed: true,
      authenticated: true,
      username: "testuser",
      repo: "test/repo",
      hasRemote: true,
      hasCommits: true,
    })),
    initGitHub: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    commitAll: vi.fn(async () => ({ success: true })),
    pushBranch: vi.fn(async () => ({ success: true })),
    createPR: vi.fn(async () => ({ success: true, url: "https://github.com/test/repo/pull/1" })),
    createInitialCommit: vi.fn(async () => ({ success: true })),
    createRepo: vi.fn(async () => ({ success: true })),
    refreshPrStatus: vi.fn(async () => {}),
  }));
}

export function resetIntegrationMocks() {
  jiraCredentialsMock.loadJiraCredentials.mockReturnValue(null);
  jiraCredentialsMock.loadJiraProjectConfig.mockReturnValue(null);
  jiraApiMock.fetchIssue.mockResolvedValue(null);
  jiraApiMock.fetchIssues.mockResolvedValue([]);

  linearCredentialsMock.loadLinearCredentials.mockReturnValue(null);
  linearCredentialsMock.loadLinearProjectConfig.mockReturnValue(null);
  linearApiMock.fetchIssue.mockResolvedValue(null);
  linearApiMock.fetchIssues.mockResolvedValue([]);

  ghClientMock.checkGhAuth.mockResolvedValue(false);
  ghClientMock.isGhInstalled.mockReturnValue(false);
}

afterEach(() => {
  resetIntegrationMocks();
});
