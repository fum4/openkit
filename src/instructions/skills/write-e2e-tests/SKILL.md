---
name: write-e2e-tests
description: Write end-to-end tests for user workflows affected by changes
user-invocable: true
---

You are a hook skill for the dawg worktree manager.

## Task

Write end-to-end tests for user-visible workflows changed by this worktree.

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Identify impacted user workflows from the diff:
   - entry points/pages/routes
   - critical transitions and state updates
   - external integrations visible to users

3. Add e2e scenarios that cover:
   - primary happy path
   - at least one failure/pathological path when relevant
   - assertions on user-visible outcomes (not just network calls)

4. Reuse existing fixtures, test data, and selectors/patterns from the repo

5. Run e2e test commands where available

6. Call `report_hook_status` again with the result:
   - `success`: `true` if e2e tests were added or clearly marked not applicable
   - `summary`: one-line e2e test result
   - `content`: markdown with flows covered and remaining risk areas
   - `filePath`: absolute path to report file (for example `{issueDir}/skill-write-e2e-tests.md`)

Prefer robust selectors and stable setup/teardown to minimize flaky tests.
