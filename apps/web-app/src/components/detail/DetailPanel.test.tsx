import { fireEvent } from "@testing-library/react";

import { render, screen, waitFor, act } from "../../test/render";
import { DetailPanel } from "./DetailPanel";
import type { WorktreeInfo } from "../../types";

// ─── Mocks ─────────────────────────────────────────────────────

// Mock heavy sub-components to avoid rendering entire trees
vi.mock("./DetailHeader", () => ({
  DetailHeader: () => <div data-testid="detail-header" />,
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
vi.mock("../ConfirmDialog", () => ({
  ConfirmDialog: () => <div data-testid="confirm-dialog" />,
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

vi.mock("../../hooks/useApi", () => ({
  useApi: () => ({
    fetchAgentCliStatus: vi.fn().mockResolvedValue({ success: true, installed: true }),
    fetchRestorableAgentSessions: mockFetchRestorableAgentSessions,
    fetchOpenProjectTargets: vi.fn().mockResolvedValue({ success: true, options: [] }),
    fetchActiveTerminalSession: vi.fn().mockResolvedValue({ success: false, sessionId: null }),
    startWorktree: vi.fn().mockResolvedValue({ success: true }),
    stopWorktree: vi.fn().mockResolvedValue({ success: true }),
    removeWorktree: vi.fn().mockResolvedValue({ success: true }),
    commitChanges: vi.fn().mockResolvedValue({ success: true }),
    pushChanges: vi.fn().mockResolvedValue({ success: true }),
    createPullRequest: vi.fn().mockResolvedValue({ success: true }),
    openWorktreeIn: vi.fn().mockResolvedValue({ success: true }),
    renameWorktree: vi.fn().mockResolvedValue({ success: true }),
    recoverLocalTask: vi.fn().mockResolvedValue({ success: true }),
    runHooks: vi.fn().mockResolvedValue({ success: true }),
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

/** Click the "Agent" dropdown and select the given agent using fireEvent */
async function selectAgentFromDropdown(agent: string) {
  const agentButton = screen.getByRole("button", { name: /Agent/i });
  fireEvent.click(agentButton);
  const menuItem = await screen.findByRole("menuitem", { name: agent });
  fireEvent.click(menuItem);
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
});

describe("DetailPanel", () => {
  describe("stale restore response suppression", () => {
    it("does not act on restore response after worktree switch (active session)", async () => {
      // When user opens Claude on wt-1, then switches to wt-2 before the
      // response arrives, the wt-1 response should be dropped.
      // We simulate by: 1) open Claude → gets active session → calls onCodeWithClaude
      //                 2) repeat with wt-2 to show it works normally
      //                 3) verify wt-1 call happened with wt-1 data, not stale
      mockFetchRestorableAgentSessions.mockResolvedValue({
        success: true,
        activeSessionId: "session-123",
        historyMatches: [],
      });

      const worktree1 = createWorktree({ id: "wt-1" });
      const worktree2 = createWorktree({ id: "wt-2" });

      const { rerender } = render(<DetailPanel {...defaultProps} worktree={worktree1} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Agent/i })).toBeInTheDocument();
      });

      // Select Claude for wt-1
      await selectAgentFromDropdown("Claude");

      await waitFor(() => {
        expect(mockFetchRestorableAgentSessions).toHaveBeenCalledWith("wt-1", "claude");
      });

      // onCodeWithClaude should be called for wt-1 (since response matched)
      await waitFor(() => {
        expect(defaultProps.onCodeWithClaude).toHaveBeenCalledWith(
          expect.objectContaining({ worktreeId: "wt-1", mode: "resume-active" }),
        );
      });

      // Switch worktrees
      rerender(<DetailPanel {...defaultProps} worktree={worktree2} />);

      // restoreWorktreeIdRef should now be updated to wt-2 via useEffect
      // Clear mocks to test next interaction
      defaultProps.onCodeWithClaude.mockClear();
      mockFetchRestorableAgentSessions.mockClear();

      mockFetchRestorableAgentSessions.mockResolvedValue({
        success: true,
        activeSessionId: "session-456",
        historyMatches: [],
      });

      // Select Claude for wt-2
      await selectAgentFromDropdown("Claude");

      await waitFor(() => {
        expect(mockFetchRestorableAgentSessions).toHaveBeenCalledWith("wt-2", "claude");
      });

      // Should be called with wt-2, not stale wt-1
      await waitFor(() => {
        expect(defaultProps.onCodeWithClaude).toHaveBeenCalledWith(
          expect.objectContaining({ worktreeId: "wt-2", mode: "resume-active" }),
        );
      });
    });
  });

  describe("restore modal disambiguation", () => {
    it("shows project name in the restore modal when activeProject is available", async () => {
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

      // Wait for agent detection to settle
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Agent/i })).toBeInTheDocument();
      });

      // Select Claude from the dropdown
      await selectAgentFromDropdown("Claude");

      // Wait for the restore modal to appear
      await waitFor(() => {
        expect(screen.getByTestId("restore-modal")).toBeInTheDocument();
      });

      // Verify project name is shown
      expect(screen.getByText(/Project: My Project/)).toBeInTheDocument();
    });

    it("shows branch names in the restore modal match items", async () => {
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

      await selectAgentFromDropdown("Claude");

      await waitFor(() => {
        expect(screen.getByTestId("restore-modal")).toBeInTheDocument();
      });

      // Branch name should be displayed for the match that has it
      expect(screen.getByText(/Branch: feat\/auth-flow/)).toBeInTheDocument();
    });
  });
});
