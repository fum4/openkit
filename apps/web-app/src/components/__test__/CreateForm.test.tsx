import { render, screen, userEvent } from "../../__test__/render";
import { CreateForm } from "../CreateForm";

describe("CreateForm", () => {
  const defaultProps = {
    jiraConfigured: false,
    linearConfigured: false,
    activeTab: "branch" as const,
    onTabChange: vi.fn(),
    onCreateWorktree: vi.fn(),
    onCreateFromJira: vi.fn(),
    onCreateFromLinear: vi.fn(),
    onCreateCustomTask: vi.fn(),
    onNavigateToIntegrations: vi.fn(),
  };

  beforeEach(() => {
    Object.values(defaultProps).forEach((fn) => {
      if (typeof fn === "function" && "mockClear" in fn) {
        (fn as ReturnType<typeof vi.fn>).mockClear();
      }
    });
  });

  it("renders Worktrees and Issues tabs", () => {
    render(<CreateForm {...defaultProps} />);

    expect(screen.getByRole("button", { name: "Worktrees" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issues" })).toBeInTheDocument();
  });

  it("calls onTabChange when tab is clicked", async () => {
    const user = userEvent.setup();

    render(<CreateForm {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Issues" }));

    expect(defaultProps.onTabChange).toHaveBeenCalledWith("issues");
  });

  it("opens create menu on plus button click", async () => {
    const user = userEvent.setup();

    render(<CreateForm {...defaultProps} />);

    // The Plus button doesn't have text, find it by its icon behavior
    const buttons = screen.getAllByRole("button");
    const plusButton = buttons.find(
      (b) => !b.textContent?.includes("Worktrees") && !b.textContent?.includes("Issues"),
    )!;

    await user.click(plusButton);

    expect(screen.getByText("Create worktree")).toBeInTheDocument();
    expect(screen.getByText("Create task")).toBeInTheDocument();
  });

  it("calls onCreateWorktree when 'Create worktree' is clicked", async () => {
    const user = userEvent.setup();

    render(<CreateForm {...defaultProps} />);

    const buttons = screen.getAllByRole("button");
    const plusButton = buttons.find(
      (b) => !b.textContent?.includes("Worktrees") && !b.textContent?.includes("Issues"),
    )!;
    await user.click(plusButton);
    await user.click(screen.getByText("Create worktree"));

    expect(defaultProps.onCreateWorktree).toHaveBeenCalledOnce();
  });

  it("calls onCreateCustomTask when 'Create task' is clicked", async () => {
    const user = userEvent.setup();

    render(<CreateForm {...defaultProps} />);

    const buttons = screen.getAllByRole("button");
    const plusButton = buttons.find(
      (b) => !b.textContent?.includes("Worktrees") && !b.textContent?.includes("Issues"),
    )!;
    await user.click(plusButton);
    await user.click(screen.getByText("Create task"));

    expect(defaultProps.onCreateCustomTask).toHaveBeenCalledOnce();
  });

  it("shows Jira option when Jira is configured", async () => {
    const user = userEvent.setup();

    render(<CreateForm {...defaultProps} jiraConfigured />);

    const buttons = screen.getAllByRole("button");
    const plusButton = buttons.find(
      (b) => !b.textContent?.includes("Worktrees") && !b.textContent?.includes("Issues"),
    )!;
    await user.click(plusButton);

    expect(screen.getByText("Pull from Jira")).toBeInTheDocument();
  });

  it("shows Linear option when Linear is configured", async () => {
    const user = userEvent.setup();

    render(<CreateForm {...defaultProps} linearConfigured />);

    const buttons = screen.getAllByRole("button");
    const plusButton = buttons.find(
      (b) => !b.textContent?.includes("Worktrees") && !b.textContent?.includes("Issues"),
    )!;
    await user.click(plusButton);

    expect(screen.getByText("Pull from Linear")).toBeInTheDocument();
  });

  it("shows 'Configure Jira' when Jira is not configured", async () => {
    const user = userEvent.setup();

    render(<CreateForm {...defaultProps} jiraConfigured={false} />);

    const buttons = screen.getAllByRole("button");
    const plusButton = buttons.find(
      (b) => !b.textContent?.includes("Worktrees") && !b.textContent?.includes("Issues"),
    )!;
    await user.click(plusButton);

    expect(screen.getByText("Configure Jira")).toBeInTheDocument();
  });

  it("calls onNavigateToIntegrations when 'Configure Jira' is clicked", async () => {
    const user = userEvent.setup();

    render(<CreateForm {...defaultProps} />);

    const buttons = screen.getAllByRole("button");
    const plusButton = buttons.find(
      (b) => !b.textContent?.includes("Worktrees") && !b.textContent?.includes("Issues"),
    )!;
    await user.click(plusButton);
    await user.click(screen.getByText("Configure Jira"));

    expect(defaultProps.onNavigateToIntegrations).toHaveBeenCalledOnce();
  });

  it("calls onCreateFromJira when 'Pull from Jira' is clicked", async () => {
    const user = userEvent.setup();

    render(<CreateForm {...defaultProps} jiraConfigured />);

    const buttons = screen.getAllByRole("button");
    const plusButton = buttons.find(
      (b) => !b.textContent?.includes("Worktrees") && !b.textContent?.includes("Issues"),
    )!;
    await user.click(plusButton);
    await user.click(screen.getByText("Pull from Jira"));

    expect(defaultProps.onCreateFromJira).toHaveBeenCalledOnce();
  });
});
