/**
 * Tests for the DiffFileSection component.
 *
 * Verifies header rendering, expand/collapse behavior, binary file
 * placeholder, and lazy content fetching.
 */
import { render, screen, userEvent, waitFor } from "../../../__test__/render";
import { DiffFileSection } from "../DiffFileSection";
import type { DiffFileInfo } from "../../../types";

// Mock the Monaco editor (heavy dependency)
vi.mock("../DiffMonacoEditor", () => ({
  DiffMonacoEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="diff-monaco-editor">
      <span data-testid="original-content">{original}</span>
      <span data-testid="modified-content">{modified}</span>
    </div>
  ),
}));

vi.mock("../../../logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock the API call
const mockFetchDiffFileContent = vi.fn();
vi.mock("../../../hooks/api", () => ({
  fetchDiffFileContent: (...args: unknown[]) => mockFetchDiffFileContent(...args),
}));

function makeFile(overrides: Partial<DiffFileInfo> = {}): DiffFileInfo {
  return {
    path: "src/app.ts",
    status: "modified",
    linesAdded: 10,
    linesRemoved: 3,
    isBinary: false,
    ...overrides,
  };
}

describe("DiffFileSection", () => {
  const defaultProps = {
    file: makeFile(),
    expanded: false,
    onToggle: vi.fn(),
    viewMode: "unified" as const,
    worktreeId: "test-1",
    includeCommitted: false,
    refreshKey: 0,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchDiffFileContent.mockResolvedValue({
      success: true,
      oldContent: "old code",
      newContent: "new code",
    });
  });

  it("renders header with file path and stats", () => {
    render(<DiffFileSection {...defaultProps} />);

    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("+10")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
  });

  it("does not render editor when collapsed", () => {
    render(<DiffFileSection {...defaultProps} expanded={false} />);

    expect(screen.queryByTestId("diff-monaco-editor")).not.toBeInTheDocument();
  });

  it("calls onToggle when header is clicked", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();

    render(<DiffFileSection {...defaultProps} onToggle={onToggle} />);

    await user.click(screen.getByText("src/app.ts"));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("fetches content and renders editor when expanded", async () => {
    render(<DiffFileSection {...defaultProps} expanded />);

    await waitFor(() => {
      expect(screen.getByTestId("diff-monaco-editor")).toBeInTheDocument();
    });

    expect(mockFetchDiffFileContent).toHaveBeenCalledWith(
      "test-1",
      "src/app.ts",
      "modified",
      false,
      undefined,
      null,
      undefined,
    );
    expect(screen.getByTestId("original-content")).toHaveTextContent("old code");
    expect(screen.getByTestId("modified-content")).toHaveTextContent("new code");
  });

  it("shows binary file placeholder when file is binary", () => {
    render(<DiffFileSection {...defaultProps} expanded file={makeFile({ isBinary: true })} />);

    expect(screen.getByText(/Binary file/)).toBeInTheDocument();
    expect(screen.queryByTestId("diff-monaco-editor")).not.toBeInTheDocument();
  });

  it("shows error message when content fetch fails", async () => {
    mockFetchDiffFileContent.mockResolvedValue({
      success: false,
      oldContent: "",
      newContent: "",
      error: "Git command failed",
    });

    render(<DiffFileSection {...defaultProps} expanded />);

    await waitFor(() => {
      expect(screen.getByText("Git command failed")).toBeInTheDocument();
    });
  });

  it("renders editor for empty file content (e.g. empty new file)", async () => {
    mockFetchDiffFileContent.mockResolvedValue({
      success: true,
      oldContent: "",
      newContent: "",
    });

    render(<DiffFileSection {...defaultProps} expanded file={makeFile({ status: "added" })} />);

    await waitFor(() => {
      expect(screen.getByTestId("diff-monaco-editor")).toBeInTheDocument();
    });
  });
});
