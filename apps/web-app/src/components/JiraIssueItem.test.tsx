import { render, screen, userEvent } from "../test/render";
import type { JiraIssueSummary } from "../types";
import { JiraIssueItem } from "./JiraIssueItem";

function createJiraIssue(overrides: Partial<JiraIssueSummary> = {}): JiraIssueSummary {
  return {
    key: "PROJ-123",
    summary: "Fix login redirect bug",
    status: "In Progress",
    priority: "High",
    type: "Bug",
    assignee: "alice@example.com",
    updated: "2026-03-10T12:00:00Z",
    labels: ["frontend"],
    url: "https://jira.example.com/browse/PROJ-123",
    ...overrides,
  };
}

describe("JiraIssueItem", () => {
  const defaultProps = {
    issue: createJiraIssue(),
    isSelected: false,
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onSelect.mockClear();
  });

  it("renders the issue key", () => {
    render(<JiraIssueItem {...defaultProps} />);

    expect(screen.getByText("PROJ-123")).toBeInTheDocument();
  });

  it("renders the summary", () => {
    render(<JiraIssueItem {...defaultProps} />);

    expect(screen.getByText("Fix login redirect bug")).toBeInTheDocument();
  });

  it("renders the status badge", () => {
    render(<JiraIssueItem {...defaultProps} />);

    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("renders the priority", () => {
    render(<JiraIssueItem {...defaultProps} />);

    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("hides status when showStatus is false", () => {
    render(<JiraIssueItem {...defaultProps} showStatus={false} />);

    expect(screen.queryByText("In Progress")).not.toBeInTheDocument();
  });

  it("hides priority when showPriority is false", () => {
    render(<JiraIssueItem {...defaultProps} showPriority={false} />);

    expect(screen.queryByText("High")).not.toBeInTheDocument();
  });

  it("calls onSelect when clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<JiraIssueItem {...defaultProps} onSelect={onSelect} />);

    await user.click(screen.getByText("PROJ-123"));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows linked worktree indicator when linkedWorktreeId is provided", () => {
    render(<JiraIssueItem {...defaultProps} linkedWorktreeId="wt-42" onViewWorktree={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
  });

  it("does not show linked worktree indicator without linkedWorktreeId", () => {
    render(<JiraIssueItem {...defaultProps} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
  });

  it("calls onViewWorktree when worktree icon is clicked", async () => {
    const onViewWorktree = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <JiraIssueItem
        {...defaultProps}
        onSelect={onSelect}
        linkedWorktreeId="wt-42"
        onViewWorktree={onViewWorktree}
      />,
    );

    const buttons = screen.getAllByRole("button");
    const worktreeButton = buttons.find((btn) => btn !== buttons[0]) ?? buttons[1];
    await user.click(worktreeButton);

    expect(onViewWorktree).toHaveBeenCalledWith("wt-42");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
