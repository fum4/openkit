# Design: Replace TASK.md with `openkit task context` CLI command

**Date:** 2026-03-18
**Status:** Approved

## Problem

TASK.md is a generated markdown file written to the worktree root whenever a worktree is created or task data changes. It's a denormalized snapshot that:

- Goes stale unless actively regenerated (PR #76 added regeneration calls to fix this)
- Lives at the worktree root, requiring `ensureGitExclude()` hacks to hide from git
- Duplicates data already stored in `.openkit/issues/<source>/<id>/`
- Bakes generic workflow instructions into every task file (agent communication, phase checkpoints)
- Required a `pendingWorktreeContext` mechanism in the manager to defer writes until worktree creation completes
- Required a `taskHooksProvider` callback to resolve effective hooks at write time

## Solution

Replace TASK.md with a CLI command that reads all relevant files and returns merged, formatted context on demand:

```
openkit task context [<issue-id>]          # markdown (agent-facing)
openkit task context [<issue-id>] --json   # structured JSON
```

### Auto-detection

When no `<issue-id>` is given, the command detects the current worktree and finds its linked issue:

1. Walk up from cwd to find the worktree root (handles `cd`-ing into subdirectories like `src/`, `packages/foo/`). A worktree root is identified by being a child of a directory whose parent path ends with `.openkit/worktrees`.
2. Extract worktree ID from the directory name.
3. Scan `.openkit/issues/*/*/notes.json` files for `linkedWorktreeId` matching the worktree ID.
4. Load the corresponding issue data.

The command uses `findConfigDir()` from `apps/cli/src/config.ts` to locate the project root (traverses upward from cwd), consistent with all other CLI commands.

### Data sources merged

1. **Issue data** — `.openkit/issues/<source>/<id>/issue.json` (unified name, see rename below)
2. **Notes** — `.openkit/issues/<source>/<id>/notes.json` (AI context, todos, hook skill overrides)
3. **Effective hooks** — global `.openkit/hooks.json` merged with per-issue overrides from `notes.json.hookSkills`

### Hooks resolution without a running server

The CLI does NOT spin up `WorktreeManager` (which starts file watchers) for the `context` command. Instead, hooks resolution is extracted as a standalone read:

1. Read global `.openkit/hooks.json` directly (same as `HooksManager.getConfig()`)
2. Read per-issue overrides from `notes.json.hookSkills`
3. Apply override merge logic inline (same as `getEffectiveSkills` but without `WorktreeManager`/`NotesManager` instances)

This keeps the command fast and side-effect-free.

### Markdown output format

The output contains only task-specific content — no generic workflow boilerplate (that belongs in the skill):

```markdown
# LOCAL-1 — Fix authentication bug

**Source:** local
**Status:** todo
**URL:** (none)

## AI Context

<user-provided context from notes>

## Description

<issue description>

## Comments

**Author (2026-03-15):** comment body

## Todos

> Check items with `openkit activity todo --source local --issue LOCAL-1 --id <todo-id> --check`.

- [ ] First item `(todo-id: abc)`
- [x] Completed item `(todo-id: def)`

## Attachments

- `screenshot.png` (image/png) — `/path/to/local/file`

## Linked Resources

- [PR #42](https://github.com/...) (github)

## Hooks (Pre-Implementation)

> Run all pre-implementation hooks BEFORE writing any code.

### Pipeline Checks

- **Lint:** `pnpm check:lint`

### Prompt Hooks

- **Review plan:** Review the implementation plan before coding

### my-skill

Run the `/my-skill` skill if available.

## Hooks (Post-Implementation)

After completing your work, run these hook steps:

### Pipeline Checks

- **Test:** `pnpm test`
- **Build:** `pnpm build`

## Hooks (Custom — Condition-Based)

> Evaluate each condition and run the hook only when it applies.

### Security review

**When:** Changes touch authentication or authorization code
Run `pnpm check:security` in the worktree directory.
```

### JSON output format

The JSON reshapes the existing `HooksInfo` type (`checks: HookStep[]` + `skills: HookSkillRef[]`) into a cleaner structure grouped by trigger phase, with commands/prompts/skills separated:

```json
{
  "source": "local",
  "issueId": "LOCAL-1",
  "identifier": "LOCAL-1",
  "title": "Fix authentication bug",
  "status": "todo",
  "url": null,
  "description": "...",
  "aiContext": "...",
  "todos": [{ "id": "abc", "text": "First item", "checked": false }],
  "comments": [{ "author": "Author", "body": "...", "created": "2026-03-15" }],
  "attachments": [{ "filename": "screenshot.png", "localPath": "/path", "mimeType": "image/png" }],
  "linkedResources": [{ "title": "PR #42", "url": "https://...", "sourceType": "github" }],
  "hooks": {
    "pre": {
      "commands": [{ "name": "Lint", "command": "pnpm check:lint" }],
      "prompts": [
        { "name": "Review plan", "prompt": "Review the implementation plan before coding" }
      ],
      "skills": [{ "skillName": "my-skill" }]
    },
    "post": {
      "commands": [{ "name": "Test", "command": "pnpm test" }],
      "prompts": [],
      "skills": []
    },
    "custom": {
      "commands": [
        {
          "name": "Security review",
          "command": "pnpm check:security",
          "condition": "Changes touch auth"
        }
      ],
      "prompts": [],
      "skills": []
    }
  }
}
```

## Rename: local `task.json` → `issue.json`

For consistency with Jira/Linear (which already use `issue.json`), rename the local task data file. Both the server (`apps/server/src/routes/tasks.ts`) and CLI (`apps/cli/src/task.ts`) need updating.

**Migration strategy:** Read `issue.json` first, fall back to `task.json` for existing data. On any write, always write `issue.json` (lazy migration). Key locations that read `task.json` directly:

- `apps/server/src/routes/tasks.ts` — `saveTask`, `loadTask`, `getTasksDir`
- `apps/cli/src/task.ts` — `hasStoredIssue`, `processLocalTask`, `fetchLocalIssueChoices`

## What gets removed

### TASK.md generation system

- `libs/shared/src/task-context.ts` — remove `writeTaskMd`, `ensureGitExclude`, `getWorktreeGitExcludePath`. Refactor `generateTaskMd` → `formatTaskContext` (remove boilerplate sections). Add `formatTaskContextJson`.
- `apps/server/src/task-context.ts` — remove `regenerateTaskMd`, `writeTaskMdForWorktree`

### Manager plumbing (only existed for TASK.md)

- `apps/server/src/manager.ts` — remove `pendingWorktreeContext` map + `setPendingWorktreeContext` + the TASK.md write block in worktree creation. Remove `taskHooksProvider` + `setTaskHooksProvider`.
- `apps/server/src/index.ts` — remove `setTaskHooksProvider` call

### PR #76 regeneration calls

- `apps/server/src/routes/tasks.ts` — remove `regenerateTaskMd` calls and `getHooksSnapshot` helper
- `apps/server/src/routes/notes.ts` — remove `regenerateTaskMd` calls and `getHooksSnapshot` helper

### Tests

- `apps/server/src/routes/tasks.test.ts` — remove PR #76's TASK.md regeneration tests
- `apps/server/src/__test__/task-context.test.ts` — rewrite for new `formatTaskContext`

### Skills

- `.claude/skills/work-on-task/SKILL.md` — replace step 7 (read TASK.md + individual files) and step 8 (inspect `.openkit/hooks.json`) with a single step: `openkit task context`. The entire file-reading and hooks-inspection is replaced by one CLI call.
- `libs/agents/src/work-skill/base.md` — same replacement for steps 7-8.

### Docs

- `docs/HOOKS.md`, `docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md` — remove TASK.md references
- `docs/CLI.md` — add `openkit task context` command

## What stays

- `TaskContextData` type — reused by the formatter
- `HooksInfo` type — reused internally by formatter (reshaped for JSON output)
- All issue storage in `.openkit/issues/` — unchanged
- The `openkit task <id> --init` flow — unchanged, just no longer writes TASK.md
- Worktree lifecycle hooks — unchanged

## CLI argument parsing

The `context` subcommand needs `--json` support. The argument parser in `apps/cli/src/index.ts` currently restricts `--json` to the `resolve` subcommand — it must be updated to also allow `--json` for `context`.

## Testing

New tests for the CLI command go in `apps/cli/src/__test__/task-context.test.ts`:

- Auto-detect worktree ID from cwd (direct root + subdirectory)
- Auto-detect fails gracefully when not in a worktree
- Explicit issue ID loads correct data
- `--json` flag returns valid JSON with reshaped hooks
- Missing configDir exits with error
- Missing issue data exits with error
- Fallback from `issue.json` to `task.json` (migration)

Existing tests in `apps/server/src/__test__/task-context.test.ts` are rewritten for the refactored `formatTaskContext` function.

## Implementation location

The `formatTaskContext` and `formatTaskContextJson` functions stay in `libs/shared/src/task-context.ts` (shared between CLI and potentially server). The CLI command is added in `apps/cli/src/task.ts` as a new `runTaskContext` export, registered in `apps/cli/src/index.ts`.
