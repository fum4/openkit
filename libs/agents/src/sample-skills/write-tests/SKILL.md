---
name: write-tests
description: Analyze changes, choose test strategy, and delegate to specialized test-writing skills
user-invocable: true
---

You are a hook skill for the OpenKit worktree manager.

## Task

Analyze the diff, determine which test levels are needed (unit, integration, e2e), then invoke the appropriate specialized skills.

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Run `git diff main..HEAD` to understand what changed

3. Build a test plan:
   - **Unit tests** when isolated logic/functions/components changed
   - **Integration tests** when boundaries between modules/services changed
   - **E2E tests** when user workflows changed across multiple layers

4. Invoke one or more specialized skills based on the plan:
   - `write-unit-tests`
   - `write-integration-tests`
   - `write-e2e-tests`

5. If no test framework exists for a required level, document what is missing and provide runnable-ready test scaffolding where possible

6. Call `report_hook_status` again with the result:
   - `success`: `true` if a valid strategy was executed (or clearly blocked), `false` only for hard failure
   - `summary`: one-line strategy/result summary
   - `content`: markdown including chosen test levels, what was written, and any gaps/blockers
   - `filePath`: absolute path to report file (for example `{issueDir}/skill-write-tests.md`)

Do not skip planning. This skill is the orchestrator for test-level selection.
