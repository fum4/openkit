import { execFile } from "child_process";
import os from "os";

import pidusage from "pidusage";

import type {
  PerfSnapshot,
  ProcessMetrics,
  WorktreeMetrics,
  AgentSessionMetrics,
} from "@openkit/shared/perf-types";
import { log } from "./logger";
import type { WorktreeManager } from "./manager";
import type { TerminalManager } from "./terminal-manager";

const POLL_INTERVAL_MS = 2000;
const RING_BUFFER_SIZE = 150;
const CHILD_PID_REFRESH_MS = 10_000;
const DISK_USAGE_REFRESH_MS = 30_000;

type Subscriber = (snapshot: PerfSnapshot) => void;

interface ChildPidCache {
  pids: number[];
  refreshedAt: number;
}

interface DiskUsageCache {
  bytes: number;
  refreshedAt: number;
}

export class PerfMonitor {
  private manager: WorktreeManager;
  private terminalManager: TerminalManager;
  private buffer: PerfSnapshot[] = [];
  private subscribers = new Set<Subscriber>();
  private intervalId: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private childPidCache = new Map<number, ChildPidCache>();
  private diskUsageCache = new Map<string, DiskUsageCache>();

  constructor(manager: WorktreeManager, terminalManager: TerminalManager) {
    this.manager = manager;
    this.terminalManager = terminalManager;
  }

  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    if (this.subscribers.size === 1) {
      this.start();
    }
    return () => {
      this.subscribers.delete(cb);
      if (this.subscribers.size === 0) {
        this.stop();
      }
    };
  }

  getHistory(): PerfSnapshot[] {
    return [...this.buffer];
  }

  getLatest(): PerfSnapshot | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1]! : null;
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    log.debug("Performance monitor started", { domain: "metrics" });
    this.schedulePoll();
  }

  private schedulePoll(): void {
    this.poll().finally(() => {
      if (this.subscribers.size > 0) {
        this.intervalId = setTimeout(() => this.schedulePoll(), POLL_INTERVAL_MS);
      }
    });
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    this.childPidCache.clear();
    this.diskUsageCache.clear();
    log.debug("Performance monitor stopped", { domain: "metrics" });
  }

  private async poll(): Promise<void> {
    try {
      const snapshot = await this.collectSnapshot();
      this.buffer.push(snapshot);
      if (this.buffer.length > RING_BUFFER_SIZE) {
        this.buffer.splice(0, this.buffer.length - RING_BUFFER_SIZE);
      }
      for (const cb of this.subscribers) {
        try {
          cb(snapshot);
        } catch (error) {
          log.debug("Performance monitor subscriber error", {
            domain: "metrics",
            error,
          });
        }
      }
    } catch (error) {
      log.debug("Performance monitor poll failed", {
        domain: "metrics",
        error,
      });
    }
  }

  private async collectSnapshot(): Promise<PerfSnapshot> {
    const now = Date.now();

    // Collect server self metrics
    const serverMetrics = await this.getProcessMetrics(process.pid, now);

    // Collect worktree metrics — include ALL worktrees, not just running ones
    const runningPids = this.manager.getRunningProcessPids();
    const allWorktrees = this.manager.getAllWorktreePaths();
    const sessions = this.terminalManager.getActiveSessionInfo();

    const worktreeMetrics: WorktreeMetrics[] = [];
    let systemTotalCpu = serverMetrics?.cpu ?? 0;
    let systemTotalMemory = serverMetrics?.memory ?? 0;
    let systemProcessCount = 1; // server itself

    for (const [worktreeId, wt] of allWorktrees) {
      const running = runningPids.get(worktreeId);

      let devServer: ProcessMetrics | null = null;
      const childMetrics: ProcessMetrics[] = [];
      const agentMetrics: AgentSessionMetrics[] = [];
      let totalCpu = 0;
      let totalMemory = 0;

      if (running) {
        devServer = await this.getProcessMetrics(running.pid, now);

        const childPids = await this.getChildPids(running.pid, now);
        for (const childPid of childPids) {
          const m = await this.getProcessMetrics(childPid, now);
          if (m) childMetrics.push(m);
        }

        const worktreeSessions = sessions.filter(
          (s) =>
            s.worktreeId === worktreeId &&
            s.pid != null &&
            s.scope !== "terminal" &&
            s.scope !== null,
        );
        for (const session of worktreeSessions) {
          const m = session.pid ? await this.getProcessMetrics(session.pid, now) : null;
          agentMetrics.push({
            sessionId: session.sessionId,
            scope: session.scope as AgentSessionMetrics["scope"],
            metrics: m,
          });
        }

        totalCpu = (devServer?.cpu ?? 0) + childMetrics.reduce((s, m) => s + m.cpu, 0);
        totalMemory = (devServer?.memory ?? 0) + childMetrics.reduce((s, m) => s + m.memory, 0);
        for (const a of agentMetrics) {
          totalCpu += a.metrics?.cpu ?? 0;
          totalMemory += a.metrics?.memory ?? 0;
        }

        systemTotalCpu += totalCpu;
        systemTotalMemory += totalMemory;
        const processCount =
          (devServer ? 1 : 0) + childMetrics.length + agentMetrics.filter((a) => a.metrics).length;
        systemProcessCount += processCount;
      }

      const diskUsage = await this.getDiskUsage(worktreeId, wt.path, now);

      worktreeMetrics.push({
        worktreeId,
        branch: wt.branch,
        devServer,
        childProcesses: childMetrics,
        agentSessions: agentMetrics,
        totalCpu,
        totalMemory,
        diskUsage,
      });
    }

    return {
      timestamp: new Date(now).toISOString(),
      server: serverMetrics ?? { pid: process.pid, cpu: 0, memory: 0, elapsed: 0, timestamp: now },
      system: {
        totalCpu: systemTotalCpu,
        totalMemory: systemTotalMemory,
        processCount: systemProcessCount,
        systemMemory: os.totalmem(),
      },
      worktrees: worktreeMetrics,
    };
  }

  private async getProcessMetrics(pid: number, timestamp: number): Promise<ProcessMetrics | null> {
    try {
      const stats = await pidusage(pid);
      return {
        pid,
        cpu: Math.round(stats.cpu * 100) / 100,
        memory: stats.memory,
        elapsed: stats.elapsed,
        timestamp,
      };
    } catch {
      log.debug(`Dead or inaccessible PID ${pid}`, { domain: "metrics" });
      return null;
    }
  }

  private async getChildPids(parentPid: number, now: number): Promise<number[]> {
    const cached = this.childPidCache.get(parentPid);
    if (cached && now - cached.refreshedAt < CHILD_PID_REFRESH_MS) {
      return cached.pids;
    }

    const pids = await this.fetchChildPids(parentPid);
    this.childPidCache.set(parentPid, { pids, refreshedAt: now });
    return pids;
  }

  private fetchChildPids(parentPid: number): Promise<number[]> {
    return new Promise((resolve) => {
      execFile("pgrep", ["-P", String(parentPid)], (error, stdout) => {
        if (error) {
          log.debug(`pgrep failed for PID ${parentPid}`, { domain: "metrics", error });
          resolve([]);
          return;
        }
        if (!stdout.trim()) {
          resolve([]);
          return;
        }
        const pids = stdout
          .trim()
          .split("\n")
          .map((s) => parseInt(s, 10))
          .filter((n) => !isNaN(n));
        resolve(pids);
      });
    });
  }

  private async getDiskUsage(
    worktreeId: string,
    dirPath: string,
    now: number,
  ): Promise<number | null> {
    const cached = this.diskUsageCache.get(worktreeId);
    if (cached && now - cached.refreshedAt < DISK_USAGE_REFRESH_MS) {
      return cached.bytes;
    }

    const bytes = await this.fetchDiskUsage(dirPath);
    if (bytes !== null) {
      this.diskUsageCache.set(worktreeId, { bytes, refreshedAt: now });
    }
    return bytes;
  }

  private fetchDiskUsage(dirPath: string): Promise<number | null> {
    return new Promise((resolve) => {
      execFile("du", ["-sk", dirPath], (error, stdout) => {
        if (error) {
          log.debug(`du failed for path ${dirPath}`, { domain: "metrics", error });
          resolve(null);
          return;
        }
        if (!stdout.trim()) {
          resolve(null);
          return;
        }
        const kb = parseInt(stdout.trim().split(/\s+/)[0]!, 10);
        resolve(isNaN(kb) ? null : kb * 1024);
      });
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }
}
