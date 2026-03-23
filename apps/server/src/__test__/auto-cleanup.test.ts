/**
 * Tests for WorktreeManager.handlePrStateChange — the auto-cleanup logic
 * that removes worktrees when their associated PR is merged or closed.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(""),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  rmSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn().mockReturnValue({ size: 0 }),
  watch: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn().mockReturnValue(""),
  spawn: vi.fn(),
}));

vi.mock("../logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    plain: vi.fn(),
    get: vi.fn(() => mockLogger),
  };
  return { log: mockLogger };
});

vi.mock("../local-config", () => ({
  loadLocalConfig: vi.fn().mockReturnValue({}),
  loadLocalGitPolicyConfig: vi.fn().mockReturnValue({
    allowAgentCommits: false,
    allowAgentPushes: false,
    allowAgentPRs: false,
  }),
  updateLocalConfig: vi.fn(),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-id"),
}));

vi.mock("../worktree-settings", () => ({
  loadWorktreeSettings: vi.fn().mockReturnValue({}),
  deleteWorktreeSettings: vi.fn(),
  updateWorktreeSettings: vi.fn(),
}));

import type { GitStatusInfo } from "@openkit/integrations/github/types";
import { ACTIVITY_TYPES } from "../activity-event";
import { WorktreeManager } from "../manager";
import { createTestConfig } from "./fixtures";

function createManager(configOverrides: Record<string, unknown> = {}): WorktreeManager {
  const config = createTestConfig({
    autoCleanupOnPrMerge: false,
    autoCleanupOnPrClose: false,
    ...configOverrides,
  });
  return new WorktreeManager(config);
}

function makeGitStatus(overrides: Partial<GitStatusInfo> = {}): GitStatusInfo {
  return {
    hasUncommitted: false,
    ahead: 0,
    behind: 0,
    noUpstream: false,
    aheadOfBase: 0,
    linesAdded: 0,
    linesRemoved: 0,
    ...overrides,
  };
}

describe("handlePrStateChange", () => {
  let manager: WorktreeManager;
  let mockAddEvent: ReturnType<typeof vi.fn>;
  let mockGetCachedGitStatus: ReturnType<typeof vi.fn>;
  let mockRemoveWorktree: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createManager();

    mockAddEvent = vi.fn();
    mockGetCachedGitStatus = vi.fn();
    mockRemoveWorktree = vi.fn().mockResolvedValue({ success: true });

    (manager as any).activityLog = { addEvent: mockAddEvent };
    (manager as any).githubManager = { getCachedGitStatus: mockGetCachedGitStatus };
    (manager as any).removeWorktree = mockRemoveWorktree;
  });

  it("does nothing when autoCleanupOnPrMerge is false and PR is merged", async () => {
    manager.getConfig = vi.fn().mockReturnValue({
      autoCleanupOnPrMerge: false,
      autoCleanupOnPrClose: true,
    });

    await (manager as any).handlePrStateChange("wt-1", "open", "merged");

    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(mockAddEvent).not.toHaveBeenCalled();
  });

  it("does nothing when autoCleanupOnPrClose is false and PR is closed", async () => {
    manager.getConfig = vi.fn().mockReturnValue({
      autoCleanupOnPrMerge: true,
      autoCleanupOnPrClose: false,
    });

    await (manager as any).handlePrStateChange("wt-1", "open", "closed");

    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(mockAddEvent).not.toHaveBeenCalled();
  });

  it("skips cleanup and emits warning when worktree has uncommitted changes", async () => {
    manager.getConfig = vi.fn().mockReturnValue({
      autoCleanupOnPrMerge: true,
      autoCleanupOnPrClose: true,
    });
    mockGetCachedGitStatus.mockReturnValue(makeGitStatus({ hasUncommitted: true }));

    await (manager as any).handlePrStateChange("wt-1", "open", "merged");

    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(mockAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ACTIVITY_TYPES.AUTO_CLEANUP_SKIPPED,
        severity: "warning",
        worktreeId: "wt-1",
      }),
    );
  });

  it("skips cleanup when worktree has unpushed commits (ahead > 0)", async () => {
    manager.getConfig = vi.fn().mockReturnValue({
      autoCleanupOnPrMerge: true,
      autoCleanupOnPrClose: true,
    });
    mockGetCachedGitStatus.mockReturnValue(makeGitStatus({ ahead: 3 }));

    await (manager as any).handlePrStateChange("wt-1", "open", "merged");

    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(mockAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ACTIVITY_TYPES.AUTO_CLEANUP_SKIPPED,
        severity: "warning",
      }),
    );
  });

  it("skips cleanup when worktree has no upstream", async () => {
    manager.getConfig = vi.fn().mockReturnValue({
      autoCleanupOnPrMerge: true,
      autoCleanupOnPrClose: true,
    });
    mockGetCachedGitStatus.mockReturnValue(makeGitStatus({ noUpstream: true }));

    await (manager as any).handlePrStateChange("wt-1", "open", "closed");

    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(mockAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ACTIVITY_TYPES.AUTO_CLEANUP_SKIPPED,
        severity: "warning",
        detail: expect.stringContaining("closed"),
      }),
    );
  });

  it("calls removeWorktree and emits info event when worktree is clean", async () => {
    manager.getConfig = vi.fn().mockReturnValue({
      autoCleanupOnPrMerge: true,
      autoCleanupOnPrClose: true,
    });
    mockGetCachedGitStatus.mockReturnValue(makeGitStatus());

    await (manager as any).handlePrStateChange("wt-1", "open", "merged");

    expect(mockRemoveWorktree).toHaveBeenCalledWith("wt-1");
    expect(mockAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ACTIVITY_TYPES.AUTO_CLEANUP,
        severity: "info",
        title: "Worktree auto-deleted",
        detail: expect.stringContaining("merged"),
        worktreeId: "wt-1",
      }),
    );
  });

  it("proceeds with cleanup when git status is not cached", async () => {
    manager.getConfig = vi.fn().mockReturnValue({
      autoCleanupOnPrMerge: true,
      autoCleanupOnPrClose: true,
    });
    mockGetCachedGitStatus.mockReturnValue(undefined);

    await (manager as any).handlePrStateChange("wt-1", "open", "merged");

    expect(mockRemoveWorktree).toHaveBeenCalledWith("wt-1");
    expect(mockAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ACTIVITY_TYPES.AUTO_CLEANUP,
        severity: "info",
      }),
    );
  });

  it("logs warning when removeWorktree fails", async () => {
    manager.getConfig = vi.fn().mockReturnValue({
      autoCleanupOnPrMerge: true,
      autoCleanupOnPrClose: true,
    });
    mockGetCachedGitStatus.mockReturnValue(makeGitStatus());
    mockRemoveWorktree.mockResolvedValue({ success: false, error: "branch in use" });

    await (manager as any).handlePrStateChange("wt-1", "open", "merged");

    expect(mockRemoveWorktree).toHaveBeenCalledWith("wt-1");
    expect(mockAddEvent).not.toHaveBeenCalled();

    const { log } = await import("../logger");
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("branch in use"),
      expect.objectContaining({
        domain: "auto-cleanup",
        worktreeId: "wt-1",
      }),
    );
  });

  it("emits cleanup event for closed PR when autoCleanupOnPrClose is true", async () => {
    manager.getConfig = vi.fn().mockReturnValue({
      autoCleanupOnPrMerge: false,
      autoCleanupOnPrClose: true,
    });
    mockGetCachedGitStatus.mockReturnValue(makeGitStatus());

    await (manager as any).handlePrStateChange("wt-2", "open", "closed");

    expect(mockRemoveWorktree).toHaveBeenCalledWith("wt-2");
    expect(mockAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ACTIVITY_TYPES.AUTO_CLEANUP,
        detail: expect.stringContaining("closed"),
      }),
    );
  });
});
