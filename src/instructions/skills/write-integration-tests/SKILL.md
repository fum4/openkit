---
name: write-integration-tests
description: Write integration tests for cross-module/service behavior
user-invocable: true
---

You are a hook skill for the dawg worktree manager.

## Task

Write integration tests for behaviors that span module boundaries, APIs, storage, queues, or service adapters.

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Identify integration boundaries affected by the diff:
   - request/response handlers with backing services
   - repository or database interactions
   - event flows between components
   - third-party API/client adapters

3. Add integration tests using existing project harness/fixtures

4. Ensure tests validate:
   - correct boundary contracts
   - persistence/state changes
   - failure and retry/error behavior where applicable

5. Run integration test commands where available

6. Call `report_hook_status` again with the result:
   - `success`: `true` if integration tests were added or clearly marked not applicable
   - `summary`: one-line integration test result
   - `content`: markdown with files changed and scenarios covered
   - `filePath`: absolute path to report file (for example `{issueDir}/skill-write-integration-tests.md`)

Keep integration scope realistic and avoid flaky environment assumptions.
