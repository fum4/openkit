import type { WorktreeManager } from "../manager";
import type { TerminalManager } from "../terminal-manager";
import { PerfMonitor } from "../perf-monitor";

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock("pidusage", () => ({
  default: vi.fn(async (pid: number) => ({
    cpu: pid === process.pid ? 2.5 : 15.0,
    memory: pid === process.pid ? 50_000_000 : 200_000_000,
    elapsed: 120_000,
  })),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string) => void) => {
      cb(null, "");
    },
  ),
}));

function createMockManager(): WorktreeManager {
  return {
    getRunningProcessPids: vi.fn(() => new Map()),
    getAllWorktreePaths: vi.fn(() => new Map()),
  } as unknown as WorktreeManager;
}

function createMockTerminalManager(): TerminalManager {
  return {
    getActiveSessionInfo: vi.fn(() => []),
  } as unknown as TerminalManager;
}

// ─── Tests ──────────────────────────────────────────────────────

describe("PerfMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts on first subscriber and stops on last unsubscribe", () => {
    const monitor = new PerfMonitor(createMockManager(), createMockTerminalManager());

    expect(monitor.isRunning()).toBe(false);
    expect(monitor.getSubscriberCount()).toBe(0);

    const unsub1 = monitor.subscribe(vi.fn());
    expect(monitor.isRunning()).toBe(true);
    expect(monitor.getSubscriberCount()).toBe(1);

    const unsub2 = monitor.subscribe(vi.fn());
    expect(monitor.getSubscriberCount()).toBe(2);

    unsub1();
    expect(monitor.isRunning()).toBe(true);
    expect(monitor.getSubscriberCount()).toBe(1);

    unsub2();
    expect(monitor.isRunning()).toBe(false);
    expect(monitor.getSubscriberCount()).toBe(0);
  });

  it("collects snapshots and notifies subscribers", async () => {
    const manager = createMockManager();
    const monitor = new PerfMonitor(manager, createMockTerminalManager());
    const callback = vi.fn();

    monitor.subscribe(callback);

    // The poll() call is async; flush microtasks
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledTimes(1);
    const snapshot = callback.mock.calls[0][0];
    expect(snapshot).toHaveProperty("timestamp");
    expect(snapshot).toHaveProperty("server");
    expect(snapshot.server.pid).toBe(process.pid);
    expect(snapshot).toHaveProperty("system");
    expect(snapshot).toHaveProperty("worktrees");
    expect(snapshot.worktrees).toEqual([]);
  });

  it("ring buffer trims to 150 entries", async () => {
    const monitor = new PerfMonitor(createMockManager(), createMockTerminalManager());
    monitor.subscribe(vi.fn());

    // Each tick produces one snapshot
    for (let i = 0; i < 160; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }

    // 1 from initial poll + 160 from ticks = 161, trimmed to 150
    expect(monitor.getHistory().length).toBeLessThanOrEqual(150);
  });

  it("getLatest returns null when no snapshots exist", () => {
    const monitor = new PerfMonitor(createMockManager(), createMockTerminalManager());
    expect(monitor.getLatest()).toBeNull();
  });

  it("getLatest returns the most recent snapshot after polling", async () => {
    const monitor = new PerfMonitor(createMockManager(), createMockTerminalManager());
    monitor.subscribe(vi.fn());

    await vi.advanceTimersByTimeAsync(0);

    const latest = monitor.getLatest();
    expect(latest).not.toBeNull();
    expect(latest?.server.pid).toBe(process.pid);
  });

  it("includes worktree metrics when running processes exist", async () => {
    const manager = createMockManager();
    (manager.getRunningProcessPids as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([["wt-1", { pid: 12345, branch: "feature-auth", ports: [3000], path: "/tmp/wt-1" }]]),
    );
    (manager.getAllWorktreePaths as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([["wt-1", { path: "/tmp/wt-1", branch: "feature-auth" }]]),
    );

    const monitor = new PerfMonitor(manager, createMockTerminalManager());
    const callback = vi.fn();
    monitor.subscribe(callback);

    await vi.advanceTimersByTimeAsync(0);

    const snapshot = callback.mock.calls[0][0];
    expect(snapshot.worktrees).toHaveLength(1);
    expect(snapshot.worktrees[0].worktreeId).toBe("wt-1");
    expect(snapshot.worktrees[0].branch).toBe("feature-auth");
    expect(snapshot.worktrees[0].devServer).not.toBeNull();
    expect(snapshot.worktrees[0].devServer.pid).toBe(12345);
  });

  it("includes agent session metrics when sessions exist", async () => {
    const manager = createMockManager();
    (manager.getRunningProcessPids as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([["wt-1", { pid: 12345, branch: "main", ports: [], path: "/tmp/wt-1" }]]),
    );
    (manager.getAllWorktreePaths as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([["wt-1", { path: "/tmp/wt-1", branch: "main" }]]),
    );

    const termManager = createMockTerminalManager();
    (termManager.getActiveSessionInfo as ReturnType<typeof vi.fn>).mockReturnValue([
      { sessionId: "term-1", worktreeId: "wt-1", scope: "claude", pid: 54321 },
    ]);

    const monitor = new PerfMonitor(manager, termManager);
    const callback = vi.fn();
    monitor.subscribe(callback);

    await vi.advanceTimersByTimeAsync(0);

    const wt = callback.mock.calls[0][0].worktrees[0];
    expect(wt.agentSessions).toHaveLength(1);
    expect(wt.agentSessions[0].scope).toBe("claude");
    expect(wt.agentSessions[0].metrics).not.toBeNull();
  });

  it("handles dead PIDs gracefully", async () => {
    const pidusage = (await import("pidusage")).default as unknown as ReturnType<typeof vi.fn>;
    pidusage.mockRejectedValueOnce(new Error("No matching pid found"));

    const monitor = new PerfMonitor(createMockManager(), createMockTerminalManager());
    const callback = vi.fn();
    monitor.subscribe(callback);

    await vi.advanceTimersByTimeAsync(0);

    // Should still produce a snapshot with fallback server metrics
    expect(callback).toHaveBeenCalledTimes(1);
    const snapshot = callback.mock.calls[0][0];
    expect(snapshot.server.cpu).toBe(0);
    expect(snapshot.server.memory).toBe(0);
  });
});
