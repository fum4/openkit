import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { input, select } from "@inquirer/prompts";

import { APP_NAME, CONFIG_DIR_NAME } from "@openkit/shared/constants";
import { copyEnvFiles } from "@openkit/shared/env-files";
import { formatTaskContext, formatTaskContextJson } from "@openkit/agents";
import type { TaskContextData, HooksInfo } from "@openkit/agents";
import type { HookStep, HookSkillRef } from "@openkit/shared/worktree-types";
import { log } from "./logger";
import {
  loadJiraCredentials,
  loadJiraProjectConfig,
  saveJiraProjectConfig,
} from "@openkit/integrations/jira/credentials";
import { getApiBase, getAuthHeaders } from "@openkit/integrations/jira/auth";
import {
  resolveTaskKey,
  fetchIssue as fetchJiraIssue,
  saveTaskData as saveJiraTaskData,
  downloadAttachments,
} from "@openkit/integrations/jira/api";
import type { JiraTaskData } from "@openkit/integrations/jira/types";
import {
  loadLinearCredentials,
  loadLinearProjectConfig,
  saveLinearProjectConfig,
} from "@openkit/integrations/linear/credentials";
import {
  resolveIdentifier as resolveLinearId,
  fetchIssue as fetchLinearIssue,
  fetchIssues as fetchLinearIssues,
  saveTaskData as saveLinearTaskData,
} from "@openkit/integrations/linear/api";
import type { LinearTaskData } from "@openkit/integrations/linear/types";
import { WorktreeManager } from "@openkit/server/manager";
import type { WorktreeConfig } from "@openkit/shared/worktree-types";
import { HooksManager } from "@openkit/server/verification-manager";
import { findConfigDir, loadConfig } from "./config";

export type Source = "jira" | "linear" | "local";
export type TaskAction = "init" | "link" | "save";

export interface TaskRunOptions {
  action?: TaskAction;
}

export interface ResolveTaskRunOptions {
  json?: boolean;
}

interface ResolvedTask {
  source: Source;
  input: string;
  resolvedId: string;
  reason: string;
}

interface IntegrationState {
  jiraConnected: boolean;
  linearConnected: boolean;
  jiraDefaultProjectKey: string | null;
  linearDefaultTeamKey: string | null;
}

interface IssueChoice {
  id: string;
  title: string;
}

function issuesDir(configDir: string, source: Source): string {
  return path.join(configDir, CONFIG_DIR_NAME, "issues", source);
}

function hasStoredIssue(configDir: string, source: Source, issueId: string): boolean {
  const dir = path.join(issuesDir(configDir, source), issueId);
  return existsSync(path.join(dir, "issue.json")) || existsSync(path.join(dir, "task.json"));
}

function normalizeLocalId(issueId: string): string {
  const trimmed = issueId.trim().toUpperCase();
  if (trimmed.startsWith("LOCAL-")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `LOCAL-${trimmed}`;
  return trimmed;
}

function issuePrefix(issueId: string): string | null {
  const m = issueId.toUpperCase().match(/^([A-Z][A-Z0-9]*)-\d+$/);
  return m ? m[1] : null;
}

function getIntegrationState(configDir: string): IntegrationState {
  const jiraCfg = loadJiraProjectConfig(configDir);
  const linearCfg = loadLinearProjectConfig(configDir);
  return {
    jiraConnected: loadJiraCredentials(configDir) !== null,
    linearConnected: loadLinearCredentials(configDir) !== null,
    jiraDefaultProjectKey: jiraCfg.defaultProjectKey?.toUpperCase() ?? null,
    linearDefaultTeamKey: linearCfg.defaultTeamKey?.toUpperCase() ?? null,
  };
}

function listStoredIssueIdsBySuffix(configDir: string, source: Source, suffix: string): string[] {
  const dir = issuesDir(configDir, source);
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.toUpperCase().endsWith(suffix)) continue;
    if (hasStoredIssue(configDir, source, entry.name)) {
      results.push(entry.name.toUpperCase());
    }
  }
  return results;
}

function learnSourcePrefix(configDir: string, source: Source, issueId: string): void {
  const prefix = issuePrefix(issueId);
  if (!prefix) return;

  if (source === "jira") {
    const current = loadJiraProjectConfig(configDir).defaultProjectKey?.toUpperCase();
    if (current !== prefix) {
      saveJiraProjectConfig(configDir, { defaultProjectKey: prefix });
      log.info(`Updated Jira defaultProjectKey to ${prefix}`);
    }
    return;
  }

  if (source === "linear") {
    const current = loadLinearProjectConfig(configDir).defaultTeamKey?.toUpperCase();
    if (current !== prefix) {
      saveLinearProjectConfig(configDir, { defaultTeamKey: prefix });
      log.info(`Updated Linear defaultTeamKey to ${prefix}`);
    }
  }
}

function resolveTaskSource(configDir: string, inputIssueId: string): ResolvedTask {
  const raw = inputIssueId.trim();
  if (!raw) {
    throw new Error("Issue ID is required.");
  }

  const upper = raw.toUpperCase();
  const state = getIntegrationState(configDir);
  const candidates: ResolvedTask[] = [];

  const localId = normalizeLocalId(raw);
  if (hasStoredIssue(configDir, "local", localId)) {
    candidates.push({
      source: "local",
      input: raw,
      resolvedId: localId,
      reason: "Found in .openkit/issues/local",
    });
  }

  if (upper.includes("-")) {
    if (hasStoredIssue(configDir, "jira", upper)) {
      candidates.push({
        source: "jira",
        input: raw,
        resolvedId: upper,
        reason: "Found in .openkit/issues/jira",
      });
    }
    if (hasStoredIssue(configDir, "linear", upper)) {
      candidates.push({
        source: "linear",
        input: raw,
        resolvedId: upper,
        reason: "Found in .openkit/issues/linear",
      });
    }
  } else {
    if (state.jiraDefaultProjectKey) {
      const jiraDefaultId = `${state.jiraDefaultProjectKey}-${raw}`;
      if (hasStoredIssue(configDir, "jira", jiraDefaultId)) {
        candidates.push({
          source: "jira",
          input: raw,
          resolvedId: jiraDefaultId,
          reason: `Found cached Jira issue via defaultProjectKey (${state.jiraDefaultProjectKey})`,
        });
      }
    }
    if (state.linearDefaultTeamKey) {
      const linearDefaultId = `${state.linearDefaultTeamKey}-${raw}`;
      if (hasStoredIssue(configDir, "linear", linearDefaultId)) {
        candidates.push({
          source: "linear",
          input: raw,
          resolvedId: linearDefaultId,
          reason: `Found cached Linear issue via defaultTeamKey (${state.linearDefaultTeamKey})`,
        });
      }
    }

    if (/^\d+$/.test(raw)) {
      const suffix = `-${raw}`;
      for (const issueId of listStoredIssueIdsBySuffix(configDir, "jira", suffix)) {
        candidates.push({
          source: "jira",
          input: raw,
          resolvedId: issueId,
          reason: "Found cached Jira issue by numeric suffix",
        });
      }
      for (const issueId of listStoredIssueIdsBySuffix(configDir, "linear", suffix)) {
        candidates.push({
          source: "linear",
          input: raw,
          resolvedId: issueId,
          reason: "Found cached Linear issue by numeric suffix",
        });
      }
    }
  }

  const deduped = new Map<string, ResolvedTask>();
  for (const c of candidates) {
    deduped.set(`${c.source}:${c.resolvedId}`, c);
  }
  const cachedMatches = [...deduped.values()];
  if (cachedMatches.length === 1) return cachedMatches[0];
  if (cachedMatches.length > 1) {
    throw new Error(
      `Issue "${raw}" matches multiple cached issues (${cachedMatches.map((m) => `${m.source}:${m.resolvedId}`).join(", ")}). ` +
        `Specify source explicitly: "${APP_NAME} task <jira|linear|local> ${raw} --init".`,
    );
  }

  if (upper.startsWith("LOCAL-")) {
    return {
      source: "local",
      input: raw,
      resolvedId: upper,
      reason: 'Issue key has "LOCAL-" prefix',
    };
  }

  const connected = Number(state.jiraConnected) + Number(state.linearConnected);
  if (connected === 0) {
    throw new Error(
      `No cached issue found for "${raw}" and no Jira/Linear integration is connected. ` +
        `Run "${APP_NAME} add jira" or "${APP_NAME} add linear", or specify local issue key.`,
    );
  }

  if (state.jiraConnected && !state.linearConnected) {
    return {
      source: "jira",
      input: raw,
      resolvedId: upper,
      reason: "Only Jira integration is connected",
    };
  }

  if (!state.jiraConnected && state.linearConnected) {
    return {
      source: "linear",
      input: raw,
      resolvedId: upper,
      reason: "Only Linear integration is connected",
    };
  }

  const prefix = issuePrefix(upper);
  if (prefix) {
    const jiraMatches = state.jiraDefaultProjectKey === prefix;
    const linearMatches = state.linearDefaultTeamKey === prefix;
    if (jiraMatches && !linearMatches) {
      return {
        source: "jira",
        input: raw,
        resolvedId: upper,
        reason: `Prefix ${prefix} matches Jira defaultProjectKey`,
      };
    }
    if (linearMatches && !jiraMatches) {
      return {
        source: "linear",
        input: raw,
        resolvedId: upper,
        reason: `Prefix ${prefix} matches Linear defaultTeamKey`,
      };
    }
  } else {
    const hasJiraDefault = !!state.jiraDefaultProjectKey;
    const hasLinearDefault = !!state.linearDefaultTeamKey;
    if (hasJiraDefault && !hasLinearDefault) {
      return {
        source: "jira",
        input: raw,
        resolvedId: raw,
        reason: `Only Jira defaultProjectKey is configured (${state.jiraDefaultProjectKey})`,
      };
    }
    if (!hasJiraDefault && hasLinearDefault) {
      return {
        source: "linear",
        input: raw,
        resolvedId: raw,
        reason: `Only Linear defaultTeamKey is configured (${state.linearDefaultTeamKey})`,
      };
    }
  }

  throw new Error(
    `Could not determine source for "${raw}". Both Jira and Linear are connected. ` +
      `Set a single default key (Jira defaultProjectKey or Linear defaultTeamKey), ` +
      `or specify source explicitly: "${APP_NAME} task <jira|linear> ${raw} --init".`,
  );
}

export function runTaskResolve(taskIds: string[], options: ResolveTaskRunOptions = {}): void {
  const configDir = findConfigDir();
  if (!configDir) {
    log.error(`No config found. Run "${APP_NAME} init" first.`);
    process.exit(1);
  }

  const resolved: ResolvedTask[] = [];
  for (const id of taskIds) {
    let r: ResolvedTask;
    try {
      r = resolveTaskSource(configDir, id);
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    resolved.push(r);
  }

  if (options.json) {
    log.plain(JSON.stringify(resolved, null, 2));
    return;
  }

  for (const r of resolved) {
    log.plain(`${r.input} -> ${r.source}:${r.resolvedId} (${r.reason})`);
  }
}

export async function runTask(
  source: Source,
  taskIds: string[],
  batch: boolean,
  options: TaskRunOptions = {},
) {
  const configDir = findConfigDir();
  if (!configDir) {
    log.error(`No config found. Run "${APP_NAME} init" first.`);
    process.exit(1);
  }

  for (const id of taskIds) {
    await processTaskWithConfig(source, id, batch, options, configDir);
  }
}

export async function runTaskAuto(taskIds: string[], batch: boolean, options: TaskRunOptions = {}) {
  const configDir = findConfigDir();
  if (!configDir) {
    log.error(`No config found. Run "${APP_NAME} init" first.`);
    process.exit(1);
  }

  for (const rawId of taskIds) {
    let resolved: ResolvedTask;
    try {
      resolved = resolveTaskSource(configDir, rawId);
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    log.info(
      `Resolved ${resolved.input} -> ${resolved.source}:${resolved.resolvedId} (${resolved.reason})`,
    );
    await processTaskWithConfig(resolved.source, resolved.resolvedId, batch, options, configDir);
  }
}

export async function runTaskInteractive() {
  const configDir = findConfigDir();
  if (!configDir) {
    log.error(`No config found. Run "${APP_NAME} init" first.`);
    process.exit(1);
  }

  const source = await select<Source>({
    message: "Issue source",
    choices: [
      { name: "Jira", value: "jira" },
      { name: "Linear", value: "linear" },
      { name: "Local", value: "local" },
    ],
  });

  const id = await promptForTaskId(source, configDir);
  await processTaskWithConfig(source, id, false, {}, configDir);
}

export async function runTaskSourceInteractive(
  source: Source,
  options: TaskRunOptions = {},
): Promise<void> {
  const configDir = findConfigDir();
  if (!configDir) {
    log.error(`No config found. Run "${APP_NAME} init" first.`);
    process.exit(1);
  }

  const id = await promptForTaskId(source, configDir);
  await processTaskWithConfig(source, id, false, options, configDir);
}

async function processTaskWithConfig(
  source: Source,
  taskId: string,
  batch: boolean,
  options: TaskRunOptions,
  configDir: string,
) {
  switch (source) {
    case "jira":
      return processJiraTask(taskId, configDir, batch, options);
    case "linear":
      return processLinearTask(taskId, configDir, batch, options);
    case "local":
      return processLocalTask(taskId, configDir, batch, options);
  }
}

async function fetchJiraIssueChoices(configDir: string): Promise<IssueChoice[]> {
  const creds = loadJiraCredentials(configDir);
  if (!creds) return [];

  const apiBase = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const params = new URLSearchParams({
    jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
    fields: "summary",
    maxResults: "50",
  });

  const resp = await fetch(`${apiBase}/search/jql?${params}`, { headers });
  if (!resp.ok) {
    throw new Error(`Jira API error: ${resp.status}`);
  }

  const data = (await resp.json()) as {
    issues: Array<{ key: string; fields: { summary?: string } }>;
  };

  return data.issues.map((issue) => ({
    id: issue.key,
    title: issue.fields.summary?.trim() || "(no title)",
  }));
}

async function fetchLinearIssueChoices(configDir: string): Promise<IssueChoice[]> {
  const creds = loadLinearCredentials(configDir);
  if (!creds) return [];
  const projectConfig = loadLinearProjectConfig(configDir);
  const issues = await fetchLinearIssues(creds, projectConfig.defaultTeamKey);
  return issues.map((issue) => ({
    id: issue.identifier,
    title: issue.title?.trim() || "(no title)",
  }));
}

function fetchLocalIssueChoices(configDir: string): IssueChoice[] {
  const dir = issuesDir(configDir, "local");
  if (!existsSync(dir)) return [];

  const results: IssueChoice[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const issueFile = path.join(dir, entry.name, "issue.json");
    const legacyFile = path.join(dir, entry.name, "task.json");
    const taskFile = existsSync(issueFile) ? issueFile : legacyFile;
    if (!existsSync(taskFile)) continue;
    try {
      const task = JSON.parse(readFileSync(taskFile, "utf-8")) as { id?: string; title?: string };
      const id = (task.id ?? entry.name).toUpperCase();
      const title = task.title?.trim() || "(no title)";
      results.push({ id, title });
    } catch {
      // ignore malformed local task file
    }
  }
  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}

async function promptForTaskId(source: Source, configDir: string): Promise<string> {
  let choices: IssueChoice[] = [];
  try {
    if (source === "jira") choices = await fetchJiraIssueChoices(configDir);
    if (source === "linear") choices = await fetchLinearIssueChoices(configDir);
    if (source === "local") choices = fetchLocalIssueChoices(configDir);
  } catch (err) {
    log.warn(
      `Failed to load ${source} issue list: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (choices.length === 0) {
    const id = (await input({ message: "Issue ID" })).trim();
    if (!id) {
      log.error("No issue ID provided.");
      process.exit(1);
    }
    return id;
  }

  const manual = "__manual__";
  const selected = await select<string>({
    message: "Select issue (or type ID manually)",
    choices: [
      { name: "Type issue ID manually", value: manual },
      ...choices.map((c) => ({ name: `${c.id} — ${c.title}`, value: c.id })),
    ],
  });

  if (selected !== manual) return selected;

  const id = (await input({ message: "Issue ID" })).trim();
  if (!id) {
    log.error("No issue ID provided.");
    process.exit(1);
  }
  return id;
}

// ─── Jira ────────────────────────────────────────────────────────────────────

async function processJiraTask(
  taskId: string,
  configDir: string,
  batch: boolean,
  options: TaskRunOptions,
) {
  const projectConfig = loadJiraProjectConfig(configDir);
  const cachedKey = taskId.includes("-")
    ? taskId.toUpperCase()
    : projectConfig.defaultProjectKey
      ? `${projectConfig.defaultProjectKey.toUpperCase()}-${taskId}`
      : null;

  let taskData: JiraTaskData | null = null;
  if (cachedKey) {
    const cachedIssueFile = path.join(
      configDir,
      CONFIG_DIR_NAME,
      "issues",
      "jira",
      cachedKey,
      "issue.json",
    );
    if (existsSync(cachedIssueFile)) {
      taskData = JSON.parse(readFileSync(cachedIssueFile, "utf-8")) as JiraTaskData;
      log.info(`Using cached Jira issue ${cachedKey}`);
    }
  }

  if (!taskData) {
    const creds = loadJiraCredentials(configDir);
    if (!creds) {
      log.error(`Jira not connected and cached issue not found. Run "${APP_NAME} add jira" first.`);
      process.exit(1);
    }

    const key = resolveTaskKey(taskId, projectConfig);

    log.info(`Fetching ${key}...`);

    try {
      taskData = await fetchJiraIssue(key, creds, configDir);
    } catch (err) {
      if (batch) {
        log.error(`Failed to fetch ${key}: ${err instanceof Error ? err.message : err}`);
        return;
      }
      throw err;
    }

    // Download attachments
    if (taskData.attachments.length > 0) {
      log.info(`Downloading ${taskData.attachments.length} attachment(s)...`);

      const base = getApiBase(creds);
      const headers = await getAuthHeaders(creds, configDir);

      const resp = await fetch(`${base}/issue/${encodeURIComponent(key)}?fields=attachment`, {
        headers,
      });
      if (resp.ok) {
        const issue = (await resp.json()) as {
          fields: {
            attachment: Array<{
              filename: string;
              content: string;
              mimeType: string;
              size: number;
            }>;
          };
        };
        const tasksDir = path.join(configDir, CONFIG_DIR_NAME, "tasks");
        const attachmentsDir = path.join(tasksDir, key, "attachments");
        const downloaded = await downloadAttachments(
          issue.fields.attachment,
          attachmentsDir,
          creds,
          configDir,
        );
        taskData.attachments = downloaded;
        log.success(`${downloaded.length} attachment(s) downloaded`);
      }
    }
  }

  if (!taskData) {
    log.error("Failed to load Jira issue data.");
    process.exit(1);
  }
  const jiraTask = taskData;

  learnSourcePrefix(configDir, "jira", jiraTask.key);

  printSummary(
    jiraTask.key,
    jiraTask.summary,
    jiraTask.status,
    jiraTask.priority,
    jiraTask.assignee,
    jiraTask.labels,
    jiraTask.url,
  );

  const tasksDir = path.join(configDir, CONFIG_DIR_NAME, "tasks");
  saveJiraTaskData(jiraTask, tasksDir);
  log.success(`Task saved`);

  await handleWorktreeAction(jiraTask.key, batch, configDir, options, (worktreeId) => {
    jiraTask.linkedWorktree = worktreeId;
    saveJiraTaskData(jiraTask, tasksDir);
    saveLinkedWorktreeToNotes(configDir, "jira", jiraTask.key, worktreeId);
  });
}

// ─── Linear ──────────────────────────────────────────────────────────────────

async function processLinearTask(
  taskId: string,
  configDir: string,
  batch: boolean,
  options: TaskRunOptions,
) {
  const projectConfig = loadLinearProjectConfig(configDir);
  const cachedIdentifier = taskId.includes("-")
    ? taskId.toUpperCase()
    : projectConfig.defaultTeamKey
      ? `${projectConfig.defaultTeamKey.toUpperCase()}-${taskId}`
      : null;

  let taskData: LinearTaskData | null = null;
  if (cachedIdentifier) {
    const cachedIssueFile = path.join(
      configDir,
      CONFIG_DIR_NAME,
      "issues",
      "linear",
      cachedIdentifier,
      "issue.json",
    );
    if (existsSync(cachedIssueFile)) {
      taskData = JSON.parse(readFileSync(cachedIssueFile, "utf-8")) as LinearTaskData;
      log.info(`Using cached Linear issue ${cachedIdentifier}`);
    }
  }

  if (!taskData) {
    const creds = loadLinearCredentials(configDir);
    if (!creds) {
      log.error(
        `Linear not connected and cached issue not found. Run "${APP_NAME} add linear" first.`,
      );
      process.exit(1);
    }

    const identifier = resolveLinearId(taskId, projectConfig);

    log.info(`Fetching ${identifier}...`);

    let issue;
    try {
      issue = await fetchLinearIssue(identifier, creds);
    } catch (err) {
      if (batch) {
        log.error(`Failed to fetch ${identifier}: ${err instanceof Error ? err.message : err}`);
        return;
      }
      throw err;
    }

    taskData = {
      source: "linear",
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      status: issue.state.name,
      priority: issue.priority,
      assignee: issue.assignee,
      labels: issue.labels,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      comments: issue.comments,
      attachments: issue.attachments,
      linkedWorktree: null,
      fetchedAt: new Date().toISOString(),
      url: issue.url,
    };
  }

  if (!taskData) {
    log.error("Failed to load Linear issue data.");
    process.exit(1);
  }
  const linearTask = taskData;

  learnSourcePrefix(configDir, "linear", linearTask.identifier);

  printSummary(
    linearTask.identifier,
    linearTask.title,
    linearTask.status,
    null,
    linearTask.assignee,
    linearTask.labels.map((l) => l.name),
    linearTask.url,
  );

  const tasksDir = path.join(configDir, CONFIG_DIR_NAME, "tasks");
  saveLinearTaskData(linearTask, tasksDir);
  log.success(`Task saved`);

  await handleWorktreeAction(linearTask.identifier, batch, configDir, options, (worktreeId) => {
    linearTask.linkedWorktree = worktreeId;
    saveLinearTaskData(linearTask, tasksDir);
    saveLinkedWorktreeToNotes(configDir, "linear", linearTask.identifier, worktreeId);
  });
}

// ─── Local ───────────────────────────────────────────────────────────────────

async function processLocalTask(
  taskId: string,
  configDir: string,
  batch: boolean,
  options: TaskRunOptions,
) {
  const id = taskId.toUpperCase().startsWith("LOCAL-") ? taskId.toUpperCase() : `LOCAL-${taskId}`;
  const issueDir = path.join(configDir, CONFIG_DIR_NAME, "issues", "local", id);
  const issueFile = path.join(issueDir, "issue.json");
  const legacyFile = path.join(issueDir, "task.json");
  const taskFile = existsSync(issueFile) ? issueFile : legacyFile;

  if (!existsSync(taskFile)) {
    if (batch) {
      log.error(`Local issue ${id} not found.`);
      return;
    }
    log.error(`Local issue ${id} not found.`);
    process.exit(1);
  }

  const task = JSON.parse(readFileSync(taskFile, "utf-8")) as {
    id: string;
    title: string;
    status: string;
    priority: string;
    labels: string[];
  };

  printSummary(task.id, task.title, task.status, task.priority, null, task.labels, null);

  await handleWorktreeAction(task.id, batch, configDir, options, (worktreeId) => {
    saveLinkedWorktreeToNotes(configDir, "local", task.id, worktreeId);
  });
}

// ─── Task Context ────────────────────────────────────────────────────────────
// These helpers are exported for testing.

interface NotesData {
  aiContext?: { content?: string } | null;
  todos?: Array<{ id: string; text: string; checked: boolean; createdAt: string }>;
  hookSkills?: Record<string, string>;
}

/** Exported for testing. */
export function detectWorktreeId(): string | null {
  let dir = process.cwd();
  const sep = path.sep;
  const marker = `${sep}${CONFIG_DIR_NAME}${sep}worktrees${sep}`;

  // Check if cwd or any parent is under .openkit/worktrees/
  while (true) {
    const idx = dir.indexOf(marker);
    if (idx >= 0) {
      // Extract the worktree ID -- first path segment after .openkit/worktrees/
      const rest = dir.substring(idx + marker.length);
      const id = rest.split(sep)[0];
      if (id) return id;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function detectLinkedIssue(configDir: string): { source: Source; issueId: string } | null {
  const worktreeId = detectWorktreeId();
  if (!worktreeId) return null;

  const issuesBase = path.join(configDir, CONFIG_DIR_NAME, "issues");
  if (!existsSync(issuesBase)) return null;

  for (const source of ["local", "jira", "linear"] as Source[]) {
    const sourceDir = path.join(issuesBase, source);
    if (!existsSync(sourceDir)) continue;
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const notesPath = path.join(sourceDir, entry.name, "notes.json");
      if (!existsSync(notesPath)) continue;
      try {
        const notes = JSON.parse(readFileSync(notesPath, "utf-8"));
        if (notes.linkedWorktreeId === worktreeId) {
          return { source, issueId: entry.name };
        }
      } catch {
        // skip malformed
      }
    }
  }
  return null;
}

/** Exported for testing. */
export function loadIssueDataForContext(
  issueDir: string,
  source: Source,
  issueId: string,
): TaskContextData | null {
  const issueFile = path.join(issueDir, "issue.json");
  const legacyFile = path.join(issueDir, "task.json");
  const filePath = existsSync(issueFile) ? issueFile : legacyFile;
  if (!existsSync(filePath)) return null;

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    return {
      source,
      issueId,
      identifier: raw.identifier ?? raw.id ?? raw.key ?? issueId,
      title: raw.title ?? raw.summary ?? "",
      description: raw.description ?? "",
      status: raw.status ?? "",
      url: raw.url ?? "",
      comments: raw.comments,
      attachments: raw.attachments,
      linkedResources: raw.linkedResources,
    };
  } catch {
    return null;
  }
}

/** Exported for testing. */
export function loadNotesFile(issueDir: string): NotesData {
  const notesPath = path.join(issueDir, "notes.json");
  if (!existsSync(notesPath)) return {};
  try {
    return JSON.parse(readFileSync(notesPath, "utf-8"));
  } catch {
    return {};
  }
}

/** Exported for testing. */
export function resolveEffectiveHooks(configDir: string, notes: NotesData): HooksInfo | null {
  const hooksPath = path.join(configDir, CONFIG_DIR_NAME, "hooks.json");
  if (!existsSync(hooksPath)) return null;

  let config: { steps?: HookStep[]; skills?: HookSkillRef[] };
  try {
    config = JSON.parse(readFileSync(hooksPath, "utf-8"));
  } catch {
    return null;
  }

  const steps = config.steps ?? [];
  const skills = config.skills ?? [];
  const overrides = notes.hookSkills ?? {};

  // Apply per-issue skill overrides
  const effectiveSkills = skills.map((skill) => {
    const trigger = skill.trigger ?? "post-implementation";
    const key = `${trigger}:${skill.skillName}`;
    const override = overrides[key];
    if (override === "enable") return { ...skill, enabled: true };
    if (override === "disable") return { ...skill, enabled: false };
    return skill;
  });

  return { checks: steps, skills: effectiveSkills };
}

export function runTaskContext(issueId: string | undefined, options: { json?: boolean }): void {
  const configDir = findConfigDir();
  if (!configDir) {
    log.error(`No config found. Run "${APP_NAME} init" first.`);
    process.exit(1);
  }

  let source: Source;
  let resolvedId: string;

  if (issueId) {
    let resolved: ReturnType<typeof resolveTaskSource>;
    try {
      resolved = resolveTaskSource(configDir, issueId);
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    source = resolved.source;
    resolvedId = resolved.resolvedId;
  } else {
    const detected = detectLinkedIssue(configDir);
    if (!detected) {
      log.error("Not in a worktree or no linked issue found. Provide an issue ID.");
      process.exit(1);
    }
    source = detected.source;
    resolvedId = detected.issueId;
  }

  const dir = path.join(configDir, CONFIG_DIR_NAME, "issues", source, resolvedId);
  const data = loadIssueDataForContext(dir, source, resolvedId);
  if (!data) {
    log.error(`Issue ${source}:${resolvedId} not found.`);
    process.exit(1);
  }

  const notes = loadNotesFile(dir);
  const hooks = resolveEffectiveHooks(configDir, notes);

  if (options.json) {
    log.plain(
      JSON.stringify(
        formatTaskContextJson(data, notes.aiContext?.content, notes.todos, hooks),
        null,
        2,
      ),
    );
  } else {
    log.plain(formatTaskContext(data, notes.aiContext?.content, notes.todos, hooks));
  }
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function saveLinkedWorktreeToNotes(
  configDir: string,
  source: Source,
  issueId: string,
  worktreeId: string,
): void {
  const issueDir = path.join(configDir, CONFIG_DIR_NAME, "issues", source, issueId);
  const notesFile = path.join(issueDir, "notes.json");
  if (!existsSync(issueDir)) mkdirSync(issueDir, { recursive: true });

  const existing =
    existsSync(notesFile) && readFileSync(notesFile, "utf-8").trim().length > 0
      ? (JSON.parse(readFileSync(notesFile, "utf-8")) as Record<string, unknown>)
      : {};

  const next = {
    ...existing,
    linkedWorktreeId: worktreeId,
    personal: existing.personal && typeof existing.personal === "object" ? existing.personal : null,
    aiContext:
      existing.aiContext && typeof existing.aiContext === "object" ? existing.aiContext : null,
    todos: Array.isArray(existing.todos) ? existing.todos : [],
  };

  writeFileSync(notesFile, JSON.stringify(next, null, 2) + "\n");
}

function printSummary(
  key: string,
  title: string,
  status: string,
  priority: string | null,
  assignee: string | null,
  labels: string[],
  url: string | null,
) {
  log.plain("");
  log.plain(`  ${key}: ${title}`);
  const parts = [`Status: ${status}`];
  if (priority) parts.push(`Priority: ${priority}`);
  log.plain(`  ${parts.join("  |  ")}`);
  if (assignee) log.plain(`  Assignee: ${assignee}`);
  if (labels.length > 0) log.plain(`  Labels: ${labels.join(", ")}`);
  if (url) log.plain(`  URL: ${url}`);
  log.plain("");
}

async function handleWorktreeAction(
  key: string,
  batch: boolean,
  configDir: string,
  options: TaskRunOptions,
  onLink: (worktreeId: string) => void,
) {
  const actionOverride = options.action;

  if (batch) {
    if (actionOverride === "save") {
      log.success(`Saved ${key} without creating a worktree.`);
      return;
    }
    if (actionOverride === "link") {
      log.warn("Ignoring --link in batch mode; creating worktrees for each task.");
    }
    try {
      await createWorktreeForTask(key, configDir, onLink);
    } catch (err) {
      log.error(
        `Failed to create worktree for ${key}: ${err instanceof Error ? err.message : err}`,
      );
    }
    return;
  }

  if (actionOverride === "save") {
    log.success("Done.");
    return;
  }
  if (actionOverride === "init") {
    await createWorktreeForTask(key, configDir, onLink);
    log.success("Done.");
    return;
  }
  if (actionOverride === "link") {
    await linkWorktreeToTask(key, configDir, onLink);
    log.success("Done.");
    return;
  }

  log.plain("");
  const action = await select({
    message: "What would you like to do?",
    choices: [
      { name: "Initialize task worktree", value: "init" },
      { name: "Link to an existing worktree", value: "link" },
      { name: "Just save the data", value: "save" },
    ],
    default: "save",
  });

  if (action === "init") {
    await createWorktreeForTask(key, configDir, onLink);
  } else if (action === "link") {
    await linkWorktreeToTask(key, configDir, onLink);
  }

  log.success("Done.");
}

async function createWorktreeForTask(
  key: string,
  configDir: string,
  onLink: (worktreeId: string) => void,
) {
  const { config, configPath } = loadConfig();
  const worktreeId = key;
  const branchName = key;

  const worktreesDir = path.join(configDir, CONFIG_DIR_NAME, "worktrees");

  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  const worktreePath = path.join(worktreesDir, worktreeId);

  if (existsSync(worktreePath)) {
    log.warn(`Worktree directory already exists: ${worktreePath}`);
    log.info("Linking to existing worktree instead.");
    onLink(worktreeId);
    return;
  }

  log.info(`Creating worktree at ${worktreePath} (branch: ${branchName})...`);

  // Prune stale worktree references before creating
  try {
    execFileSync("git", ["worktree", "prune"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Ignore prune errors
  }

  // Try creating with -b (new branch), fallback to existing branch, fallback to -B
  try {
    execFileSync("git", ["worktree", "add", "-b", branchName, worktreePath, config.baseBranch], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    try {
      execFileSync("git", ["worktree", "add", worktreePath, branchName], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      execFileSync("git", ["worktree", "add", "-B", branchName, worktreePath, config.baseBranch], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
  }

  log.success("Worktree created.");

  // Copy .env files
  copyEnvFiles(configDir, worktreePath, worktreesDir);

  // Run install command
  if (config.installCommand) {
    const projectSubdir =
      config.projectDir && config.projectDir !== "."
        ? path.join(worktreePath, config.projectDir)
        : worktreePath;

    log.info(`Running: ${config.installCommand}`);
    try {
      const [cmd, ...args] = config.installCommand.split(" ");
      execFileSync(cmd, args, {
        encoding: "utf-8",
        cwd: projectSubdir,
        stdio: "inherit",
      });
    } catch (err) {
      log.warn(`Install command failed: ${err}`);
    }
  }

  onLink(worktreeId);
  await runTaskLifecycleCreatedHooks(config, configPath, worktreeId, worktreePath);
  log.success(`Worktree linked to task ${key}`);
}

async function runTaskLifecycleCreatedHooks(
  config: WorktreeConfig,
  configPath: string | null,
  worktreeId: string,
  worktreePath: string,
): Promise<void> {
  let manager: WorktreeManager | null = null;
  try {
    manager = new WorktreeManager(config, configPath);
    const hooksManager = new HooksManager(manager);
    await hooksManager.runWorktreeLifecycleCommands("worktree-created", worktreeId, worktreePath);
  } catch (error) {
    log.warn(
      `Failed to run worktree-created hooks for "${worktreeId}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    manager?.getActivityLog().dispose();
  }
}

async function linkWorktreeToTask(
  key: string,
  configDir: string,
  onLink: (worktreeId: string) => void,
) {
  const worktreesDir = path.join(configDir, CONFIG_DIR_NAME, "worktrees");

  if (!existsSync(worktreesDir)) {
    log.warn("No worktrees directory found.");
    return;
  }

  const entries = readdirSync(worktreesDir, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && existsSync(path.join(worktreesDir, e.name, ".git")),
  );

  if (entries.length === 0) {
    log.warn("No existing worktrees found.");
    return;
  }

  const chosen = await select({
    message: "Select worktree",
    choices: entries.map((e) => ({
      name: e.name,
      value: e.name,
    })),
  });

  onLink(chosen);
  log.success(`Task ${key} linked to worktree: ${chosen}`);
}
