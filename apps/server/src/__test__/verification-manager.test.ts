import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs");
vi.mock("child_process");
vi.mock("@openkit/shared/constants", () => ({
  CONFIG_DIR_NAME: ".openkit",
}));
vi.mock("./logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { HooksManager } from "../verification-manager";
import type { WorktreeManager } from "../manager";

const CONFIG_DIR = "/test/config";

function createMockManager(overrides?: Partial<WorktreeManager>): WorktreeManager {
  return {
    getConfigDir: () => CONFIG_DIR,
    getGitRoot: () => "/test/git-root",
    getWorktrees: () => [],
    emitHookUpdate: vi.fn(),
    ...overrides,
  } as unknown as WorktreeManager;
}

describe("HooksManager", () => {
  let manager: HooksManager;
  let mockWtManager: WorktreeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWtManager = createMockManager();
    manager = new HooksManager(mockWtManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getStatus", () => {
    it("reads from hooks.json at the worktree level", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      manager.getStatus("wt-1");

      const calls = vi.mocked(existsSync).mock.calls;
      const hooksJsonCalls = calls.filter(([p]) =>
        (p as string).endsWith(path.join("wt-1", "hooks.json")),
      );

      expect(hooksJsonCalls.length).toBeGreaterThan(0);
    });
  });

  describe("reportSkillResult", () => {
    it("writes skill results into hooks.json alongside steps", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      manager.reportSkillResult("wt-1", {
        skillName: "test-skill",
        trigger: "post-implementation",
        status: "passed",
        reportedAt: "2026-01-01T00:00:00.000Z",
      });

      const writeCalls = vi.mocked(writeFileSync).mock.calls;
      const hooksWrite = writeCalls.find(([p]) =>
        (p as string).endsWith(path.join("wt-1", "hooks.json")),
      );
      expect(hooksWrite).toBeDefined();

      const written = JSON.parse(hooksWrite![1] as string);
      expect(written.skills).toHaveLength(1);
      expect(written.skills[0].skillName).toBe("test-skill");
      expect(written.steps).toBeDefined();
    });
  });

  describe("getSkillResults", () => {
    it("reads skills from hooks.json", () => {
      const skills = [
        {
          skillName: "my-skill",
          trigger: "post-implementation",
          status: "passed",
          reportedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          id: "run-1",
          worktreeId: "wt-1",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          steps: [],
          skills,
        }),
      );

      const results = manager.getSkillResults("wt-1");

      expect(results).toEqual(skills);
    });

    it("returns empty array when no hooks.json exists", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect(manager.getSkillResults("wt-1")).toEqual([]);
    });
  });

  describe("runWorktreeLifecycleCommands", () => {
    it("does not persist run data for worktree-removed trigger", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          steps: [
            {
              id: "step-1",
              name: "cleanup",
              command: "echo done",
              enabled: true,
              trigger: "worktree-removed",
            },
          ],
          skills: [],
        }),
      );

      const { execFile } = await import("child_process");
      vi.mocked(execFile).mockImplementation(((
        _cmd: unknown,
        _args: unknown,
        _opts: unknown,
        cb?: Function,
      ) => {
        if (cb) cb(null, { stdout: "ok", stderr: "" });
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      await manager.runWorktreeLifecycleCommands("worktree-removed", "wt-1", "/some/path");

      // writeFileSync should NOT have been called for hooks.json persistence
      const writeCalls = vi.mocked(writeFileSync).mock.calls;
      const hooksPersistCalls = writeCalls.filter(([p]) =>
        (p as string).endsWith(path.join("wt-1", "hooks.json")),
      );
      expect(hooksPersistCalls).toHaveLength(0);
    });

    it("persists run data for worktree-created trigger", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          steps: [
            {
              id: "step-1",
              name: "setup",
              command: "echo init",
              enabled: true,
              trigger: "worktree-created",
            },
          ],
          skills: [],
        }),
      );

      const { execFile } = await import("child_process");
      vi.mocked(execFile).mockImplementation(((
        _cmd: unknown,
        _args: unknown,
        _opts: unknown,
        cb?: Function,
      ) => {
        if (cb) cb(null, { stdout: "ok", stderr: "" });
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      await manager.runWorktreeLifecycleCommands("worktree-created", "wt-1", "/some/path");

      // writeFileSync SHOULD have been called for hooks.json persistence
      const writeCalls = vi.mocked(writeFileSync).mock.calls;
      const hooksPersistCalls = writeCalls.filter(([p]) =>
        (p as string).endsWith(path.join("wt-1", "hooks.json")),
      );
      expect(hooksPersistCalls.length).toBeGreaterThan(0);
    });
  });
});
