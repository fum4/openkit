import { render, screen } from "../../__test__/render";
import { PerformancePage } from "../PerformancePage";

// ─── Mocks ──────────────────────────────────────────────────────

const mockUsePerformanceMetrics = vi.fn();

vi.mock("../../hooks/usePerformanceMetrics", () => ({
  usePerformanceMetrics: () => mockUsePerformanceMetrics(),
}));

vi.mock("../../hooks/api", () => ({
  stopWorktree: vi.fn(),
}));

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: new Date().toISOString(),
    server: { pid: 1234, cpu: 2.5, memory: 50_000_000, elapsed: 120_000, timestamp: Date.now() },
    system: { totalCpu: 15, totalMemory: 400_000_000, processCount: 5 },
    worktrees: [],
    ...overrides,
  };
}

function makeWorktree(overrides: Record<string, unknown> = {}) {
  return {
    worktreeId: "wt-1",
    branch: "feature-auth",
    devServer: {
      pid: 5678,
      cpu: 12.5,
      memory: 340_000_000,
      elapsed: 60_000,
      timestamp: Date.now(),
    },
    childProcesses: [],
    agentSessions: [],
    totalCpu: 12.5,
    totalMemory: 340_000_000,
    diskUsage: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PerformancePage", () => {
  it("renders loading spinner when no data yet", () => {
    mockUsePerformanceMetrics.mockReturnValue({
      snapshots: [],
      latest: null,
      isConnected: false,
    });

    render(<PerformancePage />);
    expect(screen.getByText("Performance")).toBeInTheDocument();
  });

  it("renders header when connected", () => {
    mockUsePerformanceMetrics.mockReturnValue({
      snapshots: [makeSnapshot()],
      latest: makeSnapshot(),
      isConnected: true,
    });

    render(<PerformancePage />);
    expect(screen.getByText("Performance")).toBeInTheDocument();
  });

  it("renders system summary with CPU and memory", () => {
    mockUsePerformanceMetrics.mockReturnValue({
      snapshots: [makeSnapshot()],
      latest: makeSnapshot(),
      isConnected: true,
    });

    render(<PerformancePage />);
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.getByText("Processes")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders OpenKit Server row with PID", () => {
    mockUsePerformanceMetrics.mockReturnValue({
      snapshots: [makeSnapshot()],
      latest: makeSnapshot(),
      isConnected: true,
    });

    render(<PerformancePage />);
    expect(screen.getByText("OpenKit Server")).toBeInTheDocument();
    expect(screen.getByText("PID 1234")).toBeInTheDocument();
  });

  it("renders empty state when no worktrees", () => {
    mockUsePerformanceMetrics.mockReturnValue({
      snapshots: [makeSnapshot()],
      latest: makeSnapshot(),
      isConnected: true,
    });

    render(<PerformancePage />);
    expect(screen.getByText("No active processes")).toBeInTheDocument();
  });

  it("renders worktree cards with name and branch", () => {
    const snapshot = makeSnapshot({
      worktrees: [makeWorktree()],
    });

    mockUsePerformanceMetrics.mockReturnValue({
      snapshots: [snapshot],
      latest: snapshot,
      isConnected: true,
    });

    render(<PerformancePage />);
    expect(screen.getByText("wt-1")).toBeInTheDocument();
    expect(screen.getByText("feature-auth")).toBeInTheDocument();
    expect(screen.getByText("Dev server")).toBeInTheDocument();
  });

  it("renders agent sessions in worktree card", () => {
    const snapshot = makeSnapshot({
      worktrees: [
        makeWorktree({
          agentSessions: [
            {
              sessionId: "term-1",
              scope: "claude",
              metrics: {
                pid: 9999,
                cpu: 5,
                memory: 200_000_000,
                elapsed: 30_000,
                timestamp: Date.now(),
              },
            },
          ],
          totalCpu: 17.5,
          totalMemory: 540_000_000,
        }),
      ],
    });

    mockUsePerformanceMetrics.mockReturnValue({
      snapshots: [snapshot],
      latest: snapshot,
      isConnected: true,
    });

    render(<PerformancePage />);
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("renders disk usage when available", () => {
    const snapshot = makeSnapshot({
      worktrees: [makeWorktree({ diskUsage: 512 * 1024 * 1024 })],
    });

    mockUsePerformanceMetrics.mockReturnValue({
      snapshots: [snapshot],
      latest: snapshot,
      isConnected: true,
    });

    render(<PerformancePage />);
    const matches = screen.getAllByText("512 MB");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
