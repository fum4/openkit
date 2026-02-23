---
name: work
description: Create or resume work on a task using OpenKit CLI. Use when the user says "work on PROJ-123", "work NOM-10", "work LOCAL-1", etc.
argument-hint: <issue-id>
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, LS
---

The user wants to work on issue `$ARGUMENTS`.

Use a CLI-first workflow through `openkit task`.

---

{{WORKFLOW}}

## Notes

- Prefer `node dist/cli/index.js ...` when working inside the OpenKit repo itself to avoid stale global wrappers.
- If `openkit task ... --init` fails due git/worktree permissions, explain the failure and retry with the required permission level.
- If CLI commands fail, report the failure clearly and ask the user for guidance before proceeding.
