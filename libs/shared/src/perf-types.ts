export interface ProcessMetrics {
  pid: number;
  cpu: number; // percentage (0-100+)
  memory: number; // RSS in bytes
  elapsed: number; // uptime in ms
  timestamp: number;
}

export interface AgentSessionMetrics {
  sessionId: string;
  scope: "claude" | "codex" | "gemini" | "opencode";
  metrics: ProcessMetrics | null;
}

export interface WorktreeMetrics {
  worktreeId: string;
  branch: string;
  devServer: ProcessMetrics | null;
  childProcesses: ProcessMetrics[];
  agentSessions: AgentSessionMetrics[];
  totalCpu: number;
  totalMemory: number;
  diskUsage?: number | null; // bytes on disk
}

export interface PerfSnapshot {
  timestamp: string;
  server: ProcessMetrics;
  system: { totalCpu: number; totalMemory: number; processCount: number };
  worktrees: WorktreeMetrics[];
}
