import { renderHook, act } from "../test/render";
import { useActivityFeed } from "./useActivityFeed";
import type { ActivityEvent } from "./api";

// Override the global mock to return a server URL so the hook registers event listeners.
vi.mock("../contexts/ServerContext", () => ({
  useServer: () => ({
    serverUrl: "http://localhost:6970",
    projects: [],
    activeProject: null,
    openProject: async () => ({ success: true }),
    closeProject: async () => {},
    switchProject: () => {},
    isElectron: false,
    projectsLoading: false,
    selectFolder: async () => null,
  }),
  useServerUrl: () => "http://localhost:6970",
  useServerUrlOptional: () => "http://localhost:6970",
  ServerProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    category: "worktree",
    type: "creation_completed",
    severity: "success",
    title: "Worktree created",
    ...overrides,
  };
}

function dispatchActivity(event: ActivityEvent) {
  window.dispatchEvent(new CustomEvent("OpenKit:activity", { detail: event }));
}

function dispatchActivityHistory(events: ActivityEvent[]) {
  window.dispatchEvent(new CustomEvent("OpenKit:activity-history", { detail: events }));
}

describe("useActivityFeed", () => {
  beforeEach(() => {
    try {
      window.localStorage.removeItem("OpenKit:activityClearedAt:http://localhost:6970");
    } catch {
      // happy-dom may not fully support Storage API
    }
  });

  it("starts with empty events array", () => {
    const { result } = renderHook(() => useActivityFeed());

    expect(result.current.events).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it("adds an event when OpenKit:activity is dispatched", () => {
    const { result } = renderHook(() => useActivityFeed());
    const event = makeEvent({ id: "evt-1", title: "Test event" });

    act(() => {
      dispatchActivity(event);
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].title).toBe("Test event");
    expect(result.current.unreadCount).toBe(1);
  });

  it("increments unread count for each new event", () => {
    const { result } = renderHook(() => useActivityFeed());

    act(() => {
      dispatchActivity(makeEvent({ id: "evt-1" }));
      dispatchActivity(makeEvent({ id: "evt-2" }));
      dispatchActivity(makeEvent({ id: "evt-3" }));
    });

    expect(result.current.events).toHaveLength(3);
    expect(result.current.unreadCount).toBe(3);
  });

  it("handles OpenKit:activity-history with multiple events", () => {
    const { result } = renderHook(() => useActivityFeed());
    const historyEvents = [
      makeEvent({ id: "hist-1", title: "History 1", timestamp: "2025-01-01T10:00:00Z" }),
      makeEvent({ id: "hist-2", title: "History 2", timestamp: "2025-01-01T11:00:00Z" }),
      makeEvent({ id: "hist-3", title: "History 3", timestamp: "2025-01-01T12:00:00Z" }),
    ];

    act(() => {
      dispatchActivityHistory(historyEvents);
    });

    expect(result.current.events).toHaveLength(3);
    // Sorted newest first
    expect(result.current.events[0].title).toBe("History 3");
    expect(result.current.events[2].title).toBe("History 1");
  });

  it("merges history events with existing events", () => {
    const { result } = renderHook(() => useActivityFeed());
    const liveEvent = makeEvent({
      id: "live-1",
      title: "Live event",
      timestamp: "2025-01-01T13:00:00Z",
    });

    act(() => {
      dispatchActivity(liveEvent);
    });

    expect(result.current.events).toHaveLength(1);

    const historyEvents = [
      makeEvent({ id: "hist-1", title: "History 1", timestamp: "2025-01-01T10:00:00Z" }),
    ];

    act(() => {
      dispatchActivityHistory(historyEvents);
    });

    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0].id).toBe("live-1");
    expect(result.current.events[1].id).toBe("hist-1");
  });

  it("clearAll resets events and unread count", () => {
    const { result } = renderHook(() => useActivityFeed());

    act(() => {
      dispatchActivity(makeEvent({ id: "evt-1" }));
      dispatchActivity(makeEvent({ id: "evt-2" }));
    });

    expect(result.current.events).toHaveLength(2);
    expect(result.current.unreadCount).toBe(2);

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.events).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it("markAllRead resets unread count to zero", () => {
    const { result } = renderHook(() => useActivityFeed());

    act(() => {
      dispatchActivity(makeEvent({ id: "evt-1" }));
      dispatchActivity(makeEvent({ id: "evt-2" }));
    });

    expect(result.current.unreadCount).toBe(2);

    act(() => {
      result.current.markAllRead();
    });

    expect(result.current.unreadCount).toBe(0);
    // Events should still be there
    expect(result.current.events).toHaveLength(2);
  });

  it("filters out disabled event types from incoming events", () => {
    const disabled = ["creation_failed"];
    const { result } = renderHook(() => useActivityFeed(undefined, undefined, undefined, disabled));

    act(() => {
      dispatchActivity(makeEvent({ id: "evt-1", type: "creation_completed", title: "Completed" }));
      dispatchActivity(makeEvent({ id: "evt-2", type: "creation_failed", title: "Failed" }));
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].title).toBe("Completed");
  });

  it("filters out disabled event types from history events", () => {
    const disabled = ["creation_failed"];
    const { result } = renderHook(() => useActivityFeed(undefined, undefined, undefined, disabled));

    act(() => {
      dispatchActivityHistory([
        makeEvent({ id: "hist-1", type: "creation_completed", title: "Completed" }),
        makeEvent({ id: "hist-2", type: "creation_failed", title: "Failed" }),
      ]);
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].title).toBe("Completed");
  });

  it("removes existing events when disabledEventTypes changes", () => {
    let disabledTypes: string[] = [];
    const { result, rerender } = renderHook(() =>
      useActivityFeed(undefined, undefined, undefined, disabledTypes),
    );

    act(() => {
      dispatchActivity(makeEvent({ id: "evt-1", type: "creation_completed", title: "Completed" }));
      dispatchActivity(makeEvent({ id: "evt-2", type: "creation_failed", title: "Failed" }));
    });

    expect(result.current.events).toHaveLength(2);

    disabledTypes = ["creation_failed"];
    rerender();

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].title).toBe("Completed");
  });

  it("does not add events that were cleared", () => {
    const { result } = renderHook(() => useActivityFeed());

    act(() => {
      result.current.clearAll();
    });

    // Dispatch an event with a timestamp before the clear
    const pastEvent = makeEvent({
      id: "old-evt",
      title: "Old event",
      timestamp: new Date(Date.now() - 10000).toISOString(),
    });

    act(() => {
      dispatchActivity(pastEvent);
    });

    expect(result.current.events).toEqual([]);
  });

  it("calls onToast for toast-worthy events", () => {
    const onToast = vi.fn();

    renderHook(() => useActivityFeed(onToast));

    act(() => {
      dispatchActivity(
        makeEvent({
          id: "evt-toast",
          type: "creation_completed",
          title: "Worktree ready",
          severity: "success",
        }),
      );
    });

    expect(onToast).toHaveBeenCalledWith("Worktree ready", "success", undefined, undefined);
  });

  it("does not call onToast for non-toast events", () => {
    const onToast = vi.fn();

    renderHook(() => useActivityFeed(onToast));

    act(() => {
      dispatchActivity(
        makeEvent({
          id: "evt-no-toast",
          type: "agent_connected",
          title: "Agent connected",
        }),
      );
    });

    expect(onToast).not.toHaveBeenCalled();
  });

  it("upserts events with the same groupKey instead of duplicating", () => {
    const { result } = renderHook(() => useActivityFeed());

    act(() => {
      dispatchActivity(
        makeEvent({
          id: "evt-1",
          groupKey: "group-1",
          title: "Version 1",
          timestamp: "2025-01-01T10:00:00Z",
        }),
      );
    });

    expect(result.current.events).toHaveLength(1);

    act(() => {
      dispatchActivity(
        makeEvent({
          id: "evt-2",
          groupKey: "group-1",
          title: "Version 2",
          timestamp: "2025-01-01T10:01:00Z",
        }),
      );
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].title).toBe("Version 2");
  });
});
