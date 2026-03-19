import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { Hono } from "hono";
import path from "path";
import { tmpdir } from "os";

import { registerTaskRoutes } from "./tasks";
import type { WorktreeManager } from "../manager";
import type { NotesManager } from "../notes-manager";

vi.mock("../logger", () => {
  const childLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
  return {
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      get: vi.fn(() => childLog),
    },
  };
});

const tempDirs: string[] = [];

function createTempConfigDir(): string {
  const dir = path.join(
    tmpdir(),
    `openkit-tasks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors in tests
    }
  }
  tempDirs.length = 0;
});

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

describe("PATCH /api/tasks/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the updated description to issue.json", async () => {
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

    const taskFile = path.join(configDir, ".openkit", "issues", "local", "LOCAL-4", "issue.json");
    const saved = JSON.parse(readFileSync(taskFile, "utf-8"));
    expect(saved.description).toBe("New desc");
  });
});
