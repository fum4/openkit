import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  HardDrive,
  MemoryStick,
  Server,
  Layers,
  X as XIcon,
  AlertTriangle,
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";

import type {
  PerfSnapshot,
  WorktreeMetrics,
  ProcessMetrics,
  AgentSessionMetrics,
} from "@openkit/shared/perf-types";
import { usePerformanceMetrics } from "../hooks/usePerformanceMetrics";
import { useServerUrlOptional } from "../contexts/ServerContext";
import { killProcesses } from "../hooks/api";
import { reportPersistentErrorToast } from "../errorToasts";
import { log } from "../logger";
import { palette, settings, text } from "../theme";
import { InfoBanner } from "./InfoBanner";
import { Modal } from "./Modal";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

type Severity = 0 | 1 | 2; // 0=green, 1=orange, 2=red

function cpuSeverity(cpu: number): Severity {
  if (cpu < 50) return 0;
  if (cpu < 80) return 1;
  return 2;
}

function memorySeverity(bytes: number): Severity {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb < 1) return 0;
  if (gb < 2) return 1;
  return 2;
}

const SEVERITY_COLORS = [palette.green, palette.orange, palette.red] as const;

function cpuColor(cpu: number): string {
  return SEVERITY_COLORS[cpuSeverity(cpu)];
}

function memoryColor(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb < 1) return palette.green;
  if (gb < 2) return palette.orange;
  return palette.red;
}

function CpuBar({ value, width = "w-20" }: { value: number; width?: string }) {
  const pct = Math.min(value, 100);
  const color = cpuColor(value);
  return (
    <div className={`${width} h-1.5 rounded-full bg-white/[0.06] overflow-hidden`}>
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </div>
  );
}

function MemoryBar({
  bytes,
  maxBytes,
  width = "w-20",
}: {
  bytes: number;
  maxBytes?: number;
  width?: string;
}) {
  const ceiling = maxBytes ?? 4 * 1024 * 1024 * 1024;
  const pct = Math.min((bytes / ceiling) * 100, 100);
  const color = memoryColor(bytes);
  return (
    <div className={`${width} h-1.5 rounded-full bg-white/[0.06] overflow-hidden`}>
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </div>
  );
}

function ProcessRow({
  label,
  metrics,
  muted = false,
}: {
  label: string;
  metrics: ProcessMetrics;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 py-1.5 px-3 rounded ${muted ? "text-[#6b7280]" : "text-[#9ca3af]"}`}
    >
      <span className="font-mono text-[11px] w-16 text-[#4b5563] tabular-nums">{metrics.pid}</span>
      <span className="text-xs flex-1 truncate">{label}</span>
      <div className="flex items-center gap-1.5">
        <CpuBar value={metrics.cpu} width="w-16" />
        <span
          className="font-mono text-[11px] w-12 text-right tabular-nums"
          style={{ color: cpuColor(metrics.cpu) }}
        >
          {metrics.cpu.toFixed(1)}%
        </span>
      </div>
      <div className="w-px h-4 bg-white/[0.06] mx-1" />
      <div className="flex items-center gap-1.5">
        <MemoryBar bytes={metrics.memory} width="w-16" />
        <span
          className="font-mono text-[11px] w-14 text-right tabular-nums"
          style={{ color: memoryColor(metrics.memory) }}
        >
          {formatBytes(metrics.memory)}
        </span>
      </div>
    </div>
  );
}

function AgentRow({ session }: { session: AgentSessionMetrics }) {
  if (!session.metrics) return null;
  const scopeLabel = session.scope.charAt(0).toUpperCase() + session.scope.slice(1);
  return <ProcessRow label={scopeLabel} metrics={session.metrics} />;
}

function WorktreeCard({
  worktree,
  onStop,
}: {
  worktree: WorktreeMetrics;
  onStop: (worktree: WorktreeMetrics) => void;
}) {
  const isRunning = worktree.devServer !== null || worktree.agentSessions.length > 0;
  const [expanded, setExpanded] = useState(isRunning);
  const [showKillModal, setShowKillModal] = useState(false);
  const highCpu = worktree.totalCpu > 80;
  const highMem = worktree.totalMemory > 2 * 1024 * 1024 * 1024;
  const hasDisk = worktree.diskUsage != null && worktree.diskUsage > 0;

  return (
    <>
      {/* Kill confirmation modal — rendered outside the card to avoid stacking context issues */}
      {showKillModal && (
        <Modal
          title="Terminate Worktree"
          icon={<XIcon className="w-4 h-4 text-red-400" />}
          width="sm"
          onClose={() => setShowKillModal(false)}
          footer={
            <>
              <button
                onClick={() => setShowKillModal(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${text.secondary} hover:bg-white/[0.04] transition-colors`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onStop(worktree);
                  setShowKillModal(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Terminate
              </button>
            </>
          }
        >
          <p className={`text-xs ${text.secondary} leading-relaxed`}>
            This will stop the dev server and all child processes for{" "}
            <span className="text-white font-medium">{worktree.worktreeId}</span>. Any unsaved state
            in running processes will be lost.
          </p>
        </Modal>
      )}
      <motion.div
        layout
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className={`rounded-xl border backdrop-blur-sm ${highCpu || highMem ? "border-red-500/30 bg-red-950/[0.08]" : `border-white/[0.06] ${settings.card}`}`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          {isRunning ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity"
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#4b5563] flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#4b5563] flex-shrink-0" />
              )}
              <span className="text-xs font-medium text-[#9ca3af] truncate">
                {worktree.worktreeId}
                <span className="text-[#4b5563] ml-1.5">{worktree.branch}</span>
              </span>
              {(highCpu || highMem) && (
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              )}
            </button>
          ) : (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-xs font-medium text-[#6b7280] truncate">
                {worktree.worktreeId}
                <span className="text-[#4b5563] ml-1.5">{worktree.branch}</span>
              </span>
            </div>
          )}
          <span className="flex items-center gap-5 text-[11px] font-mono tabular-nums flex-shrink-0">
            {isRunning && (
              <>
                <span
                  className="flex items-center gap-1.5"
                  style={{ color: cpuColor(worktree.totalCpu) }}
                >
                  <Cpu className="w-3 h-3 text-[#4b5563]" />
                  {worktree.totalCpu.toFixed(1)}%
                </span>
                <span
                  className="flex items-center gap-1.5"
                  style={{ color: memoryColor(worktree.totalMemory) }}
                >
                  <MemoryStick className="w-3 h-3 text-[#4b5563]" />
                  {formatBytes(worktree.totalMemory)}
                </span>
              </>
            )}
            {hasDisk && (
              <span className="flex items-center gap-1.5 text-[#6b7280]">
                <HardDrive className="w-3 h-3 text-[#4b5563]" />
                {formatBytes(worktree.diskUsage!)}
              </span>
            )}
          </span>
          {isRunning && (
            <button
              onClick={() => setShowKillModal(true)}
              className="p-1 rounded hover:bg-red-500/10 text-[#4b5563] hover:text-red-400 transition-colors flex-shrink-0"
              title="Terminate worktree"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Process tree — only for running worktrees */}
        {isRunning && (
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="border-t border-white/[0.04] px-1 py-1">
                  {/* Column headers */}
                  <div className="flex items-center gap-3 py-1 px-3 text-[10px] uppercase tracking-wider text-[#4b5563]">
                    <span className="w-16">PID</span>
                    <span className="flex-1">Process</span>
                    <span className="w-[7.5rem] text-right">CPU</span>
                    <span className="w-px mx-1" />
                    <span className="w-[8rem] text-right">Memory</span>
                  </div>

                  {worktree.devServer && (
                    <ProcessRow label="Dev server" metrics={worktree.devServer} />
                  )}
                  {worktree.childProcesses.map((child) => (
                    <ProcessRow key={child.pid} label="Child process" metrics={child} muted />
                  ))}
                  {worktree.agentSessions.map((session) => (
                    <AgentRow key={session.sessionId} session={session} />
                  ))}

                  {/* Totals line */}
                  <div className="flex items-center gap-3 px-3 py-1.5 mt-0.5 border-t border-white/[0.04]">
                    <span className="w-16" />
                    <span className="flex-1 text-[10px] uppercase tracking-wider text-[#4b5563]">
                      Total
                    </span>
                    <div className="flex items-center gap-1.5">
                      <CpuBar value={worktree.totalCpu} width="w-16" />
                      <span
                        className="font-mono text-[11px] w-12 text-right tabular-nums font-medium"
                        style={{ color: cpuColor(worktree.totalCpu) }}
                      >
                        {worktree.totalCpu.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-px h-4 bg-white/[0.06] mx-1" />
                    <div className="flex items-center gap-1.5">
                      <MemoryBar bytes={worktree.totalMemory} width="w-16" />
                      <span
                        className="font-mono text-[11px] w-14 text-right tabular-nums font-medium"
                        style={{ color: memoryColor(worktree.totalMemory) }}
                      >
                        {formatBytes(worktree.totalMemory)}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>
    </>
  );
}

function SystemSummaryCard({ snapshot }: { snapshot: PerfSnapshot }) {
  const cpuPct = Math.min(snapshot.system.totalCpu, 100);
  const memGb = snapshot.system.totalMemory / (1024 * 1024 * 1024);
  const sysMem = snapshot.system.systemMemory ?? 4 * 1024 * 1024 * 1024;
  const totalDisk = snapshot.worktrees.reduce((sum, w) => sum + (w.diskUsage ?? 0), 0);

  return (
    <div
      className={`rounded-xl border border-white/[0.06] ${settings.card} backdrop-blur-sm px-5 py-4`}
    >
      <div className="flex items-center gap-6">
        {/* CPU gauge */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#4b5563]">
              <Cpu className="w-3 h-3" />
              CPU
            </span>
            <span
              className="font-mono text-sm tabular-nums font-medium"
              style={{ color: cpuColor(snapshot.system.totalCpu) }}
            >
              {cpuPct.toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: cpuColor(snapshot.system.totalCpu) }}
              animate={{ width: `${cpuPct}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        </div>

        <div className="w-px h-10 bg-white/[0.06]" />

        {/* Memory gauge */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#4b5563]">
              <MemoryStick className="w-3 h-3" />
              Memory
            </span>
            <span
              className="font-mono text-sm tabular-nums font-medium"
              style={{ color: memoryColor(snapshot.system.totalMemory) }}
            >
              {memGb < 1 ? formatBytes(snapshot.system.totalMemory) : `${memGb.toFixed(1)} GB`}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: memoryColor(snapshot.system.totalMemory) }}
              animate={{ width: `${Math.min((snapshot.system.totalMemory / sysMem) * 100, 100)}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        </div>

        <div className="w-px h-10 bg-white/[0.06]" />

        {totalDisk > 0 && (
          <>
            {/* Disk usage */}
            <div className="text-center px-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#4b5563] mb-1.5 justify-center">
                <HardDrive className="w-3 h-3" />
                Disk
              </div>
              <div className="font-mono text-sm tabular-nums text-[#9ca3af]">
                {formatBytes(totalDisk)}
              </div>
            </div>

            <div className="w-px h-10 bg-white/[0.06]" />
          </>
        )}

        {/* Process count */}
        <div className="text-center px-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#4b5563] mb-1.5 justify-center">
            <Layers className="w-3 h-3" />
            Processes
          </div>
          <div className="font-mono text-sm tabular-nums text-[#9ca3af]">
            {snapshot.system.processCount}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div
        className={`w-12 h-12 rounded-xl ${settings.card} flex items-center justify-center mb-4`}
      >
        <Cpu className="w-6 h-6 text-[#4b5563]" />
      </div>
      <p className="text-sm text-[#6b7280] mb-1">No active processes</p>
      <p className="text-xs text-[#4b5563]">Start a worktree to see performance metrics</p>
    </div>
  );
}

function ScanlineOverlay() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 opacity-[0.015]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.03) 1px, rgba(255,255,255,0.03) 2px)",
        backgroundSize: "100% 2px",
      }}
    />
  );
}

const SEVERITY_BANNER_COLORS = ["green", "amber", "rose"] as const;
const SEVERITY_ICON_COLORS = ["text-emerald-400", "text-amber-400", "text-red-400"] as const;

export function PerformancePage() {
  const serverUrl = useServerUrlOptional();
  const { latest, error } = usePerformanceMetrics();

  const severity: Severity = useMemo(() => {
    if (!latest) return 0;
    return Math.max(
      cpuSeverity(latest.system.totalCpu),
      memorySeverity(latest.system.totalMemory),
    ) as Severity;
  }, [latest]);

  const handleStop = useCallback(
    async (worktree: WorktreeMetrics) => {
      const pids: number[] = [];
      if (worktree.devServer) pids.push(worktree.devServer.pid);
      for (const child of worktree.childProcesses) pids.push(child.pid);
      for (const session of worktree.agentSessions) {
        if (session.metrics) pids.push(session.metrics.pid);
      }

      if (pids.length === 0) return;

      log.info(`Killing ${pids.length} processes for worktree "${worktree.worktreeId}"`, {
        domain: "perf",
        pids,
      });

      const result = await killProcesses(pids, serverUrl);
      if (!result.success) {
        log.error(`Failed to kill processes for worktree "${worktree.worktreeId}"`, {
          domain: "perf",
          error: result.error,
        });
        reportPersistentErrorToast(
          new Error(result.error ?? "Unknown error"),
          `Failed to terminate worktree "${worktree.worktreeId}"`,
          { scope: "perf" },
        );
      }
    },
    [serverUrl],
  );

  const sortedWorktrees = useMemo(() => {
    if (!latest) return [];
    return [...latest.worktrees].sort((a, b) => {
      const aRunning = a.devServer !== null || a.agentSessions.length > 0 ? 1 : 0;
      const bRunning = b.devServer !== null || b.agentSessions.length > 0 ? 1 : 0;
      if (aRunning !== bRunning) return bRunning - aRunning;
      if (aRunning) return b.totalCpu - a.totalCpu;
      return (b.diskUsage ?? 0) - (a.diskUsage ?? 0);
    });
  }, [latest]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-8">
        <ScanlineOverlay />

        {/* Header + banner */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center">
              <Cpu
                className={`w-4 h-4 ${latest ? SEVERITY_ICON_COLORS[severity] : "text-[#4b5563]"}`}
              />
            </div>
            <h1 className="text-base font-medium text-[#f0f2f5]">Performance</h1>
          </div>

          <InfoBanner
            storageKey="OpenKit:perfBannerDismissed"
            color={latest ? SEVERITY_BANNER_COLORS[severity] : "gray"}
          >
            Real-time resource monitoring for your worktrees, dev servers, and agent sessions. CPU
            and memory values are color-coded — green is healthy, orange is elevated, red is high.
          </InfoBanner>
        </div>

        {/* System summary */}
        {latest && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <SystemSummaryCard snapshot={latest} />
          </motion.div>
        )}

        {/* OpenKit Server row */}
        {latest && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
            className={`rounded-xl border border-white/[0.06] ${settings.card} backdrop-blur-sm`}
          >
            <div className="flex items-center gap-3 px-4 py-2.5">
              <Server className="w-3.5 h-3.5 text-[#6b7280]" />
              <span className="text-xs font-medium text-[#9ca3af]">OpenKit Server</span>
              <span className="ml-auto flex items-center gap-5 text-[11px] font-mono tabular-nums">
                <span className="text-[#4b5563]">PID {latest.server.pid}</span>
                <span
                  className="flex items-center gap-1.5"
                  style={{ color: cpuColor(latest.server.cpu) }}
                >
                  <Cpu className="w-3 h-3 text-[#4b5563]" />
                  {latest.server.cpu.toFixed(1)}%
                </span>
                <span
                  className="flex items-center gap-1.5"
                  style={{ color: memoryColor(latest.server.memory) }}
                >
                  <MemoryStick className="w-3 h-3 text-[#4b5563]" />
                  {formatBytes(latest.server.memory)}
                </span>
              </span>
            </div>
          </motion.div>
        )}

        {/* Loading / error */}
        {!latest && (
          <div className="flex items-center justify-center pt-24">
            {error ? (
              <p className="text-xs text-[#6b7280]">{error}</p>
            ) : (
              <div
                className="w-5 h-5 border-2 border-[#4b5563] border-t-transparent rounded-full animate-spin"
                style={{
                  opacity: 0,
                  animation: "spin 1s linear infinite, fadeIn 0.2s ease 0.5s forwards",
                }}
              />
            )}
          </div>
        )}

        {/* Empty state when no worktree is running */}
        {latest &&
          !sortedWorktrees.some((w) => w.devServer !== null || w.agentSessions.length > 0) && (
            <EmptyState />
          )}

        {/* Worktree cards */}
        {sortedWorktrees.length > 0 && (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {sortedWorktrees.map((wt) => (
                <WorktreeCard key={wt.worktreeId} worktree={wt} onStop={handleStop} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
