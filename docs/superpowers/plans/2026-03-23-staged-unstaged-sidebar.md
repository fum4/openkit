# Staged/Unstaged File Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the diff sidebar into staged/unstaged sections with stage/unstage actions per file, like VS Code's Source Control.

**Architecture:** Add `staged` field to `DiffFileInfo`. `getChangedFiles` runs separate staged/unstaged diffs when not in committed mode. New stage/unstage server endpoints. Sidebar splits into two sections with +/- hover actions.

**Tech Stack:** TypeScript, Hono, React, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-staged-unstaged-sidebar-design.md`

---

### Task 1: Add `staged` field to DiffFileInfo

**Files:**

- Modify: `libs/shared/src/worktree-types.ts`

- [ ] **Step 1: Add staged field**

In `DiffFileInfo` (line 234), add after `isBinary`:

```typescript
  /** Whether this file is staged (in the git index). Undefined when showing committed changes. */
  staged?: boolean;
```

- [ ] **Step 2: Verify**

Run: `pnpm check:types`
Expected: No errors (the field is optional, so all existing code still compiles)

- [ ] **Step 3: Commit**

```bash
git add libs/shared/src/worktree-types.ts
git commit -m "feat(shared): add staged field to DiffFileInfo"
```

---

### Task 2: Update getChangedFiles to separate staged/unstaged

**Files:**

- Modify: `libs/integrations/src/github/git-diff.ts`
- Modify: `apps/server/src/__test__/git-diff.test.ts`

The key change: when `includeCommitted` is false, run TWO diffs instead of one:

1. `git diff --cached` for staged files (index vs HEAD) → `staged: true`
2. `git diff` for unstaged files (working tree vs index) → `staged: false`
3. Untracked files → `staged: false`

When `includeCommitted` is true, keep current behavior (single `git diff origin/main`) — no `staged` field.

- [ ] **Step 1: Add tests for staged/unstaged split**

In `apps/server/src/__test__/git-diff.test.ts`, add new test cases:

```typescript
it("returns staged and unstaged files separately when includeCommitted is false", async () => {
  setupMockResponses({
    "rev-parse --verify HEAD": { stdout: "abc123\n" },
    // Staged changes (--cached)
    "diff --name-status --cached": { stdout: "M\tsrc/staged.ts\n" },
    "diff --numstat --cached": { stdout: "5\t2\tsrc/staged.ts\n" },
    // Unstaged changes (no --cached, no ref)
    // Note: the mock matches on substrings, so we need the unstaged diff
    // to NOT include --cached or HEAD
  });
  // This test needs careful mock setup — see implementation notes below
});

it("does not set staged field when includeCommitted is true", async () => {
  // Existing behavior — staged field should be undefined
});
```

NOTE TO IMPLEMENTER: The mock setup is tricky because `git diff --name-status` (unstaged) vs `git diff --name-status --cached` (staged) differ only by `--cached`. The mock dispatcher in `setupMockResponses` matches on substrings. You'll need to ensure the mock can distinguish between `--cached` and non-`--cached` calls. Check the existing mock pattern carefully and adjust if needed.

- [ ] **Step 2: Update getChangedFiles**

In `getChangedFiles`, when `includeCommitted` is false:

Replace the single diff block (lines 213-227) with:

```typescript
if (!includeCommitted) {
  // 1a. Staged changes (index vs HEAD)
  try {
    const [nameStatus, numstat] = await Promise.all([
      execCmd("git", ["diff", "--name-status", "--cached"], worktreePath),
      execCmd("git", ["diff", "--numstat", "--cached"], worktreePath),
    ]);
    const staged = parseNameStatus(nameStatus.stdout, numstat.stdout);
    for (const file of staged) {
      file.staged = true;
      filesByPath.set(`staged:${file.path}`, file);
    }
  } catch (err) {
    log.warn("Failed to get staged changes", { domain: "diff", error: err });
    errors.push(`staged: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 1b. Unstaged changes (working tree vs index)
  try {
    const [nameStatus, numstat] = await Promise.all([
      execCmd("git", ["diff", "--name-status"], worktreePath),
      execCmd("git", ["diff", "--numstat"], worktreePath),
    ]);
    const unstaged = parseNameStatus(nameStatus.stdout, numstat.stdout);
    for (const file of unstaged) {
      file.staged = false;
      filesByPath.set(`unstaged:${file.path}`, file);
    }
  } catch (err) {
    log.warn("Failed to get unstaged changes", { domain: "diff", error: err });
    errors.push(`unstaged: ${err instanceof Error ? err.message : String(err)}`);
  }
} else {
  // Combined diff against base branch (existing behavior, no staged field)
  try {
    const [nameStatusResult, numstatResult] = await Promise.all([
      execCmd("git", ["diff", "--name-status", effectiveRef], worktreePath),
      execCmd("git", ["diff", "--numstat", effectiveRef], worktreePath),
    ]);
    const tracked = parseNameStatus(nameStatusResult.stdout, numstatResult.stdout);
    for (const file of tracked) {
      filesByPath.set(file.path, file);
    }
  } catch (err) {
    log.warn("Failed to get tracked changes", { domain: "diff", error: err });
    errors.push(`tracked: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

Note the `staged:` / `unstaged:` key prefix to allow the same file path to appear in both staged and unstaged (partially staged files). The sort should group staged files first, then unstaged.

Update the sort to put staged files first:

```typescript
const files = [...filesByPath.values()].sort((a, b) => {
  // Staged files first
  if (a.staged !== b.staged) return a.staged ? -1 : 1;
  const orderDiff = statusOrder[a.status] - statusOrder[b.status];
  if (orderDiff !== 0) return orderDiff;
  return a.path.localeCompare(b.path);
});
```

Untracked files: add `staged: false` when `!includeCommitted`:

```typescript
filesByPath.set(includeCommitted ? filePath : `unstaged:${filePath}`, {
  path: filePath,
  status: "untracked",
  linesAdded: lineCounts.get(filePath) ?? 0,
  linesRemoved: 0,
  isBinary: false,
  ...(includeCommitted ? {} : { staged: false }),
});
```

- [ ] **Step 3: Run tests**

Run: `cd apps/server && npx vitest run src/__test__/git-diff.test.ts`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add libs/integrations/src/github/git-diff.ts apps/server/src/__test__/git-diff.test.ts
git commit -m "feat(integrations): separate staged/unstaged files in getChangedFiles"
```

---

### Task 3: Update getFileContent for staged files

**Files:**

- Modify: `libs/integrations/src/github/git-diff.ts`

When `staged` is true, the "new" content is in the index (not the working tree).

- [ ] **Step 1: Add `staged` parameter**

Update `getFileContent` signature:

```typescript
export async function getFileContent(
  worktreePath: string,
  filePath: string,
  fileStatus: DiffFileInfo["status"],
  baseBranch: string,
  includeCommitted: boolean,
  oldPath?: string,
  staged?: boolean,
): Promise<{ oldContent: string; newContent: string; error?: string }>;
```

- [ ] **Step 2: Handle staged content**

When `staged` is true and `!includeCommitted`:

- **old content**: `git show HEAD:<path>` (same as current)
- **new content**: `git show :<path>` (index content, note the `:` prefix with no ref means index)

For the `modified` case:

```typescript
case "modified": {
  if (staged && !includeCommitted) {
    const [old, current] = await Promise.all([
      gitShow(worktreePath, ref, filePath),
      gitShow(worktreePath, "", filePath),  // "" + ":" prefix = index
    ]);
    oldContent = old;
    newContent = current;
  } else {
    const [old, current] = await Promise.all([
      gitShow(worktreePath, ref, filePath),
      readWorkingCopy(worktreePath, filePath),
    ]);
    oldContent = old;
    newContent = current;
  }
  break;
}
```

Wait — `gitShow` concatenates `${ref}:${filePath}`. For the index, the syntax is `:<filePath>` (empty ref). So `gitShow(worktreePath, "", filePath)` would produce `":src/app.ts"` which is correct for showing the staged version.

Apply similar logic for `added` and `renamed` cases when `staged` is true.

- [ ] **Step 3: Update the route to pass staged param**

In `apps/server/src/routes/github.ts`, update the `/api/worktrees/:id/diff/file` route to read `staged` query param:

```typescript
const staged =
  c.req.query("staged") === "true" ? true : c.req.query("staged") === "false" ? false : undefined;
```

Pass it to `getFileContent`:

```typescript
const result = await getFileContent(
  resolved.worktree.path,
  filePath,
  fileStatus,
  baseBranch,
  includeCommitted,
  oldPath,
  staged,
);
```

- [ ] **Step 4: Update frontend fetchDiffFileContent**

In `apps/web-app/src/hooks/api.ts`, add `staged` parameter to `fetchDiffFileContent`:

```typescript
export async function fetchDiffFileContent(
  worktreeId: string,
  filePath: string,
  fileStatus: string,
  includeCommitted: boolean,
  oldPath?: string,
  serverUrl: string | null = null,
  staged?: boolean,
): Promise<DiffFileContentResponse> {
```

Add to params:

```typescript
if (staged !== undefined) params.set("staged", String(staged));
```

- [ ] **Step 5: Update DiffFileSection to pass staged**

In `DiffFileSection.tsx`, add `staged` to the `fetchDiffFileContent` call. The `file.staged` value is available from `DiffFileInfo`.

Update the `doFetch` callback to pass `file.staged`:

```typescript
: fetchDiffFileContent(
    worktreeId,
    file.path,
    file.status,
    includeCommitted,
    file.oldPath,
    serverUrl,
    file.staged,
  );
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm check:types`
Run: `cd apps/server && npx vitest run src/__test__/git-diff.test.ts`
Expected: All pass

```bash
git add libs/integrations/src/github/git-diff.ts apps/server/src/routes/github.ts apps/web-app/src/hooks/api.ts apps/web-app/src/components/detail/DiffFileSection.tsx
git commit -m "feat: support staged file content in diff viewer"
```

---

### Task 4: Add stage/unstage server endpoints

**Files:**

- Modify: `apps/server/src/routes/github.ts`

- [ ] **Step 1: Add POST /api/worktrees/:id/stage**

```typescript
app.post("/api/worktrees/:id/stage", async (c) => {
  try {
    const id = c.req.param("id");
    const resolved = manager.resolveWorktree(id);
    if (!resolved.success) {
      return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
    }
    const body = await c.req.json<{ paths?: string[] }>();
    if (!body.paths || !Array.isArray(body.paths) || body.paths.length === 0) {
      return c.json({ success: false, error: "paths array is required" }, 400);
    }
    await new Promise<void>((resolve, reject) => {
      execFile(
        "git",
        ["add", "--", ...body.paths],
        { cwd: resolved.worktree.path, encoding: "utf-8" },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to stage files" },
      400,
    );
  }
});
```

- [ ] **Step 2: Add POST /api/worktrees/:id/unstage**

```typescript
app.post("/api/worktrees/:id/unstage", async (c) => {
  try {
    const id = c.req.param("id");
    const resolved = manager.resolveWorktree(id);
    if (!resolved.success) {
      return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
    }
    const body = await c.req.json<{ paths?: string[] }>();
    if (!body.paths || !Array.isArray(body.paths) || body.paths.length === 0) {
      return c.json({ success: false, error: "paths array is required" }, 400);
    }
    await new Promise<void>((resolve, reject) => {
      execFile(
        "git",
        ["restore", "--staged", "--", ...body.paths],
        { cwd: resolved.worktree.path, encoding: "utf-8" },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to unstage files" },
      400,
    );
  }
});
```

- [ ] **Step 3: Add POST /api/worktrees/:id/stage-all**

```typescript
app.post("/api/worktrees/:id/stage-all", async (c) => {
  try {
    const id = c.req.param("id");
    const resolved = manager.resolveWorktree(id);
    if (!resolved.success) {
      return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
    }
    await new Promise<void>((resolve, reject) => {
      execFile("git", ["add", "-A"], { cwd: resolved.worktree.path, encoding: "utf-8" }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to stage all files",
      },
      400,
    );
  }
});
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm check:types`

```bash
git add apps/server/src/routes/github.ts
git commit -m "feat(server): add stage/unstage/stage-all endpoints"
```

---

### Task 5: Add frontend API functions for staging

**Files:**

- Modify: `apps/web-app/src/hooks/api.ts`

- [ ] **Step 1: Add stageFiles**

```typescript
export async function stageFiles(
  worktreeId: string,
  paths: string[],
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const base = getBaseUrl(serverUrl);
    const res = await fetch(`${base}/api/worktrees/${encodeURIComponent(worktreeId)}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });
    if (!isJsonResponse(res)) return { success: false, error: `Server returned ${res.status}` };
    return await res.json();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to stage files" };
  }
}
```

- [ ] **Step 2: Add unstageFiles**

Same pattern, POST to `/unstage`.

- [ ] **Step 3: Add stageAllFiles**

Same pattern, POST to `/stage-all` with no body.

- [ ] **Step 4: Verify and commit**

---

### Task 6: Redesign DiffFileSidebar with staged/unstaged sections

**Files:**

- Modify: `apps/web-app/src/components/detail/DiffFileSidebar.tsx`
- Modify: `apps/web-app/src/components/detail/__test__/DiffFileSidebar.test.tsx`

This is the main UI change.

- [ ] **Step 1: Update props**

```typescript
interface DiffFileSidebarProps {
  files: DiffFileInfo[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  onStageAll?: () => void;
  showStagingActions?: boolean;
}
```

- [ ] **Step 2: Split files into staged/unstaged**

```typescript
const stagedFiles = useMemo(() => files.filter((f) => f.staged === true), [files]);
const unstagedFiles = useMemo(() => files.filter((f) => f.staged !== true), [files]);
const hasStagedFiles = stagedFiles.length > 0;
const hasUnstagedFiles = unstagedFiles.length > 0;
```

- [ ] **Step 3: Render two sections when showStagingActions is true**

When `showStagingActions` is true and there are files in both groups:

```tsx
{showStagingActions ? (
  <>
    {hasStagedFiles && (
      <>
        <SectionHeader title={`Staged Changes (${stagedFiles.length})`} />
        <FolderContents node={stagedTree} ... />
      </>
    )}
    {hasStagedFiles && hasUnstagedFiles && (
      <SectionDivider
        title={`Changes (${unstagedFiles.length})`}
        onStageAll={onStageAll}
      />
    )}
    {hasUnstagedFiles && !hasStagedFiles && (
      <SectionHeader title={`Changes (${unstagedFiles.length})`} onStageAll={onStageAll} />
    )}
    {hasUnstagedFiles && (
      <FolderContents node={unstagedTree} ... />
    )}
  </>
) : (
  <FolderContents node={tree} ... />  // flat list as before
)}
```

- [ ] **Step 4: Update FileRow with +/- hover action**

Replace the diff stats area on hover with a +/- button:

```tsx
// In FileRow, add onAction prop
{
  showAction && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAction?.(file.path);
      }}
      className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/[0.08]"
      title={file.staged ? "Unstage" : "Stage"}
    >
      {file.staged ? (
        <Minus className="w-3.5 h-3.5 text-[#6b7280] hover:text-white" />
      ) : (
        <Plus className="w-3.5 h-3.5 text-[#6b7280] hover:text-white" />
      )}
    </button>
  );
}
```

The diff stats should be hidden when the +/- button is visible (on hover). Use a `group` class on the row and `group-hover:hidden` / `group-hover:flex` to toggle.

- [ ] **Step 5: Add SectionHeader and SectionDivider components**

Small inline components:

```tsx
function SectionHeader({ title, onStageAll }: { title: string; onStageAll?: () => void }) {
  return (
    <div className="group flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#4b5563]">
      <span>{title}</span>
      {onStageAll && (
        <button
          type="button"
          onClick={onStageAll}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/[0.08]"
          title="Stage all"
        >
          <Plus className="w-3 h-3 text-[#6b7280] hover:text-white" />
        </button>
      )}
    </div>
  );
}
```

`SectionDivider` is similar but with a top border.

- [ ] **Step 6: Update tests**

Update `DiffFileSidebar.test.tsx` to test:

- Files with `staged: true` appear in "Staged Changes" section
- Files with `staged: false` appear in "Changes" section
- +/- buttons appear on hover
- Clicking + calls onStageFile
- Clicking stage-all calls onStageAll
- Flat list when showStagingActions is false

- [ ] **Step 7: Verify and commit**

---

### Task 7: Wire up DiffViewerTab

**Files:**

- Modify: `apps/web-app/src/components/detail/DiffViewerTab.tsx`

- [ ] **Step 1: Add staging API imports**

```typescript
import { stageFiles, unstageFiles, stageAllFiles } from "../../hooks/api";
```

- [ ] **Step 2: Add staging handlers**

```typescript
const handleStageFile = useCallback(
  async (path: string) => {
    await stageFiles(worktree.id, [path], serverUrl);
    fetchFiles();
  },
  [worktree.id, serverUrl, fetchFiles],
);

const handleUnstageFile = useCallback(
  async (path: string) => {
    await unstageFiles(worktree.id, [path], serverUrl);
    fetchFiles();
  },
  [worktree.id, serverUrl, fetchFiles],
);

const handleStageAll = useCallback(async () => {
  await stageAllFiles(worktree.id, serverUrl);
  fetchFiles();
}, [worktree.id, serverUrl, fetchFiles]);
```

- [ ] **Step 3: Pass props to DiffFileSidebar**

```tsx
<DiffFileSidebar
  files={files}
  selectedFile={selectedFile}
  onSelectFile={handleSelectFile}
  onStageFile={handleStageFile}
  onUnstageFile={handleUnstageFile}
  onStageAll={handleStageAll}
  showStagingActions={!showMergedDiff && !includeCommitted}
/>
```

- [ ] **Step 4: Verify and commit**

---

### Task 8: Final checks

- [ ] **Step 1: Run lint and format**

Run: `pnpm check:lint && pnpm check:format`
Fix any issues with `pnpm fix:format`.

- [ ] **Step 2: Run all tests**

Run: `cd apps/server && npx vitest run src/__test__/git-diff.test.ts`
Run: `cd apps/web-app && npx vitest run src/components/detail/__test__/DiffFileSidebar.test.tsx`
Run: `cd apps/web-app && npx vitest run src/components/detail/__test__/DiffViewerTab.test.tsx`
Run: `pnpm check:types`

- [ ] **Step 3: Commit any fixes**
