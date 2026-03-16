# CLI Agent Commands Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CLI commands for every agent capability (hooks, git ops, worktrees, issues, notifications, context) so agents can operate entirely through the CLI without MCP or REST calls.

**Architecture:** Each CLI command discovers the running OpenKit server via `.openkit/server.json`, calls existing REST endpoints, and formats the response. A shared `server-client.ts` module handles server discovery, worktree ID inference, and HTTP calls. One file per command group. TDD with co-located tests.

**Tech Stack:** TypeScript, Node.js fetch API, Vitest for tests

**Worktree:** All implementation happens in `/Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes/` (branch `chore/mcp-fixes`)

**Spec:** `docs/superpowers/specs/2026-03-16-cli-agent-commands-design.md`

---

## File Map

| Action | File                                           | Responsibility                                                     |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------ |
| Create | `apps/cli/src/server-client.ts`                | Shared server discovery, worktree inference, HTTP helpers          |
| Create | `apps/cli/src/server-client.test.ts`           | Tests for server-client                                            |
| Create | `apps/cli/src/hooks.ts`                        | `openkit hooks` subcommands (run, status, report, config)          |
| Create | `apps/cli/src/hooks.test.ts`                   | Tests for hooks                                                    |
| Create | `apps/cli/src/notify.ts`                       | `openkit notify` command                                           |
| Create | `apps/cli/src/notify.test.ts`                  | Tests for notify                                                   |
| Create | `apps/cli/src/git-ops.ts`                      | `openkit commit/push/pr/policy` commands                           |
| Create | `apps/cli/src/git-ops.test.ts`                 | Tests for git-ops                                                  |
| Create | `apps/cli/src/worktree-cmd.ts`                 | `openkit worktree` subcommands (list, create, start, stop, remove) |
| Create | `apps/cli/src/worktree-cmd.test.ts`            | Tests for worktree-cmd                                             |
| Create | `apps/cli/src/issues.ts`                       | `openkit issues` subcommands (list, get)                           |
| Create | `apps/cli/src/issues.test.ts`                  | Tests for issues                                                   |
| Create | `apps/cli/src/context.ts`                      | `openkit context` and `openkit notes` commands                     |
| Create | `apps/cli/src/context.test.ts`                 | Tests for context                                                  |
| Modify | `apps/cli/src/index.ts`                        | Register all new subcommands, update help text                     |
| Modify | `apps/cli/src/activity.ts`                     | Extract shared utils to server-client.ts                           |
| Modify | `apps/server/src/routes/worktrees.ts`          | Add `GET /api/worktrees/:id/git-policy` endpoint                   |
| Modify | `apps/server/src/index.ts`                     | Call `enableDefaultProjectSkills` on startup                       |
| Modify | `libs/agents/src/skills/work-on-task/SKILL.md` | Replace MCP refs with CLI commands                                 |
| Modify | `docs/CLI.md`                                  | Document all new commands                                          |
| Modify | `docs/API.md`                                  | Document new git-policy endpoint                                   |
| Modify | `docs/AGENTS.md`                               | Update agent capability reference                                  |
| Modify | `docs/ARCHITECTURE.md`                         | Update CLI section                                                 |

**Note:** The file is named `worktree-cmd.ts` (not `worktree.ts`) to avoid confusion with the worktree concept used elsewhere in the codebase.

---

## Chunk 1: Foundation — server-client.ts + activity.ts refactor

### Task 1: Create server-client.ts with shared utilities

**Files:**

- Create: `apps/cli/src/server-client.ts`
- Create: `apps/cli/src/server-client.test.ts`

- [ ] **Step 1: Write failing tests for `findRunningServerUrl`**

```typescript
// apps/cli/src/server-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "fs";
import path from "path";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

// Mock process.kill to check PID alive
const originalKill = process.kill;
beforeEach(() => {
  vi.restoreAllMocks();
  process.kill = originalKill;
});

describe("findRunningServerUrl", () => {
  it("returns URL when server.json exists and PID is alive", async () => {
    const { findRunningServerUrl } = await import("./server-client");
    mockExistsSync.mockImplementation((p) => String(p).endsWith(".openkit/server.json"));
    mockReadFileSync.mockReturnValue(JSON.stringify({ url: "http://localhost:5100", pid: 12345 }));
    process.kill = vi.fn() as any; // signal 0 doesn't throw = PID alive

    expect(findRunningServerUrl("/projects/myapp")).toBe("http://localhost:5100");
  });

  it("returns null when no server.json found", async () => {
    const { findRunningServerUrl } = await import("./server-client");
    mockExistsSync.mockReturnValue(false);

    expect(findRunningServerUrl("/projects/myapp")).toBeNull();
  });

  it("skips stale server.json where PID is dead", async () => {
    const { findRunningServerUrl } = await import("./server-client");
    mockExistsSync.mockImplementation((p) => String(p).endsWith(".openkit/server.json"));
    mockReadFileSync.mockReturnValue(JSON.stringify({ url: "http://localhost:5100", pid: 99999 }));
    process.kill = vi.fn(() => {
      throw new Error("ESRCH");
    }) as any;

    expect(findRunningServerUrl("/")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern server-client`
Expected: FAIL — module not found

- [ ] **Step 3: Write failing tests for `inferWorktreeIdFromCwd`**

Add to the same test file:

```typescript
describe("inferWorktreeIdFromCwd", () => {
  it("extracts worktree ID from cwd inside worktree directory", async () => {
    const { inferWorktreeIdFromCwd } = await import("./server-client");
    const original = process.cwd;
    process.cwd = () => "/projects/myapp/.openkit/worktrees/PROJ-123/src";
    expect(inferWorktreeIdFromCwd()).toBe("PROJ-123");
    process.cwd = original;
  });

  it("returns null when not inside a worktree", async () => {
    const { inferWorktreeIdFromCwd } = await import("./server-client");
    const original = process.cwd;
    process.cwd = () => "/projects/myapp/src";
    expect(inferWorktreeIdFromCwd()).toBeNull();
    process.cwd = original;
  });
});
```

- [ ] **Step 4: Write failing tests for `requireWorktreeId`**

```typescript
describe("requireWorktreeId", () => {
  it("returns explicit ID when provided", async () => {
    const { requireWorktreeId } = await import("./server-client");
    expect(requireWorktreeId("WT-1")).toBe("WT-1");
  });

  it("infers from cwd when no explicit ID", async () => {
    const { requireWorktreeId } = await import("./server-client");
    const original = process.cwd;
    process.cwd = () => "/projects/myapp/.openkit/worktrees/PROJ-123";
    expect(requireWorktreeId(undefined)).toBe("PROJ-123");
    process.cwd = original;
  });

  it("throws when no explicit ID and not in worktree", async () => {
    const { requireWorktreeId } = await import("./server-client");
    const original = process.cwd;
    process.cwd = () => "/projects/myapp/src";
    expect(() => requireWorktreeId(undefined)).toThrow("Worktree ID required");
    process.cwd = original;
  });
});
```

- [ ] **Step 5: Implement server-client.ts**

```typescript
// apps/cli/src/server-client.ts
import { existsSync, readFileSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";

export function findRunningServerUrl(startDir: string): string | null {
  let currentDir = startDir;
  const { root } = path.parse(currentDir);

  while (true) {
    const serverJsonPath = path.join(currentDir, CONFIG_DIR_NAME, "server.json");
    if (existsSync(serverJsonPath)) {
      try {
        const data = JSON.parse(readFileSync(serverJsonPath, "utf-8")) as {
          url?: string;
          pid?: number;
        };
        if (data.url && typeof data.pid === "number") {
          process.kill(data.pid, 0);
          return data.url;
        }
      } catch {
        // Stale/invalid — continue searching upwards
      }
    }
    if (currentDir === root) return null;
    currentDir = path.dirname(currentDir);
  }
}

export function inferWorktreeIdFromCwd(): string | null {
  const normalized = process.cwd().replace(/\\/g, "/");
  const marker = `/${CONFIG_DIR_NAME}/worktrees/`;
  const idx = normalized.indexOf(marker);
  if (idx < 0) return null;
  const rest = normalized.slice(idx + marker.length);
  const candidate = rest.split("/")[0]?.trim();
  return candidate || null;
}

export function requireWorktreeId(explicit: string | undefined): string {
  if (explicit) return explicit;
  const inferred = inferWorktreeIdFromCwd();
  if (inferred) return inferred;
  throw new Error("Worktree ID required (pass --worktree or run from a worktree directory)");
}

export async function serverFetch(apiPath: string, options?: RequestInit): Promise<Response> {
  const serverUrl = findRunningServerUrl(process.cwd());
  if (!serverUrl) {
    throw new Error("No running OpenKit server found for this project");
  }
  return fetch(`${serverUrl}${apiPath}`, options);
}

export async function serverJson<T>(apiPath: string, options?: RequestInit): Promise<T> {
  const response = await serverFetch(apiPath, options);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

// ─── Shared arg parsing helpers ──────────────────────────────────

export function parseFlag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && args[i + 1]) return args[i + 1];
    if (args[i]?.startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
  }
  return undefined;
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** Output result: JSON to stdout if --json, otherwise log human-readable */
export function outputResult(result: unknown, json: boolean, successMsg?: string) {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (successMsg) {
    // Import log lazily to avoid circular deps — callers can also log directly
    process.stderr.write(`● ${successMsg}\n`);
  }
}
```

All command modules import `parseFlag`, `hasFlag`, `outputResult` from `server-client.ts` instead of defining their own copies.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern server-client`
Expected: All PASS

### Task 2: Refactor activity.ts to use server-client.ts

**Files:**

- Modify: `apps/cli/src/activity.ts`

- [ ] **Step 1: Replace `findRunningServerUrl` and `inferWorktreeIdFromCwd` in activity.ts**

Remove the local implementations (lines 409-443) and import from server-client:

```typescript
// At top of activity.ts, replace fs/path imports with:
import { findRunningServerUrl, inferWorktreeIdFromCwd } from "./server-client";
```

Remove the `import { existsSync, readFileSync } from "fs"` and `import path from "path"` lines (only if no other code in the file uses them — check `findRunningServerUrl` was the only consumer of those imports).

Remove the two function definitions:

- `function inferWorktreeIdFromCwd()` (lines 409-417)
- `function findRunningServerUrl()` (lines 419-443)

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm test`
Expected: All existing tests pass

---

## Chunk 2: Hooks CLI + Git Policy Endpoint

### Task 3: Add `GET /api/worktrees/:id/git-policy` server endpoint

**Files:**

- Modify: `apps/server/src/routes/worktrees.ts`

- [ ] **Step 1: Add git-policy endpoint**

In `registerWorktreeRoutes()`, after the existing worktree routes, add:

```typescript
import { resolveGitPolicy } from "../git-policy";
import type { GitOperation } from "../git-policy";

// Inside registerWorktreeRoutes():
app.get("/api/worktrees/:id/git-policy", (c) => {
  const id = c.req.param("id");
  const resolved = manager.resolveWorktree(id);
  if (!resolved.success) {
    return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
  }
  const config = manager.getConfig();
  const notesManager = manager.getNotesManager();
  const operations: GitOperation[] = ["commit", "push", "create_pr"];
  const policies = Object.fromEntries(
    operations.map((op) => [op, resolveGitPolicy(op, resolved.worktreeId, config, notesManager)]),
  );
  return c.json({ success: true, policies });
});
```

- [ ] **Step 2: Write test for git-policy endpoint**

Add to the server's web-app test suite or create an inline test. The endpoint should be covered by the existing integration test pattern. At minimum, verify:

```typescript
// In an appropriate test file for worktree routes
it("returns git policy for all operations", async () => {
  const res = await app.fetch(
    new Request(`http://localhost/api/worktrees/${worktreeId}/git-policy`),
  );
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.policies).toHaveProperty("commit");
  expect(body.policies).toHaveProperty("push");
  expect(body.policies).toHaveProperty("create_pr");
  expect(body.policies.commit).toHaveProperty("allowed");
});

it("returns 404 for unknown worktree", async () => {
  const res = await app.fetch(new Request("http://localhost/api/worktrees/nonexistent/git-policy"));
  expect(res.status).toBe(404);
});
```

- [ ] **Step 3: Verify server builds and tests pass**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run server:typecheck && pnpm nx run web-app:test`
Expected: No errors

### Task 4: Create hooks.ts CLI command

**Files:**

- Create: `apps/cli/src/hooks.ts`
- Create: `apps/cli/src/hooks.test.ts`

- [ ] **Step 1: Write failing tests for hooks CLI**

```typescript
// apps/cli/src/hooks.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./server-client", () => ({
  requireWorktreeId: vi.fn((explicit) => explicit ?? "WT-1"),
  serverJson: vi.fn(),
  serverFetch: vi.fn(),
}));

import { requireWorktreeId, serverJson, serverFetch } from "./server-client";

const mockServerJson = vi.mocked(serverJson);
const mockServerFetch = vi.mocked(serverFetch);
const mockRequireWorktreeId = vi.mocked(requireWorktreeId);

beforeEach(() => vi.clearAllMocks());

describe("runHooks", () => {
  it("runs hooks for a trigger", async () => {
    const { runHooks } = await import("./hooks");
    mockServerJson.mockResolvedValue({ id: "run-1", status: "completed", steps: [] });
    await runHooks(["run", "--worktree", "WT-1", "--trigger", "pre-implementation"]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/worktrees/WT-1/hooks/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ trigger: "pre-implementation" }),
      }),
    );
  });

  it("gets hooks status", async () => {
    const { runHooks } = await import("./hooks");
    mockServerJson.mockResolvedValue({ status: { steps: [] } });
    await runHooks(["status", "--worktree", "WT-1"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/worktrees/WT-1/hooks/status");
  });

  it("reports hook result", async () => {
    const { runHooks } = await import("./hooks");
    mockServerJson.mockResolvedValue({ success: true });
    await runHooks([
      "report",
      "--worktree",
      "WT-1",
      "--skill",
      "review",
      "--trigger",
      "post-implementation",
      "--success",
    ]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/worktrees/WT-1/hooks/report",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          skillName: "review",
          trigger: "post-implementation",
          success: true,
        }),
      }),
    );
  });

  it("gets hooks config", async () => {
    const { runHooks } = await import("./hooks");
    mockServerJson.mockResolvedValue({ steps: [] });
    await runHooks(["config"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/hooks/config");
  });

  it("gets effective config for worktree", async () => {
    const { runHooks } = await import("./hooks");
    mockServerJson.mockResolvedValue({ steps: [] });
    await runHooks(["config", "--worktree", "WT-1"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/worktrees/WT-1/hooks/effective-config");
  });

  it("prints help on unknown subcommand", async () => {
    const { runHooks } = await import("./hooks");
    await expect(runHooks(["unknown"])).rejects.toThrow();
  });

  it("prints help with no args", async () => {
    const { runHooks } = await import("./hooks");
    // Should print help and not throw
    await runHooks(["--help"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern hooks`
Expected: FAIL — module not found

- [ ] **Step 3: Implement hooks.ts**

```typescript
// apps/cli/src/hooks.ts
import { requireWorktreeId, serverJson, parseFlag, hasFlag } from "./server-client";
import { log } from "./logger";

function printHelp() {
  log.plain(`openkit hooks — manage verification hooks

Usage:
  openkit hooks run [--worktree <id>] [--trigger <trigger>] [--step <stepId>]
  openkit hooks status [--worktree <id>]
  openkit hooks report [--worktree <id>] --skill <name> --trigger <trigger> --success|--failed [--summary <text>] [--file <path>]
  openkit hooks config [--worktree <id>]

Triggers: pre-implementation, post-implementation, custom, on-demand, worktree-created, worktree-removed`);
}

async function runRun(args: string[], json: boolean) {
  const worktreeId = requireWorktreeId(parseFlag(args, "worktree"));
  const trigger = parseFlag(args, "trigger");
  const stepId = parseFlag(args, "step");

  let result: unknown;
  if (stepId) {
    result = await serverJson(
      `/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/run/${encodeURIComponent(stepId)}`,
      { method: "POST" },
    );
  } else {
    result = await serverJson(`/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger }),
    });
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    log.success("Hooks run completed");
    log.plain(JSON.stringify(result, null, 2));
  }
}

async function runStatus(args: string[], json: boolean) {
  const worktreeId = requireWorktreeId(parseFlag(args, "worktree"));
  const result = await serverJson(`/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/status`);

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    log.plain(JSON.stringify(result, null, 2));
  }
}

async function runReport(args: string[], json: boolean) {
  const worktreeId = requireWorktreeId(parseFlag(args, "worktree"));
  const skillName = parseFlag(args, "skill");
  const trigger = parseFlag(args, "trigger");
  const success = hasFlag(args, "success");
  const failed = hasFlag(args, "failed");
  const summary = parseFlag(args, "summary");
  const filePath = parseFlag(args, "file");

  if (!skillName) throw new Error("--skill is required");
  if (!trigger) throw new Error("--trigger is required");
  if (!success && !failed) throw new Error("--success or --failed is required");

  const body: Record<string, unknown> = {
    skillName,
    trigger,
    success: success && !failed,
  };
  if (summary) body.summary = summary;
  if (filePath) body.filePath = filePath;

  const result = await serverJson(`/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    log.success("Hook status reported");
  }
}

async function runConfig(args: string[], json: boolean) {
  const worktreeId = parseFlag(args, "worktree");
  const apiPath = worktreeId
    ? `/api/worktrees/${encodeURIComponent(worktreeId)}/hooks/effective-config`
    : "/api/hooks/config";

  const result = await serverJson(apiPath);

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    log.plain(JSON.stringify(result, null, 2));
  }
}

export async function runHooks(rawArgs: string[]) {
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printHelp();
    return;
  }

  const subcommand = rawArgs[0];
  const args = rawArgs.slice(1);
  const json = hasFlag(rawArgs, "json");

  switch (subcommand) {
    case "run":
      return runRun(args, json);
    case "status":
      return runStatus(args, json);
    case "report":
      return runReport(args, json);
    case "config":
      return runConfig(args, json);
    default:
      throw new Error(
        `Unknown hooks subcommand "${subcommand}". Run "openkit hooks --help" for usage.`,
      );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern hooks`
Expected: All PASS

---

## Chunk 3: Notify + Git Ops CLI

### Task 5: Create notify.ts CLI command

**Files:**

- Create: `apps/cli/src/notify.ts`
- Create: `apps/cli/src/notify.test.ts`

- [ ] **Step 1: Write failing tests for notify CLI**

```typescript
// apps/cli/src/notify.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./server-client", () => ({
  inferWorktreeIdFromCwd: vi.fn(() => null),
  serverJson: vi.fn(),
}));

import { serverJson, inferWorktreeIdFromCwd } from "./server-client";

const mockServerJson = vi.mocked(serverJson);
const mockInferWorktreeId = vi.mocked(inferWorktreeIdFromCwd);

beforeEach(() => vi.clearAllMocks());

describe("runNotify", () => {
  it("sends a basic notification", async () => {
    const { runNotify } = await import("./notify");
    mockServerJson.mockResolvedValue({ success: true });
    await runNotify(["--message", "Build started"]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/activity",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"title":"Build started"'),
      }),
    );
  });

  it("sends require-action notification", async () => {
    const { runNotify } = await import("./notify");
    mockServerJson.mockResolvedValue({ success: true });
    await runNotify(["--message", "Need approval", "--require-action"]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/activity",
      expect.objectContaining({
        body: expect.stringContaining('"requiresUserAction":true'),
      }),
    );
  });

  it("includes severity", async () => {
    const { runNotify } = await import("./notify");
    mockServerJson.mockResolvedValue({ success: true });
    await runNotify(["--message", "Done", "--severity", "success"]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/activity",
      expect.objectContaining({
        body: expect.stringContaining('"severity":"success"'),
      }),
    );
  });

  it("throws when message is missing", async () => {
    const { runNotify } = await import("./notify");
    await expect(runNotify([])).rejects.toThrow("--message is required");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern notify`
Expected: FAIL

- [ ] **Step 3: Implement notify.ts**

```typescript
// apps/cli/src/notify.ts
import { ACTIVITY_TYPES } from "@openkit/shared/activity-event";
import { inferWorktreeIdFromCwd, serverJson, parseFlag, hasFlag } from "./server-client";
import { log } from "./logger";

function printHelp() {
  log.plain(`openkit notify — send activity notification

Usage:
  openkit notify --message "<msg>" [--severity info|success|warning|error] [--worktree <id>] [--require-action]

Options:
  --message         Status message (required)
  --severity        info (default), success, warning, error
  --worktree        Related worktree ID (auto-inferred from cwd if omitted)
  --require-action  Mark as requiring user input (pins to top of feed)
  --json            Output JSON response`);
}

export async function runNotify(rawArgs: string[]) {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printHelp();
    return;
  }

  const message = parseFlag(rawArgs, "message");
  if (!message) throw new Error("--message is required");

  const severity = parseFlag(rawArgs, "severity") ?? "info";
  const worktreeId = parseFlag(rawArgs, "worktree") ?? inferWorktreeIdFromCwd() ?? undefined;
  const requireAction = hasFlag(rawArgs, "require-action");
  const json = hasFlag(rawArgs, "json");

  const eventType = requireAction ? ACTIVITY_TYPES.AGENT_AWAITING_INPUT : ACTIVITY_TYPES.NOTIFY;

  const body = {
    category: "agent",
    type: eventType,
    severity,
    title: message,
    worktreeId,
    metadata: requireAction
      ? { requiresUserAction: true, awaitingUserInput: true, source: "cli" }
      : { source: "cli" },
  };

  const result = await serverJson("/api/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    log.success("Notification sent");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern notify`
Expected: All PASS

### Task 6: Create git-ops.ts CLI command

**Files:**

- Create: `apps/cli/src/git-ops.ts`
- Create: `apps/cli/src/git-ops.test.ts`

- [ ] **Step 1: Write failing tests for git-ops CLI**

```typescript
// apps/cli/src/git-ops.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./server-client", () => ({
  requireWorktreeId: vi.fn((explicit) => explicit ?? "WT-1"),
  serverJson: vi.fn(),
}));

import { requireWorktreeId, serverJson } from "./server-client";

const mockServerJson = vi.mocked(serverJson);

beforeEach(() => vi.clearAllMocks());

describe("runGitOps", () => {
  it("commits with message", async () => {
    const { runGitOps } = await import("./git-ops");
    mockServerJson.mockResolvedValue({ success: true });
    await runGitOps("commit", ["--worktree", "WT-1", "--message", "fix: thing"]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/worktrees/WT-1/commit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "fix: thing" }),
      }),
    );
  });

  it("commit throws when message missing", async () => {
    const { runGitOps } = await import("./git-ops");
    await expect(runGitOps("commit", ["--worktree", "WT-1"])).rejects.toThrow(
      "--message is required",
    );
  });

  it("pushes branch", async () => {
    const { runGitOps } = await import("./git-ops");
    mockServerJson.mockResolvedValue({ success: true });
    await runGitOps("push", ["--worktree", "WT-1"]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/worktrees/WT-1/push",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("creates PR with title and body", async () => {
    const { runGitOps } = await import("./git-ops");
    mockServerJson.mockResolvedValue({ success: true, url: "https://github.com/test/pr/1" });
    await runGitOps("pr", ["--worktree", "WT-1", "--title", "feat: new", "--body", "Details"]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/worktrees/WT-1/create-pr",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "feat: new", body: "Details" }),
      }),
    );
  });

  it("pr throws when title missing", async () => {
    const { runGitOps } = await import("./git-ops");
    await expect(runGitOps("pr", ["--worktree", "WT-1"])).rejects.toThrow("--title is required");
  });

  it("checks git policy", async () => {
    const { runGitOps } = await import("./git-ops");
    mockServerJson.mockResolvedValue({
      success: true,
      policies: {
        commit: { allowed: true },
        push: { allowed: false, reason: "disabled" },
        create_pr: { allowed: true },
      },
    });
    await runGitOps("policy", ["--worktree", "WT-1"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/worktrees/WT-1/git-policy");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern git-ops`
Expected: FAIL

- [ ] **Step 3: Implement git-ops.ts**

```typescript
// apps/cli/src/git-ops.ts
import { requireWorktreeId, serverJson, parseFlag, hasFlag } from "./server-client";
import { log } from "./logger";

async function runCommit(args: string[], json: boolean) {
  const worktreeId = requireWorktreeId(parseFlag(args, "worktree"));
  const message = parseFlag(args, "message");
  if (!message) throw new Error("--message is required");

  const result = await serverJson<{ success: boolean; error?: string }>(
    `/api/worktrees/${encodeURIComponent(worktreeId)}/commit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    log.success("Committed");
  }
}

async function runPush(args: string[], json: boolean) {
  const worktreeId = requireWorktreeId(parseFlag(args, "worktree"));
  const result = await serverJson<{ success: boolean; error?: string }>(
    `/api/worktrees/${encodeURIComponent(worktreeId)}/push`,
    { method: "POST" },
  );

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    log.success("Pushed");
  }
}

async function runPr(args: string[], json: boolean) {
  const worktreeId = requireWorktreeId(parseFlag(args, "worktree"));
  const title = parseFlag(args, "title");
  if (!title) throw new Error("--title is required");
  const body = parseFlag(args, "body");

  const result = await serverJson<{ success: boolean; url?: string; error?: string }>(
    `/api/worktrees/${encodeURIComponent(worktreeId)}/create-pr`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    },
  );

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const r = result as { url?: string };
    if (r.url) {
      log.success(`PR created: ${r.url}`);
    } else {
      log.success("PR created");
    }
  }
}

async function runPolicy(args: string[], json: boolean) {
  const worktreeId = requireWorktreeId(parseFlag(args, "worktree"));
  const result = await serverJson<{
    success: boolean;
    policies: Record<string, { allowed: boolean; reason?: string }>;
  }>(`/api/worktrees/${encodeURIComponent(worktreeId)}/git-policy`);

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const policies = result.policies;
    for (const [op, policy] of Object.entries(policies)) {
      const status = policy.allowed ? "allowed" : `denied — ${policy.reason}`;
      log.plain(`  ${op}: ${status}`);
    }
  }
}

function printHelp(command: string) {
  const helpMap: Record<string, string> = {
    commit: `openkit commit — stage and commit changes

Usage: openkit commit [--worktree <id>] --message "<msg>" [--json]`,
    push: `openkit push — push current branch

Usage: openkit push [--worktree <id>] [--json]`,
    pr: `openkit pr — create a pull request

Usage: openkit pr [--worktree <id>] --title "<title>" [--body "<body>"] [--json]`,
    policy: `openkit policy — check git operation permissions

Usage: openkit policy [--worktree <id>] [--json]`,
  };
  log.plain(helpMap[command] ?? "Unknown command");
}

export async function runGitOps(command: string, rawArgs: string[]) {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printHelp(command);
    return;
  }

  const json = hasFlag(rawArgs, "json");

  switch (command) {
    case "commit":
      return runCommit(rawArgs, json);
    case "push":
      return runPush(rawArgs, json);
    case "pr":
      return runPr(rawArgs, json);
    case "policy":
      return runPolicy(rawArgs, json);
    default:
      throw new Error(`Unknown git command "${command}"`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern git-ops`
Expected: All PASS

---

## Chunk 4: Worktree + Issues + Context CLI

### Task 7: Create worktree-cmd.ts CLI command

**Files:**

- Create: `apps/cli/src/worktree-cmd.ts`
- Create: `apps/cli/src/worktree-cmd.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/cli/src/worktree-cmd.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./server-client", () => ({
  serverJson: vi.fn(),
  serverFetch: vi.fn(),
}));

import { serverJson, serverFetch } from "./server-client";

const mockServerJson = vi.mocked(serverJson);
const mockServerFetch = vi.mocked(serverFetch);

beforeEach(() => vi.clearAllMocks());

describe("runWorktree", () => {
  it("lists worktrees", async () => {
    const { runWorktree } = await import("./worktree-cmd");
    mockServerJson.mockResolvedValue({ worktrees: [{ id: "WT-1", branch: "feat/x" }] });
    await runWorktree(["list"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/worktrees");
  });

  it("creates a worktree", async () => {
    const { runWorktree } = await import("./worktree-cmd");
    mockServerJson.mockResolvedValue({ success: true });
    await runWorktree(["create", "--branch", "feat/new"]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/worktrees",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ branch: "feat/new" }),
      }),
    );
  });

  it("starts a worktree", async () => {
    const { runWorktree } = await import("./worktree-cmd");
    mockServerJson.mockResolvedValue({ success: true });
    await runWorktree(["start", "WT-1"]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/worktrees/WT-1/start",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("stops a worktree", async () => {
    const { runWorktree } = await import("./worktree-cmd");
    mockServerJson.mockResolvedValue({ success: true });
    await runWorktree(["stop", "WT-1"]);
    expect(mockServerJson).toHaveBeenCalledWith(
      "/api/worktrees/WT-1/stop",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("removes a worktree", async () => {
    const { runWorktree } = await import("./worktree-cmd");
    mockServerFetch.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await runWorktree(["remove", "WT-1"]);
    expect(mockServerFetch).toHaveBeenCalledWith(
      "/api/worktrees/WT-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws on missing worktree ID for start", async () => {
    const { runWorktree } = await import("./worktree-cmd");
    await expect(runWorktree(["start"])).rejects.toThrow();
  });

  it("outputs JSON when --json flag is set", async () => {
    const { runWorktree } = await import("./worktree-cmd");
    const worktrees = [{ id: "WT-1", branch: "feat/x" }];
    mockServerJson.mockResolvedValue({ worktrees });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runWorktree(["list", "--json"]);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"WT-1"'));
    writeSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern worktree-cmd`
Expected: FAIL

- [ ] **Step 3: Implement worktree-cmd.ts**

```typescript
// apps/cli/src/worktree-cmd.ts
import { serverJson, serverFetch, parseFlag, hasFlag } from "./server-client";
import { log } from "./logger";

function printHelp() {
  log.plain(`openkit worktree — manage worktrees

Usage:
  openkit worktree list [--json]
  openkit worktree create --branch <branch> [--json]
  openkit worktree start <id> [--json]
  openkit worktree stop <id> [--json]
  openkit worktree remove <id> [--json]`);
}

export async function runWorktree(rawArgs: string[]) {
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printHelp();
    return;
  }

  const subcommand = rawArgs[0];
  const args = rawArgs.slice(1);
  const json = hasFlag(rawArgs, "json");

  switch (subcommand) {
    case "list": {
      const result = await serverJson("/api/worktrees");
      if (json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        const r = result as { worktrees: Array<{ id: string; branch: string; status?: string }> };
        for (const wt of r.worktrees) {
          log.plain(`  ${wt.id}  ${wt.branch}  ${wt.status ?? ""}`);
        }
      }
      return;
    }
    case "create": {
      const branch = parseFlag(args, "branch");
      if (!branch) throw new Error("--branch is required");
      const result = await serverJson("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch }),
      });
      if (json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        log.success(`Worktree created on branch ${branch}`);
      }
      return;
    }
    case "start":
    case "stop": {
      const id = args.find((a) => !a.startsWith("--"));
      if (!id) throw new Error("Worktree ID is required");
      const result = await serverJson(`/api/worktrees/${encodeURIComponent(id)}/${subcommand}`, {
        method: "POST",
      });
      if (json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        log.success(`Worktree ${id} ${subcommand === "start" ? "started" : "stopped"}`);
      }
      return;
    }
    case "remove": {
      const id = args.find((a) => !a.startsWith("--"));
      if (!id) throw new Error("Worktree ID is required");
      const response = await serverFetch(`/api/worktrees/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as { success: boolean; error?: string };
      if (!response.ok || !body.success) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      if (json) {
        process.stdout.write(JSON.stringify(body, null, 2) + "\n");
      } else {
        log.success(`Worktree ${id} removed`);
      }
      return;
    }
    default:
      throw new Error(
        `Unknown worktree subcommand "${subcommand}". Run "openkit worktree --help" for usage.`,
      );
  }
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern worktree-cmd`
Expected: All PASS

### Task 8: Create issues.ts CLI command

**Files:**

- Create: `apps/cli/src/issues.ts`
- Create: `apps/cli/src/issues.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/cli/src/issues.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./server-client", () => ({
  serverJson: vi.fn(),
}));

import { serverJson } from "./server-client";

const mockServerJson = vi.mocked(serverJson);

beforeEach(() => vi.clearAllMocks());

describe("runIssues", () => {
  it("lists jira issues", async () => {
    const { runIssues } = await import("./issues");
    mockServerJson.mockResolvedValue({ issues: [] });
    await runIssues(["list", "--source", "jira"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/jira/issues");
  });

  it("lists linear issues", async () => {
    const { runIssues } = await import("./issues");
    mockServerJson.mockResolvedValue({ issues: [] });
    await runIssues(["list", "--source", "linear"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/linear/issues");
  });

  it("gets a jira issue by key", async () => {
    const { runIssues } = await import("./issues");
    mockServerJson.mockResolvedValue({ issue: { key: "PROJ-1" } });
    await runIssues(["get", "PROJ-1", "--source", "jira"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/jira/issues/PROJ-1");
  });

  it("gets a linear issue by identifier", async () => {
    const { runIssues } = await import("./issues");
    mockServerJson.mockResolvedValue({ issue: { identifier: "ENG-1" } });
    await runIssues(["get", "ENG-1", "--source", "linear"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/linear/issues/ENG-1");
  });

  it("throws when get has no ID", async () => {
    const { runIssues } = await import("./issues");
    await expect(runIssues(["get"])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern issues`
Expected: FAIL

- [ ] **Step 3: Implement issues.ts**

```typescript
// apps/cli/src/issues.ts
import { serverJson, parseFlag, hasFlag } from "./server-client";
import { log } from "./logger";

function printHelp() {
  log.plain(`openkit issues — browse Jira/Linear issues

Usage:
  openkit issues list [--source jira|linear] [--json]
  openkit issues get <id> [--source jira|linear] [--json]`);
}

async function listIssues(source: string | undefined, json: boolean) {
  const sources = source ? [source] : ["jira", "linear"];
  const allIssues: Array<{ source: string; issues: unknown[] }> = [];

  for (const s of sources) {
    try {
      const result = await serverJson<{ issues: unknown[] }>(`/api/${s}/issues`);
      allIssues.push({ source: s, issues: result.issues });
    } catch {
      // Integration not configured — skip silently
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(allIssues, null, 2) + "\n");
  } else {
    for (const group of allIssues) {
      log.plain(`\n  ${group.source.toUpperCase()}:`);
      for (const issue of group.issues as Array<{
        key?: string;
        identifier?: string;
        summary?: string;
        title?: string;
      }>) {
        const id = issue.key ?? issue.identifier ?? "?";
        const title = issue.summary ?? issue.title ?? "";
        log.plain(`    ${id}  ${title}`);
      }
    }
  }
}

async function getIssue(id: string, source: string | undefined, json: boolean) {
  const sources = source ? [source] : ["jira", "linear"];

  for (const s of sources) {
    try {
      const result = await serverJson(`/api/${s}/issues/${encodeURIComponent(id)}`);
      if (json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        log.plain(JSON.stringify(result, null, 2));
      }
      return;
    } catch {
      // Try next source
    }
  }

  throw new Error(`Issue "${id}" not found in ${sources.join(" or ")}`);
}

export async function runIssues(rawArgs: string[]) {
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printHelp();
    return;
  }

  const subcommand = rawArgs[0];
  const args = rawArgs.slice(1);
  const source = parseFlag(args, "source");
  const json = hasFlag(rawArgs, "json");

  switch (subcommand) {
    case "list":
      return listIssues(source, json);
    case "get": {
      const id = args.find((a) => !a.startsWith("--"));
      if (!id) throw new Error("Issue ID is required");
      return getIssue(id, source, json);
    }
    default:
      throw new Error(
        `Unknown issues subcommand "${subcommand}". Run "openkit issues --help" for usage.`,
      );
  }
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern issues`
Expected: All PASS

### Task 9: Create context.ts CLI command

**Files:**

- Create: `apps/cli/src/context.ts`
- Create: `apps/cli/src/context.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/cli/src/context.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./server-client", () => ({
  requireWorktreeId: vi.fn((explicit) => explicit ?? "WT-1"),
  serverJson: vi.fn(),
  hasFlag: vi.fn((args, name) => args.includes(`--${name}`)),
}));

import { serverJson } from "./server-client";

const mockServerJson = vi.mocked(serverJson);

beforeEach(() => vi.clearAllMocks());

describe("runContext", () => {
  it("reads task context for a worktree", async () => {
    const { runContext } = await import("./context");
    mockServerJson
      .mockResolvedValueOnce({
        worktrees: [{ id: "WT-1", linkedIssue: { source: "jira", issueId: "PROJ-1" } }],
      })
      .mockResolvedValueOnce({ personal: "notes", aiContext: "context", todos: [] });
    await runContext("context", ["--worktree", "WT-1"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/worktrees");
    expect(mockServerJson).toHaveBeenCalledWith("/api/notes/jira/PROJ-1");
  });

  it("reads notes for an issue", async () => {
    const { runContext } = await import("./context");
    mockServerJson.mockResolvedValue({ personal: "", aiContext: "", todos: [] });
    await runContext("notes", ["jira", "PROJ-1"]);
    expect(mockServerJson).toHaveBeenCalledWith("/api/notes/jira/PROJ-1");
  });

  it("throws when notes missing source", async () => {
    const { runContext } = await import("./context");
    await expect(runContext("notes", [])).rejects.toThrow();
  });

  it("throws when notes missing issue ID", async () => {
    const { runContext } = await import("./context");
    await expect(runContext("notes", ["jira"])).rejects.toThrow();
  });

  it("outputs JSON when --json flag set", async () => {
    const { runContext } = await import("./context");
    const notes = { personal: "test", aiContext: "", todos: [] };
    mockServerJson.mockResolvedValue(notes);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runContext("notes", ["jira", "PROJ-1", "--json"]);
    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern context`
Expected: FAIL

- [ ] **Step 3: Implement context.ts**

```typescript
// apps/cli/src/context.ts
import { requireWorktreeId, serverJson, hasFlag } from "./server-client";
import { log } from "./logger";

function printHelp(command: string) {
  if (command === "notes") {
    log.plain(`openkit notes — read issue notes and todos

Usage: openkit notes <source> <issue-id> [--json]

Sources: jira, linear, local`);
  } else {
    log.plain(`openkit context — read task context for a worktree

Usage: openkit context [--worktree <id>] [--json]

Reads the worktree's linked issue data (notes, todos, AI context).`);
  }
}

async function runNotes(args: string[], json: boolean) {
  const positional = args.filter((a) => !a.startsWith("--"));
  const source = positional[0];
  const issueId = positional[1];

  if (!source) throw new Error("Source is required (jira, linear, or local)");
  if (!issueId) throw new Error("Issue ID is required");

  const result = await serverJson(
    `/api/notes/${encodeURIComponent(source)}/${encodeURIComponent(issueId)}`,
  );

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const r = result as {
      personal?: string;
      aiContext?: string;
      todos?: Array<{ id: string; text: string; checked: boolean }>;
    };
    if (r.aiContext) {
      log.plain("\n  AI Context:");
      log.plain(`    ${r.aiContext}`);
    }
    if (r.personal) {
      log.plain("\n  Personal Notes:");
      log.plain(`    ${r.personal}`);
    }
    if (r.todos && r.todos.length > 0) {
      log.plain("\n  Todos:");
      for (const todo of r.todos) {
        log.plain(`    [${todo.checked ? "x" : " "}] ${todo.text}  (${todo.id})`);
      }
    }
  }
}

async function runContextCmd(args: string[], json: boolean) {
  const worktreeId = requireWorktreeId(
    args.find((a) => {
      const idx = args.indexOf("--worktree");
      return idx >= 0 ? args[idx + 1] : undefined;
    }) as string | undefined,
  );

  // Find the worktree's linked issue
  const allWorktrees = await serverJson<{
    worktrees: Array<{ id: string; linkedIssue?: { source: string; issueId: string } }>;
  }>("/api/worktrees");
  const wt = allWorktrees.worktrees.find((w) => w.id === worktreeId);
  if (!wt) throw new Error(`Worktree "${worktreeId}" not found`);
  if (!wt.linkedIssue) throw new Error(`Worktree "${worktreeId}" has no linked issue`);

  const { source, issueId } = wt.linkedIssue;
  const notes = await serverJson(
    `/api/notes/${encodeURIComponent(source)}/${encodeURIComponent(issueId)}`,
  );

  if (json) {
    process.stdout.write(JSON.stringify({ worktreeId, source, issueId, notes }, null, 2) + "\n");
  } else {
    log.plain(`  Worktree: ${worktreeId}`);
    log.plain(`  Issue: ${source}/${issueId}`);
    const r = notes as {
      personal?: string;
      aiContext?: string;
      todos?: Array<{ id: string; text: string; checked: boolean }>;
    };
    if (r.aiContext) log.plain(`\n  AI Context:\n    ${r.aiContext}`);
    if (r.personal) log.plain(`\n  Notes:\n    ${r.personal}`);
  }
}

export async function runContext(command: string, rawArgs: string[]) {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printHelp(command);
    return;
  }

  const json = hasFlag(rawArgs, "json");

  switch (command) {
    case "notes":
      return runNotes(rawArgs, json);
    case "context":
      return runContextCmd(rawArgs, json);
    default:
      throw new Error(`Unknown command "${command}"`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:test -- --testPathPattern context`
Expected: All PASS

---

## Chunk 5: Router + Skill Deployment + Skill Update + Docs

### Task 10: Register all new subcommands in index.ts

**Files:**

- Modify: `apps/cli/src/index.ts`

- [ ] **Step 1: Update help text**

Add new commands to the help text block (around line 136-154):

```
Commands:
  (default)     Start the server and open the UI
  init          Interactive setup wizard to create .openkit/config.json
  add [name]    Set up an integration (github, linear, jira)
  ui            Manage optional UI components (web/desktop)
  activity      Emit workflow activity events (for agent/user coordination)
  task          Manage task resolution and worktree creation
  hooks         Run and manage verification hooks
  notify        Send activity notifications
  commit        Stage and commit worktree changes
  push          Push worktree branch
  pr            Create a pull request
  policy        Check git operation permissions
  worktree      Manage worktrees (list, create, start, stop, remove)
  issues        Browse Jira/Linear issues
  context       Read task context for a worktree
  notes         Read issue notes and todos
```

- [ ] **Step 2: Add subcommand routing**

After the existing `activity` subcommand block, add:

```typescript
if (subcommand === "hooks") {
  const { runHooks } = await import("./hooks");
  await runHooks(process.argv.slice(3));
  return;
}

if (subcommand === "notify") {
  const { runNotify } = await import("./notify");
  await runNotify(process.argv.slice(3));
  return;
}

if (
  subcommand === "commit" ||
  subcommand === "push" ||
  subcommand === "pr" ||
  subcommand === "policy"
) {
  const { runGitOps } = await import("./git-ops");
  await runGitOps(subcommand, process.argv.slice(3));
  return;
}

if (subcommand === "worktree") {
  const { runWorktree } = await import("./worktree-cmd");
  await runWorktree(process.argv.slice(3));
  return;
}

if (subcommand === "issues") {
  const { runIssues } = await import("./issues");
  await runIssues(process.argv.slice(3));
  return;
}

if (subcommand === "context" || subcommand === "notes") {
  const { runContext } = await import("./context");
  await runContext(subcommand, process.argv.slice(3));
  return;
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:typecheck`
Expected: No errors

### Task 11: Fix skill deployment on project open

**Files:**

- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Add `enableDefaultProjectSkills` call at startup**

In `apps/server/src/index.ts`, find the line that calls `ensureBundledSkills()` (around line 279). **Replace** it with `enableDefaultProjectSkills()`, which internally calls `ensureBundledSkills()` and then also deploys project skills:

```typescript
import { enableDefaultProjectSkills } from "./lib/project-skill-bootstrap";

// Replace ensureBundledSkills() with:
enableDefaultProjectSkills(manager.getConfigDir());
```

This avoids calling `ensureBundledSkills()` twice since `enableDefaultProjectSkills` already calls it internally.

- [ ] **Step 2: Run tests to verify no regressions**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm test`
Expected: All pass

### Task 12: Update work-on-task skill

**Files:**

- Modify: `libs/agents/src/skills/work-on-task/SKILL.md`

- [ ] **Step 1: Replace MCP references with CLI commands**

Update the skill to reference the new CLI commands. Key changes:

1. Step 8: Change "Inspect `.openkit/hooks.json`" to "Run `openkit hooks config` to inspect hook configuration."
2. Step 10: Change "Run pre-implementation checks before changing code" to "Run pre-implementation hooks: `openkit hooks run --trigger pre-implementation`"
3. Step 16: Change "Run post-implementation checks" to "Run post-implementation hooks: `openkit hooks run --trigger post-implementation`"
4. Step 20: Replace the MCP/terminal dual path with: "Run `openkit notify --require-action --message \"<what you need>\"`"
5. Remove guardrail "Keep MCP tooling as fallback; do not remove MCP configuration."
6. Add guardrail: "Always run `openkit policy` before commit/push/pr operations."
7. Add a new "Git Operations" section after the workflow:

```markdown
## Git Operations

Before any git operation, check permissions:

- `openkit policy` — verify commit/push/pr are allowed

Then proceed:

- `openkit commit --message "<msg>"` — stage all changes and commit
- `openkit push` — push current branch to remote
- `openkit pr --title "<title>" [--body "<body>"]` — create a pull request

## Browsing Issues

- `openkit issues list [--source jira|linear]` — list available issues
- `openkit issues get <id> [--source jira|linear]` — get issue details

## Reading Context

- `openkit context` — read task context for current worktree
- `openkit notes <source> <issue-id>` — read issue notes and todos
```

- [ ] **Step 2: Verify skill content is valid markdown**

Read the file and confirm no broken formatting.

### Task 13: Update documentation

**Files:**

- Modify: `docs/CLI.md`
- Modify: `docs/API.md`
- Modify: `docs/AGENTS.md`

- [ ] **Step 1: Update docs/CLI.md**

Add sections for each new command group with usage examples and flag descriptions. Follow the existing format in the file.

- [ ] **Step 2: Update docs/API.md**

Add the new `GET /api/worktrees/:id/git-policy` endpoint documentation.

- [ ] **Step 3: Update docs/AGENTS.md**

Update the agent capability reference to reflect that all capabilities are now available via CLI.

- [ ] **Step 4: Update docs/ARCHITECTURE.md**

Update the CLI section to list all new command groups.

### Task 14: Final verification

- [ ] **Step 1: Run all tests**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm test`
Expected: All pass

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm nx run cli:typecheck && pnpm nx run server:typecheck`
Expected: No errors

- [ ] **Step 3: Run lint + format**

Run: `cd /Users/fum4/_work/dawg/.openkit/worktrees/mcp-fixes && pnpm check:lint && pnpm check:format`
Expected: Clean
