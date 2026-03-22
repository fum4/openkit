import { render, screen, waitFor, userEvent } from "../../__test__/render";
import { DetailPanel } from "./DetailPanel";
import type { WorktreeInfo } from "../../types";

// ─── Mocks ─────────────────────────────────────────────────────

// Mock heavy sub-components to avoid rendering entire trees
vi.mock("./DetailHeader", () => ({
  DetailHeader: ({ onRemove }: { onRemove?: () => void }) => (
    <div data-testid="detail-header">
      {onRemove && (
        <button type="button" onClick={onRemove}>
          Remove worktree
        </button>
      )}
    </div>
  ),
}));
vi.mock("./LogsViewer", () => ({
  LogsViewer: () => <div data-testid="logs-viewer" />,
}));
vi.mock("./TerminalView", () => ({
  TerminalView: () => <div data-testid="terminal-view" />,
}));
vi.mock("./HooksTab", () => ({
  HooksTab: () => <div data-testid="hooks-tab" />,
}));
vi.mock("./DiffViewerTab", () => ({
  DiffViewerTab: () => <div data-testid="diff-viewer-tab" />,
}));
vi.mock("../ConfirmDialog", () => ({
  ConfirmDialog: ({
    children,
    onConfirm,
    onCancel,
    isLoading,
  }: {
    children: React.ReactNode;
    onConfirm: () => void;
    onCancel: () => void;
    isLoading?: boolean;
  }) => (
    <div data-testid="confirm-dialog">
      {children}
      <button type="button" onClick={onConfirm} disabled={isLoading}>
        Confirm
      </button>
      <button type="button" onClick={onCancel} disabled={isLoading}>
        Cancel
      </button>
    </div>
  ),
}));
vi.mock("../Modal", () => ({
  Modal: ({
    title,
    children,
    footer,
  }: {
    title: string;
    children: React.ReactNode;
    footer: React.ReactNode;
    onClose: () => void;
  }) => (
    <div data-testid="restore-modal">
      <div data-testid="modal-title">{title}</div>
      <div data-testid="modal-body">{children}</div>
      <div data-testid="modal-footer">{footer}</div>
    </div>
  ),
}));

vi.mock("../../hooks/useErrorToast", () => ({
  useErrorToast: vi.fn(),
}));
vi.mock("../../hooks/useTerminal", () => ({
  clearTerminalSessionCacheForRuntimeWorktree: vi.fn(),
}));

vi.mock("../../logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Override the global ServerContext mock from setup.ts
// to provide activeProject with a name for disambiguation tests.
let mockActiveProject: Record<string, unknown> | null = null;
vi.mock("../../contexts/ServerContext", () => ({
  useServer: () => ({
    serverUrl: null,
    projects: [],
    activeProject: mockActiveProject,
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

// Controllable mock for fetchRestorableAgentSessions
const mockFetchRestorableAgentSessions = vi.fn();
const mockRemoveWorktree = vi.fn();
const mockDeleteCustomTask = vi.fn();

vi.mock("../../hooks/useApi", () => ({
  useApi: () => ({
    fetchAgentCliStatus: vi.fn().mockResolvedValue({ success: true, installed: true }),
    fetchRestorableAgentSessions: mockFetchRestorableAgentSessions,
    fetchOpenProjectTargets: vi.fn().mockResolvedValue({ success: true, options: [] }),
    fetchActiveTerminalSession: vi.fn().mockResolvedValue({ success: false, sessionId: null }),
    startWorktree: vi.fn().mockResolvedValue({ success: true }),
    stopWorktree: vi.fn().mockResolvedValue({ success: true }),
    removeWorktree: mockRemoveWorktree,
    commitChanges: vi.fn().mockResolvedValue({ success: true }),
    pushChanges: vi.fn().mockResolvedValue({ success: true }),
    createPullRequest: vi.fn().mockResolvedValue({ success: true }),
    openWorktreeIn: vi.fn().mockResolvedValue({ success: true }),
    renameWorktree: vi.fn().mockResolvedValue({ success: true }),
    recoverLocalTask: vi.fn().mockResolvedValue({ success: true }),
    runHooks: vi.fn().mockResolvedValue({ success: true }),
    deleteCustomTask: mockDeleteCustomTask,
  }),
}));

// ─── Helpers ────────────────────────────────────────────────────

function createWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id: "wt-1",
    path: "/test/worktrees/wt-1",
    branch: "feat/test-branch",
    status: "running",
    ports: [3000],
    offset: 1,
    pid: 12345,
    ...overrides,
  };
}

const defaultProps = {
  onUpdate: vi.fn(),
  onDeleted: vi.fn(),
  onCodeWithClaude: vi.fn(),
  onCodeWithCodex: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function selectAgentFromDropdown(user: ReturnType<typeof userEvent.setup>, agent: string) {
  const agentButton = screen.getByRole("button", { name: /Agent/i });
  await user.click(agentButton);
  const menuItem = await screen.findByRole("menuitem", { name: agent });
  await user.click(menuItem);
}

// ─── Tests ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockActiveProject = null;
  mockFetchRestorableAgentSessions.mockResolvedValue({
    success: true,
    activeSessionId: null,
    historyMatches: [],
  });
  mockRemoveWorktree.mockResolvedValue({ success: true, worktreeId: "wt-1" });
  mockDeleteCustomTask.mockResolvedValue({ success: true });
});

describe("DetailPanel", () => {
  describe("stale restore response suppression", () => {
    it("ignores stale restore response when worktree changes mid-request", async () => {
      const user = userEvent.setup();

      // First request stays pending so the worktree switch happens mid-flight
      const firstRequest = deferred<{
        success: boolean;
        activeSessionId: string | null;
        historyMatches: never[];
      }>();
      const secondRequest = deferred<{
        success: boolean;
        activeSessionId: string | null;
        historyMatches: never[];
      }>();

      mockFetchRestorableAgentSessions.mockReturnValueOnce(firstRequest.promise);

      const worktree1 = createWorktree({ id: "wt-1" });
      const worktree2 = createWorktree({ id: "wt-2" });

      const { rerender } = render(<DetailPanel {...defaultProps} worktree={worktree1} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Agent/i })).toBeInTheDocument();
      });

      // Select Claude for wt-1 — request stays pending
      await selectAgentFromDropdown(user, "Claude");

      await waitFor(() => {
        expect(mockFetchRestorableAgentSessions).toHaveBeenCalledWith("wt-1", "claude");
      });

      // Switch worktrees BEFORE the first response arrives
      mockFetchRestorableAgentSessions.mockReturnValueOnce(secondRequest.promise);
      rerender(<DetailPanel {...defaultProps} worktree={worktree2} />);

      // Clear mocks to track the second interaction
      defaultProps.onCodeWithClaude.mockClear();

      // Select Claude for wt-2
      await selectAgentFromDropdown(user, "Claude");

      await waitFor(() => {
        expect(mockFetchRestorableAgentSessions).toHaveBeenCalledWith("wt-2", "claude");
      });

      // Now resolve the stale wt-1 response
      firstRequest.resolve({
        success: true,
        activeSessionId: "session-stale",
        historyMatches: [],
      });

      // Resolve the wt-2 response
      secondRequest.resolve({
        success: true,
        activeSessionId: "session-current",
        historyMatches: [],
      });

      // onCodeWithClaude should be called with wt-2, the stale wt-1 response is ignored
      await waitFor(() => {
        expect(defaultProps.onCodeWithClaude).toHaveBeenCalledWith(
          expect.objectContaining({ worktreeId: "wt-2", mode: "resume-active" }),
        );
      });

      // Should NOT have been called with the stale wt-1 session
      expect(defaultProps.onCodeWithClaude).not.toHaveBeenCalledWith(
        expect.objectContaining({ worktreeId: "wt-1" }),
      );
    });
  });

  describe("worktree delete — linked task", () => {
    it("does not show linked task checkbox when worktree has no localIssueId", async () => {
      const user = userEvent.setup();
      const worktree = createWorktree();
      render(<DetailPanel {...defaultProps} worktree={worktree} />);

      await user.click(screen.getByRole("button", { name: "Remove worktree" }));

      expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("shows linked task checkbox when worktree has a localIssueId", async () => {
      const user = userEvent.setup();
      const worktree = createWorktree({ localIssueId: "task-42" });
      render(<DetailPanel {...defaultProps} worktree={worktree} />);

      await user.click(screen.getByRole("button", { name: "Remove worktree" }));

      expect(screen.getByText(/Also delete the linked task "task-42"/)).toBeInTheDocument();
      expect(screen.getByRole("checkbox")).not.toBeChecked();
    });

    it("only removes the worktree when checkbox is unchecked", async () => {
      const user = userEvent.setup();
      const worktree = createWorktree({ localIssueId: "task-42" });
      render(<DetailPanel {...defaultProps} worktree={worktree} />);

      await user.click(screen.getByRole("button", { name: "Remove worktree" }));
      await user.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(mockRemoveWorktree).toHaveBeenCalledWith("wt-1");
      });
      expect(mockDeleteCustomTask).not.toHaveBeenCalled();
    });

    it("removes both worktree and linked task when checkbox is checked", async () => {
      const user = userEvent.setup();
      const worktree = createWorktree({ localIssueId: "task-42" });
      render(<DetailPanel {...defaultProps} worktree={worktree} />);

      await user.click(screen.getByRole("button", { name: "Remove worktree" }));
      await user.click(screen.getByRole("checkbox"));
      await user.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(mockRemoveWorktree).toHaveBeenCalledWith("wt-1");
        expect(mockDeleteCustomTask).toHaveBeenCalledWith("task-42");
      });
    });

    it("resets checkbox to unchecked when dialog is reopened", async () => {
      const user = userEvent.setup();
      const worktree = createWorktree({ localIssueId: "task-42" });
      render(<DetailPanel {...defaultProps} worktree={worktree} />);

      // Open, check, cancel
      await user.click(screen.getByRole("button", { name: "Remove worktree" }));
      await user.click(screen.getByRole("checkbox"));
      expect(screen.getByRole("checkbox")).toBeChecked();
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      // Reopen — checkbox should be reset
      await user.click(screen.getByRole("button", { name: "Remove worktree" }));
      expect(screen.getByRole("checkbox")).not.toBeChecked();
    });

    it("still completes worktree deletion flow when linked task deletion throws", async () => {
      mockDeleteCustomTask.mockRejectedValue(new Error("Network error"));
      const onDeleted = vi.fn();
      const user = userEvent.setup();
      const worktree = createWorktree({ localIssueId: "task-42" });
      render(<DetailPanel {...defaultProps} worktree={worktree} onDeleted={onDeleted} />);

      await user.click(screen.getByRole("button", { name: "Remove worktree" }));
      await user.click(screen.getByRole("checkbox"));
      await user.click(screen.getByRole("button", { name: "Confirm" }));

      // Worktree was removed; UI should close and notify despite the task deletion error
      await waitFor(() => {
        expect(mockRemoveWorktree).toHaveBeenCalledWith("wt-1");
        expect(onDeleted).toHaveBeenCalled();
      });
    });
  });

  describe("restore modal disambiguation", () => {
    it("shows project name in the restore modal when activeProject is available", async () => {
      const user = userEvent.setup();
      mockActiveProject = {
        id: "proj-1",
        projectDir: "/test",
        port: 6970,
        name: "My Project",
        status: "running",
      };

      // Return multiple history matches to trigger the modal
      mockFetchRestorableAgentSessions.mockResolvedValue({
        success: true,
        activeSessionId: null,
        historyMatches: [
          {
            sessionId: "session-1",
            title: "First conversation",
            updatedAt: "2026-03-17T10:00:00Z",
            gitBranch: "feat/branch-a",
          },
          {
            sessionId: "session-2",
            title: "Second conversation",
            updatedAt: "2026-03-17T09:00:00Z",
            gitBranch: "feat/branch-b",
          },
        ],
      });

      const worktree = createWorktree();

      render(<DetailPanel {...defaultProps} worktree={worktree} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Agent/i })).toBeInTheDocument();
      });

      await selectAgentFromDropdown(user, "Claude");

      await waitFor(() => {
        expect(screen.getByTestId("restore-modal")).toBeInTheDocument();
      });

      // Verify project name and CTA text are shown
      expect(screen.getByText(/Choose which one to resume/)).toBeInTheDocument();
      expect(screen.getByText(/Project: My Project/)).toBeInTheDocument();
    });

    it("shows branch names in the restore modal match items", async () => {
      const user = userEvent.setup();
      mockFetchRestorableAgentSessions.mockResolvedValue({
        success: true,
        activeSessionId: null,
        historyMatches: [
          {
            sessionId: "session-1",
            title: "First conversation",
            updatedAt: "2026-03-17T10:00:00Z",
            gitBranch: "feat/auth-flow",
          },
          {
            sessionId: "session-2",
            title: "Second conversation",
            updatedAt: "2026-03-17T09:00:00Z",
          },
        ],
      });

      const worktree = createWorktree();

      render(<DetailPanel {...defaultProps} worktree={worktree} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Agent/i })).toBeInTheDocument();
      });

      await selectAgentFromDropdown(user, "Claude");

      await waitFor(() => {
        expect(screen.getByTestId("restore-modal")).toBeInTheDocument();
      });

      // Branch name should be displayed for the match that has it
      expect(screen.getByText(/Branch: feat\/auth-flow/)).toBeInTheDocument();
    });
  });
});
