/**
 * Tests for CustomTaskDetailPanel — focused on the delete confirmation flow,
 * including the "also delete linked worktree" checkbox.
 */
import { render, screen, userEvent, waitFor } from "../../../__test__/render";
import { CustomTaskDetailPanel } from "../CustomTaskDetailPanel";
import type { CustomTaskDetail } from "../../../types";
import { useCustomTaskDetail } from "../../../hooks/useCustomTaskDetail";
import { useApi } from "../../../hooks/useApi";
import { reportPersistentErrorToast } from "../../../errorToasts";

vi.mock("../../../hooks/useCustomTaskDetail", () => ({
  useCustomTaskDetail: vi.fn(),
}));
vi.mock("../../../hooks/useApi", () => ({
  useApi: vi.fn(),
}));
vi.mock("../../../contexts/ServerContext", () => ({
  useServerUrlOptional: () => null,
}));
vi.mock("../../../errorToasts", () => ({
  reportPersistentErrorToast: vi.fn(),
  showPersistentErrorToast: vi.fn(),
}));
vi.mock("../../../logger", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../NotesSection", () => ({
  PersonalNotesSection: () => null,
  AgentSection: () => null,
}));
vi.mock("../../MarkdownContent", () => ({ MarkdownContent: () => null }));
vi.mock("../../AttachmentThumbnail", () => ({ AttachmentThumbnail: () => null }));
vi.mock("../../ImageModal", () => ({ ImageModal: () => null }));
vi.mock("../../EditableTextareaCard", () => ({ EditableTextareaCard: () => null }));
vi.mock("../CodeAgentSplitButton", () => ({ CodeAgentSplitButton: () => null }));
vi.mock("../WorktreeExistsModal", () => ({ WorktreeExistsModal: () => null }));

const mockedUseCustomTaskDetail = vi.mocked(useCustomTaskDetail);
const mockedUseApi = vi.mocked(useApi);

function makeTask(overrides: Partial<CustomTaskDetail> = {}): CustomTaskDetail {
  return {
    id: "task-1",
    title: "My task",
    status: "todo",
    priority: "medium",
    labels: [],
    linkedWorktreeId: null,
    description: "",
    attachments: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const mockDeleteCustomTask = vi.fn();
const mockRemoveWorktree = vi.fn();
const mockRefetch = vi.fn();

const defaultProps = {
  taskId: "task-1",
  activeWorktreeIds: new Set<string>(),
  onDeleted: vi.fn(),
  onCreateWorktree: vi.fn(),
  onViewWorktree: vi.fn(),
  onCodeWithClaude: vi.fn(),
  onCodeWithCodex: vi.fn(),
  onCodeWithGemini: vi.fn(),
  onCodeWithOpenCode: vi.fn(),
  selectedCodingAgent: null as never,
  onSelectCodingAgent: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteCustomTask.mockResolvedValue({ success: true });
  mockRemoveWorktree.mockResolvedValue({ success: true });

  mockedUseCustomTaskDetail.mockReturnValue({
    task: makeTask(),
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mockRefetch,
  });

  mockedUseApi.mockReturnValue({
    deleteCustomTask: mockDeleteCustomTask,
    removeWorktree: mockRemoveWorktree,
  } as never);
});

describe("CustomTaskDetailPanel — delete confirmation", () => {
  it("shows delete confirmation dialog when delete button is clicked", async () => {
    const user = userEvent.setup();
    render(<CustomTaskDetailPanel {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));

    expect(screen.getByText("Delete task?")).toBeInTheDocument();
    expect(screen.getByText(/This will permanently delete/)).toBeInTheDocument();
  });

  it("does not show linked worktree checkbox when task has no linked worktree", async () => {
    const user = userEvent.setup();
    render(<CustomTaskDetailPanel {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows linked worktree checkbox when task has a linked worktree", async () => {
    mockedUseCustomTaskDetail.mockReturnValue({
      task: makeTask({ linkedWorktreeId: "feature-branch" }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mockRefetch,
    });

    const user = userEvent.setup();
    render(<CustomTaskDetailPanel {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));

    expect(
      screen.getByText(/Also delete the linked worktree "feature-branch"/),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("only deletes the task when checkbox is unchecked", async () => {
    mockedUseCustomTaskDetail.mockReturnValue({
      task: makeTask({ linkedWorktreeId: "feature-branch" }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mockRefetch,
    });

    const user = userEvent.setup();
    render(<CustomTaskDetailPanel {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockDeleteCustomTask).toHaveBeenCalledWith("task-1");
    });
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
  });

  it("deletes both task and linked worktree when checkbox is checked", async () => {
    mockedUseCustomTaskDetail.mockReturnValue({
      task: makeTask({ linkedWorktreeId: "feature-branch" }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mockRefetch,
    });

    const user = userEvent.setup();
    render(<CustomTaskDetailPanel {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockDeleteCustomTask).toHaveBeenCalledWith("task-1");
      expect(mockRemoveWorktree).toHaveBeenCalledWith("feature-branch");
    });
  });

  it("resets checkbox to unchecked when dialog is reopened", async () => {
    mockedUseCustomTaskDetail.mockReturnValue({
      task: makeTask({ linkedWorktreeId: "feature-branch" }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mockRefetch,
    });

    const user = userEvent.setup();
    render(<CustomTaskDetailPanel {...defaultProps} />);

    // Open, check the box, cancel
    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Reopen — checkbox should be reset
    await user.click(screen.getByRole("button", { name: "Delete task" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("calls onDeleted after successful deletion", async () => {
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(<CustomTaskDetailPanel {...defaultProps} onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it("cancels deletion and hides dialog when Cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<CustomTaskDetailPanel {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockDeleteCustomTask).not.toHaveBeenCalled();
    expect(screen.queryByText("Delete task?")).not.toBeInTheDocument();
  });

  it("shows error toast and does not call onDeleted when deleteCustomTask fails", async () => {
    mockDeleteCustomTask.mockResolvedValue({ success: false, error: "Server error" });
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(<CustomTaskDetailPanel {...defaultProps} onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(vi.mocked(reportPersistentErrorToast)).toHaveBeenCalledWith(
        "Server error",
        "Failed to delete task",
        expect.any(Object),
      );
    });
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("still calls onDeleted when task is deleted but linked worktree removal fails", async () => {
    mockRemoveWorktree.mockResolvedValue({ success: false, error: "Worktree locked" });
    mockedUseCustomTaskDetail.mockReturnValue({
      task: makeTask({ linkedWorktreeId: "feature-branch" }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mockRefetch,
    });

    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(<CustomTaskDetailPanel {...defaultProps} onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(vi.mocked(reportPersistentErrorToast)).toHaveBeenCalledWith(
        "Worktree locked",
        "Failed to delete linked worktree",
        expect.any(Object),
      );
      // Task was deleted, so the panel should close
      expect(onDeleted).toHaveBeenCalled();
    });
  });
});
