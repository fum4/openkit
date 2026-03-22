/**
 * Tests for the DiffViewerTab component.
 *
 * Verifies loading/empty/error states, file list rendering,
 * view mode toggle, include-committed toggle, and refresh behavior.
 */
import { render, screen, userEvent, waitFor } from "../../../__test__/render";
import { DiffViewerTab } from "../DiffViewerTab";
import type { DiffFileInfo, WorktreeInfo } from "../../../types";

// Mock heavy sub-components
vi.mock("../DiffFileSection", () => ({
  DiffFileSection: ({ file, expanded }: { file: DiffFileInfo; expanded: boolean }) => (
    <div data-testid={`file-section-${file.path}`}>
      <span data-testid="file-path">{file.path}</span>
      <span data-testid="expanded">{String(expanded)}</span>
    </div>
  ),
}));

vi.mock("../DiffFileSidebar", () => ({
  DiffFileSidebar: ({
    files,
    onSelectFile,
  }: {
    files: DiffFileInfo[];
    selectedFile: string | null;
    onSelectFile: (path: string) => void;
  }) => (
    <div data-testid="diff-sidebar">
      {files.map((f) => (
        <button key={f.path} data-testid={`sidebar-${f.path}`} onClick={() => onSelectFile(f.path)}>
          {f.path}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../../../logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockFetchDiffFiles = vi.fn();
const mockFetchPrDiffFiles = vi.fn();
const mockFetchPrDiffFileContent = vi.fn();
vi.mock("../../../hooks/api", () => ({
  fetchDiffFiles: (...args: unknown[]) => mockFetchDiffFiles(...args),
  fetchPrDiffFiles: (...args: unknown[]) => mockFetchPrDiffFiles(...args),
  fetchPrDiffFileContent: (...args: unknown[]) => mockFetchPrDiffFileContent(...args),
}));

function makeWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id: "test-1",
    path: "/fake/worktree",
    branch: "feature-branch",
    status: "running",
    ports: [3000],
    offset: 0,
    pid: 1234,
    hasUncommitted: true,
    ...overrides,
  };
}

const sampleFiles: DiffFileInfo[] = [
  { path: "src/app.ts", status: "modified", linesAdded: 10, linesRemoved: 3, isBinary: false },
  { path: "src/new.ts", status: "added", linesAdded: 20, linesRemoved: 0, isBinary: false },
];

describe("DiffViewerTab", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchDiffFiles.mockResolvedValue({
      success: true,
      files: sampleFiles,
      baseBranch: "main",
    });
    mockFetchPrDiffFiles.mockResolvedValue({
      success: true,
      files: [],
      baseBranch: "",
      baseSha: "",
      mergeSha: "",
    });
    mockFetchPrDiffFileContent.mockResolvedValue(null);
  });

  it("shows loading state while fetching", () => {
    // Never resolve the fetch
    mockFetchDiffFiles.mockReturnValue(new Promise(() => {}));

    render(<DiffViewerTab worktree={makeWorktree()} visible />);

    expect(screen.getByText(/Loading changes/)).toBeInTheDocument();
  });

  it("shows empty state when no files", async () => {
    mockFetchDiffFiles.mockResolvedValue({
      success: true,
      files: [],
      baseBranch: "main",
    });

    render(<DiffViewerTab worktree={makeWorktree()} visible />);

    await waitFor(() => {
      expect(screen.getByText(/No changes detected/)).toBeInTheDocument();
    });
  });

  it("displays file list from API response", async () => {
    render(<DiffViewerTab worktree={makeWorktree()} visible />);

    await waitFor(() => {
      expect(screen.getByTestId("file-section-src/app.ts")).toBeInTheDocument();
      expect(screen.getByTestId("file-section-src/new.ts")).toBeInTheDocument();
    });
  });

  it("shows file count and total stats", async () => {
    render(<DiffViewerTab worktree={makeWorktree()} visible />);

    await waitFor(() => {
      expect(screen.getByText("2 files changed")).toBeInTheDocument();
      expect(screen.getByText("+30")).toBeInTheDocument();
      expect(screen.getByText("-3")).toBeInTheDocument();
    });
  });

  it("does not render when not visible", () => {
    render(<DiffViewerTab worktree={makeWorktree()} visible={false} />);

    expect(screen.queryByText(/Loading changes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No changes detected/)).not.toBeInTheDocument();
  });

  it("auto-expands files when count is below threshold", async () => {
    render(<DiffViewerTab worktree={makeWorktree()} visible />);

    await waitFor(() => {
      const section = screen.getByTestId("file-section-src/app.ts");
      expect(section.querySelector('[data-testid="expanded"]')?.textContent).toBe("true");
    });
  });

  it("shows error state on fetch failure", async () => {
    mockFetchDiffFiles.mockResolvedValue({
      success: false,
      files: [],
      baseBranch: "",
      error: "Git not available",
    });

    render(<DiffViewerTab worktree={makeWorktree()} visible />);

    await waitFor(() => {
      expect(screen.getByText("Git not available")).toBeInTheDocument();
    });
  });

  it("re-fetches when refresh button is clicked", async () => {
    const user = userEvent.setup();

    render(<DiffViewerTab worktree={makeWorktree()} visible />);

    await waitFor(() => {
      expect(screen.getByTestId("file-section-src/app.ts")).toBeInTheDocument();
    });

    const callsBefore = mockFetchDiffFiles.mock.calls.length;

    await user.click(screen.getByLabelText("Refresh"));

    await waitFor(() => {
      expect(mockFetchDiffFiles.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it("renders sidebar with file list", async () => {
    render(<DiffViewerTab worktree={makeWorktree()} visible />);

    await waitFor(() => {
      expect(screen.getByTestId("diff-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("sidebar-src/app.ts")).toBeInTheDocument();
    });
  });

  describe("merged PR diff", () => {
    // hasUncommitted: true so the smart default doesn't auto-enable Merged
    const mergedWorktree = makeWorktree({
      githubPrState: "merged",
      githubPrUrl: "https://github.com/owner/repo/pull/42",
      hasUncommitted: true,
    });

    const prDiffResponse = {
      success: true,
      files: sampleFiles,
      baseBranch: "main",
      baseSha: "abc123",
      mergeSha: "def456",
      headSha: "head789",
      localHeadSha: "head789",
    };

    beforeEach(() => {
      mockFetchDiffFiles.mockClear();
      mockFetchPrDiffFiles.mockResolvedValue(prDiffResponse);
    });

    it("shows Merged toggle for merged worktrees", async () => {
      render(<DiffViewerTab worktree={mergedWorktree} visible />);

      await waitFor(() => {
        expect(screen.getByText("Show merged")).toBeInTheDocument();
      });
    });

    it("shows local diff by default for merged worktrees", async () => {
      render(<DiffViewerTab worktree={mergedWorktree} visible />);

      await waitFor(() => {
        expect(screen.getByTestId("file-section-src/app.ts")).toBeInTheDocument();
      });

      expect(mockFetchDiffFiles).toHaveBeenCalled();
    });

    it("switches to PR diff when Merged toggle is clicked", async () => {
      const user = userEvent.setup();
      render(<DiffViewerTab worktree={mergedWorktree} visible />);

      await waitFor(() => {
        expect(screen.getByText("Show merged")).toBeInTheDocument();
      });

      const mergedLabel = screen.getByText("Show merged");
      const toggleContainer = mergedLabel.parentElement!;
      const toggle = toggleContainer.querySelector("button")!;
      await user.click(toggle);

      await waitFor(() => {
        expect(mockFetchPrDiffFiles).toHaveBeenCalledWith(mergedWorktree.id, null);
      });
    });

    it("hides Committed toggle for merged worktrees with no post-merge commits", async () => {
      // headSha === localHeadSha → no new commits after merge
      render(<DiffViewerTab worktree={mergedWorktree} visible />);

      await waitFor(() => {
        expect(screen.getByText("Show merged")).toBeInTheDocument();
      });

      // Committed should be hidden (no new commits after merge)
      expect(screen.queryByText("Show committed")).not.toBeInTheDocument();
    });

    it("shows Committed toggle when there are post-merge commits", async () => {
      mockFetchPrDiffFiles.mockResolvedValue({
        ...prDiffResponse,
        localHeadSha: "different-sha",
      });

      render(<DiffViewerTab worktree={mergedWorktree} visible />);

      await waitFor(() => {
        expect(screen.getByText("Show committed")).toBeInTheDocument();
      });
    });

    it("does not show Merged toggle for non-merged worktrees", () => {
      render(<DiffViewerTab worktree={makeWorktree()} visible />);

      expect(screen.queryByText("Show merged")).not.toBeInTheDocument();
    });
  });
});
