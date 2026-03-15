import { renderHook, act, waitFor } from "@testing-library/react";

import { useWorktrees } from "./useWorktrees";

// ─── Mocks ──────────────────────────────────────────────────────

let mockServerUrl: string | null = "http://localhost:3000";

vi.mock("../contexts/ServerContext", () => ({
  useServerUrlOptional: () => mockServerUrl,
}));

vi.mock("../errorToasts", () => ({
  reportPersistentErrorToast: vi.fn(),
  showPersistentErrorToast: vi.fn(),
}));

const mockFetchWorktrees = vi.fn();

vi.mock("./api", () => ({
  fetchWorktrees: (...args: unknown[]) => mockFetchWorktrees(...args),
  getEventsUrl: (url: string) => `${url}/api/events`,
  fetchPorts: vi.fn().mockResolvedValue({ discovered: [], offsetStep: 1 }),
  fetchJiraStatus: vi.fn().mockResolvedValue(null),
  fetchGitHubStatus: vi.fn().mockResolvedValue(null),
  fetchLinearStatus: vi.fn().mockResolvedValue(null),
  fetchConfig: vi.fn().mockResolvedValue({}),
}));

// ─── EventSource stub ──────────────────────────────────────────

interface MockEventSource {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
}

let latestEventSource: MockEventSource;
let eventSourceConstructCount = 0;

class FakeEventSource implements MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  readyState = 0;

  constructor(_url: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    latestEventSource = this;
    eventSourceConstructCount++;
  }
}

try {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete (globalThis as Record<string, unknown>).EventSource;
} catch {
  // Some environments don't allow delete; fall through to assignment.
}
(globalThis as Record<string, unknown>).EventSource = FakeEventSource;

// ─── Helpers ───────────────────────────────────────────────────

const worktreeA = { id: "wt-a", name: "worktree-a", branch: "main", path: "/a", status: "running" };
const worktreeB = { id: "wt-b", name: "worktree-b", branch: "dev", path: "/b", status: "running" };

function setServerUrl(url: string | null) {
  mockServerUrl = url;
}

// ─── Tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mockServerUrl = "http://localhost:3000";
  mockFetchWorktrees.mockReset();
  mockFetchWorktrees.mockResolvedValue({ worktrees: [worktreeA] });
  latestEventSource = undefined as unknown as MockEventSource;
  eventSourceConstructCount = 0;
});

describe("useWorktrees", () => {
  it("fetches worktrees on mount", async () => {
    const { result } = renderHook(() => useWorktrees());

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeA]);
    });

    expect(mockFetchWorktrees).toHaveBeenCalledWith("http://localhost:3000");
  });

  it("returns empty worktrees when serverUrl is null", () => {
    setServerUrl(null);
    const { result } = renderHook(() => useWorktrees());

    expect(result.current.worktrees).toEqual([]);
    expect(mockFetchWorktrees).not.toHaveBeenCalled();
  });

  it("discards stale fetch response when serverUrl changes before response arrives", async () => {
    let resolveA!: (value: { worktrees: (typeof worktreeA)[] }) => void;
    let resolveB!: (value: { worktrees: (typeof worktreeB)[] }) => void;

    mockFetchWorktrees
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveB = resolve;
          }),
      );

    const { result, rerender } = renderHook(() => useWorktrees());

    expect(mockFetchWorktrees).toHaveBeenCalledTimes(1);

    // Switch to server B before A's response arrives
    setServerUrl("http://localhost:4000");
    rerender();

    await waitFor(() => {
      expect(mockFetchWorktrees).toHaveBeenCalledTimes(2);
    });

    // A's response arrives late — should be discarded
    await act(async () => {
      resolveA({ worktrees: [worktreeA] });
    });

    expect(result.current.worktrees).toEqual([]);

    // B's response arrives — should be accepted
    await act(async () => {
      resolveB({ worktrees: [worktreeB] });
    });

    expect(result.current.worktrees).toEqual([worktreeB]);
  });

  it("clears retry timeout when serverUrl changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockFetchWorktrees.mockResolvedValue({ worktrees: [worktreeA] });

    const { result, rerender } = renderHook(() => useWorktrees());

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeA]);
    });

    // Simulate SSE error, which schedules a 5s retry
    act(() => {
      latestEventSource.onerror?.();
    });

    expect(latestEventSource.close).toHaveBeenCalled();

    // Switch projects before retry fires
    mockFetchWorktrees.mockResolvedValue({ worktrees: [worktreeB] });
    setServerUrl("http://localhost:4000");
    rerender();

    // Advance past the 5s retry window — stale retry should NOT fire
    const callCountBeforeTimer = mockFetchWorktrees.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    // Only the new server's fetch should have fired, not the stale retry
    const callsAfterTimer = mockFetchWorktrees.mock.calls.slice(callCountBeforeTimer);
    for (const call of callsAfterTimer) {
      expect(call[0]).not.toBe("http://localhost:3000");
    }

    vi.useRealTimers();
  });

  it("stale refetch does not inject old worktrees after serverUrl changes", async () => {
    let resolveRefetch!: (value: { worktrees: (typeof worktreeA)[] }) => void;

    mockFetchWorktrees.mockResolvedValueOnce({ worktrees: [worktreeA] });

    const { result, rerender } = renderHook(() => useWorktrees());

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeA]);
    });

    // Capture refetch (bound to server A's serverUrl)
    const staleRefetch = result.current.refetch;

    // Switch to server B
    mockFetchWorktrees.mockImplementation((url: string) => {
      if (url === "http://localhost:3000") {
        return new Promise((resolve) => {
          resolveRefetch = resolve;
        });
      }
      return Promise.resolve({ worktrees: [worktreeB] });
    });
    setServerUrl("http://localhost:4000");
    rerender();

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeB]);
    });

    // Call stale refetch (bound to old serverUrl) — simulates the SSE retry race
    await act(async () => {
      void staleRefetch();
    });

    // Resolve the stale fetch with old worktrees
    await act(async () => {
      resolveRefetch({ worktrees: [worktreeA] });
    });

    // Worktrees should still be Project B's, not A's
    expect(result.current.worktrees).toEqual([worktreeB]);
  });

  it("returns empty worktrees synchronously when serverUrl changes", async () => {
    mockFetchWorktrees.mockResolvedValue({ worktrees: [worktreeA] });

    const { result, rerender } = renderHook(() => useWorktrees());

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeA]);
    });

    // Switch serverUrl — should immediately return [] via effectiveWorktrees
    setServerUrl("http://localhost:4000");
    rerender();

    expect(result.current.worktrees).toEqual([]);
  });

  it("updates worktrees from SSE message", async () => {
    const { result } = renderHook(() => useWorktrees());

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeA]);
    });

    act(() => {
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "worktrees", worktrees: [worktreeB] }),
      });
    });

    expect(result.current.worktrees).toEqual([worktreeB]);
  });

  it("dispatches custom activity window event on SSE activity message", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const { result } = renderHook(() => useWorktrees());

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeA]);
    });

    const activityEvent = { type: "commit", message: "test commit" };

    act(() => {
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "activity", event: activityEvent }),
      });
    });

    const customEvent = dispatchSpy.mock.calls.find(
      ([evt]) => evt instanceof CustomEvent && evt.type === "OpenKit:activity",
    );
    expect(customEvent).toBeDefined();
    expect((customEvent![0] as CustomEvent).detail).toEqual(activityEvent);

    dispatchSpy.mockRestore();
  });

  it("dispatches custom activity-history window event on SSE activity-history message", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const { result } = renderHook(() => useWorktrees());

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeA]);
    });

    const events = [
      { type: "commit", message: "first" },
      { type: "commit", message: "second" },
    ];

    act(() => {
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "activity-history", events }),
      });
    });

    const customEvent = dispatchSpy.mock.calls.find(
      ([evt]) => evt instanceof CustomEvent && evt.type === "OpenKit:activity-history",
    );
    expect(customEvent).toBeDefined();
    expect((customEvent![0] as CustomEvent).detail).toEqual(events);

    dispatchSpy.mockRestore();
  });

  it("sets isConnected to true on EventSource open", async () => {
    const { result } = renderHook(() => useWorktrees());

    expect(result.current.isConnected).toBe(false);

    act(() => {
      latestEventSource.onopen?.();
    });

    expect(result.current.isConnected).toBe(true);
  });

  it("cleans up EventSource on unmount", async () => {
    const { result, unmount } = renderHook(() => useWorktrees());

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeA]);
    });

    const es = latestEventSource;

    unmount();

    expect(es.close).toHaveBeenCalled();
  });

  it("invokes notification callback on SSE notification message", async () => {
    const onNotification = vi.fn();

    const { result } = renderHook(() => useWorktrees(onNotification));

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeA]);
    });

    act(() => {
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "notification", message: "Build failed", level: "error" }),
      });
    });

    expect(onNotification).toHaveBeenCalledWith("Build failed", "error");
  });

  it("invokes hook-update callback on SSE hook-update message", async () => {
    const onHookUpdate = vi.fn();

    const { result } = renderHook(() => useWorktrees(undefined, onHookUpdate));

    await waitFor(() => {
      expect(result.current.worktrees).toEqual([worktreeA]);
    });

    act(() => {
      latestEventSource.onmessage?.({
        data: JSON.stringify({ type: "hook-update", worktreeId: "wt-123" }),
      });
    });

    expect(onHookUpdate).toHaveBeenCalledWith("wt-123");
  });

  it("does not create EventSource when serverUrl is null", () => {
    setServerUrl(null);
    renderHook(() => useWorktrees());

    expect(eventSourceConstructCount).toBe(0);
  });
});
