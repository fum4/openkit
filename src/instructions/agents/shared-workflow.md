When the user mentions an issue key (like PROJ-123, ENG-42), a ticket number, or says "work on <something>", use the dawg MCP server tools:

| User says                                 | You call                                             |
| ----------------------------------------- | ---------------------------------------------------- |
| Issue key like "PROJ-123" or number "456" | dawg `create_from_jira` tool                         |
| Linear identifier like "ENG-42"           | dawg `create_from_linear` tool                       |
| "show my issues"                          | dawg `list_jira_issues` or `list_linear_issues` tool |

## After Creating a Worktree

1. **Poll** `list_worktrees` until status is `stopped`
2. **Navigate** to the worktree path
3. **Discover hooks** via `get_hooks_config` (pre-implementation, post-implementation, custom, on-demand)
4. Always inform the user before running hooks/skills/commands, and summarize results after
5. For each skill: call `report_hook_status` BEFORE (without `success`/`summary`) to show loading, invoke skill, then call it AGAIN with the result (include `trigger` when possible)
6. **Run pre-implementation hooks** before starting work (`run_hooks` with `trigger: "pre-implementation"` for command hooks)
7. **Read TASK.md** to understand the task from the original issue details
8. **Follow AI context** directions and todo checklist — these are user-defined and take priority over the original task description when they conflict
9. **Plan before coding** — analyze the codebase in the worktree, understand existing patterns and conventions, create an implementation approach, and present it to the user for approval before writing any code
10. **Start implementing**
11. **After completing** all work and post-implementation hooks (`run_hooks` with `trigger: "post-implementation"` for command hooks), call `get_git_policy` — if commit/push/create_pr are allowed, do them automatically. If the dev server is not already running, ask the user if they'd like you to start it (via `start_worktree`)

## Skill Report Files

For skills with detailed output (code review, changes summary, test instructions, explanations), write the full report to `{issueDir}/skill-{skillName}.md` (`issueDir` is returned by `get_task_context`) and pass the absolute path via `filePath` in `report_hook_status`.

## Skill Quality Guidelines

- **Code review**: thorough investigation — read actual code, trace logic, check for bugs, edge cases, security. Don't just summarize the diff.
- **Changes summary**: technical, well-structured, bullet points grouped by area. Not overly verbose.
- **Test writing**: check if a testing framework exists first. If not, ask the user about integrating one. Ask about scope and priorities.
- **Explain like I'm 5**: simple language, analogies, accessible to non-technical readers.
