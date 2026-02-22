import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import { CLAUDE_SKILL, CURSOR_RULE, VSCODE_PROMPT } from "../../instructions";
import type { AgentId, Scope } from "./tool-configs";

// ─── Deploy/remove per agent ─────────────────────────────────────

interface InstructionFile {
  /** Path relative to project root (project scope) or absolute (global scope) */
  getPath: (projectDir: string, scope: Scope) => string | null;
  content: string;
  /** Whether the file lives inside a directory that should be removed as a unit */
  isDir?: boolean;
}

const AGENT_INSTRUCTIONS: Partial<Record<AgentId, InstructionFile[]>> = {
  claude: [
    {
      getPath: (_projectDir, scope) =>
        scope === "global"
          ? path.join(os.homedir(), ".claude", "skills", "work", "SKILL.md")
          : path.join(_projectDir, ".claude", "skills", "work", "SKILL.md"),
      content: CLAUDE_SKILL,
      isDir: true,
    },
  ],
  cursor: [
    {
      getPath: (projectDir, scope) =>
        // Cursor global rules are in IDE settings, not files — project only
        scope === "project" ? path.join(projectDir, ".cursor", "rules", "OpenKit.mdc") : null,
      content: CURSOR_RULE,
    },
  ],
  vscode: [
    {
      getPath: (projectDir, scope) =>
        // VS Code global is IDE settings — project only
        scope === "project" ? path.join(projectDir, ".github", "prompts", "work.prompt.md") : null,
      content: VSCODE_PROMPT,
    },
  ],
  // Codex and Gemini use single-file instruction systems (AGENTS.md, GEMINI.md)
  // that we can't safely auto-deploy into. MCP_INSTRUCTIONS cover them.
};

const CLAUDE_AUTO_ALLOW = ["mcp__OpenKit__*"];

function mergeClaudeSettings(filePath: string, permissions: string[]): void {
  let settings: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      settings = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      /* ignore */
    }
  }
  const perms = (settings.permissions ?? {}) as Record<string, unknown>;
  const allow = new Set<string>((perms.allow ?? []) as string[]);
  for (const p of permissions) allow.add(p);
  perms.allow = [...allow];
  settings.permissions = perms;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
}

function unmergeClaudeSettings(filePath: string, permissions: string[]): void {
  if (!existsSync(filePath)) return;
  try {
    const settings = JSON.parse(readFileSync(filePath, "utf-8"));
    const perms = settings.permissions ?? {};
    const allow = ((perms.allow ?? []) as string[]).filter((p: string) => !permissions.includes(p));
    if (allow.length > 0) {
      perms.allow = allow;
      settings.permissions = perms;
      writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
    } else {
      delete perms.allow;
      if (Object.keys(perms).length === 0) delete settings.permissions;
      if (Object.keys(settings).length === 0) {
        rmSync(filePath);
      } else {
        writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
      }
    }
  } catch {
    /* ignore */
  }
}

export function deployAgentInstructions(agent: AgentId, projectDir: string, scope: Scope): void {
  const files = AGENT_INSTRUCTIONS[agent];
  if (!files) return;

  for (const file of files) {
    const filePath = file.getPath(projectDir, scope);
    if (!filePath) continue;

    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
  }

  // Auto-approve OpenKit MCP tools in Claude settings
  if (agent === "claude") {
    const settingsPath =
      scope === "global"
        ? path.join(os.homedir(), ".claude", "settings.json")
        : path.join(projectDir, ".claude", "settings.json");
    mergeClaudeSettings(settingsPath, CLAUDE_AUTO_ALLOW);
  }
}

export function removeAgentInstructions(agent: AgentId, projectDir: string, scope: Scope): void {
  const files = AGENT_INSTRUCTIONS[agent];
  if (!files) return;

  for (const file of files) {
    const filePath = file.getPath(projectDir, scope);
    if (!filePath || !existsSync(filePath)) continue;

    if (file.isDir) {
      // Remove the parent directory (e.g., .claude/skills/work/)
      rmSync(path.dirname(filePath), { recursive: true });
    } else {
      rmSync(filePath);
    }
  }

  // Remove OpenKit MCP tool permissions from Claude settings
  if (agent === "claude") {
    const settingsPath =
      scope === "global"
        ? path.join(os.homedir(), ".claude", "settings.json")
        : path.join(projectDir, ".claude", "settings.json");
    unmergeClaudeSettings(settingsPath, CLAUDE_AUTO_ALLOW);
  }
}
