---
name: commit
description: Stage, generate a WHY-focused commit message from the diff, commit, and optionally push.
---

# Commit Skill

## Step 0: Check current branch

Run `git branch --show-current`.

If on `master`:

1. Run `git diff --cached` (and `git diff` / `git status --porcelain` if nothing is staged yet) to understand the changes.
2. Generate a branch name from the diff:
   - **Format:** `<prefix>/<dash-separated-short-description>` (e.g., `feat/about-page`, `fix/stale-worktree-state`)
   - **Prefix:** use the same intent-based prefixes as commit messages (`feat`, `fix`, `refactor`, `chore`, `test`, `docs`, `perf`, `style`).
   - **Description:** 2–4 lowercase words, dash-separated, capturing the change's purpose.
3. Create and switch to the new branch: `git checkout -b <branch-name>`.
4. Show the user the created branch name, then proceed to Step 1.

If **not** on `master`, proceed directly to Step 1.

## Step 1: Check staging state

Run `git status --porcelain` and categorize output:

- Lines starting with a letter in column 1 (e.g., `M `, `A `, `D `, `R `) → **staged**
- Lines starting with a space or `?` in column 1 (e.g., ` M`, `??`) → **unstaged/untracked**

Determine which state applies:

| State                                     | Action                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| All files staged (no unstaged changes)    | Proceed to Step 2                                                                                         |
| No files staged (only unstaged/untracked) | Ask user using `AskUserQuestion` with options: **"Stage all"** / **"Recheck"**                            |
| Mix of staged & unstaged                  | Ask user using `AskUserQuestion` with options: **"Commit only staged"** / **"Stage all"** / **"Recheck"** |

If user picks "Recheck", loop back to Step 1.

When staging all, use `git add -A`.

### AskUserQuestion format

Use the `AskUserQuestion` tool (fetch it via `ToolSearch` first if needed). Example structure:

```json
{
  "questions": [
    {
      "question": "How would you like to handle staging?",
      "header": "Staging",
      "multiSelect": false,
      "options": [
        { "label": "Stage all", "description": "Stage all changes and commit" },
        { "label": "Commit only staged", "description": "Commit only the currently staged files" },
        { "label": "Recheck", "description": "I'll stage manually, then recheck" }
      ]
    }
  ]
}
```

Include only the options relevant to the current state (2 options when nothing is staged, 3 when mixed).

## Step 2: Generate commit message & commit

1. Run `git diff --cached` to get the staged diff.
2. Analyze the diff to understand the **intent** behind the changes — focus on WHY, not WHAT.
3. Generate a commit message following the format rules below.
4. Commit using HEREDOC format for proper multiline handling.
5. Show the user the resulting commit (hash + message).
6. Proceed to Step 3.

## Step 3: Push

After a successful commit, immediately run `git push` (with `-u origin <branch>` if the branch has no upstream yet). The user will approve or deny via the tool permission prompt — no need to ask separately.

## Commit message format

- **Prefix:** short, lowercase word that captures the intent. Common: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `style` — but pick whatever fits best.
- **Scope:** add `(scope)` when changes are localized to one module/app (e.g., `server`, `cli`, `web-app`).
- **Subject line:** concise WHY statement in imperative mood, no period, under 72 chars.
- **Single-concern changes:** subject line only, no body.
- **Multi-concern changes:** subject line + blank line + bullet body. Each bullet explains reasoning, with optional context in parentheses.

### Single-concern example

```
fix(server): prevent stale worktree state from leaking across projects
```

### Multi-concern example

```
feat: improve error recovery and port handling

- prevent stale worktree references after rapid project switches
  (was causing silent failures in git operations)
- validate port availability before binding
  (users were seeing cryptic EADDRINUSE errors)
```

## Rules

- Always attempt to push after committing — the user controls approval via the tool permission prompt.
- Do not add `Co-Authored-By` trailers.
- Do not amend existing commits — always create new ones.
- Do not skip hooks (`--no-verify`).
- If a pre-commit hook fails, fix the issue, re-stage, and create a new commit — do not amend.
