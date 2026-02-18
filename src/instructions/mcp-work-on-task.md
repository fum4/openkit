Use the dawg MCP server tools to create a worktree for issue "{{ISSUE_ID}}".

## Workflow

1. **Determine issue type** and call the appropriate tool: `create_from_jira` or `create_from_linear`
2. The response will include full task context and the worktree path
3. **Poll** `list_worktrees` until the worktree status is `stopped` (creation complete)
4. **Navigate** to the worktree directory
5. **Discover hooks** via `get_hooks_config` — always inform the user before running hooks/skills/commands and summarize results after. For each skill: call `report_hook_status` BEFORE (without `success`/`summary`) to show loading, invoke the skill, then call it AGAIN with the result (include `trigger` when possible)
6. **Run pre-implementation hooks** before starting work (`run_hooks` with `trigger: "pre-implementation"` for command hooks; execute prompt hooks directly)
7. **Read TASK.md** to understand the task from the original issue details
8. **Follow AI context** directions and todo checklist — these are user-defined and take priority over the task description when they conflict
9. **Plan before coding** — analyze the codebase in the worktree, understand existing patterns and conventions, create an implementation approach, and present it to the user for approval before writing any code
10. **Start implementing** the task
11. **After completing** all work and post-implementation hooks (`run_hooks` with `trigger: "post-implementation"` for command hooks), call `get_git_policy` — if commit/push/create_pr are allowed, do them automatically. If the dev server is not already running, ask the user if they'd like to start it (via `start_worktree`)

## Skill Reports

For skills with detailed output (code review, changes summary, test instructions, explanations), write the full report to `{issueDir}/skill-{skillName}.md` (`issueDir` is returned by `get_task_context`) and pass the path via `filePath` in `report_hook_status`.

## Skill Quality

- **Code review**: thorough investigation — read code, trace logic, find bugs
- **Changes summary**: technical, bullet points by area
- **Test writing**: check for testing framework first, ask user if none found
