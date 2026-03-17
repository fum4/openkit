import { execFileSync, spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { detectFramework, type FrameworkDetection } from "./framework-detect";
import { log } from "./logger";
import type { WorktreeConfig } from "./types";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function resolveProjectRoot(startDir: string): string {
  const bundledRoot = process.env.OPENKIT_BUNDLED_ROOT;
  if (bundledRoot && existsSync(path.join(bundledRoot, "runtime", "port-hook.cjs"))) {
    return bundledRoot;
  }

  const devWorkspaceRoot = path.resolve(startDir, "..", "..", "..");
  return devWorkspaceRoot;
}

const DISCOVERY_STABILIZE_MS = 15_000;

type PortDebugLogger = (event: {
  action: string;
  message: string;
  status?: "info" | "success" | "failed";
  level?: "debug" | "info" | "warning" | "error";
  metadata?: Record<string, unknown>;
}) => void;

export class PortManager {
  private config: WorktreeConfig;

  private usedOffsets: Set<number> = new Set();

  private configFilePath: string | null;

  private debugLogger: PortDebugLogger | null = null;

  useNativeHook = false;

  private frameworkDetection: FrameworkDetection | null = null;

  constructor(config: WorktreeConfig, configFilePath: string | null = null) {
    this.config = config;
    this.configFilePath = configFilePath;
    this.ensureFrameworkDetected();
  }

  private ensureFrameworkDetected(): void {
    if (this.config.framework) return;
    if (!this.configFilePath) return;

    const projectDir = this.getProjectDir();
    const detection = detectFramework(projectDir);

    if (detection.framework === "generic") return;

    this.frameworkDetection = detection;
    this.persistFramework(detection.framework);

    log.info(`Auto-detected ${detection.framework} project, persisted to config`, {
      domain: "framework-detect",
    });
  }

  getFramework(): WorktreeConfig["framework"] {
    return this.frameworkDetection?.framework ?? this.config.framework;
  }

  needsAdbReverse(): boolean {
    return (
      this.frameworkDetection?.needsAdbReverse ??
      (this.config.framework === "react-native" || this.config.framework === "expo")
    );
  }

  setDebugLogger(debugLogger: PortDebugLogger | null): void {
    this.debugLogger = debugLogger;
  }

  private emitDebugEvent(event: {
    action: string;
    message: string;
    status?: "info" | "success" | "failed";
    level?: "debug" | "info" | "warning" | "error";
    metadata?: Record<string, unknown>;
  }): void {
    if (!this.debugLogger) return;
    try {
      this.debugLogger(event);
    } catch {
      // Ignore debug sink failures.
    }
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

  /**
   * For RN/Expo projects, returns additional args to append to the start command
   * so Metro receives the port directly via --port flag.
   * Returns an empty array for non-RN/Expo projects.
   */
  getStartCommandPortArgs(startCommand: string, offset: number): string[] {
    const framework = this.getFramework();
    if (framework !== "react-native" && framework !== "expo") {
      return [];
    }

    // Use first discovered port, or fall back to default Metro port (8081)
    // when discovery hasn't been run yet
    const metroBasePort = this.config.ports.discovered[0] || 8081;

    // Skip if the user already specified --port in their start command
    if (startCommand.includes("--port")) return [];

    const metroOffsetPort = metroBasePort + offset;

    // npm requires "npm start -- --port X" to pass args through to the script
    if (startCommand.startsWith("npm ") && !startCommand.startsWith("npx ")) {
      return ["--", "--port", String(metroOffsetPort)];
    }
    return ["--port", String(metroOffsetPort)];
  }

  getNativeHookPath(): string | null {
    const ext = process.platform === "darwin" ? "dylib" : "so";
    const filename = `libport-hook.${ext}`;

    // Dev: built from libs/port-resolution
    const devHook = path.resolve(
      currentDir,
      "..",
      "..",
      "..",
      "libs",
      "port-resolution",
      "zig-out",
      "lib",
      filename,
    );
    if (existsSync(devHook)) {
      return devHook;
    }

    // Packaged: bundled alongside port-hook.cjs
    const projectRoot = resolveProjectRoot(currentDir);
    const bundledHook = path.resolve(projectRoot, "runtime", filename);
    if (existsSync(bundledHook)) {
      return bundledHook;
    }

    // Built: dist/runtime/
    const distHook = path.resolve(projectRoot, "apps", "server", "dist", "runtime", filename);
    if (existsSync(distHook)) {
      return distHook;
    }

    return null;
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

    return srcHook;
  }

  getEnvForOffset(offset: number): Record<string, string> {
    const framework = this.getFramework();
    const isRnOrExpo = framework === "react-native" || framework === "expo";
    const hasDiscoveredPorts = this.config.ports.discovered.length > 0;

    // For generic projects with no discovered ports, nothing to do
    if (!hasDiscoveredPorts && !isRnOrExpo) {
      return {};
    }

    const env: Record<string, string> = {};

    // Port hook env vars (only when we have discovered ports to offset)
    if (hasDiscoveredPorts) {
      env.__WM_PORT_OFFSET__ = String(offset);
      env.__WM_KNOWN_PORTS__ = JSON.stringify(this.config.ports.discovered);

      // Native hook (runtime-agnostic: Python, Ruby, Go on macOS, etc.)
      const nativeHook = this.useNativeHook ? this.getNativeHookPath() : null;
      if (nativeHook) {
        if (process.platform === "darwin") {
          env.DYLD_INSERT_LIBRARIES = nativeHook;
        } else {
          env.LD_PRELOAD = nativeHook;
        }
      }

      // Node.js hook (keep as safety net for Node-specific patching)
      const hookPath = this.getHookPath();
      const existingNodeOptions = process.env.NODE_OPTIONS || "";
      const requireFlag = `--require ${hookPath}`;
      env.NODE_OPTIONS = existingNodeOptions
        ? `${existingNodeOptions} ${requireFlag}`
        : requireFlag;
    }

    // Resolve env var templates with offset ports
    const envMapping = this.config.envMapping;
    if (envMapping) {
      for (const [key, template] of Object.entries(envMapping)) {
        env[key] = template.replace(/\$\{(\d+)\}/g, (_, portStr) => {
          return String(parseInt(portStr, 10) + offset);
        });
      }
    }

    // Expo CLI detects non-interactive environments (piped stdio → isTTY=false)
    // and disables networking automatically. Override this to keep Metro functional.
    if (framework === "expo") {
      env.CI = "0";
      env.EXPO_OFFLINE = "0";
    }

    // For RN/Expo without discovered ports, provide RCT_METRO_PORT from default
    if (isRnOrExpo && !env.RCT_METRO_PORT) {
      const defaultMetroPort = 8081;
      env.RCT_METRO_PORT = String(defaultMetroPort + offset);
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
      log.debug(`[port-discovery] Saved env mapping to ${this.configFilePath}`);
    } catch (err) {
      this.emitDebugEvent({
        action: "port.discovery.persist-env-mapping",
        message: "Failed to persist env mapping",
        status: "failed",
        level: "error",
        metadata: {
          configFilePath: this.configFilePath,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  async discoverPorts(
    onLog?: (message: string) => void,
  ): Promise<{ ports: number[]; error?: string }> {
    const emit = onLog || ((msg: string) => log.info(msg));

    emit("[port-discovery] Starting dev command to discover ports...");

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

    emit(`[port-discovery] Spawned process (PID: ${pid}), waiting for stabilization...`);

    child.stdout?.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((l: string) => l.trim());
      for (const line of lines) {
        emit(`[port-discovery:stdout] ${line}`);
      }
    });

    child.stderr?.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((l: string) => l.trim());
      for (const line of lines) {
        emit(`[port-discovery:stderr] ${line}`);
      }
    });

    // Wait for processes to stabilize
    await new Promise((resolve) => {
      setTimeout(resolve, DISCOVERY_STABILIZE_MS);
    });

    emit("[port-discovery] Scanning for listening ports...");

    let ports: number[] = [];
    try {
      // Get all child PIDs recursively
      const allPids = this.getProcessTree(pid);
      emit(`[port-discovery] Process tree PIDs: ${allPids.join(", ")}`);

      if (allPids.length > 0) {
        ports = this.getListeningPorts(allPids);
        emit(`[port-discovery] Discovered ports: ${ports.join(", ") || "(none)"}`);
      }
    } catch (err) {
      emit(
        `[port-discovery] Error scanning ports: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Kill the discovery process tree
    emit("[port-discovery] Cleaning up discovery process...");
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

    // Detect project framework and merge defaults (runs even if port scan found nothing,
    // so RN projects get Metro's default port added automatically)
    const detection = detectFramework(workingDir);
    this.frameworkDetection = detection;

    if (detection.framework !== "generic") {
      for (const port of detection.defaultPorts) {
        if (!ports.includes(port)) {
          ports.push(port);
        }
      }
      ports.sort((a, b) => a - b);
      emit(`[port-discovery] Detected ${detection.framework} project, applied framework defaults`);
    }

    if (ports.length > 0) {
      this.config.ports.discovered = ports;
      this.persistDiscoveredPorts(ports);

      // Auto-detect env var mappings after port discovery
      const envMapping = this.detectEnvMapping(workingDir);

      // Merge framework-specific env var templates (don't overwrite user entries)
      if (detection.framework !== "generic") {
        for (const [key, template] of Object.entries(detection.envVarTemplates)) {
          if (!(key in envMapping)) {
            envMapping[key] = template;
          }
        }
      }

      if (Object.keys(envMapping).length > 0) {
        this.persistEnvMapping(envMapping);
        emit(`[port-discovery] Detected env var mappings: ${Object.keys(envMapping).join(", ")}`);
      }
    }

    // Persist framework type to config for subsequent starts
    if (detection.framework !== "generic") {
      this.persistFramework(detection.framework);
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

  private persistFramework(framework: WorktreeConfig["framework"]): void {
    if (!this.configFilePath) return;

    this.config.framework = framework;

    try {
      const content = readFileSync(this.configFilePath, "utf-8");
      const config = JSON.parse(content);
      config.framework = framework;
      writeFileSync(this.configFilePath, JSON.stringify(config, null, 2) + "\n");
    } catch (err) {
      log.warn(
        `Failed to persist framework to config: ${err instanceof Error ? err.message : String(err)}`,
        { domain: "framework-detect" },
      );
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
      log.debug(`[port-discovery] Saved discovered ports to ${this.configFilePath}`);
    } catch (err) {
      this.emitDebugEvent({
        action: "port.discovery.persist-discovered-ports",
        message: "Failed to persist discovered ports",
        status: "failed",
        level: "error",
        metadata: {
          configFilePath: this.configFilePath,
          ports,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}
