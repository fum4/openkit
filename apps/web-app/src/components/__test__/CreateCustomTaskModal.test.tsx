import { render, screen, userEvent, waitFor } from "../../__test__/render";
import { CreateCustomTaskModal } from "../CreateCustomTaskModal";

describe("CreateCustomTaskModal", () => {
  const defaultProps = {
    onCreated: vi.fn(),
    onClose: vi.fn(),
    onCreate: vi.fn(async () => ({ success: true, task: { id: "task-1" } })),
  };

  beforeEach(() => {
    defaultProps.onCreated.mockClear();
    defaultProps.onClose.mockClear();
    defaultProps.onCreate.mockClear();
    defaultProps.onCreate.mockResolvedValue({ success: true, task: { id: "task-1" } });
  });

  it("renders the form with title, priority, labels, and description fields", () => {
    render(<CreateCustomTaskModal {...defaultProps} />);

    expect(screen.getByRole("heading", { name: "Create Issue" })).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByText("Labels")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What needs to be done?")).toBeInTheDocument();
  });

  it("disables Create Issue button when title is empty", () => {
    render(<CreateCustomTaskModal {...defaultProps} />);

    expect(screen.getByRole("button", { name: "Create Issue" })).toBeDisabled();
  });

  it("enables Create Issue button when title is provided", async () => {
    const user = userEvent.setup();

    render(<CreateCustomTaskModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText("What needs to be done?"), "My task");

    expect(screen.getByRole("button", { name: "Create Issue" })).toBeEnabled();
  });

  it("selects priority by clicking priority buttons", async () => {
    const user = userEvent.setup();

    render(<CreateCustomTaskModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText("What needs to be done?"), "My task");
    await user.click(screen.getByRole("button", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() => {
      expect(defaultProps.onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ priority: "high" }),
      );
    });
  });

  it("adds a label via the Add button", async () => {
    const user = userEvent.setup();

    render(<CreateCustomTaskModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText("Add a label..."), "bug");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("bug")).toBeInTheDocument();
  });

  it("adds a label by pressing Enter", async () => {
    const user = userEvent.setup();

    render(<CreateCustomTaskModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText("Add a label..."), "feature{enter}");

    expect(screen.getByText("feature")).toBeInTheDocument();
  });

  it("removes a label when its remove button is clicked", async () => {
    const user = userEvent.setup();

    render(<CreateCustomTaskModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText("Add a label..."), "bug{enter}");
    expect(screen.getByText("bug")).toBeInTheDocument();

    // The X button is inside the label span
    const labelSpan = screen.getByText("bug").closest("span")!;
    const removeButton = labelSpan.querySelector("button")!;
    await user.click(removeButton);

    expect(screen.queryByText("bug")).not.toBeInTheDocument();
  });

  it("does not add duplicate labels", async () => {
    const user = userEvent.setup();

    render(<CreateCustomTaskModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText("Add a label..."), "bug{enter}");
    await user.type(screen.getByPlaceholderText("Add a label..."), "bug{enter}");

    const bugElements = screen.getAllByText("bug");
    expect(bugElements).toHaveLength(1);
  });

  it("submits with correct data and closes modal on success", async () => {
    const user = userEvent.setup();

    render(<CreateCustomTaskModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText("What needs to be done?"), "My task");
    await user.type(screen.getByPlaceholderText("Add a label..."), "urgent{enter}");
    await user.click(screen.getByRole("button", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() => {
      expect(defaultProps.onCreate).toHaveBeenCalledWith({
        title: "My task",
        description: undefined,
        priority: "high",
        labels: ["urgent"],
        linkedWorktreeId: undefined,
      });
    });
    expect(defaultProps.onCreated).toHaveBeenCalledWith("task-1");
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("displays error when creation fails", async () => {
    defaultProps.onCreate.mockResolvedValue({ success: false, error: "Server error" } as any);

    const user = userEvent.setup();

    render(<CreateCustomTaskModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText("What needs to be done?"), "My task");
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("closes modal when Cancel is clicked", async () => {
    const user = userEvent.setup();

    render(<CreateCustomTaskModal {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });
});
