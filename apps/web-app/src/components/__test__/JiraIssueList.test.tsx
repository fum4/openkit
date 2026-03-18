import { render, screen, userEvent } from "../../__test__/render";
import type { JiraIssueSummary } from "../../types";
import { JiraIssueList } from "../JiraIssueList";

function createJiraIssue(overrides: Partial<JiraIssueSummary> = {}): JiraIssueSummary {
  return {
    key: "PROJ-1",
    summary: "Default issue summary",
    status: "To Do",
    priority: "Medium",
    type: "Task",
    assignee: null,
    updated: "2026-03-10T12:00:00Z",
    labels: [],
    url: "https://jira.example.com/browse/PROJ-1",
    ...overrides,
  };
}

describe("JiraIssueList", () => {
  const defaultProps = {
    issues: [] as JiraIssueSummary[],
    selectedKey: null,
    onSelect: vi.fn(),
    isLoading: false,
    isFetching: false,
    error: null,
  };

  beforeEach(() => {
    defaultProps.onSelect.mockClear();
  });

  it("shows loading spinner when loading with no issues", () => {
    render(<JiraIssueList {...defaultProps} isLoading />);

    expect(screen.getByText("Loading issues...")).toBeInTheDocument();
  });

  it("shows error message when error with no issues", () => {
    render(<JiraIssueList {...defaultProps} error="Failed to fetch" />);

    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
  });

  it("shows empty state when no issues and not loading", () => {
    render(<JiraIssueList {...defaultProps} />);

    expect(screen.getByText("No issues found")).toBeInTheDocument();
  });

  it("renders issue items when issues are provided", () => {
    const issues = [
      createJiraIssue({ key: "PROJ-1", summary: "First issue" }),
      createJiraIssue({ key: "PROJ-2", summary: "Second issue" }),
    ];

    render(<JiraIssueList {...defaultProps} issues={issues} />);

    expect(screen.getByText("PROJ-1")).toBeInTheDocument();
    expect(screen.getByText("First issue")).toBeInTheDocument();
    expect(screen.getByText("PROJ-2")).toBeInTheDocument();
    expect(screen.getByText("Second issue")).toBeInTheDocument();
  });

  it("calls onSelect with the correct key when an item is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const issues = [createJiraIssue({ key: "PROJ-5", summary: "Click me" })];

    render(<JiraIssueList {...defaultProps} issues={issues} onSelect={onSelect} />);

    await user.click(screen.getByText("PROJ-5"));

    expect(onSelect).toHaveBeenCalledWith("PROJ-5");
  });

  it("marks the selected issue", () => {
    const issues = [
      createJiraIssue({ key: "PROJ-1", summary: "First" }),
      createJiraIssue({ key: "PROJ-2", summary: "Second" }),
    ];

    const { container } = render(
      <JiraIssueList {...defaultProps} issues={issues} selectedKey="PROJ-2" />,
    );

    const buttons = container.querySelectorAll("[data-sidebar-item]");
    expect(buttons[1]?.className).toContain("border-blue-400");
  });

  it("prefers loading state over error when both are set with no issues", () => {
    render(<JiraIssueList {...defaultProps} isLoading error="Some error" />);

    expect(screen.getByText("Loading issues...")).toBeInTheDocument();
    expect(screen.queryByText("Some error")).not.toBeInTheDocument();
  });

  it("passes linkedWorktrees to items", () => {
    const issues = [createJiraIssue({ key: "PROJ-1", summary: "Linked one" })];
    const linkedWorktrees = new Map([["PROJ-1", "wt-1"]]);

    render(
      <JiraIssueList
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
