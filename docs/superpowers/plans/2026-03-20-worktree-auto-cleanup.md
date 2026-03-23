# Worktree Auto-Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-delete worktrees when their GitHub PR is merged or closed, guarded by dirty-state checks, with two config toggles and activity notifications.

**Architecture:** Piggyback on existing 60s PR polling in `GitHubManager`. When a PR transitions from open/draft to merged/closed, a new callback notifies `WorktreeManager`, which checks config flags and git cleanliness before calling the existing `removeWorktree()`. Config unification makes both `config.json` and `config.local.json` support the full schema with local taking priority.

**Tech Stack:** TypeScript, Hono (server), React (web-app), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-20-worktree-auto-cleanup-design.md`

---

### Task 1: Rename `local-config.json` to `config.local.json`

**Files:**

- Modify: `apps/server/src/local-config.ts:8` — change `LOCAL_CONFIG_FILE_NAME`
- Modify: `apps/server/src/manager.ts:323` — update `classifyOpenkitFile` mapping
- Modify: `apps/server/src/routes/config.ts:566` — update comment referencing old filename

- [ ] **Step 1: Update the file name constant**

In `apps/server/src/local-config.ts:8`, change:

```typescript
const LOCAL_CONFIG_FILE_NAME = "local-config.json";
```

to:

```typescript
const LOCAL_CONFIG_FILE_NAME = "config.local.json";
```

- [ ] **Step 2: Update the file watcher classifier**

In `apps/server/src/manager.ts:323`, change:

```typescript
if (filename === "local-config.json") return "local-config";
```

to:

```typescript
if (filename === "config.local.json") return "local-config";
```

The event category string `"local-config"` stays the same — only the filename trigger changes.

- [ ] **Step 3: Update the comment in routes/config.ts**

In `apps/server/src/routes/config.ts:566`, change:

```typescript
// -- Local Config API (local-config.json — not synced to git) --
```

to:

```typescript
// -- Local Config API (config.local.json — not synced to git) --
```

- [ ] **Step 4: Run existing tests**

Run: `pnpm nx run server:test -- --run`
Expected: PASS — tests mock `fs` so they don't depend on the actual filename on disk.

- [ ] **Step 5: Manually rename the actual file in your `.openkit/` directory**

Run: `mv .openkit/local-config.json .openkit/config.local.json` (if the file exists).
Note: existing settings in the old file will be lost since there is no migration — this is intentional.

- [ ] **Step 6: Commit**

```
feat: rename local-config.json to config.local.json
```

---

### Task 2: Add new config flags to shared types

**Files:**

- Modify: `libs/shared/src/worktree-types.ts:73` — add fields to `WorktreeConfig`
- Modify: `apps/web-app/src/hooks/useConfig.ts:42` — add fields to frontend `WorktreeConfig`

- [ ] **Step 1: Add fields to shared `WorktreeConfig`**

In `libs/shared/src/worktree-types.ts`, add after the `opsLog` field (line 72):

```typescript
  /** Auto-delete worktree when its PR is merged (default: false) */
  autoCleanupOnPrMerge?: boolean;
  /** Auto-delete worktree when its PR is closed without merge (default: false) */
  autoCleanupOnPrClose?: boolean;
```

- [ ] **Step 2: Add fields to frontend `WorktreeConfig`**

In `apps/web-app/src/hooks/useConfig.ts`, add after the `opsLog` field (line 41):

```typescript
  autoCleanupOnPrMerge?: boolean;
  autoCleanupOnPrClose?: boolean;
```

- [ ] **Step 3: Commit**

```
feat: add autoCleanupOnPrMerge and autoCleanupOnPrClose config flags
```

---

### Task 3: Add activity event type constants

**Files:**

- Modify: `libs/shared/src/activity-event.ts:46` — add constants to `ACTIVITY_TYPES`

- [ ] **Step 1: Add constants**

In `libs/shared/src/activity-event.ts`, add after `WORKTREE_CRASHED` (line 45):

```typescript
  AUTO_CLEANUP: "auto-cleanup",
  AUTO_CLEANUP_SKIPPED: "auto-cleanup-skipped",
```

- [ ] **Step 2: Add `auto-cleanup-skipped` to default toast events**

In `libs/shared/src/activity-event.ts`, add `"auto-cleanup-skipped"` to the `toastEvents` array in `DEFAULT_ACTIVITY_CONFIG` (line 71-80), so users see a toast when cleanup is skipped due to dirty state:

```typescript
  toastEvents: [
    "creation_started",
    "creation_completed",
    "creation_failed",
    "skill_started",
    "skill_completed",
    "skill_failed",
    "crashed",
    "connection_lost",
    "auto-cleanup-skipped",
  ],
```

- [ ] **Step 3: Commit**

```
feat: add auto-cleanup activity event types
```

---

### Task 4: Wire new config flags into local config and manager

**Files:**

- Modify: `apps/server/src/local-config.ts` — add new fields to `LocalConfig`, sanitizer, defaults
- Modify: `apps/server/src/manager.ts:109` — add to `LOCAL_CONFIG_KEYS`
- Modify: `apps/server/src/manager.ts:254` — expand `withLocalConfig()`
- Modify: `apps/server/src/manager.ts:362` — update `reloadConfig()` to pick up new fields
- Test: `apps/server/src/__test__/local-config.test.ts`

- [ ] **Step 1: Write failing test for new config fields**

Add to `apps/server/src/__test__/local-config.test.ts`:

```typescript
it("parses autoCleanupOnPrMerge and autoCleanupOnPrClose fields", () => {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(
    JSON.stringify({
      autoCleanupOnPrMerge: true,
      autoCleanupOnPrClose: false,
    }),
  );

  const result = loadLocalConfig("/project");

  expect(result).toEqual({
    autoCleanupOnPrMerge: true,
    autoCleanupOnPrClose: false,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run server:test -- --run -t "parses autoCleanupOnPrMerge"`
Expected: FAIL — fields are stripped by sanitizer.

- [ ] **Step 3: Add fields to `LocalConfig` interface and sanitizer**

In `apps/server/src/local-config.ts`, add to the `LocalConfig` interface (line 10-17):

```typescript
  autoCleanupOnPrMerge?: boolean;
  autoCleanupOnPrClose?: boolean;
```

In `sanitizeLocalConfig()` (after the `arrowNavEnabled` check around line 42), add:

```typescript
if (typeof raw.autoCleanupOnPrMerge === "boolean") {
  next.autoCleanupOnPrMerge = raw.autoCleanupOnPrMerge;
}
if (typeof raw.autoCleanupOnPrClose === "boolean") {
  next.autoCleanupOnPrClose = raw.autoCleanupOnPrClose;
}
```

- [ ] **Step 4: Add defaults in `ensureLocalConfigDefaults()`**

In `ensureLocalConfigDefaults()` (after the `arrowNavEnabled` default around line 82), add:

```typescript
if (current.autoCleanupOnPrMerge === undefined) {
  current.autoCleanupOnPrMerge = false;
  needsWrite = true;
}
if (current.autoCleanupOnPrClose === undefined) {
  current.autoCleanupOnPrClose = false;
  needsWrite = true;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx run server:test -- --run -t "parses autoCleanupOnPrMerge"`
Expected: PASS

- [ ] **Step 6: Add to `LOCAL_CONFIG_KEYS` in manager.ts**

In `apps/server/src/manager.ts:109`, change:

```typescript
const LOCAL_CONFIG_KEYS = [...AGENT_GIT_POLICY_KEYS, "useNativePortHook"] as const;
```

to:

```typescript
const LOCAL_CONFIG_KEYS = [
  ...AGENT_GIT_POLICY_KEYS,
  "useNativePortHook",
  "autoCleanupOnPrMerge",
  "autoCleanupOnPrClose",
] as const;
```

- [ ] **Step 7: Expand `withLocalConfig()` to merge new fields**

In `apps/server/src/manager.ts:254`, update `withLocalConfig()` to include the new fields:

```typescript
  private withLocalConfig(config: WorktreeConfig): WorktreeConfig {
    const policy = this.readAgentGitPolicyConfig();
    const local = loadLocalConfig(this.configDir);
    return {
      ...config,
      allowAgentCommits: policy.allowAgentCommits,
      allowAgentPushes: policy.allowAgentPushes,
      allowAgentPRs: policy.allowAgentPRs,
      useNativePortHook: local.useNativePortHook === true,
      autoCleanupOnPrMerge: local.autoCleanupOnPrMerge ?? config.autoCleanupOnPrMerge,
      autoCleanupOnPrClose: local.autoCleanupOnPrClose ?? config.autoCleanupOnPrClose,
    };
  }
```

- [ ] **Step 8: Update `reloadConfig()` to pick up new fields**

In `apps/server/src/manager.ts`, inside `reloadConfig()` (around line 402, after the `showDiffStats` line), add:

```typescript
        autoCleanupOnPrMerge: fileConfig.autoCleanupOnPrMerge ?? this.config.autoCleanupOnPrMerge,
        autoCleanupOnPrClose: fileConfig.autoCleanupOnPrClose ?? this.config.autoCleanupOnPrClose,
```

- [ ] **Step 9: Update `localConfigUpdates` type in `updateConfig()`**

In `apps/server/src/manager.ts:2012-2017`, expand the type to include the new keys:

```typescript
const localConfigUpdates: Partial<{
  allowAgentCommits: boolean;
  allowAgentPushes: boolean;
  allowAgentPRs: boolean;
  useNativePortHook: boolean;
  autoCleanupOnPrMerge: boolean;
  autoCleanupOnPrClose: boolean;
}> = {};
```

- [ ] **Step 10: Run all server tests**

Run: `pnpm nx run server:test -- --run`
Expected: PASS

- [ ] **Step 11: Commit**

```
feat: wire autoCleanup config flags into local config and manager
```

---

### Task 5: Add `onPrStateChange` callback to `GitHubManager.startPolling()`

**Files:**

- Modify: `libs/integrations/src/github/github-manager.ts:122` — add optional callback, call it on state transitions
- Test: `apps/server/src/__test__/github-manager-pr-callback.test.ts` (new — tests live in `apps/server` because `libs/integrations` has no test runner)

- [ ] **Step 1: Write failing test for the callback**

Create `apps/server/src/__test__/github-manager-pr-callback.test.ts`:

```typescript
import { GitHubManager } from "@openkit/integrations/github/github-manager";
import * as ghClient from "@openkit/integrations/github/gh-client";

vi.mock("@openkit/integrations/github/gh-client");

describe("GitHubManager PR state change callback", () => {
  let manager: GitHubManager;
  const mockGetWorktrees = vi.fn();
  const mockOnUpdate = vi.fn();
  const mockOnPrStateChange = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    manager = new GitHubManager();

    // Make manager appear available by setting internal state
    Object.assign(manager, {
      installed: true,
      authenticated: true,
      config: { owner: "test", repo: "repo", defaultBranch: "main" },
    });
  });

  afterEach(() => {
    manager.stopPolling();
    vi.useRealTimers();
  });

  it("calls onPrStateChange when PR transitions from open to merged", async () => {
    const worktree = { id: "feat-1", branch: "feat-1", status: "stopped" };
    mockGetWorktrees.mockReturnValue([worktree]);

    // First poll: PR is open
    vi.mocked(ghClient.findPRForBranch).mockResolvedValueOnce({
      url: "https://github.com/test/repo/pull/1",
      number: 1,
      state: "open",
      isDraft: false,
      title: "feat",
    });

    manager.startPolling(mockGetWorktrees, mockOnUpdate, mockOnPrStateChange);
    await vi.runAllTimersAsync();

    expect(mockOnPrStateChange).not.toHaveBeenCalled();

    // Second poll: PR is merged
    vi.mocked(ghClient.findPRForBranch).mockResolvedValueOnce({
      url: "https://github.com/test/repo/pull/1",
      number: 1,
      state: "merged",
      isDraft: false,
      title: "feat",
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockOnPrStateChange).toHaveBeenCalledWith("feat-1", "open", "merged");
  });

  it("does NOT call onPrStateChange on cold start (no previous state)", async () => {
    const worktree = { id: "feat-1", branch: "feat-1", status: "stopped" };
    mockGetWorktrees.mockReturnValue([worktree]);

    // First poll: PR is already merged (cold start)
    vi.mocked(ghClient.findPRForBranch).mockResolvedValueOnce({
      url: "https://github.com/test/repo/pull/1",
      number: 1,
      state: "merged",
      isDraft: false,
      title: "feat",
    });

    manager.startPolling(mockGetWorktrees, mockOnUpdate, mockOnPrStateChange);
    await vi.runAllTimersAsync();

    expect(mockOnPrStateChange).not.toHaveBeenCalled();
  });

  it("calls onPrStateChange when PR transitions from open to closed", async () => {
    const worktree = { id: "feat-2", branch: "feat-2", status: "stopped" };
    mockGetWorktrees.mockReturnValue([worktree]);

    // First poll: open
    vi.mocked(ghClient.findPRForBranch).mockResolvedValueOnce({
      url: "https://github.com/test/repo/pull/2",
      number: 2,
      state: "open",
      isDraft: false,
      title: "feat",
    });

    manager.startPolling(mockGetWorktrees, mockOnUpdate, mockOnPrStateChange);
    await vi.runAllTimersAsync();

    // Second poll: closed
    vi.mocked(ghClient.findPRForBranch).mockResolvedValueOnce({
      url: "https://github.com/test/repo/pull/2",
      number: 2,
      state: "closed",
      isDraft: false,
      title: "feat",
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockOnPrStateChange).toHaveBeenCalledWith("feat-2", "open", "closed");
  });

  it("works without onPrStateChange callback (backwards compatible)", () => {
    mockGetWorktrees.mockReturnValue([]);

    // Should not throw
    expect(() => manager.startPolling(mockGetWorktrees, mockOnUpdate)).not.toThrow();
    manager.stopPolling();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run server:test -- --run -t "GitHubManager PR state change"`
Expected: FAIL — `onPrStateChange` parameter doesn't exist yet.

- [ ] **Step 3: Implement the callback in `startPolling()`**

In `libs/integrations/src/github/github-manager.ts:122`, update the signature:

```typescript
  startPolling(
    getWorktrees: () => WorktreeInfo[],
    onUpdate: () => void,
    onPrStateChange?: (worktreeId: string, oldState: string, newState: string) => void,
  ): void {
```

Inside the `pollPRs` function (after line 173 where `prChanged` is determined and the cache is updated), add the callback invocation. Replace the block inside the `for` loop that handles `prChanged`:

```typescript
if (prChanged) {
  // Fire state-change callback for terminal transitions (not on cold start)
  if (
    onPrStateChange &&
    prev && // prev must exist (not cold start)
    pr &&
    (pr.state === "merged" || pr.state === "closed")
  ) {
    const oldState = prev.isDraft ? "draft" : prev.state;
    try {
      onPrStateChange(wt.id, oldState, pr.state);
    } catch {
      // Don't let callback errors break polling
    }
  }
  this.prCache.set(wt.id, pr);
  changed = true;
}
```

Note: the `this.prCache.set(wt.id, pr)` line already exists — move it after the callback so the callback receives the transition. The key change is that the callback fires ONLY when `prev` exists (not cold start) and the new state is terminal.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run server:test -- --run -t "GitHubManager PR state change"`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat: add onPrStateChange callback to GitHubManager.startPolling()
```

---

### Task 6: Implement auto-cleanup logic in `WorktreeManager`

**Files:**

- Modify: `apps/server/src/manager.ts:435-455` — wire callback into `initGitHub()`, add handler method
- Test: `apps/server/src/__test__/auto-cleanup.test.ts` (new)

- [ ] **Step 1: Write tests for `handlePrStateChange`**

Create `apps/server/src/__test__/auto-cleanup.test.ts`. This tests the handler method by creating a minimal `WorktreeManager` and mocking its dependencies. The key behaviors to test:

```typescript
import { WorktreeManager } from "../manager";

// Mock all heavy dependencies
vi.mock("fs");
vi.mock("child_process");
vi.mock("@openkit/integrations/github/github-manager");

describe("handlePrStateChange auto-cleanup", () => {
  // Use Object.assign or prototype access to test the private method.
  // The tests should verify:

  it("does nothing when autoCleanupOnPrMerge is false and PR is merged", async () => {
    // Setup: config with autoCleanupOnPrMerge = false
    // Call: handlePrStateChange(worktreeId, "open", "merged")
    // Assert: removeWorktree NOT called, no activity event
  });

  it("does nothing when autoCleanupOnPrClose is false and PR is closed", async () => {
    // Setup: config with autoCleanupOnPrClose = false
    // Call: handlePrStateChange(worktreeId, "open", "closed")
    // Assert: removeWorktree NOT called
  });

  it("skips cleanup and emits warning event when worktree has uncommitted changes", async () => {
    // Setup: config with autoCleanupOnPrMerge = true
    //        gitStatusCache returns { hasUncommitted: true, ahead: 0, noUpstream: false, ... }
    // Call: handlePrStateChange(worktreeId, "open", "merged")
    // Assert: removeWorktree NOT called
    //         activityLog.addEvent called with type AUTO_CLEANUP_SKIPPED, severity "warning"
  });

  it("skips cleanup when worktree has unpushed commits (ahead > 0)", async () => {
    // Setup: config with autoCleanupOnPrMerge = true
    //        gitStatusCache returns { hasUncommitted: false, ahead: 2, noUpstream: false, ... }
    // Call: handlePrStateChange(worktreeId, "open", "merged")
    // Assert: removeWorktree NOT called, AUTO_CLEANUP_SKIPPED event emitted
  });

  it("skips cleanup when worktree has no upstream (noUpstream = true)", async () => {
    // Setup: config with autoCleanupOnPrClose = true
    //        gitStatusCache returns { hasUncommitted: false, ahead: 0, noUpstream: true, ... }
    // Call: handlePrStateChange(worktreeId, "open", "closed")
    // Assert: removeWorktree NOT called
  });

  it("calls removeWorktree and emits info event when worktree is clean and PR is merged", async () => {
    // Setup: config with autoCleanupOnPrMerge = true
    //        gitStatusCache returns { hasUncommitted: false, ahead: 0, noUpstream: false, ... }
    // Call: handlePrStateChange(worktreeId, "open", "merged")
    // Assert: removeWorktree called with worktreeId
    //         activityLog.addEvent called with type AUTO_CLEANUP, severity "info"
  });

  it("logs warning when removeWorktree fails", async () => {
    // Setup: config with autoCleanupOnPrMerge = true, clean git status
    //        removeWorktree returns { success: false, error: "not found" }
    // Call: handlePrStateChange(worktreeId, "open", "merged")
    // Assert: no AUTO_CLEANUP event, error is logged
  });
});
```

Note: `handlePrStateChange` is a private method. The implementor should either test it indirectly through the `initGitHub()` → polling → callback path, or expose it for testing via `(manager as any).handlePrStateChange(...)`. Follow whichever pattern existing tests in this codebase use for private methods.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run server:test -- --run -t "handlePrStateChange"`
Expected: FAIL — method doesn't exist yet.

- [ ] **Step 3: Add the auto-cleanup handler method**

In `apps/server/src/manager.ts`, add a new private method before `initGitHub()` (around line 435):

```typescript
  private async handlePrStateChange(
    worktreeId: string,
    _oldState: string,
    newState: string,
  ): Promise<void> {
    const config = this.getConfig();

    if (newState === "merged" && !config.autoCleanupOnPrMerge) return;
    if (newState === "closed" && !config.autoCleanupOnPrClose) return;

    // Safety gate: check for uncommitted or unpushed changes
    const git = this.githubManager?.getCachedGitStatus(worktreeId);
    if (git) {
      const hasUnpushed = git.ahead > 0 || git.noUpstream;
      if (git.hasUncommitted || hasUnpushed) {
        log.info(`Auto-cleanup skipped for "${worktreeId}" — dirty state`, {
          domain: "auto-cleanup",
          worktreeId,
          hasUncommitted: git.hasUncommitted,
          hasUnpushed,
        });
        this.activityLog.addEvent({
          category: "worktree",
          type: ACTIVITY_TYPES.AUTO_CLEANUP_SKIPPED,
          severity: "warning",
          title: "Auto-cleanup skipped",
          detail: `Worktree "${worktreeId}" has uncommitted/unpushed changes — skipped auto-cleanup (PR was ${newState})`,
          worktreeId,
          projectName: this.activityProjectName(),
        });
        return;
      }
    }

    log.info(`Auto-cleaning worktree "${worktreeId}" — PR was ${newState}`, {
      domain: "auto-cleanup",
      worktreeId,
    });

    const result = await this.removeWorktree(worktreeId);

    if (result.success) {
      this.activityLog.addEvent({
        category: "worktree",
        type: ACTIVITY_TYPES.AUTO_CLEANUP,
        severity: "info",
        title: "Worktree auto-deleted",
        detail: `Worktree "${worktreeId}" was auto-deleted — PR was ${newState}`,
        worktreeId,
        projectName: this.activityProjectName(),
      });
    } else {
      log.warn(`Auto-cleanup failed for "${worktreeId}": ${result.error}`, {
        domain: "auto-cleanup",
        worktreeId,
        error: result.error,
      });
    }
  }
```

- [ ] **Step 2: Wire the callback into `initGitHub()`**

In `apps/server/src/manager.ts`, update `initGitHub()` (line 439-442) to pass the callback:

```typescript
this.githubManager.startPolling(
  () => this.getWorktrees(),
  () => this.notifyListeners(),
  (worktreeId, oldState, newState) => this.handlePrStateChange(worktreeId, oldState, newState),
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm nx run server:test -- --run -t "handlePrStateChange"`
Expected: PASS

- [ ] **Step 6: Run all server tests**

Run: `pnpm nx run server:test -- --run`
Expected: PASS

- [ ] **Step 7: Commit**

```
feat: implement worktree auto-cleanup on PR merge/close
```

---

### Task 7: Add frontend `LocalConfig` fields and UI toggles

**Files:**

- Modify: `apps/web-app/src/hooks/useLocalConfig.ts:8-14` — add new fields to `LocalConfig` interface
- Modify: `apps/web-app/src/components/ConfigurationPanel.tsx:696-709` — add toggle rows

- [ ] **Step 1: Add fields to frontend `LocalConfig`**

In `apps/web-app/src/hooks/useLocalConfig.ts:8-14`, add the new fields:

```typescript
export interface LocalConfig {
  allowAgentCommits?: boolean;
  allowAgentPushes?: boolean;
  allowAgentPRs?: boolean;
  shortcuts?: Record<string, string>;
  arrowNavEnabled?: boolean;
  autoCleanupOnPrMerge?: boolean;
  autoCleanupOnPrClose?: boolean;
}
```

- [ ] **Step 2: Add toggle rows in ConfigurationPanel**

In `apps/web-app/src/components/ConfigurationPanel.tsx`, after the auto-install toggle block (after line 709, before `</div>` that closes the card), add:

```tsx
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/[0.06]">
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs font-medium ${settings.label}`}>
                Auto-delete on PR merge
              </span>
              <span className={`text-[11px] ${settings.description}`}>
                Delete worktree when its GitHub PR is merged
              </span>
            </div>
            <ToggleSwitch
              checked={form.autoCleanupOnPrMerge === true}
              onToggle={() =>
                setForm({ ...form, autoCleanupOnPrMerge: !form.autoCleanupOnPrMerge })
              }
            />
          </div>
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/[0.06]">
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs font-medium ${settings.label}`}>
                Auto-delete on PR close
              </span>
              <span className={`text-[11px] ${settings.description}`}>
                Delete worktree when its GitHub PR is closed without merge
              </span>
            </div>
            <ToggleSwitch
              checked={form.autoCleanupOnPrClose === true}
              onToggle={() =>
                setForm({ ...form, autoCleanupOnPrClose: !form.autoCleanupOnPrClose })
              }
            />
          </div>
```

These toggles use the same auto-save form pattern as `autoInstall`. The `LOCAL_CONFIG_KEYS` mechanism in `updateConfig()` routes them to `config.local.json`.

- [ ] **Step 3: Verify lint and type checks pass**

Run: `pnpm check:types && pnpm check:lint`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat: add auto-cleanup toggle UI in project settings
```

---

### Task 8: Update documentation

**Files:**

- Modify: `docs/CONFIGURATION.md` — document new config flags and file rename

- [ ] **Step 1: Add new config flags to docs**

Add an entry for `autoCleanupOnPrMerge` and `autoCleanupOnPrClose` to the config reference in `docs/CONFIGURATION.md`, alongside the existing `autoInstall` entry. Also document the `local-config.json` → `config.local.json` rename.

- [ ] **Step 2: Commit**

```
docs: document auto-cleanup config flags and config.local.json rename
```
