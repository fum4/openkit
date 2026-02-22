import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";

import { APP_NAME, CONFIG_DIR_NAME } from "./constants";

export { MCP_INSTRUCTIONS } from "./instructions";
import { formatCommitMessage } from "./server/commit-message";
import { resolveGitPolicy } from "./server/git-policy";
import type { WorktreeManager } from "./server/manager";
import type { NotesManager } from "./server/notes-manager";
import { generateTaskMd, writeTaskMd } from "./server/task-context";
import type { TaskContextData } from "./server/task-context";
import type { HookStep, HookTrigger } from "./server/types";
import type { HooksManager } from "./server/verification-manager";
import type { ActivityLog } from "./server/activity-log";
import { ACTIVITY_TYPES } from "./server/activity-event";

export interface ActionParam {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

export interface Action {
  name: string;
  description: string;
  params: Record<string, ActionParam>;
  handler: (ctx: ActionContext, params: Record<string, unknown>) => Promise<unknown>;
}

export interface ActionContext {
  manager: WorktreeManager;
  notesManager: NotesManager;
  hooksManager?: HooksManager;
  activityLog?: ActivityLog;
}

function findWorktreeOrThrow(ctx: ActionContext, id: string) {
  const worktrees = ctx.manager.getWorktrees();
  const wt = worktrees.find((w) => w.id === id);
  if (!wt) throw new Error(`Worktree "${id}" not found`);
  return wt;
}

function normalizeHookTrigger(value: unknown): HookTrigger {
  if (
    value === "pre-implementation" ||
    value === "post-implementation" ||
    value === "custom" ||
    value === "on-demand" ||
    value === "worktree-created" ||
    value === "worktree-removed"
  ) {
    return value;
  }
  return "post-implementation";
}

function matchesTrigger(step: HookStep, trigger: HookTrigger): boolean {
  if (trigger === "post-implementation") {
    return step.trigger === "post-implementation" || !step.trigger;
  }
  return step.trigger === trigger;
}

function isRunnableStep(step: HookStep): boolean {
  const isPrompt = step.kind === "prompt" || (!!step.prompt && !step.command?.trim());
  return !isPrompt && !!step.command?.trim();
}

function formatHookTriggerLabel(trigger: HookTrigger): string {
  switch (trigger) {
    case "pre-implementation":
      return "Pre-Implementation";
    case "post-implementation":
      return "Post-Implementation";
    case "custom":
      return "Custom";
    case "on-demand":
      return "On-Demand";
    case "worktree-created":
      return "Worktree Created";
    case "worktree-removed":
      return "Worktree Removed";
  }
}

const USER_ACTION_HINT =
  /\b(approve|approval|confirm|confirmation|yes\/no|y\/n|permission|authorize|authorise|need your|need you|waiting for (your )?(input|confirmation|approval|answer|response|reply)|user input|blocked|respond|reply)\b/i;

export const actions: Action[] = [
  // -- Issue browsing --
  {
    name: "list_jira_issues",
    description:
      "List your assigned Jira issues (unresolved). Optionally search by text. Use this when the user wants to see their issues or find something to work on.",
    params: {
      query: { type: "string", description: "Optional text search to filter issues" },
    },
    handler: async (ctx, params) => {
      const query = params.query as string | undefined;
      return ctx.manager.listJiraIssues(query);
    },
  },
  {
    name: "get_jira_issue",
    description:
      "Get full details of a Jira issue including description and comments. Checks locally cached data first, only fetches from Jira API if not found locally. Use this to show issue details before creating a worktree.",
    params: {
      issueKey: {
        type: "string",
        description: "Jira issue key (e.g. PROJ-123 or just 123 if default project is configured)",
        required: true,
      },
    },
    handler: async (ctx, params) => {
      const issueKey = params.issueKey as string;
      // Check local cache first
      const issueFile = path.join(
        ctx.manager.getConfigDir(),
        CONFIG_DIR_NAME,
        "issues",
        "jira",
        issueKey,
        "issue.json",
      );
      if (existsSync(issueFile)) {
        try {
          return JSON.parse(readFileSync(issueFile, "utf-8"));
        } catch {
          /* fall through to API */
        }
      }
      return ctx.manager.getJiraIssue(issueKey);
    },
  },
  {
    name: "list_linear_issues",
    description:
      "List your assigned Linear issues (open/in progress). Optionally search by text. Use this when the user wants to see their issues or find something to work on.",
    params: {
      query: { type: "string", description: "Optional text search to filter issues" },
    },
    handler: async (ctx, params) => {
      const query = params.query as string | undefined;
      return ctx.manager.listLinearIssues(query);
    },
  },
  {
    name: "get_linear_issue",
    description:
      "Get full details of a Linear issue including description. Checks locally cached data first, only fetches from Linear API if not found locally. Use this to show issue details before creating a worktree.",
    params: {
      identifier: {
        type: "string",
        description:
          "Linear issue identifier (e.g. ENG-123 or just 123 if default team is configured)",
        required: true,
      },
    },
    handler: async (ctx, params) => {
      const identifier = params.identifier as string;
      // Check local cache first
      const issueFile = path.join(
        ctx.manager.getConfigDir(),
        CONFIG_DIR_NAME,
        "issues",
        "linear",
        identifier,
        "issue.json",
      );
      if (existsSync(issueFile)) {
        try {
          return JSON.parse(readFileSync(issueFile, "utf-8"));
        } catch {
          /* fall through to API */
        }
      }
      return ctx.manager.getLinearIssue(identifier);
    },
  },

  // -- Worktree management --
  {
    name: "list_worktrees",
    description:
      "List all worktrees with their status, branch, ports, and git/PR info. Use this to see existing worktrees before creating new ones.",
    params: {},
    handler: async (ctx) => ctx.manager.getWorktrees(),
  },
  {
    name: "create_worktree",
    description:
      "Create a new git worktree from a branch name. Use create_from_jira or create_from_linear instead when the user provides an issue key.",
    params: {
      branch: { type: "string", description: "Git branch name for the worktree", required: true },
      name: {
        type: "string",
        description: "Optional worktree directory name (defaults to sanitized branch name)",
      },
    },
    handler: async (ctx, params) => {
      const branch = params.branch as string;
      const name = params.name as string | undefined;
      return ctx.manager.createWorktree({ branch, name });
    },
  },
  {
    name: "create_from_jira",
    description:
      'Create a worktree from a Jira issue key. Fetches the issue, saves task data locally, and creates a worktree with the issue key as branch name. The user might say "jira 123", "PROJ-123", or just a number.',
    params: {
      issueKey: {
        type: "string",
        description: "Jira issue key (e.g. PROJ-123 or just 123 if default project is configured)",
        required: true,
      },
    },
    handler: async (ctx, params) => {
      const issueKey = params.issueKey as string;
      return ctx.manager.createWorktreeFromJira(issueKey);
    },
  },
  {
    name: "create_from_linear",
    description:
      'Create a worktree from a Linear issue identifier. Fetches the issue, saves task data locally, and creates a worktree with the identifier as branch name. The user might say "linear 42", "ENG-42", or just a number.',
    params: {
      identifier: {
        type: "string",
        description:
          "Linear issue identifier (e.g. ENG-123 or just 123 if default team is configured)",
        required: true,
      },
    },
    handler: async (ctx, params) => {
      const identifier = params.identifier as string;
      return ctx.manager.createWorktreeFromLinear(identifier);
    },
  },
  {
    name: "start_worktree",
    description: "Start the dev server in a worktree (allocates port offset, spawns process)",
    params: {
      id: { type: "string", description: "Worktree ID", required: true },
    },
    handler: async (ctx, params) => {
      const id = params.id as string;
      findWorktreeOrThrow(ctx, id);
      return ctx.manager.startWorktree(id);
    },
  },
  {
    name: "stop_worktree",
    description: "Stop the running dev server in a worktree",
    params: {
      id: { type: "string", description: "Worktree ID", required: true },
    },
    handler: async (ctx, params) => {
      const id = params.id as string;
      return ctx.manager.stopWorktree(id);
    },
  },
  {
    name: "remove_worktree",
    description:
      "Remove a worktree (stops it first if running, then deletes the directory and git worktree reference)",
    params: {
      id: { type: "string", description: "Worktree ID", required: true },
    },
    handler: async (ctx, params) => {
      const id = params.id as string;
      return ctx.manager.removeWorktree(id);
    },
  },
  {
    name: "get_logs",
    description: "Get recent output logs from a running worktree (up to 100 lines)",
    params: {
      id: { type: "string", description: "Worktree ID", required: true },
    },
    handler: async (ctx, params) => {
      const id = params.id as string;
      return { logs: ctx.manager.getLogs(id) };
    },
  },

  // -- Git operations --
  {
    name: "commit",
    description:
      "Stage all changes and commit in a worktree (requires GitHub integration). Subject to agent git policy — call get_git_policy first to check.",
    params: {
      id: { type: "string", description: "Worktree ID", required: true },
      message: { type: "string", description: "Commit message", required: true },
    },
    handler: async (ctx, params) => {
      const id = params.id as string;
      const message = params.message as string;

      const policy = resolveGitPolicy("commit", id, ctx.manager.getConfig(), ctx.notesManager);
      if (!policy.allowed) {
        return { success: false, error: policy.reason };
      }

      const ghManager = ctx.manager.getGitHubManager();
      if (!ghManager?.isAvailable()) {
        return { success: false, error: "GitHub integration not available" };
      }

      const linkMap = ctx.notesManager.buildWorktreeLinkMap();
      const linked = linkMap.get(id);
      const formattedMessage = await formatCommitMessage(ctx.manager.getConfigDir(), {
        message,
        issueId: linked?.issueId ?? null,
        source: linked?.source ?? null,
      });

      const wt = findWorktreeOrThrow(ctx, id);
      return ghManager.commitAll(wt.path, id, formattedMessage);
    },
  },
  {
    name: "push",
    description:
      "Push commits in a worktree to the remote (requires GitHub integration). Subject to agent git policy — call get_git_policy first to check.",
    params: {
      id: { type: "string", description: "Worktree ID", required: true },
    },
    handler: async (ctx, params) => {
      const id = params.id as string;

      const policy = resolveGitPolicy("push", id, ctx.manager.getConfig(), ctx.notesManager);
      if (!policy.allowed) {
        return { success: false, error: policy.reason };
      }

      const ghManager = ctx.manager.getGitHubManager();
      if (!ghManager?.isAvailable()) {
        return { success: false, error: "GitHub integration not available" };
      }
      const wt = findWorktreeOrThrow(ctx, id);
      return ghManager.pushBranch(wt.path, id);
    },
  },
  {
    name: "create_pr",
    description:
      "Create a GitHub pull request for a worktree branch (requires GitHub integration). Subject to agent git policy (follows push policy) — call get_git_policy first to check.",
    params: {
      id: { type: "string", description: "Worktree ID", required: true },
      title: { type: "string", description: "PR title", required: true },
      body: { type: "string", description: "PR body/description" },
    },
    handler: async (ctx, params) => {
      const id = params.id as string;
      const title = params.title as string;
      const body = params.body as string | undefined;

      const policy = resolveGitPolicy("create_pr", id, ctx.manager.getConfig(), ctx.notesManager);
      if (!policy.allowed) {
        return { success: false, error: policy.reason };
      }

      const ghManager = ctx.manager.getGitHubManager();
      if (!ghManager?.isAvailable()) {
        return { success: false, error: "GitHub integration not available" };
      }
      const wt = findWorktreeOrThrow(ctx, id);
      return ghManager.createPR(wt.path, id, title, body);
    },
  },
  {
    name: "get_config",
    description: `Get the current ${APP_NAME} configuration and project name`,
    params: {},
    handler: async (ctx) => ({
      config: ctx.manager.getConfig(),
      projectName: ctx.manager.getProjectName(),
    }),
  },

  // -- Notes --
  {
    name: "read_issue_notes",
    description:
      "Read AI context and todo checklist for a worktree or issue. These are user-defined directions that take priority over the original task description when they conflict. Read the task first (via get_task_context or TASK.md) to understand what the issue is about, then use this to get overriding directions and todos.",
    params: {
      worktreeId: { type: "string", description: "Worktree ID to find linked issue notes for" },
      source: {
        type: "string",
        description: 'Issue source: "jira", "linear", or "local" (use with issueId)',
      },
      issueId: { type: "string", description: "Issue ID (use with source)" },
    },
    handler: async (ctx, params) => {
      const worktreeId = params.worktreeId as string | undefined;
      const source = params.source as string | undefined;
      const issueId = params.issueId as string | undefined;

      if (worktreeId) {
        // Find linked issue for this worktree
        const linkMap = ctx.notesManager.buildWorktreeLinkMap();
        const linked = linkMap.get(worktreeId);
        if (!linked) {
          return { error: `No linked issue found for worktree "${worktreeId}"` };
        }
        const notes = ctx.notesManager.loadNotes(linked.source, linked.issueId);
        return {
          source: linked.source,
          issueId: linked.issueId,
          aiContext: notes.aiContext?.content ?? null,
          todos: notes.todos,
        };
      }

      if (source && issueId) {
        if (!["jira", "linear", "local"].includes(source)) {
          return { error: 'Invalid source (must be "jira", "linear", or "local")' };
        }
        const notes = ctx.notesManager.loadNotes(source as "jira" | "linear" | "local", issueId);
        return {
          source,
          issueId,
          aiContext: notes.aiContext?.content ?? null,
          todos: notes.todos,
        };
      }

      return { error: "Provide either worktreeId or both source and issueId" };
    },
  },

  // -- Task context --
  {
    name: "get_task_context",
    description:
      "Get full task context for a worktree. Returns issue details, description, comments, AI context directions, todo checklist, and worktree path. Call this before starting work to understand the full scope and see which todos need to be completed. Also regenerates TASK.md.",
    params: {
      worktreeId: { type: "string", description: "Worktree ID (e.g., PROJ-123)", required: true },
    },
    handler: async (ctx, params) => {
      const worktreeId = params.worktreeId as string;

      // Find linked issue via buildWorktreeLinkMap()
      const linkMap = ctx.notesManager.buildWorktreeLinkMap();
      const linked = linkMap.get(worktreeId);

      if (!linked) {
        return {
          error: `No linked issue found for worktree "${worktreeId}". This worktree may have been created from a plain branch.`,
        };
      }

      const { source, issueId } = linked;
      const configDir = ctx.manager.getConfigDir();
      const issuesDir = path.join(configDir, CONFIG_DIR_NAME, "issues");

      // Load notes (personal notes are private — not exposed to agents)
      const notes = ctx.notesManager.loadNotes(source, issueId);
      const aiContext = notes.aiContext?.content ?? null;

      // Load issue data based on source
      let taskData: TaskContextData | null = null;

      if (source === "local") {
        const taskFile = path.join(issuesDir, "local", issueId, "task.json");
        if (existsSync(taskFile)) {
          try {
            const raw = JSON.parse(readFileSync(taskFile, "utf-8"));

            // Load local attachments from filesystem
            const attDir = path.join(issuesDir, "local", issueId, "attachments");
            let localAttachments: TaskContextData["attachments"];
            if (existsSync(attDir)) {
              const metaFile = path.join(attDir, ".meta.json");
              const meta: Record<string, string> = existsSync(metaFile)
                ? JSON.parse(readFileSync(metaFile, "utf-8"))
                : {};
              localAttachments = readdirSync(attDir)
                .filter((f) => !f.startsWith(".") && statSync(path.join(attDir, f)).isFile())
                .map((f) => ({
                  filename: f,
                  localPath: path.join(attDir, f),
                  mimeType: meta[f] || "application/octet-stream",
                }));
              if (localAttachments.length === 0) localAttachments = undefined;
            }

            taskData = {
              source: "local",
              issueId,
              identifier: issueId,
              title: raw.title ?? "",
              description: raw.description ?? "",
              status: raw.status ?? "unknown",
              url: "",
              attachments: localAttachments,
            };
          } catch {
            /* ignore */
          }
        }
      } else {
        const issueFile = path.join(issuesDir, source, issueId, "issue.json");
        if (existsSync(issueFile)) {
          try {
            const raw = JSON.parse(readFileSync(issueFile, "utf-8"));
            if (source === "jira") {
              taskData = {
                source: "jira",
                issueId,
                identifier: raw.key ?? worktreeId,
                title: raw.summary ?? "",
                description: raw.description ?? "",
                status: raw.status ?? "Unknown",
                url: raw.url ?? "",
                comments: raw.comments?.slice(0, 10),
                attachments: raw.attachments
                  ?.filter((a: { localPath?: string }) => a.localPath)
                  .map((a: { filename: string; localPath: string; mimeType: string }) => ({
                    filename: a.filename,
                    localPath: a.localPath,
                    mimeType: a.mimeType,
                  })),
              };
            } else if (source === "linear") {
              taskData = {
                source: "linear",
                issueId,
                identifier: raw.identifier ?? worktreeId,
                title: raw.title ?? "",
                description: raw.description ?? "",
                status: raw.status ?? raw.state?.name ?? "Unknown",
                url: raw.url ?? "",
                comments: raw.comments?.map(
                  (c: { author?: string; body?: string; createdAt?: string }) => ({
                    author: c.author ?? "Unknown",
                    body: c.body ?? "",
                    created: c.createdAt,
                  }),
                ),
                linkedResources: raw.attachments?.map(
                  (a: { title?: string; url?: string; sourceType?: string }) => ({
                    title: a.title ?? "",
                    url: a.url ?? "",
                    sourceType: a.sourceType,
                  }),
                ),
              };
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (!taskData) {
        return {
          worktreeId,
          source,
          issueId,
          aiContext,
          todos: notes.todos,
          error: "Issue data file not found on disk. Notes are still available.",
        };
      }

      // Find worktree path and regenerate TASK.md
      const wt = ctx.manager.getWorktrees().find((w) => w.id === worktreeId);
      const worktreePath = wt?.path ?? null;

      if (worktreePath && existsSync(worktreePath)) {
        try {
          // Load hooks data for TASK.md
          let hooksInfo = null;
          if (ctx.hooksManager) {
            const hConfig = ctx.hooksManager.getConfig();
            const effectiveSkills = ctx.hooksManager.getEffectiveSkills(
              worktreeId,
              ctx.notesManager,
            );
            hooksInfo = { checks: hConfig.steps, skills: effectiveSkills };
          }
          const content = generateTaskMd(taskData, aiContext, notes.todos, hooksInfo);
          writeTaskMd(worktreePath, content);
        } catch {
          /* non-critical */
        }
      }

      const issueDir = path.join(configDir, CONFIG_DIR_NAME, "issues", source, issueId);

      return {
        worktreeId,
        worktreePath,
        issueDir,
        task: taskData,
        aiContext,
        todos: notes.todos,
      };
    },
  },

  // -- Todos --
  {
    name: "update_todo",
    description:
      'Add, toggle, or delete a todo checklist item on an issue. IMPORTANT: As you complete each sub-task, call this with action="toggle" to check it off — the user monitors your progress through these checkboxes in real-time.',
    params: {
      source: {
        type: "string",
        description: 'Issue source: "jira", "linear", or "local"',
        required: true,
      },
      issueId: { type: "string", description: "Issue ID", required: true },
      action: {
        type: "string",
        description: 'Action to perform: "add", "toggle", or "delete"',
        required: true,
      },
      todoId: { type: "string", description: "Todo ID (required for toggle and delete)" },
      text: { type: "string", description: "Todo text (required for add)" },
    },
    handler: async (ctx, params) => {
      const source = params.source as string;
      const issueId = params.issueId as string;
      const action = params.action as string;
      const todoId = params.todoId as string | undefined;
      const text = params.text as string | undefined;

      if (!["jira", "linear", "local"].includes(source)) {
        return { error: 'Invalid source (must be "jira", "linear", or "local")' };
      }
      if (!["add", "toggle", "delete"].includes(action)) {
        return { error: 'Invalid action (must be "add", "toggle", or "delete")' };
      }

      const src = source as "jira" | "linear" | "local";

      if (action === "add") {
        if (!text) return { error: "Text is required for add action" };
        const notes = ctx.notesManager.addTodo(src, issueId, text);
        return { success: true, todos: notes.todos };
      }

      if (!todoId) return { error: "todoId is required for toggle and delete actions" };

      if (action === "toggle") {
        const currentNotes = ctx.notesManager.loadNotes(src, issueId);
        const todo = currentNotes.todos.find((t) => t.id === todoId);
        if (!todo) return { error: `Todo "${todoId}" not found` };
        const notes = ctx.notesManager.updateTodo(src, issueId, todoId, { checked: !todo.checked });
        return { success: true, todos: notes.todos };
      }

      // delete
      const notes = ctx.notesManager.deleteTodo(src, issueId, todoId);
      return { success: true, todos: notes.todos };
    },
  },

  // -- Notifications --
  {
    name: "notify",
    description:
      "Send a status update to the openkit activity feed. Use to keep the user informed about progress on long-running tasks. If you are blocked waiting for user input, you MUST call this with requiresUserAction=true.",
    params: {
      message: { type: "string", description: "Status message to display", required: true },
      severity: {
        type: "string",
        description: 'Severity level: "info" (default), "success", "warning", or "error"',
      },
      worktreeId: { type: "string", description: "Related worktree ID (optional)" },
      requiresUserAction: {
        type: "boolean",
        description:
          "Set true when user input is needed to continue. This is required when blocked waiting for user input. These notifications appear in a dedicated action-required section.",
      },
    },
    handler: async (ctx, params) => {
      const message = params.message as string;
      const severity = (params.severity as string) || "info";
      const worktreeId = params.worktreeId as string | undefined;
      const requiresUserActionRaw = params.requiresUserAction as boolean | string | undefined;
      const requiresUserAction =
        requiresUserActionRaw === true ||
        requiresUserActionRaw === "true" ||
        USER_ACTION_HINT.test(message);
      const eventType = requiresUserAction ? ACTIVITY_TYPES.AGENT_AWAITING_INPUT : ACTIVITY_TYPES.NOTIFY;
      const projectName = ctx.manager.getProjectName() ?? undefined;

      if (!["info", "success", "warning", "error"].includes(severity)) {
        return {
          success: false,
          error: 'Invalid severity (must be "info", "success", "warning", or "error")',
        };
      }

      if (ctx.activityLog) {
        ctx.activityLog.addEvent({
          category: "agent",
          type: eventType,
          severity: severity as "info" | "success" | "warning" | "error",
          title: message,
          worktreeId,
          projectName,
          metadata: requiresUserAction
            ? { requiresUserAction: true, awaitingUserInput: true, source: "mcp" }
            : undefined,
        });
      }

      return { success: true };
    },
  },

  // -- Git policy --
  {
    name: "get_git_policy",
    description:
      "Check whether agent git operations (commit, push, create_pr) are allowed for a worktree. Call this before attempting any git operation to avoid errors.",
    params: {
      id: { type: "string", description: "Worktree ID", required: true },
    },
    handler: async (ctx, params) => {
      const id = params.id as string;
      const config = ctx.manager.getConfig();
      return {
        commit: resolveGitPolicy("commit", id, config, ctx.notesManager),
        push: resolveGitPolicy("push", id, config, ctx.notesManager),
        createPr: resolveGitPolicy("create_pr", id, config, ctx.notesManager),
      };
    },
  },

  // -- Hooks (Post-Implementation) --
  {
    name: "get_hooks_config",
    description:
      "Get the hooks configuration — pipeline check steps (shell commands) and hook skills (agent-driven analysis). Both are used to validate work in worktrees after implementation.",
    params: {},
    handler: async (ctx) => {
      if (!ctx.hooksManager) return { error: "Hooks manager not available" };
      return ctx.hooksManager.getConfig();
    },
  },
  {
    name: "run_hooks",
    description:
      "Run all hook pipeline steps for a worktree in parallel. Each step is a shell command (e.g. lint, typecheck, build). Returns results inline.",
    params: {
      worktreeId: { type: "string", description: "Worktree ID to run hooks on", required: true },
      trigger: {
        type: "string",
        description:
          'Optional hook trigger to run: "pre-implementation", "post-implementation" (default), "custom", "on-demand", "worktree-created", or "worktree-removed".',
      },
    },
    handler: async (ctx, params) => {
      if (!ctx.hooksManager) return { error: "Hooks manager not available" };
      const worktreeId = params.worktreeId as string;
      const trigger = normalizeHookTrigger(params.trigger);
      const projectName = ctx.manager.getProjectName() ?? undefined;
      const groupKey = `hooks:${worktreeId}:${trigger}`;

      const runnableSteps = ctx.hooksManager
        .getConfig()
        .steps.filter(
          (step) => step.enabled !== false && matchesTrigger(step, trigger) && isRunnableStep(step),
        )
        .map((step) => ({ stepId: step.id, stepName: step.name, command: step.command }));

      ctx.activityLog?.addEvent({
        category: "agent",
        type: "hooks_started",
        severity: "info",
        title: `${formatHookTriggerLabel(trigger)} hooks started`,
        worktreeId,
        projectName,
        groupKey,
        metadata: {
          trigger,
          commandResults: runnableSteps.map((step) => ({ ...step, status: "running" })),
        },
      });

      const run = await ctx.hooksManager.runAll(worktreeId, trigger);
      const runnableStepIds = new Set(runnableSteps.map((step) => step.stepId));
      const triggerSteps = run.steps.filter((step) => runnableStepIds.has(step.stepId));
      const failedCount = triggerSteps.filter((step) => step.status === "failed").length;
      const severity = failedCount > 0 || run.status === "failed" ? "error" : "success";
      const detail =
        triggerSteps.length === 0
          ? "No runnable command hooks configured for this trigger."
          : failedCount > 0
            ? `${failedCount} of ${triggerSteps.length} command hooks failed.`
            : `${triggerSteps.length} command hooks passed.`;

      ctx.activityLog?.addEvent({
        category: "agent",
        type: "hooks_ran",
        severity,
        title: `${formatHookTriggerLabel(trigger)} hooks completed`,
        detail,
        worktreeId,
        projectName,
        groupKey,
        metadata: { trigger, commandResults: triggerSteps },
      });

      return run;
    },
  },
  {
    name: "get_hooks_status",
    description: "Get the last hooks run status for a worktree, including per-step results.",
    params: {
      worktreeId: { type: "string", description: "Worktree ID", required: true },
    },
    handler: async (ctx, params) => {
      if (!ctx.hooksManager) return { error: "Hooks manager not available" };
      const worktreeId = params.worktreeId as string;
      return ctx.hooksManager.getStatus(worktreeId) ?? { status: null };
    },
  },
  {
    name: "report_hook_status",
    description:
      "Report hook skill status to the OpenKit UI. Call this TWICE for each skill: once BEFORE invoking (without success/summary) to show a loading state, and once AFTER with the result. Pass trigger whenever possible to avoid ambiguity across hook phases.",
    params: {
      worktreeId: { type: "string", description: "Worktree ID", required: true },
      skillName: {
        type: "string",
        description: "Name of the hook skill (e.g. review-changes)",
        required: true,
      },
      trigger: {
        type: "string",
        description:
          'Hook trigger this skill belongs to: "pre-implementation", "post-implementation", "custom", or "on-demand".',
      },
      success: {
        type: "boolean",
        description: "Whether the hook passed (omit when reporting start)",
      },
      summary: {
        type: "string",
        description: "Short one-line summary of the result (omit when reporting start)",
      },
      content: {
        type: "string",
        description: "Full markdown content with detailed results (optional)",
      },
      filePath: {
        type: "string",
        description:
          "Absolute path to an MD report file the agent wrote (optional). Shown as a link in the UI.",
      },
    },
    handler: async (ctx, params) => {
      if (!ctx.hooksManager) return { error: "Hooks manager not available" };
      const worktreeId = params.worktreeId as string;
      const skillName = params.skillName as string;
      const success = params.success as boolean | undefined;
      const summary = params.summary as string | undefined;
      const content = params.content as string | undefined;
      const filePath = params.filePath as string | undefined;
      const triggerParam = params.trigger;

      // Resolve trigger from param first, then best-effort config fallback.
      const hooksConfig = ctx.hooksManager.getConfig();
      const trigger =
        (triggerParam === undefined || triggerParam === null
          ? hooksConfig.skills.find((s) => s.skillName === skillName)?.trigger
          : normalizeHookTrigger(triggerParam)) ?? "post-implementation";
      if (trigger === "worktree-created" || trigger === "worktree-removed") {
        return {
          error: "Lifecycle hooks are command-only; skill status reporting is not supported.",
        };
      }
      const triggerLabel = formatHookTriggerLabel(trigger);
      const projectName = ctx.manager.getProjectName() ?? undefined;
      const groupKey = `hooks:${worktreeId}:${trigger}`;

      if (success === undefined || success === null) {
        // Starting notification — mark as running
        ctx.hooksManager.reportSkillResult(worktreeId, {
          skillName,
          trigger,
          status: "running",
          reportedAt: new Date().toISOString(),
        });
        ctx.activityLog?.addEvent({
          category: "agent",
          type: "skill_started",
          severity: "info",
          title: `${triggerLabel} skill running: ${skillName}`,
          worktreeId,
          projectName,
          groupKey,
          metadata: { trigger, skillName },
        });
      } else {
        // Completion report
        ctx.hooksManager.reportSkillResult(worktreeId, {
          skillName,
          trigger,
          status: success ? "passed" : "failed",
          success,
          summary,
          content,
          filePath,
          reportedAt: new Date().toISOString(),
        });
        ctx.activityLog?.addEvent({
          category: "agent",
          type: success ? "skill_completed" : "skill_failed",
          severity: success ? "success" : "error",
          title: success
            ? `${triggerLabel} skill passed: ${skillName}`
            : `${triggerLabel} skill failed: ${skillName}`,
          detail: summary,
          worktreeId,
          projectName,
          groupKey,
          metadata: { trigger, skillName, filePath },
        });
      }

      return { success: true };
    },
  },
];
