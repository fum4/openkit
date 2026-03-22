/**
 * Tests for the DiffFileSidebar component.
 *
 * Verifies file list rendering, status icons, line count badges,
 * folder grouping, click handling, and staged/unstaged section splits
 * with stage/unstage actions.
 */
import { render, screen, userEvent } from "../../../__test__/render";
import { DiffFileSidebar } from "../DiffFileSidebar";
import type { DiffFileInfo } from "../../../types";

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

describe("DiffFileSidebar", () => {
  const defaultProps = {
    files: [] as DiffFileInfo[],
    selectedFile: null as string | null,
    onSelectFile: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders file list with correct status labels", () => {
    const files = [
      makeFile({ path: "src/modified.ts", status: "modified" }),
      makeFile({ path: "src/added.ts", status: "added", linesRemoved: 0 }),
      makeFile({ path: "src/deleted.ts", status: "deleted", linesAdded: 0 }),
      makeFile({ path: "src/untracked.ts", status: "untracked", linesRemoved: 0 }),
    ];

    render(<DiffFileSidebar {...defaultProps} files={files} />);

    expect(screen.getByTitle("modified")).toHaveTextContent("M");
    expect(screen.getByTitle("added")).toHaveTextContent("A");
    expect(screen.getByTitle("deleted")).toHaveTextContent("D");
    expect(screen.getByTitle("untracked")).toHaveTextContent("U");
  });

  it("shows line count badges for non-binary files", () => {
    const files = [
      makeFile({ path: "src/app.ts", linesAdded: 15, linesRemoved: 7, isBinary: false }),
    ];

    render(<DiffFileSidebar {...defaultProps} files={files} />);

    expect(screen.getByText("+15")).toBeInTheDocument();
    expect(screen.getByText("-7")).toBeInTheDocument();
  });

  it("hides line count badges for binary files", () => {
    const files = [makeFile({ path: "image.png", linesAdded: 0, linesRemoved: 0, isBinary: true })];

    render(<DiffFileSidebar {...defaultProps} files={files} />);

    expect(screen.queryByText("+0")).not.toBeInTheDocument();
    expect(screen.queryByText("-0")).not.toBeInTheDocument();
  });

  it("calls onSelectFile when a file is clicked", async () => {
    const onSelectFile = vi.fn();
    const user = userEvent.setup();
    const files = [makeFile({ path: "src/app.ts" })];

    render(<DiffFileSidebar {...defaultProps} files={files} onSelectFile={onSelectFile} />);

    await user.click(screen.getByText("app.ts"));

    expect(onSelectFile).toHaveBeenCalledWith("src/app.ts");
  });

  it("groups files under folder headers", () => {
    const files = [
      makeFile({ path: "src/components/Button.tsx" }),
      makeFile({ path: "src/components/Modal.tsx" }),
      makeFile({ path: "lib/utils.ts" }),
    ];

    render(<DiffFileSidebar {...defaultProps} files={files} />);

    // Folder headers should be visible
    expect(screen.getByText("src/components")).toBeInTheDocument();
    expect(screen.getByText("lib")).toBeInTheDocument();
    // File names should be visible (just the filename, not the full path)
    expect(screen.getByText("Button.tsx")).toBeInTheDocument();
    expect(screen.getByText("Modal.tsx")).toBeInTheDocument();
    expect(screen.getByText("utils.ts")).toBeInTheDocument();
  });

  it("collapses folder when folder header is clicked", async () => {
    const user = userEvent.setup();
    const files = [makeFile({ path: "src/app.ts" }), makeFile({ path: "src/index.ts" })];

    render(<DiffFileSidebar {...defaultProps} files={files} />);

    expect(screen.getByText("app.ts")).toBeInTheDocument();

    await user.click(screen.getByText("src"));

    expect(screen.queryByText("app.ts")).not.toBeInTheDocument();
  });

  describe("staging sections", () => {
    const stagedFile = makeFile({ path: "src/staged.ts", staged: true });
    const unstagedFile = makeFile({ path: "src/unstaged.ts", staged: false });

    it("renders flat list when showStagingActions is false", () => {
      const files = [stagedFile, unstagedFile];

      render(<DiffFileSidebar {...defaultProps} files={files} showStagingActions={false} />);

      expect(screen.queryByText(/staged changes/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^changes/i)).not.toBeInTheDocument();
      expect(screen.getByText("staged.ts")).toBeInTheDocument();
      expect(screen.getByText("unstaged.ts")).toBeInTheDocument();
    });

    it("renders flat list when showStagingActions is omitted", () => {
      const files = [stagedFile, unstagedFile];

      render(<DiffFileSidebar {...defaultProps} files={files} />);

      expect(screen.queryByText(/staged changes/i)).not.toBeInTheDocument();
      expect(screen.getByText("staged.ts")).toBeInTheDocument();
      expect(screen.getByText("unstaged.ts")).toBeInTheDocument();
    });

    it("shows staged files under Staged Changes section", () => {
      const files = [stagedFile, unstagedFile];

      render(<DiffFileSidebar {...defaultProps} files={files} showStagingActions />);

      expect(screen.getByText(/staged changes \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText("staged.ts")).toBeInTheDocument();
    });

    it("shows unstaged files under Changes section", () => {
      const files = [stagedFile, unstagedFile];

      render(<DiffFileSidebar {...defaultProps} files={files} showStagingActions />);

      expect(screen.getByText(/^changes \(1\)$/i)).toBeInTheDocument();
      expect(screen.getByText("unstaged.ts")).toBeInTheDocument();
    });

    it("omits Staged Changes section when there are no staged files", () => {
      const files = [unstagedFile];

      render(<DiffFileSidebar {...defaultProps} files={files} showStagingActions />);

      expect(screen.queryByText(/staged changes/i)).not.toBeInTheDocument();
      expect(screen.getByText(/^changes \(1\)$/i)).toBeInTheDocument();
    });

    it("calls onStageAll when Stage all button is clicked", async () => {
      const onStageAll = vi.fn();
      const user = userEvent.setup();
      const files = [unstagedFile];

      render(
        <DiffFileSidebar
          {...defaultProps}
          files={files}
          showStagingActions
          onStageAll={onStageAll}
        />,
      );

      await user.click(screen.getByTitle("Stage all"));

      expect(onStageAll).toHaveBeenCalledTimes(1);
    });

    it("calls onUnstageFile when unstage button is clicked for a staged file", async () => {
      const onUnstageFile = vi.fn();
      const user = userEvent.setup();
      const files = [stagedFile];

      render(
        <DiffFileSidebar
          {...defaultProps}
          files={files}
          showStagingActions
          onUnstageFile={onUnstageFile}
        />,
      );

      await user.click(screen.getByTitle("Unstage"));

      expect(onUnstageFile).toHaveBeenCalledWith(stagedFile.path);
    });

    it("calls onStageFile when stage button is clicked for an unstaged file", async () => {
      const onStageFile = vi.fn();
      const user = userEvent.setup();
      const files = [unstagedFile];

      render(
        <DiffFileSidebar
          {...defaultProps}
          files={files}
          showStagingActions
          onStageFile={onStageFile}
        />,
      );

      await user.click(screen.getByTitle("Stage"));

      expect(onStageFile).toHaveBeenCalledWith(unstagedFile.path);
    });

    it("does not call onSelectFile when stage/unstage button is clicked", async () => {
      const onSelectFile = vi.fn();
      const onStageFile = vi.fn();
      const user = userEvent.setup();
      const files = [unstagedFile];

      render(
        <DiffFileSidebar
          files={files}
          selectedFile={null}
          onSelectFile={onSelectFile}
          showStagingActions
          onStageFile={onStageFile}
        />,
      );

      await user.click(screen.getByTitle("Stage"));

      expect(onStageFile).toHaveBeenCalledTimes(1);
      expect(onSelectFile).not.toHaveBeenCalled();
    });
  });
});
