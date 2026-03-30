import { execFileSync, spawn } from "child_process";
import { existsSync } from "fs";

import { withAugmentedPathEnv } from "@openkit/shared/command-path";

const DISCOVERY_STABILIZE_MS = 15_000;

/**
 * Spawns the dev command and scans for listening ports via lsof.
 * Returns the discovered ports after a stabilization period.
 */
export async function discoverPorts(
  startCommand: string,
  workingDir: string,
  onLog?: (message: string) => void,
): Promise<{ ports: number[]; error?: string }> {
  const emit = onLog || (() => {});

  emit("[port-discovery] Starting dev command to discover ports...");

  const [cmd, ...args] = startCommand.split(" ");

  if (!existsSync(workingDir)) {
    return {
      ports: [],
      error: `Project directory "${workingDir}" not found`,
    };
  }

  const child = spawn(cmd, args, {
    cwd: workingDir,
    env: { ...withAugmentedPathEnv(), FORCE_COLOR: "0" },
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
    const allPids = getProcessTree(pid);
    emit(`[port-discovery] Process tree PIDs: ${allPids.join(", ")}`);

    if (allPids.length > 0) {
      ports = getListeningPorts(allPids);
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

  return { ports };
}

/**
 * Walks the process tree from a root PID using pgrep -P.
 */
export function getProcessTree(rootPid: number): number[] {
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

/**
 * Scans for listening TCP ports via lsof for a set of PIDs.
 */
export function getListeningPorts(pids: number[]): number[] {
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
