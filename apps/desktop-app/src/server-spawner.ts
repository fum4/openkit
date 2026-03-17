import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { log } from "./logger.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const isPackaged = Boolean(process.resourcesPath) && currentDir.includes("app.asar");
const devWorkspaceRoot = path.resolve(currentDir, "..", "..", "..");
const projectRoot = isPackaged ? process.resourcesPath : devWorkspaceRoot;
const devCliPath = path.join(projectRoot, "apps", "cli", "dist", "cli", "index.js");
const packagedCliPath = path.join(projectRoot, "cli", "cli", "index.js");

function getCliPath(): string {
  return isPackaged ? packagedCliPath : devCliPath;
}

function ensureDevCliArtifact(cliPath: string): void {
  if (isPackaged || existsSync(cliPath)) return;
  const message = `CLI build output is missing at ${cliPath}. Run pnpm dev:desktop-app or build cli first.`;
  log.error(message, { domain: "server-spawner" });
  throw new Error(message);
}

export function spawnServer(projectDir: string, port: number): ChildProcess {
  // Path to the CLI entry point
  const cliPath = getCliPath();
  const runtime = isPackaged ? process.execPath : "node";

  // --no-open: don't open browser/electron
  const args = ["--no-open"];

  ensureDevCliArtifact(cliPath);

  log.debug("Spawning server", {
    domain: "server-spawner",
    cliPath,
    runtime,
    projectDir,
    port,
  });

  // Strip IDE/Claude Code nesting markers so the server's child processes
  // (especially the Claude CLI) don't detect a nested context and suppress output.
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !k.startsWith("CLAUDECODE") &&
        !k.startsWith("CLAUDE_CODE_") &&
        !k.startsWith("CLAUDE_AGENT_") &&
        !k.startsWith("CURSOR_SPAWN") &&
        !k.startsWith("CURSOR_TRACE") &&
        !k.startsWith("CURSOR_EXTENSION") &&
        !k.startsWith("CURSOR_WORKSPACE") &&
        !k.startsWith("VSCODE_"),
    ),
  );

  const child = spawn(runtime, [cliPath, ...args], {
    cwd: projectDir,
    env: {
      ...cleanEnv,
      OPENKIT_SERVER_PORT: String(port),
      OPENKIT_NO_OPEN: "1",
      ...(isPackaged ? { OPENKIT_BUNDLED_ROOT: process.resourcesPath } : {}),
      ...(isPackaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.on("error", (err) => {
    log.error(`Spawn error: ${err.message}`, { domain: "server-spawner" });
  });

  // Note: project-manager.ts also attaches a stdout listener for __OPENKIT_PORT__
  // parsing. Both listeners fire for every chunk — this one is for debug logging.
  child.stdout?.on("data", (data: Buffer) => {
    log.debug(`[stdout] ${data.toString().trim()}`, { domain: "server-spawner" });
  });

  child.stderr?.on("data", (data: Buffer) => {
    log.debug(`[stderr] ${data.toString().trim()}`, { domain: "server-spawner" });
  });

  return child;
}

export async function waitForServerReady(
  getPort: number | (() => number),
  timeout = 30000,
): Promise<boolean> {
  const start = Date.now();
  let lastError: string | null = null;
  let lastPort: number | null = null;

  while (Date.now() - start < timeout) {
    const port = typeof getPort === "function" ? getPort() : getPort;
    lastPort = port;
    try {
      const res = await fetch(`http://localhost:${port}/api/config`);
      if (res.ok) return true;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  log.warn("Server readiness timed out", {
    domain: "server-spawner",
    port: lastPort,
    timeout,
    lastError,
  });

  return false;
}

export async function stopServer(process: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!process || process.killed) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      // Force kill if graceful shutdown takes too long
      process.kill("SIGKILL");
      resolve();
    }, 5000);

    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    // Send graceful shutdown signal
    process.kill("SIGTERM");
  });
}
