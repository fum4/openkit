import { createAdaptorServer } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import net from "net";
import os from "os";
import { Hono } from "hono";
import { cors } from "hono/cors";
import path from "path";
import { fileURLToPath } from "url";

import {
  APP_NAME,
  CLI_COMMAND,
  CLI_COMMAND_ALIAS,
  CONFIG_DIR_NAME,
  DEFAULT_PORT,
  LEGACY_CLI_COMMAND,
} from "@openkit/shared/constants";
import { resolveAvailableWebUiPath } from "@openkit/shared/ui-components";
import { log } from "@openkit/shared/logger";
import { checkGhAuth } from "@openkit/integrations/github/gh-client";
import { testConnection as testJiraConnection } from "@openkit/integrations/jira/auth";
import { loadJiraCredentials } from "@openkit/integrations/jira/credentials";
import { testConnection as testLinearConnection } from "@openkit/integrations/linear/api";
import { loadLinearCredentials } from "@openkit/integrations/linear/credentials";
import { WorktreeManager } from "./manager";
import { ACTIVITY_TYPES } from "./activity-event";
import { registerWorktreeRoutes } from "./routes/worktrees";
import { registerConfigRoutes } from "./routes/config";
import { registerGitHubRoutes } from "./routes/github";
import { registerJiraRoutes } from "./routes/jira";
import { registerLinearRoutes } from "./routes/linear";
import { registerAgentCliRoutes } from "./routes/agent-cli";
import { registerActivityRoutes } from "./routes/activity";
import { registerEventRoutes } from "./routes/events";
import { registerMcpRoutes } from "./routes/mcp";
import { registerMcpServerRoutes } from "./routes/mcp-servers";
import { registerSkillRoutes } from "./routes/skills";
import { registerClaudePluginRoutes } from "./routes/claude-plugins";
import { registerMcpTransportRoute } from "./routes/mcp-transport";
import { registerNotesRoutes } from "./routes/notes";
import { registerTaskRoutes } from "./routes/tasks";
import { registerTerminalRoutes } from "./routes/terminal";
import { registerHooksRoutes } from "./routes/verification";
import { registerNgrokConnectRoutes } from "./routes/ngrok-connect";
import { isMcpSetupEnabled } from "./feature-flags";
import { NotesManager } from "./notes-manager";
import { TerminalManager } from "./terminal-manager";
import { HooksManager } from "./verification-manager";
import { ensureBundledSkills } from "./verification-skills";
import type { WorktreeConfig } from "./types";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function resolveProjectRoot(startDir: string): string {
  const candidates = [
    path.resolve(startDir, "..", "..", ".."), // apps/server/src or apps/cli/dist -> root
    path.resolve(startDir, ".."), // dist -> root (legacy)
    path.resolve(startDir, "..", ".."), // fallback
  ];

  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, "package.json")) &&
      existsSync(path.join(candidate, "apps"))
    ) {
      return candidate;
    }
  }

  return path.resolve(startDir, "..");
}

const projectRoot = resolveProjectRoot(currentDir);

function formatHookTriggerLabel(trigger: "worktree-created" | "worktree-removed"): string {
  return trigger === "worktree-created" ? "Worktree Created" : "Worktree Removed";
}

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const server = net.createServer();
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port);
    };
    tryPort(startPort);
  });
}

export function createWorktreeServer(manager: WorktreeManager) {
  const app = new Hono();
  const mcpSetupEnabled = isMcpSetupEnabled();
  const terminalManager = new TerminalManager();
  const notesManager = new NotesManager(manager.getConfigDir());
  const hooksManager = new HooksManager(manager);

  manager.setWorktreeLifecycleHookRunner(async (trigger, worktreeId, worktreePath) => {
    const activityLog = manager.getActivityLog();
    const groupKey = `hooks:${worktreeId}:${trigger}`;
    const label = formatHookTriggerLabel(trigger);

    activityLog.addEvent({
      category: "agent",
      type: ACTIVITY_TYPES.HOOKS_STARTED,
      severity: "info",
      title: `${label} hooks started`,
      detail: "Executing command hooks...",
      worktreeId,
      projectName: manager.getProjectName() ?? undefined,
      groupKey,
      metadata: {
        trigger,
      },
    });

    const results = await hooksManager.runWorktreeLifecycleCommands(
      trigger,
      worktreeId,
      worktreePath,
    );
    const failedCount = results.filter((step) => step.status === "failed").length;
    const detail =
      results.length === 0
        ? "No runnable command hooks configured for this trigger."
        : failedCount > 0
          ? `${failedCount} of ${results.length} command hooks failed.`
          : `${results.length} command hooks passed.`;

    activityLog.addEvent({
      category: "agent",
      type: ACTIVITY_TYPES.HOOKS_RAN,
      severity: failedCount > 0 ? "error" : "success",
      title: `${label} hooks completed`,
      detail,
      worktreeId,
      projectName: manager.getProjectName() ?? undefined,
      groupKey,
      metadata: {
        trigger,
        commandResults: results,
      },
    });
  });
  manager.setTaskHooksProvider((worktreeId) => {
    const config = hooksManager.getConfig();
    const effectiveSkills = hooksManager.getEffectiveSkills(worktreeId, notesManager);
    return {
      checks: config.steps,
      skills: effectiveSkills,
    };
  });

  // Seed bundled skills into ~/.openkit/skills/ registry only.
  // Hook selection/import is explicit and user-controlled.
  ensureBundledSkills();

  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  app.use("*", cors());
  app.onError((err, c) => {
    log.error(`${c.req.method} ${c.req.path} → ${err.message}`);
    if (process.env.DEBUG) log.debug(err.stack ?? "");
    return c.json({ error: err.message }, 500);
  });

  registerWorktreeRoutes(app, manager, terminalManager);
  registerConfigRoutes(app, manager);
  registerGitHubRoutes(app, manager);
  registerJiraRoutes(app, manager);
  registerLinearRoutes(app, manager);
  registerAgentCliRoutes(app);
  registerNgrokConnectRoutes(app, manager);
  registerEventRoutes(app, manager);
  registerActivityRoutes(app, manager.getActivityLog(), () => manager.getProjectName());
  if (mcpSetupEnabled) {
    registerMcpRoutes(app, manager);
  } else {
    log.info("MCP setup routes disabled. Set OPENKIT_ENABLE_MCP_SETUP=1 to enable.");
  }
  registerMcpServerRoutes(app, manager);
  registerSkillRoutes(app, manager);
  registerClaudePluginRoutes(app, manager);
  registerTaskRoutes(app, manager, notesManager);
  registerNotesRoutes(app, manager, notesManager, hooksManager);
  registerTerminalRoutes(app, manager, terminalManager, upgradeWebSocket);
  registerHooksRoutes(app, manager, hooksManager, notesManager);
  registerMcpTransportRoute(app, { manager, notesManager, hooksManager });

  // Background verification of all integration connections
  app.get("/api/integrations/verify", async (c) => {
    const configDir = manager.getConfigDir();

    const [github, jira, linear] = await Promise.all([
      // GitHub: re-check gh CLI auth
      (async () => {
        const ghManager = manager.getGitHubManager();
        if (!ghManager) return null;
        const status = ghManager.getStatus();
        if (!status.authenticated) return null;
        const ok = await checkGhAuth();
        return { ok };
      })(),
      // Jira: test API connection
      (async () => {
        const creds = loadJiraCredentials(configDir);
        if (!creds) return null;
        try {
          await testJiraConnection(creds, configDir);
          return { ok: true };
        } catch {
          return { ok: false };
        }
      })(),
      // Linear: test GraphQL connection
      (async () => {
        const creds = loadLinearCredentials(configDir);
        if (!creds) return null;
        try {
          await testLinearConnection(creds);
          return { ok: true };
        } catch {
          return { ok: false };
        }
      })(),
    ]);

    return c.json({ github, jira, linear });
  });

  const uiDir = resolveAvailableWebUiPath(projectRoot);
  if (uiDir) {
    app.use("/*", serveStatic({ root: uiDir }));
  }

  app.get("*", (c) => {
    if (!uiDir) {
      return c.text("UI not installed. Run `openkit ui` to install optional UI components.", 404);
    }

    const indexPath = path.join(uiDir, "index.html");
    try {
      const html = readFileSync(indexPath, "utf-8");
      return c.html(html);
    } catch {
      return c.text("UI not installed. Run `openkit ui` to install optional UI components.", 404);
    }
  });

  return { app, injectWebSocket, terminalManager };
}

/**
 * Ensure the OpenKit CLI is available in PATH.
 * If not found, creates a shell wrapper in ~/.local/bin/ pointing to the CLI entry point.
 */
function ensureCliInPath() {
  const commandNames = [CLI_COMMAND, CLI_COMMAND_ALIAS, LEGACY_CLI_COMMAND];

  // Always point to the built CLI (works regardless of dev/prod mode)
  const builtCliPath = path.resolve(projectRoot, "apps", "cli", "dist", "cli", "index.js");
  if (!existsSync(builtCliPath)) {
    log.warn(`Built CLI not found at ${builtCliPath}, run 'pnpm build' first`);
    return;
  }

  const binDir = path.join(os.homedir(), ".local", "bin");
  const runtimePath = process.execPath;
  const needsElectronNodeMode = Boolean(process.versions.electron);
  const pathDirs = (process.env.PATH ?? "").split(":");
  const hasLocalBinInPath = pathDirs.includes(binDir);

  try {
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }

    // Write a shell wrapper that calls the current runtime with the built CLI.
    // In packaged Electron builds, force Electron to run in Node mode.
    const wrapperBody = needsElectronNodeMode
      ? `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${runtimePath}" "${builtCliPath}" "$@"\n`
      : `#!/bin/sh\nexec "${runtimePath}" "${builtCliPath}" "$@"\n`;

    const wrappersToInstall = commandNames.filter((cmd) => {
      try {
        execFileSync("which", [cmd], { stdio: "ignore" });
        return false;
      } catch {
        return true;
      }
    });
    if (wrappersToInstall.length === 0) return;

    for (const commandName of wrappersToInstall) {
      const wrapperPath = path.join(binDir, commandName);
      if (existsSync(wrapperPath)) {
        unlinkSync(wrapperPath);
      }
      writeFileSync(wrapperPath, wrapperBody, { mode: 0o755 });
      log.success(`Installed ${commandName} CLI → ${wrapperPath}`);
    }

    if (!hasLocalBinInPath) {
      log.warn(
        `${binDir} is not in your PATH. Add it to your shell profile: export PATH="$HOME/.local/bin:$PATH"`,
      );
    }
  } catch (err) {
    log.warn(
      `Could not install ${APP_NAME} CLI wrappers: ${err instanceof Error ? err.message : err}`,
    );
  }
}

export async function startWorktreeServer(
  config: WorktreeConfig,
  configFilePath?: string | null,
  options?: { exitOnClose?: boolean; port?: number },
): Promise<{ manager: WorktreeManager; close: () => Promise<void>; port: number }> {
  const exitOnClose = options?.exitOnClose ?? true;
  const requestedPort = options?.port ?? DEFAULT_PORT;
  const manager = new WorktreeManager(config, configFilePath ?? null);
  ensureCliInPath();
  const { app, injectWebSocket, terminalManager } = createWorktreeServer(manager);

  const actualPort = await findAvailablePort(requestedPort);

  const server = createAdaptorServer({
    fetch: app.fetch,
  });

  injectWebSocket(server);

  server.listen(actualPort, () => {
    log.success(`Server running at http://localhost:${actualPort}`);
  });

  // Initialize GitHub in the background (not blocking server startup)
  manager.initGitHub().catch(() => {});

  // Write server.json for agent discovery
  const configDir = manager.getConfigDir();
  const serverJsonPath = configDir ? path.join(configDir, CONFIG_DIR_NAME, "server.json") : null;
  if (serverJsonPath && existsSync(path.dirname(serverJsonPath))) {
    try {
      writeFileSync(
        serverJsonPath,
        JSON.stringify({ url: `http://localhost:${actualPort}`, pid: process.pid }, null, 2),
      );
    } catch {
      // Non-critical
    }
  }

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    log.info("\nShutting down...");

    // Clean up server.json
    if (serverJsonPath) {
      try {
        unlinkSync(serverJsonPath);
      } catch {
        /* ignore */
      }
    }

    terminalManager.destroyAll();
    await manager.stopAll();
    server.close();
    if (exitOnClose) {
      process.exit(0);
    }
  };

  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  return { manager, close, port: actualPort };
}

export { WorktreeManager } from "./manager";
export { PortManager } from "./port-manager";
export type {
  PortConfig,
  WorktreeConfig,
  WorktreeCreateRequest,
  WorktreeInfo,
  WorktreeListResponse,
  WorktreeRenameRequest,
  WorktreeResponse,
} from "./types";
