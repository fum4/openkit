import { render, screen, userEvent } from "../test/render";
import type { CustomTaskSummary } from "../types";
import { CustomTaskItem } from "./CustomTaskItem";

function createCustomTask(overrides: Partial<CustomTaskSummary> = {}): CustomTaskSummary {
  return {
    id: "LOCAL-1",
    title: "Set up CI pipeline",
    status: "todo",
    priority: "high",
    labels: ["devops", "infra"],
    linkedWorktreeId: null,
    createdAt: "2026-03-08T10:00:00Z",
    updatedAt: "2026-03-10T12:00:00Z",
    ...overrides,
  };
}

describe("CustomTaskItem", () => {
  const defaultProps = {
    task: createCustomTask(),
    isSelected: false,
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onSelect.mockClear();
  });

  it("renders the task id", () => {
    render(<CustomTaskItem {...defaultProps} />);

    expect(screen.getByText("LOCAL-1")).toBeInTheDocument();
  });

  it("renders the task title", () => {
    render(<CustomTaskItem {...defaultProps} />);

    expect(screen.getByText("Set up CI pipeline")).toBeInTheDocument();
  });

  it("renders the status label for todo", () => {
    render(<CustomTaskItem {...defaultProps} />);

    expect(screen.getByText("Todo")).toBeInTheDocument();
  });

  it("renders the status label for in-progress", () => {
    const task = createCustomTask({ status: "in-progress" });

    render(<CustomTaskItem {...defaultProps} task={task} />);

    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("renders the status label for done", () => {
    const task = createCustomTask({ status: "done" });

    render(<CustomTaskItem {...defaultProps} task={task} />);

    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders the priority with capitalized first letter", () => {
    render(<CustomTaskItem {...defaultProps} />);

    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("renders medium priority", () => {
    const task = createCustomTask({ priority: "medium" });

    render(<CustomTaskItem {...defaultProps} task={task} />);

    expect(screen.getByText("Medium")).toBeInTheDocument();
  });

  it("hides status when showStatus is false", () => {
    render(<CustomTaskItem {...defaultProps} showStatus={false} />);

    expect(screen.queryByText("Todo")).not.toBeInTheDocument();
  });

  it("hides priority when showPriority is false", () => {
    render(<CustomTaskItem {...defaultProps} showPriority={false} />);

    expect(screen.queryByText("High")).not.toBeInTheDocument();
  });

  it("calls onSelect when clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<CustomTaskItem {...defaultProps} onSelect={onSelect} />);

    await user.click(screen.getByText("LOCAL-1"));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows linked worktree indicator when linkedWorktreeId is set", () => {
    const task = createCustomTask({ linkedWorktreeId: "wt-9" });

    render(<CustomTaskItem {...defaultProps} task={task} onViewWorktree={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
  });

  it("does not show linked worktree indicator when linkedWorktreeId is null", () => {
    render(<CustomTaskItem {...defaultProps} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
  });

  it("calls onViewWorktree when worktree icon is clicked without triggering onSelect", async () => {
    const onViewWorktree = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const task = createCustomTask({ linkedWorktreeId: "wt-9" });

    render(
      <CustomTaskItem
        {...defaultProps}
        task={task}
        onSelect={onSelect}
        onViewWorktree={onViewWorktree}
      />,
    );

    const buttons = screen.getAllByRole("button");
    const worktreeButton = buttons.find((btn) => btn !== buttons[0]) ?? buttons[1];
    await user.click(worktreeButton);

    expect(onViewWorktree).toHaveBeenCalledWith("wt-9");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
