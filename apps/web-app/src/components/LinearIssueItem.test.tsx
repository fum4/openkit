import { render, screen, userEvent } from "../test/render";
import type { LinearIssueSummary } from "../types";
import { LinearIssueItem } from "./LinearIssueItem";

function createLinearIssue(overrides: Partial<LinearIssueSummary> = {}): LinearIssueSummary {
  return {
    identifier: "ENG-42",
    title: "Implement dark mode toggle",
    state: { name: "In Progress", type: "started", color: "#f2c94c" },
    priority: 2,
    priorityLabel: "High",
    assignee: "bob@example.com",
    updatedAt: "2026-03-10T12:00:00Z",
    labels: [{ name: "frontend", color: "#5e6ad2" }],
    url: "https://linear.app/team/issue/ENG-42",
    ...overrides,
  };
}

describe("LinearIssueItem", () => {
  const defaultProps = {
    issue: createLinearIssue(),
    isSelected: false,
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onSelect.mockClear();
  });

  it("renders the identifier", () => {
    render(<LinearIssueItem {...defaultProps} />);

    expect(screen.getByText("ENG-42")).toBeInTheDocument();
  });

  it("renders the title", () => {
    render(<LinearIssueItem {...defaultProps} />);

    expect(screen.getByText("Implement dark mode toggle")).toBeInTheDocument();
  });

  it("renders the state name", () => {
    render(<LinearIssueItem {...defaultProps} />);

    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("renders the priority label", () => {
    render(<LinearIssueItem {...defaultProps} />);

    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("hides status when showStatus is false", () => {
    render(<LinearIssueItem {...defaultProps} showStatus={false} />);

    expect(screen.queryByText("In Progress")).not.toBeInTheDocument();
  });

  it("hides priority when showPriority is false", () => {
    render(<LinearIssueItem {...defaultProps} showPriority={false} />);

    expect(screen.queryByText("High")).not.toBeInTheDocument();
  });

  it("does not render priority label when it is empty", () => {
    const issue = createLinearIssue({ priorityLabel: "" });

    render(<LinearIssueItem {...defaultProps} issue={issue} />);

    expect(screen.getByText("ENG-42")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<LinearIssueItem {...defaultProps} onSelect={onSelect} />);

    await user.click(screen.getByText("ENG-42"));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows linked worktree indicator when linkedWorktreeId is provided", () => {
    render(<LinearIssueItem {...defaultProps} linkedWorktreeId="wt-7" onViewWorktree={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
  });

  it("does not show linked worktree indicator without linkedWorktreeId", () => {
    render(<LinearIssueItem {...defaultProps} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
  });

  it("calls onViewWorktree when worktree icon is clicked without triggering onSelect", async () => {
    const onViewWorktree = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <LinearIssueItem
        {...defaultProps}
        onSelect={onSelect}
        linkedWorktreeId="wt-7"
        onViewWorktree={onViewWorktree}
      />,
    );

    const buttons = screen.getAllByRole("button");
    const worktreeButton = buttons.find((btn) => btn !== buttons[0]) ?? buttons[1];
    await user.click(worktreeButton);

    expect(onViewWorktree).toHaveBeenCalledWith("wt-7");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
