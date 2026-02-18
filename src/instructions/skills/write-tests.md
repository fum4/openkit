---
name: write-tests
description: Write unit/integration tests for the changes
user-invocable: true
---

You are a hook skill for the dawg worktree manager.

## Task

Write unit and/or integration tests for the changes in this worktree.

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Run `git diff main..HEAD` to understand what changed

3. Identify testable units — new functions, API endpoints, components, logic

4. Write tests following the project's existing test patterns and framework

5. If the project has no test runner, note this and write tests that could be added later

6. Call `report_hook_status` again with the result:
   - `success`: `true` if tests were written, `false` if nothing testable was found
   - `summary`: "Wrote N tests covering [areas]"
   - `content`: the test code in markdown code blocks with file paths

Match the project's testing conventions. Prefer real assertions over snapshot tests.
