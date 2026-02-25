import { execFileSync, spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

const DISCOVERY_STABILIZE_MS = 15_000;

export class PortManager {
  private config: WorktreeConfig;

  private usedOffsets: Set<number> = new Set();

  private configFilePath: string | null;

  constructor(config: WorktreeConfig, configFilePath: string | null = null) {
    this.config = config;
    this.configFilePath = configFilePath;
  }

  /**
   * Returns the directory where the main project lives (for discovery, env scanning, etc.).
   * This is always the config file's directory, since cli.ts chdir's there on startup.
   * Note: config.projectDir is a subdirectory path used *within worktrees* (monorepo subpath),
   * not relevant for the main repo root.
   */
  getProjectDir(): string {
    return this.configFilePath ? path.dirname(path.dirname(this.configFilePath)) : process.cwd();
  }

  getDiscoveredPorts(): number[] {
    return [...this.config.ports.discovered];
  }

  getOffsetStep(): number {
    return this.config.ports.offsetStep;
  }

  allocateOffset(): number {
    const step = this.config.ports.offsetStep;
    let offset = step;
    while (this.usedOffsets.has(offset)) {
      offset += step;
    }
    this.usedOffsets.add(offset);
    return offset;
  }

  releaseOffset(offset: number): void {
    this.usedOffsets.delete(offset);
  }

  getPortsForOffset(offset: number): number[] {
    return this.config.ports.discovered.map((port) => port + offset);
  }

  getHookPath(): string {
    const srcHook = path.resolve(currentDir, "runtime", "port-hook.cjs");
    if (existsSync(srcHook)) {
      return srcHook;
    }

    const projectRoot = resolveProjectRoot(currentDir);
    const appLocalHook = path.resolve(
      projectRoot,
      "apps",
      "server",
      "dist",
      "runtime",
      "port-hook.cjs",
    );
    if (existsSync(appLocalHook)) {
      return appLocalHook;
    }

    // Legacy fallback for older root dist layout.
    return path.resolve(projectRoot, "dist", "runtime", "port-hook.cjs");
  }

  getEnvForOffset(offset: number): Record<string, string> {
    if (this.config.ports.discovered.length === 0) {
      return {};
    }

    const hookPath = this.getHookPath();
    const existingNodeOptions = process.env.NODE_OPTIONS || "";
    const requireFlag = `--require ${hookPath}`;

    const nodeOptions = existingNodeOptions ? `${existingNodeOptions} ${requireFlag}` : requireFlag;

    const env: Record<string, string> = {
      NODE_OPTIONS: nodeOptions,
      __WM_PORT_OFFSET__: String(offset),
      __WM_KNOWN_PORTS__: JSON.stringify(this.config.ports.discovered),
    };

    // Resolve env var templates with offset ports
    const envMapping = this.config.envMapping;
    if (envMapping) {
      for (const [key, template] of Object.entries(envMapping)) {
        env[key] = template.replace(/\$\{(\d+)\}/g, (_, portStr) => {
          return String(parseInt(portStr, 10) + offset);
        });
      }
    }

    return env;
  }

  detectEnvMapping(projectDir: string): Record<string, string> {
    const discoveredPorts = this.config.ports.discovered;
    if (discoveredPorts.length === 0) return {};

    const mapping: Record<string, string> = {};

    const scanFile = (filePath: string) => {
      const content = readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        // Strip surrounding quotes
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        // Check if value contains any discovered port
        let template = value;
        let hasPort = false;
        for (const port of discoveredPorts) {
          const portStr = String(port);
          if (template.includes(portStr)) {
            template = template.replaceAll(portStr, `\${${portStr}}`);
            hasPort = true;
          }
        }

        if (hasPort) {
          mapping[key] = template;
        }
      }
    };

    const scanDir = (dir: string) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            scanDir(path.join(dir, entry.name));
          } else if (entry.isFile() && entry.name.startsWith(".env")) {
            scanFile(path.join(dir, entry.name));
          }
        }
      } catch {
        // Directory may not be readable
      }
    };

    scanDir(projectDir);
    return mapping;
  }

  persistEnvMapping(mapping: Record<string, string>): void {
    if (!this.configFilePath) return;

    this.config.envMapping = mapping;

    try {
      const content = readFileSync(this.configFilePath, "utf-8");
      const config = JSON.parse(content);
      config.envMapping = mapping;
      writeFileSync(this.configFilePath, JSON.stringify(config, null, 2) + "\n");
      console.log(`[port-discovery] Saved env mapping to ${this.configFilePath}`);
    } catch (err) {
      console.error(
        "[port-discovery] Failed to persist env mapping:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  async discoverPorts(
    onLog?: (message: string) => void,
  ): Promise<{ ports: number[]; error?: string }> {
    const log = onLog || console.log;

    log("[port-discovery] Starting dev command to discover ports...");

    const [cmd, ...args] = this.config.startCommand.split(" ");
    const workingDir = this.getProjectDir();

    if (!existsSync(workingDir)) {
      return {
        ports: [],
        error: `Project directory "${workingDir}" not found`,
      };
    }

    const child = spawn(cmd, args, {
      cwd: workingDir,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      detached: true,
    });

    const pid = child.pid;
    if (!pid) {
      return { ports: [], error: "Failed to spawn discovery process" };
    }

    log(`[port-discovery] Spawned process (PID: ${pid}), waiting for stabilization...`);

    child.stdout?.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((l: string) => l.trim());
      for (const line of lines) {
        log(`[port-discovery:stdout] ${line}`);
      }
    });

    child.stderr?.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((l: string) => l.trim());
      for (const line of lines) {
        log(`[port-discovery:stderr] ${line}`);
      }
    });

    // Wait for processes to stabilize
    await new Promise((resolve) => {
      setTimeout(resolve, DISCOVERY_STABILIZE_MS);
    });

    log("[port-discovery] Scanning for listening ports...");

    let ports: number[] = [];
    try {
      // Get all child PIDs recursively
      const allPids = this.getProcessTree(pid);
      log(`[port-discovery] Process tree PIDs: ${allPids.join(", ")}`);

      if (allPids.length > 0) {
        ports = this.getListeningPorts(allPids);
        log(`[port-discovery] Discovered ports: ${ports.join(", ") || "(none)"}`);
      }
    } catch (err) {
      log(
        `[port-discovery] Error scanning ports: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Kill the discovery process tree
    log("[port-discovery] Cleaning up discovery process...");
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may have already exited
      }
    }

    // Wait a moment for cleanup
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });

    // Force kill if still alive
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already dead
    }

    if (ports.length > 0) {
      this.config.ports.discovered = ports;
      this.persistDiscoveredPorts(ports);

      // Auto-detect env var mappings after port discovery
      const envMapping = this.detectEnvMapping(workingDir);
      if (Object.keys(envMapping).length > 0) {
        this.persistEnvMapping(envMapping);
        log(`[port-discovery] Detected env var mappings: ${Object.keys(envMapping).join(", ")}`);
      }
    }

    return { ports };
  }

  private getProcessTree(rootPid: number): number[] {
    const pids: Set<number> = new Set([rootPid]);
    const queue = [rootPid];

    while (queue.length > 0) {
      const parentPid = queue.shift()!;
      try {
        const output = execFileSync("pgrep", ["-P", String(parentPid)], {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();

        if (output) {
          for (const line of output.split("\n")) {
            const childPid = parseInt(line.trim(), 10);
            if (!isNaN(childPid) && !pids.has(childPid)) {
              pids.add(childPid);
              queue.push(childPid);
            }
          }
        }
      } catch {
        // pgrep returns non-zero if no children found
      }
    }

    return Array.from(pids);
  }

  private getListeningPorts(pids: number[]): number[] {
    try {
      const pidList = pids.join(",");
      const output = execFileSync(
        "lsof",
        ["-P", "-n", "-iTCP", "-sTCP:LISTEN", "-a", "-p", pidList],
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );

      const ports: Set<number> = new Set();
      for (const line of output.split("\n")) {
        // Match lines like: node    12345 user   23u  IPv4 ... TCP *:3000 (LISTEN)
        const match = line.match(/:(\d+)\s+\(LISTEN\)/);
        if (match) {
          const port = parseInt(match[1], 10);
          if (!isNaN(port)) {
            ports.add(port);
          }
        }
      }

      return Array.from(ports).sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  private persistDiscoveredPorts(ports: number[]): void {
    if (!this.configFilePath) return;

    try {
      const content = readFileSync(this.configFilePath, "utf-8");
      const config = JSON.parse(content);
      if (!config.ports) {
        config.ports = {};
      }
      config.ports.discovered = ports;
      writeFileSync(this.configFilePath, JSON.stringify(config, null, 2) + "\n");
      console.log(`[port-discovery] Saved discovered ports to ${this.configFilePath}`);
    } catch (err) {
      console.error(
        "[port-discovery] Failed to persist discovered ports:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
