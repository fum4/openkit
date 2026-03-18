/**
 * Test data helpers.
 *
 * The actual HTTP handlers are provided by the server bridge (real Hono app).
 * This file only exports helpers for creating test data fixtures.
 */
import type { WorktreeInfo } from "../../types";

export function createWorktreeInfo(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id: "my-feature",
    path: "/work/project/.worktrees/my-feature",
    branch: "my-feature",
    status: "stopped",
    ports: [],
    offset: null,
    pid: null,
    ...overrides,
  };
}
