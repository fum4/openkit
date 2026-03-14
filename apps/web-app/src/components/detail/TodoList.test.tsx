import { render, screen, userEvent, waitFor } from "../../test/render";
import { TodoList } from "./TodoList";
import type { TodoItem } from "../../hooks/api";

function makeTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: "todo-1",
    text: "Buy groceries",
    checked: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("TodoList", () => {
  const defaultProps = {
    todos: [] as TodoItem[],
    onAdd: vi.fn(),
    onToggle: vi.fn(),
    onDelete: vi.fn(),
    onUpdate: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders todo items", () => {
    const todos = [
      makeTodo({ id: "1", text: "Buy groceries" }),
      makeTodo({ id: "2", text: "Walk the dog" }),
    ];

    render(<TodoList {...defaultProps} todos={todos} />);

    expect(screen.getByText("Buy groceries")).toBeInTheDocument();
    expect(screen.getByText("Walk the dog")).toBeInTheDocument();
  });

  it("shows empty state with only the add button when list is empty", () => {
    render(<TodoList {...defaultProps} todos={[]} />);

    expect(screen.getByText("Add todo")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("creates a draft input when add button is clicked", async () => {
    const user = userEvent.setup();

    render(<TodoList {...defaultProps} />);

    await user.click(screen.getByText("Add todo"));

    expect(screen.getByPlaceholderText("What needs to be done?")).toBeInTheDocument();
  });

  it("commits a new todo when typing and pressing Enter", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();

    render(<TodoList {...defaultProps} onAdd={onAdd} />);

    await user.click(screen.getByText("Add todo"));
    await user.type(screen.getByPlaceholderText("What needs to be done?"), "New task{Enter}");

    expect(onAdd).toHaveBeenCalledWith("New task");
  });

  it("cancels the draft when Escape is pressed", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();

    render(<TodoList {...defaultProps} onAdd={onAdd} />);

    await user.click(screen.getByText("Add todo"));
    await user.type(screen.getByPlaceholderText("What needs to be done?"), "Something{Escape}");

    expect(onAdd).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("What needs to be done?")).not.toBeInTheDocument();
    });
  });

  it("calls onToggle when checkbox is clicked", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    const todos = [makeTodo({ id: "t1", text: "Task one", checked: false })];

    render(<TodoList {...defaultProps} todos={todos} onToggle={onToggle} />);

    const buttons = screen.getAllByRole("button");
    // First button in a todo row is the checkbox toggle
    const checkboxButton = buttons.find((btn) => !btn.textContent?.includes("Add todo"))!;
    await user.click(checkboxButton);

    expect(onToggle).toHaveBeenCalledWith("t1");
  });

  it("calls onDelete when delete button is clicked", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    const todos = [makeTodo({ id: "t1", text: "Task one" })];

    render(<TodoList {...defaultProps} todos={todos} onDelete={onDelete} />);

    // The delete button is the last button per row (the X icon button)
    const buttons = screen.getAllByRole("button");
    // Buttons: checkbox, delete, add todo — delete is index 1
    const deleteButton = buttons[1];
    await user.click(deleteButton);

    expect(onDelete).toHaveBeenCalledWith("t1");
  });

  it("marks a checked item with line-through styling", () => {
    const todos = [makeTodo({ id: "t1", text: "Done task", checked: true })];

    render(<TodoList {...defaultProps} todos={todos} />);

    const todoText = screen.getByText("Done task");
    expect(todoText.className).toContain("line-through");
  });

  it("cancels draft on Escape with empty input", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();

    render(<TodoList {...defaultProps} onAdd={onAdd} />);

    await user.click(screen.getByText("Add todo"));
    await user.keyboard("{Escape}");

    expect(onAdd).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("What needs to be done?")).not.toBeInTheDocument();
    });
  });
});
