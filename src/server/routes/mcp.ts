import type { Hono } from "hono";

import type { WorktreeManager } from "../manager";
import { deployAgentInstructions, removeAgentInstructions } from "../lib/builtin-instructions";
import {
  type AgentId,
  type Scope,
  AGENT_SPECS,
  VALID_AGENTS,
  getScopeSpec,
  resolveConfigPath,
  isServerConfigured,
  writeServerToConfig,
  removeServerFromConfig,
} from "../lib/tool-configs";

const OPENKIT_MCP_ENTRY = { command: "openkit", args: ["mcp"] };

export function registerMcpRoutes(app: Hono, manager: WorktreeManager) {
  app.get("/api/mcp/status", (c) => {
    const projectDir = manager.getConfigDir();

    const statuses: Record<string, { global?: boolean; project?: boolean }> = {};
    for (const [id, spec] of Object.entries(AGENT_SPECS)) {
      const entry: { global?: boolean; project?: boolean } = {};
      if (spec.global) {
        const filePath = resolveConfigPath(spec.global.configPath, projectDir);
        entry.global = isServerConfigured(filePath, spec.global, "openkit");
      }
      if (spec.project) {
        const filePath = resolveConfigPath(spec.project.configPath, projectDir);
        entry.project = isServerConfigured(filePath, spec.project, "openkit");
      }
      statuses[id] = entry;
    }
    return c.json({ statuses });
  });

  app.post("/api/mcp/setup", async (c) => {
    try {
      const body = await c.req.json();
      const agent = body.agent as AgentId;
      const scope = (body.scope as Scope) ?? "global";

      if (!agent || !VALID_AGENTS.has(agent)) {
        return c.json({ success: false, error: "Invalid agent" }, 400);
      }

      const spec = getScopeSpec(agent, scope);
      if (!spec) {
        return c.json(
          { success: false, error: `${scope} scope not supported for this agent` },
          400,
        );
      }

      const projectDir = manager.getConfigDir();
      const filePath = resolveConfigPath(spec.configPath, projectDir);
      const result = writeServerToConfig(filePath, spec, "openkit", OPENKIT_MCP_ENTRY);

      if (result.success) {
        deployAgentInstructions(agent, projectDir, scope);
      }

      return c.json(result, result.success ? 200 : 500);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to setup MCP",
        },
        500,
      );
    }
  });

  app.post("/api/mcp/remove", async (c) => {
    try {
      const body = await c.req.json();
      const agent = body.agent as AgentId;
      const scope = (body.scope as Scope) ?? "global";

      if (!agent || !VALID_AGENTS.has(agent)) {
        return c.json({ success: false, error: "Invalid agent" }, 400);
      }

      const spec = getScopeSpec(agent, scope);
      if (!spec) {
        return c.json(
          { success: false, error: `${scope} scope not supported for this agent` },
          400,
        );
      }

      const projectDir = manager.getConfigDir();
      const filePath = resolveConfigPath(spec.configPath, projectDir);
      const result = removeServerFromConfig(filePath, spec, "openkit");

      if (result.success) {
        removeAgentInstructions(agent, projectDir, scope);
      }

      return c.json(result, result.success ? 200 : 500);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to remove MCP config",
        },
        500,
      );
    }
  });
}
