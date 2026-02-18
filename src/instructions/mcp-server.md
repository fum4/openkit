{{APP_NAME}} manages git worktrees with automatic port offsetting.

IMPORTANT: When a user mentions an issue key, ticket number, or says "work on <something>", immediately use the appropriate dawg MCP tool to create a worktree.
Do NOT read `.dawg/` files or make HTTP requests to the dawg server — all communication goes through these MCP tools.

---

## Quick Start

| User says                                   | You call                                     |
| ------------------------------------------- | -------------------------------------------- |
| Issue key like "PROJ-123" or number "456"   | `create_from_jira` with `issueKey` param     |
| Linear identifier like "ENG-42" or "NOM-10" | `create_from_linear` with `identifier` param |
| Branch name                                 | `create_worktree` with `branch` param        |
| "show my issues"                            | `list_jira_issues` or `list_linear_issues`   |

---

## After Creating a Worktree

1. Poll `list_worktrees` until status is `stopped` (creation done)
2. Navigate to the worktree path returned in the response
3. Call `get_hooks_config` to discover all configured hooks (pre/post-implementation, custom, on-demand)
4. Run pre-implementation command hooks via `run_hooks` with `trigger: "pre-implementation"` BEFORE starting work (see Hooks section below)
5. Read TASK.md to understand the task from the original issue details
6. Follow AI context directions and work through the todo checklist — these are user-defined and take priority over the original task description when they conflict
7. Plan before coding — analyze the codebase in the worktree, understand existing patterns and conventions, create an implementation approach, and present it to the user for approval before writing any code
8. Toggle each todo item as you complete it using `update_todo`

---

## While Working in a Worktree

| Tool                          | Purpose                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `get_task_context`            | Refresh full task details, AI context, and todo checklist                                                                   |
| `update_todo`                 | Mark todo items as done (toggle) as you complete them — the user tracks your progress through these checkboxes in real-time |
| `start_worktree`              | Launch the dev server                                                                                                       |
| `commit`, `push`, `create_pr` | Git operations                                                                                                              |

---

## Issue Data

- `get_jira_issue` and `get_linear_issue` check locally cached data first, only fetching from the remote API if not found locally.
- Prefer these tools over reading `.dawg/` files directly.

---

## Todo Workflow

Todos are a checklist of sub-tasks defined by the user. They appear in TASK.md and in `get_task_context` output.

1. Before starting work, read the todos to understand what needs to be done
2. As you complete each item, call `update_todo` with `action="toggle"` to check it off
3. The user sees checkbox state update in real-time in the UI
4. You can also add new todos with `action="add"` if you discover additional sub-tasks

---

## Git Policy

The project owner can restrict agent git operations. Before calling `commit`, `push`, or `create_pr`:

1. Call `get_git_policy` with the worktree ID to check if the operation is allowed
2. If not allowed, inform the user and suggest they enable it in Settings or per-worktree
3. When committing, the commit message may be automatically formatted by a project-configured rule

---

## Hooks

Hooks run at different points in the workflow. Call `get_hooks_config` EARLY (right after worktree creation) to discover all configured hooks.

### Trigger Types

| Trigger                 | When to run                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **pre-implementation**  | BEFORE you start coding — sets up context, scaffolding, prerequisites                                               |
| **post-implementation** | AFTER you finish implementing — validates changes (type checks, linting, tests, code review)                        |
| **custom**              | When a natural-language condition is met (e.g. "when changes touch database models") — check conditions as you work |
| **on-demand**           | Only when explicitly requested by the user — do NOT run these automatically                                         |

### Hooks Workflow

1. Call `get_hooks_config` immediately after entering a worktree to see all hooks

2. **Before running** any hook, skill, or command — inform the user what you are about to run and why

   > e.g. "Running pre-implementation hooks: typecheck, lint" or "Invoking /code-review skill as a post-implementation hook"

3. **After running** — summarize results to the user AND report them back through MCP tools so the UI stays updated:
   - **Command steps**: call `run_hooks` with the appropriate trigger (`pre-implementation`, `post-implementation`, `custom`, or `on-demand`). Summarize pass/fail to the user.
   - **Skills**: call `report_hook_status` TWICE — once BEFORE invoking (without `success`/`summary`) to show loading, and once AFTER with the result. Include `trigger` whenever possible.
   - **Prompt hooks**: execute the prompt instruction directly (no `run_hooks` call).

4. Run **pre-implementation** hooks before starting work (`run_hooks` with `trigger: "pre-implementation"` for command steps)

5. While working, check **custom** hook conditions — run matching hooks when your changes trigger them

6. After completing work, run **post-implementation** hooks (`run_hooks` with `trigger: "post-implementation"` for command steps)

7. Call `get_hooks_status` to verify all steps passed

8. TASK.md includes a "Hooks" section listing all enabled checks and skills — follow those instructions

---

## Skill Report Files

For skills that produce detailed output (code review, changes summary, test instructions, explanations), write the full report to a markdown file in the issue folder and pass the absolute path via the `filePath` parameter in `report_hook_status`.

- **File naming**: `{issueDir}/skill-{skillName}.md` (e.g. `skill-code-review.md`) — `issueDir` is returned by `get_task_context`
- **`summary`**: short one-liner; the file contains the full report
- **`content`**: can be omitted when `filePath` is provided

---

## Skill-Specific Guidelines

| Skill                                | Expectations                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code review**                      | Thorough investigation — read actual code files, trace logic, check for bugs, edge cases, security issues, correctness. Don't just summarize the diff.      |
| **Changes summary**                  | Technical, well-structured, bullet points grouped by area (backend, frontend, types). Not overly verbose, but cover all meaningful changes.                 |
| **Test instructions / test writing** | Check if the project has a testing framework configured. If not, ask the user whether to integrate one and which framework. Ask about scope and priorities. |
| **Explain like I'm 5**               | Simple language and analogies. Accessible to non-technical readers.                                                                                         |

---

## Activity Feed

Use the `notify` tool to keep the user informed about progress on long-running tasks. The activity feed shows real-time updates in the UI — the user can see what you're doing without switching context.

- Call `notify` with a short `message` describing what you're doing or what just happened
- Use `severity` to indicate the nature of the update: `info` (default), `warning`, or `error`
- Include `worktreeId` when the update relates to a specific worktree
- Set `requiresUserAction: true` when you need user input to continue
- Good examples: "Analyzing codebase structure", "Found 3 files that need changes", "Running type checker — 2 errors found"
- Don't over-notify — one update per meaningful progress milestone is enough

Other tool calls (`commit`, `push`, `create_pr`, `run_hooks`, `report_hook_status`) are automatically tracked in the activity feed.

---

## After Completing Work

After finishing all implementation and running all post-implementation hooks:

1. Call `get_git_policy` to check what git operations are allowed
2. If commit is allowed — stage and commit all changes (via `commit`)
3. If push is allowed — push to the remote (via `push`)
4. If create_pr is allowed — create a pull request (via `create_pr`)
5. If the worktree dev server is not already running — ask the user if they would like you to start it (via `start_worktree`)
