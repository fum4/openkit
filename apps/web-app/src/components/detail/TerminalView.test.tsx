import { render, screen, act, waitFor } from "../../test/render";
import { TerminalView } from "./TerminalView";

// ─── Mocks ──────────────────────────────────────────────────────

let mockUseTerminal: {
  error: string | null;
  isConnected: boolean;
  connectionSource: string | null;
  sessionId: string | null;
  sendData: ReturnType<typeof vi.fn>;
  sendResize: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

let capturedOnData: ((data: string) => void) | undefined;
let capturedOnRestore: ((payload: string) => void) | undefined;
let capturedOnExit: ((exitCode: number) => void) | undefined;

vi.mock("../../hooks/useTerminal", () => ({
  useTerminal: (opts: {
    onData?: (data: string) => void;
    onRestore?: (payload: string) => void;
    onExit?: (exitCode: number) => void;
  }) => {
    capturedOnData = opts.onData;
    capturedOnRestore = opts.onRestore;
    capturedOnExit = opts.onExit;
    return mockUseTerminal;
  },
}));

// Mock xterm — TerminalView creates a Terminal instance and calls .open(), .write(), etc.
const mockTerminalInstance = {
  open: vi.fn(),
  write: vi.fn(),
  reset: vi.fn(),
  dispose: vi.fn(),
  onData: vi.fn(() => ({ dispose: vi.fn() })),
  loadAddon: vi.fn(),
  focus: vi.fn(),
  cols: 80,
  rows: 24,
};
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function (this: Record<string, unknown>) {
    return Object.assign(this, mockTerminalInstance);
  }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function (this: Record<string, unknown>) {
    return Object.assign(this, { fit: vi.fn(), dispose: vi.fn() });
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn(function (this: Record<string, unknown>) {
    return Object.assign(this, { dispose: vi.fn() });
  }),
}));

function resetMocks() {
  capturedOnData = undefined;
  capturedOnRestore = undefined;
  capturedOnExit = undefined;
  mockUseTerminal = {
    error: null,
    isConnected: false,
    connectionSource: null,
    sessionId: null,
    sendData: vi.fn(),
    sendResize: vi.fn(),
    connect: vi.fn().mockResolvedValue({ success: true, source: "new", sessionId: "term-1" }),
    disconnect: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  mockTerminalInstance.open.mockClear();
  mockTerminalInstance.write.mockClear();
  mockTerminalInstance.reset.mockClear();
  mockTerminalInstance.dispose.mockClear();
  mockTerminalInstance.onData.mockClear();
  mockTerminalInstance.onData.mockReturnValue({ dispose: vi.fn() });
  mockTerminalInstance.loadAddon.mockClear();
  mockTerminalInstance.focus.mockClear();
}

beforeEach(resetMocks);

// ─── Helpers ────────────────────────────────────────────────────

function queryBootingOverlay() {
  // The booting overlay contains the agent icon with class "claude-rotating"
  return document.querySelector(".claude-rotating");
}

function queryReconnectingOverlay() {
  return screen.queryByText("Reconnecting terminal...");
}

// ─── Tests ──────────────────────────────────────────────────────

describe("TerminalView booting overlay", () => {
  it("shows booting overlay until first PTY data arrives for fresh agent session", async () => {
    const launchRequest = { mode: "start" as const, requestId: 1 };

    const { rerender } = render(
      <TerminalView
        worktreeId="wt-1"
        visible={true}
        variant="claude"
        launchRequest={launchRequest}
      />,
    );

    // Simulate connection established
    mockUseTerminal.isConnected = true;
    rerender(
      <TerminalView
        worktreeId="wt-1"
        visible={true}
        variant="claude"
        launchRequest={launchRequest}
      />,
    );

    // Booting overlay should still be visible (no output yet)
    await waitFor(() => {
      expect(queryBootingOverlay()).toBeInTheDocument();
    });

    // Simulate first data arriving
    act(() => {
      capturedOnData?.("Claude is ready");
    });

    // Booting overlay should be gone
    await waitFor(() => {
      expect(queryBootingOverlay()).not.toBeInTheDocument();
    });
  });

  it("clears booting overlay immediately when restore payload has content", async () => {
    const launchRequest = { mode: "resume-active" as const, requestId: 2 };

    render(
      <TerminalView
        worktreeId="wt-1"
        visible={true}
        variant="claude"
        launchRequest={launchRequest}
      />,
    );

    // Simulate restore with content
    act(() => {
      capturedOnRestore?.("Previous Claude session content");
    });

    await waitFor(() => {
      expect(queryBootingOverlay()).not.toBeInTheDocument();
    });
  });

  it("keeps booting overlay when restore payload is empty", async () => {
    const launchRequest = { mode: "start" as const, requestId: 3 };

    const { rerender } = render(
      <TerminalView
        worktreeId="wt-1"
        visible={true}
        variant="claude"
        launchRequest={launchRequest}
      />,
    );

    // Simulate connection
    mockUseTerminal.isConnected = true;
    rerender(
      <TerminalView
        worktreeId="wt-1"
        visible={true}
        variant="claude"
        launchRequest={launchRequest}
      />,
    );

    // Simulate empty restore
    act(() => {
      capturedOnRestore?.("");
    });

    // Booting overlay should persist
    await waitFor(() => {
      expect(queryBootingOverlay()).toBeInTheDocument();
    });
  });

  it("clears booting overlay on session exit", async () => {
    const launchRequest = { mode: "start" as const, requestId: 4 };
    const onAgentExit = vi.fn();

    const { rerender } = render(
      <TerminalView
        worktreeId="wt-1"
        visible={true}
        variant="claude"
        launchRequest={launchRequest}
        onAgentExit={onAgentExit}
      />,
    );

    mockUseTerminal.isConnected = true;
    rerender(
      <TerminalView
        worktreeId="wt-1"
        visible={true}
        variant="claude"
        launchRequest={launchRequest}
        onAgentExit={onAgentExit}
      />,
    );

    // Verify booting overlay is shown
    await waitFor(() => {
      expect(queryBootingOverlay()).toBeInTheDocument();
    });

    // Simulate exit
    act(() => {
      capturedOnExit?.(0);
    });

    await waitFor(() => {
      expect(queryBootingOverlay()).not.toBeInTheDocument();
    });
  });

  it("does not show booting overlay for terminal variant", () => {
    render(<TerminalView worktreeId="wt-1" visible={true} variant="terminal" />);

    expect(queryBootingOverlay()).not.toBeInTheDocument();
  });

  it("shows booting overlay during passive reconnect for agent variant until content arrives", async () => {
    // Mount agent variant without a launch request (passive reconnect from scope cache)
    const { rerender } = render(<TerminalView worktreeId="wt-1" visible={true} variant="claude" />);

    // The mount effect should set booting for agent variant passive reconnect
    mockUseTerminal.isConnected = true;
    rerender(<TerminalView worktreeId="wt-1" visible={true} variant="claude" />);

    await waitFor(() => {
      expect(queryBootingOverlay()).toBeInTheDocument();
    });

    // Simulate restore with content
    act(() => {
      capturedOnRestore?.("Restored content");
    });

    await waitFor(() => {
      expect(queryBootingOverlay()).not.toBeInTheDocument();
    });
  });
});

describe("TerminalView stale worktree handling", () => {
  it("silently closes agent tab when passive reconnect fails with error", async () => {
    const onAgentExit = vi.fn();

    // Mount with error from failed passive reconnect (no launch request)
    mockUseTerminal.error = 'Worktree "old-wt" not found';
    render(
      <TerminalView
        worktreeId="old-wt"
        visible={true}
        variant="claude"
        onAgentExit={onAgentExit}
      />,
    );

    await waitFor(() => {
      expect(onAgentExit).toHaveBeenCalled();
    });
  });

  it("shows error for explicit launch failures", () => {
    const onAgentExit = vi.fn();
    const launchRequest = { mode: "start" as const, requestId: 10 };

    mockUseTerminal.error = "Failed to create terminal session";
    render(
      <TerminalView
        worktreeId="wt-1"
        visible={true}
        variant="claude"
        launchRequest={launchRequest}
        onAgentExit={onAgentExit}
      />,
    );

    // Should show the error, not silently close
    expect(screen.getByText(/Terminal error/)).toBeInTheDocument();
    expect(onAgentExit).not.toHaveBeenCalled();
  });

  it("does not call onAgentExit for terminal variant errors", () => {
    const onAgentExit = vi.fn();

    mockUseTerminal.error = "Some error";
    render(
      <TerminalView
        worktreeId="wt-1"
        visible={true}
        variant="terminal"
        onAgentExit={onAgentExit}
      />,
    );

    expect(onAgentExit).not.toHaveBeenCalled();
  });
});
