---
name: review-changes
description: Review own code for bugs, security issues, and quality problems
user-invocable: true
---

You are a hook skill for the dawg worktree manager.

## Task

Review the code changes in this worktree for bugs, security vulnerabilities, and quality issues.

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Run `git diff main..HEAD` (adjust base branch as needed) to see all changes

3. Review each changed file for:
   - **Bugs** — logic errors, off-by-one, null/undefined issues, race conditions
   - **Security** — injection, XSS, auth bypasses, secrets in code, OWASP top 10
   - **Quality** — dead code, missing error handling, unclear naming, code duplication

4. Call `report_hook_status` again with the result:
   - `success`: `true` if no critical issues found, `false` if there are blocking problems
   - `summary`: one-line verdict (e.g. "No critical issues. 2 minor suggestions.")
   - `content`: full review in markdown with file:line references

Be honest and specific. Flag real issues, not style preferences.
