import { fireEvent } from "@testing-library/react";

import { render, screen, act } from "../../test/render";
import { PersonalNotesSection, AgentSection } from "./NotesSection";

// Mock useNotes to control data without needing real API
const mockUpdateSection = vi.fn().mockResolvedValue({});
const mockAddTodo = vi.fn().mockResolvedValue({});
const mockToggleTodo = vi.fn().mockResolvedValue({});
const mockDeleteTodo = vi.fn().mockResolvedValue({});
const mockUpdateTodoText = vi.fn().mockResolvedValue({});
const mockUpdateGitPolicy = vi.fn().mockResolvedValue({});
const mockUpdateHookSkills = vi.fn().mockResolvedValue({});

let mockNotesData: Record<string, unknown> | null = null;
let mockHooksConfigData: Record<string, unknown> | null = null;

vi.mock("../../hooks/useNotes", () => ({
  useNotes: () => ({
    notes: mockNotesData,
    isLoading: false,
    error: null,
    updateSection: mockUpdateSection,
    addTodo: mockAddTodo,
    toggleTodo: mockToggleTodo,
    deleteTodo: mockDeleteTodo,
    updateTodoText: mockUpdateTodoText,
    updateGitPolicy: mockUpdateGitPolicy,
    updateHookSkills: mockUpdateHookSkills,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../hooks/useHooks", () => ({
  useHooksConfig: () => ({
    config: mockHooksConfigData,
    isLoading: false,
    refetch: vi.fn(),
    saveConfig: vi.fn(),
  }),
}));

describe("PersonalNotesSection", () => {
  const defaultProps = { source: "local" as const, issueId: "issue-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNotesData = null;
  });

  it("renders placeholder when empty", () => {
    mockNotesData = { personal: { content: "" }, aiContext: { content: "" } };

    render(<PersonalNotesSection {...defaultProps} />);

    expect(screen.getByText("Click to edit")).toBeInTheDocument();
  });

  it("renders the Notes heading", () => {
    mockNotesData = { personal: { content: "" }, aiContext: { content: "" } };

    render(<PersonalNotesSection {...defaultProps} />);

    expect(screen.getByText("Notes")).toBeInTheDocument();
  });

  it("renders personal note content when present", () => {
    mockNotesData = {
      personal: { content: "My personal note" },
      aiContext: { content: "" },
    };

    render(<PersonalNotesSection {...defaultProps} />);

    expect(screen.getByText("My personal note")).toBeInTheDocument();
  });

  it("enters editing mode on click and calls updateSection via debounce", async () => {
    vi.useFakeTimers();
    mockNotesData = {
      personal: { content: "" },
      aiContext: { content: "" },
    };

    render(<PersonalNotesSection {...defaultProps} />);

    act(() => {
      fireEvent.click(screen.getByText("Click to edit"));
    });

    const textarea = screen.getByPlaceholderText("Personal notes about this issue...");
    expect(textarea).toBeInTheDocument();

    act(() => {
      fireEvent.change(textarea, { target: { value: "New note content" } });
    });

    // Advance past the 600ms debounce and flush microtasks (async persist)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(mockUpdateSection).toHaveBeenCalledWith("personal", "New note content");

    vi.useRealTimers();
  });
});

describe("AgentSection", () => {
  const defaultProps = { source: "local" as const, issueId: "issue-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNotesData = {
      personal: { content: "" },
      aiContext: { content: "" },
      todos: [],
      gitPolicy: undefined,
      hookSkills: undefined,
    };
    mockHooksConfigData = null;
  });

  it("renders all agent tabs", () => {
    render(<AgentSection {...defaultProps} />);

    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("Todos")).toBeInTheDocument();
    expect(screen.getByText("Git Policy")).toBeInTheDocument();
    expect(screen.getByText("Hooks")).toBeInTheDocument();
  });

  it("renders the Agents heading", () => {
    render(<AgentSection {...defaultProps} />);

    expect(screen.getByText("Agents")).toBeInTheDocument();
  });

  it("shows Context tab content by default", () => {
    mockNotesData = {
      ...mockNotesData,
      aiContext: { content: "Agent context info" },
    };

    render(<AgentSection {...defaultProps} />);

    expect(screen.getByText("Agent context info")).toBeInTheDocument();
  });

  it("switches to Todos tab and shows todo list", () => {
    mockNotesData = {
      ...mockNotesData,
      todos: [
        { id: "t1", text: "Fix the bug", checked: false, createdAt: new Date().toISOString() },
      ],
    };

    render(<AgentSection {...defaultProps} />);

    act(() => {
      fireEvent.click(screen.getByText("Todos"));
    });

    expect(screen.getByText("Fix the bug")).toBeInTheDocument();
  });

  it("switches to Git Policy tab and shows policy controls", () => {
    render(<AgentSection {...defaultProps} />);

    act(() => {
      fireEvent.click(screen.getByText("Git Policy"));
    });

    expect(screen.getByText("Commits")).toBeInTheDocument();
    expect(screen.getByText("Pushes")).toBeInTheDocument();
    expect(screen.getByText("PRs")).toBeInTheDocument();
  });

  it("shows Inherit/Allow/Deny options in Git Policy", () => {
    render(<AgentSection {...defaultProps} />);

    act(() => {
      fireEvent.click(screen.getByText("Git Policy"));
    });

    // Each operation has Inherit/Allow/Deny — 3 operations x 3 options = 9
    expect(screen.getAllByText("Inherit")).toHaveLength(3);
    expect(screen.getAllByText("Allow")).toHaveLength(3);
    expect(screen.getAllByText("Deny")).toHaveLength(3);
  });

  it("calls updateGitPolicy when a policy option is clicked", () => {
    render(<AgentSection {...defaultProps} />);

    act(() => {
      fireEvent.click(screen.getByText("Git Policy"));
    });

    expect(screen.getByText("Commits")).toBeInTheDocument();

    // Click "Allow" for Commits (first Allow button)
    const allowButtons = screen.getAllByText("Allow");
    act(() => {
      fireEvent.click(allowButtons[0]);
    });

    expect(mockUpdateGitPolicy).toHaveBeenCalledWith({ agentCommits: "allow" });
  });

  it("switches to Hooks tab and shows empty hooks message", () => {
    mockHooksConfigData = null;

    render(<AgentSection {...defaultProps} />);

    act(() => {
      fireEvent.click(screen.getByText("Hooks"));
    });

    expect(screen.getByText(/No hooks configured/)).toBeInTheDocument();
  });

  it("switches to Hooks tab and shows configured hooks", () => {
    mockHooksConfigData = {
      steps: [
        {
          id: "step-1",
          name: "Run tests",
          command: "pnpm test",
          enabled: true,
          trigger: "post-implementation",
        },
      ],
      skills: [],
    };

    render(<AgentSection {...defaultProps} />);

    act(() => {
      fireEvent.click(screen.getByText("Hooks"));
    });

    expect(screen.getByText("Run tests")).toBeInTheDocument();
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
    expect(screen.getByText("Post-Implementation")).toBeInTheDocument();
  });

  it("shows Directions placeholder in Context tab when empty", () => {
    mockNotesData = {
      ...mockNotesData,
      aiContext: { content: "" },
    };

    render(<AgentSection {...defaultProps} />);

    expect(screen.getByText("Click to edit")).toBeInTheDocument();
  });

  it("debounces Context tab saves at 600ms", async () => {
    vi.useFakeTimers();
    mockNotesData = {
      ...mockNotesData,
      aiContext: { content: "" },
    };

    render(<AgentSection {...defaultProps} />);

    // Enter editing mode
    act(() => {
      fireEvent.click(screen.getByText("Click to edit"));
    });

    const textarea = screen.getByPlaceholderText("Directions for AI agents...");
    act(() => {
      fireEvent.change(textarea, { target: { value: "Agent instructions" } });
    });

    // Before debounce fires
    expect(mockUpdateSection).not.toHaveBeenCalled();

    // Advance past the 600ms debounce and flush microtasks (async persist)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(mockUpdateSection).toHaveBeenCalledWith("aiContext", "Agent instructions");

    vi.useRealTimers();
  });
});
