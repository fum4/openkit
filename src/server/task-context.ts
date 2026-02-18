import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME } from "../constants";
import type { NotesManager, IssueSource, TodoItem } from "./notes-manager";
import type { HookStep, HookSkillRef } from "./types";

export interface TaskContextData {
  source: IssueSource;
  issueId: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  url: string;
  comments?: Array<{ author: string; body: string; created?: string }>;
  attachments?: Array<{ filename: string; localPath: string; mimeType: string }>;
  linkedResources?: Array<{ title: string; url: string; sourceType?: string | null }>;
}

export interface PendingTaskContext {
  data: TaskContextData;
  aiContext?: string | null;
}

export interface HooksInfo {
  checks: HookStep[];
  skills: HookSkillRef[];
}

export function generateTaskMd(
  data: TaskContextData,
  aiContext?: string | null,
  todos?: TodoItem[],
  hooks?: HooksInfo | null,
): string {
  const isPromptHook = (step: HookStep): boolean =>
    step.kind === "prompt" || (!!step.prompt && !step.command?.trim());

  const lines: string[] = [];

  lines.push(`# ${data.identifier} — ${data.title}`);
  lines.push("");
  lines.push(`**Source:** ${data.source}`);
  lines.push(`**Status:** ${data.status}`);
  lines.push(`**URL:** ${data.url}`);

  if (aiContext) {
    lines.push("");
    lines.push("## AI Context");
    lines.push("");
    lines.push(aiContext);
  }

  if (data.description) {
    lines.push("");
    lines.push("## Description");
    lines.push("");
    lines.push(data.description);
  }

  if (data.comments && data.comments.length > 0) {
    lines.push("");
    lines.push("## Comments");
    lines.push("");
    for (const comment of data.comments) {
      const dateStr = comment.created ? ` (${comment.created.split("T")[0]})` : "";
      lines.push(`**${comment.author}${dateStr}:** ${comment.body}`);
      lines.push("");
    }
  }

  if (todos && todos.length > 0) {
    lines.push("");
    lines.push("## Todos");
    lines.push("");
    lines.push(
      '> Work through these items in order. Use the `update_todo` MCP tool with action="toggle" to check off each item as you complete it. The user tracks your progress in real-time.',
    );
    lines.push("");
    for (const todo of todos) {
      lines.push(`- [${todo.checked ? "x" : " "}] ${todo.text}`);
    }
  }

  const attachmentsWithPaths = data.attachments?.filter((a) => a.localPath) ?? [];
  if (attachmentsWithPaths.length > 0) {
    lines.push("");
    lines.push("## Attachments");
    lines.push("");
    lines.push(
      "> These files have been downloaded locally. Read them to understand the full context of the issue.",
    );
    lines.push("");
    for (const att of attachmentsWithPaths) {
      lines.push(`- \`${att.filename}\` (${att.mimeType}) — \`${att.localPath}\``);
    }
  }

  if (data.linkedResources && data.linkedResources.length > 0) {
    lines.push("");
    lines.push("## Linked Resources");
    lines.push("");
    for (const res of data.linkedResources) {
      const label = res.sourceType ? ` (${res.sourceType})` : "";
      lines.push(`- [${res.title}](${res.url})${label}`);
    }
  }

  // Pre-implementation hooks
  const preChecks = (hooks?.checks ?? []).filter(
    (s) => s.enabled !== false && s.trigger === "pre-implementation",
  );
  const preCommandChecks = preChecks.filter((s) => !isPromptHook(s));
  const prePromptChecks = preChecks.filter((s) => isPromptHook(s));
  const preSkills = (hooks?.skills ?? []).filter(
    (s: HookSkillRef) => s.enabled && s.trigger === "pre-implementation",
  );

  if (preChecks.length > 0 || preSkills.length > 0) {
    lines.push("");
    lines.push("## Hooks (Pre-Implementation) — RUN THESE FIRST");
    lines.push("");
    lines.push(
      "> **IMPORTANT:** You MUST run all pre-implementation hooks below BEFORE writing any code or making any changes. Do not skip this step.",
    );
    lines.push("");

    if (preCommandChecks.length > 0) {
      lines.push("### Pipeline Checks");
      lines.push(
        'Run the `run_hooks` MCP tool with `trigger: "pre-implementation"` to execute all configured command checks in parallel.',
      );
      lines.push("");
    }

    if (prePromptChecks.length > 0) {
      lines.push("### Prompt Hooks");
      lines.push("Interpret and execute these prompt hooks before implementation:");
      lines.push("");
      for (const promptHook of prePromptChecks) {
        lines.push(
          `- **${promptHook.name}:** ${promptHook.prompt?.trim() || "(no prompt text configured)"}`,
        );
      }
      lines.push("");
    }

    for (const skill of preSkills) {
      lines.push(`### ${skill.skillName}`);
      lines.push(
        `Call \`report_hook_status\` with \`trigger: "pre-implementation"\` (without success/summary) to mark it running, invoke the \`/${skill.skillName}\` skill, then call \`report_hook_status\` again with the result.`,
      );
      lines.push("");
    }
  }

  // Post-implementation hooks
  const postChecks = (hooks?.checks ?? []).filter(
    (s) => s.enabled !== false && (s.trigger === "post-implementation" || !s.trigger),
  );
  const postCommandChecks = postChecks.filter((s) => !isPromptHook(s));
  const postPromptChecks = postChecks.filter((s) => isPromptHook(s));
  const postSkills = (hooks?.skills ?? []).filter(
    (s: HookSkillRef) => s.enabled && (s.trigger === "post-implementation" || !s.trigger),
  );

  if (postChecks.length > 0 || postSkills.length > 0) {
    lines.push("");
    lines.push("## Hooks (Post-Implementation)");
    lines.push("");
    lines.push("After completing your work, run these hook steps:");

    if (postCommandChecks.length > 0) {
      lines.push("");
      lines.push("### Pipeline Checks");
      lines.push(
        'Run the `run_hooks` MCP tool with `trigger: "post-implementation"` to execute all configured command checks in parallel.',
      );
    }

    if (postPromptChecks.length > 0) {
      lines.push("");
      lines.push("### Prompt Hooks");
      lines.push("Interpret and execute these prompt hooks after implementation:");
      lines.push("");
      for (const promptHook of postPromptChecks) {
        lines.push(
          `- **${promptHook.name}:** ${promptHook.prompt?.trim() || "(no prompt text configured)"}`,
        );
      }
    }

    for (const skill of postSkills) {
      lines.push("");
      lines.push(`### ${skill.skillName}`);
      lines.push(
        `Call \`report_hook_status\` with \`trigger: "post-implementation"\` (without success/summary) to mark it running, invoke the \`/${skill.skillName}\` skill, then call \`report_hook_status\` again with the result.`,
      );
    }
  }

  // Custom hooks (condition-based)
  const customChecks = (hooks?.checks ?? []).filter(
    (s) => s.enabled !== false && s.trigger === "custom",
  );
  const customCommandChecks = customChecks.filter((s) => !isPromptHook(s));
  const customPromptChecks = customChecks.filter((s) => isPromptHook(s));
  const customSkills = (hooks?.skills ?? []).filter(
    (s: HookSkillRef) => s.enabled && s.trigger === "custom",
  );

  if (customChecks.length > 0 || customSkills.length > 0) {
    lines.push("");
    lines.push("## Hooks (Custom — Condition-Based)");
    lines.push("");
    lines.push(
      "> These hooks have natural-language conditions. Evaluate each condition against the current task and run the hook only when the condition applies.",
    );
    lines.push("");

    for (const check of customCommandChecks) {
      lines.push(`### ${check.name}`);
      if (check.condition) {
        lines.push(`**When:** ${check.condition}`);
      }
      lines.push(`Run \`${check.command}\` in the worktree directory.`);
      lines.push("");
    }

    for (const promptHook of customPromptChecks) {
      lines.push(`### ${promptHook.name}`);
      if (promptHook.condition) {
        lines.push(`**When:** ${promptHook.condition}`);
      }
      lines.push(`**Prompt:** ${promptHook.prompt?.trim() || "(no prompt text configured)"}`);
      lines.push("");
    }

    for (const skill of customSkills) {
      lines.push(`### ${skill.skillName}`);
      if (skill.condition) {
        lines.push(`**When:** ${skill.condition}`);
      }
      lines.push(
        `Call \`report_hook_status\` with \`trigger: "custom"\` (without success/summary) to mark it running, invoke the \`/${skill.skillName}\` skill, then call \`report_hook_status\` again with the result.`,
      );
      lines.push("");
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("*Auto-generated by dawg. Updated when AI Context notes change.*");
  lines.push("");

  return lines.join("\n");
}

function getWorktreeGitExcludePath(worktreePath: string): string | null {
  const dotGitPath = path.join(worktreePath, ".git");
  if (!existsSync(dotGitPath)) return null;

  try {
    const content = readFileSync(dotGitPath, "utf-8").trim();
    // Worktrees have a .git file (not directory) with: gitdir: /path/to/.git/worktrees/<name>
    if (content.startsWith("gitdir:")) {
      const gitDir = content.replace("gitdir:", "").trim();
      return path.join(gitDir, "info", "exclude");
    }
  } catch {
    // Not a worktree .git file
  }

  // Regular .git directory
  return path.join(dotGitPath, "info", "exclude");
}

function ensureGitExclude(worktreePath: string): void {
  const excludePath = getWorktreeGitExcludePath(worktreePath);
  if (!excludePath) return;

  try {
    let content = "";
    if (existsSync(excludePath)) {
      content = readFileSync(excludePath, "utf-8");
    }
    if (!content.includes("TASK.md")) {
      const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      appendFileSync(excludePath, `${separator}TASK.md\n`);
    }
  } catch {
    // Non-critical — ignore
  }
}

export function writeTaskMd(worktreePath: string, content: string): void {
  writeFileSync(path.join(worktreePath, "TASK.md"), content);
  ensureGitExclude(worktreePath);
}

export function writeWorktreeTaskMd(
  worktreePath: string,
  data: TaskContextData,
  notesManager: NotesManager,
  hooks?: HooksInfo | null,
): void {
  const notes = notesManager.loadNotes(data.source, data.issueId);
  const aiContext = notes.aiContext?.content ?? null;
  const content = generateTaskMd(data, aiContext, notes.todos, hooks);
  writeTaskMd(worktreePath, content);
}

function loadIssueData(
  configDir: string,
  source: IssueSource,
  issueId: string,
): TaskContextData | null {
  const issueFile = path.join(configDir, CONFIG_DIR_NAME, "issues", source, issueId, "issue.json");

  if (source === "local") {
    const taskFile = path.join(configDir, CONFIG_DIR_NAME, "issues", "local", issueId, "task.json");
    if (!existsSync(taskFile)) return null;
    try {
      const task = JSON.parse(readFileSync(taskFile, "utf-8"));

      // Load local attachments
      const attDir = path.join(
        configDir,
        CONFIG_DIR_NAME,
        "issues",
        "local",
        issueId,
        "attachments",
      );
      let attachments: TaskContextData["attachments"];
      if (existsSync(attDir)) {
        const metaFile = path.join(attDir, ".meta.json");
        const meta: Record<string, string> = existsSync(metaFile)
          ? JSON.parse(readFileSync(metaFile, "utf-8"))
          : {};
        attachments = readdirSync(attDir)
          .filter((f) => !f.startsWith(".") && statSync(path.join(attDir, f)).isFile())
          .map((f) => ({
            filename: f,
            localPath: path.join(attDir, f),
            mimeType: meta[f] || "application/octet-stream",
          }));
        if (attachments.length === 0) attachments = undefined;
      }

      return {
        source: "local",
        issueId,
        identifier: issueId,
        title: task.title ?? "",
        description: task.description ?? "",
        status: task.status ?? "unknown",
        url: "",
        attachments,
      };
    } catch {
      return null;
    }
  }

  if (!existsSync(issueFile)) return null;

  try {
    const raw = JSON.parse(readFileSync(issueFile, "utf-8"));

    if (source === "jira") {
      return {
        source: "jira",
        issueId,
        identifier: raw.key ?? issueId,
        title: raw.summary ?? "",
        description: raw.description ?? "",
        status: raw.status ?? "Unknown",
        url: raw.url ?? "",
        comments: raw.comments?.slice(0, 10),
      };
    }

    if (source === "linear") {
      return {
        source: "linear",
        issueId,
        identifier: raw.identifier ?? issueId,
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
    // Corrupt file
  }

  return null;
}

export function regenerateTaskMd(
  source: IssueSource,
  issueId: string,
  worktreeId: string,
  notesManager: NotesManager,
  configDir: string,
  worktreesPath: string,
  hooks?: HooksInfo | null,
): void {
  const worktreePath = path.join(worktreesPath, worktreeId);
  if (!existsSync(worktreePath)) return;

  const data = loadIssueData(configDir, source, issueId);
  if (!data) return;

  const notes = notesManager.loadNotes(source, issueId);
  const aiContext = notes.aiContext?.content ?? null;
  const content = generateTaskMd(data, aiContext, notes.todos, hooks);
  writeTaskMd(worktreePath, content);
}
