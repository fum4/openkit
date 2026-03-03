import { execFile as execFileCb } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { Hono } from "hono";

import type { WorktreeManager } from "../manager";
import { CUSTOM_AGENT_SPECS, type AgentId, resolveAgentDeployDir } from "../lib/tool-configs";

const execFile = promisify(execFileCb);

// ─── CLI helper ─────────────────────────────────────────────────

interface CliResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

async function runClaude(args: string[], timeout = 15_000): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFile("claude", args, {
      encoding: "utf-8",
      timeout,
    });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      stdout: (e.stdout ?? "").trim(),
      stderr: (e.stderr ?? e.message ?? "Unknown error").trim(),
    };
  }
}

function tryParseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// ─── Cache ──────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache: Record<string, CacheEntry<unknown>> = {};

function getCached<T>(key: string): T | null {
  const entry = cache[key];
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache[key] = { data, expiresAt: Date.now() + ttlMs };
}

function invalidateCache(prefix: string): void {
  for (const key of Object.keys(cache)) {
    if (key.startsWith(prefix)) delete cache[key];
  }
}

// ─── Fallback: read plugins from settings files ─────────────────

interface SettingsPluginEntry {
  name: string;
  enabled: boolean;
  scope: "user" | "project" | "local";
}

function readSettingsPlugins(projectDir: string): SettingsPluginEntry[] {
  const results: SettingsPluginEntry[] = [];

  const scopes: Array<{ scope: "user" | "project" | "local"; path: string }> = [
    {
      scope: "user",
      path: path.join(os.homedir(), ".claude", "settings.json"),
    },
    {
      scope: "project",
      path: path.join(projectDir, ".claude", "settings.json"),
    },
    {
      scope: "local",
      path: path.join(projectDir, ".claude", "settings.local.json"),
    },
  ];

  for (const { scope, path: settingsPath } of scopes) {
    if (!existsSync(settingsPath)) continue;
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      const plugins = settings.plugins;
      if (!plugins || typeof plugins !== "object") continue;

      if (Array.isArray(plugins)) {
        for (const p of plugins) {
          if (typeof p === "string") results.push({ name: p, enabled: true, scope });
          else if (p && typeof p === "object")
            results.push({ name: p.name, enabled: p.enabled !== false, scope });
        }
      } else {
        for (const [name, value] of Object.entries(plugins)) {
          results.push({ name, enabled: value !== false, scope });
        }
      }
    } catch {
      // Skip unreadable
    }
  }

  return results;
}

// ─── Component scanning ─────────────────────────────────────────

interface PluginComponents {
  commands: string[];
  agents: string[];
  skills: string[];
  mcpServers: string[];
  hasHooks: boolean;
  hasLsp: boolean;
}

interface ClaudeAgentEntry {
  id: string;
  name: string;
  description: string;
  pluginId: string;
  pluginName: string;
  pluginScope: "user" | "project" | "local";
  pluginEnabled: boolean;
  marketplace: string;
  installPath: string;
  agentPath: string;
  deployments?: Record<string, { global?: boolean; project?: boolean }>;
}

const SUPPORTED_AGENTS = Object.keys(CUSTOM_AGENT_SPECS) as AgentId[];
const SUPPORTED_SCOPES = new Set(["global", "project"]);

function parsePluginAgentId(id: string): { pluginId: string; agentName: string } | null {
  const separator = id.indexOf("::");
  if (separator === -1) return null;

  const pluginId = id.slice(0, separator);
  const agentName = id.slice(separator + 2);
  if (!pluginId || !agentName) return null;
  return { pluginId, agentName };
}

function getClaudeDeploymentScope(scope: "user" | "project" | "local"): "global" | "project" {
  return scope === "user" ? "global" : "project";
}

function getPluginAgentDeployments(
  agentName: string,
  pluginScope: "user" | "project" | "local",
  pluginEnabled: boolean,
  projectDir: string,
): Record<string, { global?: boolean; project?: boolean }> {
  const deployments: Record<string, { global?: boolean; project?: boolean }> = {};

  for (const agentId of SUPPORTED_AGENTS) {
    if (agentId === "claude") {
      const scope = getClaudeDeploymentScope(pluginScope);
      deployments[agentId] = pluginEnabled ? { [scope]: true } : {};
      continue;
    }

    deployments[agentId] = {
      global: (() => {
        const deployDir = resolveAgentDeployDir(agentId, "global", projectDir);
        if (!deployDir) return false;
        return existsSync(path.join(deployDir, `${agentName}.md`));
      })(),
      project: (() => {
        const deployDir = resolveAgentDeployDir(agentId, "project", projectDir);
        if (!deployDir) return false;
        return existsSync(path.join(deployDir, `${agentName}.md`));
      })(),
    };
  }

  return deployments;
}

function extractFrontmatterDescription(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fmMatch) {
    const descMatch = fmMatch[1].match(/^\s*description\s*:\s*(.+)\s*$/m);
    if (descMatch?.[1]) {
      return descMatch[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }

  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const firstLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  return firstLine ?? "";
}

function scanPluginAgents(
  installPath: string,
  pluginId: string,
  pluginName: string,
  pluginScope: "user" | "project" | "local",
  pluginEnabled: boolean,
  marketplace: string,
): ClaudeAgentEntry[] {
  const agentsDir = path.join(installPath, "agents");
  if (!existsSync(agentsDir)) return [];

  try {
    return readdirSync(agentsDir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => {
        const name = file.replace(/\.md$/, "");
        const agentPath = path.join(agentsDir, file);
        const content = readFileSync(agentPath, "utf-8");
        return {
          id: `${pluginId}::${name}`,
          name,
          description: extractFrontmatterDescription(content),
          pluginId,
          pluginName,
          pluginScope,
          pluginEnabled,
          marketplace,
          installPath,
          agentPath,
        };
      });
  } catch {
    return [];
  }
}

function scanPluginComponents(installPath: string): PluginComponents {
  const result: PluginComponents = {
    commands: [],
    agents: [],
    skills: [],
    mcpServers: [],
    hasHooks: false,
    hasLsp: false,
  };

  // commands/*.md
  const cmdsDir = path.join(installPath, "commands");
  if (existsSync(cmdsDir)) {
    try {
      result.commands = readdirSync(cmdsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""));
    } catch {
      /* ignore */
    }
  }

  // agents/*.md
  const agentsDir = path.join(installPath, "agents");
  if (existsSync(agentsDir)) {
    try {
      result.agents = readdirSync(agentsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""));
    } catch {
      /* ignore */
    }
  }

  // skills/* (subdirectories)
  const skillsDir = path.join(installPath, "skills");
  if (existsSync(skillsDir)) {
    try {
      result.skills = readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      /* ignore */
    }
  }

  // .mcp.json → keys are server names (handles both wrapped and flat format)
  const mcpServers = parseMcpConfig(installPath);
  result.mcpServers = Object.keys(mcpServers);

  // hooks/hooks.json
  result.hasHooks = existsSync(path.join(installPath, "hooks", "hooks.json"));

  // .lsp.json
  result.hasLsp = existsSync(path.join(installPath, ".lsp.json"));

  return result;
}

// ─── Plugin health detection ─────────────────────────────────────

interface McpServerConfig {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Parse .mcp.json — handles both { mcpServers: {...} } and flat { serverName: {...} } formats */
function parseMcpConfig(installPath: string): Record<string, McpServerConfig> {
  const mcpPath = path.join(installPath, ".mcp.json");
  if (!existsSync(mcpPath)) return {};
  try {
    const raw = JSON.parse(readFileSync(mcpPath, "utf-8"));
    // Wrapped format: { mcpServers: { name: config } }
    if (raw.mcpServers && typeof raw.mcpServers === "object") return raw.mcpServers;
    // Flat format: { name: config } — filter out non-object entries
    const result: Record<string, McpServerConfig> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === "object" && !Array.isArray(v)) result[k] = v as McpServerConfig;
    }
    return result;
  } catch {
    return {};
  }
}

/** Check if a command exists on the system */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFile("which", [cmd], { encoding: "utf-8", timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

interface HealthCheckResult {
  error?: string;
  warning?: string;
}

// Cache health check results (30s TTL) to avoid re-checking on every request
const healthCache = new Map<string, { result: HealthCheckResult; expiresAt: number }>();

/** Check plugin health by probing its MCP servers */
async function checkPluginHealth(
  installPath: string,
  pluginId: string,
): Promise<HealthCheckResult> {
  const cached = healthCache.get(pluginId);
  if (cached && Date.now() < cached.expiresAt) return cached.result;

  const servers = parseMcpConfig(installPath);
  const serverEntries = Object.entries(servers);
  if (serverEntries.length === 0) {
    const result: HealthCheckResult = {};
    healthCache.set(pluginId, { result, expiresAt: Date.now() + 30_000 });
    return result;
  }

  let result: HealthCheckResult = {};

  for (const [, cfg] of serverEntries) {
    // HTTP MCP servers: check if they need OAuth
    if (cfg.type === "http" && cfg.url) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(cfg.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "initialize",
            id: 1,
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "OpenKit", version: "1.0.0" },
            },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.status === 401 || res.status === 403) {
          result = { warning: "Needs authentication" };
          break;
        }
      } catch {
        // Connection failed — likely auth redirect or server issue
        result = { warning: "Needs authentication" };
        break;
      }
    }

    // Command-based MCP servers: check if command exists
    if (cfg.command) {
      const cmd = cfg.command;
      if (!(await commandExists(cmd))) {
        result = { error: `Command not found: ${cmd}` };
        break;
      }
    }

    // Check for unset env vars
    if (cfg.env && typeof cfg.env === "object") {
      for (const [key, val] of Object.entries(cfg.env)) {
        if (!val || /^\$\{.*\}$/.test(val) || val === "YOUR_API_KEY" || val === "TODO") {
          result = { warning: `MCP server needs configuration (${key})` };
          break;
        }
      }
      if (result.error || result.warning) break;
    }
  }

  healthCache.set(pluginId, { result, expiresAt: Date.now() + 30_000 });
  return result;
}

// ─── Routes ─────────────────────────────────────────────────────

export function registerClaudePluginRoutes(app: Hono, manager: WorktreeManager) {
  const projectDir = manager.getConfigDir();

  // Check CLI availability once
  let cliAvailable: boolean | null = null;

  async function checkCli(): Promise<boolean> {
    if (cliAvailable !== null) return cliAvailable;
    const result = await runClaude(["--version"], 5_000);
    cliAvailable = result.success;
    return cliAvailable;
  }

  // ── Debug: raw CLI output ────────────────────────────────────

  app.get("/api/claude/plugins/debug", async (c) => {
    const result = await runClaude(["plugin", "list", "--json"]);
    return c.json({
      success: result.success,
      raw: result.stdout,
      parsed: result.success ? tryParseJson<unknown>(result.stdout, null) : null,
      stderr: result.stderr || undefined,
    });
  });

  // ── List plugins ──────────────────────────────────────────────

  app.get("/api/claude/plugins", async (c) => {
    const cached = getCached<unknown>("plugins:list");
    if (cached) return c.json(cached);

    const hasCli = await checkCli();

    if (hasCli) {
      const result = await runClaude(["plugin", "list", "--json"]);
      if (result.success) {
        const parsedList = tryParseJson<unknown>(result.stdout, []);
        // CLI returns a bare array for `plugin list --json`
        const cliPlugins: Array<Record<string, unknown>> = Array.isArray(parsedList)
          ? parsedList
          : Array.isArray((parsedList as Record<string, unknown>)?.installed)
            ? ((parsedList as Record<string, unknown>).installed as Array<Record<string, unknown>>)
            : [];
        const plugins = await Promise.all(
          cliPlugins.map(async (p) => {
            const installPath = typeof p.installPath === "string" ? p.installPath : "";
            const pluginId = (p.id ?? p.name ?? "") as string;
            const components = installPath ? scanPluginComponents(installPath) : null;

            // Check plugin health via MCP server probing
            const health =
              installPath && existsSync(installPath)
                ? await checkPluginHealth(installPath, pluginId)
                : {};

            return {
              id: pluginId,
              name: (p.name ?? p.id ?? "") as string,
              description: (p.description ?? "") as string,
              version: (p.version ?? "") as string,
              scope: (p.scope ?? "user") as string,
              enabled: p.enabled !== false,
              marketplace: (p.marketplace ||
                (pluginId.includes("@") ? pluginId.split("@").pop() : "")) as string,
              author: (p.author ?? "") as string,
              error: health.error,
              warning: health.warning,
              componentCounts: components
                ? {
                    commands: components.commands.length,
                    agents: components.agents.length,
                    skills: components.skills.length,
                    mcpServers: components.mcpServers.length,
                    hooks: components.hasHooks,
                    lsp: components.hasLsp,
                  }
                : {
                    commands: 0,
                    agents: 0,
                    skills: 0,
                    mcpServers: 0,
                    hooks: false,
                    lsp: false,
                  },
            };
          }),
        );

        const response = { plugins, cliAvailable: true };
        setCache("plugins:list", response, 5_000);
        return c.json(response);
      }
    }

    // Fallback: read settings files
    const settingsPlugins = readSettingsPlugins(projectDir);
    const plugins = settingsPlugins.map((p) => ({
      id: p.name,
      name: p.name,
      description: "",
      version: "",
      scope: p.scope,
      enabled: p.enabled,
      marketplace: p.name.includes("@") ? p.name.split("@").pop()! : "",
      author: "",
      componentCounts: {
        commands: 0,
        agents: 0,
        skills: 0,
        mcpServers: 0,
        hooks: false,
        lsp: false,
      },
    }));

    const response = { plugins, cliAvailable: false };
    setCache("plugins:list", response, 5_000);
    return c.json(response);
  });

  // ── Plugin agents (agents/*.md) ─────────────────────────────

  app.get("/api/claude/agents", async (c) => {
    const cached = getCached<unknown>("plugins:agents:list");
    if (cached) return c.json(cached);

    const hasCli = await checkCli();
    if (!hasCli) {
      return c.json({ agents: [], cliAvailable: false });
    }

    const result = await runClaude(["plugin", "list", "--json"]);
    if (!result.success) {
      return c.json(
        {
          agents: [],
          cliAvailable: true,
          error: result.stderr || "Failed to list plugins",
        },
        500,
      );
    }

    const parsedList = tryParseJson<unknown>(result.stdout, []);
    const cliPlugins: Array<Record<string, unknown>> = Array.isArray(parsedList)
      ? parsedList
      : Array.isArray((parsedList as Record<string, unknown>)?.installed)
        ? ((parsedList as Record<string, unknown>).installed as Array<Record<string, unknown>>)
        : [];

    const agents = cliPlugins
      .flatMap((plugin) => {
        const installPath = typeof plugin.installPath === "string" ? plugin.installPath : "";
        if (!installPath || !existsSync(installPath)) return [];
        const pluginId = (plugin.id ?? plugin.name ?? "") as string;
        const pluginName = (plugin.name ?? plugin.id ?? "") as string;
        const pluginScope = (plugin.scope ?? "user") as "user" | "project" | "local";
        const pluginEnabled = plugin.enabled !== false;
        const marketplace = (plugin.marketplace ||
          (pluginId.includes("@") ? pluginId.split("@").pop() : "")) as string;
        return scanPluginAgents(
          installPath,
          pluginId,
          pluginName,
          pluginScope,
          pluginEnabled,
          marketplace,
        );
      })
      .sort((a, b) => {
        if (a.pluginEnabled !== b.pluginEnabled) return a.pluginEnabled ? -1 : 1;
        const pluginCmp = a.pluginName.localeCompare(b.pluginName);
        if (pluginCmp !== 0) return pluginCmp;
        return a.name.localeCompare(b.name);
      })
      .map((agent) => {
        const deployments = getPluginAgentDeployments(
          agent.name,
          agent.pluginScope,
          agent.pluginEnabled,
          projectDir,
        );
        return {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          pluginId: agent.pluginId,
          pluginName: agent.pluginName,
          pluginScope: agent.pluginScope,
          pluginEnabled: agent.pluginEnabled,
          marketplace: agent.marketplace,
          deployments,
        };
      });

    const response = { agents, cliAvailable: true };
    setCache("plugins:agents:list", response, 5_000);
    return c.json(response);
  });

  const fetchPluginAgentDetail = async (id: string) => {
    const parsedAgentId = parsePluginAgentId(id);
    if (!parsedAgentId) {
      return { status: 400 as const, body: { error: "Invalid agent id" } };
    }
    const { pluginId, agentName } = parsedAgentId;

    const hasCli = await checkCli();
    if (!hasCli) {
      return {
        status: 501 as const,
        body: { error: "Claude CLI not available", cliAvailable: false },
      };
    }

    const result = await runClaude(["plugin", "list", "--json"]);
    if (!result.success) {
      return { status: 500 as const, body: { error: "Failed to list plugins" } };
    }

    const parsedList = tryParseJson<unknown>(result.stdout, []);
    const cliPlugins: Array<Record<string, unknown>> = Array.isArray(parsedList)
      ? parsedList
      : Array.isArray((parsedList as Record<string, unknown>)?.installed)
        ? ((parsedList as Record<string, unknown>).installed as Array<Record<string, unknown>>)
        : [];

    const plugin = cliPlugins.find((p) => (p.id ?? p.name ?? "") === pluginId);
    if (!plugin) {
      return { status: 404 as const, body: { error: "Plugin not found" } };
    }

    const installPath = typeof plugin.installPath === "string" ? plugin.installPath : "";
    if (!installPath || !existsSync(installPath)) {
      return { status: 404 as const, body: { error: "Plugin install path not found" } };
    }

    const agentsDir = path.join(installPath, "agents");
    const resolvedAgentPath = path.resolve(agentsDir, `${agentName}.md`);
    const resolvedAgentsDir = path.resolve(agentsDir) + path.sep;
    if (!resolvedAgentPath.startsWith(resolvedAgentsDir) || !existsSync(resolvedAgentPath)) {
      return { status: 404 as const, body: { error: "Agent definition not found" } };
    }

    let content = "";
    try {
      content = readFileSync(resolvedAgentPath, "utf-8");
    } catch {
      return { status: 500 as const, body: { error: "Failed to read agent definition" } };
    }

    const pluginName = (plugin.name ?? plugin.id ?? "") as string;
    const pluginScope = (plugin.scope ?? "user") as "user" | "project" | "local";
    const pluginEnabled = plugin.enabled !== false;
    const marketplace = (plugin.marketplace ||
      (pluginId.includes("@") ? pluginId.split("@").pop() : "")) as string;

    return {
      status: 200 as const,
      body: {
        agent: {
          id,
          name: agentName,
          description: extractFrontmatterDescription(content),
          pluginId,
          pluginName,
          pluginScope,
          pluginEnabled,
          marketplace,
          installPath,
          agentPath: resolvedAgentPath,
          content,
          deployments: getPluginAgentDeployments(agentName, pluginScope, pluginEnabled, projectDir),
        },
      },
    };
  };

  app.post("/api/claude/agents/deploy", async (c) => {
    const body = await c.req.json<{
      id: string;
      agent: AgentId;
      scope: "global" | "project";
    }>();

    const parsedAgentId = parsePluginAgentId(body.id);
    if (!parsedAgentId) return c.json({ success: false, error: "Invalid agent id" }, 400);
    if (!SUPPORTED_AGENTS.includes(body.agent)) {
      return c.json({ success: false, error: "Unsupported target agent" }, 400);
    }
    if (!SUPPORTED_SCOPES.has(body.scope)) {
      return c.json({ success: false, error: "Invalid scope" }, 400);
    }

    const detail = await fetchPluginAgentDetail(body.id);
    if (detail.status !== 200) {
      return c.json(
        { success: false, error: detail.body.error ?? "Agent not found" },
        detail.status,
      );
    }

    const agentDetail = detail.body.agent;
    if (!agentDetail) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    if (body.agent === "claude") {
      const claudeScope = getClaudeDeploymentScope(agentDetail.pluginScope);
      if (body.scope !== claudeScope) {
        return c.json(
          {
            success: false,
            error: `Claude plugin agents are only available in ${claudeScope} scope for this plugin`,
          },
          400,
        );
      }

      if (!agentDetail.pluginEnabled) {
        const enable = await runClaude([
          "plugin",
          "enable",
          agentDetail.pluginId,
          "--scope",
          claudeScope,
        ]);
        if (!enable.success) {
          return c.json({ success: false, error: enable.stderr || "Failed to enable plugin" }, 500);
        }
        invalidateCache("plugins:");
      }

      return c.json({ success: true });
    }

    const deployDir = resolveAgentDeployDir(body.agent, body.scope, projectDir);
    if (!deployDir) {
      return c.json({ success: false, error: "No deploy path for target agent" }, 400);
    }

    try {
      mkdirSync(deployDir, { recursive: true });
      const content = readFileSync(agentDetail.agentPath, "utf-8");
      writeFileSync(path.join(deployDir, `${parsedAgentId.agentName}.md`), content);
      return c.json({ success: true });
    } catch (err) {
      return c.json(
        {
          success: false,
          error: err instanceof Error ? err.message : "Failed to deploy plugin agent",
        },
        500,
      );
    }
  });

  app.post("/api/claude/agents/undeploy", async (c) => {
    const body = await c.req.json<{
      id: string;
      agent: AgentId;
      scope: "global" | "project";
    }>();

    const parsedAgentId = parsePluginAgentId(body.id);
    if (!parsedAgentId) return c.json({ success: false, error: "Invalid agent id" }, 400);
    if (!SUPPORTED_AGENTS.includes(body.agent)) {
      return c.json({ success: false, error: "Unsupported target agent" }, 400);
    }
    if (!SUPPORTED_SCOPES.has(body.scope)) {
      return c.json({ success: false, error: "Invalid scope" }, 400);
    }

    const detail = await fetchPluginAgentDetail(body.id);
    if (detail.status !== 200) {
      return c.json(
        { success: false, error: detail.body.error ?? "Agent not found" },
        detail.status,
      );
    }

    const agentDetail = detail.body.agent;
    if (!agentDetail) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    if (body.agent === "claude") {
      const claudeScope = getClaudeDeploymentScope(agentDetail.pluginScope);
      if (body.scope !== claudeScope) {
        return c.json(
          {
            success: false,
            error: `Claude plugin agents are only available in ${claudeScope} scope for this plugin`,
          },
          400,
        );
      }

      if (agentDetail.pluginEnabled) {
        const disable = await runClaude([
          "plugin",
          "disable",
          agentDetail.pluginId,
          "--scope",
          claudeScope,
        ]);
        if (!disable.success) {
          return c.json(
            { success: false, error: disable.stderr || "Failed to disable plugin" },
            500,
          );
        }
        invalidateCache("plugins:");
      }

      return c.json({ success: true });
    }

    const deployDir = resolveAgentDeployDir(body.agent, body.scope, projectDir);
    if (!deployDir) {
      return c.json({ success: false, error: "No deploy path for target agent" }, 400);
    }

    try {
      rmSync(path.join(deployDir, `${parsedAgentId.agentName}.md`), { force: true });
      return c.json({ success: true });
    } catch (err) {
      return c.json(
        {
          success: false,
          error: err instanceof Error ? err.message : "Failed to undeploy plugin agent",
        },
        500,
      );
    }
  });

  app.get("/api/claude/agents/detail", async (c) => {
    const id = c.req.query("id") ?? "";
    const result = await fetchPluginAgentDetail(id);
    return c.json(result.body, result.status);
  });

  app.get("/api/claude/agents/:id", async (c) => {
    const id = c.req.param("id");
    const result = await fetchPluginAgentDetail(id);
    return c.json(result.body, result.status);
  });

  // ── Available plugins (marketplace) ───────────────────────────

  app.get("/api/claude/plugins/available", async (c) => {
    const cached = getCached<unknown>("plugins:available");
    if (cached) return c.json(cached);

    const result = await runClaude(["plugin", "list", "--available", "--json"], 30_000);
    if (!result.success) {
      return c.json({ available: [], error: result.stderr });
    }

    const parsed = tryParseJson<unknown>(result.stdout, {});
    const obj = parsed as Record<string, unknown>;

    // CLI returns { installed: [...], available: [...] }
    const rawAvailable = Array.isArray(obj?.available)
      ? (obj.available as Array<Record<string, unknown>>)
      : [];
    const rawInstalled = Array.isArray(obj?.installed)
      ? (obj.installed as Array<Record<string, unknown>>)
      : [];
    // If CLI returned a bare array, treat it as available list
    const availList =
      rawAvailable.length > 0
        ? rawAvailable
        : Array.isArray(parsed)
          ? (parsed as Array<Record<string, unknown>>)
          : [];

    const installedIds = new Set(rawInstalled.map((p) => (p.id ?? "") as string));

    const available = availList.map((p: Record<string, unknown>) => ({
      pluginId: (p.pluginId ?? p.id ?? p.name ?? "") as string,
      name: (p.name ?? p.pluginId ?? "") as string,
      description: (p.description ?? "") as string,
      marketplaceName: (p.marketplaceName ?? p.marketplace ?? "") as string,
      version: (p.version ?? "") as string,
      installed: installedIds.has((p.pluginId ?? p.id ?? "") as string) || p.installed === true,
    }));

    const response = { available };
    setCache("plugins:available", response, 60_000);
    return c.json(response);
  });

  // ── Marketplaces ──────────────────────────────────────────────

  app.get("/api/claude/plugins/marketplaces", async (c) => {
    const result = await runClaude(["plugin", "marketplace", "list", "--json"]);
    if (!result.success) {
      return c.json({ marketplaces: [], error: result.stderr });
    }

    const parsedMp = tryParseJson<unknown>(result.stdout, []);
    const rawMp = Array.isArray(parsedMp)
      ? parsedMp
      : Array.isArray((parsedMp as Record<string, unknown>)?.marketplaces)
        ? ((parsedMp as Record<string, unknown>).marketplaces as Array<Record<string, unknown>>)
        : [];
    const marketplaces = rawMp.map((m: Record<string, unknown>) => ({
      name: (m.name ?? "") as string,
      source: (m.source ?? m.url ?? "") as string,
      repo: (m.repo ?? "") as string,
    }));

    return c.json({ marketplaces });
  });

  app.post("/api/claude/plugins/marketplaces", async (c) => {
    const body = await c.req.json<{ source: string }>();
    if (!body.source?.trim()) {
      return c.json({ success: false, error: "Marketplace source is required" }, 400);
    }

    const result = await runClaude(["plugin", "marketplace", "add", body.source.trim()], 30_000);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({
        success: false,
        error: result.stderr || "Failed to add marketplace",
      });
    }

    return c.json({ success: true });
  });

  app.delete("/api/claude/plugins/marketplaces/:name", async (c) => {
    const name = c.req.param("name");

    const result = await runClaude(["plugin", "marketplace", "remove", name]);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({
        success: false,
        error: result.stderr || "Failed to remove marketplace",
      });
    }

    return c.json({ success: true });
  });

  app.post("/api/claude/plugins/marketplaces/:name/update", async (c) => {
    const name = c.req.param("name");

    const result = await runClaude(["plugin", "marketplace", "update", name], 60_000);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({
        success: false,
        error: result.stderr || "Failed to update marketplace",
      });
    }

    return c.json({ success: true });
  });

  // ── Plugin detail ─────────────────────────────────────────────

  app.get("/api/claude/plugins/:id", async (c) => {
    const id = c.req.param("id");
    const hasCli = await checkCli();

    if (!hasCli) {
      return c.json({ error: "Claude CLI not available", cliAvailable: false }, 501);
    }

    const result = await runClaude(["plugin", "list", "--json"]);
    if (!result.success) {
      return c.json({ error: "Failed to list plugins" }, 500);
    }

    const parsedDetail = tryParseJson<unknown>(result.stdout, []);
    // CLI returns a bare array for `plugin list --json`
    const cliPlugins: Array<Record<string, unknown>> = Array.isArray(parsedDetail)
      ? parsedDetail
      : Array.isArray((parsedDetail as Record<string, unknown>)?.installed)
        ? ((parsedDetail as Record<string, unknown>).installed as Array<Record<string, unknown>>)
        : [];
    const plugin = cliPlugins.find((p) => (p.id ?? p.name) === id);
    if (!plugin) {
      return c.json({ error: "Plugin not found" }, 404);
    }

    const installPath = typeof plugin.installPath === "string" ? plugin.installPath : "";
    const components = installPath
      ? scanPluginComponents(installPath)
      : {
          commands: [],
          agents: [],
          skills: [],
          mcpServers: [],
          hasHooks: false,
          hasLsp: false,
        };

    // Read manifest
    let manifest: Record<string, unknown> = {};
    if (installPath) {
      const manifestPath = path.join(installPath, ".claude-plugin", "plugin.json");
      if (existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        } catch {
          /* ignore */
        }
      }
    }

    // Read README
    let readme = "";
    if (installPath) {
      for (const name of ["README.md", "readme.md", "Readme.md"]) {
        const readmePath = path.join(installPath, name);
        if (existsSync(readmePath)) {
          try {
            readme = readFileSync(readmePath, "utf-8");
          } catch {
            /* ignore */
          }
          break;
        }
      }
    }

    // Check plugin health via MCP server probing
    const pluginId = (plugin.id ?? plugin.name ?? "") as string;
    const health =
      installPath && existsSync(installPath) ? await checkPluginHealth(installPath, pluginId) : {};

    return c.json({
      plugin: {
        id: pluginId,
        name: (plugin.name ?? plugin.id ?? "") as string,
        description: (plugin.description ?? "") as string,
        version: (plugin.version ?? "") as string,
        scope: (plugin.scope ?? "user") as string,
        enabled: plugin.enabled !== false,
        marketplace: (plugin.marketplace ||
          (pluginId.includes("@") ? pluginId.split("@").pop() : "")) as string,
        author: (plugin.author ?? "") as string,
        error: health.error,
        warning: health.warning,
        componentCounts: {
          commands: components.commands.length,
          agents: components.agents.length,
          skills: components.skills.length,
          mcpServers: components.mcpServers.length,
          hooks: components.hasHooks,
          lsp: components.hasLsp,
        },
        installPath,
        manifest,
        components,
        homepage: (manifest.homepage ?? "") as string,
        repository: (manifest.repository ?? "") as string,
        license: (manifest.license ?? "") as string,
        keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
        readme,
      },
    });
  });

  // ── Install plugin ────────────────────────────────────────────

  app.post("/api/claude/plugins/install", async (c) => {
    const body = await c.req.json<{ ref: string; scope?: string }>();
    if (!body.ref?.trim()) {
      return c.json({ success: false, error: "Plugin reference is required" }, 400);
    }

    const args = ["plugin", "install", body.ref.trim()];
    if (body.scope) args.push("--scope", body.scope);

    const result = await runClaude(args, 60_000);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({
        success: false,
        error: result.stderr || "Install failed",
      });
    }

    return c.json({ success: true });
  });

  // ── Uninstall plugin ──────────────────────────────────────────

  app.post("/api/claude/plugins/:id/uninstall", async (c) => {
    const id = c.req.param("id");
    const body: { scope?: string } = await c.req.json().catch(() => ({}));

    const args = ["plugin", "uninstall", id];
    if (body.scope) args.push("--scope", body.scope);

    const result = await runClaude(args, 30_000);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({
        success: false,
        error: result.stderr || "Uninstall failed",
      });
    }

    return c.json({ success: true });
  });

  // ── Enable plugin ─────────────────────────────────────────────

  app.post("/api/claude/plugins/:id/enable", async (c) => {
    const id = c.req.param("id");
    const body: { scope?: string } = await c.req.json().catch(() => ({}));

    const args = ["plugin", "enable", id];
    if (body.scope) args.push("--scope", body.scope);

    const result = await runClaude(args);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({
        success: false,
        error: result.stderr || "Enable failed",
      });
    }

    return c.json({ success: true });
  });

  // ── Disable plugin ────────────────────────────────────────────

  app.post("/api/claude/plugins/:id/disable", async (c) => {
    const id = c.req.param("id");
    const body: { scope?: string } = await c.req.json().catch(() => ({}));

    const args = ["plugin", "disable", id];
    if (body.scope) args.push("--scope", body.scope);

    const result = await runClaude(args);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({
        success: false,
        error: result.stderr || "Disable failed",
      });
    }

    return c.json({ success: true });
  });

  // ── Update plugin ─────────────────────────────────────────────

  app.post("/api/claude/plugins/:id/update", async (c) => {
    const id = c.req.param("id");

    const result = await runClaude(["plugin", "update", id], 60_000);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({
        success: false,
        error: result.stderr || "Update failed",
      });
    }

    return c.json({ success: true });
  });
}
