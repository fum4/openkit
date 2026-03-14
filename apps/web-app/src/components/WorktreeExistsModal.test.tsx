import { http, HttpResponse } from "msw";

import { server } from "../test/setup";
import { render, screen, userEvent, waitFor } from "../test/render";
import { WorktreeExistsModal } from "./WorktreeExistsModal";

describe("WorktreeExistsModal", () => {
  const defaultProps = {
    worktreeId: "my-feature",
    branch: "my-feature",
    onResolved: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onResolved.mockClear();
    defaultProps.onCancel.mockClear();
  });

  it("renders worktree information and action buttons", () => {
    render(<WorktreeExistsModal {...defaultProps} />);

    expect(screen.getByRole("heading", { name: "Worktree exists" })).toBeInTheDocument();
    expect(screen.getByText("my-feature")).toBeInTheDocument();
    expect(screen.getByText(/already has a worktree/)).toBeInTheDocument();
    expect(screen.getByText("Reuse existing")).toBeInTheDocument();
    expect(screen.getByText("Delete and recreate")).toBeInTheDocument();
  });

  it("calls onResolved with reuse after successful reuse", async () => {
    const user = userEvent.setup();

    render(<WorktreeExistsModal {...defaultProps} />);

    await user.click(screen.getByText("Reuse existing"));

    await waitFor(() => {
      expect(defaultProps.onResolved).toHaveBeenCalledWith("reuse");
    });
  });

  it("calls onResolved with recreate after successful recreate", async () => {
    const user = userEvent.setup();

    render(<WorktreeExistsModal {...defaultProps} />);

    await user.click(screen.getByText("Delete and recreate"));

    await waitFor(() => {
      expect(defaultProps.onResolved).toHaveBeenCalledWith("recreate");
    });
  });

  it("shows loading state during reuse operation", async () => {
    server.use(
      http.post("/api/worktrees/:id/recover", async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json({ success: true });
      }),
    );

    const user = userEvent.setup();

    render(<WorktreeExistsModal {...defaultProps} />);

    await user.click(screen.getByText("Reuse existing"));

    // Both action buttons and cancel should be disabled during loading
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await waitFor(() => {
      expect(defaultProps.onResolved).toHaveBeenCalledWith("reuse");
    });
  });

  it("displays error toast on reuse failure", async () => {
    server.use(
      http.post("/api/worktrees/:id/recover", () => {
        return HttpResponse.json({ success: false, error: "Disk full" });
      }),
    );

    const user = userEvent.setup();

    render(<WorktreeExistsModal {...defaultProps} />);

    await user.click(screen.getByText("Reuse existing"));

    await waitFor(() => {
      expect(defaultProps.onResolved).not.toHaveBeenCalled();
    });
  });

  it("displays error toast on recreate failure", async () => {
    server.use(
      http.post("/api/worktrees/:id/recover", () => {
        return HttpResponse.json({ success: false, error: "Cannot recreate" });
      }),
    );

    const user = userEvent.setup();

    render(<WorktreeExistsModal {...defaultProps} />);

    await user.click(screen.getByText("Delete and recreate"));

    await waitFor(() => {
      expect(defaultProps.onResolved).not.toHaveBeenCalled();
    });
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();

    render(<WorktreeExistsModal {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(defaultProps.onCancel).toHaveBeenCalledOnce();
  });
});
