import { useRef, useMemo } from "react";

import { reportPersistentErrorToast, showPersistentErrorToast } from "../errorToasts";
import { useServerUrlOptional } from "../contexts/ServerContext";
import * as api from "./api";

function hasErrorResult(value: unknown): value is { success?: boolean; error?: unknown } {
  if (!value || typeof value !== "object") return false;
  return "success" in value || "error" in value;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function buildStructuredErrorToast(result: { success?: boolean; error?: unknown }):
  | string
  | {
      title: string;
      description: string;
    } {
  const errorMessage =
    typeof result.error === "string" && result.error.trim().length > 0
      ? result.error.trim()
      : "Request failed";

  const details: string[] = [];
  if ("code" in result && typeof (result as { code?: unknown }).code === "string") {
    details.push(`Code: ${(result as { code: string }).code}`);
  }
  if ("detail" in result && typeof (result as { detail?: unknown }).detail === "string") {
    details.push(`Detail: ${(result as { detail: string }).detail}`);
  }
  if ("reason" in result && typeof (result as { reason?: unknown }).reason === "string") {
    details.push(`Reason: ${(result as { reason: string }).reason}`);
  }
  if ("logs" in result && Array.isArray((result as { logs?: unknown }).logs)) {
    const firstLog = (result as { logs: unknown[] }).logs.find(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
    if (firstLog) details.push(`Log: ${firstLog.trim()}`);
  }

  return details.length > 0
    ? { title: errorMessage, description: details.join(" | ") }
    : errorMessage;
}

type ApiMethod = (...args: any[]) => any;
type ApiClient<T extends Record<string, ApiMethod>> = {
  [K in keyof T]: (...args: Parameters<T[K]>) => ReturnType<T[K]>;
};

const RECOVERABLE_WORKTREE_CONFLICT_METHODS = new Set([
  "createWorktree",
  "createFromJira",
  "createFromLinear",
  "createWorktreeFromCustomTask",
]);

function shouldSuppressRecoverableWorktreeConflictToast(
  method: string,
  resolved: { success?: boolean; error?: unknown },
): boolean {
  if (!RECOVERABLE_WORKTREE_CONFLICT_METHODS.has(method)) return false;
  if (resolved.success !== false) return false;

  const worktreeId =
    "worktreeId" in resolved ? (resolved as { worktreeId?: unknown }).worktreeId : undefined;
  if (typeof worktreeId !== "string" || worktreeId.trim().length === 0) return false;

  const code = "code" in resolved ? (resolved as { code?: unknown }).code : undefined;
  if (code === "WORKTREE_EXISTS" || code === "WORKTREE_RECOVERY_REQUIRED") return true;

  const error = typeof resolved.error === "string" ? resolved.error : String(resolved.error ?? "");
  return error.includes("cannot lock ref 'refs/heads/");
}

function wrapClientWithErrorToasts<T extends Record<string, ApiMethod>>(
  client: T,
  isStale: () => boolean,
): ApiClient<T> {
  const wrappedClient = {} as ApiClient<T>;

  (Object.keys(client) as Array<keyof T>).forEach((key) => {
    const fn = client[key];
    wrappedClient[key] = ((...args: Parameters<T[typeof key]>) => {
      const result = fn(...args);
      if (!isPromiseLike(result)) return result as ReturnType<T[typeof key]>;

      return result
        .then((resolved) => {
          if (isStale()) return resolved;
          if (
            hasErrorResult(resolved) &&
            (resolved.success === false ||
              (typeof resolved.error === "string" && resolved.error.trim().length > 0)) &&
            !shouldSuppressRecoverableWorktreeConflictToast(String(key), resolved)
          ) {
            showPersistentErrorToast(buildStructuredErrorToast(resolved), {
              scope: `api:${String(key)}`,
            });
          }
          return resolved;
        })
        .catch((error) => {
          if (!isStale()) {
            reportPersistentErrorToast(error, "Request failed", { scope: `api:${String(key)}` });
          }
          throw error;
        }) as ReturnType<T[typeof key]>;
    }) as ApiClient<T>[typeof key];
  });

  return wrappedClient;
}

// Hook that provides API functions pre-bound to the current server URL
// This makes it easy for components to use API functions without worrying about serverUrl
export function useApi() {
  const serverUrl = useServerUrlOptional();
  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;

  const client = useMemo(
    () => ({
      createWorktree: (branch: string, name?: string) =>
        api.createWorktree(branch, name, serverUrl),

      recoverWorktree: (id: string, action: "reuse" | "recreate", branch?: string) =>
        api.recoverWorktree(id, action, branch, serverUrl),

      linkWorktree: (id: string, source: "jira" | "linear" | "local", issueId: string) =>
        api.linkWorktree(id, source, issueId, serverUrl),

      renameWorktree: (id: string, request: { name?: string; branch?: string }) =>
        api.renameWorktree(id, request, serverUrl),

      startWorktree: (id: string) => api.startWorktree(id, serverUrl),

      stopWorktree: (id: string) => api.stopWorktree(id, serverUrl),

      fetchOpenProjectTargets: (id: string) => api.fetchOpenProjectTargets(id, serverUrl),

      removeWorktree: (id: string) => api.removeWorktree(id, serverUrl),

      openWorktreeIn: (id: string, target: api.OpenProjectTarget) =>
        api.openWorktreeIn(id, target, serverUrl),

      createFromJira: (issueKey: string, branch?: string) =>
        api.createFromJira(issueKey, branch, serverUrl),

      commitChanges: (id: string, message: string) => api.commitChanges(id, message, serverUrl),

      pushChanges: (id: string) => api.pushChanges(id, serverUrl),

      createPullRequest: (id: string, title: string, body?: string) =>
        api.createPullRequest(id, title, body, serverUrl),

      installGitHubCli: () => api.installGitHubCli(serverUrl),

      loginGitHub: () => api.loginGitHub(serverUrl),

      logoutGitHub: () => api.logoutGitHub(serverUrl),

      createInitialCommit: () => api.createInitialCommit(serverUrl),

      createGitHubRepo: (isPrivate: boolean) => api.createGitHubRepo(isPrivate, serverUrl),

      fetchJiraIssues: (query?: string) => api.fetchJiraIssues(query, serverUrl),

      fetchLinearIssues: (query?: string) => api.fetchLinearIssues(query, serverUrl),

      fetchJiraIssueDetail: (key: string) => api.fetchJiraIssueDetail(key, serverUrl),
      fetchJiraStatusOptions: () => api.fetchJiraStatusOptions(serverUrl),
      fetchJiraIssueStatusOptions: (key: string) => api.fetchJiraIssueStatusOptions(key, serverUrl),
      fetchJiraPriorityOptions: () => api.fetchJiraPriorityOptions(serverUrl),
      fetchJiraIssueTypeOptions: (key: string) => api.fetchJiraIssueTypeOptions(key, serverUrl),
      updateJiraIssueStatus: (key: string, statusName: string) =>
        api.updateJiraIssueStatus(key, statusName, serverUrl),
      updateJiraIssuePriority: (key: string, priorityName: string) =>
        api.updateJiraIssuePriority(key, priorityName, serverUrl),
      updateJiraIssueType: (key: string, typeName: string) =>
        api.updateJiraIssueType(key, typeName, serverUrl),
      updateJiraIssueDescription: (key: string, description: string) =>
        api.updateJiraIssueDescription(key, description, serverUrl),
      updateJiraIssueSummary: (key: string, summary: string) =>
        api.updateJiraIssueSummary(key, summary, serverUrl),
      addJiraIssueComment: (key: string, comment: string) =>
        api.addJiraIssueComment(key, comment, serverUrl),
      updateJiraIssueComment: (key: string, commentId: string, comment: string) =>
        api.updateJiraIssueComment(key, commentId, comment, serverUrl),
      deleteJiraIssueComment: (key: string, commentId: string) =>
        api.deleteJiraIssueComment(key, commentId, serverUrl),

      discoverPorts: () => api.discoverPorts(serverUrl),

      saveConfig: (updates: Record<string, unknown>) => api.saveConfig(updates, serverUrl),
      fetchNgrokConnectStatus: () => api.fetchNgrokConnectStatus(serverUrl),
      enableNgrokTunnel: (regenerateUrl = false) => api.enableNgrokTunnel(regenerateUrl, serverUrl),
      disableNgrokTunnel: () => api.disableNgrokTunnel(serverUrl),
      createNgrokPairingSession: (regenerateUrl = false, next = "/") =>
        api.createNgrokPairingSession(regenerateUrl, next, serverUrl),
      fetchNgrokPairingStatus: (pairingId: string) =>
        api.fetchNgrokPairingStatus(pairingId, serverUrl),

      setupJira: (baseUrl: string, email: string, token: string) =>
        api.setupJira(baseUrl, email, token, serverUrl),

      updateJiraConfig: (
        defaultProjectKey: string,
        refreshIntervalMinutes?: number,
        dataLifecycle?: Parameters<typeof api.updateJiraConfig>[2],
        autoStartClaudeOnNewIssue?: Parameters<typeof api.updateJiraConfig>[4],
        autoStartClaudeSkipPermissions?: Parameters<typeof api.updateJiraConfig>[5],
        autoStartClaudeFocusTerminal?: Parameters<typeof api.updateJiraConfig>[6],
        autoStartAgent?: Parameters<typeof api.updateJiraConfig>[3],
        autoUpdateIssueStatusOnAgentStart?: Parameters<typeof api.updateJiraConfig>[7],
        autoUpdateIssueStatusName?: Parameters<typeof api.updateJiraConfig>[8],
      ) =>
        api.updateJiraConfig(
          defaultProjectKey,
          refreshIntervalMinutes,
          dataLifecycle,
          autoStartAgent,
          autoStartClaudeOnNewIssue,
          autoStartClaudeSkipPermissions,
          autoStartClaudeFocusTerminal,
          autoUpdateIssueStatusOnAgentStart,
          autoUpdateIssueStatusName,
          serverUrl,
        ),

      disconnectJira: () => api.disconnectJira(serverUrl),

      createFromLinear: (identifier: string, branch?: string) =>
        api.createFromLinear(identifier, branch, serverUrl),
      fetchLinearStatusOptions: () => api.fetchLinearStatusOptions(serverUrl),
      fetchLinearIssueStatusOptions: (identifier: string) =>
        api.fetchLinearIssueStatusOptions(identifier, serverUrl),
      fetchLinearPriorityOptions: () => api.fetchLinearPriorityOptions(serverUrl),
      updateLinearIssueStatus: (identifier: string, statusName: string) =>
        api.updateLinearIssueStatus(identifier, statusName, serverUrl),
      updateLinearIssuePriority: (identifier: string, priority: number) =>
        api.updateLinearIssuePriority(identifier, priority, serverUrl),
      updateLinearIssueDescription: (identifier: string, description: string) =>
        api.updateLinearIssueDescription(identifier, description, serverUrl),
      updateLinearIssueTitle: (identifier: string, title: string) =>
        api.updateLinearIssueTitle(identifier, title, serverUrl),
      addLinearIssueComment: (identifier: string, comment: string) =>
        api.addLinearIssueComment(identifier, comment, serverUrl),
      updateLinearIssueComment: (identifier: string, commentId: string, comment: string) =>
        api.updateLinearIssueComment(identifier, commentId, comment, serverUrl),
      deleteLinearIssueComment: (identifier: string, commentId: string) =>
        api.deleteLinearIssueComment(identifier, commentId, serverUrl),

      setupLinear: (apiKey: string) => api.setupLinear(apiKey, serverUrl),

      updateLinearConfig: (
        defaultTeamKey: string,
        refreshIntervalMinutes?: number,
        dataLifecycle?: Parameters<typeof api.updateLinearConfig>[2],
        autoStartClaudeOnNewIssue?: Parameters<typeof api.updateLinearConfig>[4],
        autoStartClaudeSkipPermissions?: Parameters<typeof api.updateLinearConfig>[5],
        autoStartClaudeFocusTerminal?: Parameters<typeof api.updateLinearConfig>[6],
        autoStartAgent?: Parameters<typeof api.updateLinearConfig>[3],
        autoUpdateIssueStatusOnAgentStart?: Parameters<typeof api.updateLinearConfig>[7],
        autoUpdateIssueStatusName?: Parameters<typeof api.updateLinearConfig>[8],
      ) =>
        api.updateLinearConfig(
          defaultTeamKey,
          refreshIntervalMinutes,
          dataLifecycle,
          autoStartAgent,
          autoStartClaudeOnNewIssue,
          autoStartClaudeSkipPermissions,
          autoStartClaudeFocusTerminal,
          autoUpdateIssueStatusOnAgentStart,
          autoUpdateIssueStatusName,
          serverUrl,
        ),

      disconnectLinear: () => api.disconnectLinear(serverUrl),

      fetchMcpStatus: () => api.fetchMcpStatus(serverUrl),

      setupMcpAgent: (agent: string, scope: "global" | "project") =>
        api.setupMcpAgent(agent, scope, serverUrl),

      removeMcpAgent: (agent: string, scope: "global" | "project") =>
        api.removeMcpAgent(agent, scope, serverUrl),

      fetchSetupStatus: () => api.fetchSetupStatus(serverUrl),
      fetchSetupFeatures: () => api.fetchSetupFeatures(serverUrl),

      commitSetup: (message: string) => api.commitSetup(message, serverUrl),

      detectConfig: () => api.detectConfig(serverUrl),

      initConfig: (config: Partial<api.DetectedConfig> & Record<string, unknown>) =>
        api.initConfig(config, serverUrl),

      fetchCustomTasks: () => api.fetchCustomTasks(serverUrl),

      fetchCustomTaskDetail: (id: string) => api.fetchCustomTaskDetail(id, serverUrl),

      createCustomTask: (data: {
        title: string;
        description?: string;
        priority?: string;
        labels?: string[];
      }) => api.createCustomTask(data, serverUrl),

      recoverLocalTask: (data: {
        taskId: string;
        title?: string;
        description?: string;
        priority?: "high" | "medium" | "low";
        labels?: string[];
      }) => api.recoverLocalTask(data, serverUrl),

      updateCustomTask: (id: string, updates: Record<string, unknown>) =>
        api.updateCustomTask(id, updates, serverUrl),

      deleteCustomTask: (id: string) => api.deleteCustomTask(id, serverUrl),

      createWorktreeFromCustomTask: (id: string, branch?: string) =>
        api.createWorktreeFromCustomTask(id, branch, serverUrl),

      createTerminalSession: (
        worktreeId: string,
        startupCommand?: string,
        scope: "terminal" | "claude" | "codex" | "gemini" | "opencode" = "terminal",
      ) =>
        api.createTerminalSession(
          worktreeId,
          undefined,
          undefined,
          startupCommand,
          scope,
          serverUrl,
        ),

      fetchAgentCliStatus: (agent: api.CodingAgent) => api.fetchAgentCliStatus(agent, serverUrl),

      installAgentCli: (agent: api.CodingAgent) => api.installAgentCli(agent, serverUrl),

      // Custom task attachments
      uploadTaskAttachment: (taskId: string, file: File) =>
        api.uploadTaskAttachment(taskId, file, serverUrl),
      deleteTaskAttachment: (taskId: string, filename: string) =>
        api.deleteTaskAttachment(taskId, filename, serverUrl),
      getTaskAttachmentUrl: (taskId: string, filename: string) =>
        api.getTaskAttachmentUrl(taskId, filename, serverUrl),

      // Branch name rule
      fetchBranchNameRule: (source?: string) => api.fetchBranchNameRule(source, serverUrl),

      saveBranchNameRule: (content: string | null, source?: string) =>
        api.saveBranchNameRule(content, source, serverUrl),

      fetchBranchRuleStatus: () => api.fetchBranchRuleStatus(serverUrl),

      // Commit message rule
      fetchCommitMessageRule: (source?: string) => api.fetchCommitMessageRule(source, serverUrl),

      saveCommitMessageRule: (content: string | null, source?: string) =>
        api.saveCommitMessageRule(content, source, serverUrl),

      fetchCommitRuleStatus: () => api.fetchCommitRuleStatus(serverUrl),

      // Git policy
      updateGitPolicy: (
        source: string,
        id: string,
        policy: Parameters<typeof api.updateGitPolicy>[2],
      ) => api.updateGitPolicy(source, id, policy, serverUrl),

      // Hook skill overrides
      updateHookSkills: (
        source: string,
        id: string,
        overrides: Record<string, api.HookSkillOverride>,
      ) => api.updateHookSkills(source, id, overrides, serverUrl),

      // Notes
      fetchNotes: (source: string, id: string) => api.fetchNotes(source, id, serverUrl),

      updateNotes: (
        source: string,
        id: string,
        section: "personal" | "aiContext",
        content: string,
      ) => api.updateNotes(source, id, section, content, serverUrl),

      addTodo: (source: string, id: string, text: string) =>
        api.addTodo(source, id, text, serverUrl),

      updateTodo: (
        source: string,
        id: string,
        todoId: string,
        updates: { text?: string; checked?: boolean },
      ) => api.updateTodo(source, id, todoId, updates, serverUrl),

      deleteTodo: (source: string, id: string, todoId: string) =>
        api.deleteTodo(source, id, todoId, serverUrl),

      // MCP Server Manager
      fetchMcpServers: (query?: string) => api.fetchMcpServers(query, serverUrl),

      fetchMcpServer: (id: string) => api.fetchMcpServer(id, serverUrl),

      createMcpServer: (data: {
        id?: string;
        name: string;
        description?: string;
        tags?: string[];
        command?: string;
        args?: string[];
        type?: "http" | "sse";
        url?: string;
        env?: Record<string, string>;
      }) => api.createMcpServer(data, serverUrl),

      updateMcpServer: (id: string, updates: Record<string, unknown>) =>
        api.updateMcpServer(id, updates, serverUrl),

      deleteMcpServer: (id: string) => api.deleteMcpServer(id, serverUrl),

      scanMcpServers: (options?: { mode?: "project" | "folder" | "device"; scanPath?: string }) =>
        api.scanMcpServers(options, serverUrl),

      importMcpServers: (
        servers: Array<{
          key: string;
          name?: string;
          description?: string;
          tags?: string[];
          command?: string;
          args?: string[];
          type?: "http" | "sse";
          url?: string;
          env?: Record<string, string>;
          source?: string;
        }>,
      ) => api.importMcpServers(servers, serverUrl),

      fetchMcpServerEnv: (serverId: string) => api.fetchMcpServerEnv(serverId, serverUrl),

      updateMcpServerEnv: (serverId: string, env: Record<string, string>) =>
        api.updateMcpServerEnv(serverId, env, serverUrl),

      fetchMcpDeploymentStatus: () => api.fetchMcpDeploymentStatus(serverUrl),

      deployMcpServer: (id: string, tool: string, scope: string) =>
        api.deployMcpServer(id, tool, scope, serverUrl),

      undeployMcpServer: (id: string, tool: string, scope: string) =>
        api.undeployMcpServer(id, tool, scope, serverUrl),

      // Skills (registry-based, multi-agent)
      fetchSkills: () => api.fetchSkills(serverUrl),

      fetchSkill: (name: string) => api.fetchSkill(name, serverUrl),

      createSkill: (data: Parameters<typeof api.createSkill>[0]) =>
        api.createSkill(data, serverUrl),

      updateSkill: (
        name: string,
        updates: {
          skillMd?: string;
          referenceMd?: string;
          examplesMd?: string;
          frontmatter?: Record<string, unknown>;
        },
      ) => api.updateSkill(name, updates, serverUrl),

      deleteSkill: (name: string) => api.deleteSkill(name, serverUrl),

      fetchSkillDeploymentStatus: () => api.fetchSkillDeploymentStatus(serverUrl),

      deploySkill: (name: string, agent: string, scope: "global" | "project") =>
        api.deploySkill(name, agent, scope, serverUrl),

      undeploySkill: (name: string, agent: string, scope: "global" | "project") =>
        api.undeploySkill(name, agent, scope, serverUrl),

      importSkills: (skills: Array<{ name: string; skillPath: string }>) =>
        api.importSkills(skills, serverUrl),

      installSkill: (request: Parameters<typeof api.installSkill>[0]) =>
        api.installSkill(request, serverUrl),

      checkNpxSkillsAvailable: () => api.checkNpxSkillsAvailable(serverUrl),

      fetchClaudePlugins: () => api.fetchClaudePlugins(serverUrl),

      fetchClaudeAgents: () => api.fetchClaudeAgents(serverUrl),
      fetchCustomClaudeAgents: () => api.fetchCustomClaudeAgents(serverUrl),

      fetchClaudePluginDetail: (id: string) => api.fetchClaudePluginDetail(id, serverUrl),

      fetchClaudeAgentDetail: (id: string) => api.fetchClaudeAgentDetail(id, serverUrl),

      fetchCustomClaudeAgentDetail: (id: string) => api.fetchCustomClaudeAgentDetail(id, serverUrl),

      createCustomClaudeAgent: (data: {
        name: string;
        description?: string;
        tools?: string;
        model?: string;
        instructions?: string;
        scope?: "global" | "project";
        deployAgents?: string[];
      }) => api.createCustomClaudeAgent(data, serverUrl),

      deleteCustomClaudeAgent: (id: string) => api.deleteCustomClaudeAgent(id, serverUrl),

      updateCustomClaudeAgent: (id: string, data: { content: string }) =>
        api.updateCustomClaudeAgent(id, data, serverUrl),

      installClaudePlugin: (ref: string, scope?: string) =>
        api.installClaudePlugin(ref, scope, serverUrl),

      uninstallClaudePlugin: (id: string, scope?: string) =>
        api.uninstallClaudePlugin(id, scope, serverUrl),

      enableClaudePlugin: (id: string, scope?: string) =>
        api.enableClaudePlugin(id, scope, serverUrl),

      disableClaudePlugin: (id: string, scope?: string) =>
        api.disableClaudePlugin(id, scope, serverUrl),

      updateClaudePlugin: (id: string) => api.updateClaudePlugin(id, serverUrl),

      fetchAvailablePlugins: () => api.fetchAvailablePlugins(serverUrl),

      fetchPluginMarketplaces: () => api.fetchPluginMarketplaces(serverUrl),

      addPluginMarketplace: (source: string) => api.addPluginMarketplace(source, serverUrl),

      removePluginMarketplace: (name: string) => api.removePluginMarketplace(name, serverUrl),

      updatePluginMarketplace: (name: string) => api.updatePluginMarketplace(name, serverUrl),

      scanSkills: (options?: { mode?: "project" | "folder" | "device"; scanPath?: string }) =>
        api.scanSkills(options, serverUrl),

      scanClaudeAgents: (options?: { mode?: "project" | "folder" | "device"; scanPath?: string }) =>
        api.scanClaudeAgents(options, serverUrl),

      importClaudeAgents: (
        agents: Array<{
          name: string;
          agentPath: string;
          scope?: "global" | "project";
          deployAgents?: string[];
        }>,
        scope?: "global" | "project",
        deployAgents?: string[],
      ) => api.importClaudeAgents(agents, scope, deployAgents, serverUrl),

      deployCustomClaudeAgent: (id: string, agent: string, scope: "global" | "project") =>
        api.deployCustomClaudeAgent(id, agent, scope, serverUrl),

      undeployCustomClaudeAgent: (id: string, agent: string, scope: "global" | "project") =>
        api.undeployCustomClaudeAgent(id, agent, scope, serverUrl),

      deployPluginClaudeAgent: (id: string, agent: string, scope: "global" | "project") =>
        api.deployPluginClaudeAgent(id, agent, scope, serverUrl),

      undeployPluginClaudeAgent: (id: string, agent: string, scope: "global" | "project") =>
        api.undeployPluginClaudeAgent(id, agent, scope, serverUrl),

      // Hooks
      fetchHooksConfig: () => api.fetchHooksConfig(serverUrl),

      saveHooksConfig: (config: api.HooksConfig) => api.saveHooksConfig(config, serverUrl),

      runHooks: (worktreeId: string, trigger?: api.HookTrigger) =>
        api.runHooks(worktreeId, trigger, serverUrl),

      runHookStep: (worktreeId: string, stepId: string) =>
        api.runHookStep(worktreeId, stepId, serverUrl),

      fetchHooksStatus: (worktreeId: string) => api.fetchHooksStatus(worktreeId, serverUrl),

      // Agent Rules
      fetchAgentRule: (fileId: string) => api.fetchAgentRule(fileId, serverUrl),

      saveAgentRule: (fileId: string, content: string) =>
        api.saveAgentRule(fileId, content, serverUrl),

      deleteAgentRule: (fileId: string) => api.deleteAgentRule(fileId, serverUrl),

      // Hook Skills
      importHookSkill: (
        skillName: string,
        trigger?: api.HookTrigger,
        condition?: string,
        conditionTitle?: string,
      ) => api.importHookSkill(skillName, serverUrl, trigger, condition, conditionTitle),

      removeHookSkill: (skillName: string, trigger?: api.HookTrigger) =>
        api.removeHookSkill(skillName, serverUrl, trigger),

      toggleHookSkill: (skillName: string, enabled: boolean, trigger?: api.HookTrigger) =>
        api.toggleHookSkill(skillName, enabled, serverUrl, trigger),

      fetchAvailableHookSkills: () => api.fetchAvailableHookSkills(serverUrl),

      reportHookSkillResult: (
        worktreeId: string,
        data: Parameters<typeof api.reportHookSkillResult>[1],
      ) => api.reportHookSkillResult(worktreeId, data, serverUrl),

      fetchHookSkillResults: (worktreeId: string) =>
        api.fetchHookSkillResults(worktreeId, serverUrl),

      fetchFileContent: (filePath: string) => api.fetchFileContent(filePath, serverUrl),

      fetchActiveTerminalSession: (
        worktreeId: string,
        scope: "terminal" | "claude" | "codex" | "gemini" | "opencode",
      ) => api.fetchActiveTerminalSession(worktreeId, scope, serverUrl),

      fetchRestorableAgentSessions: (worktreeId: string, agent: api.RestorableAgent) =>
        api.fetchRestorableAgentSessions(worktreeId, agent, serverUrl),

      createActivityEvent: (event: Parameters<typeof api.createActivityEvent>[0]) =>
        api.createActivityEvent(event, serverUrl),

      fetchOpsLogs: (params?: Parameters<typeof api.fetchOpsLogs>[1]) =>
        api.fetchOpsLogs(serverUrl, params),

      createOpsLogEvent: (event: Parameters<typeof api.createOpsLogEvent>[0]) =>
        api.createOpsLogEvent(event, serverUrl),

      // Retention impact
      fetchRetentionImpact: (
        target: "activity" | "opsLog",
        config: { retentionDays?: number; maxSizeMB?: number },
      ) => api.fetchRetentionImpact(target, config, serverUrl),

      // Local config
      fetchLocalConfig: () => api.fetchLocalConfig(serverUrl),

      saveLocalConfig: (updates: Record<string, unknown>) =>
        api.saveLocalConfig(updates, serverUrl),
    }),
    [serverUrl],
  );

  return useMemo(() => {
    const boundServerUrl = serverUrl;
    return wrapClientWithErrorToasts(client, () => serverUrlRef.current !== boundServerUrl);
  }, [client, serverUrl]);
}
