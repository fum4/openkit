# Merged PR Diff View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the full diff for merged PRs by fetching from GitHub's API, using the same diff viewer components already used for WIP branches.

**Architecture:** Two new server endpoints (`pr-diff`, `pr-diff/file`) fetch PR file list and file content from GitHub's API via `gh` CLI, returning the same `DiffListResponse`/`DiffFileContentResponse` types. The frontend detects merged state and switches data source. A new `PrDiffListResponse` extends `DiffListResponse` with `baseSha`/`mergeSha` to avoid redundant metadata fetches per file.

**Tech Stack:** TypeScript, Hono (server routes), React + react-query (frontend caching), `gh` CLI (GitHub API access), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-20-merged-pr-diff-view-design.md`

---

### Task 1: Add shared types for PR diff response

**Files:**

- Modify: `libs/shared/src/worktree-types.ts:234-246`

- [ ] **Step 1: Write the new type**

Add `PrDiffListResponse` after `DiffListResponse` (line 239):

```typescript
export interface PrDiffListResponse extends DiffListResponse {
  /** SHA of the PR base (e.g. the tip of main at merge time) */
  baseSha: string;
  /** SHA of the merge commit */
  mergeSha: string;
}
```

- [ ] **Step 2: Re-export from web-app types**

In `apps/web-app/src/types.ts`, add `PrDiffListResponse` to the existing diff viewer re-export (line ~349-353):

```typescript
export type {
  DiffFileInfo,
  DiffListResponse,
  DiffFileContentResponse,
  PrDiffListResponse,
} from "@openkit/shared/worktree-types";
```

- [ ] **Step 3: Verify the build**

Run: `pnpm check:types`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add libs/shared/src/worktree-types.ts apps/web-app/src/types.ts
git commit -m "feat(shared): add PrDiffListResponse type for merged PR diffs"
```

---

### Task 2: Add `getPrDiffFiles` and `getPrFileContent` functions

**Files:**

- Create: `libs/integrations/src/github/pr-diff.ts`
- Modify: `libs/integrations/src/github/index.ts`

This module fetches PR file list and metadata from GitHub API via the `gh` CLI. It follows the same pattern as `gh-client.ts` — uses `execFile` (not `exec`) with `resolveCommandPath`/`withAugmentedPathEnv` to avoid shell injection.

- [ ] **Step 1: Write failing tests**

Create: `apps/server/src/__test__/pr-diff.test.ts`

```typescript
/**
 * Unit tests for PR diff functions (getPrDiffFiles, getPrFileContent).
 *
 * Mocks child_process.execFile at the boundary to test GitHub API
 * response parsing without requiring real GitHub access.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExec = vi.fn();

vi.mock("child_process", () => {
  const execFileFn = (...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      const result = mockExec(args[0], args[1], args[2]);
      if (result instanceof Error) {
        cb(result);
      } else {
        cb(null, result.stdout ?? "", result.stderr ?? "");
      }
      return;
    }
  };
  return { execFile: execFileFn };
});

vi.mock("@openkit/shared/command-path", () => ({
  resolveCommandPath: vi.fn((cmd: string) => cmd),
  withAugmentedPathEnv: vi.fn((env: NodeJS.ProcessEnv) => env),
}));

vi.mock("@openkit/integrations/github/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getPrDiffFiles, getPrFileContent } from "@openkit/integrations/github/pr-diff";

describe("getPrDiffFiles", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  it("maps GitHub PR files to DiffFileInfo array", async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("/pulls/42?")) {
        return {
          stdout: JSON.stringify({
            base_sha: "abc123",
            base_ref: "main",
            merge_commit_sha: "def456",
          }),
        };
      }
      if (joined.includes("/pulls/42/files")) {
        return {
          stdout: JSON.stringify([
            {
              filename: "src/app.ts",
              status: "modified",
              additions: 10,
              deletions: 3,
              changes: 13,
              patch: "...",
            },
            {
              filename: "src/new.ts",
              status: "added",
              additions: 20,
              deletions: 0,
              changes: 20,
              patch: "...",
            },
            {
              filename: "src/old.ts",
              status: "removed",
              additions: 0,
              deletions: 15,
              changes: 15,
              patch: "...",
            },
            {
              filename: "src/moved.ts",
              status: "renamed",
              previous_filename: "src/original.ts",
              additions: 2,
              deletions: 1,
              changes: 3,
              patch: "...",
            },
          ]),
        };
      }
      return { stdout: "[]" };
    });

    const result = await getPrDiffFiles("owner", "repo", 42);
    expect(result.success).toBe(true);
    expect(result.baseSha).toBe("abc123");
    expect(result.mergeSha).toBe("def456");
    expect(result.baseBranch).toBe("main");
    expect(result.files).toHaveLength(4);
    expect(result.files[0]).toEqual({
      path: "src/app.ts",
      status: "modified",
      linesAdded: 10,
      linesRemoved: 3,
      isBinary: false,
    });
    expect(result.files[1]).toEqual({
      path: "src/new.ts",
      status: "added",
      linesAdded: 20,
      linesRemoved: 0,
      isBinary: false,
    });
    expect(result.files[2]).toEqual({
      path: "src/old.ts",
      status: "deleted",
      linesAdded: 0,
      linesRemoved: 15,
      isBinary: false,
    });
    expect(result.files[3]).toEqual({
      path: "src/moved.ts",
      oldPath: "src/original.ts",
      status: "renamed",
      linesAdded: 2,
      linesRemoved: 1,
      isBinary: false,
    });
  });

  it("detects binary files (no patch, zero changes)", async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("/pulls/42?")) {
        return {
          stdout: JSON.stringify({ base_sha: "abc", base_ref: "main", merge_commit_sha: "def" }),
        };
      }
      if (joined.includes("/pulls/42/files")) {
        return {
          stdout: JSON.stringify([
            { filename: "image.png", status: "added", additions: 0, deletions: 0, changes: 0 },
          ]),
        };
      }
      return { stdout: "[]" };
    });

    const result = await getPrDiffFiles("owner", "repo", 42);
    expect(result.files[0].isBinary).toBe(true);
  });

  it("maps 'copied' status to 'added'", async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("/pulls/42?")) {
        return {
          stdout: JSON.stringify({ base_sha: "abc", base_ref: "main", merge_commit_sha: "def" }),
        };
      }
      if (joined.includes("/pulls/42/files")) {
        return {
          stdout: JSON.stringify([
            {
              filename: "copy.ts",
              status: "copied",
              additions: 5,
              deletions: 0,
              changes: 5,
              patch: "...",
            },
          ]),
        };
      }
      return { stdout: "[]" };
    });

    const result = await getPrDiffFiles("owner", "repo", 42);
    expect(result.files[0].status).toBe("added");
  });

  it("returns error when merge_commit_sha is null", async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("/pulls/42?")) {
        return {
          stdout: JSON.stringify({ base_sha: "abc", base_ref: "main", merge_commit_sha: null }),
        };
      }
      return { stdout: "[]" };
    });

    const result = await getPrDiffFiles("owner", "repo", 42);
    expect(result.success).toBe(false);
    expect(result.error).toContain("merge commit");
  });

  it("returns error when gh api fails", async () => {
    mockExec.mockImplementation(() => new Error("gh: not found"));

    const result = await getPrDiffFiles("owner", "repo", 42);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("getPrFileContent", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  it("fetches old and new content for a modified file", async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("ref=baseSha123")) {
        return { stdout: JSON.stringify({ content: btoa("old content"), encoding: "base64" }) };
      }
      if (joined.includes("ref=mergeSha456")) {
        return { stdout: JSON.stringify({ content: btoa("new content"), encoding: "base64" }) };
      }
      return { stdout: "{}" };
    });

    const result = await getPrFileContent(
      "owner",
      "repo",
      "src/app.ts",
      "modified",
      "baseSha123",
      "mergeSha456",
    );
    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("old content");
    expect(result.newContent).toBe("new content");
  });

  it("returns empty old content for added files", async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("ref=mergeSha")) {
        return { stdout: JSON.stringify({ content: btoa("new file"), encoding: "base64" }) };
      }
      return { stdout: "{}" };
    });

    const result = await getPrFileContent(
      "owner",
      "repo",
      "new.ts",
      "added",
      "baseSha",
      "mergeSha",
    );
    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("");
    expect(result.newContent).toBe("new file");
  });

  it("returns empty new content for deleted files", async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("ref=baseSha")) {
        return { stdout: JSON.stringify({ content: btoa("deleted content"), encoding: "base64" }) };
      }
      return { stdout: "{}" };
    });

    const result = await getPrFileContent(
      "owner",
      "repo",
      "old.ts",
      "deleted",
      "baseSha",
      "mergeSha",
    );
    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("deleted content");
    expect(result.newContent).toBe("");
  });

  it("uses oldPath for renamed files", async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("original.ts") && joined.includes("ref=baseSha")) {
        return { stdout: JSON.stringify({ content: btoa("original"), encoding: "base64" }) };
      }
      if (joined.includes("moved.ts") && joined.includes("ref=mergeSha")) {
        return { stdout: JSON.stringify({ content: btoa("moved"), encoding: "base64" }) };
      }
      return { stdout: "{}" };
    });

    const result = await getPrFileContent(
      "owner",
      "repo",
      "moved.ts",
      "renamed",
      "baseSha",
      "mergeSha",
      "original.ts",
    );
    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("original");
    expect(result.newContent).toBe("moved");
  });

  it("handles GitHub 403 for large files gracefully", async () => {
    mockExec.mockImplementation(() => {
      return new Error("This API returns blobs up to 1 MB in size");
    });

    const result = await getPrFileContent(
      "owner",
      "repo",
      "big.bin",
      "modified",
      "baseSha",
      "mergeSha",
    );
    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("");
    expect(result.newContent).toBe("");
    expect(result.error).toContain("too large");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run server:test -- --testPathPattern=pr-diff`
Expected: FAIL — module `@openkit/integrations/github/pr-diff` does not exist

- [ ] **Step 3: Implement `getPrDiffFiles` and `getPrFileContent`**

Create `libs/integrations/src/github/pr-diff.ts`:

```typescript
/**
 * GitHub PR diff functions for the merged PR diff viewer.
 *
 * Fetches PR file list and file content from GitHub's API via the `gh` CLI,
 * returning data in the same DiffFileInfo/DiffFileContentResponse shapes
 * used by the local git diff viewer.
 */
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";

import { resolveCommandPath, withAugmentedPathEnv } from "@openkit/shared/command-path";
import type {
  DiffFileInfo,
  DiffFileContentResponse,
  PrDiffListResponse,
} from "@openkit/shared/worktree-types";

import { log } from "./logger";

const execFileRaw = promisify(execFileCb);
const execFile: typeof execFileRaw = ((cmd: string, args: string[], options?: unknown) => {
  const opts = (options ?? {}) as { env?: NodeJS.ProcessEnv };
  return execFileRaw(resolveCommandPath(cmd), args, {
    ...opts,
    env: withAugmentedPathEnv(opts.env ?? process.env),
  });
}) as typeof execFileRaw;

/** GitHub file status to our DiffFileInfo status. */
function mapStatus(ghStatus: string): DiffFileInfo["status"] {
  switch (ghStatus) {
    case "added":
      return "added";
    case "removed":
      return "deleted";
    case "modified":
    case "changed":
      return "modified";
    case "renamed":
      return "renamed";
    case "copied":
      return "added";
    default:
      return "modified";
  }
}

/** Fetch the file list and metadata for a merged PR from GitHub's API. */
export async function getPrDiffFiles(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrDiffListResponse> {
  try {
    // Fetch PR metadata for base SHA, merge SHA, and base branch.
    // Uses --jq to extract only the fields we need.
    const { stdout: metaRaw } = await execFile(
      "gh",
      [
        "api",
        `repos/${owner}/${repo}/pulls/${prNumber}`,
        "--jq",
        "{base_sha: .base.sha, base_ref: .base.ref, merge_commit_sha: .merge_commit_sha}",
      ],
      { encoding: "utf-8" },
    );
    const meta = JSON.parse(metaRaw);

    if (!meta.merge_commit_sha) {
      return {
        success: false,
        files: [],
        baseBranch: meta.base_ref ?? "",
        baseSha: meta.base_sha ?? "",
        mergeSha: "",
        error: "Merge commit not available for this PR",
      };
    }

    // Fetch PR files. GitHub returns max 100 per page; use per_page=100.
    // For PRs with 100+ files, only the first page is returned.
    // Full pagination can be added later if needed.
    const { stdout: filesRaw } = await execFile(
      "gh",
      ["api", `repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`],
      { encoding: "utf-8" },
    );
    const ghFiles = JSON.parse(filesRaw);

    const files: DiffFileInfo[] = ghFiles.map((f: Record<string, unknown>) => {
      const status = mapStatus(f.status as string);
      const isBinary = !f.patch && (f.changes as number) === 0;
      return {
        path: f.filename as string,
        ...(f.previous_filename ? { oldPath: f.previous_filename as string } : {}),
        status,
        linesAdded: (f.additions as number) ?? 0,
        linesRemoved: (f.deletions as number) ?? 0,
        isBinary,
      };
    });

    log.info("Fetched PR diff files", {
      domain: "diff",
      prNumber,
      fileCount: files.length,
    });

    return {
      success: true,
      files,
      baseBranch: meta.base_ref,
      baseSha: meta.base_sha,
      mergeSha: meta.merge_commit_sha,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch PR diff files";
    log.error("Failed to fetch PR diff files", {
      domain: "diff",
      owner,
      repo,
      prNumber,
      error: message,
    });
    return {
      success: false,
      files: [],
      baseBranch: "",
      baseSha: "",
      mergeSha: "",
      error: message,
    };
  }
}

/** Decode base64 content from GitHub's contents API response. */
function decodeContent(raw: string): string {
  const parsed = JSON.parse(raw);
  if (parsed.content && parsed.encoding === "base64") {
    return Buffer.from(parsed.content, "base64").toString("utf-8");
  }
  return parsed.content ?? "";
}

/** Fetch old/new content for a single file in a merged PR. */
export async function getPrFileContent(
  owner: string,
  repo: string,
  filePath: string,
  status: string,
  baseSha: string,
  mergeSha: string,
  oldPath?: string,
): Promise<DiffFileContentResponse> {
  try {
    let oldContent = "";
    let newContent = "";

    if (status !== "added") {
      const fetchPath = status === "renamed" && oldPath ? oldPath : filePath;
      try {
        const { stdout } = await execFile(
          "gh",
          ["api", `repos/${owner}/${repo}/contents/${fetchPath}?ref=${baseSha}`],
          { encoding: "utf-8" },
        );
        oldContent = decodeContent(stdout);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("too large") || msg.includes("1 MB")) {
          return {
            success: true,
            oldContent: "",
            newContent: "",
            error: "File too large to display",
          };
        }
        throw err;
      }
    }

    if (status !== "deleted") {
      try {
        const { stdout } = await execFile(
          "gh",
          ["api", `repos/${owner}/${repo}/contents/${filePath}?ref=${mergeSha}`],
          { encoding: "utf-8" },
        );
        newContent = decodeContent(stdout);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("too large") || msg.includes("1 MB")) {
          return {
            success: true,
            oldContent: "",
            newContent: "",
            error: "File too large to display",
          };
        }
        throw err;
      }
    }

    return { success: true, oldContent, newContent };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch file content";
    log.error("Failed to fetch PR file content", {
      domain: "diff",
      owner,
      repo,
      filePath,
      error: message,
    });
    return { success: false, oldContent: "", newContent: "", error: message };
  }
}
```

- [ ] **Step 4: Export from index**

Add to `libs/integrations/src/github/index.ts`:

```typescript
export { getPrDiffFiles, getPrFileContent } from "./pr-diff";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm nx run server:test -- --testPathPattern=pr-diff`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add libs/integrations/src/github/pr-diff.ts libs/integrations/src/github/index.ts apps/server/src/__test__/pr-diff.test.ts
git commit -m "feat(integrations): add PR diff functions for fetching merged PR files from GitHub API"
```

---

### Task 3: Expose `getRepoConfig()` on GitHubManager

**Files:**

- Modify: `libs/integrations/src/github/github-manager.ts`

The route handlers need access to `owner` and `repo` to call the PR diff functions. Currently `GitHubManager` doesn't expose `config` directly.

- [ ] **Step 1: Add `getRepoConfig` method**

Add after `getDefaultBranch()` (line 120) in `libs/integrations/src/github/github-manager.ts`:

```typescript
  getRepoConfig(): { owner: string; repo: string } | null {
    if (!this.config) return null;
    return { owner: this.config.owner, repo: this.config.repo };
  }
```

- [ ] **Step 2: Verify the build**

Run: `pnpm check:types`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add libs/integrations/src/github/github-manager.ts
git commit -m "feat(integrations): expose getRepoConfig on GitHubManager"
```

---

### Task 4: Add server endpoints for PR diff

**Files:**

- Modify: `apps/server/src/routes/github.ts`

Two new routes following the exact same pattern as existing `/api/worktrees/:id/diff` and `/api/worktrees/:id/diff/file`.

- [ ] **Step 1: Add imports**

At the top of `apps/server/src/routes/github.ts`, add:

```typescript
import { getPrDiffFiles, getPrFileContent } from "@openkit/integrations/github/pr-diff";
import { findPRForBranch } from "@openkit/integrations/github/gh-client";
```

(`findPRForBranch` may need importing if not already present — check existing imports.)

- [ ] **Step 2: Add `GET /api/worktrees/:id/pr-diff` route**

Add after the existing `/api/worktrees/:id/diff/file` route (after line 376):

```typescript
app.get("/api/worktrees/:id/pr-diff", async (c) => {
  const ghManager = manager.getGitHubManager();
  if (!ghManager?.isAvailable()) {
    return c.json(
      {
        success: false,
        files: [],
        baseBranch: "",
        baseSha: "",
        mergeSha: "",
        error: "GitHub integration not available",
      },
      400,
    );
  }
  try {
    const id = c.req.param("id");
    const resolved = manager.resolveWorktree(id);
    if (!resolved.success) {
      return c.json(
        {
          success: false,
          files: [],
          baseBranch: "",
          baseSha: "",
          mergeSha: "",
          error: resolved.error,
        },
        toResolutionStatus(resolved.code),
      );
    }

    // Get PR number from cache, fall back to live fetch
    let pr = ghManager.getCachedPR(resolved.worktreeId);
    if (pr === undefined) {
      const repoConfig = ghManager.getRepoConfig();
      if (repoConfig) {
        pr = await findPRForBranch(repoConfig.owner, repoConfig.repo, resolved.worktree.branch);
      }
    }
    if (!pr) {
      return c.json(
        {
          success: false,
          files: [],
          baseBranch: "",
          baseSha: "",
          mergeSha: "",
          error: "No PR found for this worktree",
        },
        404,
      );
    }

    const repoConfig = ghManager.getRepoConfig();
    if (!repoConfig) {
      return c.json(
        {
          success: false,
          files: [],
          baseBranch: "",
          baseSha: "",
          mergeSha: "",
          error: "Repository config not available",
        },
        400,
      );
    }

    const result = await getPrDiffFiles(repoConfig.owner, repoConfig.repo, pr.number);
    return c.json(result, result.success ? 200 : 400);
  } catch (error) {
    return c.json(
      {
        success: false,
        files: [],
        baseBranch: "",
        baseSha: "",
        mergeSha: "",
        error: error instanceof Error ? error.message : "Failed to get PR diff",
      },
      400,
    );
  }
});
```

- [ ] **Step 3: Add `GET /api/worktrees/:id/pr-diff/file` route**

Add immediately after:

```typescript
app.get("/api/worktrees/:id/pr-diff/file", async (c) => {
  const ghManager = manager.getGitHubManager();
  if (!ghManager?.isAvailable()) {
    return c.json(
      { success: false, oldContent: "", newContent: "", error: "GitHub integration not available" },
      400,
    );
  }
  try {
    const id = c.req.param("id");
    const filePath = c.req.query("path");
    const status = c.req.query("status") ?? "modified";
    const baseSha = c.req.query("baseSha");
    const mergeSha = c.req.query("mergeSha");
    const oldPath = c.req.query("oldPath") || undefined;

    if (!filePath) {
      return c.json(
        { success: false, oldContent: "", newContent: "", error: "path query param is required" },
        400,
      );
    }
    if (!baseSha || !mergeSha) {
      return c.json(
        {
          success: false,
          oldContent: "",
          newContent: "",
          error: "baseSha and mergeSha query params are required",
        },
        400,
      );
    }

    const resolved = manager.resolveWorktree(id);
    if (!resolved.success) {
      return c.json(
        { success: false, oldContent: "", newContent: "", error: resolved.error },
        toResolutionStatus(resolved.code),
      );
    }

    const repoConfig = ghManager.getRepoConfig();
    if (!repoConfig) {
      return c.json(
        {
          success: false,
          oldContent: "",
          newContent: "",
          error: "Repository config not available",
        },
        400,
      );
    }

    const result = await getPrFileContent(
      repoConfig.owner,
      repoConfig.repo,
      filePath,
      status,
      baseSha,
      mergeSha,
      oldPath,
    );
    return c.json(result, result.success ? 200 : 400);
  } catch (error) {
    return c.json(
      {
        success: false,
        oldContent: "",
        newContent: "",
        error: error instanceof Error ? error.message : "Failed to get PR file content",
      },
      400,
    );
  }
});
```

- [ ] **Step 4: Verify the build**

Run: `pnpm check:types`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/github.ts
git commit -m "feat(server): add PR diff endpoints for merged PR file list and content"
```

---

### Task 5: Add frontend API functions for PR diff

**Files:**

- Modify: `apps/web-app/src/hooks/api.ts`

- [ ] **Step 1: Add `PrDiffListResponse` import**

Add `PrDiffListResponse` to the types import at the top of `api.ts` (wherever `DiffListResponse` and `DiffFileContentResponse` are imported).

- [ ] **Step 2: Add `fetchPrDiffFiles` function**

Add after `fetchDiffFileContent` (around line 433):

```typescript
export async function fetchPrDiffFiles(
  worktreeId: string,
  serverUrl: string | null = null,
): Promise<PrDiffListResponse> {
  try {
    const base = getBaseUrl(serverUrl);
    const res = await fetch(`${base}/api/worktrees/${encodeURIComponent(worktreeId)}/pr-diff`);
    if (!isJsonResponse(res)) {
      return {
        success: false,
        files: [],
        baseBranch: "",
        baseSha: "",
        mergeSha: "",
        error: `Server returned ${res.status} ${res.statusText}`,
      };
    }
    return await res.json();
  } catch (err) {
    return {
      success: false,
      files: [],
      baseBranch: "",
      baseSha: "",
      mergeSha: "",
      error: err instanceof Error ? err.message : "Failed to fetch PR diff files",
    };
  }
}
```

- [ ] **Step 3: Add `fetchPrDiffFileContent` function**

```typescript
export async function fetchPrDiffFileContent(
  worktreeId: string,
  filePath: string,
  fileStatus: string,
  baseSha: string,
  mergeSha: string,
  oldPath?: string,
  serverUrl: string | null = null,
): Promise<DiffFileContentResponse> {
  try {
    const base = getBaseUrl(serverUrl);
    const params = new URLSearchParams({
      path: filePath,
      status: fileStatus,
      baseSha,
      mergeSha,
    });
    if (oldPath) params.set("oldPath", oldPath);
    const res = await fetch(
      `${base}/api/worktrees/${encodeURIComponent(worktreeId)}/pr-diff/file?${params}`,
    );
    if (!isJsonResponse(res)) {
      return {
        success: false,
        oldContent: "",
        newContent: "",
        error: `Server returned ${res.status} ${res.statusText}`,
      };
    }
    return await res.json();
  } catch (err) {
    return {
      success: false,
      oldContent: "",
      newContent: "",
      error: err instanceof Error ? err.message : "Failed to fetch PR file content",
    };
  }
}
```

- [ ] **Step 4: Verify the build**

Run: `pnpm check:types`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web-app/src/hooks/api.ts
git commit -m "feat(web-app): add API functions for fetching merged PR diff data"
```

---

### Task 6: Update DiffFileSection to accept a custom fetch function

**Files:**

- Modify: `apps/web-app/src/components/detail/DiffFileSection.tsx`

- [ ] **Step 1: Add optional `fetchContent` prop**

Update `DiffFileSectionProps` (line 18-26):

```typescript
interface DiffFileSectionProps {
  file: DiffFileInfo;
  expanded: boolean;
  onToggle: () => void;
  viewMode: "unified" | "split";
  worktreeId: string;
  includeCommitted: boolean;
  refreshKey: number;
  /** Optional custom content fetcher. Overrides the default fetchDiffFileContent when provided. */
  fetchContent?: () => Promise<DiffFileContentResponse>;
}
```

Add the import for `DiffFileContentResponse` at the top if not already present.

- [ ] **Step 2: Use a ref for the custom fetcher and update `doFetch`**

Store `fetchContent` in a ref to avoid it destabilizing the `doFetch` callback:

```typescript
const fetchContentRef = useRef(fetchContent);
fetchContentRef.current = fetchContent;
```

Then in the `doFetch` callback (line 48-86), replace the direct `fetchDiffFileContent` call to check the ref:

```typescript
const doFetch = useCallback(() => {
  if (content || fetchingRef.current || file.isBinary) return;
  fetchingRef.current = true;
  setLoading(true);
  setError(null);

  const fetchPromise = fetchContentRef.current
    ? fetchContentRef.current()
    : fetchDiffFileContent(
        worktreeId,
        file.path,
        file.status,
        includeCommitted,
        file.oldPath,
        serverUrl,
      );

  fetchPromise
    .then((res) => {
      setLoading(false);
      if (!res.success) {
        log.error("Failed to fetch file content", {
          domain: "diff",
          filePath: file.path,
          error: res.error,
        });
        setError(res.error ?? "Failed to load file content");
        return;
      }
      setContent({ oldContent: res.oldContent, newContent: res.newContent });
    })
    .catch((err) => {
      setLoading(false);
      fetchingRef.current = false;
      const msg = err instanceof Error ? err.message : "Failed to load file content";
      log.error("Failed to fetch file content", {
        domain: "diff",
        filePath: file.path,
        error: err,
      });
      setError(msg);
    });
}, [content, file, worktreeId, includeCommitted, serverUrl]);
```

Note: `fetchContent` is NOT in the dependency array — it's read from the ref. This prevents re-fetch loops when the parent passes a new function reference.

- [ ] **Step 3: Verify the build**

Run: `pnpm check:types`
Expected: No type errors. Existing callers don't pass `fetchContent`, so no behavior change.

- [ ] **Step 4: Commit**

```bash
git add apps/web-app/src/components/detail/DiffFileSection.tsx
git commit -m "feat(web-app): support custom content fetcher in DiffFileSection"
```

---

### Task 7: Update DiffViewerTab for merged PR diff display

**Files:**

- Modify: `apps/web-app/src/components/detail/DiffViewerTab.tsx`

This is the key integration point. When `worktree.githubPrState === "merged"`, fetch from PR diff endpoints and cache with react-query.

- [ ] **Step 1: Add imports**

```typescript
import { useQuery } from "@tanstack/react-query";
import { fetchPrDiffFiles, fetchPrDiffFileContent } from "../../hooks/api";
import type { PrDiffListResponse } from "../../types";
```

- [ ] **Step 2: Add merged state detection and react-query**

Inside `DiffViewerTab`, add after state declarations:

```typescript
const isMerged = worktree.githubPrState === "merged";

const prDiffQuery = useQuery<PrDiffListResponse>({
  queryKey: ["pr-diff", worktree.id],
  queryFn: () => fetchPrDiffFiles(worktree.id, serverUrl),
  enabled: isMerged && visible,
  staleTime: Infinity,
});
```

- [ ] **Step 3: Wire up merged data into existing state**

Add an effect that syncs `prDiffQuery.data` into the existing `files`/`loading`/`error` state when merged:

```typescript
// Sync merged PR diff data into component state
useEffect(() => {
  if (!isMerged) return;
  if (prDiffQuery.isLoading) {
    setLoading(true);
    setError(null);
    return;
  }
  setLoading(false);
  if (prDiffQuery.error) {
    setError(
      prDiffQuery.error instanceof Error ? prDiffQuery.error.message : "Failed to load PR diff",
    );
    setFiles([]);
    return;
  }
  if (prDiffQuery.data) {
    if (!prDiffQuery.data.success) {
      setError(prDiffQuery.data.error ?? "Failed to load PR diff");
      setFiles([]);
      return;
    }
    setFiles(prDiffQuery.data.files);
    setRefreshKey((k) => k + 1);
    if (prDiffQuery.data.files.length < FILES_EXPANDED_THRESHOLD) {
      setExpandedFiles(new Set(prDiffQuery.data.files.map((f) => f.path)));
    } else {
      setExpandedFiles(new Set());
    }
  }
}, [isMerged, prDiffQuery.isLoading, prDiffQuery.data, prDiffQuery.error]);
```

- [ ] **Step 4: Guard existing fetch effects from running when merged**

Update the two existing fetch effects to skip when merged:

```typescript
// Fetch when tab becomes visible, worktree changes, or includeCommitted toggles
useEffect(() => {
  if (!visible || isMerged) return;
  fetchFiles();
}, [visible, worktree.id, includeCommitted, fetchFiles, isMerged]);

// Best-effort refresh when hasUncommitted changes
useEffect(() => {
  if (!visible || isMerged) return;
  fetchFiles();
}, [worktree.hasUncommitted]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 5: Hide "Committed" toggle for merged PRs**

Wrap the committed toggle section:

```typescript
{!isMerged && (
  <div className="flex items-center gap-1.5">
    <span className="text-[11px] text-[#6b7280] select-none">Committed</span>
    <ToggleSwitch
      checked={includeCommitted}
      onToggle={() => setIncludeCommitted((prev) => !prev)}
      size="sm"
    />
  </div>
)}
```

- [ ] **Step 6: Create memoized fetch content factory and pass to DiffFileSection**

**IMPORTANT**: The `fetchContent` prop must NOT be an inline arrow function — that creates a new reference on every render, causing `doFetch` to be recreated every render, which triggers infinite re-fetches for expanded files.

Add a memoized factory function:

```typescript
// Memoized factory for PR file content fetchers — stable references prevent
// DiffFileSection's doFetch from re-creating on every render.
const prBaseSha = prDiffQuery.data?.baseSha;
const prMergeSha = prDiffQuery.data?.mergeSha;
const prDataSuccess = prDiffQuery.data?.success;

const makePrFetchContent = useCallback(
  (file: DiffFileInfo) => () =>
    fetchPrDiffFileContent(
      worktree.id,
      file.path,
      file.status,
      prBaseSha!,
      prMergeSha!,
      file.oldPath,
      serverUrl,
    ),
  [worktree.id, prBaseSha, prMergeSha, serverUrl],
);
```

Then in the file rendering:

```typescript
files.map((file) => (
  <DiffFileSection
    key={file.path}
    ref={(el) => {
      setFileRef(file.path, el);
      if (el) el.dataset.filePath = file.path;
    }}
    file={file}
    expanded={expandedFiles.has(file.path)}
    onToggle={() => handleToggleFile(file.path)}
    viewMode={viewMode}
    worktreeId={worktree.id}
    includeCommitted={includeCommitted}
    refreshKey={refreshKey}
    fetchContent={isMerged && prDataSuccess ? makePrFetchContent(file) : undefined}
  />
))
```

- [ ] **Step 7: Update empty-state message for merged PRs**

```typescript
{files.length === 0 ? (
  <div className="flex flex-col items-center justify-center h-full gap-1.5 -mt-[10%]">
    <FileCode2 className="w-7 h-7 text-[#4b5563] mb-3" strokeWidth={1.5} />
    <span className="text-[13px] font-medium tracking-[-0.01em] text-[#6b7280]">
      {isMerged ? "Could not load PR changes" : "No changes detected"}
    </span>
    <span className="text-[11px] text-[#4b5563] max-w-[240px] text-center leading-relaxed">
      {isMerged
        ? "The PR diff could not be fetched from GitHub"
        : "Start coding or run an agent — diffs will appear here automatically"}
    </span>
  </div>
)
```

- [ ] **Step 8: Verify the build**

Run: `pnpm check:types`
Expected: No type errors

- [ ] **Step 9: Commit**

```bash
git add apps/web-app/src/components/detail/DiffViewerTab.tsx
git commit -m "feat(web-app): show merged PR diff in diff viewer tab via GitHub API"
```

---

### Task 8: Add tests for DiffViewerTab merged PR behavior

**Files:**

- Modify: `apps/web-app/src/components/detail/__test__/DiffViewerTab.test.tsx`

The existing test mocks `../../../hooks/api` with only `fetchDiffFiles`. After Task 5 added `fetchPrDiffFiles` and `fetchPrDiffFileContent` to that module, the mock must include them too — otherwise the imports resolve to `undefined` and tests crash.

- [ ] **Step 1: Update the api mock to include new functions**

In `DiffViewerTab.test.tsx`, update the mock (currently around line 44-47):

```typescript
const mockFetchDiffFiles = vi.fn();
const mockFetchPrDiffFiles = vi.fn();
const mockFetchPrDiffFileContent = vi.fn();
vi.mock("../../../hooks/api", () => ({
  fetchDiffFiles: (...args: unknown[]) => mockFetchDiffFiles(...args),
  fetchPrDiffFiles: (...args: unknown[]) => mockFetchPrDiffFiles(...args),
  fetchPrDiffFileContent: (...args: unknown[]) => mockFetchPrDiffFileContent(...args),
}));
```

- [ ] **Step 2: Add test for merged PR showing diff files**

```typescript
  describe("merged PR diff", () => {
    const mergedWorktree = makeWorktree({
      githubPrState: "merged",
      githubPrUrl: "https://github.com/owner/repo/pull/42",
    });

    beforeEach(() => {
      mockFetchPrDiffFiles.mockResolvedValue({
        success: true,
        files: sampleFiles,
        baseBranch: "main",
        baseSha: "abc123",
        mergeSha: "def456",
      });
    });

    it("fetches PR diff files instead of local diff for merged worktrees", async () => {
      render(<DiffViewerTab worktree={mergedWorktree} visible />);

      await waitFor(() => {
        expect(screen.getByTestId("file-section-src/app.ts")).toBeInTheDocument();
      });

      expect(mockFetchPrDiffFiles).toHaveBeenCalledWith(mergedWorktree.id, null);
      expect(mockFetchDiffFiles).not.toHaveBeenCalled();
    });

    it("hides the Committed toggle for merged worktrees", async () => {
      render(<DiffViewerTab worktree={mergedWorktree} visible />);

      await waitFor(() => {
        expect(screen.getByTestId("file-section-src/app.ts")).toBeInTheDocument();
      });

      expect(screen.queryByText("Committed")).not.toBeInTheDocument();
    });

    it("shows merged empty state when PR diff fails", async () => {
      mockFetchPrDiffFiles.mockResolvedValue({
        success: false,
        files: [],
        baseBranch: "",
        baseSha: "",
        mergeSha: "",
        error: "PR not found",
      });

      render(<DiffViewerTab worktree={mergedWorktree} visible />);

      await waitFor(() => {
        expect(screen.getByText("Could not load PR changes")).toBeInTheDocument();
      });
    });
  });
```

- [ ] **Step 3: Run tests**

Run: `pnpm nx run web-app:test -- --testPathPattern=DiffViewerTab`
Expected: All tests PASS (both existing and new)

- [ ] **Step 4: Commit**

```bash
git add apps/web-app/src/components/detail/__test__/DiffViewerTab.test.tsx
git commit -m "test(web-app): add tests for merged PR diff display in DiffViewerTab"
```

---

### Task 9: Final checks

**Files:**

- All modified files

- [ ] **Step 1: Run lint and format checks**

Run: `pnpm check:lint && pnpm check:format`
Expected: No errors. Fix any that appear.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass including new pr-diff tests and DiffViewerTab merged tests.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint and format issues"
```
