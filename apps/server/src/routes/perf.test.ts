import { Hono } from "hono";

import type { PerfMonitor } from "../perf-monitor";
import type { PerfSnapshot } from "@openkit/shared/perf-types";
import { registerPerfRoutes } from "./perf";

// ─── Helpers ────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<PerfSnapshot> = {}): PerfSnapshot {
  return {
    timestamp: new Date().toISOString(),
    server: { pid: 1234, cpu: 2.5, memory: 50_000_000, elapsed: 120_000, timestamp: Date.now() },
    system: { totalCpu: 10, totalMemory: 200_000_000, processCount: 3 },
    worktrees: [],
    ...overrides,
  };
}

function createMockPerfMonitor(history: PerfSnapshot[] = []): PerfMonitor {
  const subscribers = new Set<(s: PerfSnapshot) => void>();
  return {
    getHistory: vi.fn(() => history),
    getLatest: vi.fn(() => (history.length > 0 ? history[history.length - 1] : null)),
    subscribe: vi.fn((cb: (s: PerfSnapshot) => void) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    }),
  } as unknown as PerfMonitor;
}

// ─── Tests ──────────────────────────────────────────────────────

describe("perf routes", () => {
  it("GET /api/perf returns history", async () => {
    const app = new Hono();
    const snapshot = makeSnapshot();
    const monitor = createMockPerfMonitor([snapshot]);
    registerPerfRoutes(app, monitor);

    const res = await app.request("/api/perf");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.snapshots).toHaveLength(1);
    expect(data.snapshots[0].server.pid).toBe(1234);
  });

  it("GET /api/perf/current returns latest snapshot", async () => {
    const app = new Hono();
    const snapshot = makeSnapshot();
    const monitor = createMockPerfMonitor([snapshot]);
    registerPerfRoutes(app, monitor);

    const res = await app.request("/api/perf/current");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.snapshot).not.toBeNull();
    expect(data.snapshot.server.pid).toBe(1234);
  });

  it("GET /api/perf/current returns null when no snapshots", async () => {
    const app = new Hono();
    const monitor = createMockPerfMonitor([]);
    registerPerfRoutes(app, monitor);

    const res = await app.request("/api/perf/current");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.snapshot).toBeNull();
  });

  it("GET /api/perf/stream returns SSE content type", async () => {
    const app = new Hono();
    const monitor = createMockPerfMonitor([makeSnapshot()]);
    registerPerfRoutes(app, monitor);

    const res = await app.request("/api/perf/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("GET /api/perf/stream sends history on connect", async () => {
    const app = new Hono();
    const snapshot = makeSnapshot();
    const monitor = createMockPerfMonitor([snapshot]);
    registerPerfRoutes(app, monitor);

    const res = await app.request("/api/perf/stream");
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    // Hono test env may return string or Uint8Array depending on runtime
    const text = typeof value === "string" ? value : new TextDecoder().decode(value);

    expect(text).toContain("perf-history");
    expect(text).toContain(String(snapshot.server.pid));
    reader.cancel();
  });
});
