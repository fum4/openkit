import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { Hono } from "hono";
import path from "path";
import { tmpdir } from "os";

import { registerTaskRoutes } from "./tasks";
import { regenerateTaskMd } from "../task-context";
import type { WorktreeManager } from "../manager";
import type { NotesManager } from "../notes-manager";
import type { HooksManager } from "../verification-manager";

vi.mock("../task-context", () => ({
  regenerateTaskMd: vi.fn(),
}));

vi.mock("../logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createTempConfigDir(): string {
  const dir = path.join(
    tmpdir(),
    `openkit-tasks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedTask(configDir: string, task: { id: string; title: string; description: string }) {
  const taskDir = path.join(configDir, ".openkit", "issues", "local", task.id);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    path.join(taskDir, "task.json"),
    JSON.stringify({
      ...task,
      status: "todo",
      priority: "medium",
      labels: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  );
}

function createMockManager(configDir: string) {
  return {
    getConfigDir: () => configDir,
    getOpsLog: () => ({ addEvent: vi.fn() }),
    getProjectName: () => "test-project",
    resolveWorktreeId: vi.fn((id: string) => ({ success: true, worktreeId: id })),
  } as unknown as WorktreeManager;
}

function createMockNotesManager(linkedWorktreeId: string | null = null) {
  return {
    loadNotes: vi.fn(() => ({ linkedWorktreeId })),
    saveNotes: vi.fn(),
    setLinkedWorktreeId: vi.fn(),
  } as unknown as NotesManager;
}

function createMockHooksManager() {
  return {
    getConfig: vi.fn(() => ({ checks: [], skills: [] })),
  } as unknown as HooksManager;
}

describe("PATCH /api/tasks/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("regenerates TASK.md when task has a linked worktree", async () => {
    const configDir = createTempConfigDir();
    seedTask(configDir, { id: "LOCAL-1", title: "Original title", description: "Original desc" });

    const manager = createMockManager(configDir);
    const notesManager = createMockNotesManager("wt-abc123");
    const hooksManager = createMockHooksManager();

    const app = new Hono();
    registerTaskRoutes(app, manager, notesManager, hooksManager);

    const res = await app.request("/api/tasks/LOCAL-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Updated description" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.task.linkedWorktreeId).toBe("wt-abc123");

    expect(regenerateTaskMd).toHaveBeenCalledOnce();
    expect(regenerateTaskMd).toHaveBeenCalledWith(
      "local",
      "LOCAL-1",
      "wt-abc123",
      notesManager,
      configDir,
      expect.stringContaining(".openkit/worktrees"),
      expect.objectContaining({ worktreeId: "wt-abc123" }),
    );
  });

  it("skips TASK.md regeneration when task has no linked worktree", async () => {
    const configDir = createTempConfigDir();
    seedTask(configDir, { id: "LOCAL-2", title: "No worktree task", description: "Some desc" });

    const manager = createMockManager(configDir);
    const notesManager = createMockNotesManager(null);
    const hooksManager = createMockHooksManager();

    const app = new Hono();
    registerTaskRoutes(app, manager, notesManager, hooksManager);

    const res = await app.request("/api/tasks/LOCAL-2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Updated description" }),
    });

    expect(res.status).toBe(200);
    expect(regenerateTaskMd).not.toHaveBeenCalled();
  });

  it("does not fail the update when regenerateTaskMd throws", async () => {
    const configDir = createTempConfigDir();
    seedTask(configDir, { id: "LOCAL-3", title: "Error task", description: "Desc" });

    const manager = createMockManager(configDir);
    const notesManager = createMockNotesManager("wt-broken");
    const hooksManager = createMockHooksManager();

    vi.mocked(regenerateTaskMd).mockImplementationOnce(() => {
      throw new Error("Worktree path does not exist");
    });

    const app = new Hono();
    registerTaskRoutes(app, manager, notesManager, hooksManager);

    const res = await app.request("/api/tasks/LOCAL-3", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Still updates" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("persists the updated description to task.json", async () => {
    const configDir = createTempConfigDir();
    seedTask(configDir, { id: "LOCAL-4", title: "Persist test", description: "Old desc" });

    const manager = createMockManager(configDir);
    const notesManager = createMockNotesManager(null);

    const app = new Hono();
    registerTaskRoutes(app, manager, notesManager);

    const res = await app.request("/api/tasks/LOCAL-4", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "New desc" }),
    });

    expect(res.status).toBe(200);

    const taskFile = path.join(configDir, ".openkit", "issues", "local", "LOCAL-4", "task.json");
    const saved = JSON.parse(readFileSync(taskFile, "utf-8"));
    expect(saved.description).toBe("New desc");
  });
});
