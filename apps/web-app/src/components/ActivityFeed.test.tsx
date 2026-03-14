import { render, screen, userEvent } from "../test/render";
import type { ActivityEvent } from "../hooks/api";
import { ActivityFeedPanel, ActivityBell, type ActivityFilterGroup } from "./ActivityFeed";

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "evt-1",
    timestamp: new Date().toISOString(),
    category: "worktree",
    type: "creation_completed",
    severity: "success",
    title: "Worktree created",
    detail: "Branch feature/login ready",
    ...overrides,
  };
}

const defaultPanelProps = {
  events: [] as ActivityEvent[],
  unseenEventIds: new Set<string>(),
  onClearAll: vi.fn(),
  selectedFilterGroups: [] as ActivityFilterGroup[],
  onToggleFilterGroup: vi.fn(),
  onClearFilterGroups: vi.fn(),
};

describe("ActivityFeedPanel", () => {
  it("renders empty state when no events exist", () => {
    render(<ActivityFeedPanel {...defaultPanelProps} events={[]} />);

    expect(screen.getByText("No recent activity")).toBeInTheDocument();
  });

  it("renders event title and detail when events exist", () => {
    const event = makeEvent({ title: "Worktree created", detail: "Branch feature/login ready" });

    render(<ActivityFeedPanel {...defaultPanelProps} events={[event]} />);

    expect(screen.getByText("Worktree created")).toBeInTheDocument();
    expect(screen.getByText("Branch feature/login ready")).toBeInTheDocument();
  });

  it("renders multiple events", () => {
    const events = [
      makeEvent({ id: "evt-1", title: "First event" }),
      makeEvent({ id: "evt-2", title: "Second event" }),
    ];

    render(<ActivityFeedPanel {...defaultPanelProps} events={events} />);

    expect(screen.getByText("First event")).toBeInTheDocument();
    expect(screen.getByText("Second event")).toBeInTheDocument();
  });

  it("filters events when a filter group is selected", () => {
    const worktreeEvent = makeEvent({
      id: "evt-1",
      category: "worktree",
      title: "Worktree event",
    });
    const agentEvent = makeEvent({
      id: "evt-2",
      category: "agent",
      type: "agent_connected",
      title: "Agent event",
    });

    render(
      <ActivityFeedPanel
        {...defaultPanelProps}
        events={[worktreeEvent, agentEvent]}
        selectedFilterGroups={["worktree"]}
      />,
    );

    expect(screen.getByText("Worktree event")).toBeInTheDocument();
    expect(screen.queryByText("Agent event")).not.toBeInTheDocument();
  });

  it("shows all events when no filter groups are selected", () => {
    const worktreeEvent = makeEvent({
      id: "evt-1",
      category: "worktree",
      title: "Worktree event",
    });
    const agentEvent = makeEvent({
      id: "evt-2",
      category: "agent",
      type: "agent_connected",
      title: "Agent event",
    });

    render(
      <ActivityFeedPanel
        {...defaultPanelProps}
        events={[worktreeEvent, agentEvent]}
        selectedFilterGroups={[]}
      />,
    );

    expect(screen.getByText("Worktree event")).toBeInTheDocument();
    expect(screen.getByText("Agent event")).toBeInTheDocument();
  });

  it("calls onToggleFilterGroup when a filter button is clicked", async () => {
    const onToggleFilterGroup = vi.fn();
    const user = userEvent.setup();

    render(
      <ActivityFeedPanel
        {...defaultPanelProps}
        events={[makeEvent()]}
        onToggleFilterGroup={onToggleFilterGroup}
      />,
    );

    await user.click(screen.getByText("Agents"));

    expect(onToggleFilterGroup).toHaveBeenCalledWith("agents");
  });

  it("calls onClearFilterGroups when the All button is clicked", async () => {
    const onClearFilterGroups = vi.fn();
    const user = userEvent.setup();

    render(
      <ActivityFeedPanel
        {...defaultPanelProps}
        events={[makeEvent()]}
        selectedFilterGroups={["worktree"]}
        onClearFilterGroups={onClearFilterGroups}
      />,
    );

    await user.click(screen.getByText("All"));

    expect(onClearFilterGroups).toHaveBeenCalledOnce();
  });

  it("shows no-match message when filter excludes all events", () => {
    const worktreeEvent = makeEvent({ id: "evt-1", category: "worktree", title: "Worktree event" });

    render(
      <ActivityFeedPanel
        {...defaultPanelProps}
        events={[worktreeEvent]}
        selectedFilterGroups={["agents"]}
      />,
    );

    expect(screen.getByText("No activity matches selected types")).toBeInTheDocument();
  });

  it("highlights action-required events with amber background", () => {
    const actionEvent = makeEvent({
      id: "evt-action",
      category: "agent",
      type: "agent_awaiting_input",
      title: "Agent needs input",
      metadata: { requiresUserAction: true },
    });

    render(<ActivityFeedPanel {...defaultPanelProps} events={[actionEvent]} />);

    const title = screen.getByText("Agent needs input");
    const row = title.closest("[class*='bg-amber']");
    expect(row).toBeInTheDocument();
  });

  it("does not highlight regular events with amber background", () => {
    const event = makeEvent({ id: "evt-normal", title: "Normal event" });

    render(<ActivityFeedPanel {...defaultPanelProps} events={[event]} />);

    const title = screen.getByText("Normal event");
    const row = title.closest("[class*='bg-amber']");
    expect(row).toBeNull();
  });

  it("calls onNavigateToWorktree when a worktree event row is clicked", async () => {
    const onNavigateToWorktree = vi.fn();
    const user = userEvent.setup();
    const event = makeEvent({
      id: "evt-nav",
      worktreeId: "my-worktree",
      projectName: "test-project",
      title: "Worktree event",
    });

    render(
      <ActivityFeedPanel
        {...defaultPanelProps}
        events={[event]}
        onNavigateToWorktree={onNavigateToWorktree}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Worktree event/i }));

    expect(onNavigateToWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: "my-worktree" }),
    );
  });

  it("calls onClearAll when the Clear button is clicked", async () => {
    const onClearAll = vi.fn();
    const user = userEvent.setup();

    render(
      <ActivityFeedPanel {...defaultPanelProps} events={[makeEvent()]} onClearAll={onClearAll} />,
    );

    await user.click(screen.getByText("Clear"));

    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("shows unread dot for unseen events", () => {
    const event = makeEvent({ id: "evt-unseen", title: "Unseen event" });

    const { container } = render(
      <ActivityFeedPanel
        {...defaultPanelProps}
        events={[event]}
        unseenEventIds={new Set(["evt-unseen"])}
      />,
    );

    const dot = container.querySelector(".bg-teal-400");
    expect(dot).toBeInTheDocument();
  });

  it("does not show unread dot for seen events", () => {
    const event = makeEvent({ id: "evt-seen", title: "Seen event" });

    const { container } = render(
      <ActivityFeedPanel
        {...defaultPanelProps}
        events={[event]}
        unseenEventIds={new Set<string>()}
      />,
    );

    const dot = container.querySelector(".bg-teal-400");
    expect(dot).not.toBeInTheDocument();
  });

  it("renders loading state when isLoading and no events", () => {
    const { container } = render(
      <ActivityFeedPanel {...defaultPanelProps} events={[]} isLoading />,
    );

    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });
});

describe("ActivityBell", () => {
  it("renders the bell button", () => {
    render(<ActivityBell unreadCount={0} isOpen={false} onClick={vi.fn()} />);

    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("shows unread count badge when count is greater than zero", () => {
    render(<ActivityBell unreadCount={5} isOpen={false} onClick={vi.fn()} />);

    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("does not show badge when unread count is zero", () => {
    render(<ActivityBell unreadCount={0} isOpen={false} onClick={vi.fn()} />);

    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("caps displayed count at 99+", () => {
    render(<ActivityBell unreadCount={150} isOpen={false} onClick={vi.fn()} />);

    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("calls onClick when bell is clicked", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<ActivityBell unreadCount={0} isOpen={false} onClick={onClick} />);

    await user.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledOnce();
  });
});
