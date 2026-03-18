import { render, screen, userEvent } from "../../__test__/render";
import type { LinearIssueSummary } from "../../types";
import { LinearIssueList } from "../LinearIssueList";

function createLinearIssue(overrides: Partial<LinearIssueSummary> = {}): LinearIssueSummary {
  return {
    identifier: "ENG-1",
    title: "Default linear issue",
    state: { name: "Todo", type: "unstarted", color: "#bdbdbd" },
    priority: 3,
    priorityLabel: "Medium",
    assignee: null,
    updatedAt: "2026-03-10T12:00:00Z",
    labels: [],
    url: "https://linear.app/team/issue/ENG-1",
    ...overrides,
  };
}

describe("LinearIssueList", () => {
  const defaultProps = {
    issues: [] as LinearIssueSummary[],
    selectedIdentifier: null,
    onSelect: vi.fn(),
    isLoading: false,
    isFetching: false,
    error: null,
  };

  beforeEach(() => {
    defaultProps.onSelect.mockClear();
  });

  it("shows loading spinner when loading with no issues", () => {
    render(<LinearIssueList {...defaultProps} isLoading />);

    expect(screen.getByText("Loading issues...")).toBeInTheDocument();
  });

  it("shows error message when error with no issues", () => {
    render(<LinearIssueList {...defaultProps} error="Network error" />);

    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("shows empty state when no issues and not loading", () => {
    render(<LinearIssueList {...defaultProps} />);

    expect(screen.getByText("No issues found")).toBeInTheDocument();
  });

  it("renders issue items when issues are provided", () => {
    const issues = [
      createLinearIssue({ identifier: "ENG-1", title: "First linear" }),
      createLinearIssue({ identifier: "ENG-2", title: "Second linear" }),
    ];

    render(<LinearIssueList {...defaultProps} issues={issues} />);

    expect(screen.getByText("ENG-1")).toBeInTheDocument();
    expect(screen.getByText("First linear")).toBeInTheDocument();
    expect(screen.getByText("ENG-2")).toBeInTheDocument();
    expect(screen.getByText("Second linear")).toBeInTheDocument();
  });

  it("calls onSelect with the correct identifier when an item is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const issues = [createLinearIssue({ identifier: "ENG-10", title: "Click me" })];

    render(<LinearIssueList {...defaultProps} issues={issues} onSelect={onSelect} />);

    await user.click(screen.getByText("ENG-10"));

    expect(onSelect).toHaveBeenCalledWith("ENG-10");
  });

  it("marks the selected issue", () => {
    const issues = [
      createLinearIssue({ identifier: "ENG-1", title: "First" }),
      createLinearIssue({ identifier: "ENG-2", title: "Second" }),
    ];

    const { container } = render(
      <LinearIssueList {...defaultProps} issues={issues} selectedIdentifier="ENG-2" />,
    );

    const buttons = container.querySelectorAll("[data-sidebar-item]");
    expect(buttons[1]?.className).toContain("border-[#5E6AD2]");
  });

  it("prefers loading state over error when both are set with no issues", () => {
    render(<LinearIssueList {...defaultProps} isLoading error="Some error" />);

    expect(screen.getByText("Loading issues...")).toBeInTheDocument();
    expect(screen.queryByText("Some error")).not.toBeInTheDocument();
  });

  it("passes linkedWorktrees to items", () => {
    const issues = [createLinearIssue({ identifier: "ENG-1", title: "Linked" })];
    const linkedWorktrees = new Map([["ENG-1", "wt-3"]]);

    render(
      <LinearIssueList
        {...defaultProps}
        issues={issues}
        linkedWorktrees={linkedWorktrees}
        onViewWorktree={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
  });
});
