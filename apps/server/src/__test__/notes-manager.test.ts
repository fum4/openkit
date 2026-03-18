import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs");
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid-1234"),
}));
vi.mock("@openkit/shared/constants", () => ({
  CONFIG_DIR_NAME: ".openkit",
}));

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";

import { NotesManager } from "../notes-manager";

const CONFIG_DIR = "/test/config";
const CONFIG_DIR_NAME = ".openkit";

function issueDir(source: string, id: string): string {
  return path.join(CONFIG_DIR, CONFIG_DIR_NAME, "issues", source, id);
}

function emptyNotes() {
  return {
    linkedWorktreeId: null,
    personal: null,
    aiContext: null,
    todos: [],
  };
}

describe("NotesManager", () => {
  let manager: NotesManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
    manager = new NotesManager(CONFIG_DIR);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── getIssueDir ──────────────────────────────────────────────────────

  describe("getIssueDir", () => {
    it("returns the correct path for a jira issue", () => {
      expect(manager.getIssueDir("jira", "PROJ-123")).toBe(
        path.join(CONFIG_DIR, CONFIG_DIR_NAME, "issues", "jira", "PROJ-123"),
      );
    });

    it("returns the correct path for a linear issue", () => {
      expect(manager.getIssueDir("linear", "LIN-456")).toBe(
        path.join(CONFIG_DIR, CONFIG_DIR_NAME, "issues", "linear", "LIN-456"),
      );
    });

    it("returns the correct path for a local issue", () => {
      expect(manager.getIssueDir("local", "my-task")).toBe(
        path.join(CONFIG_DIR, CONFIG_DIR_NAME, "issues", "local", "my-task"),
      );
    });
  });

  // ── loadNotes ────────────────────────────────────────────────────────

  describe("loadNotes", () => {
    it("returns empty notes when file does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const notes = manager.loadNotes("jira", "PROJ-1");

      expect(notes).toEqual(emptyNotes());
    });

    it("parses valid JSON from an existing file", () => {
      const stored = {
        linkedWorktreeId: "wt-1",
        personal: { content: "my notes", updatedAt: "2026-01-01T00:00:00.000Z" },
        aiContext: null,
        todos: [{ id: "t1", text: "do it", checked: false, createdAt: "2026-01-01T00:00:00.000Z" }],
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(stored));

      const notes = manager.loadNotes("jira", "PROJ-1");

      expect(notes).toEqual(stored);
    });

    it("returns empty notes when file contains corrupt JSON", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("{not valid json!!!");

      const notes = manager.loadNotes("jira", "PROJ-1");

      expect(notes).toEqual(emptyNotes());
    });

    it("initialises todos array when missing from stored JSON", () => {
      const stored = { linkedWorktreeId: null, personal: null, aiContext: null };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(stored));

      const notes = manager.loadNotes("linear", "LIN-1");

      expect(notes.todos).toEqual([]);
    });
  });

  // ── saveNotes ────────────────────────────────────────────────────────

  describe("saveNotes", () => {
    it("creates directory recursively when it does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const notes = emptyNotes();
      manager.saveNotes("jira", "PROJ-1", notes);

      expect(mkdirSync).toHaveBeenCalledWith(issueDir("jira", "PROJ-1"), { recursive: true });
    });

    it("writes JSON with indent 2 and trailing newline", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const notes = emptyNotes();
      manager.saveNotes("jira", "PROJ-1", notes);

      const written = vi.mocked(writeFileSync).mock.calls[0]![1] as string;
      expect(written).toBe(JSON.stringify(notes, null, 2) + "\n");
    });

    it("does not create directory when it already exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      manager.saveNotes("local", "task-1", emptyNotes());

      expect(mkdirSync).not.toHaveBeenCalled();
    });
  });

  // ── updateSection ────────────────────────────────────────────────────

  describe("updateSection", () => {
    it("updates the personal section with content and timestamp", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = manager.updateSection("jira", "PROJ-1", "personal", "hello world");

      expect(result.personal).toEqual({
        content: "hello world",
        updatedAt: "2026-01-15T10:00:00.000Z",
      });
      expect(writeFileSync).toHaveBeenCalled();
    });

    it("updates the aiContext section with content and timestamp", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = manager.updateSection("linear", "LIN-1", "aiContext", "context data");

      expect(result.aiContext).toEqual({
        content: "context data",
        updatedAt: "2026-01-15T10:00:00.000Z",
      });
    });
  });

  // ── linked worktree ──────────────────────────────────────────────────

  describe("getLinkedWorktreeId / setLinkedWorktreeId", () => {
    it("returns null when no worktree is linked", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect(manager.getLinkedWorktreeId("jira", "PROJ-1")).toBeNull();
    });

    it("sets and persists a worktree link", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      manager.setLinkedWorktreeId("jira", "PROJ-1", "wt-abc");

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string);
      expect(written.linkedWorktreeId).toBe("wt-abc");
    });
  });

  // ── clearLinkedWorktreeId ────────────────────────────────────────────

  describe("clearLinkedWorktreeId", () => {
    function makeDirent(name: string, isDir = true) {
      return {
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
      } as unknown as unknown as ReturnType<typeof readdirSync>[number] & {
        isDirectory(): boolean;
      };
    }

    it("returns 0 when no source dirs exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect(manager.clearLinkedWorktreeId("wt-1")).toBe(0);
    });

    it("clears matching worktree IDs across multiple sources and returns count", () => {
      const issuesDir = path.join(CONFIG_DIR, CONFIG_DIR_NAME, "issues");

      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p === path.join(issuesDir, "jira")) return true;
        if (p === path.join(issuesDir, "linear")) return true;
        if (p === path.join(issuesDir, "local")) return true;
        if (String(p).endsWith("notes.json")) return true;
        return true;
      });

      vi.mocked(readdirSync).mockImplementation((p: any) => {
        if (p === path.join(issuesDir, "jira"))
          return [makeDirent("PROJ-1"), makeDirent("PROJ-2")] as any;
        if (p === path.join(issuesDir, "linear")) return [makeDirent("LIN-1")] as any;
        if (p === path.join(issuesDir, "local")) return [] as any;
        return [] as any;
      });

      vi.mocked(readFileSync).mockImplementation((p: any) => {
        if (String(p).includes("PROJ-1"))
          return JSON.stringify({
            linkedWorktreeId: "wt-target",
            personal: null,
            aiContext: null,
            todos: [],
          });
        if (String(p).includes("PROJ-2"))
          return JSON.stringify({
            linkedWorktreeId: "wt-other",
            personal: null,
            aiContext: null,
            todos: [],
          });
        if (String(p).includes("LIN-1"))
          return JSON.stringify({
            linkedWorktreeId: "wt-target",
            personal: null,
            aiContext: null,
            todos: [],
          });
        return JSON.stringify(emptyNotes());
      });

      const count = manager.clearLinkedWorktreeId("wt-target");

      expect(count).toBe(2);
      // Verify the cleared notes were saved
      const writeCalls = vi.mocked(writeFileSync).mock.calls;
      for (const call of writeCalls) {
        const saved = JSON.parse(call[1] as string);
        expect(saved.linkedWorktreeId).toBeNull();
      }
    });

    it("skips non-directory entries", () => {
      const issuesDir = path.join(CONFIG_DIR, CONFIG_DIR_NAME, "issues");

      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p === path.join(issuesDir, "jira")) return true;
        if (p === path.join(issuesDir, "linear")) return false;
        if (p === path.join(issuesDir, "local")) return false;
        return true;
      });

      vi.mocked(readdirSync).mockReturnValue([makeDirent("file.txt", false)] as any);

      const count = manager.clearLinkedWorktreeId("wt-1");

      expect(count).toBe(0);
      expect(readFileSync).not.toHaveBeenCalled();
    });
  });

  // ── addTodo ──────────────────────────────────────────────────────────

  describe("addTodo", () => {
    it("adds a todo with generated id, text, checked:false, and createdAt timestamp", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = manager.addTodo("jira", "PROJ-1", "write tests");

      expect(result.todos).toHaveLength(1);
      expect(result.todos[0]).toEqual({
        id: "mock-uuid-1234",
        text: "write tests",
        checked: false,
        createdAt: "2026-01-15T10:00:00.000Z",
      });
    });

    it("appends to existing todos", () => {
      const existing = {
        linkedWorktreeId: null,
        personal: null,
        aiContext: null,
        todos: [
          {
            id: "existing-1",
            text: "old todo",
            checked: true,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = manager.addTodo("jira", "PROJ-1", "new todo");

      expect(result.todos).toHaveLength(2);
      expect(result.todos[1]!.text).toBe("new todo");
    });
  });

  // ── updateTodo ───────────────────────────────────────────────────────

  describe("updateTodo", () => {
    const storedNotes = {
      linkedWorktreeId: null,
      personal: null,
      aiContext: null,
      todos: [
        { id: "todo-1", text: "first", checked: false, createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "todo-2", text: "second", checked: false, createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    };

    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(storedNotes));
    });

    it("updates the text of an existing todo", () => {
      const result = manager.updateTodo("jira", "PROJ-1", "todo-1", { text: "updated text" });

      expect(result.todos[0]!.text).toBe("updated text");
      expect(result.todos[0]!.checked).toBe(false);
    });

    it("updates the checked state of an existing todo", () => {
      const result = manager.updateTodo("jira", "PROJ-1", "todo-2", { checked: true });

      expect(result.todos[1]!.checked).toBe(true);
      expect(result.todos[1]!.text).toBe("second");
    });

    it("throws an error when the todo id is not found", () => {
      expect(() => manager.updateTodo("jira", "PROJ-1", "nonexistent", { text: "nope" })).toThrow(
        'Todo "nonexistent" not found',
      );
    });
  });

  // ── deleteTodo ───────────────────────────────────────────────────────

  describe("deleteTodo", () => {
    it("removes a todo by id", () => {
      const stored = {
        linkedWorktreeId: null,
        personal: null,
        aiContext: null,
        todos: [
          { id: "todo-1", text: "keep", checked: false, createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "todo-2", text: "remove", checked: false, createdAt: "2026-01-01T00:00:00.000Z" },
        ],
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(stored));

      const result = manager.deleteTodo("jira", "PROJ-1", "todo-2");

      expect(result.todos).toHaveLength(1);
      expect(result.todos[0]!.id).toBe("todo-1");
    });

    it("does nothing when deleting a non-existent todo id", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = manager.deleteTodo("jira", "PROJ-1", "ghost");

      expect(result.todos).toHaveLength(0);
    });
  });

  // ── updateGitPolicy ──────────────────────────────────────────────────

  describe("updateGitPolicy", () => {
    it("sets git policy on notes without existing policy", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = manager.updateGitPolicy("jira", "PROJ-1", { agentCommits: "allow" });

      expect(result.gitPolicy).toEqual({ agentCommits: "allow" });
    });

    it("merges with existing git policy", () => {
      const stored = {
        linkedWorktreeId: null,
        personal: null,
        aiContext: null,
        todos: [],
        gitPolicy: { agentCommits: "allow" as const },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(stored));

      const result = manager.updateGitPolicy("jira", "PROJ-1", { agentPushes: "deny" });

      expect(result.gitPolicy).toEqual({ agentCommits: "allow", agentPushes: "deny" });
    });
  });

  // ── updateHookSkills ─────────────────────────────────────────────────

  describe("updateHookSkills", () => {
    it("sets hook skills on notes without existing skills", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = manager.updateHookSkills("local", "task-1", { lint: "enable" });

      expect(result.hookSkills).toEqual({ lint: "enable" });
    });

    it("merges with existing hook skills", () => {
      const stored = {
        linkedWorktreeId: null,
        personal: null,
        aiContext: null,
        todos: [],
        hookSkills: { lint: "enable" as const },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(stored));

      const result = manager.updateHookSkills("local", "task-1", { format: "disable" });

      expect(result.hookSkills).toEqual({ lint: "enable", format: "disable" });
    });
  });

  // ── buildWorktreeLinkMap ─────────────────────────────────────────────

  describe("buildWorktreeLinkMap", () => {
    function makeDirent(name: string, isDir = true) {
      return { name, isDirectory: () => isDir, isFile: () => !isDir } as unknown as ReturnType<
        typeof readdirSync
      >[number] & { isDirectory(): boolean };
    }

    it("returns an empty map when no source dirs exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const map = manager.buildWorktreeLinkMap();

      expect(map.size).toBe(0);
    });

    it("builds a map from multiple sources with linked worktrees", () => {
      const issuesDir = path.join(CONFIG_DIR, CONFIG_DIR_NAME, "issues");

      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p === path.join(issuesDir, "jira")) return true;
        if (p === path.join(issuesDir, "linear")) return true;
        if (p === path.join(issuesDir, "local")) return false;
        // notes.json files
        if (String(p).endsWith("notes.json")) return true;
        return false;
      });

      vi.mocked(readdirSync).mockImplementation((p: any) => {
        if (p === path.join(issuesDir, "jira")) return [makeDirent("PROJ-1")] as any;
        if (p === path.join(issuesDir, "linear"))
          return [makeDirent("LIN-1"), makeDirent("LIN-2")] as any;
        return [] as any;
      });

      vi.mocked(readFileSync).mockImplementation((p: any) => {
        if (String(p).includes("PROJ-1")) return JSON.stringify({ linkedWorktreeId: "wt-a" });
        if (String(p).includes("LIN-1")) return JSON.stringify({ linkedWorktreeId: "wt-b" });
        if (String(p).includes("LIN-2")) return JSON.stringify({ linkedWorktreeId: null });
        return JSON.stringify({});
      });

      const map = manager.buildWorktreeLinkMap();

      expect(map.size).toBe(2);
      expect(map.get("wt-a")).toEqual({ source: "jira", issueId: "PROJ-1" });
      expect(map.get("wt-b")).toEqual({ source: "linear", issueId: "LIN-1" });
    });

    it("skips corrupt notes files without throwing", () => {
      const issuesDir = path.join(CONFIG_DIR, CONFIG_DIR_NAME, "issues");

      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p === path.join(issuesDir, "jira")) return true;
        if (p === path.join(issuesDir, "linear")) return false;
        if (p === path.join(issuesDir, "local")) return false;
        if (String(p).endsWith("notes.json")) return true;
        return false;
      });

      vi.mocked(readdirSync).mockReturnValue([makeDirent("PROJ-1")] as any);
      vi.mocked(readFileSync).mockReturnValue("{{corrupt}}");

      const map = manager.buildWorktreeLinkMap();

      expect(map.size).toBe(0);
    });

    it("skips entries without a linked worktree id", () => {
      const issuesDir = path.join(CONFIG_DIR, CONFIG_DIR_NAME, "issues");

      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p === path.join(issuesDir, "jira")) return true;
        if (p === path.join(issuesDir, "linear")) return false;
        if (p === path.join(issuesDir, "local")) return false;
        if (String(p).endsWith("notes.json")) return true;
        return false;
      });

      vi.mocked(readdirSync).mockReturnValue([makeDirent("PROJ-1")] as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ linkedWorktreeId: null }));

      const map = manager.buildWorktreeLinkMap();

      expect(map.size).toBe(0);
    });
  });
});
