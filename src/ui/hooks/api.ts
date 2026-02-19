import type {
  DataLifecycleConfig,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraStatus,
  GitHubStatus,
  LinearStatus,
  LinearIssueSummary,
  LinearIssueDetail,
  CustomTaskSummary,
  CustomTaskDetail,
  McpServerSummary,
  McpServerDetail,
  McpDeploymentStatus,
  McpScanResult,
  SkillSummary,
  SkillDetail,
  SkillDeploymentStatus,
  SkillInstallRequest,
  PluginSummary,
  PluginDetail,
  AvailablePlugin,
  MarketplaceSummary,
  SkillScanResult,
} from "../types";

// API functions now accept an optional serverUrl parameter
// When null/undefined, they use relative URLs (for single-project web mode)
// When provided, they use the full URL (for multi-project Electron mode)

function getBaseUrl(serverUrl: string | null): string {
  return serverUrl ?? "";
}

export async function createWorktree(
  branch: string,
  name?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string; code?: string; worktreeId?: string }> {
  try {
    const body: { branch: string; name?: string } = { branch };
    if (name) body.name = name;
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/worktrees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create worktree",
    };
  }
}

export async function recoverWorktree(
  id: string,
  action: "reuse" | "recreate",
  branch?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(id)}/recover`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, branch }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to recover worktree",
    };
  }
}

export async function linkWorktree(
  id: string,
  source: "jira" | "linear" | "local",
  issueId: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(id)}/link`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, issueId }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to link worktree",
    };
  }
}

export async function renameWorktree(
  id: string,
  request: { name?: string; branch?: string },
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to rename worktree",
    };
  }
}

export async function startWorktree(
  id: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(id)}/start`,
      {
        method: "POST",
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to start worktree",
    };
  }
}

export async function stopWorktree(
  id: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(id)}/stop`,
      {
        method: "POST",
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to stop worktree",
    };
  }
}

export async function removeWorktree(
  id: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to remove worktree",
    };
  }
}

export async function createFromJira(
  issueKey: string,
  branch?: string,
  serverUrl: string | null = null,
): Promise<{
  success: boolean;
  task?: { key: string; summary: string; status: string; type: string; url: string };
  error?: string;
  code?: string;
  worktreeId?: string;
}> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/jira/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueKey, branch: branch || undefined }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create from Jira",
    };
  }
}

export async function commitChanges(
  id: string,
  message: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(id)}/commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to commit",
    };
  }
}

export async function pushChanges(
  id: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(id)}/push`,
      {
        method: "POST",
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to push",
    };
  }
}

export async function createPullRequest(
  id: string,
  title: string,
  body?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; pr?: { url: string }; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(id)}/create-pr`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create PR",
    };
  }
}

export async function installGitHubCli(
  serverUrl: string | null = null,
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/github/install`, { method: "POST" });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to install gh CLI",
    };
  }
}

export async function loginGitHub(
  serverUrl: string | null = null,
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/github/login`, { method: "POST" });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to authenticate with GitHub",
    };
  }
}

export async function logoutGitHub(
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/github/logout`, { method: "POST" });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return {
        success: false,
        error: `Something went wrong (${res.status}: ${text.slice(0, 50)})`,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to logout from GitHub",
    };
  }
}

export async function createInitialCommit(
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/github/initial-commit`, {
      method: "POST",
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return {
        success: false,
        error: `Something went wrong (${res.status}: ${text.slice(0, 50)})`,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create initial commit",
    };
  }
}

export async function createGitHubRepo(
  isPrivate: boolean,
  serverUrl: string | null = null,
): Promise<{ success: boolean; repo?: string; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/github/create-repo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ private: isPrivate }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create GitHub repository",
    };
  }
}

export async function fetchJiraIssues(
  query?: string,
  serverUrl: string | null = null,
): Promise<{ issues: JiraIssueSummary[]; error?: string }> {
  try {
    const params = query ? `?query=${encodeURIComponent(query)}` : "";
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/jira/issues${params}`);
    return await res.json();
  } catch (err) {
    return {
      issues: [],
      error: err instanceof Error ? err.message : "Failed to fetch Jira issues",
    };
  }
}

export async function fetchJiraIssueDetail(
  key: string,
  serverUrl: string | null = null,
): Promise<{ issue?: JiraIssueDetail; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/jira/issues/${encodeURIComponent(key)}`);
    return await res.json();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to fetch issue detail",
    };
  }
}

export async function createTerminalSession(
  worktreeId: string,
  cols?: number,
  rows?: number,
  startupCommand?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(worktreeId)}/terminals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols, rows, startupCommand }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { success: false, error: text || `HTTP ${res.status}` };
      }
    }
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create terminal",
    };
  }
}

export async function destroyTerminalSession(
  sessionId: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/terminals/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to destroy terminal",
    };
  }
}

export function getTerminalWsUrl(sessionId: string, serverUrl: string | null = null): string {
  if (serverUrl) {
    // Convert http://localhost:6970 to ws://localhost:6970
    const wsUrl = serverUrl.replace(/^http/, "ws");
    return `${wsUrl}/api/terminals/${encodeURIComponent(sessionId)}/ws`;
  }
  // Relative URL mode - use current window location
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/terminals/${encodeURIComponent(sessionId)}/ws`;
}

export async function discoverPorts(serverUrl: string | null = null): Promise<{
  success: boolean;
  ports: number[];
  logs: string[];
  error?: string;
}> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/discover`, {
      method: "POST",
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      ports: [],
      logs: [],
      error: err instanceof Error ? err.message : "Failed to discover ports",
    };
  }
}

// Config-related API functions
export async function fetchConfig(serverUrl: string | null = null): Promise<{
  config?: {
    projectDir: string;
    worktreesDir: string;
    startCommand: string;
    installCommand: string;
    baseBranch: string;
    ports: { discovered: number[]; offsetStep: number };
    envMapping?: Record<string, string>;
  };
  projectName?: string;
  hasBranchNameRule?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config`);
    if (!res.ok) throw new Error("Failed to fetch config");
    return await res.json();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to fetch config",
    };
  }
}

export async function saveConfig(
  updates: Record<string, unknown>,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save config",
    };
  }
}

export async function setupJira(
  baseUrl: string,
  email: string,
  token: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/jira/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl, email, token }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to setup Jira",
    };
  }
}

export async function updateJiraConfig(
  defaultProjectKey: string,
  refreshIntervalMinutes?: number,
  dataLifecycle?: DataLifecycleConfig,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const body: {
      defaultProjectKey: string;
      refreshIntervalMinutes?: number;
      dataLifecycle?: DataLifecycleConfig;
    } = { defaultProjectKey };
    if (refreshIntervalMinutes !== undefined) body.refreshIntervalMinutes = refreshIntervalMinutes;
    if (dataLifecycle !== undefined) body.dataLifecycle = dataLifecycle;
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/jira/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update Jira config",
    };
  }
}

export async function disconnectJira(
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/jira/credentials`, {
      method: "DELETE",
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to disconnect Jira",
    };
  }
}

// -- Linear API functions --

export async function fetchLinearStatus(
  serverUrl: string | null = null,
): Promise<LinearStatus | null> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/linear/status`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchLinearIssues(
  query?: string,
  serverUrl: string | null = null,
): Promise<{ issues: LinearIssueSummary[]; error?: string }> {
  try {
    const params = query ? `?query=${encodeURIComponent(query)}` : "";
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/linear/issues${params}`);
    return await res.json();
  } catch (err) {
    return {
      issues: [],
      error: err instanceof Error ? err.message : "Failed to fetch Linear issues",
    };
  }
}

export async function fetchLinearIssueDetail(
  identifier: string,
  serverUrl: string | null = null,
): Promise<{ issue?: LinearIssueDetail; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/linear/issues/${encodeURIComponent(identifier)}`,
    );
    return await res.json();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to fetch issue detail",
    };
  }
}

export function getLinearAttachmentUrl(url: string, serverUrl: string | null = null): string {
  return `${getBaseUrl(serverUrl)}/api/linear/attachment?url=${encodeURIComponent(url)}`;
}

export async function createFromLinear(
  identifier: string,
  branch?: string,
  serverUrl: string | null = null,
): Promise<{
  success: boolean;
  task?: { identifier: string; title: string; status: string; url: string };
  error?: string;
  code?: string;
  worktreeId?: string;
}> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/linear/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, branch: branch || undefined }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create from Linear",
    };
  }
}

export async function setupLinear(
  apiKey: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/linear/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to setup Linear",
    };
  }
}

export async function updateLinearConfig(
  defaultTeamKey: string,
  refreshIntervalMinutes?: number,
  dataLifecycle?: DataLifecycleConfig,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const body: {
      defaultTeamKey: string;
      refreshIntervalMinutes?: number;
      dataLifecycle?: DataLifecycleConfig;
    } = { defaultTeamKey };
    if (refreshIntervalMinutes !== undefined) body.refreshIntervalMinutes = refreshIntervalMinutes;
    if (dataLifecycle !== undefined) body.dataLifecycle = dataLifecycle;
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/linear/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update Linear config",
    };
  }
}

export async function disconnectLinear(
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/linear/credentials`, {
      method: "DELETE",
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to disconnect Linear",
    };
  }
}

// Fetch worktrees
export async function fetchWorktrees(serverUrl: string | null = null): Promise<{
  worktrees: unknown[];
  error?: string;
}> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/worktrees`);
    if (!res.ok) throw new Error("Failed to fetch worktrees");
    const data = await res.json();
    return { worktrees: data.worktrees || [] };
  } catch (err) {
    return {
      worktrees: [],
      error: err instanceof Error ? err.message : "Failed to fetch worktrees",
    };
  }
}

// Get SSE URL for events
export function getEventsUrl(serverUrl: string | null = null): string {
  return `${getBaseUrl(serverUrl)}/api/events`;
}

// Fetch ports info
export async function fetchPorts(serverUrl: string | null = null): Promise<{
  discovered: number[];
  offsetStep: number;
}> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/ports`);
    if (!res.ok) throw new Error("Failed to fetch ports");
    return await res.json();
  } catch {
    return { discovered: [], offsetStep: 1 };
  }
}

// Fetch Jira status
export async function fetchJiraStatus(serverUrl: string | null = null): Promise<JiraStatus | null> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/jira/status`);
    return await res.json();
  } catch {
    return null;
  }
}

// Fetch GitHub status
export async function fetchGitHubStatus(
  serverUrl: string | null = null,
): Promise<GitHubStatus | null> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/github/status`);
    return await res.json();
  } catch {
    return null;
  }
}

// Verify all integration connections in background
export interface IntegrationsVerifyResult {
  github: { ok: boolean } | null;
  jira: { ok: boolean } | null;
  linear: { ok: boolean } | null;
}

export async function verifyIntegrations(
  serverUrl: string | null = null,
): Promise<IntegrationsVerifyResult | null> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/integrations/verify`);
    return await res.json();
  } catch {
    return null;
  }
}

// Check if dawg config files need to be pushed
export async function fetchSetupStatus(
  serverUrl: string | null = null,
): Promise<{ needsPush: boolean; files: string[] }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config/setup-status`);
    return await res.json();
  } catch {
    return { needsPush: false, files: [] };
  }
}

// Commit dawg config files
export async function commitSetup(
  message: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config/commit-setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    return await res.json();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to commit" };
  }
}

// MCP agent setup
export async function fetchMcpStatus(
  serverUrl: string | null = null,
): Promise<{ statuses: Record<string, { global?: boolean; project?: boolean }> }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp/status`);
    return await res.json();
  } catch {
    return { statuses: {} };
  }
}

export async function setupMcpAgent(
  agent: string,
  scope: "global" | "project",
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, scope }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to setup MCP",
    };
  }
}

export async function removeMcpAgent(
  agent: string,
  scope: "global" | "project",
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, scope }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to remove MCP config",
    };
  }
}

// Detect config values without creating config
export interface DetectedConfig {
  baseBranch: string;
  startCommand: string;
  installCommand: string;
}

export async function detectConfig(
  serverUrl: string | null = null,
): Promise<{ success: boolean; config?: DetectedConfig; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config/detect`);
    return await res.json();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to detect config",
    };
  }
}

// Initialize config with provided values
export async function initConfig(
  config: Partial<DetectedConfig> & Record<string, unknown>,
  serverUrl: string | null = null,
): Promise<{ success: boolean; config?: DetectedConfig; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return await res.json();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to initialize config",
    };
  }
}

// -- Branch Name Rule API --

export async function fetchBranchNameRule(
  source?: string,
  serverUrl: string | null = null,
): Promise<{ content: string; hasOverride?: boolean }> {
  try {
    const params = source ? `?source=${encodeURIComponent(source)}` : "";
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config/branch-name-rule${params}`);
    return await res.json();
  } catch {
    return { content: "" };
  }
}

export async function saveBranchNameRule(
  content: string | null,
  source?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config/branch-name-rule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, source: source || undefined }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save branch name rule",
    };
  }
}

export async function fetchBranchRuleStatus(
  serverUrl: string | null = null,
): Promise<{ overrides: { jira: boolean; linear: boolean; local: boolean } }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config/branch-name-rule/status`);
    return await res.json();
  } catch {
    return { overrides: { jira: false, linear: false, local: false } };
  }
}

// -- Commit Message Rule API --

export async function fetchCommitMessageRule(
  source?: string,
  serverUrl: string | null = null,
): Promise<{ content: string; hasOverride?: boolean }> {
  try {
    const params = source ? `?source=${encodeURIComponent(source)}` : "";
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config/commit-message-rule${params}`);
    return await res.json();
  } catch {
    return { content: "" };
  }
}

export async function saveCommitMessageRule(
  content: string | null,
  source?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config/commit-message-rule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, source: source || undefined }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save commit message rule",
    };
  }
}

export async function fetchCommitRuleStatus(
  serverUrl: string | null = null,
): Promise<{ overrides: { jira: boolean; linear: boolean; local: boolean } }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/config/commit-message-rule/status`);
    return await res.json();
  } catch {
    return { overrides: { jira: false, linear: false, local: false } };
  }
}

// -- Git Policy API --

export type GitPolicyOverride = "inherit" | "allow" | "deny";

export async function updateGitPolicy(
  source: string,
  id: string,
  policy: {
    agentCommits?: GitPolicyOverride;
    agentPushes?: GitPolicyOverride;
    agentPRs?: GitPolicyOverride;
  },
  serverUrl: string | null = null,
): Promise<IssueNotes> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/notes/${encodeURIComponent(source)}/${encodeURIComponent(id)}/git-policy`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      },
    );
    return await res.json();
  } catch {
    return { linkedWorktreeId: null, personal: null, aiContext: null, todos: [] };
  }
}

// -- Hook Skill Overrides API --

export async function updateHookSkills(
  source: string,
  id: string,
  overrides: Record<string, HookSkillOverride>,
  serverUrl: string | null = null,
): Promise<IssueNotes> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/notes/${encodeURIComponent(source)}/${encodeURIComponent(id)}/hook-skills`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overrides),
      },
    );
    return await res.json();
  } catch {
    return { linkedWorktreeId: null, personal: null, aiContext: null, todos: [] };
  }
}

// -- Custom Tasks API --

export async function fetchCustomTasks(
  serverUrl: string | null = null,
): Promise<{ tasks: CustomTaskSummary[]; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/tasks`);
    return await res.json();
  } catch (err) {
    return {
      tasks: [],
      error: err instanceof Error ? err.message : "Failed to fetch tasks",
    };
  }
}

export async function fetchCustomTaskDetail(
  id: string,
  serverUrl: string | null = null,
): Promise<{ task?: CustomTaskDetail; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/tasks/${encodeURIComponent(id)}`);
    return await res.json();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to fetch task detail",
    };
  }
}

export async function createCustomTask(
  data: {
    title: string;
    description?: string;
    priority?: string;
    labels?: string[];
    linkedWorktreeId?: string;
  },
  serverUrl: string | null = null,
): Promise<{ success: boolean; task?: CustomTaskDetail; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create task",
    };
  }
}

export async function updateCustomTask(
  id: string,
  updates: Record<string, unknown>,
  serverUrl: string | null = null,
): Promise<{ success: boolean; task?: CustomTaskDetail; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update task",
    };
  }
}

export async function deleteCustomTask(
  id: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete task",
    };
  }
}

export async function createWorktreeFromCustomTask(
  id: string,
  branch?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; worktreeId?: string; error?: string; code?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/tasks/${encodeURIComponent(id)}/create-worktree`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create worktree from task",
    };
  }
}

// -- Custom Task Attachments API --

export async function uploadTaskAttachment(
  taskId: string,
  file: File,
  serverUrl: string | null = null,
): Promise<{
  success: boolean;
  attachment?: { filename: string; mimeType: string; size: number };
  error?: string;
}> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/tasks/${encodeURIComponent(taskId)}/attachments`,
      {
        method: "POST",
        body: formData,
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to upload attachment",
    };
  }
}

export async function deleteTaskAttachment(
  taskId: string,
  filename: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(filename)}`,
      { method: "DELETE" },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete attachment",
    };
  }
}

export function getTaskAttachmentUrl(
  taskId: string,
  filename: string,
  serverUrl: string | null = null,
): string {
  return `${getBaseUrl(serverUrl)}/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(filename)}`;
}

// -- Notes API --

export interface TodoItem {
  id: string;
  text: string;
  checked: boolean;
  createdAt: string;
}

export type HookSkillOverride = "inherit" | "enable" | "disable";

export interface IssueNotes {
  linkedWorktreeId: string | null;
  personal: { content: string; updatedAt: string } | null;
  aiContext: { content: string; updatedAt: string } | null;
  todos: TodoItem[];
  gitPolicy?: {
    agentCommits?: GitPolicyOverride;
    agentPushes?: GitPolicyOverride;
    agentPRs?: GitPolicyOverride;
  };
  hookSkills?: Record<string, HookSkillOverride>;
}

export async function fetchNotes(
  source: string,
  id: string,
  serverUrl: string | null = null,
): Promise<IssueNotes> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/notes/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
    );
    return await res.json();
  } catch {
    return { linkedWorktreeId: null, personal: null, aiContext: null, todos: [] };
  }
}

export async function updateNotes(
  source: string,
  id: string,
  section: "personal" | "aiContext",
  content: string,
  serverUrl: string | null = null,
): Promise<IssueNotes> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/notes/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, content }),
      },
    );
    return await res.json();
  } catch {
    return { linkedWorktreeId: null, personal: null, aiContext: null, todos: [] };
  }
}

// -- Todo API --

export async function addTodo(
  source: string,
  id: string,
  text: string,
  serverUrl: string | null = null,
): Promise<IssueNotes> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/notes/${encodeURIComponent(source)}/${encodeURIComponent(id)}/todos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
    );
    return await res.json();
  } catch {
    return { linkedWorktreeId: null, personal: null, aiContext: null, todos: [] };
  }
}

export async function updateTodo(
  source: string,
  id: string,
  todoId: string,
  updates: { text?: string; checked?: boolean },
  serverUrl: string | null = null,
): Promise<IssueNotes> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/notes/${encodeURIComponent(source)}/${encodeURIComponent(id)}/todos/${encodeURIComponent(todoId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      },
    );
    return await res.json();
  } catch {
    return { linkedWorktreeId: null, personal: null, aiContext: null, todos: [] };
  }
}

export async function deleteTodo(
  source: string,
  id: string,
  todoId: string,
  serverUrl: string | null = null,
): Promise<IssueNotes> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/notes/${encodeURIComponent(source)}/${encodeURIComponent(id)}/todos/${encodeURIComponent(todoId)}`,
      {
        method: "DELETE",
      },
    );
    return await res.json();
  } catch {
    return { linkedWorktreeId: null, personal: null, aiContext: null, todos: [] };
  }
}

// -- MCP Server Manager API --

export async function fetchMcpServers(
  query?: string,
  serverUrl: string | null = null,
): Promise<{ servers: McpServerSummary[]; error?: string }> {
  try {
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp-servers${params}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { servers: [], error: (body as { error?: string }).error ?? `Failed (${res.status})` };
    }
    return await res.json();
  } catch (err) {
    return {
      servers: [],
      error: err instanceof Error ? err.message : "Failed to fetch MCP servers",
    };
  }
}

export async function fetchMcpServer(
  id: string,
  serverUrl: string | null = null,
): Promise<{ server?: McpServerDetail; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp-servers/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { error?: string }).error ?? `Failed (${res.status})` };
    }
    return await res.json();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to fetch MCP server",
    };
  }
}

export async function createMcpServer(
  data: {
    id?: string;
    name: string;
    description?: string;
    tags?: string[];
    command: string;
    args?: string[];
    env?: Record<string, string>;
  },
  serverUrl: string | null = null,
): Promise<{ success: boolean; server?: McpServerDetail; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp-servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create MCP server",
    };
  }
}

export async function updateMcpServer(
  id: string,
  updates: Record<string, unknown>,
  serverUrl: string | null = null,
): Promise<{ success: boolean; server?: McpServerDetail; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp-servers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update MCP server",
    };
  }
}

export async function deleteMcpServer(
  id: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp-servers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete MCP server",
    };
  }
}

export async function scanMcpServers(
  options?: { mode?: "project" | "folder" | "device"; scanPath?: string },
  serverUrl: string | null = null,
): Promise<{ discovered: McpScanResult[]; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp-servers/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options ?? {}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        discovered: [],
        error: (body as { error?: string }).error ?? `Scan failed (${res.status})`,
      };
    }
    return await res.json();
  } catch (err) {
    return {
      discovered: [],
      error: err instanceof Error ? err.message : "Failed to scan MCP servers",
    };
  }
}

export async function importMcpServers(
  servers: Array<{
    key: string;
    name?: string;
    description?: string;
    tags?: string[];
    command: string;
    args: string[];
    env?: Record<string, string>;
    source?: string;
  }>,
  serverUrl: string | null = null,
): Promise<{ success: boolean; imported?: string[]; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp-servers/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servers }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to import MCP servers",
    };
  }
}

export async function fetchMcpServerEnv(
  serverId: string,
  serverUrl: string | null = null,
): Promise<{ env: Record<string, string> }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp-env/${encodeURIComponent(serverId)}`);
    if (!res.ok) return { env: {} };
    return await res.json();
  } catch {
    return { env: {} };
  }
}

export async function updateMcpServerEnv(
  serverId: string,
  env: Record<string, string>,
  serverUrl: string | null = null,
): Promise<{ success: boolean; env: Record<string, string>; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/mcp-env/${encodeURIComponent(serverId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      env: {},
      error: err instanceof Error ? err.message : "Failed to update env",
    };
  }
}

export async function fetchMcpDeploymentStatus(
  serverUrl: string | null = null,
): Promise<McpDeploymentStatus> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/mcp-servers/deployment-status`);
    if (!res.ok) return { status: {} };
    return await res.json();
  } catch {
    return { status: {} };
  }
}

export async function deployMcpServer(
  id: string,
  tool: string,
  scope: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/mcp-servers/${encodeURIComponent(id)}/deploy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, scope }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to deploy MCP server",
    };
  }
}

export async function undeployMcpServer(
  id: string,
  tool: string,
  scope: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/mcp-servers/${encodeURIComponent(id)}/undeploy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, scope }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to undeploy MCP server",
    };
  }
}

// -- Skills API (registry-based, multi-agent) --

export async function fetchSkills(
  serverUrl: string | null = null,
): Promise<{ skills: SkillSummary[]; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/skills`);
    return await res.json();
  } catch (err) {
    return {
      skills: [],
      error: err instanceof Error ? err.message : "Failed to fetch skills",
    };
  }
}

export async function fetchSkill(
  name: string,
  serverUrl: string | null = null,
): Promise<{ skill?: SkillDetail; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/skills/${encodeURIComponent(name)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { error?: string }).error ?? `Failed (${res.status})` };
    }
    return await res.json();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to fetch skill",
    };
  }
}

export async function createSkill(
  data: {
    name: string;
    description?: string;
    allowedTools?: string;
    context?: string;
    agent?: string;
    model?: string;
    argumentHint?: string;
    disableModelInvocation?: boolean;
    userInvocable?: boolean;
    mode?: boolean;
    instructions?: string;
  },
  serverUrl: string | null = null,
): Promise<{ success: boolean; skill?: SkillSummary; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create skill",
    };
  }
}

export async function updateSkill(
  name: string,
  updates: {
    skillMd?: string;
    referenceMd?: string;
    examplesMd?: string;
    frontmatter?: Record<string, unknown>;
  },
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/skills/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update skill",
    };
  }
}

export async function deleteSkill(
  name: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/skills/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete skill",
    };
  }
}

export async function fetchSkillDeploymentStatus(
  serverUrl: string | null = null,
): Promise<SkillDeploymentStatus> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/skills/deployment-status`);
    if (!res.ok) return { status: {} };
    return await res.json();
  } catch {
    return { status: {} };
  }
}

export async function deploySkill(
  name: string,
  agent: string,
  scope: "global" | "project",
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/skills/${encodeURIComponent(name)}/deploy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, scope }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to deploy skill",
    };
  }
}

export async function undeploySkill(
  name: string,
  agent: string,
  scope: "global" | "project",
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/skills/${encodeURIComponent(name)}/undeploy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, scope }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to undeploy skill",
    };
  }
}

export async function importSkills(
  skills: Array<{ name: string; skillPath: string }>,
  serverUrl: string | null = null,
): Promise<{ success: boolean; imported?: string[]; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/skills/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skills }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to import skills",
    };
  }
}

export async function installSkill(
  request: SkillInstallRequest,
  serverUrl: string | null = null,
): Promise<{ success: boolean; installed?: string[]; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/skills/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to install skill",
    };
  }
}

export async function checkNpxSkillsAvailable(
  serverUrl: string | null = null,
): Promise<{ available: boolean }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/skills/npx-available`);
    return await res.json();
  } catch {
    return { available: false };
  }
}

export async function fetchClaudePlugins(
  serverUrl: string | null = null,
): Promise<{ plugins: PluginSummary[]; cliAvailable?: boolean }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/claude/plugins`);
    return await res.json();
  } catch {
    return { plugins: [] };
  }
}

export async function fetchClaudePluginDetail(
  id: string,
  serverUrl: string | null = null,
): Promise<{ plugin?: PluginDetail; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/claude/plugins/${encodeURIComponent(id)}`,
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { error?: string }).error ?? `Failed (${res.status})` };
    }
    return await res.json();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch plugin detail" };
  }
}

export async function installClaudePlugin(
  ref: string,
  scope?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/claude/plugins/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, scope }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to install plugin",
    };
  }
}

export async function uninstallClaudePlugin(
  id: string,
  scope?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/claude/plugins/${encodeURIComponent(id)}/uninstall`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to uninstall plugin",
    };
  }
}

export async function enableClaudePlugin(
  id: string,
  scope?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/claude/plugins/${encodeURIComponent(id)}/enable`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to enable plugin",
    };
  }
}

export async function disableClaudePlugin(
  id: string,
  scope?: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/claude/plugins/${encodeURIComponent(id)}/disable`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to disable plugin",
    };
  }
}

export async function updateClaudePlugin(
  id: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/claude/plugins/${encodeURIComponent(id)}/update`,
      {
        method: "POST",
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update plugin",
    };
  }
}

export async function fetchAvailablePlugins(
  serverUrl: string | null = null,
): Promise<{ available: AvailablePlugin[]; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/claude/plugins/available`);
    return await res.json();
  } catch (err) {
    return {
      available: [],
      error: err instanceof Error ? err.message : "Failed to fetch available plugins",
    };
  }
}

export async function fetchPluginMarketplaces(
  serverUrl: string | null = null,
): Promise<{ marketplaces: MarketplaceSummary[]; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/claude/plugins/marketplaces`);
    return await res.json();
  } catch (err) {
    return {
      marketplaces: [],
      error: err instanceof Error ? err.message : "Failed to fetch marketplaces",
    };
  }
}

export async function addPluginMarketplace(
  source: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/claude/plugins/marketplaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add marketplace",
    };
  }
}

export async function removePluginMarketplace(
  name: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/claude/plugins/marketplaces/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to remove marketplace",
    };
  }
}

export async function updatePluginMarketplace(
  name: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/claude/plugins/marketplaces/${encodeURIComponent(name)}/update`,
      {
        method: "POST",
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update marketplace",
    };
  }
}

export async function scanSkills(
  options?: { mode?: "project" | "folder" | "device"; scanPath?: string },
  serverUrl: string | null = null,
): Promise<{ discovered: SkillScanResult[]; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/skills/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options ?? {}),
    });
    return await res.json();
  } catch (err) {
    return {
      discovered: [],
      error: err instanceof Error ? err.message : "Failed to scan skills",
    };
  }
}

// -- Hooks API --

export type HookTrigger = "pre-implementation" | "post-implementation" | "on-demand" | "custom";
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
}

export async function fetchHooksConfig(serverUrl: string | null = null): Promise<HooksConfig> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/hooks/config`);
    const data = await res.json();
    data.skills ??= [];
    return data;
  } catch {
    return { steps: [], skills: [] };
  }
}

export async function fetchEffectiveHooksConfig(
  worktreeId: string,
  serverUrl: string | null = null,
): Promise<HooksConfig> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/effective-config`,
    );
    const data = await res.json();
    data.skills ??= [];
    return data;
  } catch {
    return { steps: [], skills: [] };
  }
}

export async function saveHooksConfig(
  config: HooksConfig,
  serverUrl: string | null = null,
): Promise<{ success: boolean; config?: HooksConfig; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/hooks/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save hooks config",
    };
  }
}

export async function runHooks(
  worktreeId: string,
  trigger?: HookTrigger,
  serverUrl: string | null = null,
): Promise<PipelineRun> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trigger ? { trigger } : {}),
      },
    );
    return await res.json();
  } catch {
    return {
      id: "",
      worktreeId,
      status: "failed",
      startedAt: new Date().toISOString(),
      steps: [],
    };
  }
}

export async function runHookStep(
  worktreeId: string,
  stepId: string,
  serverUrl: string | null = null,
): Promise<StepResult> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/run/${encodeURIComponent(stepId)}`,
      { method: "POST" },
    );
    return await res.json();
  } catch {
    return {
      stepId,
      stepName: "Unknown",
      command: "",
      status: "failed",
      output: "Request failed",
    };
  }
}

export async function fetchHooksStatus(
  worktreeId: string,
  serverUrl: string | null = null,
): Promise<{ status: PipelineRun | null }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/status`,
    );
    return await res.json();
  } catch {
    return { status: null };
  }
}

// -- Agent Rules API --

export async function fetchAgentRule(
  fileId: string,
  serverUrl: string | null = null,
): Promise<{ exists: boolean; content: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/agent-rules/${encodeURIComponent(fileId)}`,
    );
    return await res.json();
  } catch {
    return { exists: false, content: "" };
  }
}

export async function saveAgentRule(
  fileId: string,
  content: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/agent-rules/${encodeURIComponent(fileId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save agent rule",
    };
  }
}

export async function deleteAgentRule(
  fileId: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/agent-rules/${encodeURIComponent(fileId)}`,
      {
        method: "DELETE",
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete agent rule",
    };
  }
}

// -- Hook Skills API --

export async function importHookSkill(
  skillName: string,
  serverUrl: string | null = null,
  trigger?: HookTrigger,
  condition?: string,
  conditionTitle?: string,
): Promise<{ success: boolean; config?: HooksConfig; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/hooks/skills/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillName, trigger, condition, conditionTitle }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to import skill" };
  }
}

export async function removeHookSkill(
  skillName: string,
  serverUrl: string | null = null,
  trigger?: HookTrigger,
): Promise<{ success: boolean; config?: HooksConfig; error?: string }> {
  try {
    const url = `${getBaseUrl(serverUrl)}/api/hooks/skills/${encodeURIComponent(skillName)}${trigger ? `?trigger=${encodeURIComponent(trigger)}` : ""}`;
    const res = await fetch(url, { method: "DELETE" });
    return await res.json();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to remove skill" };
  }
}

export async function toggleHookSkill(
  skillName: string,
  enabled: boolean,
  serverUrl: string | null = null,
  trigger?: HookTrigger,
): Promise<{ success: boolean; config?: HooksConfig; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/hooks/skills/${encodeURIComponent(skillName)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, trigger }),
      },
    );
    return await res.json();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to toggle skill" };
  }
}

export async function fetchAvailableHookSkills(
  serverUrl: string | null = null,
): Promise<{ available: Array<{ name: string; displayName: string; description: string }> }> {
  try {
    const res = await fetch(`${getBaseUrl(serverUrl)}/api/hooks/skills/available`);
    return await res.json();
  } catch {
    return { available: [] };
  }
}

export async function reportHookSkillResult(
  worktreeId: string,
  data: {
    skillName: string;
    trigger?: HookTrigger;
    success: boolean;
    summary: string;
    content?: string;
  },
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/report`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to report result",
    };
  }
}

export async function fetchHookSkillResults(
  worktreeId: string,
  serverUrl: string | null = null,
): Promise<{ results: SkillHookResult[] }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/skill-results`,
    );
    return await res.json();
  } catch {
    return { results: [] };
  }
}

export async function fetchFileContent(
  filePath: string,
  serverUrl: string | null = null,
): Promise<{ content?: string; error?: string }> {
  try {
    const res = await fetch(
      `${getBaseUrl(serverUrl)}/api/files/read?path=${encodeURIComponent(filePath)}`,
    );
    return await res.json();
  } catch {
    return { error: "Failed to fetch file" };
  }
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  category: "agent" | "worktree" | "system";
  type: string;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  detail?: string;
  worktreeId?: string;
  projectName?: string;
  metadata?: Record<string, unknown>;
  groupKey?: string;
}

export async function fetchActivity(
  serverUrl: string | null = null,
  params?: { since?: string; category?: string; limit?: number },
): Promise<{ events: ActivityEvent[] }> {
  try {
    const searchParams = new URLSearchParams();
    if (params?.since) searchParams.set("since", params.since);
    if (params?.category) searchParams.set("category", params.category);
    if (params?.limit) searchParams.set("limit", String(params.limit));

    const qs = searchParams.toString();
    const url = `${getBaseUrl(serverUrl)}/api/activity${qs ? `?${qs}` : ""}`;
    const res = await fetch(url);
    return await res.json();
  } catch {
    return { events: [] };
  }
}
