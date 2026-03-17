import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";
import type { IssueSource } from "@openkit/shared/notes-types";
import {
  generateTaskMd,
  writeTaskMd,
  type TaskContextData,
  type HooksInfo,
} from "@openkit/shared/task-context";
import type { NotesManager } from "./notes-manager";

// Re-export shared types and functions so server-internal imports stay unchanged
export { generateTaskMd, writeTaskMd, type TaskContextData, type HooksInfo };

export interface PendingTaskContext {
  data: TaskContextData;
  aiContext?: string | null;
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
