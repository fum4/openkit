# Merged PR Diff View

Display the full diff for merged PRs in the same diff viewer used for WIP branches, sourced from GitHub's API instead of local git.

## Context

Currently, when a PR is merged the diff stats (lines added/removed) become stale because they're calculated via local `git diff` against the base branch — once merged, the diff is zero. The worktree entry persists with a "Merged" badge but there's no way to see what actually changed.

## Approach

Add a parallel server-side data path that fetches PR diff data from GitHub's API and returns it in the same `DiffListResponse` / `DiffFileContentResponse` format the existing diff viewer consumes. The frontend detects merged state and switches data source. All existing diff UI components (file sidebar, Monaco editor, file sections) remain unchanged.

## Data Source

**GitHub API via `gh` CLI** — no new auth management needed. The `gh` CLI is already used throughout `gh-client.ts` for PR operations.

- Merged PR diffs are immutable, so responses are cached with `staleTime: Infinity` via react-query on the frontend.
- No local storage or disk persistence — data is fetched from GitHub on demand and cached in memory.

## Server Endpoints

### `GET /api/worktrees/:id/pr-diff`

Returns the file list for a merged PR.

1. Look up the worktree's PR number from cached PR info (`githubManager.getCachedPR`). If cache miss (polling hasn't run yet), do a live fetch via `findPRForBranch()` as fallback. If PR not found at all, return `{ success: false, error: "PR not found" }`.
2. Call `gh api repos/{owner}/{repo}/pulls/{prNumber}/files` (paginated, max 100/page)
3. Map GitHub file objects to `DiffFileInfo[]`:
   - `status`: GitHub `added`→`added`, `removed`→`deleted`, `modified`→`modified`, `renamed`→`renamed`, `copied`→`added` (treat as new file with no rename tracking)
   - `filename`→`path`, `previous_filename`→`oldPath`
   - `additions`→`linesAdded`, `deletions`→`linesRemoved`
   - Binary detection: no `patch` field and `changes === 0`
4. Also fetch PR metadata (`gh api repos/{owner}/{repo}/pulls/{prNumber}`) to get `base.sha`, `base.ref`, and `merge_commit_sha`. Return these alongside the file list so the frontend can pass them to the file content endpoint (avoids redundant metadata fetches per file).
5. Return `DiffListResponse` with `baseBranch` set to the PR's `base.ref` (e.g. `"main"`)

**Extended response type** for the file list endpoint:

```typescript
interface PrDiffListResponse extends DiffListResponse {
  baseSha: string;
  mergeSha: string;
}
```

### `GET /api/worktrees/:id/pr-diff/file?path=...&status=...&oldPath=...&baseSha=...&mergeSha=...`

Returns old/new content for a single file in the merged PR. The `baseSha` and `mergeSha` query params are provided by the frontend from the file list response, eliminating redundant PR metadata fetches.

1. Old content: `gh api repos/{owner}/{repo}/contents/{path}?ref={baseSha}` (base64 decoded)
2. New content: `gh api repos/{owner}/{repo}/contents/{path}?ref={mergeSha}`
3. Handle by status:
   - `added`: old content empty
   - `deleted`: new content empty
   - `renamed`: old content from `oldPath` at baseSha
4. GitHub's contents API returns 403 for files >1MB. Catch this specific error and return empty content with the same skip behavior as the current diff viewer (DiffFileSection already shows "Binary file — cannot display diff" for empty content on non-binary files at large sizes). For files that need the >1MB path, fall back to the Git Blobs API (`gh api repos/{owner}/{repo}/git/blobs/{sha}`) if needed in a future iteration.
5. Return `DiffFileContentResponse`

### Server-Side PR Metadata Caching

The file list endpoint fetches PR metadata (base SHA, merge SHA) once. Since `merge_commit_sha` can be null in rare edge cases (force-pushed after merge), validate it before returning — if null, return `{ success: false, error: "Merge commit not available" }`.

## Frontend Changes

### DiffViewerTab.tsx

- Detect `githubPrState === "merged"` from worktree data
- When merged: call `fetchPrDiffFiles()` / `fetchPrDiffFileContent()` (new API functions) instead of the local git diff variants
- Both use react-query `useQuery` with `staleTime: Infinity`
- Hide the "include committed" toggle (irrelevant for merged PRs — it's always the full PR diff)
- Store `baseSha` and `mergeSha` from the file list response, pass them down to file sections

### DiffFileSection.tsx

- Minimal change: accept an optional `fetchContentFn` prop (or similar mechanism) so `DiffViewerTab` can inject the merged-PR content fetcher. This avoids the component needing to know about PR-specific endpoints — it just calls whatever fetch function it receives. When not provided, falls back to the existing `fetchDiffFileContent`.
- `includeCommitted` prop is ignored when using the PR content fetcher (the function signature handles this internally).

### No Changes To

- `DiffFileSidebar.tsx` — receives same file list
- `DiffMonacoEditor.tsx` — receives same `oldContent`/`newContent`
- `diff-constants.ts` — status colors/labels unchanged

## Error Handling

- **PR not found** (deleted repo, permissions): show error state in diff tab with link to PR URL as fallback
- **Cache miss**: live-fetch PR via `findPRForBranch()` before failing
- **Null merge_commit_sha**: return error, frontend shows message with link to PR on GitHub
- **GitHub rate limiting**: surface error, user can retry
- **Large files (>1MB)**: GitHub contents API returns 403 — catch and return empty content, same UX as current skip behavior
- **No GitHub configured**: diff tab not shown for merged worktrees (consistent with current behavior)

## What This Does NOT Include

- No local diff snapshot/persistence — always fetches from GitHub
- No automatic worktree cleanup on merge
- No new activity events
- No Git Blobs API fallback for >1MB files (can add later if needed)
