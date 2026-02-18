---
name: work
description: Create a worktree from an issue and start working on it. Use when the user says "work on PROJ-123", "work NOM-10", etc.
argument-hint: <issue-id>
allowed-tools: mcp__dawg__*
---

The user wants to work on issue $ARGUMENTS.

IMPORTANT: Use ONLY the dawg MCP tools (`mcp__dawg__*`) to interact with dawg. Do NOT read `.dawg/` files or make HTTP requests to the dawg server. All communication goes through the MCP tools.

---

## Steps

1. **Create the worktree** by calling the right MCP tool based on the issue identifier:
   - Jira-style key (e.g. PROJ-123, or just a number) → `mcp__dawg__create_from_jira` with `issueKey` param
   - Linear-style key (e.g. ENG-42, NOM-10) → `mcp__dawg__create_from_linear` with `identifier` param

2. **Wait for creation** — poll `mcp__dawg__list_worktrees` until the worktree status changes from `creating` to `stopped`

3. **Navigate** to the worktree path returned in the response

4. **Check hooks** — call `mcp__dawg__get_hooks_config` to discover all configured hooks.
   - Always inform the user before running any hooks/skills/commands, and summarize results after
   - For each skill: call `mcp__dawg__report_hook_status` BEFORE (without `success`/`summary`) to show loading in the UI, invoke the skill, then call it AGAIN with the result (include `trigger` when possible)
   - Run pre-implementation command hooks via `mcp__dawg__run_hooks` with `trigger: "pre-implementation"` before starting work
   - Check custom hook conditions as you work
   - Run post-implementation hooks when done

5. **Read TASK.md** to understand the task from the original issue details, then follow AI context directions and todos — these are user-defined and take priority over the task description when they conflict

6. **Plan before coding** — enter plan mode and analyze the codebase before writing any code. Explore the relevant source files, understand existing patterns and conventions, then present a concrete implementation plan to the user. Wait for approval before starting implementation.

---

## Prerequisites

The dawg server must be running for MCP tools to work. Start it with `dawg` or via the Electron app.

---

## Available MCP Tools

**Issue browsing:**

- `mcp__dawg__create_from_jira` — create worktree from Jira issue
- `mcp__dawg__create_from_linear` — create worktree from Linear issue
- `mcp__dawg__create_worktree` — create worktree from a branch name
- `mcp__dawg__list_worktrees` — list all worktrees and their status

**Worktree operations:**

- `mcp__dawg__start_worktree` — start the dev server in a worktree
- `mcp__dawg__stop_worktree` — stop the dev server
- `mcp__dawg__get_task_context` — refresh full task details
- `mcp__dawg__get_logs` — get recent output logs

**Git operations:**

- `mcp__dawg__commit` — stage all changes and commit
- `mcp__dawg__push` — push commits to remote
- `mcp__dawg__create_pr` — create a pull request

**Notes and hooks:**

- `mcp__dawg__read_issue_notes` — read AI context notes for a worktree
- `mcp__dawg__get_hooks_config` — discover all configured hooks and trigger types
- `mcp__dawg__run_hooks` — run hook command steps for a worktree
- `mcp__dawg__report_hook_status` — report skill hook start (`running`) or result (`passed`/`failed`)
- `mcp__dawg__get_hooks_status` — check hook run status
