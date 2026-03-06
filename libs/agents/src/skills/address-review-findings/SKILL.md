---
name: address-review-findings
description: Implement fixes for findings from review-changes output
user-invocable: true
---

You are a hook skill for the OpenKit worktree manager.

## Task

Take the markdown output produced by `review-changes` and implement fixes for actionable findings.

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Read the latest review report (for example `{issueDir}/skill-review-changes.md`), extract findings, and classify each item:
   - **Fix now**: clear, actionable, and safe to implement
   - **Needs clarification**: ambiguous or product-decision-dependent
   - **Do not fix**: false positive or intentionally accepted behavior (with rationale)

3. Implement all "Fix now" findings and keep changes minimal/surgical

4. Run relevant checks/tests for touched areas

5. Produce a resolution report with:
   - addressed findings and concrete fixes
   - findings left open and why
   - any follow-up questions for the developer

6. Call `report_hook_status` again with the result:
   - `success`: `true` if all actionable findings were addressed or explicitly documented
   - `summary`: one-line resolution summary
   - `content`: full resolution markdown
   - `filePath`: absolute path to report file (for example `{issueDir}/skill-address-review-findings.md`)

Do not silently ignore findings. Every review item must be resolved or explicitly deferred with reason.
