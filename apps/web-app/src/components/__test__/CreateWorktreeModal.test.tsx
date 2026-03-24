import { http, HttpResponse } from "msw";

import { server } from "../../__test__/setup";
import { render, screen, userEvent, waitFor } from "../../__test__/render";
import { CreateWorktreeModal } from "../CreateWorktreeModal";

describe("CreateWorktreeModal", () => {
  const defaultProps = {
    mode: "branch" as const,
    onCreated: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onCreated.mockClear();
    defaultProps.onClose.mockClear();
  });

  describe("branch mode", () => {
    it("renders the form with branch and name fields", () => {
      render(<CreateWorktreeModal {...defaultProps} />);

      expect(screen.getByRole("heading", { name: "Create Worktree" })).toBeInTheDocument();
      expect(screen.getByText("Branch name")).toBeInTheDocument();
      expect(screen.getByText("Worktree name")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("feat/my-feature")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Defaults to branch name")).toBeInTheDocument();
    });

    it("auto-derives worktree name from branch name, sanitizing invalid chars", async () => {
      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} />);

      await user.type(screen.getByPlaceholderText("feat/my-feature"), "feat/cool-feature");

      expect(screen.getByPlaceholderText("Defaults to branch name")).toHaveValue(
        "feat-cool-feature",
      );
    });

    it("stops auto-deriving name after manual edit", async () => {
      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} />);

      const nameInput = screen.getByPlaceholderText("Defaults to branch name");
      await user.type(nameInput, "custom-name");
      await user.clear(screen.getByPlaceholderText("feat/my-feature"));
      await user.type(screen.getByPlaceholderText("feat/my-feature"), "something-else");

      expect(nameInput).toHaveValue("custom-name");
    });

    it("disables Create button when branch is empty", () => {
      render(<CreateWorktreeModal {...defaultProps} />);

      expect(screen.getByRole("button", { name: "Create Worktree" })).toBeDisabled();
    });

    it("creates worktree and calls onCreated on successful submit", async () => {
      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} />);

      await user.type(screen.getByPlaceholderText("feat/my-feature"), "my-feature");
      await user.click(screen.getByRole("button", { name: "Create Worktree" }));

      await waitFor(() => {
        expect(defaultProps.onCreated).toHaveBeenCalledWith("my-feature");
      });
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it("shows loading state during creation", async () => {
      server.use(
        http.post("/api/worktrees", async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json({
            success: true,
            worktreeId: "test",
            worktree: { id: "test" },
          });
        }),
      );

      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} />);

      await user.type(screen.getByPlaceholderText("feat/my-feature"), "test");
      await user.click(screen.getByRole("button", { name: "Create Worktree" }));

      // Form inputs should be disabled during creation
      expect(screen.getByPlaceholderText("feat/my-feature")).toBeDisabled();

      await waitFor(() => {
        expect(defaultProps.onCreated).toHaveBeenCalled();
      });
    });

    it("displays error when creation fails", async () => {
      server.use(
        http.post("/api/worktrees", () => {
          return HttpResponse.json({
            success: false,
            error: "Branch already exists",
          });
        }),
      );

      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} />);

      await user.type(screen.getByPlaceholderText("feat/my-feature"), "existing");
      await user.click(screen.getByRole("button", { name: "Create Worktree" }));

      await waitFor(() => {
        expect(screen.getByText("Branch already exists")).toBeInTheDocument();
      });
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });

    it("clears error when worktree name input is edited", async () => {
      server.use(
        http.post("/api/worktrees", () => {
          return HttpResponse.json({
            success: false,
            error: "Worktree name must start with a letter",
          });
        }),
      );

      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} />);

      await user.type(screen.getByPlaceholderText("feat/my-feature"), "test");
      await user.click(screen.getByRole("button", { name: "Create Worktree" }));

      await waitFor(() => {
        expect(screen.getByText("Worktree name must start with a letter")).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText("Defaults to branch name"), "valid-name");

      expect(screen.queryByText("Worktree name must start with a letter")).not.toBeInTheDocument();
    });

    it("calls onClose when Cancel is clicked", async () => {
      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    it("calls onSetupNeeded when error mentions no commits", async () => {
      const onSetupNeeded = vi.fn();
      server.use(
        http.post("/api/worktrees", () => {
          return HttpResponse.json({
            success: false,
            error: "no commits yet on the branch",
          });
        }),
      );

      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} onSetupNeeded={onSetupNeeded} />);

      await user.type(screen.getByPlaceholderText("feat/my-feature"), "test");
      await user.click(screen.getByRole("button", { name: "Create Worktree" }));

      await waitFor(() => {
        expect(onSetupNeeded).toHaveBeenCalled();
      });
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe("jira mode", () => {
    it("renders Jira-specific form", () => {
      render(<CreateWorktreeModal {...defaultProps} mode="jira" />);

      expect(screen.getByText("Pull from Jira")).toBeInTheDocument();
      expect(screen.getByText("Task ID")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("PROJ-123")).toBeInTheDocument();
    });

    it("disables submit when task ID is empty", () => {
      render(<CreateWorktreeModal {...defaultProps} mode="jira" />);

      expect(screen.getByRole("button", { name: "Pull & Create" })).toBeDisabled();
    });

    it("auto-fills branch from task ID when no branch name rule", async () => {
      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} mode="jira" hasBranchNameRule={false} />);

      await user.type(screen.getByPlaceholderText("PROJ-123"), "PROJ-123");

      expect(screen.getByPlaceholderText("Defaults to task ID")).toHaveValue("PROJ-123");
    });

    it("leaves branch empty when branch name rule exists", async () => {
      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} mode="jira" hasBranchNameRule />);

      await user.type(screen.getByPlaceholderText("PROJ-123"), "PROJ-123");

      expect(screen.getByPlaceholderText("Leave empty to auto-generate")).toHaveValue("");
      expect(
        screen.getByText("Branch name will be generated from issue details"),
      ).toBeInTheDocument();
    });
  });

  describe("linear mode", () => {
    it("renders Linear-specific form", () => {
      render(<CreateWorktreeModal {...defaultProps} mode="linear" />);

      expect(screen.getByText("Pull from Linear")).toBeInTheDocument();
      expect(screen.getByText("Issue ID")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("ENG-123")).toBeInTheDocument();
    });

    it("auto-fills branch from issue ID when no branch name rule", async () => {
      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} mode="linear" hasBranchNameRule={false} />);

      await user.type(screen.getByPlaceholderText("ENG-123"), "ENG-456");

      expect(screen.getByPlaceholderText("Defaults to issue ID")).toHaveValue("ENG-456");
    });
  });

  describe("worktree exists recovery", () => {
    it("shows recovery modal when worktree already exists", async () => {
      server.use(
        http.post("/api/worktrees", () => {
          return HttpResponse.json({
            success: false,
            code: "WORKTREE_EXISTS",
            worktreeId: "existing-wt",
            error: "Worktree already exists",
          });
        }),
      );

      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} />);

      await user.type(screen.getByPlaceholderText("feat/my-feature"), "existing");
      await user.click(screen.getByRole("button", { name: "Create Worktree" }));

      await waitFor(() => {
        expect(screen.getByText(/already has a worktree/i)).toBeInTheDocument();
      });
    });

    it("shows reuse and recreate options in recovery modal", async () => {
      server.use(
        http.post("/api/worktrees", () => {
          return HttpResponse.json({
            success: false,
            code: "WORKTREE_EXISTS",
            worktreeId: "existing-wt",
            error: "Worktree already exists",
          });
        }),
      );

      const user = userEvent.setup();

      render(<CreateWorktreeModal {...defaultProps} />);

      await user.type(screen.getByPlaceholderText("feat/my-feature"), "existing");
      await user.click(screen.getByRole("button", { name: "Create Worktree" }));

      await waitFor(() => {
        expect(screen.getByText("Reuse existing")).toBeInTheDocument();
        expect(screen.getByText("Delete and recreate")).toBeInTheDocument();
      });
    });
  });
});
