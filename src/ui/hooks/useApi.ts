import { useMemo } from "react";

import { useServerUrlOptional } from "../contexts/ServerContext";
import * as api from "./api";

// Hook that provides API functions pre-bound to the current server URL
// This makes it easy for components to use API functions without worrying about serverUrl
export function useApi() {
  const serverUrl = useServerUrlOptional();

  return useMemo(
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

      discoverPorts: () => api.discoverPorts(serverUrl),

      saveConfig: (updates: Record<string, unknown>) => api.saveConfig(updates, serverUrl),

      setupJira: (baseUrl: string, email: string, token: string) =>
        api.setupJira(baseUrl, email, token, serverUrl),

      updateJiraConfig: (
        defaultProjectKey: string,
        refreshIntervalMinutes?: number,
        dataLifecycle?: Parameters<typeof api.updateJiraConfig>[2],
        autoStartClaudeOnNewIssue?: Parameters<typeof api.updateJiraConfig>[3],
        autoStartClaudeSkipPermissions?: Parameters<typeof api.updateJiraConfig>[4],
        autoStartClaudeFocusTerminal?: Parameters<typeof api.updateJiraConfig>[5],
      ) =>
        api.updateJiraConfig(
          defaultProjectKey,
          refreshIntervalMinutes,
          dataLifecycle,
          autoStartClaudeOnNewIssue,
          autoStartClaudeSkipPermissions,
          autoStartClaudeFocusTerminal,
          serverUrl,
        ),

      disconnectJira: () => api.disconnectJira(serverUrl),

      createFromLinear: (identifier: string, branch?: string) =>
        api.createFromLinear(identifier, branch, serverUrl),

      setupLinear: (apiKey: string) => api.setupLinear(apiKey, serverUrl),

      updateLinearConfig: (
        defaultTeamKey: string,
        refreshIntervalMinutes?: number,
        dataLifecycle?: Parameters<typeof api.updateLinearConfig>[2],
        autoStartClaudeOnNewIssue?: Parameters<typeof api.updateLinearConfig>[3],
        autoStartClaudeSkipPermissions?: Parameters<typeof api.updateLinearConfig>[4],
        autoStartClaudeFocusTerminal?: Parameters<typeof api.updateLinearConfig>[5],
      ) =>
        api.updateLinearConfig(
          defaultTeamKey,
          refreshIntervalMinutes,
          dataLifecycle,
          autoStartClaudeOnNewIssue,
          autoStartClaudeSkipPermissions,
          autoStartClaudeFocusTerminal,
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

      updateCustomTask: (id: string, updates: Record<string, unknown>) =>
        api.updateCustomTask(id, updates, serverUrl),

      deleteCustomTask: (id: string) => api.deleteCustomTask(id, serverUrl),

      createWorktreeFromCustomTask: (id: string, branch?: string) =>
        api.createWorktreeFromCustomTask(id, branch, serverUrl),

      createTerminalSession: (
        worktreeId: string,
        startupCommand?: string,
        scope: "terminal" | "claude" = "terminal",
      ) =>
        api.createTerminalSession(
          worktreeId,
          undefined,
          undefined,
          startupCommand,
          scope,
          serverUrl,
        ),

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
        command: string;
        args?: string[];
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
          command: string;
          args: string[];
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

      fetchClaudePluginDetail: (id: string) => api.fetchClaudePluginDetail(id, serverUrl),

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

      fetchActiveTerminalSession: (worktreeId: string, scope: "terminal" | "claude") =>
        api.fetchActiveTerminalSession(worktreeId, scope, serverUrl),

      createActivityEvent: (event: Parameters<typeof api.createActivityEvent>[0]) =>
        api.createActivityEvent(event, serverUrl),
    }),
    [serverUrl],
  );
}
