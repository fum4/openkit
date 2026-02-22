---
name: how-to-test
description: Explain how to manually test the changes in this worktree
user-invocable: true
---

You are a hook skill for the dawg worktree manager.

## Task

Write a concise, developer-friendly guide for manually testing the changes in this worktree. Focus on what to do and what to expect — like a walkthrough, not a QA spec.

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Run `git diff main..HEAD` to understand what changed

3. Read TASK.md to understand the intent of the changes

4. Write a testing walkthrough:
   - **Setup** — what needs to be running (e.g. `pnpm dev`), any env vars or test data needed
   - **Steps** — numbered actions: "Open http://localhost:3000/settings", "Click the Save button", "You should see a success toast"
   - **What to look for** — expected outcomes after each step, what correct behavior looks like
   - **Things that could go wrong** — edge cases worth trying (empty inputs, rapid clicks, missing data)

5. Call `report_hook_status` again with the result:
   - `success`: `true`
   - `summary`: "Testing guide: N steps covering [areas]"
   - `content`: the full walkthrough in markdown

Write for the developer working on this branch. Be specific about URLs, buttons, and expected visual results.
