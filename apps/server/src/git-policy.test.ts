import type { NotesManager } from "./notes-manager";
import { resolveGitPolicy } from "@openkit/shared/git-policy";
import { createTestConfig } from "./test/fixtures";

function createMockNotesManager(
  overrides: {
    linkMap?: Map<string, { source: string; issueId: string }>;
    gitPolicy?: { agentCommits?: string; agentPushes?: string; agentPRs?: string };
  } = {},
): NotesManager {
  const linkMap = overrides.linkMap ?? new Map();
  const gitPolicy = overrides.gitPolicy;

  return {
    buildWorktreeLinkMap: () => linkMap,
    loadNotes: () => ({ gitPolicy }),
  } as unknown as NotesManager;
}

describe("resolveGitPolicy", () => {
  describe("when no per-worktree override exists", () => {
    const notesManager = createMockNotesManager();

    it("allows commit when global config enables it", () => {
      const config = createTestConfig({ allowAgentCommits: true });

      const result = resolveGitPolicy("commit", "WT-1", config, notesManager);

      expect(result).toEqual({ allowed: true });
    });

    it("denies commit when global config disables it", () => {
      const config = createTestConfig({ allowAgentCommits: false });

      const result = resolveGitPolicy("commit", "WT-1", config, notesManager);

      expect(result).toEqual({
        allowed: false,
        reason: "Agent commits disabled in local settings",
      });
    });

    it("denies commit when global config is undefined", () => {
      const config = createTestConfig();

      const result = resolveGitPolicy("commit", "WT-1", config, notesManager);

      expect(result).toEqual({
        allowed: false,
        reason: "Agent commits disabled in local settings",
      });
    });

    it("allows push when global config enables it", () => {
      const config = createTestConfig({ allowAgentPushes: true });

      const result = resolveGitPolicy("push", "WT-1", config, notesManager);

      expect(result).toEqual({ allowed: true });
    });

    it("denies push when global config disables it", () => {
      const config = createTestConfig();

      const result = resolveGitPolicy("push", "WT-1", config, notesManager);

      expect(result).toEqual({
        allowed: false,
        reason: "Agent pushes disabled in local settings",
      });
    });

    it("allows PR creation when global config enables it", () => {
      const config = createTestConfig({ allowAgentPRs: true });

      const result = resolveGitPolicy("create_pr", "WT-1", config, notesManager);

      expect(result).toEqual({ allowed: true });
    });

    it("denies PR creation when global config disables it", () => {
      const config = createTestConfig();

      const result = resolveGitPolicy("create_pr", "WT-1", config, notesManager);

      expect(result).toEqual({
        allowed: false,
        reason: "Agent PR creation disabled in local settings",
      });
    });
  });

  describe("when per-worktree override is 'allow'", () => {
    it("allows the operation regardless of global config", () => {
      const linkMap = new Map([["WT-1", { source: "jira", issueId: "PROJ-1" }]]);
      const notesManager = createMockNotesManager({
        linkMap,
        gitPolicy: { agentCommits: "allow" },
      });
      const config = createTestConfig({ allowAgentCommits: false });

      const result = resolveGitPolicy("commit", "WT-1", config, notesManager);

      expect(result).toEqual({ allowed: true });
    });
  });

  describe("when per-worktree override is 'deny'", () => {
    it("denies the operation regardless of global config", () => {
      const linkMap = new Map([["WT-1", { source: "jira", issueId: "PROJ-1" }]]);
      const notesManager = createMockNotesManager({
        linkMap,
        gitPolicy: { agentPushes: "deny" },
      });
      const config = createTestConfig({ allowAgentPushes: true });

      const result = resolveGitPolicy("push", "WT-1", config, notesManager);

      expect(result).toEqual({
        allowed: false,
        reason: "Agent pushes denied by per-worktree policy",
      });
    });
  });

  describe("when per-worktree override is 'inherit'", () => {
    it("falls through to global config", () => {
      const linkMap = new Map([["WT-1", { source: "jira", issueId: "PROJ-1" }]]);
      const notesManager = createMockNotesManager({
        linkMap,
        gitPolicy: { agentCommits: "inherit" },
      });
      const config = createTestConfig({ allowAgentCommits: true });

      const result = resolveGitPolicy("commit", "WT-1", config, notesManager);

      expect(result).toEqual({ allowed: true });
    });
  });
});
