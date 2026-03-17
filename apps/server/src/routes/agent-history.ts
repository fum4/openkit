import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import os from "os";
import path from "path";

import { log } from "@openkit/server/logger";

export type RestorableAgent = "claude" | "codex";

export interface AgentHistoryMatch {
  sessionId: string;
  title: string;
  updatedAt: string;
  preview?: string;
  gitBranch?: string;
}

export interface ClaudeTranscriptEvent {
  cwd?: unknown;
  sessionId?: unknown;
  timestamp?: unknown;
  type?: unknown;
  subtype?: unknown;
  content?: unknown;
  message?: unknown;
  gitBranch?: unknown;
}

interface CodexSessionIndexEntry {
  id?: unknown;
  thread_name?: unknown;
  updated_at?: unknown;
}

interface CodexSessionMetaEntry {
  timestamp?: unknown;
  type?: unknown;
  payload?: unknown;
}

interface CodexSqliteRow {
  id?: unknown;
  title?: unknown;
  updated_at?: unknown;
}

function walkJsonlFiles(rootDir: string, options?: { skipDirectories?: Set<string> }): string[] {
  if (!existsSync(rootDir)) return [];

  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (options?.skipDirectories?.has(entry.name)) continue;
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function readJsonLines(filePath: string): unknown[] {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  return null;
}

function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

export function isOpenKitAutomatedPrompt(text: string): boolean {
  return (
    text.startsWith("Implement local task") &&
    text.includes("You are already in the correct worktree")
  );
}

export function extractClaudeMessagePreview(event: ClaudeTranscriptEvent): string | null {
  const rawMessage = event.message;
  if (
    rawMessage &&
    typeof rawMessage === "object" &&
    "content" in rawMessage &&
    typeof (rawMessage as { content?: unknown }).content === "string"
  ) {
    const content = stripMarkup((rawMessage as { content: string }).content);
    if (content.length === 0 || isOpenKitAutomatedPrompt(content)) return null;
    return content;
  }

  if (typeof event.content === "string") {
    const content = stripMarkup(event.content);
    if (
      content.length > 0 &&
      event.subtype !== "local_command" &&
      !isOpenKitAutomatedPrompt(content)
    ) {
      return content;
    }
  }

  return null;
}

function buildClaudeFallbackTitle(sessionId: string, gitBranch: string | null): string {
  if (gitBranch) {
    return `Claude session (${gitBranch})`;
  }
  return `Claude session ${sessionId.slice(0, 8)}`;
}

function findClaudeHistoryMatches(worktreePath: string): AgentHistoryMatch[] {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  const matchesBySessionId = new Map<
    string,
    AgentHistoryMatch & { updatedAtMs: number; previewRank: number; sourceFile: string }
  >();

  for (const filePath of walkJsonlFiles(projectsDir, { skipDirectories: new Set(["subagents"]) })) {
    const fileName = path.basename(filePath);
    if (fileName === "sessions-index.json") continue;

    const lines = readJsonLines(filePath) as ClaudeTranscriptEvent[];
    if (lines.length === 0) continue;

    let matchesWorktree = false;
    let sessionId: string | null = null;
    let updatedAt: string | null = null;
    let preview: string | null = null;
    let gitBranch: string | null = null;

    for (const line of lines) {
      if (line.cwd === worktreePath) {
        matchesWorktree = true;
      }
      if (!sessionId && typeof line.sessionId === "string" && line.sessionId.length > 0) {
        sessionId = line.sessionId;
      }
      if (!gitBranch && typeof line.gitBranch === "string" && line.gitBranch.length > 0) {
        gitBranch = line.gitBranch;
      }

      const lineTimestamp = normalizeTimestamp(line.timestamp);
      if (lineTimestamp && (!updatedAt || lineTimestamp > updatedAt)) {
        updatedAt = lineTimestamp;
      }

      if (!preview) {
        const maybePreview = extractClaudeMessagePreview(line);
        if (maybePreview) {
          preview = maybePreview;
        }
      }
    }

    if (!matchesWorktree || !sessionId) continue;

    const effectiveUpdatedAt = updatedAt ?? new Date(0).toISOString();
    const previewText = preview ? truncate(preview, 160) : undefined;
    const title = previewText
      ? truncate(previewText, 80)
      : buildClaudeFallbackTitle(sessionId, gitBranch);
    const nextMatch = {
      sessionId,
      title,
      updatedAt: effectiveUpdatedAt,
      preview: previewText,
      gitBranch: gitBranch ?? undefined,
      updatedAtMs: Date.parse(effectiveUpdatedAt),
      previewRank: previewText ? 1 : 0,
      sourceFile: filePath,
    };

    const existing = matchesBySessionId.get(sessionId);
    if (
      !existing ||
      nextMatch.updatedAtMs > existing.updatedAtMs ||
      (nextMatch.updatedAtMs === existing.updatedAtMs &&
        nextMatch.previewRank > existing.previewRank)
    ) {
      matchesBySessionId.set(sessionId, nextMatch);
    }
  }

  const sorted = [...matchesBySessionId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  // Debug: log match details for diagnosing cross-project session confusion
  if (sorted.length > 0) {
    log.debug("Claude history match details", {
      domain: "agent-history",
      worktreePath,
      matchCount: sorted.length,
      matches: sorted.map((m) => ({
        sessionId: m.sessionId,
        sourceFile: m.sourceFile.replace(os.homedir(), "~"),
        title: m.title.slice(0, 40),
      })),
    });
  }

  return sorted.map(
    ({ updatedAtMs: _updatedAtMs, previewRank: _previewRank, sourceFile: _sourceFile, ...match }) =>
      match,
  );
}

function escapeSqliteString(value: string): string {
  return value.replace(/'/g, "''");
}

function findCodexHistoryMatchesFromSqlite(worktreePath: string): AgentHistoryMatch[] {
  const sqlitePath = path.join(os.homedir(), ".codex", "state_5.sqlite");
  if (!existsSync(sqlitePath)) return [];

  const sql = `
    SELECT id, title, updated_at
    FROM threads
    WHERE archived = 0 AND cwd = '${escapeSqliteString(worktreePath)}'
    ORDER BY updated_at DESC
  `;

  const raw = execFileSync("sqlite3", ["-json", sqlitePath, sql], { encoding: "utf-8" }).trim();
  if (!raw) return [];

  const rows = JSON.parse(raw) as CodexSqliteRow[];
  const matches: AgentHistoryMatch[] = [];

  for (const row of rows) {
    if (typeof row.id !== "string" || row.id.length === 0) continue;
    const updatedAt = normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString();
    const preview =
      typeof row.title === "string" && row.title.trim().length > 0 ? row.title.trim() : undefined;
    matches.push({
      sessionId: row.id,
      title: preview ? truncate(preview, 80) : `Codex session ${row.id.slice(0, 8)}`,
      updatedAt,
      preview: preview ? truncate(preview, 160) : undefined,
    });
  }

  return matches;
}

function extractCodexSessionMeta(filePath: string): { sessionId: string; cwd: string } | null {
  const lines = readJsonLines(filePath) as CodexSessionMetaEntry[];
  if (lines.length === 0) return null;

  const firstLine = lines[0];
  if (firstLine.type !== "session_meta") return null;
  const payload = firstLine.payload;
  if (!payload || typeof payload !== "object") return null;

  const sessionId =
    "id" in payload && typeof (payload as { id?: unknown }).id === "string"
      ? (payload as { id: string }).id
      : null;
  const cwd =
    "cwd" in payload && typeof (payload as { cwd?: unknown }).cwd === "string"
      ? (payload as { cwd: string }).cwd
      : null;

  if (!sessionId || !cwd) return null;
  return { sessionId, cwd };
}

function findCodexHistoryMatchesFromIndex(worktreePath: string): AgentHistoryMatch[] {
  const sessionIndexPath = path.join(os.homedir(), ".codex", "session_index.jsonl");
  const sessionsDir = path.join(os.homedir(), ".codex", "sessions");
  if (!existsSync(sessionIndexPath) || !existsSync(sessionsDir)) return [];

  const matchingSessionIds = new Set<string>();
  for (const filePath of walkJsonlFiles(sessionsDir)) {
    const meta = extractCodexSessionMeta(filePath);
    if (!meta || meta.cwd !== worktreePath) continue;
    matchingSessionIds.add(meta.sessionId);
  }

  if (matchingSessionIds.size === 0) return [];

  const lines = readJsonLines(sessionIndexPath) as CodexSessionIndexEntry[];
  const matches: AgentHistoryMatch[] = [];

  for (const entry of lines) {
    if (typeof entry.id !== "string" || !matchingSessionIds.has(entry.id)) continue;
    const preview =
      typeof entry.thread_name === "string" && entry.thread_name.trim().length > 0
        ? entry.thread_name.trim()
        : undefined;
    matches.push({
      sessionId: entry.id,
      title: preview ? truncate(preview, 80) : `Codex session ${entry.id.slice(0, 8)}`,
      updatedAt: normalizeTimestamp(entry.updated_at) ?? new Date(0).toISOString(),
      preview: preview ? truncate(preview, 160) : undefined,
    });
  }

  return matches.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function findCodexHistoryMatches(worktreePath: string): AgentHistoryMatch[] {
  try {
    return findCodexHistoryMatchesFromSqlite(worktreePath);
  } catch {
    return findCodexHistoryMatchesFromIndex(worktreePath);
  }
}

export function findHistoricalAgentSessions(
  agent: RestorableAgent,
  worktreePath: string,
): AgentHistoryMatch[] {
  if (agent === "claude") {
    return findClaudeHistoryMatches(worktreePath);
  }
  return findCodexHistoryMatches(worktreePath);
}
