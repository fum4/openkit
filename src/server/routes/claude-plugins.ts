import { execFile as execFileCb } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { Hono } from "hono";

import type { WorktreeManager } from "../manager";

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
    { scope: "user", path: path.join(os.homedir(), ".claude", "settings.json") },
    { scope: "project", path: path.join(projectDir, ".claude", "settings.json") },
    { scope: "local", path: path.join(projectDir, ".claude", "settings.local.json") },
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
                : { commands: 0, agents: 0, skills: 0, mcpServers: 0, hooks: false, lsp: false },
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
      return c.json({ success: false, error: result.stderr || "Failed to add marketplace" });
    }

    return c.json({ success: true });
  });

  app.delete("/api/claude/plugins/marketplaces/:name", async (c) => {
    const name = c.req.param("name");

    const result = await runClaude(["plugin", "marketplace", "remove", name]);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({ success: false, error: result.stderr || "Failed to remove marketplace" });
    }

    return c.json({ success: true });
  });

  app.post("/api/claude/plugins/marketplaces/:name/update", async (c) => {
    const name = c.req.param("name");

    const result = await runClaude(["plugin", "marketplace", "update", name], 60_000);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({ success: false, error: result.stderr || "Failed to update marketplace" });
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
      return c.json({ success: false, error: result.stderr || "Install failed" });
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
      return c.json({ success: false, error: result.stderr || "Uninstall failed" });
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
      return c.json({ success: false, error: result.stderr || "Enable failed" });
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
      return c.json({ success: false, error: result.stderr || "Disable failed" });
    }

    return c.json({ success: true });
  });

  // ── Update plugin ─────────────────────────────────────────────

  app.post("/api/claude/plugins/:id/update", async (c) => {
    const id = c.req.param("id");

    const result = await runClaude(["plugin", "update", id], 60_000);
    invalidateCache("plugins:");

    if (!result.success) {
      return c.json({ success: false, error: result.stderr || "Update failed" });
    }

    return c.json({ success: true });
  });
}
