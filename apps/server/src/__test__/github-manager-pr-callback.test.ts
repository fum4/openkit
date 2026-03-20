/**
 * Tests for the onPrStateChange callback in GitHubManager.startPolling().
 * Verifies that terminal PR state transitions (open->merged, open->closed)
 * fire the callback, while cold starts (no previous state) do not.
 */
import { GitHubManager } from "@openkit/integrations/github/github-manager";
import * as ghClient from "@openkit/integrations/github/gh-client";

vi.mock("@openkit/integrations/github/gh-client");

describe("GitHubManager PR state change callback", () => {
  let manager: GitHubManager;
  const mockGetWorktrees = vi.fn();
  const mockOnUpdate = vi.fn();
  const mockOnPrStateChange = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    manager = new GitHubManager();

    // Make manager appear available by setting internal state
    Object.assign(manager, {
      installed: true,
      authenticated: true,
      config: { owner: "test", repo: "repo", defaultBranch: "main" },
    });

    // Mock getGitStatus to prevent pollGitStatus from interfering
    vi.mocked(ghClient.getGitStatus).mockResolvedValue({
      hasUncommitted: false,
      ahead: 0,
      behind: 0,
      noUpstream: false,
      aheadOfBase: 0,
      linesAdded: 0,
      linesRemoved: 0,
    });
  });

  afterEach(() => {
    manager.stopPolling();
    vi.useRealTimers();
  });

  it("calls onPrStateChange when PR transitions from open to merged", async () => {
    const worktree = { id: "feat-1", branch: "feat-1", status: "stopped" };
    mockGetWorktrees.mockReturnValue([worktree]);

    // First poll: PR is open
    vi.mocked(ghClient.findPRForBranch).mockResolvedValueOnce({
      url: "https://github.com/test/repo/pull/1",
      number: 1,
      state: "open",
      isDraft: false,
      title: "feat",
    });

    manager.startPolling(mockGetWorktrees, mockOnUpdate, mockOnPrStateChange);

    // Advance enough to trigger initial polls and settle
    await vi.advanceTimersByTimeAsync(100);

    expect(mockOnPrStateChange).not.toHaveBeenCalled();

    // Second poll: PR is merged
    vi.mocked(ghClient.findPRForBranch).mockResolvedValueOnce({
      url: "https://github.com/test/repo/pull/1",
      number: 1,
      state: "merged",
      isDraft: false,
      title: "feat",
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockOnPrStateChange).toHaveBeenCalledWith("feat-1", "open", "merged");
  });

  it("does NOT call onPrStateChange on cold start (no previous state)", async () => {
    const worktree = { id: "feat-1", branch: "feat-1", status: "stopped" };
    mockGetWorktrees.mockReturnValue([worktree]);

    // First poll: PR is already merged (cold start)
    vi.mocked(ghClient.findPRForBranch).mockResolvedValueOnce({
      url: "https://github.com/test/repo/pull/1",
      number: 1,
      state: "merged",
      isDraft: false,
      title: "feat",
    });

    manager.startPolling(mockGetWorktrees, mockOnUpdate, mockOnPrStateChange);

    // Advance enough to trigger initial polls and settle
    await vi.advanceTimersByTimeAsync(100);

    expect(mockOnPrStateChange).not.toHaveBeenCalled();
  });

  it("calls onPrStateChange when PR transitions from open to closed", async () => {
    const worktree = { id: "feat-2", branch: "feat-2", status: "stopped" };
    mockGetWorktrees.mockReturnValue([worktree]);

    // First poll: open
    vi.mocked(ghClient.findPRForBranch).mockResolvedValueOnce({
      url: "https://github.com/test/repo/pull/2",
      number: 2,
      state: "open",
      isDraft: false,
      title: "feat",
    });

    manager.startPolling(mockGetWorktrees, mockOnUpdate, mockOnPrStateChange);

    // Advance enough to trigger initial polls and settle
    await vi.advanceTimersByTimeAsync(100);

    // Second poll: closed
    vi.mocked(ghClient.findPRForBranch).mockResolvedValueOnce({
      url: "https://github.com/test/repo/pull/2",
      number: 2,
      state: "closed",
      isDraft: false,
      title: "feat",
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockOnPrStateChange).toHaveBeenCalledWith("feat-2", "open", "closed");
  });

  it("works without onPrStateChange callback (backwards compatible)", () => {
    mockGetWorktrees.mockReturnValue([]);

    // Should not throw
    expect(() => manager.startPolling(mockGetWorktrees, mockOnUpdate)).not.toThrow();
    manager.stopPolling();
  });
});
