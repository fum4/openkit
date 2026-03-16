# CLI Agent Commands — Design Spec

**Date:** 2026-03-16
**Branch:** chore/mcp-fixes
**Status:** Approved

## Problem

OpenKit removed its MCP server, which provided 25+ actions agents could call (commit, push, create_pr, run_hooks, notify, etc.). The CLI only covers `task` and `activity` (await-input, phase, check-flow, todo). Agents have lost access to hooks, git operations, worktree management, issue browsing, and general notifications via CLI — the preferred agent interface.

## Goal

Expose every capability agents need as CLI commands, following the existing pattern (discover server via `.openkit/server.json`, call REST API). Update the work-on-task skill to reference the new commands. Fix skill deployment so projects opened through the UI get refreshed skill symlinks.

## Command Surface

All commands support `--json` for machine-readable output. JSON goes to stdout, status messages to stderr.

### Output & Error Contract

- **Default mode**: Human-readable text to stdout, status/progress to stderr via logger.
- **`--json` mode**: Raw server response JSON to stdout. On error: `{ "error": "<message>" }` to stdout.
- **Exit codes**: 0 on success, 1 on failure (matches existing `activity.ts` behavior — errors thrown, caught by `main()`, exit 1).
- **Connection failures**: "No running OpenKit server found for this project" to stderr, exit 1.

### Worktree ID Resolution

Commands that operate on a worktree (`hooks`, `commit`, `push`, `pr`, `policy`, `context`) resolve the worktree ID in order:

1. Explicit `--worktree <id>` flag
2. Inferred from cwd (if running inside `.openkit/worktrees/<id>/`)
3. Error: "Worktree ID required (pass --worktree or run from a worktree directory)"

Commands where worktree is truly optional (`notify`, `issues`, `worktree list`) do not require it.

### Hooks

```
openkit hooks run [--worktree <id>] [--trigger <trigger>] [--step <stepId>]
openkit hooks status [--worktree <id>]
openkit hooks report [--worktree <id>] --skill <name> --trigger <trigger> --success|--failed [--summary <text>] [--file <path>]
openkit hooks config [--worktree <id>]
```

Trigger values: `pre-implementation`, `post-implementation`, `custom`, `on-demand`, `worktree-created`, `worktree-removed`.

- `run`: Runs all hooks for a trigger, or a single step by ID. Maps to `POST /api/worktrees/:id/hooks/run` (with `{ trigger }` body) and `POST /api/worktrees/:id/hooks/run/:stepId`.
- `status`: Returns hook execution history. Maps to `GET /api/worktrees/:id/hooks/status`.
- `report`: Reports skill execution result. Maps to `POST /api/worktrees/:id/hooks/report` with `{ skillName, trigger, success, summary, content, filePath }`.
- `config`: Returns hooks configuration. Maps to `GET /api/hooks/config` (global) or `GET /api/worktrees/:id/hooks/effective-config` (when worktree specified).

### Notifications

```
openkit notify --message "<msg>" [--severity info|success|warning|error] [--worktree <id>] [--require-action]
```

- General-purpose activity notification. Posts to `POST /api/activity`.
- `--require-action` sets `requiresUserAction: true`, emitting `agent_awaiting_input` type.
- `activity await-input` is preserved for backwards compatibility. The work-on-task skill will reference `openkit notify --require-action` going forward.

### Git Operations

```
openkit commit [--worktree <id>] --message "<msg>"
openkit push [--worktree <id>]
openkit pr [--worktree <id>] --title "<title>" [--body "<body>"]
openkit policy [--worktree <id>]
```

- `commit`: Stage all + commit. Maps to `POST /api/worktrees/:id/commit` with `{ message }`.
- `push`: Push current branch. Maps to `POST /api/worktrees/:id/push`.
- `pr`: Create pull request. Maps to `POST /api/worktrees/:id/create-pr` with `{ title, body }`.
- `policy`: Check git policy (whether commit/push/pr are allowed). **New server endpoint required**: `GET /api/worktrees/:id/git-policy`. Calls the existing `resolveGitPolicy()` function from `apps/server/src/git-policy.ts` and returns the result as JSON.

### Worktree Management

```
openkit worktree list
openkit worktree create --name <name> [--branch <branch>]
openkit worktree start <id>
openkit worktree stop <id>
openkit worktree remove <id>
```

- `list`: Maps to `GET /api/worktrees`.
- `create`: Maps to `POST /api/worktrees` with `{ name, branch }`.
- `start`: Maps to `POST /api/worktrees/:id/start`.
- `stop`: Maps to `POST /api/worktrees/:id/stop`.
- `remove`: Maps to `DELETE /api/worktrees/:id`.

### Issues

```
openkit issues list [--source jira|linear]
openkit issues get <id> [--source jira|linear]
```

- `list`: Maps to `GET /api/jira/issues` and/or `GET /api/linear/issues`. When `--source` omitted, queries both configured integrations.
- `get`: Maps to `GET /api/jira/issues/:key` or `GET /api/linear/issues/:identifier`. When `--source` omitted, infers from ID format (e.g. `PROJ-123` → Jira, `ENG-456` → tries both).

### Context

```
openkit context [--worktree <id>]
openkit notes <source> <issue-id>
```

- `context`: Read task context files from the worktree's issue directory. Reads `.openkit/issues/<source>/<id>/task.json` (or `issue.json`), `notes.json`, and `TASK.md` if present. This is a **local file read** — no server endpoint needed. The worktree's linked issue is discovered from the worktree metadata.
- `notes`: Read-only view of issue notes/todos. Maps to `GET /api/notes/:source/:issueId`. Write operations (checking todos) are handled by the existing `openkit activity todo` command.

## Architecture

### Shared Server Client (`apps/cli/src/server-client.ts`)

Extracted from `activity.ts`:

- `findRunningServerUrl(startDir: string): string | null` — walks up from startDir looking for `.openkit/server.json`, validates PID is alive.
- `inferWorktreeIdFromCwd(): string | null` — parses cwd for `.openkit/worktrees/<id>` pattern.
- `requireWorktreeId(explicit: string | undefined): string` — resolves from explicit flag or cwd, throws if neither available.
- `serverFetch(path: string, options?: RequestInit): Promise<Response>` — finds server, makes request, throws on connection failure with actionable error message.
- `serverJson<T>(path: string, options?: RequestInit): Promise<T>` — convenience wrapper that calls `serverFetch` and parses JSON response, throwing on non-2xx with server error message.

### New Server Endpoint

**`GET /api/worktrees/:id/git-policy`** — added to `apps/server/src/routes/worktrees.ts`. Calls existing `resolveGitPolicy(worktree, manager)` and returns the result. No new business logic.

### Command Modules

One file per command group, each exporting a single `run*` entry function:

| File                            | Entry               | Subcommands                       |
| ------------------------------- | ------------------- | --------------------------------- |
| `apps/cli/src/server-client.ts` | (utility)           | —                                 |
| `apps/cli/src/hooks.ts`         | `runHooks(args)`    | run, status, report, config       |
| `apps/cli/src/notify.ts`        | `runNotify(args)`   | (single command)                  |
| `apps/cli/src/git-ops.ts`       | `runGitOps(args)`   | commit, push, pr, policy          |
| `apps/cli/src/worktree.ts`      | `runWorktree(args)` | list, create, start, stop, remove |
| `apps/cli/src/issues.ts`        | `runIssues(args)`   | list, get                         |
| `apps/cli/src/context.ts`       | `runContext(args)`  | context, notes                    |

### Router Changes (`apps/cli/src/index.ts`)

Register each new subcommand with dynamic imports (same pattern as existing commands):

```typescript
if (subcommand === "hooks") { ... await import("./hooks"); ... }
if (subcommand === "notify") { ... await import("./notify"); ... }
if (subcommand === "commit") { ... await import("./git-ops"); ... }
if (subcommand === "push") { ... await import("./git-ops"); ... }
if (subcommand === "pr") { ... await import("./git-ops"); ... }
if (subcommand === "policy") { ... await import("./git-ops"); ... }
if (subcommand === "worktree") { ... await import("./worktree"); ... }
if (subcommand === "issues") { ... await import("./issues"); ... }
if (subcommand === "context") { ... await import("./context"); ... }
if (subcommand === "notes") { ... await import("./context"); ... }
```

### activity.ts Refactor

- Extract `findRunningServerUrl` and `inferWorktreeIdFromCwd` into `server-client.ts`.
- Import from `server-client.ts` in `activity.ts`.
- All existing `activity` subcommands (`await-input`, `phase`, `check-flow`, `todo`) are preserved with identical behavior. No deprecations.

## Skill Deployment Fix

### Problem

`enableDefaultProjectSkills(projectDir)` only runs during `POST /api/config/init` (first-time setup). Existing projects opened through the UI never get skill symlinks refreshed.

### Fix

Call `enableDefaultProjectSkills(projectDir)` during server startup in `apps/server/src/index.ts`, right after `ensureBundledSkills()`. The function already handles existing symlinks gracefully.

## work-on-task Skill Update

Replace MCP references with CLI commands:

- Step 8 ("Inspect hooks"): add `openkit hooks config`
- Step 10 ("Run pre-implementation checks"): add `openkit hooks run --trigger pre-implementation`
- Step 16 ("Run post-implementation checks"): add `openkit hooks run --trigger post-implementation`
- Step 20: replace dual MCP/terminal notify with `openkit notify --require-action --message "<what you need>"`
- Add new section: "Git Operations" — `openkit policy` before any git op, then `openkit commit`, `openkit push`, `openkit pr`
- Add new section: "Context" — `openkit context` to read task context, `openkit notes` for issue notes
- Remove guardrail: "Keep MCP tooling as fallback"
- Add guardrail: "Always check `openkit policy` before git operations"

## Testing

### Unit tests per module (co-located)

- Mock `server-client.ts` at the boundary
- Test argument parsing (valid, missing required, invalid values)
- Test output modes (human-readable default, `--json`)
- Test error paths (server not found, HTTP errors, invalid responses)

### server-client.ts tests

- Mock fs and process
- Test server discovery, PID validation, directory walking
- Test worktree ID inference
- Test `requireWorktreeId` error when neither flag nor cwd available
- Test `serverFetch` and `serverJson` error handling

### activity.ts refactor tests

- Ensure all existing subcommands (`await-input`, `phase`, `check-flow`, `todo`) work after extraction
- Verify backwards compatibility

### Skill deployment test

- Verify `enableDefaultProjectSkills` runs on server startup

### New server endpoint test

- Test `GET /api/worktrees/:id/git-policy` returns policy for valid worktree
- Test 404 for unknown worktree

## Documentation Updates

- `docs/CLI.md` — add all new commands
- `docs/AGENTS.md` — update agent capability reference
- `docs/ARCHITECTURE.md` — update CLI section
- `docs/API.md` — add new `git-policy` endpoint
