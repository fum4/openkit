import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import type { Hono } from "hono";

import type { WorktreeManager } from "../manager";
import {
  type AgentId,
  type Scope,
  CUSTOM_AGENT_SPECS,
  resolveAgentDeployDir,
} from "../lib/tool-configs";

type CustomAgentScope = Scope;

interface AgentDeploymentMap {
  [agentId: string]: { global?: boolean; project?: boolean };
}

interface CustomAgentSummary {
  id: string;
  name: string;
  description: string;
  pluginId: string;
  pluginName: string;
  pluginScope: "user" | "project" | "local";
  pluginEnabled: boolean;
  marketplace: string;
  isCustom: true;
  customScope?: CustomAgentScope;
  deployments: AgentDeploymentMap;
}

interface CustomAgentDetail extends CustomAgentSummary {
  installPath: string;
  agentPath: string;
  content: string;
}

interface CustomAgentScanResult {
  name: string;
  description: string;
  agentPath: string;
  alreadyInRegistry: boolean;
}

const SUPPORTED_AGENTS = Object.keys(CUSTOM_AGENT_SPECS) as AgentId[];
const SUPPORTED_SCOPES: CustomAgentScope[] = ["global", "project"];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".openkit",
  "Library",
  "Applications",
  "Pictures",
  "Music",
  "Movies",
  "Downloads",
  "Public",
  ".Trash",
]);

const KNOWN_AGENT_DIRS = new Set([".claude", ".cursor", ".gemini", ".codex", ".vscode"]);

function getCustomAgentRegistryDir(): string {
  return path.join(os.homedir(), ".openkit", "agents");
}

function getLegacyClaudeAgentDir(projectDir: string, scope: CustomAgentScope): string {
  if (scope === "global") return path.join(os.homedir(), ".claude", "agents");
  return path.join(projectDir, ".claude", "agents");
}

function normalizeAgentFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function buildCustomAgentId(name: string): string {
  return `custom::${name}`;
}

function parseCustomAgentId(
  id: string,
): { name: string; legacyScope?: CustomAgentScope; legacyFileName?: string } | null {
  const parts = id.split("::");

  if (parts.length === 2 && parts[0] === "custom") {
    const name = normalizeAgentFileName(parts[1]);
    if (!name) return null;
    return { name };
  }

  // Legacy id shape: custom::<scope>::<fileName>
  if (parts.length === 3 && parts[0] === "custom") {
    const scope = parts[1];
    const legacyFileName = normalizeAgentFileName(parts[2]);
    if ((scope !== "global" && scope !== "project") || !legacyFileName) return null;
    return { name: legacyFileName, legacyScope: scope, legacyFileName };
  }

  return null;
}

function extractFrontmatterField(content: string, field: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return "";
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^\\s*${escapedField}\\s*:\\s*(.+)\\s*$`, "m");
  const match = fmMatch[1].match(regex);
  if (!match?.[1]) return "";
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function extractDescription(content: string): string {
  const fromFrontmatter = extractFrontmatterField(content, "description");
  if (fromFrontmatter) return fromFrontmatter;

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const firstLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  return firstLine ?? "";
}

function extractName(content: string, fallback: string): string {
  const fromFrontmatter = extractFrontmatterField(content, "name");
  return fromFrontmatter || fallback;
}

function buildAgentMarkdown(input: {
  name: string;
  description?: string;
  tools?: string;
  model?: string;
  instructions?: string;
}): string {
  const lines: string[] = ["---", `name: ${input.name.trim()}`];
  if (input.description?.trim()) lines.push(`description: ${input.description.trim()}`);
  if (input.tools?.trim()) lines.push(`tools: ${input.tools.trim()}`);
  if (input.model?.trim()) lines.push(`model: ${input.model.trim()}`);
  lines.push("---", "");
  if (input.instructions?.trim()) {
    lines.push(input.instructions.trim(), "");
  } else {
    lines.push(`# ${input.name.trim()}`, "");
  }
  return lines.join("\n");
}

function ensureRegistryDir(): string {
  const registryDir = getCustomAgentRegistryDir();
  mkdirSync(registryDir, { recursive: true });
  return registryDir;
}

function getRegistryAgentPath(agentName: string): string {
  return path.join(getCustomAgentRegistryDir(), `${agentName}.md`);
}

function sanitizeDeployAgents(agents: unknown, fallback: AgentId[] = ["claude"]): AgentId[] {
  if (!Array.isArray(agents)) return fallback;
  const unique = new Set<AgentId>();
  for (const value of agents) {
    if (typeof value !== "string") continue;
    if (SUPPORTED_AGENTS.includes(value as AgentId)) {
      unique.add(value as AgentId);
    }
  }
  return [...unique];
}

function isAgentDeployed(
  agentName: string,
  agentId: AgentId,
  scope: CustomAgentScope,
  projectDir: string,
) {
  const deployDir = resolveAgentDeployDir(agentId, scope, projectDir);
  if (!deployDir) return false;
  const targetPath = path.join(deployDir, `${agentName}.md`);
  return existsSync(targetPath);
}

function getAgentDeployments(agentName: string, projectDir: string): AgentDeploymentMap {
  const deployments: AgentDeploymentMap = {};

  for (const agentId of SUPPORTED_AGENTS) {
    deployments[agentId] = {
      global: isAgentDeployed(agentName, agentId, "global", projectDir),
      project: isAgentDeployed(agentName, agentId, "project", projectDir),
    };
  }

  return deployments;
}

function hasAnyDeployment(deployments: AgentDeploymentMap): boolean {
  return Object.values(deployments).some((value) => value.global || value.project);
}

function syncRegistryAgentToAllDeployments(agentName: string, projectDir: string): void {
  const deployments = getAgentDeployments(agentName, projectDir);
  for (const [agentId, scopes] of Object.entries(deployments)) {
    if (scopes.global) {
      deployCustomAgentToTarget(agentName, agentId as AgentId, "global", projectDir);
    }
    if (scopes.project) {
      deployCustomAgentToTarget(agentName, agentId as AgentId, "project", projectDir);
    }
  }
}

function deployCustomAgentToTarget(
  agentName: string,
  agentId: AgentId,
  scope: CustomAgentScope,
  projectDir: string,
): { success: boolean; error?: string } {
  const sourcePath = getRegistryAgentPath(agentName);
  if (!existsSync(sourcePath)) {
    return { success: false, error: "Agent not found in registry" };
  }

  const deployDir = resolveAgentDeployDir(agentId, scope, projectDir);
  if (!deployDir) {
    return { success: false, error: `No deploy path for ${agentId} ${scope}` };
  }

  const targetPath = path.join(deployDir, `${agentName}.md`);

  try {
    mkdirSync(deployDir, { recursive: true });
    const content = readFileSync(sourcePath, "utf-8");
    writeFileSync(targetPath, content);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to deploy custom agent",
    };
  }
}

function undeployCustomAgentFromTarget(
  agentName: string,
  agentId: AgentId,
  scope: CustomAgentScope,
  projectDir: string,
): { success: boolean; error?: string } {
  const deployDir = resolveAgentDeployDir(agentId, scope, projectDir);
  if (!deployDir) {
    return { success: false, error: `No deploy path for ${agentId} ${scope}` };
  }

  const targetPath = path.join(deployDir, `${agentName}.md`);
  try {
    if (existsSync(targetPath)) {
      rmSync(targetPath, { force: true });
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to undeploy custom agent",
    };
  }
}

function deriveScopeFromDeployments(deployments: AgentDeploymentMap): {
  pluginScope: "user" | "project" | "local";
  customScope?: CustomAgentScope;
} {
  const hasGlobal = Object.values(deployments).some((value) => value.global);
  const hasProject = Object.values(deployments).some((value) => value.project);

  if (hasGlobal && !hasProject) {
    return { pluginScope: "user", customScope: "global" };
  }
  if (!hasGlobal && hasProject) {
    return { pluginScope: "project", customScope: "project" };
  }
  if (hasGlobal && hasProject) {
    return { pluginScope: "local" };
  }
  return { pluginScope: "local" };
}

function readCustomAgent(projectDir: string, agentName: string): CustomAgentDetail | null {
  const agentPath = getRegistryAgentPath(agentName);
  if (!existsSync(agentPath)) return null;

  let content = "";
  try {
    content = readFileSync(agentPath, "utf-8");
  } catch {
    return null;
  }

  const deployments = getAgentDeployments(agentName, projectDir);
  const { pluginScope, customScope } = deriveScopeFromDeployments(deployments);
  const enabled = hasAnyDeployment(deployments);

  return {
    id: buildCustomAgentId(agentName),
    name: extractName(content, agentName),
    description: extractDescription(content),
    pluginId: "custom",
    pluginName: "Custom",
    pluginScope,
    pluginEnabled: enabled,
    marketplace: "local",
    isCustom: true,
    ...(customScope ? { customScope } : {}),
    deployments,
    installPath: getCustomAgentRegistryDir(),
    agentPath,
    content,
  };
}

function listCustomAgents(projectDir: string): CustomAgentSummary[] {
  const registryDir = ensureRegistryDir();
  const results: CustomAgentSummary[] = [];

  try {
    for (const file of readdirSync(registryDir)) {
      if (!file.endsWith(".md")) continue;
      const fileName = file.replace(/\.md$/, "");
      const detail = readCustomAgent(projectDir, fileName);
      if (!detail) continue;
      results.push({
        id: detail.id,
        name: detail.name,
        description: detail.description,
        pluginId: detail.pluginId,
        pluginName: detail.pluginName,
        pluginScope: detail.pluginScope,
        pluginEnabled: detail.pluginEnabled,
        marketplace: detail.marketplace,
        isCustom: true,
        customScope: detail.customScope,
        deployments: detail.deployments,
      });
    }
  } catch {
    // Ignore unreadable directory.
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function migrateLegacyClaudeAgents(projectDir: string): void {
  ensureRegistryDir();

  for (const scope of SUPPORTED_SCOPES) {
    const legacyDir = getLegacyClaudeAgentDir(projectDir, scope);
    if (!existsSync(legacyDir)) continue;

    try {
      for (const file of readdirSync(legacyDir)) {
        if (!file.endsWith(".md")) continue;

        const baseName = normalizeAgentFileName(file.replace(/\.md$/, ""));
        if (!baseName) continue;

        const legacyPath = path.join(legacyDir, file);
        const registryPath = getRegistryAgentPath(baseName);

        if (!existsSync(registryPath)) {
          try {
            const content = readFileSync(legacyPath, "utf-8");
            writeFileSync(registryPath, content);
          } catch {
            continue;
          }
        }

        deployCustomAgentToTarget(baseName, "claude", scope, projectDir);
      }
    } catch {
      // Ignore unreadable directory.
    }
  }
}

function scanForAgents(
  roots: string[],
  maxDepth: number,
  knownAgentNames: Set<string>,
): CustomAgentScanResult[] {
  const discovered: CustomAgentScanResult[] = [];
  const seenPaths = new Set<string>();

  function scanAgentDir(agentsDir: string) {
    if (!existsSync(agentsDir)) return;

    try {
      for (const file of readdirSync(agentsDir)) {
        if (!file.endsWith(".md")) continue;

        const agentPath = path.join(agentsDir, file);
        const resolvedPath = path.resolve(agentPath);
        if (seenPaths.has(resolvedPath)) continue;
        seenPaths.add(resolvedPath);

        let content = "";
        try {
          content = readFileSync(agentPath, "utf-8");
        } catch {
          continue;
        }

        const fileName = normalizeAgentFileName(file.replace(/\.md$/, ""));
        if (!fileName) continue;

        discovered.push({
          name: extractName(content, fileName),
          description: extractDescription(content),
          agentPath: resolvedPath,
          alreadyInRegistry: knownAgentNames.has(fileName),
        });
      }
    } catch {
      // Ignore unreadable directory.
    }
  }

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const name = entry.name;
      if (SKIP_DIRS.has(name)) continue;
      if (name.startsWith(".") && depth > 1 && !KNOWN_AGENT_DIRS.has(name)) continue;

      const fullPath = path.join(dir, name);
      if (KNOWN_AGENT_DIRS.has(name)) {
        scanAgentDir(path.join(fullPath, "agents"));
      }

      walk(fullPath, depth + 1);
    }
  }

  for (const root of roots) {
    walk(root, 0);
  }

  discovered.sort((a, b) => a.name.localeCompare(b.name));
  return discovered;
}

export function registerClaudeCustomAgentRoutes(app: Hono, manager: WorktreeManager) {
  const projectDir = manager.getConfigDir();
  migrateLegacyClaudeAgents(projectDir);

  app.get("/api/claude/custom-agents", (c) => {
    return c.json({ agents: listCustomAgents(projectDir) });
  });

  app.get("/api/claude/custom-agents/:id", (c) => {
    const id = c.req.param("id");
    const parsed = parseCustomAgentId(id);
    if (!parsed) return c.json({ error: "Invalid custom agent id" }, 400);

    const detail = readCustomAgent(projectDir, parsed.name);
    if (!detail) return c.json({ error: "Custom agent not found" }, 404);
    return c.json({ agent: detail });
  });

  app.post("/api/claude/custom-agents", async (c) => {
    const body = await c.req.json<{
      name: string;
      description?: string;
      tools?: string;
      model?: string;
      instructions?: string;
      scope?: CustomAgentScope;
      deployAgents?: AgentId[];
    }>();

    if (!body.name?.trim()) {
      return c.json({ success: false, error: "Name is required" }, 400);
    }

    const fileName = normalizeAgentFileName(body.name);
    if (!fileName) {
      return c.json({ success: false, error: "Invalid name" }, 400);
    }

    const registryDir = ensureRegistryDir();
    const agentPath = path.join(registryDir, `${fileName}.md`);
    if (existsSync(agentPath)) {
      return c.json({ success: false, error: `Agent "${fileName}" already exists` }, 409);
    }

    const content = buildAgentMarkdown({
      name: body.name,
      description: body.description,
      tools: body.tools,
      model: body.model,
      instructions: body.instructions,
    });
    writeFileSync(agentPath, content);

    const scope = body.scope === "global" ? "global" : "project";
    const deployAgents = sanitizeDeployAgents(body.deployAgents, ["claude"]);
    for (const agentId of deployAgents) {
      deployCustomAgentToTarget(fileName, agentId, scope, projectDir);
    }

    const detail = readCustomAgent(projectDir, fileName);
    return c.json({ success: true, agent: detail });
  });

  app.delete("/api/claude/custom-agents/:id", (c) => {
    const id = c.req.param("id");
    const parsed = parseCustomAgentId(id);
    if (!parsed) return c.json({ success: false, error: "Invalid custom agent id" }, 400);

    const registryPath = getRegistryAgentPath(parsed.name);
    try {
      if (existsSync(registryPath)) {
        rmSync(registryPath, { force: true });
      }

      for (const agentId of SUPPORTED_AGENTS) {
        for (const scope of SUPPORTED_SCOPES) {
          undeployCustomAgentFromTarget(parsed.name, agentId, scope, projectDir);
        }
      }

      return c.json({ success: true });
    } catch (err) {
      return c.json(
        {
          success: false,
          error: err instanceof Error ? err.message : "Failed to delete custom agent",
        },
        500,
      );
    }
  });

  app.patch("/api/claude/custom-agents/:id", async (c) => {
    const id = c.req.param("id");
    const parsed = parseCustomAgentId(id);
    if (!parsed) return c.json({ success: false, error: "Invalid custom agent id" }, 400);

    const body = await c.req.json<{ content?: string }>();
    if (typeof body.content !== "string") {
      return c.json({ success: false, error: "content is required" }, 400);
    }

    const registryPath = getRegistryAgentPath(parsed.name);
    if (!existsSync(registryPath)) {
      return c.json({ success: false, error: "Custom agent not found" }, 404);
    }

    try {
      writeFileSync(registryPath, body.content);
      syncRegistryAgentToAllDeployments(parsed.name, projectDir);
      const detail = readCustomAgent(projectDir, parsed.name);
      return c.json({ success: true, agent: detail });
    } catch (err) {
      return c.json(
        {
          success: false,
          error: err instanceof Error ? err.message : "Failed to update custom agent",
        },
        500,
      );
    }
  });

  app.post("/api/claude/custom-agents/:id/deploy", async (c) => {
    const id = c.req.param("id");
    const parsed = parseCustomAgentId(id);
    if (!parsed) return c.json({ success: false, error: "Invalid custom agent id" }, 400);

    const body = await c.req.json<{ agent: AgentId; scope: CustomAgentScope }>();
    if (!SUPPORTED_AGENTS.includes(body.agent)) {
      return c.json({ success: false, error: "Unsupported agent" }, 400);
    }
    if (!SUPPORTED_SCOPES.includes(body.scope)) {
      return c.json({ success: false, error: "Invalid scope" }, 400);
    }

    const result = deployCustomAgentToTarget(parsed.name, body.agent, body.scope, projectDir);
    return c.json(result, result.success ? 200 : 500);
  });

  app.post("/api/claude/custom-agents/:id/undeploy", async (c) => {
    const id = c.req.param("id");
    const parsed = parseCustomAgentId(id);
    if (!parsed) return c.json({ success: false, error: "Invalid custom agent id" }, 400);

    const body = await c.req.json<{ agent: AgentId; scope: CustomAgentScope }>();
    if (!SUPPORTED_AGENTS.includes(body.agent)) {
      return c.json({ success: false, error: "Unsupported agent" }, 400);
    }
    if (!SUPPORTED_SCOPES.includes(body.scope)) {
      return c.json({ success: false, error: "Invalid scope" }, 400);
    }

    const result = undeployCustomAgentFromTarget(parsed.name, body.agent, body.scope, projectDir);
    return c.json(result, result.success ? 200 : 500);
  });

  app.post("/api/claude/custom-agents/scan", async (c) => {
    const body: { mode?: "project" | "folder" | "device"; scanPath?: string } = await c.req
      .json()
      .catch(() => ({}));
    const mode = body.mode ?? "project";

    const knownNames = new Set(
      listCustomAgents(projectDir)
        .map((agent) => parseCustomAgentId(agent.id)?.name)
        .filter((name): name is string => !!name),
    );

    let scanRoots: string[];
    let maxDepth: number;
    if (mode === "project") {
      scanRoots = [projectDir];
      maxDepth = 5;
    } else if (mode === "folder" && body.scanPath) {
      scanRoots = [body.scanPath];
      maxDepth = 8;
    } else {
      scanRoots = [os.homedir()];
      maxDepth = 6;
    }

    const discovered = scanForAgents(scanRoots, maxDepth, knownNames);
    return c.json({ discovered });
  });

  app.post("/api/claude/custom-agents/import", async (c) => {
    const body = await c.req.json<{
      agents: Array<{ name: string; agentPath: string }>;
      scope?: CustomAgentScope;
      deployAgents?: AgentId[];
    }>();

    if (!Array.isArray(body.agents)) {
      return c.json({ success: false, error: "agents array is required" }, 400);
    }

    ensureRegistryDir();
    const imported: string[] = [];
    const deployNames = new Set<string>();

    for (const entry of body.agents) {
      if (!entry.agentPath || !existsSync(entry.agentPath)) continue;

      const baseName =
        normalizeAgentFileName(entry.name) ||
        normalizeAgentFileName(path.basename(entry.agentPath).replace(/\.md$/, ""));
      if (!baseName) continue;

      const targetPath = getRegistryAgentPath(baseName);

      if (!existsSync(targetPath)) {
        try {
          const content = readFileSync(entry.agentPath, "utf-8");
          writeFileSync(targetPath, content);
          imported.push(baseName);
        } catch {
          continue;
        }
      }

      deployNames.add(baseName);
    }

    const scope = body.scope === "global" ? "global" : "project";
    const deployAgents = sanitizeDeployAgents(body.deployAgents, ["claude"]);
    for (const agentName of deployNames) {
      for (const agentId of deployAgents) {
        deployCustomAgentToTarget(agentName, agentId, scope, projectDir);
      }
    }

    return c.json({ success: true, imported });
  });
}
