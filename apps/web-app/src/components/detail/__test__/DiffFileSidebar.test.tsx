/**
 * Tests for the DiffFileSidebar component.
 *
 * Verifies file list rendering, status icons, line count badges,
 * folder grouping, and click handling.
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
});
