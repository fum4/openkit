import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";

// ─── Types ──────────────────────────────────────────────────────

export type AgentId = "claude" | "gemini" | "codex" | "cursor" | "vscode";
export type Scope = "global" | "project";

export interface ScopeSpec {
  configPath: string;
  format: "json" | "toml";
  jsonPath?: string[];
}

export interface AgentSpec {
  global?: ScopeSpec;
  project?: ScopeSpec;
}

export interface McpServerEntry {
  type?: "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

// ─── Agent specs ────────────────────────────────────────────────

export const AGENT_SPECS: Record<AgentId, AgentSpec> = {
  claude: {
    global: {
      configPath: "~/.claude/settings.json",
      format: "json",
      jsonPath: ["mcpServers"],
    },
    project: {
      configPath: ".mcp.json",
      format: "json",
      jsonPath: ["mcpServers"],
    },
  },
  gemini: {
    global: {
      configPath: "~/.gemini/settings.json",
      format: "json",
      jsonPath: ["mcpServers"],
    },
    project: {
      configPath: ".gemini/settings.json",
      format: "json",
      jsonPath: ["mcpServers"],
    },
  },
  codex: {
    global: {
      configPath: "~/.codex/config.toml",
      format: "toml",
    },
    project: {
      configPath: ".codex/config.toml",
      format: "toml",
    },
  },
  cursor: {
    global: {
      configPath: "~/.cursor/mcp.json",
      format: "json",
      jsonPath: ["mcpServers"],
    },
    project: {
      configPath: ".cursor/mcp.json",
      format: "json",
      jsonPath: ["mcpServers"],
    },
  },
  vscode: {
    global: {
      configPath: "~/Library/Application Support/Code/User/settings.json",
      format: "json",
      jsonPath: ["mcp", "servers"],
    },
    project: {
      configPath: ".vscode/settings.json",
      format: "json",
      jsonPath: ["mcp", "servers"],
    },
  },
};

export const VALID_AGENTS = new Set(Object.keys(AGENT_SPECS));

// ─── Skill deployment specs ─────────────────────────────────

export interface SkillDirSpec {
  global?: string; // Absolute path template (~ = home)
  project?: string; // Relative to project root
}

export const SKILL_AGENT_SPECS: Record<AgentId, SkillDirSpec> = {
  claude: { global: "~/.claude/skills", project: ".claude/skills" },
  cursor: { global: "~/.cursor/skills", project: ".cursor/skills" },
  gemini: { global: "~/.gemini/skills", project: ".gemini/skills" },
  codex: { global: "~/.codex/skills", project: ".codex/skills" },
  vscode: { global: "~/.vscode/skills", project: ".vscode/skills" },
};

export function resolveSkillDeployDir(
  agent: AgentId,
  scope: Scope,
  projectDir: string,
): string | null {
  const spec = SKILL_AGENT_SPECS[agent];
  if (!spec) return null;
  const template = scope === "global" ? spec.global : spec.project;
  if (!template) return null;
  if (template.startsWith("~")) {
    return path.join(os.homedir(), template.slice(2));
  }
  return path.join(projectDir, template);
}

// ─── Utility functions ──────────────────────────────────────────

export function stripJsonComments(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") {
          result += text[i++];
        }
        if (i < text.length) {
          result += text[i++];
        }
      }
      if (i < text.length) {
        result += text[i++];
      }
    } else if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += text[i++];
    }
  }
  return result;
}

export function parseJsonFile(
  filePath: string,
): { data: Record<string, unknown>; error?: string } | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return { data: JSON.parse(stripJsonComments(raw)) };
  } catch {
    return { data: {}, error: "Failed to parse config file" };
  }
}

export function resolveConfigPath(configPath: string, projectDir: string): string {
  if (configPath.startsWith("~")) {
    return path.join(os.homedir(), configPath.slice(2));
  }
  return path.join(projectDir, configPath);
}

export function getScopeSpec(agent: AgentId, scope: Scope): ScopeSpec | null {
  return AGENT_SPECS[agent][scope] ?? null;
}

// ─── Generic server read/write ──────────────────────────────────

/** Check if a specific server key exists in a config file */
export function isServerConfigured(filePath: string, spec: ScopeSpec, serverKey: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    if (spec.format === "toml") {
      return readFileSync(filePath, "utf-8").includes(`[mcp_servers.${serverKey}]`);
    }
    const parsed = parseJsonFile(filePath);
    if (!parsed || parsed.error) return false;
    let obj: unknown = parsed.data;
    for (const key of spec.jsonPath!) {
      obj = (obj as Record<string, unknown>)?.[key];
    }
    return (obj as Record<string, unknown>)?.[serverKey] != null;
  } catch {
    return false;
  }
}

/** Read all MCP server entries from a config file */
export function readAllServers(filePath: string, spec: ScopeSpec): Record<string, McpServerEntry> {
  if (!existsSync(filePath)) return {};

  try {
    if (spec.format === "toml") {
      return parseTomlServers(readFileSync(filePath, "utf-8"));
    }

    const parsed = parseJsonFile(filePath);
    if (!parsed || parsed.error) return {};

    let obj: unknown = parsed.data;
    for (const key of spec.jsonPath!) {
      obj = (obj as Record<string, unknown>)?.[key];
    }

    if (!obj || typeof obj !== "object") return {};

    const result: Record<string, McpServerEntry> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        const entry = val as Record<string, unknown>;
        if ("url" in entry && typeof entry.url === "string") {
          result[key] = {
            type: (entry.type as "http" | "sse") ?? "http",
            url: entry.url,
          };
        } else if ("command" in entry) {
          result[key] = {
            command: String(entry.command ?? ""),
            args: Array.isArray(entry.args) ? entry.args.map(String) : [],
            env:
              entry.env && typeof entry.env === "object"
                ? (entry.env as Record<string, string>)
                : undefined,
          };
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Write a server entry to a config file */
export function writeServerToConfig(
  filePath: string,
  spec: ScopeSpec,
  serverKey: string,
  entry: McpServerEntry,
): { success: boolean; error?: string } {
  if (spec.format === "toml") {
    return writeTomlServer(filePath, serverKey, entry);
  }
  return writeJsonServer(filePath, spec.jsonPath!, serverKey, entry);
}

/** Remove a server entry from a config file */
export function removeServerFromConfig(
  filePath: string,
  spec: ScopeSpec,
  serverKey: string,
): { success: boolean; error?: string } {
  if (spec.format === "toml") {
    return removeTomlServer(filePath, serverKey);
  }
  return removeJsonServer(filePath, spec.jsonPath!, serverKey);
}

// ─── JSON helpers ───────────────────────────────────────────────

function writeJsonServer(
  filePath: string,
  jsonPath: string[],
  serverKey: string,
  entry: McpServerEntry,
): { success: boolean; error?: string } {
  let json: Record<string, unknown> = {};

  const parsed = parseJsonFile(filePath);
  if (parsed) {
    if (parsed.error) return { success: false, error: parsed.error };
    json = parsed.data;
  }

  let obj: Record<string, unknown> = json;
  for (const key of jsonPath) {
    if (obj[key] == null || typeof obj[key] !== "object") {
      obj[key] = {};
    }
    obj = obj[key] as Record<string, unknown>;
  }

  const serverObj: Record<string, unknown> = entry.url
    ? { type: entry.type ?? "http", url: entry.url }
    : { command: entry.command, args: entry.args ?? [] };
  if (entry.env && Object.keys(entry.env).length > 0) {
    serverObj.env = entry.env;
  }
  obj[serverKey] = serverObj;

  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
  return { success: true };
}

function removeJsonServer(
  filePath: string,
  jsonPath: string[],
  serverKey: string,
): { success: boolean; error?: string } {
  const parsed = parseJsonFile(filePath);
  if (!parsed) return { success: true };
  if (parsed.error) return { success: false, error: parsed.error };

  const json = parsed.data;
  let obj: Record<string, unknown> = json;
  for (const key of jsonPath) {
    if (obj[key] == null || typeof obj[key] !== "object") {
      return { success: true };
    }
    obj = obj[key] as Record<string, unknown>;
  }

  delete obj[serverKey];
  writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
  return { success: true };
}

// ─── TOML helpers ───────────────────────────────────────────────

/** Parse all [mcp_servers.*] sections from TOML content */
function parseTomlServers(content: string): Record<string, McpServerEntry> {
  const result: Record<string, McpServerEntry> = {};
  const sectionRe = /^\[mcp_servers\.([^\].]+)\]\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = sectionRe.exec(content)) !== null) {
    const serverKey = match[1];
    const startIdx = match.index + match[0].length;

    // Find the end of this section (next [...] or end of file)
    const nextSection = content.indexOf("\n[", startIdx);
    const block = content.slice(startIdx, nextSection === -1 ? undefined : nextSection);

    let command = "";
    let url = "";
    let args: string[] = [];
    const env: Record<string, string> = {};

    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      const cmdMatch = trimmed.match(/^command\s*=\s*"([^"]*)"$/);
      if (cmdMatch) {
        command = cmdMatch[1];
        continue;
      }

      const urlMatch = trimmed.match(/^url\s*=\s*"([^"]*)"$/);
      if (urlMatch) {
        url = urlMatch[1];
        continue;
      }

      const argsMatch = trimmed.match(/^args\s*=\s*\[(.*)?\]$/);
      if (argsMatch && argsMatch[1]) {
        args = argsMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
        continue;
      }

      const envMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"([^"]*)"$/);
      if (envMatch && !["command", "args", "url", "type"].includes(envMatch[1])) {
        env[envMatch[1]] = envMatch[2];
      }
    }

    const envObj = Object.keys(env).length > 0 ? { env } : {};
    if (url) {
      result[serverKey] = { type: "http", url, ...envObj };
    } else if (command) {
      result[serverKey] = { command, args, ...envObj };
    }
  }

  return result;
}

function writeTomlServer(
  filePath: string,
  serverKey: string,
  entry: McpServerEntry,
): { success: boolean; error?: string } {
  let content = "";

  if (existsSync(filePath)) {
    content = readFileSync(filePath, "utf-8");
    content = removeTomlSection(content, serverKey);
  }

  let tomlBlock: string;
  if (entry.url) {
    tomlBlock = `\n[mcp_servers.${serverKey}]\ntype = "${entry.type ?? "http"}"\nurl = "${entry.url}"\n`;
  } else {
    const argsStr = (entry.args ?? []).map((a) => `"${a}"`).join(", ");
    tomlBlock = `\n[mcp_servers.${serverKey}]\ncommand = "${entry.command}"\nargs = [${argsStr}]\n`;
  }

  if (entry.env && Object.keys(entry.env).length > 0) {
    tomlBlock += `\n[mcp_servers.${serverKey}.env]\n`;
    for (const [k, v] of Object.entries(entry.env)) {
      tomlBlock += `${k} = "${v}"\n`;
    }
  }

  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, content + tomlBlock);
  return { success: true };
}

function removeTomlServer(
  filePath: string,
  serverKey: string,
): { success: boolean; error?: string } {
  if (!existsSync(filePath)) return { success: true };

  let content = readFileSync(filePath, "utf-8");
  if (!content.includes(`[mcp_servers.${serverKey}]`)) return { success: true };

  content = removeTomlSection(content, serverKey);
  writeFileSync(filePath, content);
  return { success: true };
}

/** Remove a [mcp_servers.KEY] section and its sub-sections from TOML content */
function removeTomlSection(content: string, serverKey: string): string {
  const escaped = serverKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\n?\\[mcp_servers\\.${escaped}(?:\\.[^\\]]*)?\\][^\\[]*`, "g");
  return content.replace(re, "");
}

// ─── Filesystem scanner ─────────────────────────────────────────

/** File names/patterns that may contain MCP server definitions */
const MCP_FILE_CANDIDATES = new Set([".mcp.json", "mcp.json", "settings.json", "config.toml"]);

/** Directories to skip during recursive scan */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  "target",
  "Library",
  "Applications",
  "Pictures",
  "Music",
  "Movies",
  "Downloads",
  "Public",
  ".Trash",
]);

export interface FilesystemScanResult {
  key: string;
  entry: McpServerEntry;
  filePath: string;
}

/**
 * Scan a directory tree for files that contain MCP server definitions.
 * Checks JSON files for known MCP key paths and TOML files for [mcp_servers.*].
 */
export function scanFilesystemForServers(rootDir: string, maxDepth = 5): FilesystemScanResult[] {
  const results: FilesystemScanResult[] = [];
  const visited = new Set<string>();

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;

    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return; // permission denied, etc.
    }

    for (const name of names) {
      const fullPath = path.join(dir, name);

      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(fullPath, { throwIfNoEntry: false })!;
        if (!st) continue;
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        if (name.startsWith(".") && depth > 1 && !isKnownDotDir(name)) continue;
        walk(fullPath, depth + 1);
        continue;
      }

      if (!st.isFile()) continue;
      if (!MCP_FILE_CANDIDATES.has(name)) continue;

      const filePath = fullPath;

      // Avoid scanning the same file twice (via symlinks, etc.)
      let realPath: string;
      try {
        realPath = realpathSync(filePath);
      } catch {
        continue;
      }
      if (visited.has(realPath)) continue;
      visited.add(realPath);

      // Skip files that are too large (> 1MB) to avoid reading huge settings.json
      if (st.size > 1_048_576) continue;

      const servers = extractServersFromFile(filePath);
      for (const [key, serverEntry] of Object.entries(servers)) {
        results.push({ key, entry: serverEntry, filePath });
      }
    }
  }

  walk(rootDir, 0);
  return results;
}

/** Known dot-directories that may contain tool configs */
function isKnownDotDir(name: string): boolean {
  return [".claude", ".cursor", ".gemini", ".codex", ".vscode", ".openkit", ".config"].includes(
    name,
  );
}

/**
 * Try to extract MCP server entries from a file.
 * Handles JSON (tries several known key paths) and TOML.
 */
function extractServersFromFile(filePath: string): Record<string, McpServerEntry> {
  try {
    const raw = readFileSync(filePath, "utf-8");

    if (filePath.endsWith(".toml")) {
      return parseTomlServers(raw);
    }

    // JSON: try multiple known key paths
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(stripJsonComments(raw));
    } catch {
      return {};
    }

    // Try each known JSON path where MCP servers might live
    const jsonPaths = [["mcpServers"], ["mcp", "servers"], ["servers"]];

    for (const jsonPath of jsonPaths) {
      let obj: unknown = data;
      for (const key of jsonPath) {
        obj = (obj as Record<string, unknown>)?.[key];
      }
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const entries = extractServerEntries(obj as Record<string, unknown>);
        if (Object.keys(entries).length > 0) return entries;
      }
    }

    return {};
  } catch {
    return {};
  }
}

function extractServerEntries(obj: Record<string, unknown>): Record<string, McpServerEntry> {
  const result: Record<string, McpServerEntry> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === "object") {
      const entry = val as Record<string, unknown>;
      if ("url" in entry && typeof entry.url === "string") {
        result[key] = {
          type: (entry.type as "http" | "sse") ?? "http",
          url: entry.url,
        };
      } else if ("command" in entry) {
        result[key] = {
          command: String(entry.command ?? ""),
          args: Array.isArray(entry.args) ? entry.args.map(String) : [],
          env:
            entry.env && typeof entry.env === "object"
              ? (entry.env as Record<string, string>)
              : undefined,
        };
      }
    }
  }
  return result;
}

/**
 * Get the default scan roots for a "device" scan.
 * Scans the home directory plus common global config locations.
 */
export function getDeviceScanRoots(): string[] {
  const home = os.homedir();
  return [home];
}
