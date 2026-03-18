import { render, screen, userEvent } from "../../__test__/render";
import type { WorktreeInfo } from "../../types";
import { WorktreeItem } from "../WorktreeItem";

function createWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id: "my-feature",
    path: "/work/.worktrees/my-feature",
    branch: "feature/my-feature",
    status: "stopped",
    ports: [],
    offset: null,
    pid: null,
    ...overrides,
  };
}

describe("WorktreeItem", () => {
  const defaultProps = {
    worktree: createWorktree(),
    isSelected: false,
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onSelect.mockClear();
  });

  it("renders worktree id and branch", () => {
    render(<WorktreeItem {...defaultProps} />);

    expect(screen.getByText("my-feature")).toBeInTheDocument();
    expect(screen.getByText("feature/my-feature")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<WorktreeItem {...defaultProps} onSelect={onSelect} />);

    await user.click(screen.getByRole("button"));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows creating status with message", () => {
    const worktree = createWorktree({
      status: "creating",
      statusMessage: "Cloning repository...",
    });

    render(<WorktreeItem {...defaultProps} worktree={worktree} />);

    expect(screen.getByText("Cloning repository...")).toBeInTheDocument();
  });

  it("shows default creating message when no status message", () => {
    const worktree = createWorktree({ status: "creating" });

    render(<WorktreeItem {...defaultProps} worktree={worktree} />);

    expect(screen.getByText("Creating...")).toBeInTheDocument();
  });

  it("shows unpushed commits count", () => {
    const worktree = createWorktree({ hasUnpushed: true, commitsAhead: 3 });

    render(<WorktreeItem {...defaultProps} worktree={worktree} />);

    expect(screen.getByText("↑3")).toBeInTheDocument();
  });

  it("shows unpushed arrow without count when commitsAhead is undefined", () => {
    const worktree = createWorktree({ hasUnpushed: true });

    render(<WorktreeItem {...defaultProps} worktree={worktree} />);

    expect(screen.getByText("↑")).toBeInTheDocument();
  });

  it("calls onSelectJiraIssue when Jira icon area is clicked", async () => {
    const onSelectJiraIssue = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const worktree = createWorktree({
      jiraUrl: "https://jira.example.com/browse/PROJ-42",
    });

    const { container } = render(
      <WorktreeItem
        worktree={worktree}
        isSelected={false}
        onSelect={onSelect}
        onSelectJiraIssue={onSelectJiraIssue}
      />,
    );

    // The Jira icon click handler is on a span inside the button
    // Find the clickable span elements that stop propagation
    const jiraSpan = container.querySelector("[class*='hover:text-blue-400']");
    expect(jiraSpan).toBeInTheDocument();

    await user.click(jiraSpan!);

    expect(onSelectJiraIssue).toHaveBeenCalledWith("PROJ-42");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onSelectLinearIssue when Linear icon area is clicked", async () => {
    const onSelectLinearIssue = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const worktree = createWorktree({
      linearUrl: "https://linear.app/team/issue/ENG-99",
    });

    const { container } = render(
      <WorktreeItem
        worktree={worktree}
        isSelected={false}
        onSelect={onSelect}
        onSelectLinearIssue={onSelectLinearIssue}
      />,
    );

    const linearSpan = container.querySelector("[class*='hover:text-\\[\\#5E6AD2\\]']");
    expect(linearSpan).toBeInTheDocument();

    await user.click(linearSpan!);

    expect(onSelectLinearIssue).toHaveBeenCalledWith("ENG-99");
  });

  it("calls onSelectLocalIssue when local task icon is clicked", async () => {
    const onSelectLocalIssue = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const worktree = createWorktree({ localIssueId: "LOCAL-5" });

    const { container } = render(
      <WorktreeItem
        worktree={worktree}
        isSelected={false}
        onSelect={onSelect}
        hasLocalIssue
        onSelectLocalIssue={onSelectLocalIssue}
      />,
    );

    const localSpan = container.querySelector("[class*='hover:text-amber-400']");
    expect(localSpan).toBeInTheDocument();

    await user.click(localSpan!);

    expect(onSelectLocalIssue).toHaveBeenCalledWith("LOCAL-5");
  });

  it("renders PR icon when githubPrUrl exists", () => {
    const worktree = createWorktree({
      githubPrUrl: "https://github.com/org/repo/pull/1",
      githubPrState: "open",
    });

    const { container } = render(<WorktreeItem {...defaultProps} worktree={worktree} />);

    // The PR icon is an inline SVG with a specific path
    const prIcon = container.querySelector("[class*='hover:text-emerald-400']");
    expect(prIcon).toBeInTheDocument();
  });

  it("renders merged PR with purple hover color", () => {
    const worktree = createWorktree({
      githubPrUrl: "https://github.com/org/repo/pull/1",
      githubPrState: "merged",
    });

    const { container } = render(<WorktreeItem {...defaultProps} worktree={worktree} />);

    const prIcon = container.querySelector("[class*='hover:text-purple-400']");
    expect(prIcon).toBeInTheDocument();
  });
});
