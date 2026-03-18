import "./runtime/install-command-monitor";

import { createAdaptorServer } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
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
import { isCommandOnPath } from "@openkit/shared/command-path";
import { resolveAvailableWebUiPath } from "@openkit/shared/ui-components";
import { log, Logger } from "./logger";
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
import { registerLogsRoutes } from "./routes/logs";
import { registerMcpServerRoutes } from "./routes/mcp-servers";
import { registerSkillRoutes } from "./routes/skills";
import { registerClaudePluginRoutes } from "./routes/claude-plugins";
import { registerClaudeCustomAgentRoutes } from "./routes/claude-custom-agents";
import { registerNotesRoutes } from "./routes/notes";
import { registerTaskRoutes } from "./routes/tasks";
import { registerTerminalRoutes } from "./routes/terminal";
import { registerHooksRoutes } from "./routes/verification";
import { registerNgrokConnectRoutes } from "./routes/ngrok-connect";
import { NotesManager } from "./notes-manager";
import { TerminalManager } from "./terminal-manager";
import { HooksManager } from "./verification-manager";
import { PerfMonitor } from "./perf-monitor";
import { registerPerfRoutes } from "./routes/perf";
import { setCommandMonitorSink } from "./runtime/command-monitor";
import { setFetchMonitorSink } from "./runtime/fetch-monitor";
import type { WorktreeConfig } from "./types";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function resolveProjectRoot(startDir: string): string {
  const bundledRoot = process.env.OPENKIT_BUNDLED_ROOT;
  if (bundledRoot && existsSync(path.join(bundledRoot, "web", "index.html"))) {
    return bundledRoot;
  }

  const devWorkspaceRoot = path.resolve(startDir, "..", "..", "..");
  return devWorkspaceRoot;
}

const projectRoot = resolveProjectRoot(currentDir);
const MAX_HTTP_PAYLOAD_CHARS = 16_000;

function formatLifecycleHookTriggerContext(
  trigger: "worktree-created" | "worktree-removed",
): string {
  return trigger === "worktree-created" ? "worktree created" : "worktree removed";
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

function shouldLogOpsRequestPath(requestPath: string): boolean {
  return requestPath.startsWith("/api/") || requestPath.startsWith("/_ok/");
}

function normalizeContentType(contentType: string | null | undefined): string {
  if (!contentType) return "";
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isTextPayloadContentType(contentType: string): boolean {
  if (!contentType) return false;
  if (contentType.startsWith("text/")) return true;
  if (contentType === "application/json") return true;
  if (contentType.endsWith("+json")) return true;
  if (contentType === "application/x-www-form-urlencoded") return true;
  if (contentType === "application/xml" || contentType === "text/xml") return true;
  if (contentType === "application/graphql") return true;
  return false;
}

function truncateHttpPayload(payload: string): { value: string; truncated: boolean } {
  if (payload.length <= MAX_HTTP_PAYLOAD_CHARS) {
    return { value: payload, truncated: false };
  }
  return {
    value: `${payload.slice(0, MAX_HTTP_PAYLOAD_CHARS)}\n...[truncated]`,
    truncated: true,
  };
}

async function captureHttpRequestPayload(rawRequest: Request): Promise<Record<string, unknown>> {
  const method = rawRequest.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return {};
  }

  const requestContentType = normalizeContentType(rawRequest.headers.get("content-type"));
  if (!requestContentType) return {};
  if (!isTextPayloadContentType(requestContentType)) {
    return {
      requestContentType,
      requestPayloadOmitted: true,
    };
  }

  try {
    const payload = await rawRequest.clone().text();
    if (!payload) {
      return { requestContentType };
    }
    const { value, truncated } = truncateHttpPayload(payload);
    return {
      requestContentType,
      requestPayload: value,
      ...(truncated ? { requestPayloadTruncated: true } : {}),
    };
  } catch {
    return {
      requestContentType,
      requestPayloadError: "Failed to read request payload",
    };
  }
}

async function captureHttpResponsePayload(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 101) {
    return { responseTransport: "ws" };
  }

  const responseContentType = normalizeContentType(response.headers.get("content-type"));
  if (!responseContentType) return {};
  if (responseContentType === "text/event-stream") {
    return { responseContentType, responseTransport: "sse" };
  }
  if (!isTextPayloadContentType(responseContentType)) {
    return {
      responseContentType,
      responsePayloadOmitted: true,
    };
  }
  if (response.status === 204 || response.status === 304 || response.body === null) {
    return { responseContentType };
  }

  try {
    const payload = await response.clone().text();
    if (!payload) {
      return { responseContentType };
    }
    const { value, truncated } = truncateHttpPayload(payload);
    return {
      responseContentType,
      responsePayload: value,
      ...(truncated ? { responsePayloadTruncated: true } : {}),
    };
  } catch {
    return {
      responseContentType,
      responsePayloadError: "Failed to read response payload",
    };
  }
}

const httpLog = log.get("http");
const terminalLog = log.get("terminal");

export function createWorktreeServer(manager: WorktreeManager) {
  const app = new Hono();
  const terminalManager = new TerminalManager((event) => {
    const level = event.level ?? (event.status === "failed" ? "error" : "info");
    const status = event.status ?? "info";
    const context = {
      domain: "terminal",
      action: event.action,
      status,
      worktreeId: event.worktreeId,
      projectName: manager.getProjectName() ?? undefined,
      ...event.metadata,
    };
    if (level === "error") {
      terminalLog.error(event.message, context);
    } else {
      terminalLog.info(event.message, context);
    }
  });
  const notesManager = new NotesManager(manager.getConfigDir());
  const hooksManager = new HooksManager(manager);
  const perfMonitor = new PerfMonitor(manager, terminalManager);

  manager.setWorktreeLifecycleHookRunner(async (trigger, worktreeId, worktreePath) => {
    const activityLog = manager.getActivityLog();
    const groupKey = `hooks:${worktreeId}:${trigger}`;
    const triggerContext = formatLifecycleHookTriggerContext(trigger);

    activityLog.addEvent({
      category: "agent",
      type: ACTIVITY_TYPES.HOOKS_STARTED,
      severity: "info",
      title: `Hooks started (${triggerContext})`,
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
      title: `Hooks completed (${triggerContext})`,
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

  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  app.use("*", cors());
  app.use("*", async (c, next) => {
    const startedAt = Date.now();
    const requestPath = c.req.path;
    const shouldLog = shouldLogOpsRequestPath(requestPath);
    const requestPayloadMetadata = shouldLog ? await captureHttpRequestPayload(c.req.raw) : {};
    const requestUpgrade = (c.req.header("upgrade") ?? "").trim().toLowerCase();
    const requestTransport = requestUpgrade === "websocket" ? "ws" : undefined;

    try {
      await next();
    } finally {
      if (shouldLog) {
        const statusCode = c.res.status || 200;
        const responsePayloadMetadata = await captureHttpResponsePayload(c.res);
        const message = `${c.req.method} ${requestPath} -> ${statusCode}`;
        const context = {
          domain: "http",
          action: "http.request",
          status: statusCode >= 400 ? "failed" : "success",
          projectName: manager.getProjectName() ?? undefined,
          method: c.req.method,
          path: requestPath,
          statusCode,
          durationMs: Date.now() - startedAt,
          ...(requestTransport ? { requestTransport } : {}),
          ...requestPayloadMetadata,
          ...responsePayloadMetadata,
        };
        if (statusCode >= 500) {
          httpLog.error(message, context);
        } else if (statusCode >= 400) {
          httpLog.warn(message, context);
        } else {
          httpLog.info(message, context);
        }
      }
    }
  });
  app.onError((err, c) => {
    httpLog.error(`${c.req.method} ${c.req.path} -> 500 ${err.message}`, {
      domain: "http",
      action: "http.error",
      status: "failed",
      projectName: manager.getProjectName() ?? undefined,
      method: c.req.method,
      path: c.req.path,
      statusCode: 500,
      error: err.message,
      stack: err.stack,
    });
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
  registerLogsRoutes(app, manager);
  registerMcpServerRoutes(app, manager);
  registerSkillRoutes(app, manager);
  registerClaudePluginRoutes(app, manager);
  registerClaudeCustomAgentRoutes(app, manager);
  registerTaskRoutes(app, manager, notesManager, hooksManager);
  registerNotesRoutes(app, manager, notesManager, hooksManager);
  registerTerminalRoutes(app, manager, terminalManager, upgradeWebSocket);
  registerHooksRoutes(app, manager, hooksManager, notesManager);
  registerPerfRoutes(app, perfMonitor);

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

    const wrappersToInstall = commandNames.filter((cmd) => !isCommandOnPath(cmd));
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
  const commandLog = log.get("command");
  setCommandMonitorSink((event) => {
    const commandText = [event.command, ...event.args].join(" ");
    const projectName = manager.getProjectName() ?? undefined;
    const context = {
      domain: "command",
      action: "command.exec",
      runId: event.runId,
      projectName,
      command: {
        command: event.command,
        args: event.args,
        cwd: event.cwd,
        pid: event.pid ?? null,
        exitCode: event.exitCode ?? null,
        signal: event.signal ?? null,
        durationMs: event.durationMs,
        stdout: event.stdout,
        stderr: event.stderr,
      },
      phase: event.phase,
      ...(event.error ? { error: event.error } : {}),
    };
    if (event.phase === "start") {
      commandLog.started(`Started: ${commandText}`, context);
    } else if (event.phase === "failure") {
      commandLog.error(`Failed: ${commandText}${event.error ? ` (${event.error})` : ""}`, context);
    } else {
      commandLog.success(`Succeeded: ${commandText}`, context);
    }
  });

  const httpClientLog = log.get("http-client");
  setFetchMonitorSink((event) => {
    const method = (event.method ?? "GET").toUpperCase();
    const urlPath = event.path ?? event.url ?? "/";
    const statusCode = typeof event.statusCode === "number" ? event.statusCode : undefined;
    const projectName = manager.getProjectName() ?? undefined;
    const isFailure =
      event.phase === "failure" || (typeof statusCode === "number" && statusCode >= 400);
    const context = {
      domain: "http",
      action: "http.client",
      status: isFailure ? "failed" : "success",
      runId: event.runId,
      projectName,
      direction: "outbound",
      method,
      url: event.url,
      path: urlPath,
      ...(typeof statusCode === "number" ? { statusCode } : {}),
      durationMs: event.durationMs,
      source: event.source,
      ...(event.requestContentType ? { requestContentType: event.requestContentType } : {}),
      ...(event.requestPayload ? { requestPayload: event.requestPayload } : {}),
      ...(event.requestPayloadTruncated ? { requestPayloadTruncated: true } : {}),
      ...(event.requestPayloadOmitted ? { requestPayloadOmitted: true } : {}),
      ...(event.requestPayloadError ? { requestPayloadError: event.requestPayloadError } : {}),
      ...(event.requestTransport ? { requestTransport: event.requestTransport } : {}),
      ...(event.responseContentType ? { responseContentType: event.responseContentType } : {}),
      ...(event.responsePayload ? { responsePayload: event.responsePayload } : {}),
      ...(event.responsePayloadTruncated ? { responsePayloadTruncated: true } : {}),
      ...(event.responsePayloadOmitted ? { responsePayloadOmitted: true } : {}),
      ...(event.responsePayloadError ? { responsePayloadError: event.responsePayloadError } : {}),
      ...(event.responseTransport ? { responseTransport: event.responseTransport } : {}),
      ...(event.error ? { error: event.error } : {}),
    };
    const message =
      event.phase === "failure"
        ? `${method} ${urlPath} -> ${event.error ?? "request failed"}`
        : `${method} ${urlPath} -> ${statusCode ?? 0}`;

    if (event.phase === "failure" || (typeof statusCode === "number" && statusCode >= 500)) {
      httpClientLog.error(message, context);
    } else if (isFailure) {
      httpClientLog.warn(message, context);
    } else {
      httpClientLog.info(message, context);
    }
  });
  ensureCliInPath();
  const { app, injectWebSocket, terminalManager } = createWorktreeServer(manager);

  const actualPort = await findAvailablePort(requestedPort);

  // Configure the Go logger to POST entries to this server's client-logs endpoint.
  // All log calls (from this process and any external process that calls setSink)
  // flow through the server → opsLog.addEvent() → file + real-time listeners.
  Logger.setSink(`http://localhost:${actualPort}`, manager.getProjectName() ?? "unknown");

  const server = createAdaptorServer({
    fetch: app.fetch,
  });

  injectWebSocket(server);

  server.listen(actualPort, () => {
    log.success(`Server running at http://localhost:${actualPort}`);

    // Emit a structured line that the Electron parent process can parse to discover
    // the actual port when findAvailablePort() had to pick a different one.
    // Protocol message for parent process port discovery — not a log statement.
    // Uses raw stdout because the logger sink targets the server's own HTTP endpoint.
    process.stdout.write(`__OPENKIT_PORT__=${actualPort}\n`);
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

    Logger.closeSink();
    terminalManager.destroyAll();
    await manager.stopAll();
    setCommandMonitorSink(null);
    setFetchMonitorSink(null);
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
export { PortManager } from "@openkit/port-offset/port-manager";
export type {
  PortConfig,
  WorktreeConfig,
  WorktreeCreateRequest,
  WorktreeInfo,
  WorktreeListResponse,
  WorktreeRenameRequest,
  WorktreeResponse,
} from "./types";
