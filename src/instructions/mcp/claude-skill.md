---
name: work
description: Create or resume work on a task using dawg CLI. Use when the user says "work on PROJ-123", "work NOM-10", "work LOCAL-1", etc.
argument-hint: <issue-id>
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, LS
---

The user wants to work on issue `$ARGUMENTS`.

Use a CLI-first workflow through `dawg task`. Keep MCP as fallback only.

---

{{WORKFLOW}}

## Notes

- Prefer `node dist/cli/index.js ...` when working inside the dawg repo itself to avoid stale global wrappers.
- If `dawg task ... --init` fails due git/worktree permissions, explain the failure and retry with the required permission level.
- If CLI is unavailable but `mcp__dawg__*` tools are available, MCP may be used as a fallback path.
