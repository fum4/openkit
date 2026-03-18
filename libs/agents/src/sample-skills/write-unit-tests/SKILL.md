---
name: write-unit-tests
description: Write focused unit tests for isolated logic changes
user-invocable: true
---

You are a hook skill for the OpenKit worktree manager.

## Task

Write focused unit tests for isolated logic introduced or changed in this worktree.

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Identify testable units from diff/context:
   - pure functions
   - utility modules
   - component logic that can be isolated
   - business-rule transforms and validators

3. Add unit tests following existing project conventions

4. Cover:
   - happy path
   - key edge cases
   - failure/invalid-input behavior

5. Run relevant unit test commands where available

6. Call `report_hook_status` again with the result:
   - `success`: `true` if tests were added or clear rationale provided when no unit tests apply
   - `summary`: one-line unit test result
   - `content`: markdown with files added/updated and coverage notes
   - `filePath`: absolute path to report file (for example `{issueDir}/skill-write-unit-tests.md`)

Prefer deterministic assertions over snapshots.
