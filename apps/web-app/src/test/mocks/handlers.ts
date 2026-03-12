import { http, HttpResponse } from "msw";

import type { WorktreeInfo } from "../../types";

// ─── Default data ────────────────────────────────────────────────

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

// ─── Mutable state that tests can manipulate ─────────────────────

let worktreeStore: WorktreeInfo[] = [];
let nextWorktreeId = 1;

export function resetWorktreeStore(initial: WorktreeInfo[] = []) {
  worktreeStore = initial;
  nextWorktreeId = 1;
}

export function getWorktreeStore() {
  return worktreeStore;
}

// ─── Handlers ────────────────────────────────────────────────────

export const handlers = [
  // Worktrees
  http.get("/api/worktrees", () => {
    return HttpResponse.json({ worktrees: worktreeStore });
  }),

  http.post("/api/worktrees", async ({ request }) => {
    const body = (await request.json()) as { branch: string; name?: string };
    const id = body.name || body.branch;
    const newWorktree = createWorktreeInfo({
      id,
      branch: body.branch,
      path: `/work/project/.worktrees/${id}`,
    });
    worktreeStore.push(newWorktree);
    return HttpResponse.json({
      success: true,
      worktreeId: id,
      worktree: newWorktree,
    });
  }),

  http.delete("/api/worktrees/:id", ({ params }) => {
    const id = params.id as string;
    worktreeStore = worktreeStore.filter((w) => w.id !== id);
    return HttpResponse.json({ success: true });
  }),

  http.post("/api/worktrees/:id/start", ({ params }) => {
    const id = params.id as string;
    const worktree = worktreeStore.find((w) => w.id === id);
    if (worktree) {
      worktree.status = "running";
      worktree.pid = 12345;
    }
    return HttpResponse.json({ success: true });
  }),

  http.post("/api/worktrees/:id/stop", ({ params }) => {
    const id = params.id as string;
    const worktree = worktreeStore.find((w) => w.id === id);
    if (worktree) {
      worktree.status = "stopped";
      worktree.pid = null;
    }
    return HttpResponse.json({ success: true });
  }),

  // Jira
  http.post("/api/jira/create", async ({ request }) => {
    const body = (await request.json()) as { issueKey: string; branch?: string };
    const id = body.branch || body.issueKey.toLowerCase();
    const newWorktree = createWorktreeInfo({
      id,
      branch: id,
      jiraUrl: `https://jira.example.com/browse/${body.issueKey}`,
    });
    worktreeStore.push(newWorktree);
    return HttpResponse.json({
      success: true,
      worktreeId: id,
      worktree: newWorktree,
    });
  }),

  // Config
  http.get("/api/config", () => {
    return HttpResponse.json({
      projectName: "test-project",
      projectDir: "/work/project",
      startCommand: "pnpm dev",
      installCommand: "pnpm install",
      baseBranch: "main",
      ports: { discovered: [3000], offsetStep: 1 },
    });
  }),

  http.patch("/api/config", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ success: true, ...body });
  }),

  // Custom tasks
  http.get("/api/tasks", () => {
    return HttpResponse.json({ tasks: [] });
  }),

  http.post("/api/tasks", async ({ request }) => {
    const body = (await request.json()) as {
      title: string;
      description?: string;
      priority?: string;
    };
    return HttpResponse.json({
      success: true,
      task: {
        id: `LOCAL-${nextWorktreeId++}`,
        title: body.title,
        description: body.description || "",
        status: "todo",
        priority: body.priority || "medium",
        labels: [],
        linkedWorktreeId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  // Events SSE endpoint (used by useWorktrees)
  http.get("/api/events", () => {
    return HttpResponse.json({});
  }),

  // Branch rule status
  http.get("/api/branch-name/status", () => {
    return HttpResponse.json({ hasRule: false });
  }),

  // GitHub status
  http.get("/api/github/status", () => {
    return HttpResponse.json({
      installed: true,
      authenticated: true,
      username: "testuser",
      repo: "test/repo",
      hasRemote: true,
      hasCommits: true,
    });
  }),

  // Jira status
  http.get("/api/jira/status", () => {
    return HttpResponse.json({ configured: false });
  }),

  // Linear status
  http.get("/api/linear/status", () => {
    return HttpResponse.json({ configured: false });
  }),

  // Hooks
  http.get("/api/hooks", () => {
    return HttpResponse.json({ steps: [], skills: [] });
  }),
];
