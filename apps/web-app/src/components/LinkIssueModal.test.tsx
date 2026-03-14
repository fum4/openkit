import { http, HttpResponse } from "msw";

import { server } from "../test/setup";
import { render, screen, userEvent, waitFor } from "../test/render";
import { LinkIssueModal } from "./LinkIssueModal";

// Helper: override /api/jira/issues at the MSW level (bypasses external Jira fetch)
function mockJiraIssuesHandler(
  issues: Array<{ key: string; summary: string; status?: string; priority?: string }>,
) {
  server.use(
    http.get("/api/jira/issues", () => {
      return HttpResponse.json({
        issues: issues.map((i) => ({
          key: i.key,
          summary: i.summary,
          status: i.status ?? "To Do",
          priority: i.priority ?? "Medium",
          type: "Task",
          assignee: null,
          url: `https://jira.example.com/browse/${i.key}`,
        })),
      });
    }),
  );
}

// Helper: override /api/linear/issues at the MSW level
function mockLinearIssuesHandler(
  issues: Array<{ identifier: string; title: string; status?: string; priority?: number }>,
) {
  server.use(
    http.get("/api/linear/issues", () => {
      return HttpResponse.json({
        issues: issues.map((i) => ({
          identifier: i.identifier,
          title: i.title,
          state: { name: i.status ?? "Todo" },
          priority: i.priority ?? 2,
          assignee: null,
          url: `https://linear.app/team/issue/${i.identifier}`,
        })),
      });
    }),
  );
}

describe("LinkIssueModal", () => {
  const defaultProps = {
    onClose: vi.fn(),
    onLink: vi.fn(async () => ({ success: true })),
    jiraConfigured: false,
    linearConfigured: false,
  };

  beforeEach(() => {
    defaultProps.onClose.mockClear();
    defaultProps.onLink.mockClear();
    defaultProps.onLink.mockResolvedValue({ success: true });
  });

  it("renders the modal with search input", async () => {
    render(<LinkIssueModal {...defaultProps} />);

    expect(screen.getByRole("heading", { name: "Link Issue" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search issues...")).toBeInTheDocument();
  });

  it("shows Local Tasks tab only when no integrations configured", async () => {
    render(<LinkIssueModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    expect(screen.queryByText("Jira")).not.toBeInTheDocument();
    expect(screen.queryByText("Linear")).not.toBeInTheDocument();
  });

  it("renders tabs when Jira is configured", async () => {
    mockJiraIssuesHandler([{ key: "TEST-1", summary: "Jira task one" }]);

    render(<LinkIssueModal {...defaultProps} jiraConfigured />);

    await waitFor(() => {
      expect(screen.getByText("Jira")).toBeInTheDocument();
    });
    expect(screen.getByText("Local Tasks")).toBeInTheDocument();
  });

  it("renders tabs when Linear is configured", async () => {
    mockLinearIssuesHandler([{ identifier: "ENG-1", title: "Linear task one" }]);

    render(<LinkIssueModal {...defaultProps} linearConfigured />);

    await waitFor(() => {
      expect(screen.getByText("Linear")).toBeInTheDocument();
    });
    expect(screen.getByText("Local Tasks")).toBeInTheDocument();
  });

  it("renders all three tabs when both integrations configured", async () => {
    mockJiraIssuesHandler([{ key: "TEST-1", summary: "Jira task" }]);
    mockLinearIssuesHandler([{ identifier: "ENG-1", title: "Linear task" }]);

    render(<LinkIssueModal {...defaultProps} jiraConfigured linearConfigured />);

    await waitFor(() => {
      expect(screen.getByText("Local Tasks")).toBeInTheDocument();
      expect(screen.getByText("Jira")).toBeInTheDocument();
      expect(screen.getByText("Linear")).toBeInTheDocument();
    });
  });

  it("shows Jira issues after switching to Jira tab", async () => {
    mockJiraIssuesHandler([
      { key: "TEST-1", summary: "Fix login bug" },
      { key: "TEST-2", summary: "Add dark mode" },
    ]);

    const user = userEvent.setup();

    render(<LinkIssueModal {...defaultProps} jiraConfigured />);

    await waitFor(() => {
      expect(screen.getByText("Jira")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Jira"));

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
      expect(screen.getByText("Add dark mode")).toBeInTheDocument();
    });
  });

  it("filters issues by search text", async () => {
    mockJiraIssuesHandler([
      { key: "TEST-1", summary: "Fix login bug" },
      { key: "TEST-2", summary: "Add dark mode" },
    ]);

    const user = userEvent.setup();

    render(<LinkIssueModal {...defaultProps} jiraConfigured />);

    await waitFor(() => {
      expect(screen.getByText("Jira")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Jira"));

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("Search issues..."), "dark");

    expect(screen.queryByText("Fix login bug")).not.toBeInTheDocument();
    expect(screen.getByText("Add dark mode")).toBeInTheDocument();
  });

  it("calls onLink when clicking a Jira issue", async () => {
    mockJiraIssuesHandler([{ key: "TEST-1", summary: "Fix login bug" }]);

    const user = userEvent.setup();

    render(<LinkIssueModal {...defaultProps} jiraConfigured />);

    await waitFor(() => {
      expect(screen.getByText("Jira")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Jira"));

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Fix login bug"));

    await waitFor(() => {
      expect(defaultProps.onLink).toHaveBeenCalledWith("jira", "TEST-1");
    });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("calls onLink when clicking a Linear issue", async () => {
    mockLinearIssuesHandler([{ identifier: "ENG-5", title: "Refactor API layer" }]);

    const user = userEvent.setup();

    render(<LinkIssueModal {...defaultProps} linearConfigured />);

    await waitFor(() => {
      expect(screen.getByText("Linear")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Linear"));

    await waitFor(() => {
      expect(screen.getByText("Refactor API layer")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Refactor API layer"));

    await waitFor(() => {
      expect(defaultProps.onLink).toHaveBeenCalledWith("linear", "ENG-5");
    });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("shows error when linking fails", async () => {
    mockJiraIssuesHandler([{ key: "TEST-1", summary: "Fix login bug" }]);
    defaultProps.onLink.mockResolvedValue({ success: false, error: "Link failed" } as any);

    const user = userEvent.setup();

    render(<LinkIssueModal {...defaultProps} jiraConfigured />);

    await waitFor(() => {
      expect(screen.getByText("Jira")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Jira"));

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Fix login bug"));

    await waitFor(() => {
      expect(screen.getByText("Link failed")).toBeInTheDocument();
    });
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("shows empty state message when no unlinked local tasks", async () => {
    render(<LinkIssueModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("No unlinked tasks available")).toBeInTheDocument();
    });
  });
});
