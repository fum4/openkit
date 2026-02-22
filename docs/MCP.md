# MCP Integration

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) is an open standard for connecting AI agents to external tools and data sources. It defines a JSON-RPC-based protocol that allows agents (like Claude Code, Cursor, or any MCP-compatible client) to discover and invoke tools exposed by a server.

OpenKit exposes its entire worktree management surface as MCP tools. This means an AI agent can create worktrees from Jira or Linear issues, start and stop dev servers, commit and push code, manage todo checklists, and run hooks -- all through structured tool calls rather than brittle shell commands or file system access.

## Two Modes

When you run `openkit mcp`, the CLI decides how to operate based on whether a OpenKit HTTP server is already running.

### Proxy Mode (stdio-to-HTTP relay)

If a running server is detected (via `.openkit/server.json`), the CLI acts as a **proxy**. It does not create its own `WorktreeManager`. Instead:

1. It opens a `StdioServerTransport` to communicate with the agent over stdin/stdout (JSON-RPC).
2. It opens a `StreamableHTTPClientTransport` pointed at the running server's `/mcp` endpoint.
3. Every message from the agent is relayed to the HTTP server, and every response is relayed back.

This mode ensures that the MCP tools share the same state as the web UI -- worktree status, logs, port allocations, and SSE events are all consistent.

**How detection works:** The CLI reads `.openkit/server.json` (which contains `url` and `pid`), verifies the process is still alive with `process.kill(pid, 0)`, and uses the URL if the process responds. If the file is missing, unreadable, or the process is dead, it falls back to standalone mode.

### Standalone Mode

If no running server is found, the CLI starts an **in-process** MCP server with its own `WorktreeManager`, `NotesManager`, and `HooksManager`. It communicates directly over stdio without any HTTP intermediary.

This mode is useful when you want MCP tools without running the full web UI -- for example, in a CI environment or a headless agent session.

**Trade-off:** Standalone mode cannot share state with the web UI. If you start the UI later, it will have its own separate manager instance.

## HTTP Transport

For MCP clients that support HTTP-based transport directly (without stdio), OpenKit exposes a streamable HTTP endpoint:

- **Endpoint:** `POST /mcp` (GET and DELETE return 405 — SSE and session management are not needed)
- **Transport:** `WebStandardStreamableHTTPServerTransport` from the MCP SDK, created per request (stateless mode)
- **Session management:** Stateless (no session tracking). OpenKit is a single-user local dev tool, so session multiplexing is unnecessary.
- **Response format:** JSON responses enabled (`enableJsonResponse: true`)

This endpoint is registered automatically when the OpenKit HTTP server starts. Proxy mode uses this endpoint internally.

## Complete Tool Reference

All tools are defined in `src/actions.ts` and registered on the MCP server via `src/server/mcp-server-factory.ts`. Every tool returns JSON content.

### Issue Browsing

| Tool                 | Description                                                                                                                                             | Parameters                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `list_jira_issues`   | List your assigned Jira issues (unresolved). Optionally search by text.                                                                                 | `query` (string, optional) -- text search to filter issues                                          |
| `get_jira_issue`     | Get full details of a Jira issue including description and comments. Checks locally cached data first, only fetches from Jira API if not found locally. | `issueKey` (string, **required**) -- e.g. `PROJ-123` or just `123` if default project is configured |
| `list_linear_issues` | List your assigned Linear issues (open/in progress). Optionally search by text.                                                                         | `query` (string, optional) -- text search to filter issues                                          |
| `get_linear_issue`   | Get full details of a Linear issue including description. Checks locally cached data first, only fetches from Linear API if not found locally.          | `identifier` (string, **required**) -- e.g. `ENG-123` or just `123` if default team is configured   |

### Worktree Management

| Tool                 | Description                                                                                                                                    | Parameters                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `list_worktrees`     | List all worktrees with their status, branch, ports, and git/PR info.                                                                          | _(none)_                                                                                        |
| `create_worktree`    | Create a new git worktree from a branch name. Use `create_from_jira` or `create_from_linear` instead when the user provides an issue key.      | `branch` (string, **required**) -- git branch name; `name` (string, optional) -- directory name |
| `create_from_jira`   | Create a worktree from a Jira issue key. Fetches the issue, saves task data locally, creates worktree with issue key as branch name.           | `issueKey` (string, **required**) -- e.g. `PROJ-123` or `123`                                   |
| `create_from_linear` | Create a worktree from a Linear issue identifier. Fetches the issue, saves task data locally, creates worktree with identifier as branch name. | `identifier` (string, **required**) -- e.g. `ENG-123` or `123`                                  |
| `start_worktree`     | Start the dev server in a worktree (allocates port offset, spawns process).                                                                    | `id` (string, **required**) -- worktree ID                                                      |
| `stop_worktree`      | Stop the running dev server in a worktree.                                                                                                     | `id` (string, **required**) -- worktree ID                                                      |
| `remove_worktree`    | Remove a worktree (stops it first if running, then deletes directory and git worktree reference).                                              | `id` (string, **required**) -- worktree ID                                                      |
| `get_logs`           | Get recent output logs from a running worktree (up to 100 lines).                                                                              | `id` (string, **required**) -- worktree ID                                                      |

### Git Operations

All git operations are subject to the agent git policy. Call `get_git_policy` first to check whether an operation is allowed.

| Tool             | Description                                                                                                                                | Parameters                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `commit`         | Stage all changes and commit in a worktree. Requires GitHub integration. Commit message may be auto-formatted by project-configured rules. | `id` (string, **required**) -- worktree ID; `message` (string, **required**) -- commit message                                      |
| `push`           | Push commits in a worktree to the remote. Requires GitHub integration.                                                                     | `id` (string, **required**) -- worktree ID                                                                                          |
| `create_pr`      | Create a GitHub pull request for a worktree branch. Requires GitHub integration. Follows push policy.                                      | `id` (string, **required**) -- worktree ID; `title` (string, **required**) -- PR title; `body` (string, optional) -- PR description |
| `get_git_policy` | Check whether agent git operations (commit, push, create_pr) are allowed for a worktree.                                                   | `id` (string, **required**) -- worktree ID                                                                                          |

### Task Context & Notes

| Tool               | Description                                                                                                                                                       | Parameters                                                                                                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_task_context` | Get full task context for a worktree: issue details, description, comments, AI context directions, todo checklist, and worktree path. Also regenerates `TASK.md`. | `worktreeId` (string, **required**)                                                                                                                                                                                                                                                      |
| `read_issue_notes` | Read AI context notes for a worktree or issue. Returns directions and todo checklist.                                                                             | `worktreeId` (string, optional); `source` (string, optional) -- `"jira"`, `"linear"`, or `"local"`; `issueId` (string, optional). Provide either `worktreeId` or both `source` and `issueId`.                                                                                            |
| `update_todo`      | Add, toggle, or delete a todo checklist item on an issue. The user monitors progress through these checkboxes in real-time.                                       | `source` (string, **required**) -- `"jira"`, `"linear"`, or `"local"`; `issueId` (string, **required**); `action` (string, **required**) -- `"add"`, `"toggle"`, or `"delete"`; `todoId` (string, optional) -- required for toggle/delete; `text` (string, optional) -- required for add |

### Activity Feed

| Tool     | Description                                                                                                                                                               | Parameters                                                                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `notify` | Send a free-form status update to the openkit activity feed. Use to keep the user informed about progress on long-running tasks. Other tool calls are tracked automatically. | `message` (string, **required**) -- status message; `severity` (string, optional) -- `"info"` (default), `"warning"`, or `"error"`; `worktreeId` (string, optional) -- related worktree ID; `requiresUserAction` (boolean, optional) -- mark when user input is required |

### Configuration

| Tool         | Description                                          | Parameters |
| ------------ | ---------------------------------------------------- | ---------- |
| `get_config` | Get the current OpenKit configuration and project name. | _(none)_   |

### Hooks

| Tool                 | Description                                                                                                                                                           | Parameters                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_hooks_config`   | Get the hooks configuration, including command steps and skill references organized by trigger type.                                                                  | _(none)_                                                                                                                                                                                                                                                                                                                                             |
| `run_hooks`          | Run hook command steps for a worktree. Steps matching the trigger type run in parallel.                                                                               | `worktreeId` (string, **required**); `trigger` (string, optional) -- `"pre-implementation"`, `"post-implementation"` (default), `"custom"`, `"on-demand"`, `"worktree-created"`, or `"worktree-removed"`                                                                                                                                              |
| `report_hook_status` | Report a skill hook status. Call TWICE: once BEFORE invoking a skill (without `success`/`summary`) to show a loading state in the UI, and once AFTER with the result. | `worktreeId` (string, **required**); `skillName` (string, **required**); `trigger` (string, optional) -- hook trigger phase; `success` (boolean, optional -- omit for start); `summary` (string, optional -- omit for start); `content` (string, optional) -- detailed markdown; `filePath` (string, optional) -- absolute path to an MD report file |
| `get_hooks_status`   | Get the current/last hook run status for a worktree, including step results.                                                                                          | `worktreeId` (string, **required**)                                                                                                                                                                                                                                                                                                                  |

## MCP Prompt: `work-on-task`

In addition to tools, the MCP server registers a **prompt** called `work-on-task`. Agents that support MCP prompts can invoke it with an `issueId` parameter. It returns a structured message that guides the agent through the full workflow:

1. Determine the issue type and call the appropriate creation tool (`create_from_jira` or `create_from_linear`)
2. Poll `list_worktrees` until the worktree status is `stopped` (creation complete)
3. Navigate to the worktree directory
4. Call `get_hooks_config` to discover hooks — run pre-implementation command hooks with `run_hooks` (`trigger: "pre-implementation"`) before starting work
5. Read `TASK.md` for full context
6. Start implementing the task
7. After completing all work and post-implementation hooks, ask the user if they'd like to start the worktree dev server automatically

## MCP Instructions

The MCP server sends an instructions prompt to connected agents. This prompt teaches agents the "work-on-task" workflow and how to use the tools correctly. Here is the full text:

```
OpenKit manages git worktrees with automatic port offsetting.

IMPORTANT: When a user mentions an issue key, ticket number, or says "work on <something>",
you should immediately use the appropriate OpenKit MCP tool to create a worktree.
Do NOT read .openkit/ files or make HTTP requests to the OpenKit server. All communication goes through these MCP tools.

## Quick Start
- Issue key like "PROJ-123" or number like "456" -> call create_from_jira with issueKey param
- Linear identifier like "ENG-42" or "NOM-10" -> call create_from_linear with identifier param
- Branch name -> call create_worktree directly with branch param
- "show my issues" -> call list_jira_issues or list_linear_issues

## After Creating a Worktree
1. Poll list_worktrees until status is 'stopped' (creation done)
2. Navigate to the worktree path returned in the response
3. Call get_hooks_config to discover all configured hooks (pre-implementation, post-implementation, custom, on-demand, plus lifecycle triggers)
4. Run any pre-implementation hooks BEFORE starting work (see Hooks section below)
5. Read TASK.md for full context (includes issue details, AI directions, and a todo checklist)
6. Work through the todo items in order -- toggle each one as you complete it using update_todo
7. Follow any directions in the AI Context section

## While Working in a Worktree
- get_task_context -- refresh full task details, AI context, and todo checklist
- update_todo -- IMPORTANT: mark todo items as done (toggle) as you complete them. The user tracks your progress through these checkboxes in real-time.
- start_worktree -- launch the dev server
- commit, push, create_pr -- git operations

## Issue Data
- get_jira_issue and get_linear_issue check locally cached data first. They only fetch from the remote API if no local data is found.
- Prefer these tools over reading .openkit/ files directly.

## Todo Workflow
Todos are a checklist of sub-tasks defined by the user. They appear in TASK.md and in get_task_context output.
1. Before starting work, read the todos to understand what needs to be done
2. As you complete each item, call update_todo with action="toggle" to check it off
3. The user sees checkbox state update in real-time in the UI
4. You can also add new todos with action="add" if you discover additional sub-tasks

## Git Policy
The project owner can restrict agent git operations. Before calling commit, push, or create_pr:
1. Call get_git_policy with the worktree ID to check if the operation is allowed
2. If not allowed, inform the user and suggest they enable it in Settings or per-worktree
3. When committing, the commit message may be automatically formatted by a project-configured rule

## Hooks
Hooks run at different points in the workflow. Call get_hooks_config EARLY (right after worktree creation) to discover all configured hooks.

There are six trigger types:
- **pre-implementation**: Run BEFORE you start coding. These set up context, run scaffolding, or enforce prerequisites.
- **post-implementation**: Run AFTER you finish implementing. These validate changes (type checks, linting, tests, code review).
- **custom**: Run when a natural-language condition is met (e.g. "when changes touch database models"). Check conditions as you work and run matching hooks when appropriate.
- **on-demand**: Only run when explicitly requested by the user. Do not run these automatically.
- **worktree-created**: Runs automatically after worktree creation via CLI-backed flows.
- **worktree-removed**: Runs automatically after worktree removal via CLI-backed flows.

`worktree-created` and `worktree-removed` are command-only lifecycle hooks. Skill import and skill status reporting are not supported for these triggers.

### Workflow
1. Call get_hooks_config immediately after entering a worktree to see all hooks
2. Before running any hook, skill, or command -- inform the user what you are about to run and why
3. After running -- summarize results AND report them via report_hook_status (call twice: once before invoking without success/summary to show loading, once after with the result; pass `trigger` whenever possible)
4. Run pre-implementation command hooks with `run_hooks` (`trigger: "pre-implementation"`) before starting work
5. While working, check custom hook conditions -- if your changes match a condition, run those hooks
6. After completing work, run post-implementation hooks
7. Call get_hooks_status to verify all steps passed
8. After all work and hooks are done, ask the user if they'd like to start the worktree dev server automatically (via start_worktree)

## Skill Report Files
For skills that produce detailed output (e.g. code review, changes summary, test instructions, explanations), write the full report to a markdown file in the issue folder and pass the absolute path via the filePath parameter in report_hook_status. The user can then open and preview the report from the UI.
- File naming: {issueDir}/skill-{skillName}.md (e.g. skill-code-review.md) — issueDir is returned by get_task_context
- The summary field should be a short one-liner; the file contains the full report
- The content field can be omitted when filePath is provided

## Activity Feed
Use the notify tool to keep the user informed about progress on long-running tasks.
The activity feed shows real-time updates in the UI.
- Call notify with a short message describing what you're doing or what just happened
- Use severity to indicate the nature: info (default), warning, or error
- Include worktreeId when the update relates to a specific worktree
- Set `requiresUserAction: true` when you need user input to proceed
- Don't over-notify — one update per meaningful progress milestone is enough
- Other tool calls (commit, push, create_pr, run_hooks, report_hook_status) are automatically tracked

## Skill-Specific Guidelines
- Code review: thorough investigation — read actual code, trace logic, check for bugs, edge cases, security
- Changes summary: technical, well-structured, bullet points grouped by area
- Test writing: check if a testing framework exists first; if not, ask the user about integrating one
- Explain like I'm 5: simple language, analogies, accessible to non-technical readers
```

## Setup

### As a Claude Code MCP Server

Add to your `.mcp.json` (project-level) or `~/.claude/claude_desktop_config.json` (global):

```json
{
  "mcpServers": {
    "OpenKit": {
      "command": "openkit",
      "args": ["mcp"]
    }
  }
}
```

When configured this way, `openkit mcp` runs as a stdio-based MCP server. It will automatically detect whether a OpenKit HTTP server is running and choose proxy or standalone mode accordingly.

### As HTTP Transport

For MCP clients that support direct HTTP connections (no stdio wrapper needed):

```json
{
  "mcpServers": {
    "OpenKit": {
      "url": "http://localhost:6969/mcp"
    }
  }
}
```

Replace `6969` with your configured `serverPort` if different. This requires the OpenKit HTTP server to be running (`OpenKit` or `openkit connect`).

### Verifying the Connection

Once configured, the agent should have access to all OpenKit tools. You can verify by asking the agent to call `list_worktrees` or `get_config`. If the connection is working, it will return your project configuration and any existing worktrees.
