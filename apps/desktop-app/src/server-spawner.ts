import { spawn, type ChildProcess } from "child_process";
import { appendFileSync, existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const debugLog = "/tmp/OpenKit-debug.log";
const CONFIG_DIR_NAME = ".openkit";
function debug(msg: string) {
  appendFileSync(debugLog, `${new Date().toISOString()} ${msg}\n`);
}

interface ServerRuntimeInfo {
  pid: number;
  port: number;
  url: string;
}

export interface ServerReadyResult {
  actualPort: number | null;
  ready: boolean;
  url: string | null;
}

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
  debug(`preflight error: ${message}`);
  throw new Error(message);
}

export function spawnServer(projectDir: string, port: number): ChildProcess {
  // Path to the CLI entry point
  const cliPath = getCliPath();
  const runtime = isPackaged ? process.execPath : "node";

  // --no-open: don't open browser/electron
  const args = ["--no-open"];

  ensureDevCliArtifact(cliPath);

  debug(`--- spawn ---`);
  debug(`cliPath: ${cliPath}`);
  debug(`runtime: ${runtime}`);
  debug(`projectDir: ${projectDir}`);
  debug(`port: ${port}`);
  debug(`PATH: ${process.env.PATH}`);

  const child = spawn(runtime, [cliPath, ...args], {
    cwd: projectDir,
    env: {
      ...process.env,
      OPENKIT_SERVER_PORT: String(port),
      OPENKIT_NO_OPEN: "1",
      ...(isPackaged ? { OPENKIT_BUNDLED_ROOT: process.resourcesPath } : {}),
      ...(isPackaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.on("error", (err) => {
    debug(`spawn error: ${err.message}`);
  });

  // Log server output for debugging
  child.stdout?.on("data", (data: Buffer) => {
    debug(`[stdout] ${data.toString().trim()}`);
  });

  child.stderr?.on("data", (data: Buffer) => {
    debug(`[stderr] ${data.toString().trim()}`);
  });

  return child;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readServerRuntimeInfo(projectDir: string, expectedPid?: number): ServerRuntimeInfo | null {
  const serverJsonPath = path.join(projectDir, CONFIG_DIR_NAME, "server.json");
  if (!existsSync(serverJsonPath)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(serverJsonPath, "utf-8"));
    if (typeof raw.url !== "string" || typeof raw.pid !== "number") {
      debug(`server.json invalid shape at ${serverJsonPath}`);
      return null;
    }

    if (!isProcessAlive(raw.pid)) {
      debug(`server.json ignored: stale pid ${raw.pid} at ${serverJsonPath}`);
      return null;
    }

    if (expectedPid && raw.pid !== expectedPid) {
      debug(
        `server.json ignored: pid mismatch at ${serverJsonPath}; expected ${expectedPid}, found ${raw.pid}`,
      );
      return null;
    }

    const url = new URL(raw.url);
    const port = Number.parseInt(url.port, 10);
    if (!Number.isFinite(port)) {
      debug(`server.json ignored: invalid url ${raw.url} at ${serverJsonPath}`);
      return null;
    }

    return {
      pid: raw.pid,
      port,
      url: raw.url,
    };
  } catch (error) {
    debug(
      `server.json read failed at ${serverJsonPath}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return null;
  }
}

export async function waitForServerReady(
  projectDir: string,
  requestedPort: number,
  expectedPid?: number,
  timeout = 30000,
): Promise<ServerReadyResult> {
  const start = Date.now();
  debug(
    `waitForServerReady start: requestedPort=${requestedPort} expectedPid=${expectedPid ?? "unknown"} projectDir=${projectDir}`,
  );

  while (Date.now() - start < timeout) {
    const runtimeInfo = readServerRuntimeInfo(projectDir, expectedPid);
    if (runtimeInfo) {
      debug(
        `waitForServerReady discovered server.json url=${runtimeInfo.url} actualPort=${runtimeInfo.port} pid=${runtimeInfo.pid}`,
      );
      try {
        const res = await fetch(`${runtimeInfo.url}/api/config`);
        if (res.ok) {
          debug(
            `waitForServerReady success via server.json requestedPort=${requestedPort} actualPort=${runtimeInfo.port}`,
          );
          return {
            ready: true,
            actualPort: runtimeInfo.port,
            url: runtimeInfo.url,
          };
        }
      } catch (error) {
        debug(
          `waitForServerReady fetch failed via server.json url=${runtimeInfo.url}: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    try {
      const fallbackUrl = `http://localhost:${requestedPort}`;
      const res = await fetch(`${fallbackUrl}/api/config`);
      if (res.ok) {
        debug(
          `waitForServerReady success via requested port requestedPort=${requestedPort} actualPort=${requestedPort}`,
        );
        return {
          ready: true,
          actualPort: requestedPort,
          url: fallbackUrl,
        };
      }
    } catch (error) {
      debug(
        `waitForServerReady fetch failed via requested port ${requestedPort}: ${error instanceof Error ? error.message : "unknown"}`,
      );
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const discoveredInfo = readServerRuntimeInfo(projectDir, expectedPid);
  debug(
    `waitForServerReady timeout: requestedPort=${requestedPort} discoveredPort=${discoveredInfo?.port ?? "none"} expectedPid=${expectedPid ?? "unknown"}`,
  );
  return {
    ready: false,
    actualPort: discoveredInfo?.port ?? null,
    url: discoveredInfo?.url ?? null,
  };
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
