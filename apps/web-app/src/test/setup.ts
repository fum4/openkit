// System boundary mocks — MUST be imported first (vi.mock is hoisted)
import "./mocks/child-process";
import "./mocks/integrations";

import "@testing-library/jest-dom/vitest";

// ─── Mock @tanstack/react-virtual ───────────────────────────
// jsdom has no layout engine, so useVirtualizer returns zero-height items.
// This mock renders all items without measurement.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i,
        start: i * opts.estimateSize(),
        size: opts.estimateSize(),
        key: i,
      })),
    getTotalSize: () => opts.count * opts.estimateSize(),
    measureElement: () => {},
  }),
}));

import { setupServer } from "msw/node";

import { createServerBridge, createBridgeHandler, type ServerBridge } from "./server-bridge";

// ─── Server bridge + MSW ─────────────────────────────────────

let bridge: ServerBridge;

export const server = setupServer();

export function getTestBridge(): ServerBridge {
  return bridge;
}

beforeAll(() => {
  bridge = createServerBridge();
  server.use(createBridgeHandler(bridge.app));
  server.listen({ onUnhandledRequest: "bypass" });
});

afterEach(() => {
  server.resetHandlers();
  // Re-add bridge handler since resetHandlers removes it
  server.use(createBridgeHandler(bridge.app));
});

afterAll(() => {
  server.close();
  bridge.cleanup();
});

// ─── Mock EventSource for SSE ────────────────────────────────

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate connection
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    });
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.readyState = 2;
    const idx = MockEventSource.instances.indexOf(this);
    if (idx >= 0) MockEventSource.instances.splice(idx, 1);
  }

  // Test helper: simulate a message
  simulateMessage(data: string, type = "message") {
    const event = new MessageEvent(type, { data });
    if (type === "message") {
      this.onmessage?.(event);
    }
    this.listeners.get(type)?.forEach((fn) => fn(event));
  }

  static reset() {
    for (const instance of MockEventSource.instances) {
      instance.close();
    }
    MockEventSource.instances = [];
  }
}

Object.defineProperty(globalThis, "EventSource", { value: MockEventSource, writable: true });

// ─── Mock ServerContext ──────────────────────────────────────
// Components use useServerUrlOptional() which needs ServerContext.
// Mock the module to return null (relative URL mode — MSW intercepts fetch).

vi.mock("../contexts/ServerContext", () => ({
  useServer: () => ({
    serverUrl: null,
    projects: [],
    activeProject: null,
    openProject: async () => ({ success: true }),
    closeProject: async () => {},
    switchProject: () => {},
    isElectron: false,
    projectsLoading: false,
    selectFolder: async () => null,
  }),
  useServerUrl: () => "",
  useServerUrlOptional: () => null,
  ServerProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ─── Cleanup ─────────────────────────────────────────────────

afterEach(() => {
  MockEventSource.reset();
});
