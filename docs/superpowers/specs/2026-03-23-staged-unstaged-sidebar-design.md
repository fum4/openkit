# Staged/Unstaged File Split in Diff Sidebar

Split the diff sidebar into "Staged Changes" and "Changes" sections with stage/unstage actions, like VS Code's Source Control view.

## Data Model

Add `staged?: boolean` to `DiffFileInfo` in `libs/shared/src/worktree-types.ts`. When `true`, the file is in the git index (staged). When `false` or absent, it's a working tree change or untracked.

## Server Changes

### `getChangedFiles` (git-diff.ts)

When `includeCommitted` is `false` (the default view), run two separate diffs instead of one combined `git diff HEAD`:

1. **Staged**: `git diff --cached --name-status` + `git diff --cached --numstat` → files with `staged: true`
2. **Unstaged**: `git diff --name-status` + `git diff --numstat` → files with `staged: false`
3. **Untracked**: `git ls-files --others --exclude-standard` → files with `staged: false` (same as today)

When `includeCommitted` is `true`, keep the current behavior (`git diff origin/main`) — no staged/unstaged split, all files have `staged: undefined`.

### `getFileContent` (git-diff.ts)

Update to handle staged vs unstaged content correctly:

- **Staged file**: old content from `git show HEAD:<path>`, new content from `git show :<path>` (index)
- **Unstaged file**: old content from `git show :<path>` (index, or HEAD if not in index), new content from working tree (`fs.readFile`)
- Current behavior (no staged flag / includeCommitted): unchanged

### New endpoints

**`POST /api/worktrees/:id/stage`** — body: `{ paths: string[] }`
Runs `git add -- <paths>` in the worktree. Returns `{ success: boolean }`.

**`POST /api/worktrees/:id/unstage`** — body: `{ paths: string[] }`
Runs `git restore --staged -- <paths>` in the worktree. Returns `{ success: boolean }`.

**`POST /api/worktrees/:id/stage-all`** — no body
Runs `git add -A` in the worktree. Returns `{ success: boolean }`.

## Frontend API

In `api.ts`:

- `stageFiles(worktreeId, paths)` → `POST /api/worktrees/:id/stage`
- `unstageFiles(worktreeId, paths)` → `POST /api/worktrees/:id/unstage`
- `stageAllFiles(worktreeId)` → `POST /api/worktrees/:id/stage-all`

## Sidebar Redesign (DiffFileSidebar.tsx)

### Layout

When in default mode (no "Show committed" / "Show merged"):

```
┌─────────────────────────────┐
│ Staged Changes (3)          │
│   M  app.ts          [-]    │  ← hover shows [-] to unstage
│   A  new.ts          [-]    │
│   D  old.ts          [-]    │
├─────────────────────────────┤
│ Changes (5)           [+]   │  ← divider has [+] to stage all
│   M  utils.ts        [+]    │  ← hover shows [+] to stage
│   ?  untracked.ts    [+]    │
│   ...                       │
└─────────────────────────────┘
```

When "Show committed" or "Show merged" is on: flat list as today (no split, no +/- actions).

### Props

```typescript
interface DiffFileSidebarProps {
  files: DiffFileInfo[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  onStageAll?: () => void;
  showStagingActions?: boolean; // false when committed/merged mode
}
```

### File row behavior

- Default: show status label (M/A/D/R/?) and diff stats as today
- On hover: replace the diff stats area with a +/- icon button
  - Staged files: show `-` (minus) icon → calls `onUnstageFile`
  - Unstaged files: show `+` (plus) icon → calls `onStageFile`
- The +/- icon uses `Plus` / `Minus` from lucide-react

### Section headers

- "Staged Changes (N)" — collapsible, shows count
- Divider between sections — subtle border with "Changes (N)" label and a `+` button on hover to stage all
- Both sections use the existing folder tree grouping within each section

### After stage/unstage

Call `onStageFile`/`onUnstageFile` in DiffViewerTab → triggers `fetchFiles()` refresh to get the updated file list. The git status polling (3s) will also update the sidebar stats.

## DiffViewerTab Integration

- Pass `showStagingActions={!showMergedDiff && !includeCommitted}` to DiffFileSidebar
- Wire `onStageFile`, `onUnstageFile`, `onStageAll` to the new API functions + refresh
- Pass `staged` flag through to DiffFileSection so `getFileContent` can use the correct diff mode

## DiffFileSection Changes

- Accept optional `staged?: boolean` prop
- Pass it to `fetchDiffFileContent` so the server returns the correct old/new content
- The existing `includeCommitted` query param already controls the base ref; add `staged` as a new query param

## What This Does NOT Include

- No partial staging (individual hunks/lines) — only whole-file stage/unstage
- No discard changes action (only stage/unstage)
- No changes to the "Show committed" or "Show merged" views
