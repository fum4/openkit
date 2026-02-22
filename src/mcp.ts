import { existsSync, readFileSync } from "fs";
import path from "path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { ActionContext } from "./actions";
import { CONFIG_DIR_NAME } from "./constants";
import { WorktreeManager } from "./server/manager";
import { createMcpServer } from "./server/mcp-server-factory";
import { NotesManager } from "./server/notes-manager";
import { HooksManager } from "./server/verification-manager";
import type { WorktreeConfig } from "./server/types";

/**
 * Read server.json to find a running OpenKit server.
 * Returns the server URL if found and the process is alive, null otherwise.
 */
function findRunningServer(configDir: string): string | null {
  const serverJsonPath = path.join(configDir, CONFIG_DIR_NAME, "server.json");
  if (!existsSync(serverJsonPath)) return null;

  try {
    const data = JSON.parse(readFileSync(serverJsonPath, "utf-8"));
    if (!data.url || !data.pid) return null;

    // Check if the process is still running
    process.kill(data.pid, 0); // Throws if process doesn't exist
    return data.url;
  } catch {
    return null;
  }
}

/**
 * Proxy mode: relay JSON-RPC messages between stdio and the running HTTP server.
 * This gives us shared state with the UI.
 */
async function startProxyMode(serverUrl: string) {
  const stdioTransport = new StdioServerTransport();
  const httpTransport = new StreamableHTTPClientTransport(new URL(`${serverUrl}/mcp`));

  // Relay: Claude Code (stdio) → HTTP server
  stdioTransport.onmessage = (message) => {
    httpTransport.send(message).catch((err) => {
      process.stderr.write(`openkit mcp proxy send error: ${err}\n`);
    });
  };

  // Relay: HTTP server → Claude Code (stdio)
  httpTransport.onmessage = (message) => {
    stdioTransport.send(message).catch((err) => {
      process.stderr.write(`openkit mcp proxy reply error: ${err}\n`);
    });
  };

  httpTransport.onerror = (err) => {
    process.stderr.write(`openkit mcp proxy HTTP error: ${err.message}\n`);
  };

  stdioTransport.onclose = async () => {
    await httpTransport.close();
    process.exit(0);
  };

  httpTransport.onclose = async () => {
    await stdioTransport.close();
    process.exit(0);
  };

  await httpTransport.start();
  await stdioTransport.start();

  const cleanup = async () => {
    await httpTransport.close();
    await stdioTransport.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

/**
 * Standalone mode: create own WorktreeManager (no running server).
 */
async function startStandaloneMode(config: WorktreeConfig, configFilePath: string | null) {
  const manager = new WorktreeManager(config, configFilePath);
  await manager.initGitHub();

  const notesManager = new NotesManager(manager.getConfigDir());
  const hooksManager = new HooksManager(manager);
  manager.setWorktreeLifecycleHookRunner(async (trigger, worktreeId, worktreePath) => {
    await hooksManager.runWorktreeLifecycleCommands(trigger, worktreeId, worktreePath);
  });
  const ctx: ActionContext = { manager, notesManager, hooksManager };
  const server = createMcpServer(ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const cleanup = async () => {
    await manager.stopAll();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

export async function startMcpServer(config: WorktreeConfig, configFilePath: string | null) {
  const configDir = configFilePath ? path.dirname(path.dirname(configFilePath)) : process.cwd();
  const serverUrl = findRunningServer(configDir);

  if (serverUrl) {
    process.stderr.write(`openkit mcp: connecting to running server at ${serverUrl}\n`);
    await startProxyMode(serverUrl);
  } else {
    process.stderr.write("openkit mcp: no running server found, starting standalone\n");
    await startStandaloneMode(config, configFilePath);
  }
}
