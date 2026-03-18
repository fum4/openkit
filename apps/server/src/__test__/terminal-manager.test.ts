import { existsSync } from "fs";

import { TerminalManager } from "../terminal-manager";

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
}));

const mockPtyProcess = {
  // Use the current process PID so isSessionProcessAlive's process.kill(pid, 0) check succeeds.
  pid: process.pid,
  onData: vi.fn(() => ({ dispose: vi.fn() })),
  onExit: vi.fn(() => ({ dispose: vi.fn() })),
  resize: vi.fn(),
  write: vi.fn(),
  kill: vi.fn(),
};

vi.mock("module", () => ({
  createRequire: () => (mod: string) => {
    if (mod === "node-pty") {
      return { spawn: vi.fn(() => ({ ...mockPtyProcess })) };
    }
    throw new Error(`Unexpected require: ${mod}`);
  },
}));

const mockSerializeAddon = { serialize: vi.fn(() => "serialized-state") };

vi.mock("@xterm/headless", () => ({
  Terminal: vi.fn(function (this: Record<string, unknown>) {
    return Object.assign(this, {
      loadAddon: vi.fn(),
      write: vi.fn((_data: string, cb?: () => void) => cb?.()),
      resize: vi.fn(),
      dispose: vi.fn(),
    });
  }),
}));

vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: vi.fn(function (this: Record<string, unknown>) {
    return Object.assign(this, mockSerializeAddon);
  }),
}));

const mockedExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockedExistsSync.mockReturnValue(true);
});

// ─── Tests ──────────────────────────────────────────────────────

describe("TerminalManager scoped session reuse", () => {
  it("reuses healthy scoped shell session when no startup command is provided", () => {
    const manager = new TerminalManager();

    const first = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");

    expect(first.reusedScopedSession).toBe(false);

    const second = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");

    expect(second.reusedScopedSession).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("reuses healthy scoped agent session when no startup command is provided", () => {
    const manager = new TerminalManager();

    const first = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, "claude --resume", "claude");

    expect(first.reusedScopedSession).toBe(false);

    // Passive reconnect (no startup command) should reuse the running agent session
    const second = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");

    expect(second.reusedScopedSession).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("reuses healthy scoped agent session when another startup command is provided", () => {
    const manager = new TerminalManager();

    const first = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, "claude --resume", "claude");

    // Another startup command should still reuse the existing agent session
    const second = manager.createSession(
      "wt-1",
      "/tmp/wt-1",
      80,
      24,
      "claude --continue",
      "claude",
    );

    expect(second.reusedScopedSession).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("does not reuse sessions across different worktrees", () => {
    const manager = new TerminalManager();

    const first = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");
    const second = manager.createSession("wt-2", "/tmp/wt-2", 80, 24, null, "claude");

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.reusedScopedSession).toBe(false);
  });

  it("does not reuse sessions across different scopes", () => {
    const manager = new TerminalManager();

    const first = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");
    const second = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "codex");

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.reusedScopedSession).toBe(false);
  });

  it("replaces scoped shell session when startup command is provided", () => {
    const manager = new TerminalManager();

    const first = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");

    const second = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, "claude --resume", "claude");

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.reusedScopedSession).toBe(false);
    expect(second.replacedScopedShellSession).toBe(true);
  });

  it("does not reuse destroyed sessions", () => {
    const manager = new TerminalManager();

    const first = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");

    manager.destroySession(first.sessionId);

    const second = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.reusedScopedSession).toBe(false);
  });
});

describe("TerminalManager session lifecycle", () => {
  it("tracks sessions by scope", () => {
    const manager = new TerminalManager();

    const result = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");

    expect(manager.getSessionIdForScope("wt-1", "claude")).toBe(result.sessionId);
    expect(manager.getSessionIdForScope("wt-1", "terminal")).toBeNull();
  });

  it("clears scope index on destroy", () => {
    const manager = new TerminalManager();

    const result = manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");

    manager.destroySession(result.sessionId);

    expect(manager.getSessionIdForScope("wt-1", "claude")).toBeNull();
  });

  it("destroys all sessions for a worktree", () => {
    const manager = new TerminalManager();

    manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "claude");
    manager.createSession("wt-1", "/tmp/wt-1", 80, 24, null, "terminal");
    manager.createSession("wt-2", "/tmp/wt-2", 80, 24, null, "claude");

    const removed = manager.destroyAllForWorktree("wt-1");

    expect(removed).toBe(2);
    expect(manager.getSessionIdForScope("wt-1", "claude")).toBeNull();
    expect(manager.getSessionIdForScope("wt-1", "terminal")).toBeNull();
    expect(manager.getSessionIdForScope("wt-2", "claude")).not.toBeNull();
  });

  it("throws when worktree path does not exist", () => {
    mockedExistsSync.mockReturnValue(false);

    const manager = new TerminalManager();

    expect(() => manager.createSession("wt-1", "/nonexistent", 80, 24)).toThrow(
      "Worktree path does not exist",
    );
  });
});
