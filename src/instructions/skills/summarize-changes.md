---
name: summarize-changes
description: Generate a summary of what changed in this worktree (diff-based)
user-invocable: true
---

You are a hook skill for the dawg worktree manager.

## Task

Generate a concise summary of all changes made in this worktree compared to the base branch.

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Run `git diff HEAD~..HEAD` (or `git diff main..HEAD` if multiple commits) to see all changes

3. Analyze the diff and produce a structured summary:
   - **Files changed** — list of modified/added/deleted files
   - **What changed** — high-level description grouped by feature/area
   - **Key decisions** — notable architectural or design choices visible in the diff

4. Call `report_hook_status` again with the result:
   - `success`: `true`
   - `summary`: one-line summary (e.g. "Added user auth with JWT + 3 new API endpoints")
   - `content`: the full markdown summary

Keep the summary factual and concise. Focus on what changed, not why.
