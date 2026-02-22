import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import type { Hono } from "hono";

import type { WorktreeManager } from "../manager";
import {
  type AgentId,
  type Scope,
  type McpServerEntry,
  AGENT_SPECS,
  getScopeSpec,
  resolveConfigPath,
  isServerConfigured,
  writeServerToConfig,
  removeServerFromConfig,
  scanFilesystemForServers,
  getDeviceScanRoots,
} from "../lib/tool-configs";

// ─── Registry types ─────────────────────────────────────────────

interface McpServerDefinition {
  id: string;
  name: string;
  description: string;
  tags: string[];
  command: string;
  args: string[];
  env: Record<string, string>;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

interface McpServerRegistry {
  version: 1;
  servers: Record<string, McpServerDefinition>;
}

// ─── Registry storage ───────────────────────────────────────────

function getRegistryPath(): string {
  return path.join(os.homedir(), ".openkit", "mcp-servers.json");
}

function loadRegistry(): McpServerRegistry {
  const filePath = getRegistryPath();
  if (!existsSync(filePath)) {
    return { version: 1, servers: {} };
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as McpServerRegistry;
  } catch {
    return { version: 1, servers: {} };
  }
}

function saveRegistry(registry: McpServerRegistry): void {
  const filePath = getRegistryPath();
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(registry, null, 2) + "\n");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// ─── Per-project env storage ────────────────────────────────────

type ProjectEnvStore = Record<string, Record<string, string>>;

function getProjectEnvPath(configDir: string): string {
  return path.join(configDir, "mcp-env.json");
}

function loadProjectEnv(configDir: string): ProjectEnvStore {
  const filePath = getProjectEnvPath(configDir);
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as ProjectEnvStore;
  } catch {
    return {};
  }
}

function saveProjectEnv(configDir: string, store: ProjectEnvStore): void {
  const filePath = getProjectEnvPath(configDir);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2) + "\n");
}

// ─── Routes ─────────────────────────────────────────────────────

export function registerMcpServerRoutes(app: Hono, _manager: WorktreeManager) {
  const projectDir = _manager.getConfigDir();

  // ── Static GET routes (before parameterized :id) ──────────────

  // List servers
  app.get("/api/mcp-servers", (c) => {
    const registry = loadRegistry();
    const q = (c.req.query("q") ?? "").toLowerCase();
    const tag = c.req.query("tag");

    let servers = Object.values(registry.servers);

    if (q) {
      servers = servers.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q),
      );
    }

    if (tag) {
      servers = servers.filter((s) => s.tags.includes(tag));
    }

    servers.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return c.json({ servers });
  });

  // Bulk deployment status
  app.get("/api/mcp-servers/deployment-status", (c) => {
    const registry = loadRegistry();

    const status: Record<
      string,
      Record<
        string,
        { global?: boolean; project?: boolean; globalPath?: string; projectPath?: string }
      >
    > = {};

    const serverIds = new Set(Object.keys(registry.servers));
    serverIds.add("OpenKit"); // built-in server

    for (const serverId of serverIds) {
      status[serverId] = {};

      for (const [agentId, spec] of Object.entries(AGENT_SPECS)) {
        const entry: {
          global?: boolean;
          project?: boolean;
          globalPath?: string;
          projectPath?: string;
        } = {};

        if (spec.global) {
          const filePath = resolveConfigPath(spec.global.configPath, projectDir);
          entry.global =
            serverId === "OpenKit"
              ? isServerConfigured(filePath, spec.global, "openkit") ||
                isServerConfigured(filePath, spec.global, "OpenKit")
              : isServerConfigured(filePath, spec.global, serverId);
          entry.globalPath = filePath;
        }
        if (spec.project) {
          const filePath = resolveConfigPath(spec.project.configPath, projectDir);
          entry.project =
            serverId === "OpenKit"
              ? isServerConfigured(filePath, spec.project, "openkit") ||
                isServerConfigured(filePath, spec.project, "OpenKit")
              : isServerConfigured(filePath, spec.project, serverId);
          entry.projectPath = filePath;
        }

        status[serverId][agentId] = entry;
      }
    }

    return c.json({ status });
  });

  // Get per-project env for a server
  app.get("/api/mcp-env/:serverId", (c) => {
    const serverId = c.req.param("serverId");
    const store = loadProjectEnv(projectDir);
    return c.json({ env: store[serverId] ?? {} });
  });

  // Set per-project env for a server
  app.put("/api/mcp-env/:serverId", async (c) => {
    const serverId = c.req.param("serverId");
    const body = await c.req.json<{ env: Record<string, string> }>();
    const store = loadProjectEnv(projectDir);

    if (!body.env || Object.keys(body.env).length === 0) {
      delete store[serverId];
    } else {
      store[serverId] = body.env;
    }

    saveProjectEnv(projectDir, store);
    return c.json({ success: true, env: store[serverId] ?? {} });
  });

  // Get single server (parameterized — must come after static GET routes)
  app.get("/api/mcp-servers/:id", (c) => {
    const registry = loadRegistry();
    const server = registry.servers[c.req.param("id")];
    if (!server) return c.json({ error: "Server not found" }, 404);
    return c.json({ server });
  });

  // ── Static POST routes (before parameterized :id) ─────────────

  // Create server
  app.post("/api/mcp-servers", async (c) => {
    const body = await c.req.json<{
      id?: string;
      name?: string;
      description?: string;
      tags?: string[];
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    }>();

    if (!body.name?.trim() || !body.command?.trim()) {
      return c.json({ success: false, error: "Name and command are required" }, 400);
    }

    const registry = loadRegistry();
    const id = body.id?.trim() || slugify(body.name);

    if (registry.servers[id]) {
      return c.json({ success: false, error: `Server "${id}" already exists` }, 409);
    }

    const now = new Date().toISOString();
    const server: McpServerDefinition = {
      id,
      name: body.name.trim(),
      description: body.description?.trim() ?? "",
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      command: body.command.trim(),
      args: Array.isArray(body.args) ? body.args.map(String) : [],
      env: body.env && typeof body.env === "object" ? body.env : {},
      createdAt: now,
      updatedAt: now,
    };

    registry.servers[id] = server;
    saveRegistry(registry);
    return c.json({ success: true, server });
  });

  // Scan for MCP servers
  app.post("/api/mcp-servers/scan", async (c) => {
    const body: { mode?: "project" | "folder" | "device"; scanPath?: string } = await c.req
      .json()
      .catch(() => ({}));

    const mode = body.mode ?? "project";
    const registry = loadRegistry();

    const serverMap = new Map<
      string,
      {
        entry: McpServerEntry;
        foundIn: Array<{ configPath: string }>;
      }
    >();

    let scanRoots: string[];
    let maxDepth: number;

    if (mode === "project") {
      scanRoots = [projectDir];
      maxDepth = 4;
    } else if (mode === "folder" && body.scanPath) {
      scanRoots = [body.scanPath];
      maxDepth = 8;
    } else {
      scanRoots = getDeviceScanRoots();
      maxDepth = 5;
    }

    for (const root of scanRoots) {
      const results = scanFilesystemForServers(root, maxDepth);

      for (const { key, entry, filePath } of results) {
        const existing = serverMap.get(key);
        const location = { configPath: filePath };

        if (existing) {
          if (!existing.foundIn.some((f) => f.configPath === filePath)) {
            existing.foundIn.push(location);
          }
        } else {
          serverMap.set(key, { entry, foundIn: [location] });
        }
      }
    }

    const discovered: Array<{
      key: string;
      command: string;
      args: string[];
      env: Record<string, string>;
      foundIn: Array<{ configPath: string }>;
      alreadyInRegistry: boolean;
    }> = [];
    for (const [key, { entry, foundIn }] of serverMap) {
      discovered.push({
        key,
        command: entry.command ?? "",
        args: entry.args ?? [],
        env: entry.env ?? {},
        foundIn,
        alreadyInRegistry: !!registry.servers[key],
      });
    }

    discovered.sort((a, b) => a.key.localeCompare(b.key));
    return c.json({ discovered });
  });

  // Bulk import scan results into registry
  app.post("/api/mcp-servers/import", async (c) => {
    const body = await c.req.json<{
      servers: Array<{
        key: string;
        name?: string;
        description?: string;
        tags?: string[];
        command: string;
        args: string[];
        env?: Record<string, string>;
        source?: string;
      }>;
    }>();

    if (!Array.isArray(body.servers)) {
      return c.json({ success: false, error: "servers array is required" }, 400);
    }

    const registry = loadRegistry();
    const now = new Date().toISOString();
    const imported: string[] = [];

    for (const s of body.servers) {
      if (!s.key || !s.command) continue;
      if (registry.servers[s.key]) continue;

      registry.servers[s.key] = {
        id: s.key,
        name: s.name?.trim() || s.key,
        description: s.description?.trim() ?? "",
        tags: Array.isArray(s.tags) ? s.tags.map((t) => String(t).trim()).filter(Boolean) : [],
        command: s.command,
        args: Array.isArray(s.args) ? s.args.map(String) : [],
        env: s.env && typeof s.env === "object" ? s.env : {},
        source: s.source,
        createdAt: now,
        updatedAt: now,
      };
      imported.push(s.key);
    }

    saveRegistry(registry);
    return c.json({ success: true, imported });
  });

  // ── Parameterized routes ──────────────────────────────────────

  // Update server
  app.patch("/api/mcp-servers/:id", async (c) => {
    const registry = loadRegistry();
    const id = c.req.param("id");
    const server = registry.servers[id];
    if (!server) return c.json({ success: false, error: "Server not found" }, 404);

    const body = await c.req.json<
      Partial<{
        name: string;
        description: string;
        tags: string[];
        command: string;
        args: string[];
        env: Record<string, string>;
      }>
    >();

    if (body.name !== undefined) server.name = body.name.trim();
    if (body.description !== undefined) server.description = body.description.trim();
    if (body.tags !== undefined)
      server.tags = body.tags.map((t) => String(t).trim()).filter(Boolean);
    if (body.command !== undefined) server.command = body.command.trim();
    if (body.args !== undefined) server.args = body.args.map(String);
    if (body.env !== undefined) server.env = body.env;

    server.updatedAt = new Date().toISOString();
    registry.servers[id] = server;
    saveRegistry(registry);
    return c.json({ success: true, server });
  });

  // Delete server
  app.delete("/api/mcp-servers/:id", (c) => {
    const registry = loadRegistry();
    const id = c.req.param("id");
    if (!registry.servers[id]) return c.json({ success: false, error: "Server not found" }, 404);

    delete registry.servers[id];
    saveRegistry(registry);
    return c.json({ success: true });
  });

  // Deploy server to a tool config
  app.post("/api/mcp-servers/:id/deploy", async (c) => {
    const registry = loadRegistry();
    const id = c.req.param("id");
    const server = registry.servers[id];
    if (!server) return c.json({ success: false, error: "Server not found" }, 404);

    const body = await c.req.json<{ tool: AgentId; scope: Scope }>();
    const { tool, scope } = body;

    const spec = getScopeSpec(tool, scope);
    if (!spec) {
      return c.json({ success: false, error: `${scope} scope not supported for ${tool}` }, 400);
    }

    const filePath = resolveConfigPath(spec.configPath, projectDir);
    // Merge global env with per-project env (project overrides)
    const projectEnvStore = loadProjectEnv(projectDir);
    const projectEnv = projectEnvStore[id] ?? {};
    const mergedEnv = { ...server.env, ...projectEnv };
    const entry: McpServerEntry = {
      command: server.command,
      args: server.args,
      ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
    };

    const result = writeServerToConfig(filePath, spec, id, entry);
    return c.json(result, result.success ? 200 : 500);
  });

  // Undeploy server from a tool config
  app.post("/api/mcp-servers/:id/undeploy", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ tool: AgentId; scope: Scope }>();
    const { tool, scope } = body;

    const spec = getScopeSpec(tool, scope);
    if (!spec) {
      return c.json({ success: false, error: `${scope} scope not supported for ${tool}` }, 400);
    }

    const filePath = resolveConfigPath(spec.configPath, projectDir);
    const result = removeServerFromConfig(filePath, spec, id);
    return c.json(result, result.success ? 200 : 500);
  });
}
