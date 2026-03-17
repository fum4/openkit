import { renderHook, act, waitFor } from "@testing-library/react";

import { usePerformanceMetrics } from "./usePerformanceMetrics";

// ─── Mocks ──────────────────────────────────────────────────────

let mockServerUrl: string | null = "http://localhost:3000";

vi.mock("../contexts/ServerContext", () => ({
  useServerUrlOptional: () => mockServerUrl,
}));

vi.mock("./api", () => ({
  getPerfStreamUrl: (url: string) => `${url}/api/perf/stream`,
}));

// ─── EventSource stub ──────────────────────────────────────────

interface MockEventSource {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}

let latestEventSource: MockEventSource;

const OriginalEventSource = globalThis.EventSource;

class FakeEventSource implements MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(_url: string) {
    latestEventSource = this as MockEventSource;
  }
}

try {
  delete (globalThis as Record<string, unknown>).EventSource;
} catch {
  // fall through
}
(globalThis as Record<string, unknown>).EventSource = FakeEventSource;

afterAll(() => {
  (globalThis as Record<string, unknown>).EventSource = OriginalEventSource;
});

// ─── Helpers ────────────────────────────────────────────────────

function makeSnapshot(cpu = 10) {
  return {
    timestamp: new Date().toISOString(),
    server: { pid: 1234, cpu, memory: 50_000_000, elapsed: 120_000, timestamp: Date.now() },
    system: { totalCpu: cpu, totalMemory: 200_000_000, processCount: 3 },
    worktrees: [],
  };
}

// ─── Tests ──────────────────────────────────────────────────────

beforeEach(() => {
  mockServerUrl = "http://localhost:3000";
  latestEventSource = undefined as unknown as MockEventSource;
});

describe("usePerformanceMetrics", () => {
  it("starts disconnected", () => {
    const { result } = renderHook(() => usePerformanceMetrics());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.snapshots).toEqual([]);
    expect(result.current.latest).toBeNull();
  });

  it("sets connected when EventSource opens", async () => {
    const { result } = renderHook(() => usePerformanceMetrics());

    act(() => {
      latestEventSource.onopen?.();
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });
  });

  it("initializes snapshots from perf-history event", async () => {
    const { result } = renderHook(() => usePerformanceMetrics());
    const snapshot = makeSnapshot(5);

    act(() => {
      latestEventSource.onopen?.();
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "perf-history", snapshots: [snapshot] }),
      });
    });

    await waitFor(() => {
      expect(result.current.snapshots).toHaveLength(1);
      expect(result.current.latest?.server.cpu).toBe(5);
    });
  });

  it("appends snapshots from perf-snapshot events", async () => {
    const { result } = renderHook(() => usePerformanceMetrics());

    act(() => {
      latestEventSource.onopen?.();
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "perf-history", snapshots: [makeSnapshot(1)] }),
      });
    });

    act(() => {
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "perf-snapshot", snapshot: makeSnapshot(2) }),
      });
    });

    await waitFor(() => {
      expect(result.current.snapshots).toHaveLength(2);
      expect(result.current.latest?.server.cpu).toBe(2);
    });
  });

  it("trims to 150 entries", async () => {
    const { result } = renderHook(() => usePerformanceMetrics());
    const initialSnapshots = Array.from({ length: 149 }, (_, i) => makeSnapshot(i));

    act(() => {
      latestEventSource.onopen?.();
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "perf-history", snapshots: initialSnapshots }),
      });
    });

    // Add 2 more to exceed 150
    act(() => {
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "perf-snapshot", snapshot: makeSnapshot(150) }),
      });
    });
    act(() => {
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "perf-snapshot", snapshot: makeSnapshot(151) }),
      });
    });

    await waitFor(() => {
      expect(result.current.snapshots.length).toBeLessThanOrEqual(150);
    });
  });

  it("resets state when serverUrl becomes null", async () => {
    const { result, rerender } = renderHook(() => usePerformanceMetrics());

    act(() => {
      latestEventSource.onopen?.();
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "perf-history", snapshots: [makeSnapshot()] }),
      });
    });

    await waitFor(() => {
      expect(result.current.snapshots).toHaveLength(1);
    });

    mockServerUrl = null;
    rerender();

    await waitFor(() => {
      expect(result.current.snapshots).toEqual([]);
      expect(result.current.isConnected).toBe(false);
    });
  });

  it("closes EventSource on error", async () => {
    const { result } = renderHook(() => usePerformanceMetrics());

    act(() => {
      latestEventSource.onopen?.();
    });

    const es = latestEventSource;
    act(() => {
      es.onerror?.();
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
    });
    expect(es.close).toHaveBeenCalled();
  });
});
