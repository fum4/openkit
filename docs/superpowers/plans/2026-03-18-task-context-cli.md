# Task Context CLI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the TASK.md file generation system with an `openkit task context` CLI command that reads all task data on demand.

**Architecture:** New CLI subcommand reads `.openkit/issues/<source>/<id>/issue.json` + `notes.json` + global hooks config, resolves effective hooks with per-issue overrides, and outputs merged context as markdown (default) or JSON (`--json`). All TASK.md write/regenerate code is removed from server and manager.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo (CLI at `apps/cli`, shared libs at `libs/shared`, server at `apps/server`)

---

### Task 1: Rename local `task.json` → `issue.json`

**Files:**

- Modify: `apps/server/src/routes/tasks.ts` (saveTask, loadTask helpers)
- Modify: `apps/server/src/manager.ts:727-738` (local issue read in getWorktrees)
- Modify: `apps/cli/src/task.ts` (hasStoredIssue, processLocalTask, fetchLocalIssueChoices)
- Modify: `apps/server/src/routes/tasks.test.ts:202` (test reads task.json)

- [ ] **Step 1: Update server `loadTask` to read `issue.json` with `task.json` fallback**

In `apps/server/src/routes/tasks.ts`, the `loadTask` function reads from `task.json`. Change to try `issue.json` first, fall back to `task.json`:

```typescript
function loadTask(configDir: string, id: string): CustomTask | null {
  const dir = path.join(getTasksDir(configDir), id);
  // Try issue.json first (new name), fall back to task.json (legacy)
  const issuePath = path.join(dir, "issue.json");
  const legacyPath = path.join(dir, "task.json");
  const filePath = existsSync(issuePath) ? issuePath : legacyPath;
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as CustomTask;
}
```

- [ ] **Step 2: Update server `saveTask` to always write `issue.json`**

```typescript
function saveTask(configDir: string, task: CustomTask): void {
  const dir = path.join(ensureTasksDir(configDir), task.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "issue.json"), JSON.stringify(task, null, 2));
}
```

- [ ] **Step 3: Update `manager.ts:727-738` local issue read**

In `apps/server/src/manager.ts`, the `getWorktrees()` method reads `task.json` at line 729 for local issue metadata. Update to try `issue.json` first:

```typescript
if (linked.source === "local") {
  // Read the local issue.json (or legacy task.json) for identifier and status
  const issueFile = path.join(issueDir, "issue.json");
  const legacyFile = path.join(issueDir, "task.json");
  const taskFile = existsSync(issueFile) ? issueFile : legacyFile;
  if (existsSync(taskFile)) {
```

- [ ] **Step 4: Update CLI `hasStoredIssue` to check `issue.json` with fallback**

In `apps/cli/src/task.ts`, change `hasStoredIssue`:

```typescript
function hasStoredIssue(configDir: string, source: Source, issueId: string): boolean {
  const dir = path.join(issuesDir(configDir, source), issueId);
  return existsSync(path.join(dir, "issue.json")) || existsSync(path.join(dir, "task.json"));
}
```

- [ ] **Step 5: Update CLI `processLocalTask` to read `issue.json` with fallback**

In `apps/cli/src/task.ts`, `processLocalTask` reads `task.json` at line 764. Change:

```typescript
const issueFile = path.join(issueDir, "issue.json");
const legacyFile = path.join(issueDir, "task.json");
const taskFile = existsSync(issueFile) ? issueFile : legacyFile;
```

- [ ] **Step 6: Update CLI `fetchLocalIssueChoices` to read `issue.json` with fallback**

In `apps/cli/src/task.ts`, `fetchLocalIssueChoices` reads `task.json` at line 480. Change:

```typescript
const issueFile = path.join(dir, entry.name, "issue.json");
const legacyFile = path.join(dir, entry.name, "task.json");
const taskFile = existsSync(issueFile) ? issueFile : legacyFile;
if (!existsSync(taskFile)) continue;
```

- [ ] **Step 7: Update test that reads `task.json` after PATCH**

In `apps/server/src/routes/tasks.test.ts:202`, the test "persists the updated description to task.json" reads back `task.json`. Update to read `issue.json`:

```typescript
const taskFile = path.join(configDir, ".openkit", "issues", "local", "LOCAL-4", "issue.json");
```

Also rename the test: "persists the updated description to issue.json".

- [ ] **Step 8: Run server tests**

Run: `pnpm nx run server:test`
Expected: All pass.

- [ ] **Step 9: Run CLI build**

Run: `pnpm nx run cli:build`
Expected: Build succeeds.

---

### Task 2: Refactor `formatTaskContext` in shared lib

**Files:**

- Modify: `libs/shared/src/task-context.ts`
- Rewrite: `apps/server/src/__test__/task-context.test.ts`

- [ ] **Step 1: Write tests for `formatTaskContext` (markdown and JSON)**

Rewrite `apps/server/src/__test__/task-context.test.ts`. Remove all existing tests for `generateTaskMd`, `writeTaskMd`. Write new tests for `formatTaskContext` and `formatTaskContextJson`:

```typescript
import { describe, expect, it } from "vitest";
import { formatTaskContext, formatTaskContextJson } from "@openkit/shared/task-context";
import type { TaskContextData, HooksInfo } from "@openkit/shared/task-context";

function makeData(overrides?: Partial<TaskContextData>): TaskContextData {
  return {
    source: "local",
    issueId: "LOCAL-1",
    identifier: "LOCAL-1",
    title: "Test task",
    description: "A test description",
    status: "todo",
    url: "",
    ...overrides,
  };
}

describe("formatTaskContext", () => {
  it("renders header with identifier and title", () => {
    const md = formatTaskContext(makeData());
    expect(md).toContain("# LOCAL-1 — Test task");
    expect(md).toContain("**Source:** local");
    expect(md).toContain("**Status:** todo");
  });

  it("does not include workflow contract boilerplate", () => {
    const md = formatTaskContext(makeData());
    expect(md).not.toContain("Workflow Contract");
    expect(md).not.toContain("Agent Communication");
    expect(md).not.toContain("openkit activity phase");
  });

  it("renders AI context when provided", () => {
    const md = formatTaskContext(makeData(), "Follow TDD strictly");
    expect(md).toContain("## AI Context");
    expect(md).toContain("Follow TDD strictly");
  });

  it("omits AI context section when null", () => {
    const md = formatTaskContext(makeData(), null);
    expect(md).not.toContain("## AI Context");
  });

  it("renders description", () => {
    const md = formatTaskContext(makeData({ description: "Fix the bug" }));
    expect(md).toContain("## Description");
    expect(md).toContain("Fix the bug");
  });

  it("renders comments with dates", () => {
    const md = formatTaskContext(
      makeData({
        comments: [{ author: "Alice", body: "Looks good", created: "2026-03-15T10:00:00Z" }],
      }),
    );
    expect(md).toContain("**Alice (2026-03-15):** Looks good");
  });

  it("renders todos with checkbox syntax", () => {
    const md = formatTaskContext(makeData(), null, [
      { id: "t1", text: "First", checked: false },
      { id: "t2", text: "Second", checked: true },
    ]);
    expect(md).toContain("- [ ] First `(todo-id: t1)`");
    expect(md).toContain("- [x] Second `(todo-id: t2)`");
  });

  it("renders attachments with local paths", () => {
    const md = formatTaskContext(
      makeData({
        attachments: [{ filename: "img.png", localPath: "/tmp/img.png", mimeType: "image/png" }],
      }),
    );
    expect(md).toContain("`img.png` (image/png)");
  });

  it("renders pre-implementation hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        {
          id: "s1",
          name: "Lint",
          command: "pnpm lint",
          enabled: true,
          trigger: "pre-implementation",
        },
      ],
      skills: [],
    };
    const md = formatTaskContext(makeData(), null, undefined, hooks);
    expect(md).toContain("## Hooks (Pre-Implementation)");
    expect(md).toContain("**Lint:** `pnpm lint`");
  });

  it("renders post-implementation hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        {
          id: "s1",
          name: "Test",
          command: "pnpm test",
          enabled: true,
          trigger: "post-implementation",
        },
      ],
      skills: [],
    };
    const md = formatTaskContext(makeData(), null, undefined, hooks);
    expect(md).toContain("## Hooks (Post-Implementation)");
    expect(md).toContain("**Test:** `pnpm test`");
  });

  it("renders prompt hooks separately from command hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        {
          id: "s1",
          name: "Lint",
          command: "pnpm lint",
          enabled: true,
          trigger: "pre-implementation",
        },
        {
          id: "s2",
          name: "Review plan",
          command: "",
          prompt: "Review the plan before coding",
          kind: "prompt",
          enabled: true,
          trigger: "pre-implementation",
        },
      ],
      skills: [],
    };
    const md = formatTaskContext(makeData(), null, undefined, hooks);
    expect(md).toContain("### Pipeline Checks");
    expect(md).toContain("### Prompt Hooks");
    expect(md).toContain("**Review plan:** Review the plan before coding");
  });

  it("does not include auto-generated footer", () => {
    const md = formatTaskContext(makeData());
    expect(md).not.toContain("Auto-generated");
  });
});

describe("formatTaskContextJson", () => {
  it("returns structured object with reshaped hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        {
          id: "s1",
          name: "Lint",
          command: "pnpm lint",
          enabled: true,
          trigger: "pre-implementation",
        },
        { id: "s2", name: "Test", command: "pnpm test", enabled: true },
      ],
      skills: [{ skillName: "my-skill", enabled: true, trigger: "pre-implementation" }],
    };
    const result = formatTaskContextJson(
      makeData(),
      "ctx",
      [{ id: "t1", text: "Do it", checked: false }],
      hooks,
    );
    expect(result.identifier).toBe("LOCAL-1");
    expect(result.aiContext).toBe("ctx");
    expect(result.hooks.pre.commands).toHaveLength(1);
    expect(result.hooks.pre.skills).toHaveLength(1);
    expect(result.hooks.post.commands).toHaveLength(1);
  });

  it("places prompt hooks in prompts array, not commands", () => {
    const hooks: HooksInfo = {
      checks: [
        {
          id: "s1",
          name: "Review",
          command: "",
          prompt: "Review the plan",
          kind: "prompt",
          enabled: true,
          trigger: "pre-implementation",
        },
      ],
      skills: [],
    };
    const result = formatTaskContextJson(makeData(), null, undefined, hooks);
    expect(result.hooks.pre.prompts).toHaveLength(1);
    expect(result.hooks.pre.prompts[0].name).toBe("Review");
    expect(result.hooks.pre.commands).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run server:test`
Expected: Tests will fail with a TypeScript/import error (not assertion failure) — this is expected and confirms `formatTaskContext`/`formatTaskContextJson` don't exist yet.

- [ ] **Step 3: Refactor `libs/shared/src/task-context.ts`**

Remove: `generateTaskMd`, `writeTaskMd`, `ensureGitExclude`, `getWorktreeGitExcludePath`, the footer, and the `appendFileSync` import.

Add `formatTaskContext` (same rendering logic as `generateTaskMd` but without "Agent Communication", "Workflow Contract" sections, and without the footer). Add `formatTaskContextJson` that returns a structured object with hooks reshaped into `{ pre, post, custom }` groups each having `{ commands, prompts, skills }`. The prompt/command split uses the same `isPromptHook` logic from the old code.

Keep: `TaskContextData`, `HooksInfo` types.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx run server:test`
Expected: All pass.

---

### Task 3: Add `openkit task context` CLI command

**Files:**

- Modify: `apps/cli/src/task.ts` (add `runTaskContext` export)
- Modify: `apps/cli/src/index.ts` (register `context` subcommand)
- Create: `apps/cli/src/__test__/task-context.test.ts`
- Modify: `apps/cli/package.json` (add test script)
- Create: `apps/cli/vitest.config.ts` (if not present)

- [ ] **Step 0: Add test runner to CLI package**

The CLI has no test configuration. Add:

1. `apps/cli/package.json` — add `"test": "vitest run"` to scripts
2. `apps/cli/vitest.config.ts` — create with:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

Verify: `pnpm nx run cli:test` runs (with 0 tests initially).

- [ ] **Step 1: Write tests for `runTaskContext`**

Create `apps/cli/src/__test__/task-context.test.ts`:

Test cases:

- Explicit issue ID loads issue data and outputs markdown
- Explicit issue ID with `--json` outputs valid JSON
- Auto-detect worktree ID from cwd (mock cwd under `.openkit/worktrees/<id>`)
- Auto-detect from subdirectory of worktree (e.g. cwd is `.openkit/worktrees/<id>/src/`)
- Exit with error when not in a worktree and no issue ID given
- Exit with error when issue not found
- Fallback from `issue.json` to `task.json` works
- Hooks from `.openkit/hooks.json` are included in output
- Per-issue hook overrides from `notes.json` are applied

Mock: `fs` (existsSync, readFileSync, readdirSync), `process.cwd`, `process.exit`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run cli:test`
Expected: FAIL — `runTaskContext` doesn't exist yet.

- [ ] **Step 3: Implement `runTaskContext` in `apps/cli/src/task.ts`**

```typescript
export function runTaskContext(issueId: string | undefined, options: { json?: boolean }): void {
  const configDir = findConfigDir();
  if (!configDir) {
    log.error(`No config found. Run "${APP_NAME} init" first.`);
    process.exit(1);
  }

  let source: Source;
  let resolvedId: string;

  if (issueId) {
    // Explicit issue ID — resolve source.
    // resolveTaskSource throws on ambiguity — this is intentional.
    // The `context` command is non-interactive, so ambiguous IDs must error
    // with a message telling the agent to specify the source explicitly.
    const resolved = resolveTaskSource(configDir, issueId);
    source = resolved.source;
    resolvedId = resolved.resolvedId;
  } else {
    // Auto-detect from current worktree
    const detected = detectLinkedIssue(configDir);
    if (!detected) {
      log.error("Not in a worktree or no linked issue found. Provide an issue ID.");
      process.exit(1);
    }
    source = detected.source;
    resolvedId = detected.issueId;
  }

  const issueDir = path.join(configDir, CONFIG_DIR_NAME, "issues", source, resolvedId);
  const data = loadIssueDataForContext(issueDir, source, resolvedId);
  if (!data) {
    log.error(`Issue ${source}:${resolvedId} not found.`);
    process.exit(1);
  }

  const notes = loadNotesFile(issueDir);
  const hooks = resolveEffectiveHooks(configDir, notes);

  if (options.json) {
    log.plain(
      JSON.stringify(
        formatTaskContextJson(data, notes.aiContext?.content, notes.todos, hooks),
        null,
        2,
      ),
    );
  } else {
    log.plain(formatTaskContext(data, notes.aiContext?.content, notes.todos, hooks));
  }
}
```

Helper functions to add in the same file:

- `detectLinkedIssue(configDir)` — walks up from `process.cwd()` to find worktree root (a directory whose parent path contains `.openkit/worktrees`). Works even when cwd is a subdirectory like `src/`. Extracts worktree ID from the directory name. Scans `.openkit/issues/*/*/notes.json` files for `linkedWorktreeId` match.
- `loadIssueDataForContext(issueDir, source, id)` — reads `issue.json` (or `task.json` fallback) and maps to `TaskContextData`.
- `loadNotesFile(issueDir)` — reads `notes.json` or returns defaults.
- `resolveEffectiveHooks(configDir, notes)` — reads `.openkit/hooks.json` directly (no WorktreeManager needed), applies `notes.hookSkills` overrides inline, returns `HooksInfo`. This is a standalone read — no file watchers or server instances.

- [ ] **Step 4: Register `context` subcommand in `apps/cli/src/index.ts`**

In the task subcommand block (after the `resolve` handling around line 266), add:

```typescript
if (first === "context") {
  const contextIssueId = positional[1];
  runTaskContext(contextIssueId, { json: jsonOutput });
  return;
}
```

Also update the `--json` restriction (around line 270) to allow both `resolve` and `context`:

```typescript
if (jsonOutput && first !== "resolve" && first !== "context") {
```

- [ ] **Step 5: Run tests**

Run: `pnpm nx run cli:test`
Expected: All pass.

- [ ] **Step 6: Manual smoke test**

Run from a worktree directory:

```bash
cd .openkit/worktrees/LOCAL-4
openkit task context LOCAL-4
openkit task context LOCAL-4 --json
```

Expected: Markdown output and JSON output respectively.

---

### Task 4: Remove TASK.md generation from server

**Files:**

- Delete: `apps/server/src/task-context.ts` (all callers removed — `loadIssueData` only called by `regenerateTaskMd`)
- Modify: `apps/server/src/manager.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/routes/tasks.ts`
- Modify: `apps/server/src/routes/notes.ts`
- Modify: `apps/server/src/routes/tasks.test.ts`

- [ ] **Step 1: Delete `apps/server/src/task-context.ts`**

Delete the entire file. All its exports (`regenerateTaskMd`, `writeTaskMdForWorktree`, `PendingTaskContext`, `HooksInfo` re-export, `loadIssueData`) are only used by TASK.md generation code being removed in subsequent steps. The `HooksInfo` type is imported directly from `@openkit/shared/task-context` where needed.

- [ ] **Step 2: Remove TASK.md plumbing from `apps/server/src/manager.ts`**

Remove:

- Import of `writeTaskMd`, `generateTaskMd` from `./task-context` (line 56)
- Import of `HooksInfo`, `PendingTaskContext` from `./task-context` (line 55)
- `pendingWorktreeContext` map declaration (line 212)
- `taskHooksProvider` declaration (line 248)
- `setPendingWorktreeContext` / `clearPendingWorktreeContext` methods (lines 543-549)
- `setTaskHooksProvider` method (lines 518-520)
- The TASK.md write block in worktree creation (lines 1368-1383)
- All `pendingWorktreeContext.set()`/`.get()`/`.delete()` calls throughout the file
- All `this.taskHooksProvider` references

Also update stale TASK.md instruction strings:

- Line 2527: Replace `"A TASK.md file with full context will be available in the worktree root."` with `"Run \`openkit task context\` in the worktree to get full task details."`
- Line 2728: Same replacement.

- [ ] **Step 3: Remove `setTaskHooksProvider` call from `apps/server/src/index.ts`**

Remove lines 276-283 (the `manager.setTaskHooksProvider(...)` block).

- [ ] **Step 4: Remove `regenerateTaskMd` from `apps/server/src/routes/tasks.ts`**

Remove:

- Import of `regenerateTaskMd` (line 18)
- The `getHooksSnapshot` helper function
- The `regenerateTaskMd` call block in the PATCH handler (lines 473-494)

- [ ] **Step 5: Remove `regenerateTaskMd` from `apps/server/src/routes/notes.ts`**

Remove:

- Import of `regenerateTaskMd` (line 7)
- The `getHooksSnapshot` helper (lines 18-26)
- All `regenerateTaskMd` call blocks (in aiContext, todo add/update/delete, hook-skills handlers)

- [ ] **Step 6: Remove TASK.md regeneration tests from `apps/server/src/routes/tasks.test.ts`**

Remove the three test cases added by PR #76:

- "regenerates TASK.md when task has a linked worktree" (lines 103-135)
- "skips TASK.md regeneration when task has no linked worktree" (lines 137-156)
- "does not fail the update when regenerateTaskMd throws" (lines 158-182)

Also remove mock setup for `regenerateTaskMd`, `hooksManager` if only used by those tests.

- [ ] **Step 7: Run all server tests**

Run: `pnpm nx run server:test`
Expected: All pass.

- [ ] **Step 8: Build server**

Run: `pnpm nx run server:build`
Expected: Build succeeds with no type errors.

---

### Task 5: Update agent launch prompts in web-app

**Files:**

- Modify: `apps/web-app/src/components/detail/JiraDetailPanel.tsx:435`
- Modify: `apps/web-app/src/components/detail/LinearDetailPanel.tsx:318`
- Modify: `apps/web-app/src/components/detail/CustomTaskDetailPanel.tsx:207`
- Modify: `apps/web-app/src/components/detail/TerminalView.tsx:34`
- Modify: `apps/web-app/src/App.tsx:2256,2342,2431`

- [ ] **Step 1: Update all launch prompts to use `openkit task context` instead of "Read TASK.md"**

Replace "Read TASK.md first, then execute" with "Run `openkit task context` to get full task details, then execute" in all 7 locations:

1. `JiraDetailPanel.tsx:435` — Jira manual launch
2. `LinearDetailPanel.tsx:318` — Linear manual launch
3. `CustomTaskDetailPanel.tsx:207` — Local task manual launch
4. `TerminalView.tsx:34` — Default agent start prompt
5. `App.tsx:2256` — Jira auto-launch
6. `App.tsx:2342` — Linear auto-launch
7. `App.tsx:2431` — Local task auto-launch

- [ ] **Step 2: Build web-app**

Run: `pnpm nx run web-app:build`
Expected: Build succeeds.

---

### Task 6: Update agent skills

**Files:**

- Modify: `.claude/skills/work-on-task/SKILL.md`
- Modify: `libs/agents/src/work-skill/base.md`

- [ ] **Step 1: Update `.claude/skills/work-on-task/SKILL.md`**

Replace steps 7-8 (read task files + inspect hooks.json) with a single step:

```markdown
7. Run `openkit task context` to get full task details (issue data, AI context, todos, effective hooks with per-issue overrides applied).
```

Remove all references to reading `TASK.md`, `task.json`/`issue.json`, `notes.json`, or `.openkit/hooks.json` directly. The CLI command handles all of that.

Renumber subsequent steps (old 9 → new 8, etc).

- [ ] **Step 2: Update `libs/agents/src/work-skill/base.md`**

Same replacement — steps 7-8 become a single `openkit task context` step. Remove file-reading references. Renumber subsequent steps.

---

### Task 7: Update documentation

**Files:**

- Modify: `docs/HOOKS.md`
- Modify: `docs/CONFIGURATION.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CLI.md`

- [ ] **Step 1: Add `openkit task context` to `docs/CLI.md`**

Add under the task commands section:

```markdown
### `openkit task context [<issue-id>] [--json]`

Outputs merged task context for the given issue (or auto-detected from current worktree). Reads issue data, notes (AI context, todos), and effective hooks (global config + per-issue overrides). Default output is markdown; `--json` returns structured JSON.
```

- [ ] **Step 2: Remove TASK.md references from `docs/HOOKS.md`**

Search for TASK.md mentions and replace with `openkit task context` or remove.

- [ ] **Step 3: Remove TASK.md references from `docs/CONFIGURATION.md`**

Remove any mentions of TASK.md as a generated file.

- [ ] **Step 4: Remove TASK.md references from `docs/ARCHITECTURE.md`**

Remove TASK.md from the data flow description. Add `openkit task context` as the mechanism for agent context retrieval.

- [ ] **Step 5: Update local issue filename in docs**

Update any references to `task.json` for local issues to `issue.json` (with migration note about fallback).

---

### Task 8: Clean up stale TASK.md files

- [ ] **Step 1: Remove any existing TASK.md files from worktrees**

```bash
find .openkit/worktrees -name "TASK.md" -delete 2>/dev/null
```

- [ ] **Step 2: Verify full build**

Run: `pnpm build`
Expected: All projects build successfully.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass.
