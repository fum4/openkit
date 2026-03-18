import { render, screen, userEvent } from "../../__test__/render";
import type { WorktreeInfo } from "../../types";
import { WorktreeList } from "../WorktreeList";

function createWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id: "wt-1",
    path: "/work/.worktrees/wt-1",
    branch: "feature-branch",
    status: "stopped",
    ports: [],
    offset: null,
    pid: null,
    ...overrides,
  };
}

describe("WorktreeList", () => {
  const defaultProps = {
    worktrees: [] as WorktreeInfo[],
    selectedId: null,
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onSelect.mockClear();
  });

  it("shows empty state when no worktrees exist", () => {
    render(<WorktreeList {...defaultProps} />);

    expect(screen.getByText("No worktrees yet")).toBeInTheDocument();
    expect(screen.getByText("Create one to get started")).toBeInTheDocument();
  });

  it("renders worktree items with their ids", () => {
    const worktrees = [
      createWorktree({ id: "auth-feature", branch: "feat/auth" }),
      createWorktree({ id: "bug-fix", branch: "fix/login-bug" }),
    ];

    render(<WorktreeList {...defaultProps} worktrees={worktrees} />);

    expect(screen.getByText("auth-feature")).toBeInTheDocument();
    expect(screen.getByText("bug-fix")).toBeInTheDocument();
  });

  it("renders branch names for each worktree", () => {
    const worktrees = [
      createWorktree({ id: "wt-1", branch: "feature/auth" }),
      createWorktree({ id: "wt-2", branch: "fix/login-bug" }),
    ];

    render(<WorktreeList {...defaultProps} worktrees={worktrees} />);

    expect(screen.getByText("feature/auth")).toBeInTheDocument();
    expect(screen.getByText("fix/login-bug")).toBeInTheDocument();
  });

  it("calls onSelect with the correct id when a worktree is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const worktrees = [
      createWorktree({ id: "first-wt", branch: "feat/first" }),
      createWorktree({ id: "second-wt", branch: "feat/second" }),
    ];

    render(<WorktreeList {...defaultProps} worktrees={worktrees} onSelect={onSelect} />);

    await user.click(screen.getByText("second-wt"));

    expect(onSelect).toHaveBeenCalledWith("second-wt");
  });

  it("filters worktrees by id", () => {
    const worktrees = [
      createWorktree({ id: "auth-feature", branch: "feat/auth" }),
      createWorktree({ id: "payment-fix", branch: "fix/payments" }),
      createWorktree({ id: "auth-refactor", branch: "refactor/auth-v2" }),
    ];

    render(<WorktreeList {...defaultProps} worktrees={worktrees} filter="auth" />);

    expect(screen.getByText("auth-feature")).toBeInTheDocument();
    expect(screen.getByText("auth-refactor")).toBeInTheDocument();
    expect(screen.queryByText("payment-fix")).not.toBeInTheDocument();
  });

  it("filters worktrees by branch name", () => {
    const worktrees = [
      createWorktree({ id: "wt-1", branch: "feature/login" }),
      createWorktree({ id: "wt-2", branch: "fix/payments" }),
    ];

    render(<WorktreeList {...defaultProps} worktrees={worktrees} filter="login" />);

    expect(screen.getByText("wt-1")).toBeInTheDocument();
    expect(screen.queryByText("wt-2")).not.toBeInTheDocument();
  });

  it("shows 'No matches' when filter matches nothing", () => {
    const worktrees = [createWorktree({ id: "my-wt", branch: "my-wt" })];

    render(<WorktreeList {...defaultProps} worktrees={worktrees} filter="nonexistent" />);

    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("is case-insensitive when filtering", () => {
    const worktrees = [createWorktree({ id: "MyFeature", branch: "my-feature" })];

    render(<WorktreeList {...defaultProps} worktrees={worktrees} filter="myfeature" />);

    expect(screen.getByText("MyFeature")).toBeInTheDocument();
  });

  it("renders all worktrees when filter is empty", () => {
    const worktrees = [
      createWorktree({ id: "wt-1", branch: "branch-1" }),
      createWorktree({ id: "wt-2", branch: "branch-2" }),
      createWorktree({ id: "wt-3", branch: "branch-3" }),
    ];

    render(<WorktreeList {...defaultProps} worktrees={worktrees} filter="" />);

    expect(screen.getByText("wt-1")).toBeInTheDocument();
    expect(screen.getByText("wt-2")).toBeInTheDocument();
    expect(screen.getByText("wt-3")).toBeInTheDocument();
  });
});
